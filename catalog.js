/**
 * CatalogManager - Shopify Storefront Catalog & Image Cache
 * Powered by Dexie.js with Background Auto-Sync:
 * 1. Loads local Dexie cached catalog in 0ms on startup.
 * 2. Silently verifies and updates products from https://khiam.store in the background.
 * 3. 3-Level matching hierarchy (Exact SKU -> Prefix Model/Color -> Arabic Title).
 * 4. Automatic background image preloading for uploaded batches.
 */

class CatalogManager {
  constructor() {
    this.shopDomain = localStorage.getItem('khiam_shop_domain') || 'khiam.store';
    this.memoryVariants = new Map(); // cleanSku -> variant
    this.memoryPrefixes = new Map(); // prefix -> Array of variants
    this.productsList = [];
    this.stats = { totalProducts: 0, totalVariants: 0, lastSync: null };
    this.db = null;
    this.isSyncing = false;

    this.initDexie();
  }

  async initDexie() {
    try {
      if (window.Dexie) {
        this.db = new Dexie('KhiamStoreCatalogDexie');
        this.db.version(1).stores({
          products: '&sku, productId, modelPrefix, title, variantTitle, imageUrl',
          rawProducts: '&id, title, handle',
          meta: '&key, value'
        });
        await this.loadAllFromDexie();
        
        // Trigger background silent auto-sync from Shopify 2 seconds after boot
        setTimeout(() => {
          this.triggerBackgroundAutoSync();
        }, 2000);
      } else {
        console.warn('Dexie.js not loaded, using in-memory cache.');
      }
    } catch (e) {
      console.warn('Dexie init error:', e);
    }
  }

  setShopDomain(domain) {
    if (!domain) return;
    this.shopDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('khiam_shop_domain', this.shopDomain);
  }

  extractModelPrefix(sku) {
    if (!sku) return '';
    const clean = sku.trim().toLowerCase();
    const stripped = clean.replace(/\d+$/, '');
    if (stripped.length >= 4) return stripped;
    if (clean.length >= 5) return clean.slice(0, -1);
    return clean;
  }

  async loadAllFromDexie() {
    if (!this.db) return;
    try {
      const variants = await this.db.products.toArray();
      this.memoryVariants.clear();
      this.memoryPrefixes.clear();

      variants.forEach(v => {
        const cleanSku = (v.sku || '').trim().toLowerCase();
        if (!cleanSku) return;

        this.memoryVariants.set(cleanSku, v);

        const prefix = v.modelPrefix || this.extractModelPrefix(cleanSku);
        if (!this.memoryPrefixes.has(prefix)) {
          this.memoryPrefixes.set(prefix, []);
        }
        this.memoryPrefixes.get(prefix).push(v);
      });

      this.productsList = await this.db.rawProducts.toArray();
      const lastSyncMeta = await this.db.meta.get('lastSync');
      this.stats.lastSync = lastSyncMeta ? lastSyncMeta.value : null;
      this.stats.totalVariants = this.memoryVariants.size;
      this.stats.totalProducts = this.productsList.length;

      // Broadcast loaded event for app.js UI
      window.dispatchEvent(new CustomEvent('catalog-loaded', { detail: this.stats }));
    } catch (err) {
      console.warn('Error loading from Dexie:', err);
    }
  }

  /**
   * Background Auto-Sync: Updates catalog silently in the background
   * without blocking or disrupting warehouse operation.
   */
  async triggerBackgroundAutoSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    console.log('[Khiam Store] Starting background auto-sync from Shopify...');

