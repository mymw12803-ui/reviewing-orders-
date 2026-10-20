/**
 * Khiam Store - Production Warehouse Barcode Engine & Packing System
 * Features:
 * - Direct Fail-Safe Barcode Matching: Bosta tracking -> Operix CSV -> SKU polybag matching
 * - Global Hardware Barcode Listener with Auto Arabic Keyboard Corrector & 600ms Debounce Guard
 * - High-Volume Warehouse Audio Boost (2.5x gain + DynamicsCompressorNode)
 * - Natural Arabic Voice Guidance (Microsoft Salma/Shakir Natural -> Google -> ar-EG/ar-SA)
 * - Size Mismatch Detection & Alerting
 * - "Lost Item" Finder Mode (وضع استعلام عن الصنف التائه)
 * - Bosta Courier Handover Manifest Printing
 * - Background Auto-Sync Event Listener
 */

class KhiamWarehouseApp {
  constructor() {
    this.orders = [];
    this.ordersMap = new Map();
    this.activeOrder = null;
    this.completedHistory = this.loadHistory();
    this.pdfNotesMap = new Map();

    // Mode flags
    this.isLookupMode = false;

    // Scan buffer & debounce guard
    this.scanBuffer = '';
    this.lastProcessedCode = '';
    this.lastProcessedTime = 0;
    this.scannerTimeout = null;

    this.dom = {};
    this.initElements();
    this.bindEvents();
    this.renderStats();
    this.renderHistory();
    this.initCatalogIntegration();
    this.checkIncomingOperixBatch();
  }

  // ----------------------------------------------------
  // 1. Element Binding
  // ----------------------------------------------------
  initElements() {
    const ids = [
      'flashOverlay', 'scannerStatusBadge', 'scannerStatusText',
      'loadedOrdersCount', 'completedOrdersTodayCount', 'toggleSoundBtn',
      'soundIconOn', 'soundIconOff', 'toggleVoiceBtn', 'voiceStatusIcon', 'voiceStatusText',
      'printManifestBtn', 'openHistoryBtn', 'toastContainer', 'toastContent',
      'csvFileInput', 'csvFileName', 'manualScanForm', 'manualBarcodeInput',
      'lastScanHud', 'lastScannedCodeDisplay', 'lastScanTypeBadge', 'lastScanMessage',
      'noOrderState', 'activeOrderContainer', 'exchangeBadge', 'orderCompleteBanner',
      'nextOrderBtn', 'orderIdDisplay', 'orderTrackingDisplay', 'customerNameDisplay',
      'customerPhoneDisplay', 'shippingCompanyDisplay', 'pickingRefDisplay',
      'scannedTotalDisplay', 'requiredTotalDisplay', 'percentBadge', 'progressText',
      'orderProgressBar', 'productTypesCount', 'productCardsGrid', 'historyModal',
      'closeHistoryBtn', 'clearHistoryBtn', 'exportHistoryCsvBtn', 'historyTableBody',
      'emptyHistoryState', 'openCatalogModalBtn', 'closeCatalogModalBtn', 'catalogModal',
      'modalProductsCount', 'modalVariantsCount', 'modalLastSyncText', 'shopifyDomainInput',
      'startSyncCatalogBtn', 'exportCatalogJsonBtn', 'importCatalogJsonInput',
      'syncProgressContainer', 'syncProgressStatus', 'syncProgressPage', 'syncProgressBar',
      'headerCatalogCount', 'autoSyncStatusText', 'imageLightboxModal', 'closeLightboxBtn',
      'lightboxImg', 'lightboxTitle', 'lightboxSku', 'lightboxMatchBadge', 'pdfFileInput',
      'bostaPdfNotesAlert', 'bostaPdfNotesText', 'pdfNotesCountBadge', 'pdfNotesCountNum',
      'compactTotalOrders', 'compactCompletedOrders', 'compactTotalOrdersDenom',
      'compactRemainingOrders', 'openRemainingBtn', 'quickSearchInput', 'quickSearchResults',
      'remainingOrdersModal', 'closeRemainingModalBtn', 'remainingFilterInput',
      'remainingTableBody', 'emptyRemainingState', 'toggleLookupModeBtn',
      'lookupModeBtnText', 'productLookupModal', 'closeLookupModalBtn',
      'lookupProductImg', 'lookupProductTitle', 'lookupProductSku', 'lookupMatchLevel',
      'lookupBadges', 'lookupOrdersList',
      // Print elements
      'printManifestContainer', 'printDate', 'printBatchRef', 'printTotalShipments',
      'printCompletedShipments', 'printTotalPieces', 'printManifestTableBody'
    ];

    ids.forEach(id => {
      this.dom[id] = document.getElementById(id);
    });
  }

  // ----------------------------------------------------
  // 2. Auto Arabic Keyboard Corrector (100% QWERTY Mapping)
  // ----------------------------------------------------
  transliterateArabicString(str) {
    if (!str) return '';
    const map = {
      // Row 1
      'ذ': '`', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5',
      '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٠': '0', 'ـ': '-',
      // Row 2
      'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y',
      'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']',
      // Row 3
      'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h',
      'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': '\'',
      // Row 4
      'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'لا': 'b', 'لآ': 'b', 'لأ': 'b', 'لإ': 'b',
      'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
      // Uppercase shift
      'أ': 'h', 'إ': 'h', 'آ': 'h'
    };

