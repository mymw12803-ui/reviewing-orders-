/**
 * CatalogManager - Advanced Shopify Storefront Product & Image Sync Engine
 * Specifically designed for Khiam Store (https://khiam.store)
 * Features:
 * 1. Multi-page Shopify JSON API sync with automatic CORS Proxies fallback.
 * 2. Offline-first IndexedDB storage + memory index.
 * 3. 3-Level Smart Matcher:
 *    - Level 1: Exact SKU match.
 *    - Level 2: Model & Color prefix match (stripping size suffix/digits e.g. ba51ei3 -> ba51ei).
 *    - Level 3: Arabic title & color token matching.
 * 4. Ultra-fast Image Preloading into browser cache (0ms image display during picking).
 * 5. 1-Click JSON Catalog Export & Import for offline/air-gapped warehouse operation.
 */

class CatalogManager {
  constructor(dbName = 'KhiamStoreCatalogV2') {
    this.dbName = dbName;
    this.db = null;
    this.shopDomain = localStorage.getItem('khiam_shop_domain') || 'khiam.store';

    // Fast in-memory lookup indices
    this.variantsBySku = new Map();         // cleanSku -> { sku, title, imageUrl, productId, variantId }
    this.variantsByPrefix = new Map();      // prefix (model code) -> Array of variants
    this.productsList = [];                 // raw products list for title matching
    this.stats = { totalProducts: 0, totalVariants: 0, lastSync: null };

    this.initDB();
  }