    try {
      const result = await this.syncShopifyCatalog();
      console.log(`[Khiam Store] Background auto-sync complete: ${result.productsCount} products, ${result.variantsCount} SKUs.`);
      window.dispatchEvent(new CustomEvent('catalog-updated', { detail: this.stats }));
    } catch (err) {
      console.warn('[Khiam Store] Background auto-sync skipped (network or CORS limitation):', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * CORS-safe fetch with reliable public proxies
   */
  async fetchWithCorsFallback(targetUrl) {
    try {
      const resp = await fetch(targetUrl, { headers: { 'Accept': 'application/json' }, cache: 'no-cache' });
      if (resp.ok) return await resp.json();
    } catch (err) {}

    const proxies = [
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];

    for (const p of proxies) {
      try {
        const resp = await fetch(p(targetUrl), { cache: 'no-cache' });
        if (resp.ok) {
          const text = await resp.text();
          return JSON.parse(text);
        }
      } catch (e) {}
    }

    throw new Error('تعذر الوصول إلى متجر شوبيفاي');
  }

  /**
   * Multi-page synchronization from Shopify Storefront JSON API
   */
  async syncShopifyCatalog(onProgress = null) {
    let page = 1;
    let totalProducts = 0;
    let totalVariants = 0;
    const limit = 250;
    const baseHost = this.shopDomain;

    const newVariants = [];
    const newProducts = [];

    while (true) {
      const url = `https://${baseHost}/products.json?limit=${limit}&page=${page}`;

      if (onProgress) {
        onProgress({
          status: 'fetching',
          page,
          productsCount: totalProducts,
          variantsCount: totalVariants,
          message: `جاري سحب الصفحة ${page} من المتجر...`
        });
      }

      let data;
      try {
        data = await this.fetchWithCorsFallback(url);
      } catch (err) {
        if (page === 1) throw err;
        break;
      }

      const products = data.products || [];
      if (products.length === 0) break;

      totalProducts += products.length;

      for (const prod of products) {
        const mainImg = (prod.images && prod.images.length > 0) ? prod.images[0].src : '';
        newProducts.push({
          id: prod.id,
          title: prod.title,
          handle: prod.handle,
          mainImage: mainImg
        });

        for (const variant of (prod.variants || [])) {
          if (variant.sku) {
            const cleanSku = variant.sku.trim().toLowerCase();
            let varImg = mainImg;
            if (variant.featured_image && variant.featured_image.src) {
              varImg = variant.featured_image.src;
            } else if (variant.image_id && prod.images) {
              const matched = prod.images.find(img => img.id === variant.image_id);
              if (matched) varImg = matched.src;
            }

            const prefix = this.extractModelPrefix(cleanSku);
            newVariants.push({
              sku: cleanSku,
              originalSku: variant.sku,
              title: `${prod.title} - ${variant.title}`,
              productTitle: prod.title,
              variantTitle: variant.title,
              imageUrl: varImg,
              productId: prod.id,
              variantId: variant.id,
              modelPrefix: prefix,
              price: variant.price
            });

            totalVariants++;
          }
        }
      }

      if (onProgress) {
        onProgress({
          status: 'progress',
          page,
          productsCount: totalProducts,
          variantsCount: totalVariants,
          message: `تم سحب ${totalProducts} منتج و ${totalVariants} كود SKU...`
        });
      }

      if (products.length < limit) break;
      page++;
    }

    if (this.db) {
      await this.db.transaction('rw', this.db.products, this.db.rawProducts, this.db.meta, async () => {
        await this.db.products.bulkPut(newVariants);
        await this.db.rawProducts.bulkPut(newProducts);
        await this.db.meta.put({ key: 'lastSync', value: new Date().toISOString() });
      });
      await this.loadAllFromDexie();
    }

    return { productsCount: totalProducts, variantsCount: totalVariants };
  }

  /**
   * 3-Level Matching Hierarchy
   */
  getProductImageAndDetails(rawSku, rawProductName = '') {
    const cleanSku = (rawSku || '').trim().toLowerCase();

    // 1. Exact SKU
    if (cleanSku && this.memoryVariants.has(cleanSku)) {
      const match = this.memoryVariants.get(cleanSku);
      return {
        imageUrl: match.imageUrl,
        title: match.title,
        sku: match.originalSku || rawSku,
        variantTitle: match.variantTitle || '',
        matchLevel: 'exact',
        confidence: 100
      };
    }

    // 2. Prefix Model / Color Match (stripping size suffix)
    if (cleanSku) {
      const prefix = this.extractModelPrefix(cleanSku);
      if (prefix && this.memoryPrefixes.has(prefix)) {
        const candidates = this.memoryPrefixes.get(prefix);
        if (candidates.length > 0) {
          const best = candidates[0];
          return {
            imageUrl: best.imageUrl,
            title: best.title,
            sku: best.originalSku || rawSku,
            variantTitle: best.variantTitle || '',
            matchLevel: 'prefix',
            confidence: 90
          };
        }
      }
    }

    // 3. Arabic Title & Color Similarity Match
    if (rawProductName && this.productsList.length > 0) {
      const matchByTitle = this.matchByArabicTitle(rawProductName);
      if (matchByTitle) {
        return {
          imageUrl: matchByTitle.mainImage || '',
          title: matchByTitle.title,
          sku: rawSku,
          variantTitle: '',
          matchLevel: 'title',
          confidence: 75
        };
      }
    }

    // 4. Fallback Monogram SVG
    return {
      imageUrl: this.getSvgPlaceholder(rawSku, rawProductName),
      title: rawProductName || rawSku,
      sku: rawSku,
      variantTitle: '',
      matchLevel: 'fallback',
      confidence: 0
    };
  }

  matchByArabicTitle(rawTitle) {
    if (!rawTitle) return null;
    const normalize = (t) => t
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, ' ')
      .trim()
      .toLowerCase();

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
        if (cleanProdTitle.includes(token)) matchedCount++;
      }
      if (matchedCount > maxMatchedTokens && matchedCount >= Math.min(2, searchTokens.length)) {
        maxMatchedTokens = matchedCount;
        bestProduct = prod;
      }
    }

