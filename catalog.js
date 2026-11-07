/**
 * CatalogManager & BarcodeTranslator - Khiam Store Warehouse
 * Permanent Barcode-to-SKU Translation & Shopify Catalog Integration
 * Powered by Dexie.js (IndexedDB)
 * 
 * Features:
 * 1. 0ms Permanent Barcode Translator:
 *    - 405 Unique 9-digit barcodes + 563 SKUs seeded from builtin_barcode_map.js into Dexie.
 *    - Permanent offline persistence in IndexedDB.
 *    - Instant 0ms memory lookup.
 * 2. PDF.js Barcode Extractor:
 *    - Ability to upload any future barcode PDF file.
 *    - Upserts new barcodes/SKUs without deleting existing ones.
 * 3. Shopify Catalog & Image Cache:
 *    - Synchronizes with https://khiam.store/products.json
 *    - Multi-level matching: Exact SKU -> Prefix Model/Color -> Arabic Title.
 */

class CatalogManager {
  constructor() {
    this.shopDomain = localStorage.getItem('khiam_shop_domain') || 'khiam.store';
    
    // In-Memory Fast Lookup Maps (0ms latency)
    this.barcodeMap = new Map();       // '599523571' -> { sku, barcode, name, imageUrl, title, variantTitle }
    this.skuMap = new Map();           // 'ac010bn9' -> { sku, barcode, name, imageUrl, title, variantTitle }
    this.zeroBarcodeList = [];         // Items with barcode '00000000'
    this.memoryVariants = new Map();   // cleanSku -> variant (Shopify)
    this.memoryPrefixes = new Map();   // prefix -> Array of variants
    this.productsList = [];            // Raw Shopify products

    this.stats = {
      barcodeCount: 0,
      skuCount: 0,
      zeroCount: 0,
      totalProducts: 0,
      lastSync: null
    };

    this.db = null;
    this.isSyncing = false;

    this.initDexie();
  }

  // ----------------------------------------------------
  // 1. Dexie IndexedDB Initialization & Permanent Seeding
  // ----------------------------------------------------
  async initDexie() {
    try {
      if (window.Dexie) {
        this.db = new Dexie('KhiamWarehouseDB_v2');
        this.db.version(1).stores({
          barcodes: '&barcode, sku, title, variantTitle, name, imageUrl, isZero',
          products: '&sku, originalSku, barcode, title, variantTitle, modelPrefix, imageUrl, isZero',
          rawProducts: '&id, title, handle, mainImage',
          meta: '&key, value'
        });

        await this.ensurePermanentSeeding();
        await this.loadAllFromDexie();

        // Silent background update check after 3 seconds
        setTimeout(() => {
          this.triggerBackgroundAutoSync();
        }, 3000);
      } else {
        console.warn('Dexie.js not found, falling back to built-in dictionary in memory.');
        this.loadFromBuiltinDictDirectly();
      }
    } catch (e) {
      console.warn('Dexie init error:', e);
      this.loadFromBuiltinDictDirectly();
    }
  }