    let normalized = str.replace(/لا/g, 'b');
    let result = '';
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      result += map[char] !== undefined ? map[char] : char;
    }
    return result;
  }

  mapEventKey(event) {
    if (event.code) {
      if (event.code.startsWith('Key')) {
        return event.code.substring(3).toLowerCase();
      }
      if (event.code.startsWith('Digit')) {
        return event.code.substring(5);
      }
      if (event.code.startsWith('Numpad') && !isNaN(event.code.substring(6))) {
        return event.code.substring(6);
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') return '-';
      if (event.code === 'Slash' || event.code === 'NumpadDivide') return '/';
      if (event.code === 'Period' || event.code === 'NumpadDecimal') return '.';
    }

    return this.transliterateArabicString(event.key);
  }

  // ----------------------------------------------------
  // 3. Events Binding & Debounce Guard
  // ----------------------------------------------------
  bindEvents() {
    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' && e.target.id !== 'manualBarcodeInput') return;
      if (tag === 'TEXTAREA') return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.scanBuffer.trim().length > 0) {
          const scanned = this.scanBuffer.trim();
          this.scanBuffer = '';
          this.processScannedInput(scanned);
        }
        return;
      }

      if (e.key.length === 1) {
        const char = this.mapEventKey(e);
        this.scanBuffer += char;

        clearTimeout(this.scannerTimeout);
        this.scannerTimeout = setTimeout(() => {
          this.scanBuffer = '';
        }, 300);
      }
    });

    // Manual input fallback
    this.dom.manualScanForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.dom.manualBarcodeInput.value.trim();
      if (val) {
        const clean = this.transliterateArabicString(val);
        this.processScannedInput(clean);
        this.dom.manualBarcodeInput.value = '';
      }
    });

    // CSV File
    this.dom.csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.parseCsvFile(file);
    });

    // PDF Bosta Notes File
    this.dom.pdfFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.parseBostaPdf(file);
    });

    // Sound toggle
    this.dom.toggleSoundBtn.addEventListener('click', () => {
      const muted = window.soundEngine.toggleSound();
      this.dom.soundIconOn.classList.toggle('hidden', muted);
      this.dom.soundIconOff.classList.toggle('hidden', !muted);
      this.showToast(muted ? 'تم كتم النغمات' : 'تم تفعيل نغمات النظام', muted ? 'warning' : 'success');
    });

    // Voice toggle
    this.dom.toggleVoiceBtn.addEventListener('click', () => {
      const voiceMuted = window.soundEngine.toggleVoice();
      if (voiceMuted) {
        this.dom.voiceStatusIcon.textContent = '🔇';
        this.dom.voiceStatusText.textContent = 'صوت: مكتوم';
        this.showToast('تم كتم التوجيه الصوتي العربي', 'warning');
      } else {
        this.dom.voiceStatusIcon.textContent = '🗣️';
        this.dom.voiceStatusText.textContent = 'صوت: مفعّل';
        this.showToast('تم تفعيل التوجيه الصوتي العربي', 'success');
        window.speakArabic('التوجيه الصوتي مفعّل');
      }
    });

    // Courier Handover Manifest Print
    this.dom.printManifestBtn.addEventListener('click', () => {
      this.generateAndPrintManifest();
    });

    // History Modal
    this.dom.openHistoryBtn.addEventListener('click', () => {
      this.renderHistory();
      this.dom.historyModal.classList.remove('hidden');
    });
    this.dom.closeHistoryBtn.addEventListener('click', () => this.dom.historyModal.classList.add('hidden'));
    this.dom.clearHistoryBtn.addEventListener('click', () => {
      if (confirm('هل أنت متأكد من مسح سجل تحضير الأوردرات اليوم؟')) {
        this.completedHistory = [];
        this.saveHistory();
        this.renderHistory();
        this.renderStats();
        this.showToast('تم مسح السجل بنجاح', 'info');
      }
    });
    this.dom.exportHistoryCsvBtn.addEventListener('click', () => this.exportHistoryCsv());

    // Next Order
    this.dom.nextOrderBtn.addEventListener('click', () => {
      this.activeOrder = null;
      this.renderActiveOrder();
      this.showToast('في انتظار مسح بوليصة الأوردر التالي', 'info');
    });

    // Catalog modal
    const openCat = () => {
      this.updateCatalogCounters();
      this.dom.catalogModal.classList.remove('hidden');
    };
    this.dom.openCatalogModalBtn.addEventListener('click', openCat);
    this.dom.closeCatalogModalBtn.addEventListener('click', () => this.dom.catalogModal.classList.add('hidden'));
    this.dom.startSyncCatalogBtn.addEventListener('click', () => this.runShopifyCatalogSync());
    this.dom.exportCatalogJsonBtn.addEventListener('click', () => {
      try {
        window.catalogManager.exportCatalogJson();
        this.showToast('تم تصدير ملف الكتالوج بنجاح!', 'success');
      } catch (e) {
        this.showToast(e.message, 'warning');
      }
    });
    this.dom.importCatalogJsonInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const res = await window.catalogManager.importCatalogJson(text);
        this.updateCatalogCounters();
        this.showToast(`تم استيراد ${res.productsCount} منتج و ${res.variantsCount} كود SKU بنجاح!`, 'success');
        if (this.activeOrder) this.renderProductCards();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Lightbox modal close
    this.dom.closeLightboxBtn.addEventListener('click', () => this.dom.imageLightboxModal.classList.add('hidden'));
    this.dom.imageLightboxModal.addEventListener('click', (e) => {
      if (e.target === this.dom.imageLightboxModal) this.dom.imageLightboxModal.classList.add('hidden');
    });

    // Remaining orders
    this.dom.openRemainingBtn.addEventListener('click', () => {
      this.renderRemainingOrders();
      this.dom.remainingOrdersModal.classList.remove('hidden');
    });
    this.dom.closeRemainingModalBtn.addEventListener('click', () => this.dom.remainingOrdersModal.classList.add('hidden'));
    this.dom.remainingFilterInput.addEventListener('input', (e) => this.renderRemainingOrders(e.target.value.trim()));

    // Quick search
    this.dom.quickSearchInput.addEventListener('input', (e) => this.handleQuickSearch(e.target.value.trim()));
    document.addEventListener('click', (e) => {
      if (!this.dom.quickSearchInput.contains(e.target) && !this.dom.quickSearchResults.contains(e.target)) {
        this.dom.quickSearchResults.classList.add('hidden');
      }
    });

    // "Lost Item" Finder Mode Toggle
    this.dom.toggleLookupModeBtn.addEventListener('click', () => {
      this.isLookupMode = !this.isLookupMode;
      if (this.isLookupMode) {
        this.dom.toggleLookupModeBtn.className = 'flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-lg shadow-cyan-900/40 ring-2 ring-cyan-400 animate-pulse';
        this.dom.lookupModeBtnText.textContent = 'وضع الصنف التائه نشط 🟢';
        this.showToast('🔍 تم تفعيل وضع الصنف التائه! امسح أي قطعة لمعرفة صاحبها.', 'info');
        window.speakArabic('وضع استعلام عن الصنف التائه نشط');
      } else {
        this.dom.toggleLookupModeBtn.className = 'flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-200 transition';
        this.dom.lookupModeBtnText.textContent = 'استعلام عن صنف تائه';
        this.showToast('تم الرجوع لوضع تحضير الشحنات العادي.', 'info');
      }
    });
    this.dom.closeLookupModalBtn.addEventListener('click', () => this.dom.productLookupModal.classList.add('hidden'));

    // Listen to background auto-sync events from catalog.js
    window.addEventListener('catalog-loaded', () => {
      this.updateCatalogCounters();
    });
    window.addEventListener('catalog-updated', () => {
      this.updateCatalogCounters();
      if (this.dom.autoSyncStatusText) {
        this.dom.autoSyncStatusText.textContent = 'تم التحديث التلقائي من شوبيفاي بنجاح';
      }
      if (this.activeOrder) this.renderProductCards();
    });
  }

  // ----------------------------------------------------
  // 4. Scan Input Router with 600ms Debounce Guard
  // ----------------------------------------------------
  processScannedInput(rawCode) {
    if (!rawCode) return;
    const clean = this.transliterateArabicString(rawCode).trim();
    if (!clean) return;

    // 600ms Debounce Guard against double hardware triggers
    const now = Date.now();
    if (clean.toLowerCase() === this.lastProcessedCode.toLowerCase() && (now - this.lastProcessedTime) < 600) {
      console.warn(`Scan debounce: duplicate trigger within 600ms for [${clean}] ignored.`);
      return;
    }
    this.lastProcessedCode = clean;
    this.lastProcessedTime = now;

    this.handleScannedCode(clean);
  }

  // ----------------------------------------------------
  // 5. Fail-Safe Barcode Resolution Engine (Bosta AWB vs SKU)
  // ----------------------------------------------------
  handleScannedCode(cleanCode) {
    const lower = cleanCode.toLowerCase();
    const normalizedTracking = this.normalizeTrackingBarcode(cleanCode).toLowerCase();

    this.dom.lastScannedCodeDisplay.textContent = cleanCode;

    // In "Lost Item" Finder Mode, search all orders
    if (this.isLookupMode) {
      this.handleLostItemQuery(cleanCode);
      return;
    }

    // STEP A: Check Bosta Waybill Barcode
    let matchedOrder = null;
    if (this.ordersMap.has(normalizedTracking)) {
      matchedOrder = this.ordersMap.get(normalizedTracking);
    } else if (this.ordersMap.has(lower)) {
      matchedOrder = this.ordersMap.get(lower);
    }

    if (matchedOrder) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-cyan-900/80 text-cyan-300 border border-cyan-700';
      this.dom.lastScanTypeBadge.textContent = 'بوليصة شحن';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = `تم فتح الأوردر: ${matchedOrder.orderId} (${matchedOrder.customerName})`;

      this.loadActiveOrder(matchedOrder);
      return;
    }

    // STEP B: Ensure an active order is loaded on screen
    if (!this.activeOrder) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
      this.dom.lastScanTypeBadge.textContent = 'خطأ';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = 'يرجى مسح بوليصة الشحن (Bosta Tracking) أولاً لفتح الأوردر!';

      this.triggerScreenFlash('red');
      window.soundEngine.playBuzzer();
      window.speakArabic('يرجى مسح بوليصة الشحن أولاً');
      this.showToast('⚠️ يرجى مسح بوليصة الشحن (Bosta Tracking) أولاً لفتح الأوردر!', 'error');
      return;
    }

    // STEP C: Product SKU Verification against active order
    this.verifyProductSku(cleanCode);
  }

  formatArabicCount(num) {
    if (num === 1) return 'قطعة واحدة';
    if (num === 2) return 'قطعتان';
    if (num >= 3 && num <= 10) return `${num} قطع`;
    return `${num} قطعة`;
  }

  loadActiveOrder(order) {
    this.activeOrder = order;

    // High-volume chirp
    window.soundEngine.playChirp();

    // Natural Arabic Voice prompt: "أوردر جديد: [X] قطع"
    const countPhrase = this.formatArabicCount(order.totalRequired);
    window.speakArabic(`أوردر جديد: ${countPhrase}`);

    this.renderActiveOrder();
    this.showToast(`تم فتح أوردر: ${order.orderId} (${countPhrase})`, 'info');
  }

  verifyProductSku(scannedSku) {
    const cleanSku = scannedSku.trim().toLowerCase();
    const items = this.activeOrder.items;

    // 1. Direct SKU match
    let matchedItem = items.find(i => i.sku === cleanSku);

    // 2. Size Mismatch Detector (Model/Color code matches, but size digit differs)
    if (!matchedItem) {
      const scannedPrefix = window.catalogManager.extractModelPrefix(cleanSku);
      const sizeMismatchItem = items.find(i => {
        const itemPrefix = window.catalogManager.extractModelPrefix(i.sku);
        return itemPrefix === scannedPrefix;
      });

      if (sizeMismatchItem) {
        this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-orange-900/90 text-orange-200 border border-orange-500';
        this.dom.lastScanTypeBadge.textContent = 'اختلاف مقاس';
        this.dom.lastScanMessage.textContent = `انتبه: الموديل صح ولكن المقاس مختلف!`;

        this.triggerCardFlash(sizeMismatchItem.sku, 'red');
        window.soundEngine.playSizeMismatch();

        const reqSize = sizeMismatchItem.details.size || sizeMismatchItem.originalSku.slice(-1) || 'المطلوب';
        const scannedSize = scannedSku.slice(-1) || 'الممسوح';

        window.speakArabic(`انتبه: الموديل صح ولكن المقاس مختلف! المطلوب مقاس ${reqSize}، والممسوح مقاس ${scannedSize}`);
        this.showToast(`⚠️ انتبه: الموديل صحيح ولكن المقاس مختلف! المطلوب [${reqSize}] والممسوح [${scannedSize}]`, 'warning');
        return;
      }
    }

    // 3. Wrong Item (Does not belong to order)
    if (!matchedItem) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
      this.dom.lastScanTypeBadge.textContent = 'صنف خاطئ';
      this.dom.lastScanMessage.textContent = `الكود [${scannedSku}] غير موجود في هذا الأوردر!`;

      this.triggerScreenFlash('red');
      window.soundEngine.playBuzzer();
      window.speakArabic('صنف خاطئ لا يخص هذا الأوردر');
      this.showToast(`⛔ صنف خاطئ: الكود [${scannedSku}] غير موجود في هذا الأوردر!`, 'error');
      return;
    }

    // 4. Item already completed
    if (matchedItem.scannedQty >= matchedItem.requiredQty) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-amber-900/80 text-amber-300 border border-amber-700';
      this.dom.lastScanTypeBadge.textContent = 'مكتمل مسبقاً';
      this.dom.lastScanMessage.textContent = `تم مسح العدد المطلوب بالكامل لهذا الصنف`;

      this.triggerCardFlash(matchedItem.sku, 'red');
      window.soundEngine.playBuzzer();
      window.speakArabic('تم مسح العدد المطلوب لهذا الصنف مسبقاً');
      this.showToast(`⚠️ تم مسح العدد المطلوب من هذا المنتج مسبقاً! (${matchedItem.requiredQty}/${matchedItem.requiredQty})`, 'warning');
      return;
    }

    // 5. Correct Item Scan
    matchedItem.scannedQty++;
    this.activeOrder.totalScanned++;

    if (matchedItem.scannedQty === matchedItem.requiredQty) {
      matchedItem.isCompleted = true;
    }

    const isAllComplete = this.activeOrder.totalScanned === this.activeOrder.totalRequired;
    const remainingInOrder = this.activeOrder.totalRequired - this.activeOrder.totalScanned;

    this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-emerald-900/80 text-emerald-300 border border-emerald-700';
    this.dom.lastScanTypeBadge.textContent = 'صنف صحيح';
    this.dom.lastScanMessage.textContent = `تم مسح: ${matchedItem.name} (${matchedItem.scannedQty}/${matchedItem.requiredQty})`;

    this.updateOrderProgress();
    this.renderSingleProductCard(matchedItem);

    if (isAllComplete) {
      this.activeOrder.isCompleted = true;
      this.activeOrder.status = 'READY_FOR_SHIPPING';
      this.triggerScreenFlash('green');
      window.soundEngine.playComplete();
      window.speakArabic('تم اكتمال الأوردر، أغلق الكيس');
      this.dom.orderCompleteBanner.classList.remove('hidden');
      this.recordOrderCompletion(this.activeOrder);
      this.showToast('🎉 تم اكتمال الأوردر بنجاح! جاهز للشحن (READY_FOR_SHIPPING)', 'success');
    } else {
      this.triggerCardFlash(matchedItem.sku, 'green');
      window.soundEngine.playDing();

      if (remainingInOrder === 1) {
        window.speakArabic('باقي قطعة واحدة');
      } else {
        window.speakArabic(`باقي ${this.formatArabicCount(remainingInOrder)}`);
      }

      this.showToast(`✅ تم مسح: ${matchedItem.name} (${matchedItem.scannedQty}/${matchedItem.requiredQty})`, 'success');
    }
  }

  // ----------------------------------------------------
  // 6. "Lost Item" Finder Mode (وضع استعلام عن الصنف التائه)
  // ----------------------------------------------------
  handleLostItemQuery(scannedSku) {
    const cleanSku = scannedSku.trim().toLowerCase();
    const details = window.catalogManager.getProductImageAndDetails(cleanSku, '');

    const matchingOrders = [];
    this.orders.forEach((ord, index) => {
      const found = ord.items.find(i => 
        i.sku === cleanSku || 
        window.catalogManager.extractModelPrefix(i.sku) === window.catalogManager.extractModelPrefix(cleanSku)
      );
      if (found) {
        matchingOrders.push({
          order: ord,
          orderIndex: index + 1,
          neededQty: found.requiredQty,
          scannedQty: found.scannedQty
        });
      }
    });

    this.dom.lookupProductImg.src = details.imageUrl;
    this.dom.lookupProductTitle.textContent = details.title || 'صنف غير مسجل';
    this.dom.lookupProductSku.textContent = `SKU: ${scannedSku}`;
    this.dom.lookupMatchLevel.textContent = details.matchLevel === 'exact' ? '✓ تطابق تام' : '🔍 صورة تقريبية';

    const parsed = this.parseProductDetails(details.title);
    let badgesHtml = '';
    if (parsed.color) badgesHtml += `<span class="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold px-2.5 py-0.5 rounded-lg">اللون: ${parsed.color}</span>`;
    if (parsed.size) badgesHtml += `<span class="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold px-2.5 py-0.5 rounded-lg">المقاس: ${parsed.size}</span>`;
    this.dom.lookupBadges.innerHTML = badgesHtml;

    const list = this.dom.lookupOrdersList;
    list.innerHTML = '';

    if (matchingOrders.length === 0) {
      list.innerHTML = '<div class="p-4 bg-slate-950 text-slate-400 text-xs text-center rounded-xl font-bold">هذا الصنف غير مطلوب في أي أوردر ضمن دفعة اليوم.</div>';
      window.speakArabic('هذا الصنف غير مطلوب في دفعة اليوم');
    } else {
      const topMatch = matchingOrders[0];
      window.speakArabic(`هذا الصنف مطلوب لأوردر العميل ${topMatch.order.customerName}`);

      matchingOrders.forEach(m => {
        const itemEl = document.createElement('div');
        itemEl.className = 'bg-slate-950 hover:bg-slate-800 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between cursor-pointer transition';
        itemEl.innerHTML = `
          <div>
            <div class="font-bold text-white text-xs">
              العميل: <span class="text-amber-300">${m.order.customerName}</span> (أوردر ${m.order.orderId})
            </div>
            <div class="text-[11px] text-slate-400 font-mono mt-0.5">
              بوليصة رقم: <span class="text-slate-200">${m.order.trackingNumber}</span> | تسلسل: #${m.orderIndex}
            </div>
          </div>
          <div class="flex items-center gap-2.5">
            <span class="text-xs font-bold text-emerald-400">${m.neededQty} قطع</span>
            <button class="bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs px-3 py-1 rounded-lg">
              فتح الأوردر 👈
            </button>
          </div>
        `;
        itemEl.addEventListener('click', () => {
          this.loadActiveOrder(m.order);
          this.dom.productLookupModal.classList.add('hidden');
        });
        list.appendChild(itemEl);
      });
    }

    this.dom.productLookupModal.classList.remove('hidden');
    window.soundEngine.playChirp();
  }

  // ----------------------------------------------------
  // 7. Bosta Courier Handover Manifest Generator (Print)
  // ----------------------------------------------------
  generateAndPrintManifest() {
    if (this.orders.length === 0) {
      this.showToast('لا توجد أوردرات في الشيت لطباعة كشف التسليم!', 'warning');
      return;
    }

    const todayStr = new Date().toLocaleDateString('ar-EG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    this.dom.printDate.textContent = todayStr + ' - ' + new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    
    const firstPickingRef = this.orders.find(o => o.pickingReference && o.pickingReference !== '---')?.pickingReference || 'REF-196';
    this.dom.printBatchRef.textContent = firstPickingRef;

    const totalShipments = this.orders.length;
    const completedShipments = this.orders.filter(o => o.isCompleted).length;
    const totalPieces = this.orders.reduce((sum, o) => sum + (o.totalRequired || 0), 0);

    this.dom.printTotalShipments.textContent = totalShipments;
    this.dom.printCompletedShipments.textContent = completedShipments;
    this.dom.printTotalPieces.textContent = totalPieces;

    const tbody = this.dom.printManifestTableBody;
    tbody.innerHTML = '';

    this.orders.forEach((ord, index) => {
      const tr = document.createElement('tr');
      const isDone = ord.isCompleted;
      tr.innerHTML = `
        <td style="text-align: center; font-weight: bold;">${index + 1}</td>
        <td style="font-family: monospace; font-weight: bold;">${ord.trackingNumber}</td>
        <td style="font-family: monospace;">${ord.orderId}</td>
        <td>${ord.customerName}</td>
        <td style="font-family: monospace;">${ord.primaryPhone}</td>
        <td style="text-align: center; font-weight: bold;">${ord.totalRequired}</td>
        <td style="text-align: center; font-weight: bold; color: ${isDone ? '#047857' : '#b45309'};">
          ${isDone ? 'جاهز للشحن' : 'قيد التحضير'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    window.print();
  }

  // ----------------------------------------------------
  // 8. PDF.js Bosta Special Notes Extractor
  // ----------------------------------------------------
  async parseBostaPdf(file) {
    if (!window.pdfjsLib) {
      this.showToast('مكتبة PDF.js غير متوفرة!', 'error');
      return;
    }

    this.showToast('جاري استخراج الملاحظات من بوالص PDF...', 'info');

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let count = 0;

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(i => i.str).join(' ');

        let tracking = '';
        const bostaMatch = text.match(/([A-Za-z]-\d{2}-\d{7,12})/);
        if (bostaMatch) {
          tracking = bostaMatch[1];
        } else {
          const digits = text.match(/\b(\d{8,12})\b/);
          if (digits) tracking = digits[1];
        }

        const noteMatch = text.match(/(?:ملاحظات|ملاحظة|Notes?)\s*[:|]?\s*([^\n\r]+?)(?:الراسل|المستلم|Receiver|Sender|Bosta|$)/i);
        if (noteMatch && tracking) {
          const cleanNote = noteMatch[1].replace(/^[:|\-\s]+/, '').trim();
          if (cleanNote.length > 2) {
            const normalized = this.normalizeTrackingBarcode(tracking);
            this.pdfNotesMap.set(normalized.toLowerCase(), cleanNote);
            this.pdfNotesMap.set(tracking.toLowerCase(), cleanNote);
            count++;
          }
        }
      }

      this.dom.pdfNotesCountBadge.classList.remove('hidden');
      this.dom.pdfNotesCountNum.textContent = this.pdfNotesMap.size;
      this.showToast(`تم ربط ${count} ملاحظة خاصة من ملف PDF بنجاح!`, 'success');
      window.soundEngine.playDing();

      if (this.activeOrder) this.renderActiveOrder();
    } catch (err) {
      console.error('PDF Parse Error:', err);
      this.showToast('فشل قراءة ملف PDF: ' + err.message, 'error');
      window.soundEngine.playBuzzer();
    }
  }

  // ----------------------------------------------------
  // 9. Operix Batch Receiver
  // ----------------------------------------------------
  checkIncomingOperixBatch() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('khiam_incoming_batch', (res) => {
        if (res && res.khiam_incoming_batch) {
          const batch = res.khiam_incoming_batch;
          this.showToast(`🚀 تم استلام دفعة أوبريكس (${batch.ordersCount} أوردر)!`, 'success');
          chrome.storage.local.remove('khiam_incoming_batch');
        }
      });
    }
  }

  // ----------------------------------------------------
  // 10. Compact Stats Bar & Search
  // ----------------------------------------------------
  renderStats() {
    const total = this.orders.length;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = this.completedHistory.filter(h => h.date === today).length;
    const remaining = Math.max(0, total - todayCount);

    this.dom.loadedOrdersCount.textContent = total;
    this.dom.completedOrdersTodayCount.textContent = todayCount;
    this.dom.compactTotalOrders.textContent = total;
    this.dom.compactCompletedOrders.textContent = todayCount;
    this.dom.compactTotalOrdersDenom.textContent = total;
    this.dom.compactRemainingOrders.textContent = remaining;
  }

  handleQuickSearch(query) {
    const resBox = this.dom.quickSearchResults;
    if (!query) {
      resBox.classList.add('hidden');
      return;
    }

    const q = query.toLowerCase();
    const matches = this.orders.filter(o => 
      o.orderId.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.primaryPhone.includes(q) ||
      o.trackingNumber.toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
      resBox.innerHTML = '<div class="p-3 text-slate-400 text-center">لا توجد أوردرات مطابقة</div>';
      resBox.classList.remove('hidden');
      return;
    }

    resBox.innerHTML = '';
    matches.forEach(o => {
      const itemEl = document.createElement('div');
      itemEl.className = 'p-2.5 hover:bg-slate-800 cursor-pointer flex items-center justify-between transition';
      itemEl.innerHTML = `
        <div>
          <span class="font-bold text-white">${o.orderId}</span>
          <span class="text-slate-400 text-[11px] mr-2">(${o.customerName})</span>
        </div>
        <div class="text-left font-mono text-[11px]">
          <span class="text-amber-400">${o.trackingNumber}</span>
          <span class="text-emerald-400 font-bold mr-2">${o.totalRequired} قطع</span>
        </div>
      `;
      itemEl.addEventListener('click', () => {
        this.loadActiveOrder(o);
        resBox.classList.add('hidden');
        this.dom.quickSearchInput.value = '';
      });
      resBox.appendChild(itemEl);
    });

    resBox.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // 11. Remaining Orders Drawer
  // ----------------------------------------------------
  renderRemainingOrders(filter = '') {
    const tbody = this.dom.remainingTableBody;
    tbody.innerHTML = '';

    const remaining = this.orders.filter(o => !o.isCompleted);
    const cleanFilter = filter ? filter.toLowerCase() : '';

    const filtered = remaining.filter(o => 
      !cleanFilter || 
      o.orderId.toLowerCase().includes(cleanFilter) ||
      o.customerName.toLowerCase().includes(cleanFilter) ||
      o.trackingNumber.toLowerCase().includes(cleanFilter)
    );

    if (filtered.length === 0) {
      this.dom.emptyRemainingState.classList.remove('hidden');
      return;
    }

    this.dom.emptyRemainingState.classList.add('hidden');

    filtered.forEach((o, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/50 transition';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-white">${o.orderId}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400 font-bold">${o.trackingNumber}</td>
        <td class="py-2.5 px-3 text-slate-300 truncate max-w-[150px]">${o.customerName}</td>
        <td class="py-2.5 px-3 font-mono text-emerald-400 font-bold">${o.totalRequired}</td>
        <td class="py-2.5 px-3 text-center">
          <button class="select-order-btn bg-slate-800 hover:bg-rose-600 text-white px-2.5 py-1 rounded-lg font-bold text-xs transition">
            فتح الأوردر 👈
          </button>
        </td>
      `;

      tr.querySelector('.select-order-btn').addEventListener('click', () => {
        this.loadActiveOrder(o);
        this.dom.remainingOrdersModal.classList.add('hidden');
      });

      tbody.appendChild(tr);
    });
  }

  // ----------------------------------------------------
  // 12. Active Order View & Large Product Cards
  // ----------------------------------------------------
  renderActiveOrder() {
    if (!this.activeOrder) {
      this.dom.noOrderState.classList.remove('hidden');
      this.dom.activeOrderContainer.classList.add('hidden');
      return;
    }

    const order = this.activeOrder;
    this.dom.noOrderState.classList.add('hidden');
    this.dom.activeOrderContainer.classList.remove('hidden');

    if (order.isExchange) {
      this.dom.exchangeBadge.classList.remove('hidden');
    } else {
      this.dom.exchangeBadge.classList.add('hidden');
    }

    const pdfNote = this.pdfNotesMap.get(order.normalizedTracking.toLowerCase()) || 
                    this.pdfNotesMap.get((order.trackingNumber || '').toLowerCase());

    if (pdfNote) {
      this.dom.bostaPdfNotesAlert.classList.remove('hidden');
      this.dom.bostaPdfNotesText.textContent = pdfNote;
    } else {
      this.dom.bostaPdfNotesAlert.classList.add('hidden');
    }

    if (order.isCompleted) {
      this.dom.orderCompleteBanner.classList.remove('hidden');
    } else {
      this.dom.orderCompleteBanner.classList.add('hidden');
    }

    this.dom.orderIdDisplay.textContent = order.orderId;
    this.dom.orderTrackingDisplay.textContent = order.trackingNumber;
    this.dom.customerNameDisplay.textContent = order.customerName;

    let phoneStr = `📞 ${order.primaryPhone}`;
    if (order.secondaryPhone && order.secondaryPhone !== '---') {
      phoneStr += ` | 📞 ${order.secondaryPhone}`;
    }
    this.dom.customerPhoneDisplay.innerHTML = phoneStr;

    this.dom.shippingCompanyDisplay.textContent = order.shippingCompany;
    this.dom.pickingRefDisplay.innerHTML = `<span class="text-slate-400">المرجع:</span> <span class="font-mono text-slate-200">${order.pickingReference}</span>`;
    this.dom.productTypesCount.textContent = `${order.items.length} أصناف`;

    this.updateOrderProgress();
    this.renderProductCards();
  }

  updateOrderProgress() {
    if (!this.activeOrder) return;
    const scanned = this.activeOrder.totalScanned;
    const required = this.activeOrder.totalRequired;
    const pct = required > 0 ? Math.round((scanned / required) * 100) : 0;

    this.dom.scannedTotalDisplay.textContent = scanned;
    this.dom.requiredTotalDisplay.textContent = required;
    this.dom.percentBadge.textContent = `${pct}%`;
    this.dom.progressText.textContent = `${scanned} من ${required} قطع`;
    this.dom.orderProgressBar.style.width = `${pct}%`;
  }

  renderProductCards() {
    const grid = this.dom.productCardsGrid;
    grid.innerHTML = '';

    for (const item of this.activeOrder.items) {
      const matchDetails = window.catalogManager.getProductImageAndDetails(item.sku, item.name);
      item.imageUrl = matchDetails.imageUrl;
      item.matchLevel = matchDetails.matchLevel;

      const card = document.createElement('div');
      card.id = `product_card_${item.sku}`;
      card.className = this.getCardClasses(item);
      card.innerHTML = this.generateCardHtml(item);

      const imgContainer = card.querySelector('.zoomable-img-box');
      if (imgContainer) {
        imgContainer.addEventListener('click', () => this.openImageLightbox(item));
      }

      grid.appendChild(card);
    }
  }

  renderSingleProductCard(item) {
    const card = document.getElementById(`product_card_${item.sku}`);
    if (card) {
      card.className = this.getCardClasses(item);
      card.innerHTML = this.generateCardHtml(item);

      const imgContainer = card.querySelector('.zoomable-img-box');
      if (imgContainer) {
        imgContainer.addEventListener('click', () => this.openImageLightbox(item));
      }
    }
  }

  getCardClasses(item) {
    const isDone = item.scannedQty >= item.requiredQty;
    const isPartial = item.scannedQty > 0 && !isDone;

    const base = 'bg-slate-800/90 border rounded-3xl p-5 transition-all duration-300 flex flex-col justify-between shadow-xl relative overflow-hidden';
    if (isDone) {
      return `${base} border-emerald-500 bg-emerald-950/20 ring-2 ring-emerald-500/50`;
    }
    if (isPartial) {
      return `${base} border-amber-500 bg-amber-950/20 ring-1 ring-amber-500/50`;
    }
    return `${base} border-slate-700/80 hover:border-slate-600`;
  }

  generateCardHtml(item) {
    const isDone = item.scannedQty >= item.requiredQty;
    const isPartial = item.scannedQty > 0 && !isDone;
    const details = item.details || this.parseProductDetails(item.name);
    const pct = item.requiredQty > 0 ? Math.round((item.scannedQty / item.requiredQty) * 100) : 0;

    let matchTag = '';
    if (item.matchLevel === 'exact') {
      matchTag = '<span class="bg-emerald-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow">✓ صورة دقيقة</span>';
    } else if (item.matchLevel === 'prefix') {
      matchTag = '<span class="bg-indigo-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow">🔍 تطابق الموديل واللون</span>';
    } else if (item.matchLevel === 'title') {
      matchTag = '<span class="bg-amber-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow">📝 تطابق الاسم العربي</span>';
    }

    return `
      <div>
        <div class="zoomable-img-box relative w-full h-64 bg-slate-950 rounded-2xl overflow-hidden border border-slate-700/80 flex items-center justify-center cursor-pointer group shadow-inner mb-4">
          <img 
            id="img_${item.sku}" 
            src="${item.imageUrl}" 
            alt="${item.name}" 
            class="w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />

          <div class="absolute bottom-2 left-2 bg-slate-900/80 text-white text-xs px-2 py-1 rounded-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
            <span>🔍</span>
            <span>تكبير</span>
          </div>

          <div class="absolute top-2 right-2">
            ${matchTag}
          </div>

          ${isDone ? `
            <div class="absolute inset-0 bg-emerald-950/75 backdrop-blur-[2px] flex flex-col items-center justify-center text-white animate-bounce-short">
              <span class="text-6xl mb-1">✅</span>
              <span class="text-lg font-black tracking-wide">تم التجهيز بالكامل</span>
            </div>
          ` : ''}
        </div>

        <div class="space-y-2 mb-4">
          <h4 class="text-base font-black text-white leading-snug line-clamp-2" title="${item.name}">
            ${details.model || item.name}
          </h4>

          <div class="flex flex-wrap items-center gap-2">
            ${details.color ? `
              <span class="inline-flex items-center gap-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold px-3 py-1 rounded-xl">
                <span class="w-2 h-2 rounded-full bg-rose-400"></span>
                <span>اللون: ${details.color}</span>
              </span>
            ` : ''}

            ${details.size ? `
              <span class="inline-flex items-center gap-1.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold px-3 py-1 rounded-xl">
                <span>المقاس: ${details.size}</span>
              </span>
            ` : ''}
          </div>

          <div class="flex items-center justify-between text-xs bg-slate-900/80 border border-slate-700/80 px-3 py-1.5 rounded-xl font-mono">
            <span class="text-slate-400 font-bold">SKU:</span>
            <span class="text-amber-300 font-black tracking-wider">${item.originalSku}</span>
          </div>
        </div>
      </div>

      <div class="pt-3 border-t border-slate-700/60 space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400 font-bold">القطع الممسوحة:</span>
            <span class="font-mono text-xl font-black ${isDone ? 'text-emerald-400' : (isPartial ? 'text-amber-400' : 'text-slate-300')}">
              ${item.scannedQty}
            </span>
            <span class="text-slate-500 font-bold text-lg">/</span>
            <span class="font-mono text-xl font-black text-white">
              ${item.requiredQty}
            </span>
          </div>

          <div>
            ${isDone ? `
              <span class="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-black px-3 py-1 rounded-full shadow-sm">
                <span>جاهز 100%</span>
                <span>✓</span>
              </span>
            ` : (isPartial ? `
              <span class="inline-flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold px-3 py-1 rounded-full">
                <span>متبقي ${item.requiredQty - item.scannedQty}</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1 bg-slate-700/60 text-slate-400 border border-slate-600/60 text-xs font-medium px-3 py-1 rounded-full">
                <span>في الانتظار</span>
              </span>
            `)}
          </div>
        </div>

        <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700">
          <div class="h-full rounded-full transition-all duration-300 ${isDone ? 'bg-emerald-500' : 'bg-amber-500'}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }

  openImageLightbox(item) {
    this.dom.lightboxImg.src = item.imageUrl;
    this.dom.lightboxTitle.textContent = item.name;
    this.dom.lightboxSku.textContent = `SKU: ${item.originalSku}`;
    this.dom.lightboxMatchBadge.textContent = item.matchLevel === 'exact' ? 'تطابق تام' : (item.matchLevel === 'prefix' ? 'تطابق موديل' : 'صورة مقترحة');
    this.dom.imageLightboxModal.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // 13. Visual Feedback
  // ----------------------------------------------------
  triggerScreenFlash(color = 'red') {
    const overlay = this.dom.flashOverlay;
    overlay.className = color === 'red'
      ? 'fixed inset-0 pointer-events-none z-50 flash-red-active'
      : 'fixed inset-0 pointer-events-none z-50 flash-green-active';

    setTimeout(() => {
      overlay.className = 'fixed inset-0 pointer-events-none z-50 transition-colors duration-200';
    }, 400);
  }

  triggerCardFlash(sku, color = 'green') {
    const card = document.getElementById(`product_card_${sku}`);
    if (!card) return;

    const ring = color === 'green' ? 'ring-emerald-500' : 'ring-rose-500';
    const bg = color === 'green' ? 'bg-emerald-950/40' : 'bg-rose-950/40';

    card.classList.add('ring-4', ring, bg);
    setTimeout(() => {
      card.classList.remove('ring-4', ring, bg);
    }, 500);
  }

  showToast(message, type = 'info') {
    const container = this.dom.toastContainer;
    const content = this.dom.toastContent;

    let bg = 'bg-slate-800 border-slate-700 text-white';
    let icon = 'ℹ️';

    if (type === 'success') {
      bg = 'bg-emerald-900/95 border-emerald-600 text-emerald-100 shadow-emerald-950/60';
      icon = '✅';
    } else if (type === 'error') {
      bg = 'bg-rose-950/95 border-rose-600 text-rose-100 shadow-rose-950/60';
      icon = '⛔';
    } else if (type === 'warning') {
      bg = 'bg-amber-950/95 border-amber-600 text-amber-100 shadow-amber-950/60';
      icon = '⚠️';
    }

    content.className = `pointer-events-auto rounded-2xl p-4 shadow-2xl flex items-center gap-3 border text-sm font-bold ${bg}`;
    content.innerHTML = `<span>${icon}</span><span class="flex-1">${message}</span>`;

    container.classList.remove('opacity-0', 'translate-y-[-20px]');
    container.classList.add('opacity-100', 'translate-y-0');

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      container.classList.remove('opacity-100', 'translate-y-0');
      container.classList.add('opacity-0', 'translate-y-[-20px]');
    }, 3200);
  }

  // ----------------------------------------------------
  // 14. History Storage & CSV Export
  // ----------------------------------------------------
  recordOrderCompletion(order) {
    const record = {
      orderId: order.orderId,
      trackingNumber: order.trackingNumber,
      customerName: order.customerName,
      totalItems: order.totalRequired,
      completedAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Date().toISOString().split('T')[0]
    };

    this.completedHistory = this.completedHistory.filter(h => h.orderId !== order.orderId);
    this.completedHistory.unshift(record);

    this.saveHistory();
    this.renderStats();
    this.renderHistory();
  }

  loadHistory() {
    try {
      const data = localStorage.getItem('khiam_completed_orders_history');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('khiam_completed_orders_history', JSON.stringify(this.completedHistory));
    } catch (e) {}
  }

  renderHistory() {
    const tbody = this.dom.historyTableBody;
    tbody.innerHTML = '';

    if (this.completedHistory.length === 0) {
      this.dom.emptyHistoryState.classList.remove('hidden');
      return;
    }

    this.dom.emptyHistoryState.classList.add('hidden');

    this.completedHistory.forEach((rec, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/40 transition';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-white">${rec.orderId}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400 font-bold">${rec.trackingNumber}</td>
        <td class="py-2.5 px-3 text-slate-300 truncate max-w-[150px]">${rec.customerName}</td>
        <td class="py-2.5 px-3 font-mono text-emerald-400 font-bold">${rec.totalItems}</td>
        <td class="py-2.5 px-3 text-slate-400 font-mono">${rec.completedAt}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  exportHistoryCsv() {
    if (this.completedHistory.length === 0) {
      this.showToast('لا توجد بيانات لتصديرها!', 'warning');
      return;
    }

    const headers = ['Order ID', 'Tracking Number', 'Customer Name', 'Total Items', 'Completed At', 'Date'];
    const rows = this.completedHistory.map(h => [
      `"${h.orderId}"`,
      `"${h.trackingNumber}"`,
      `"${h.customerName.replace(/"/g, '""')}"`,
      h.totalItems,
      `"${h.completedAt}"`,
      `"${h.date}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `khiam-prepared-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('تم تصدير ملف CSV بنجاح', 'success');
  }

  // ----------------------------------------------------
  // 15. Catalog Sync & Preload
  // ----------------------------------------------------
  async initCatalogIntegration() {
    setTimeout(() => {
      this.updateCatalogCounters();
    }, 600);
  }

  updateCatalogCounters() {
    const stats = window.catalogManager.stats || {};
    const totalVariants = stats.totalVariants || window.catalogManager.memoryVariants.size || 0;
    const totalProducts = stats.totalProducts || window.catalogManager.productsList.length || 0;

    this.dom.headerCatalogCount.textContent = totalVariants;
    this.dom.modalProductsCount.textContent = totalProducts;
    this.dom.modalVariantsCount.textContent = totalVariants;

    if (stats.lastSync) {
      const d = new Date(stats.lastSync);
      this.dom.modalLastSyncText.textContent = d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    } else {
      this.dom.modalLastSyncText.textContent = totalVariants > 0 ? 'مخزن محلياً (Dexie)' : 'لم تتم بعد';
    }
  }

  async runShopifyCatalogSync() {
    const domain = this.dom.shopifyDomainInput.value.trim() || 'khiam.store';
    window.catalogManager.setShopDomain(domain);

    const progressBox = this.dom.syncProgressContainer;
    const progressStatus = this.dom.syncProgressStatus;
    const progressPage = this.dom.syncProgressPage;
    const progressBar = this.dom.syncProgressBar;
    const syncBtn = this.dom.startSyncCatalogBtn;

    progressBox.classList.remove('hidden');
    progressBar.style.width = '15%';
    syncBtn.disabled = true;
    syncBtn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
      const result = await window.catalogManager.syncShopifyCatalog((prog) => {
        progressStatus.textContent = prog.message;
        progressPage.textContent = `صفحة ${prog.page}`;
        progressBar.style.width = `${Math.min(95, prog.page * 15)}%`;
      });

      progressBar.style.width = '100%';
      progressStatus.textContent = `اكتملت المزامنة بنجاح! تم حفظ ${result.productsCount} منتج و ${result.variantsCount} كود SKU.`;
      this.updateCatalogCounters();
      this.showToast(`تمت مزامنة ${result.variantsCount} كود SKU بنجاح!`, 'success');
      window.soundEngine.playDing();

      if (this.activeOrder) this.renderProductCards();
    } catch (err) {
      console.error('Catalog sync failed:', err);
      progressStatus.textContent = 'حدث خطأ: ' + err.message;
      this.showToast('فشل سحب الكتالوج: ' + err.message, 'error');
      window.soundEngine.playBuzzer();
    } finally {
      syncBtn.disabled = false;
      syncBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  parseProductDetails(rawFullName) {
    if (!rawFullName) return { model: 'منتج غير مسمى', color: '', size: '' };
    let model = rawFullName.trim();
    let color = '';
    let size = '';

    if (model.includes('-') && model.includes('/')) {
      const dashParts = model.split('-');
      model = dashParts[0].trim();
      const afterDash = dashParts.slice(1).join('-').trim();
      const slashParts = afterDash.split('/');
      color = slashParts[0].trim();
      size = slashParts.slice(1).join('/').trim();
    } else if (model.includes('-')) {
      const parts = model.split('-');
      model = parts[0].trim();
      color = parts.slice(1).join('-').trim();
    } else if (model.includes('/')) {
      const parts = model.split('/');
      model = parts[0].trim();
      size = parts.slice(1).join('/').trim();
    }

    return { model, color, size };
  }

  // ----------------------------------------------------
  // 16. CSV File Parsing & Bosta Normalization
  // ----------------------------------------------------
  parseCsvFile(file) {
    this.dom.csvFileName.textContent = file.name;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        this.processParsedCsv(results.data);
      },
      error: (err) => {
        console.error('CSV Parse Error:', err);
        this.showToast('خطأ أثناء قراءة ملف CSV!', 'error');
        window.soundEngine.playBuzzer();
      }
    });
  }

  async processParsedCsv(rows) {
    if (!rows || rows.length === 0) {
      this.showToast('الملف لا يحتوي على أي أوردرات!', 'warning');
      return;
    }

    this.orders = [];
    this.ordersMap.clear();

    rows.forEach((row, index) => {
      const getCol = (names) => {
        for (const name of names) {
          for (const key of Object.keys(row)) {
            if (key.trim().toLowerCase() === name.toLowerCase()) {
              return row[key] ? row[key].trim() : '';
            }
          }
        }
        return '';
      };

      const orderId = getCol(['Order ID', 'Order Number', 'OrderID', 'رقم الأوردر']);
      const customerName = getCol(['Customer Name', 'Customer', 'العميل', 'اسم العميل']);
      const primaryPhone = getCol(['Primary Phone Number', 'Phone', 'Phone 1', 'الهاتف']);
      const secondaryPhone = getCol(['Secondary Phone Number', 'Phone 2', 'هاتف 2']);
      const productsRaw = getCol(['Products', 'المنتجات', 'Items']);
      const skusRaw = getCol(['SKUs', 'SKU', 'الأكواد']);
      const pickingRef = getCol(['Picking Reference', 'PickingRef', 'المرجع']);
      const shippingCo = getCol(['Shipping Company', 'Carrier', 'شركة الشحن']) || 'Bosta';
      const trackingNumber = getCol(['Tracking Number', 'Tracking', 'Waybill', 'رقم التتبع', 'رقم البوليصة']);

      if (!orderId && !trackingNumber && !productsRaw) return;

      const items = this.parseProductLines(productsRaw, skusRaw);
      const totalRequired = items.reduce((sum, item) => sum + item.requiredQty, 0);
      const normalizedTracking = this.normalizeTrackingBarcode(trackingNumber);

      const orderObj = {
        id: `ord_${index}_${orderId || trackingNumber}`,
        orderId: orderId || `ORD-${index + 1}`,
        isExchange: (orderId || '').toUpperCase().startsWith('EXC-'),
        customerName: customerName || 'عميل غير مسجل',
        primaryPhone: primaryPhone || '---',
        secondaryPhone: secondaryPhone || '',
        productsRaw,
        skusRaw,
        pickingReference: pickingRef || '---',
        shippingCompany: shippingCo,
        trackingNumber: trackingNumber || '---',
        normalizedTracking: normalizedTracking,
        items: items,
        totalRequired: totalRequired,
        totalScanned: 0,
        isCompleted: false,
        status: 'PENDING'
      };

      this.orders.push(orderObj);

      if (orderObj.normalizedTracking) {
        this.ordersMap.set(orderObj.normalizedTracking.toLowerCase(), orderObj);
      }
      if (orderObj.trackingNumber && orderObj.trackingNumber !== '---') {
        this.ordersMap.set(orderObj.trackingNumber.toLowerCase(), orderObj);
      }
      if (orderObj.orderId) {
        this.ordersMap.set(orderObj.orderId.toLowerCase(), orderObj);
        if (orderObj.isExchange) {
          this.ordersMap.set(orderObj.orderId.replace(/^EXC-/i, '').toLowerCase(), orderObj);
        }
      }
    });

    this.renderStats();
    this.showToast(`تم تحميل ${this.orders.length} أوردر بنجاح! جاري تحضير الصور...`, 'success');
    window.soundEngine.playChirp();
    window.speakArabic(`تم تحميل ${this.orders.length} أوردر، جاهز للفحص`);

    const preloaded = await window.catalogManager.preloadImagesForOrders(this.orders);
    if (preloaded > 0) {
      this.showToast(`⚡ تم تحميل ${preloaded} صورة منتج في الذاكرة لتظهر بـ 0ms!`, 'success');
    }
  }

  parseProductLines(productsRaw, skusFallbackRaw) {
    const items = [];
    if (!productsRaw) return items;

    const lines = productsRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    lines.forEach(line => {
      const match = line.match(/^\[(\d+)\]\s*(.*?)\s*\|\s*(.*)$/);
      if (match) {
        const qty = parseInt(match[1], 10) || 1;
        const fullName = match[2].trim();
        const sku = match[3].trim();
        const details = this.parseProductDetails(fullName);

        items.push({
          sku: sku.toLowerCase(),
          originalSku: sku,
          name: fullName,
          details: details,
          requiredQty: qty,
          scannedQty: 0,
          isCompleted: false,
          imageUrl: null,
          matchLevel: 'fallback'
        });
      } else {
        const qtyMatch = line.match(/^\[(\d+)\]\s*(.*)$/);
        const qty = qtyMatch ? (parseInt(qtyMatch[1], 10) || 1) : 1;
        const fullName = qtyMatch ? qtyMatch[2].trim() : line;
        const details = this.parseProductDetails(fullName);

        items.push({
          sku: fullName.toLowerCase(),
          originalSku: fullName,
          name: fullName,
          details: details,
          requiredQty: qty,
          scannedQty: 0,
          isCompleted: false,
          imageUrl: null,
          matchLevel: 'fallback'
        });
      }
    });

    return items;
  }

  normalizeTrackingBarcode(input) {
    if (!input) return '';
    let clean = input.trim();

    const bostaPrefixMatch = clean.match(/^[A-Za-z]-\d{2}-(\d+)$/);
    if (bostaPrefixMatch) return bostaPrefixMatch[1];

    const dashedMatch = clean.match(/^[A-Za-z0-9]+-[A-Za-z0-9]+-(\d{6,14})$/);
    if (dashedMatch) return dashedMatch[1];

    const pureDigitsMatch = clean.match(/^(\d{7,14})$/);
    if (pureDigitsMatch) return pureDigitsMatch[1];

    return clean.replace(/\s+/g, '');
  }
}

// Instantiate on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new KhiamWarehouseApp();
});