    return bestProduct;
  }

  /**
   * Preload Images for current batch
   */
  async preloadImagesForOrders(orders, onProgress = null) {
    if (!orders || orders.length === 0) return 0;
    const uniqueItems = new Map();
    orders.forEach(order => {
      (order.items || []).forEach(item => {
        if (!uniqueItems.has(item.sku)) {
          uniqueItems.set(item.sku, item);
        }
      });
    });

    let preloaded = 0;
    const promises = [];

    uniqueItems.forEach(item => {
      const details = this.getProductImageAndDetails(item.sku, item.name);
      if (details.imageUrl && !details.imageUrl.startsWith('data:image/svg')) {
        const p = new Promise(res => {
          const img = new Image();
          img.onload = () => {
            preloaded++;
            if (onProgress) onProgress(preloaded, uniqueItems.size);
            res(true);
          };
          img.onerror = () => res(false);
          img.src = details.imageUrl;
        });
        promises.push(p);
      }
    });

    await Promise.allSettled(promises);
    return preloaded;
  }

  exportCatalogJson() {
    if (this.memoryVariants.size === 0 && this.productsList.length === 0) {
      throw new Error('لا توجد بيانات في الكتالوج لتصديرها!');
    }

    const payload = {
      version: '2.5',
      exportedAt: new Date().toISOString(),
      shopDomain: this.shopDomain,
      productsCount: this.productsList.length,
      variantsCount: this.memoryVariants.size,
      products: this.productsList,
      variants: Array.from(this.memoryVariants.values())
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `khiam-products-cache-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  }

  async importCatalogJson(jsonText) {
    const data = JSON.parse(jsonText);
    const variants = data.variants || [];
    const products = data.products || [];

    if (variants.length === 0 && products.length === 0) {
      throw new Error('الملف لا يحتوي على بيانات كتالوج صالحة!');
    }

    if (this.db) {
      await this.db.transaction('rw', this.db.products, this.db.rawProducts, this.db.meta, async () => {
        await this.db.products.bulkPut(variants);
        await this.db.rawProducts.bulkPut(products);
        await this.db.meta.put({ key: 'lastSync', value: new Date().toISOString() });
      });
      await this.loadAllFromDexie();
    }

    return { productsCount: products.length, variantsCount: variants.length };
  }

  getSvgPlaceholder(sku = '', title = '') {
    const display = (sku || title || 'KHIAM').substring(0, 10).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231e293b"/><stop offset="100%" stop-color="%230f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><g fill="%2394a3b8" font-family="sans-serif" text-anchor="middle"><text x="150" y="130" font-size="52">👗</text><text x="150" y="180" font-size="16" font-weight="bold" fill="%23f8fafc">خيام ستور</text><text x="150" y="210" font-size="13" font-weight="bold" fill="%23f43f5e">${encodeURIComponent(display)}</text></g></svg>`;
  }
}

// Global Catalog Instance
window.catalogManager = new CatalogManager();