  /**
   * Seed Dexie IndexedDB from window.KHIAM_BUILTIN_BARCODE_DICT
   */
  async ensurePermanentSeeding() {
    if (!this.db || !window.KHIAM_BUILTIN_BARCODE_DICT) return;

    try {
      const dict = window.KHIAM_BUILTIN_BARCODE_DICT;
      const count = await this.db.barcodes.count();
      const metaSeeded = await this.db.meta.get('seededVersion');

      // Seed if empty or version mismatch
      if (count < dict.barcodeCount || !metaSeeded || metaSeeded.value !== dict.version) {
        console.log(`[Catalog] Seeding ${dict.barcodeCount} barcodes & ${dict.skuCount} SKUs into Dexie IndexedDB...`);

        const barcodeEntries = [];
        const productEntries = [];

        // 1. Barcode to SKU mappings
        for (const [barcode, sku] of Object.entries(dict.barcodeToSku || {})) {
          const skuData = (dict.skuToData && dict.skuToData[sku.toLowerCase()]) || {};
          barcodeEntries.push({
            barcode: barcode,
            sku: sku,
            title: skuData.title || '',
            variantTitle: skuData.variantTitle || '',
            name: skuData.name || '',
            imageUrl: skuData.imageUrl || '',
            price: skuData.price || '',
            isZero: false,
            updatedAt: new Date().toISOString()
          });
        }

        // 2. Full SKU Catalog
        for (const [cleanSku, data] of Object.entries(dict.skuToData || {})) {
          const prefix = this.extractModelPrefix(cleanSku);
          productEntries.push({
            sku: cleanSku,
            originalSku: data.sku || cleanSku,
            barcode: data.barcode || '',
            title: data.title || '',
            variantTitle: data.variantTitle || '',
            name: data.name || '',
            modelPrefix: prefix,
            imageUrl: data.imageUrl || '',
            price: data.price || '',
            isZero: data.isZeroBarcode || false,
            updatedAt: new Date().toISOString()
          });
        }

        await this.db.transaction('rw', this.db.barcodes, this.db.products, this.db.meta, async () => {
          // New dictionary version replaces stale rows (e.g. the old '00000000' pseudo-SKU with garbled PDF name)
          if (metaSeeded && metaSeeded.value !== dict.version) {
            await this.db.barcodes.clear();
            await this.db.products.clear();
          }
          await this.db.barcodes.bulkPut(barcodeEntries);
          await this.db.products.bulkPut(productEntries);
          await this.db.meta.put({ key: 'seededVersion', value: dict.version });
          await this.db.meta.put({ key: 'lastSeeded', value: new Date().toISOString() });
        });

        console.log('[Catalog] IndexedDB seeding complete! Data is permanently stored.');
      }
    } catch (err) {
      console.warn('[Catalog] Error during Dexie seeding:', err);
    }
  }

  loadFromBuiltinDictDirectly() {
    if (!window.KHIAM_BUILTIN_BARCODE_DICT) return;
    const dict = window.KHIAM_BUILTIN_BARCODE_DICT;

    this.barcodeMap.clear();
    this.skuMap.clear();
    this.zeroBarcodeList = dict.zeroBarcodeItems || [];

    for (const [barcode, sku] of Object.entries(dict.barcodeToSku || {})) {
      const skuData = (dict.skuToData && dict.skuToData[sku.toLowerCase()]) || { sku };
      this.barcodeMap.set(barcode, {
        barcode,
        sku,
        name: skuData.name || '',
        title: skuData.title || '',
        variantTitle: skuData.variantTitle || '',
        imageUrl: skuData.imageUrl || '',
        price: skuData.price || '',
        isZero: false
      });
    }

    for (const [cleanSku, data] of Object.entries(dict.skuToData || {})) {
      this.skuMap.set(cleanSku, data);
      const prefix = this.extractModelPrefix(cleanSku);
      if (!this.memoryPrefixes.has(prefix)) {
        this.memoryPrefixes.set(prefix, []);
      }
      this.memoryPrefixes.get(prefix).push(data);
    }

    this.stats.barcodeCount = this.barcodeMap.size;
    this.stats.skuCount = this.skuMap.size;
    this.stats.zeroCount = this.zeroBarcodeList.length;

    window.dispatchEvent(new CustomEvent('catalog-loaded', { detail: this.stats }));
  }