  // ------------------------------------------------------------------
  // 1. IndexedDB Initialization & Migration
  // ------------------------------------------------------------------
  async initDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not supported, using memory cache.');
        return resolve(null);
      }
      const req = indexedDB.open(this.dbName, 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('variants')) {
          db.createObjectStore('variants', { keyPath: 'sku' });
        }
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      req.onsuccess = async (e) => {
        this.db = e.target.result;
        await this.loadAllFromDB();
        resolve(this.db);
      };
      req.onerror = (e) => {
        console.error('IndexedDB open error:', e);
        resolve(null);
      };
    });
  }

  setShopDomain(domain) {
    if (!domain) return;
    this.shopDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('khiam_shop_domain', this.shopDomain);
  }

  // ------------------------------------------------------------------
  // 2. Load Existing Cached Data into Memory Indices
  // ------------------------------------------------------------------
  async loadAllFromDB() {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['variants', 'products', 'metadata'], 'readonly');
        const varStore = tx.objectStore('variants');
        const prodStore = tx.objectStore('products');
        const metaStore = tx.objectStore('metadata');

        const varReq = varStore.getAll();
        varReq.onsuccess = () => {
          const variants = varReq.result || [];
          this.variantsBySku.clear();
          this.variantsByPrefix.clear();

          variants.forEach(v => {
            const cleanSku = (v.sku || '').trim().toLowerCase();
            if (!cleanSku) return;

            this.variantsBySku.set(cleanSku, v);

            // Populate prefix index (model & color code, stripping trailing size digits)
            const prefix = this.extractModelPrefix(cleanSku);
            if (prefix) {
              if (!this.variantsByPrefix.has(prefix)) {
                this.variantsByPrefix.set(prefix, []);
              }
              this.variantsByPrefix.get(prefix).push(v);
            }
          });

          this.stats.totalVariants = this.variantsBySku.size;
        };

        const prodReq = prodStore.getAll();
        prodReq.onsuccess = () => {
          this.productsList = prodReq.result || [];
          this.stats.totalProducts = this.productsList.length;
        };

        const metaReq = metaStore.get('lastSync');
        metaReq.onsuccess = () => {
          if (metaReq.result) {
            this.stats.lastSync = metaReq.result.value;
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        console.warn('DB loadAll error:', err);
        resolve(false);
      }
    });
  }

  /**
   * Extracts model prefix by removing size digits or trailing size markers
   * Examples:
   *  ba51ei3 -> ba51ei
   *  ba51ei4 -> ba51ei
   *  Ac055an4 -> ac055an
   *  aa011f6 -> aa011f
   */
  extractModelPrefix(sku) {
    if (!sku) return '';
    const clean = sku.trim().toLowerCase();
    // 1. Strip trailing digits
    const noTrailingDigits = clean.replace(/\d+$/, '');
    if (noTrailingDigits.length >= 4) {
      return noTrailingDigits;
    }
    // 2. Strip single last character if length >= 5
    if (clean.length >= 5) {
      return clean.substring(0, clean.length - 1);
    }
    return clean;
  }

  // ------------------------------------------------------------------
  // 3. Shopify Catalog Fetching with Automatic CORS Proxies Fallback
  // ------------------------------------------------------------------
  async fetchWithCorsFallback(targetUrl) {
    // Strategy 1: Direct Fetch (works when running as Chrome Extension or with permissive CORS)
    try {
      const resp = await fetch(targetUrl, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache'
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch (directErr) {
      console.warn('Direct fetch failed, trying CORS proxies fallback...', directErr);
    }

    // Strategy 2: Reliable Public CORS Proxies
    const proxies = [
      (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    for (const makeProxyUrl of proxies) {
      try {
        const proxyUrl = makeProxyUrl(targetUrl);
        const resp = await fetch(proxyUrl, { cache: 'no-cache' });
        if (resp.ok) {
          const text = await resp.text();
          return JSON.parse(text);
        }
      } catch (proxyErr) {
        console.warn('Proxy attempt failed, trying next...', proxyErr);
      }
    }

    throw new Error('تعذر الوصول إلى متجر شوبيفاي بسبب قيود CORS أو انقطاع الاتصال.');
  }

  /**
   * Multi-page synchronization from Shopify Storefront JSON API
   */
  async syncShopifyCatalog(onProgress = null) {
    let page = 1;
    let totalProductsCount = 0;
    let totalVariantsCount = 0;
    const limit = 250;
    const baseHost = this.shopDomain;

    const allNewProducts = [];
    const allNewVariants = [];

    while (true) {
      const targetUrl = `https://${baseHost}/products.json?limit=${limit}&page=${page}`;
      
      if (onProgress) {
        onProgress({
          status: 'fetching',
          page,
          productsCount: totalProductsCount,
          variantsCount: totalVariantsCount,
          message: `جاري سحب الصفحة ${page} من المتجر...`
        });
      }

      let data;
      try {
        data = await this.fetchWithCorsFallback(targetUrl);
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err);
        if (page === 1) throw err; // First page failure is critical
        break; // Stop paginating if subsequent page fails
      }

      const products = data.products || [];
      if (products.length === 0) break;

      totalProductsCount += products.length;

      for (const prod of products) {
        const mainImg = prod.images && prod.images.length > 0 ? prod.images[0].src : '';
        allNewProducts.push({
          id: prod.id,
          title: prod.title,
          handle: prod.handle,
          mainImage: mainImg,
          images: (prod.images || []).map(img => ({ id: img.id, src: img.src }))
        });

        const variants = prod.variants || [];
        for (const variant of variants) {
          if (variant.sku) {
            const cleanSku = variant.sku.trim().toLowerCase();
            // Variant specific image or fallback to main product image
            let varImg = mainImg;
            if (variant.featured_image && variant.featured_image.src) {
              varImg = variant.featured_image.src;
            } else if (variant.image_id && prod.images) {
              const matchedImg = prod.images.find(img => img.id === variant.image_id);
              if (matchedImg) varImg = matchedImg.src;
            }

            allNewVariants.push({
              sku: cleanSku,
              originalSku: variant.sku,
              title: `${prod.title} - ${variant.title}`,
              productTitle: prod.title,
              variantTitle: variant.title,
              imageUrl: varImg,
              productId: prod.id,
              variantId: variant.id,
              price: variant.price
            });

            totalVariantsCount++;
          }
        }
      }

      if (onProgress) {
        onProgress({
          status: 'progress',
          page,
          productsCount: totalProductsCount,
          variantsCount: totalVariantsCount,
          message: `تم سحب ${totalProductsCount} منتج و ${totalVariantsCount} كود SKU...`
        });
      }

      if (products.length < limit) break;
      page++;
    }

    // Persist to IndexedDB in bulk
    await this.bulkSaveToDB(allNewProducts, allNewVariants);
    await this.loadAllFromDB();

    return {
      productsCount: totalProductsCount,
      variantsCount: totalVariantsCount
    };
  }

  async bulkSaveToDB(products, variants) {
    if (!this.db) await this.initDB();
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['products', 'variants', 'metadata'], 'readwrite');
        const prodStore = tx.objectStore('products');
        const varStore = tx.objectStore('variants');
        const metaStore = tx.objectStore('metadata');

        products.forEach(p => prodStore.put(p));
        variants.forEach(v => varStore.put(v));

        metaStore.put({ key: 'lastSync', value: new Date().toISOString() });

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => {
          console.error('Bulk save error:', e);
          resolve(false);
        };
      } catch (err) {
        console.error('Bulk save transaction error:', err);
        resolve(false);
      }
    });
  }

  // ------------------------------------------------------------------
  // 4. Smart SKU & Title Matching Algorithm (3 Levels)
  // ------------------------------------------------------------------
  /**
   * Resolves product image and metadata with hierarchical fallback:
   * Level 1: Exact SKU match.
   * Level 2: Prefix match (model & color code without size digit).
   * Level 3: Arabic Name & Color token matching.
   * Level 4: SVG dynamic fallback placeholder.
   */
  getProductImageAndDetails(rawSku, rawProductName = '') {
    const cleanSku = (rawSku || '').trim().toLowerCase();

    // --------------------------------------------------------
    // LEVEL 1: Exact SKU Match
    // --------------------------------------------------------
    if (cleanSku && this.variantsBySku.has(cleanSku)) {
      const match = this.variantsBySku.get(cleanSku);
      return {
        imageUrl: match.imageUrl,
        title: match.title,
        sku: match.originalSku || rawSku,
        matchLevel: 'exact',
        confidence: 100
      };
    }

    // --------------------------------------------------------
    // LEVEL 2: Model & Color Prefix Match (Ignoring Size Digit)
    // --------------------------------------------------------
    if (cleanSku) {
      const prefix = this.extractModelPrefix(cleanSku);
      if (prefix && this.variantsByPrefix.has(prefix)) {
        const candidates = this.variantsByPrefix.get(prefix);
        if (candidates.length > 0) {
          // Take the variant's image because model & color are identical
          const best = candidates[0];
          return {
            imageUrl: best.imageUrl,
            title: best.title,
            sku: best.originalSku || rawSku,
            matchLevel: 'prefix',
            confidence: 90
          };
        }
      }
    }

    // --------------------------------------------------------
    // LEVEL 3: Arabic Name & Color Matching
    // --------------------------------------------------------
    if (rawProductName && this.productsList.length > 0) {
      const matchByTitle = this.matchByArabicTitle(rawProductName);
      if (matchByTitle) {
        return {
          imageUrl: matchByTitle.mainImage || (matchByTitle.images && matchByTitle.images[0]?.src),
          title: matchByTitle.title,
          sku: rawSku,
          matchLevel: 'title',
          confidence: 75
        };
      }
    }

    // --------------------------------------------------------
    // LEVEL 4: Fallback SVG Monogram Placeholder
    // --------------------------------------------------------
    return {
      imageUrl: this.getSvgPlaceholder(rawSku, rawProductName),
      title: rawProductName || rawSku,
      sku: rawSku,
      matchLevel: 'fallback',
      confidence: 0
    };
  }

  /**
   * Fuzzy matches Arabic product titles by extracting model name and color tokens
   */
  matchByArabicTitle(rawTitle) {
    if (!rawTitle) return null;

    const normalize = (t) => t
      .replace(/[\u064B-\u065F]/g, '') // Remove tashkeel
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, ' ')
      .trim()
      .toLowerCase();

    // Clean title up to '-' or '/'
    const baseTitle = rawTitle.split(/[-–/]/)[0].trim();
    const cleanSearch = normalize(baseTitle);
    const searchTokens = cleanSearch.split(/\s+/).filter(w => w.length > 2);

    if (searchTokens.length === 0) return null;

    let bestProduct = null;
    let maxMatchedTokens = 0;

    for (const prod of this.productsList) {
      const cleanProdTitle = normalize(prod.title);
      let matchedCount = 0;

      for (const token of searchTokens) {
        if (cleanProdTitle.includes(token)) {
          matchedCount++;
        }
      }

      if (matchedCount > maxMatchedTokens && matchedCount >= Math.min(2, searchTokens.length)) {
        maxMatchedTokens = matchedCount;
        bestProduct = prod;
      }
    }

    return bestProduct;
  }

  // ------------------------------------------------------------------
  // 5. High-Speed Image Preloading (0ms Picking Latency)
  // ------------------------------------------------------------------
  /**
   * Preloads all product images referenced in the currently uploaded sheet
   * into the browser's in-memory image cache immediately upon CSV load.
   */
  async preloadImagesForOrders(orders, onPreloadProgress = null) {
    if (!orders || orders.length === 0) return 0;

    // Collect all unique items
    const uniqueItems = new Map(); // sku -> { sku, name }
    orders.forEach(order => {
      (order.items || []).forEach(item => {
        if (!uniqueItems.has(item.sku)) {
          uniqueItems.set(item.sku, item);
        }
      });
    });

    const totalUnique = uniqueItems.size;
    let preloadedCount = 0;
    const promises = [];

    uniqueItems.forEach(item => {
      const details = this.getProductImageAndDetails(item.sku, item.name);
      if (details.imageUrl && !details.imageUrl.startsWith('data:image/svg')) {
        const p = new Promise((res) => {
          const img = new Image();
          img.onload = () => {
            preloadedCount++;
            if (onPreloadProgress) onPreloadProgress(preloadedCount, totalUnique);
            res(true);
          };
          img.onerror = () => res(false);
          img.src = details.imageUrl;
        });
        promises.push(p);
      }
    });

    await Promise.allSettled(promises);
    return preloadedCount;
  }

  // ------------------------------------------------------------------
  // 6. 1-Click JSON Catalog Export & Import (Offline Operation)
  // ------------------------------------------------------------------
  exportCatalogJson() {
    if (this.variantsBySku.size === 0 && this.productsList.length === 0) {
      throw new Error('لا توجد بيانات في الكتالوج لتصديرها!');
    }

    const payload = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      shopDomain: this.shopDomain,
      productsCount: this.productsList.length,
      variantsCount: this.variantsBySku.size,
      products: this.productsList,
      variants: Array.from(this.variantsBySku.values())
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `khiam-products-cache-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  }

  async importCatalogJson(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const products = data.products || [];
      const variants = data.variants || [];

      if (variants.length === 0 && products.length === 0) {
        throw new Error('الملف لا يحتوي على بيانات منتجات صالحة!');
      }

      await this.bulkSaveToDB(products, variants);
      await this.loadAllFromDB();

      return {
        productsCount: products.length,
        variantsCount: variants.length
      };
    } catch (e) {
      console.error('Import catalog error:', e);
      throw new Error('فشل قراءة ملف الكتالوج JSON. تأكد من صحة الملف.');
    }
  }

  // ------------------------------------------------------------------
  // 7. Dynamic SVG Fallback Placeholder Generator
  // ------------------------------------------------------------------
  getSvgPlaceholder(sku = '', title = '') {
    const display = (sku || title || 'KHIAM').substring(0, 10).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231e293b"/><stop offset="100%" stop-color="%230f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><g fill="%2394a3b8" font-family="sans-serif" text-anchor="middle"><text x="150" y="130" font-size="52">👗</text><text x="150" y="180" font-size="16" font-weight="bold" fill="%23f8fafc">خيام ستور</text><text x="150" y="210" font-size="13" font-weight="bold" fill="%23f43f5e">${encodeURIComponent(display)}</text></g></svg>`;
  }
}

// Global Catalog Instance
window.catalogManager = new CatalogManager();