  async loadAllFromDexie() {
    if (!this.db) {
      this.loadFromBuiltinDictDirectly();
      return;
    }

    try {
      const barcodeRows = await this.db.barcodes.toArray();
      const productRows = await this.db.products.toArray();
      this.productsList = await this.db.rawProducts.toArray();

      this.barcodeMap.clear();
      this.skuMap.clear();
      this.memoryVariants.clear();
      this.memoryPrefixes.clear();
      this.zeroBarcodeList = [];

      barcodeRows.forEach(row => {
        if (row.barcode) {
          this.barcodeMap.set(row.barcode, row);
        }
      });

      productRows.forEach(row => {
        const cleanSku = (row.sku || '').trim().toLowerCase();
        if (!cleanSku || /^0+$/.test(cleanSku)) return;

        this.skuMap.set(cleanSku, row);
        this.memoryVariants.set(cleanSku, row);

        if (row.isZero) {
          this.zeroBarcodeList.push(row);
        }

        const prefix = row.modelPrefix || this.extractModelPrefix(cleanSku);
        if (!this.memoryPrefixes.has(prefix)) {
          this.memoryPrefixes.set(prefix, []);
        }
        this.memoryPrefixes.get(prefix).push(row);
      });

      const lastSyncMeta = await this.db.meta.get('lastSync');
      this.stats.lastSync = lastSyncMeta ? lastSyncMeta.value : null;
      this.stats.barcodeCount = this.barcodeMap.size;
      this.stats.skuCount = this.skuMap.size;
      this.stats.zeroCount = this.zeroBarcodeList.length;
      this.stats.totalProducts = this.productsList.length;

      console.log(`[Catalog] Loaded ${this.stats.barcodeCount} barcodes and ${this.stats.skuCount} SKUs from IndexedDB in 0ms!`);
      window.dispatchEvent(new CustomEvent('catalog-loaded', { detail: this.stats }));
    } catch (err) {
      console.warn('Error loading from Dexie:', err);
      this.loadFromBuiltinDictDirectly();
    }
  }

  // ----------------------------------------------------
  // 2. 0ms Barcode-to-SKU Translation Logic
  // ----------------------------------------------------
  /**
   * Translate any barcode scan:
   * Returns:
   * - { type: 'zero_barcode', barcode: '00000000' }
   * - { type: 'barcode_translated', sku, barcode, item }
   * - { type: 'direct_sku', sku, barcode, item }
   * - { type: 'unknown', code }
   */
  translateBarcode(rawCode) {
    if (!rawCode) return { type: 'unknown', code: '' };
    const code = rawCode.trim();

    // 1. Zero barcode special case (damaged / legacy labels scan as zeros)
    if (/^0{4,14}$/.test(code)) {
      return {
        type: 'zero_barcode',
        barcode: code,
        isZero: true,
        matchingZeroItems: this.zeroBarcodeList
      };
    }

    // 2. 9-digit (or any numeric) Barcode Lookup
    if (this.barcodeMap.has(code)) {
      const item = this.barcodeMap.get(code);
      return {
        type: 'barcode_translated',
        sku: item.sku,
        barcode: code,
        item: item
      };
    }

    // 3. Direct Alphanumeric SKU Match (e.g. 'ba51ei3', 'Ac010bn9', 'aa035bs0')
    const lowerSku = code.toLowerCase();
    if (this.skuMap.has(lowerSku)) {
      const item = this.skuMap.get(lowerSku);
      return {
        type: 'direct_sku',
        sku: item.originalSku || item.sku || code,
        barcode: item.barcode || '',
        item: item
      };
    }

    // 4. Try normalized numeric (strip leading/trailing zeros or spaces)
    const pureDigits = code.replace(/\D/g, '');
    if (pureDigits && this.barcodeMap.has(pureDigits)) {
      const item = this.barcodeMap.get(pureDigits);
      return {
        type: 'barcode_translated',
        sku: item.sku,
        barcode: pureDigits,
        item: item
      };
    }

    return {
      type: 'unknown',
      code: code
    };
  }

  /**
   * Look up full item details by SKU
   */
  getSkuData(sku) {
    if (!sku) return null;
    return this.skuMap.get(sku.trim().toLowerCase()) || null;
  }

  // ----------------------------------------------------
  // 3. PDF.js New Barcodes Importer (Future Expansion)
  // ----------------------------------------------------
  /**
   * Extracts barcodes & SKUs from an uploaded PDF file and upserts them permanently.
   */
  async importBarcodePdf(file, onProgress = null) {
    if (!window.pdfjsLib) {
      throw new Error('مكتبة PDF.js غير متوفرة في النظام!');
    }

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const totalPages = pdf.numPages;

    const newBarcodes = [];
    const newProducts = [];
    let addedBarcodes = 0;
    let addedSkus = 0;

    for (let p = 1; p <= totalPages; p++) {
      if (onProgress) {
        onProgress({ page: p, totalPages, percent: Math.round((p / totalPages) * 100) });
      }

      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = this.reconstructLabelLines(content.items);

      if (lines.length < 2) continue;

      let barcode = '';
      for (let j = lines.length - 1; j >= 0; j--) {
        const m = lines[j].match(/\b\d{8,9}\b/);
        if (m) {
          barcode = m[0];
          break;
        }
      }

      // Labels of variants without a SKU print 00000000 in the SKU slot: key them by barcode
      const labelSku = lines[0].replace(/\s+/g, '');
      const sku = /^0+$/.test(labelSku) ? `NOSKU-${barcode}` : labelSku;

      const rawName = lines.slice(1, lines.length - 1).join(' ');
      const isZero = /^0+$/.test(barcode);

      // Check if already in Shopify catalog for clean Arabic title & image
      const shopifyItem = this.skuMap.get(sku.toLowerCase());
      const title = shopifyItem ? shopifyItem.title : '';
      const variantTitle = shopifyItem ? shopifyItem.variantTitle : '';
      const name = shopifyItem ? (shopifyItem.name || `${title} - ${variantTitle}`) : rawName;
      const imageUrl = shopifyItem ? shopifyItem.imageUrl : '';
      const price = shopifyItem ? shopifyItem.price : '';

      const productEntry = {
        sku: sku.toLowerCase(),
        originalSku: sku,
        barcode: barcode,
        title: title,
        variantTitle: variantTitle,
        name: name,
        modelPrefix: this.extractModelPrefix(sku.toLowerCase()),
        imageUrl: imageUrl,
        price: price,
        // Keep the legacy flag: old printed labels of this SKU may still scan as zeros
        isZero: isZero || !!(shopifyItem && (shopifyItem.isZero || shopifyItem.isZeroBarcode)),
        updatedAt: new Date().toISOString()
      };

      newProducts.push(productEntry);
      addedSkus++;

      if (!isZero && barcode) {
        newBarcodes.push({
          barcode: barcode,
          sku: sku,
          title: title,
          variantTitle: variantTitle,
          name: name,
          imageUrl: imageUrl,
          price: price,
          isZero: false,
          updatedAt: new Date().toISOString()
        });
        addedBarcodes++;
      }
    }

    // Upsert into Dexie IndexedDB
    if (this.db) {
      await this.db.transaction('rw', this.db.barcodes, this.db.products, this.db.meta, async () => {
        if (newBarcodes.length > 0) await this.db.barcodes.bulkPut(newBarcodes);
        if (newProducts.length > 0) await this.db.products.bulkPut(newProducts);
        await this.db.meta.put({ key: 'lastPdfImport', value: new Date().toISOString() });
      });

      await this.loadAllFromDexie();
    } else {
      // In-memory merge
      newBarcodes.forEach(b => this.barcodeMap.set(b.barcode, b));
      newProducts.forEach(p => this.skuMap.set(p.sku, p));
      this.stats.barcodeCount = this.barcodeMap.size;
      this.stats.skuCount = this.skuMap.size;
    }

    return { addedBarcodes, addedSkus, totalPages };
  }

  // ----------------------------------------------------
  // 4. Shopify Storefront Catalog Sync
  // ----------------------------------------------------
  setShopDomain(domain) {
    if (!domain) return;
    this.shopDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    localStorage.setItem('khiam_shop_domain', this.shopDomain);
  }

  /**
   * PDF.js returns Arabic label text as separate glyphs in visual (reversed) order.
   * Rebuild readable lines: group by row, read right-to-left, insert spaces at gaps,
   * and NFKC-normalize presentation forms back to regular Arabic letters.
   */
  reconstructLabelLines(items) {
    const rows = [];
    items.filter(it => it.str && it.str.trim()).forEach(it => {
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 8;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.5);
      if (!row) { row = { y, h, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.transform[4], w: it.width, str: it.str.normalize('NFKC') });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map(row => {
      row.parts.sort((a, b) => (b.x + b.w) - (a.x + a.w));
      let line = '';
      let prevLeft = null;
      row.parts.forEach(p => {
        if (prevLeft !== null && prevLeft - (p.x + p.w) > row.h * 0.15) line += ' ';
        line += p.str;
        prevLeft = p.x;
      });
      return line.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  /**
   * Variants without a SKU (keyed NOSKU-<barcode>) reach orders with an empty SKU:
   * find them by product name instead, ignoring word order and punctuation.
   */
  findSkuByName(productName) {
    if (!productName) return '';
    const words = s => new Set(s.normalize('NFKC').replace(/[أإآ]/g, 'ا').split(/[\s/()\-|]+/)
      .map(w => w.replace(/[^؀-ۿa-z0-9]/gi, '').toLowerCase()).filter(Boolean));
    const target = words(productName.split('|')[0]);
    for (const [key, item] of this.skuMap) {
      if (!key.startsWith('nosku-')) continue;
      const w = words(item.name || `${item.title} ${item.variantTitle}`);
      if (w.size === target.size && [...w].every(t => target.has(t))) return key;
    }
    return '';
  }

  extractModelPrefix(sku) {
    if (!sku) return '';
    const clean = sku.trim().toLowerCase();
    const stripped = clean.replace(/\d+$/, '');
    if (stripped.length >= 4) return stripped;
    if (clean.length >= 5) return clean.slice(0, -1);
    return clean;
  }

  async triggerBackgroundAutoSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    console.log('[Catalog] Starting background auto-sync from Shopify...');

    try {
      const result = await this.syncShopifyCatalog();
      console.log(`[Catalog] Background auto-sync complete: ${result.productsCount} products, ${result.variantsCount} SKUs.`);
      window.dispatchEvent(new CustomEvent('catalog-updated', { detail: this.stats }));
    } catch (err) {
      console.warn('[Catalog] Background auto-sync skipped (offline or CORS):', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

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
            const existing = this.skuMap.get(cleanSku);

            newVariants.push({
              sku: cleanSku,
              originalSku: variant.sku,
              barcode: variant.barcode || (existing ? existing.barcode : ''),
              title: `${prod.title} - ${variant.title}`,
              productTitle: prod.title,
              variantTitle: variant.title,
              imageUrl: varImg,
              productId: prod.id,
              variantId: variant.id,
              modelPrefix: prefix,
              price: variant.price,
              isZero: existing ? existing.isZero : false,
              updatedAt: new Date().toISOString()
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

  // ----------------------------------------------------
  // 5. Image & Metadata Resolution Hierarchy
  // ----------------------------------------------------
  getProductImageAndDetails(rawSku, rawProductName = '') {
    const cleanSku = (rawSku || '').trim().toLowerCase();

    // 1. Exact SKU match in memory
    if (cleanSku && this.skuMap.has(cleanSku)) {
      const match = this.skuMap.get(cleanSku);
      return {
        imageUrl: match.imageUrl || this.generateFallbackMonogram(rawSku, match.title || rawProductName),
        title: match.title || match.name || rawProductName,
        name: match.name || match.title || rawProductName,
        sku: match.originalSku || rawSku,
        variantTitle: match.variantTitle || '',
        barcode: match.barcode || '',
        isZeroBarcode: !!(match.isZeroBarcode || match.isZero),
        matchLevel: 'exact',
        confidence: 100
      };
    }

    // 2. Model prefix / color match
    if (cleanSku) {
      const prefix = this.extractModelPrefix(cleanSku);
      if (prefix && this.memoryPrefixes.has(prefix)) {
        const candidates = this.memoryPrefixes.get(prefix);
        if (candidates.length > 0) {
          const best = candidates[0];
          return {
            imageUrl: best.imageUrl || this.generateFallbackMonogram(rawSku, best.title || rawProductName),
            title: best.title || best.name || rawProductName,
            name: best.name || best.title || rawProductName,
            sku: best.originalSku || rawSku,
            variantTitle: best.variantTitle || '',
            barcode: best.barcode || '',
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
          imageUrl: matchByTitle.mainImage || this.generateFallbackMonogram(rawSku, rawProductName),
          title: matchByTitle.title,
          name: matchByTitle.title,
          sku: rawSku,
          variantTitle: '',
          barcode: '',
          matchLevel: 'title',
          confidence: 75
        };
      }
    }

    // 4. Fallback Monogram
    return {
      imageUrl: this.generateFallbackMonogram(rawSku, rawProductName),
      title: rawProductName || rawSku || 'صنف مخزن خيام',
      name: rawProductName || rawSku,
      sku: rawSku,
      variantTitle: '',
      barcode: '',
      matchLevel: 'fallback',
      confidence: 30
    };
  }

  matchByArabicTitle(rawName) {
    if (!rawName) return null;
    const clean = rawName.toLowerCase()
      .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = clean.split(' ').filter(t => t.length > 2);
    if (tokens.length === 0) return null;

    let bestProd = null;
    let maxHits = 0;

    for (const prod of this.productsList) {
      const prodTitle = (prod.title || '').toLowerCase();
      let hits = 0;
      for (const t of tokens) {
        if (prodTitle.includes(t)) hits++;
      }
      if (hits > maxHits && hits >= 2) {
        maxHits = hits;
        bestProd = prod;
      }
    }

    return bestProd;
  }

  generateFallbackMonogram(sku, name = '') {
    const label = name ? name.trim().slice(0, 16) : (sku || 'KHIAM');
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
        </defs>
        <rect width="400" height="400" rx="32" fill="url(#bgGrad)"/>
        <circle cx="200" cy="160" r="70" fill="#334155" opacity="0.6"/>
        <text x="200" y="175" font-family="Cairo, sans-serif" font-size="44" font-weight="900" fill="#f43f5e" text-anchor="middle">خيام</text>
        <text x="200" y="270" font-family="Cairo, sans-serif" font-size="18" font-weight="700" fill="#e2e8f0" text-anchor="middle">${label}</text>
        <text x="200" y="305" font-family="monospace" font-size="14" font-weight="700" fill="#f59e0b" text-anchor="middle">${sku || ''}</text>
      </svg>
    `.trim();

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  async preloadImagesForOrders(orders) {
    if (!orders || orders.length === 0) return 0;
    const urls = new Set();

    orders.forEach(ord => {
      ord.items.forEach(it => {
        const details = this.getProductImageAndDetails(it.sku, it.name);
        if (details.imageUrl && !details.imageUrl.startsWith('data:')) {
          urls.add(details.imageUrl);
        }
      });
    });

    let loadedCount = 0;
    const promises = Array.from(urls).map(url => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = url;
        img.onload = () => { loadedCount++; resolve(true); };
        img.onerror = () => resolve(false);
      });
    });

    await Promise.allSettled(promises);
    return loadedCount;
  }

  // ----------------------------------------------------
  // 6. JSON Export / Import
  // ----------------------------------------------------
  exportCatalogJson() {
    const data = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      shopDomain: this.shopDomain,
      stats: this.stats,
      barcodes: Array.from(this.barcodeMap.values()),
      products: Array.from(this.skuMap.values())
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `khiam-warehouse-catalog-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importCatalogJson(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data.products && !data.barcodes) throw new Error('تنسيق ملف JSON غير متوافق!');

    if (this.db) {
      await this.db.transaction('rw', this.db.barcodes, this.db.products, async () => {
        if (data.barcodes && data.barcodes.length > 0) {
          await this.db.barcodes.bulkPut(data.barcodes);
        }
        if (data.products && data.products.length > 0) {
          await this.db.products.bulkPut(data.products);
        }
      });
      await this.loadAllFromDexie();
    }

    return {
      productsCount: data.products ? data.products.length : 0,
      variantsCount: data.barcodes ? data.barcodes.length : 0
    };
  }
}

// Global Singleton Instance
window.catalogManager = new CatalogManager();
window.barcodeTranslator = window.catalogManager;
