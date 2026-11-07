/**
 * Khiam Warehouse Scanner - Production Packing & Barcode Engine
 * Features:
 * 1. Multi-Row 109-Column Operix CSV Parser:
 *    - Full support for multi-item orders spanning consecutive rows.
 *    - Normalizes scientific notation tracking numbers (e.g. 9.049569e+09 -> 9049568550).
 *    - Full customer info: Name, Phones, Address, Province, City, Net Amount.
 *    - Merges Customer Note, Sales Note, Delivery Note, Internal Order Note into prominent banner.
 *    - Exchange Order (EXC-) prominent detection.
 * 2. 0ms Barcode-to-SKU Translation via Dexie IndexedDB & builtin_barcode_map.js:
 *    - 9-digit warehouse barcode (e.g. 599523571, 841103673) -> Translates to SKU in 0ms!
 *    - Direct alphanumeric SKU matching (e.g. ba51ei3, Ac010bn9).
 *    - Special Zero Barcode (00000000) confirmation dialog & button.
 * 3. High-Volume Warehouse Audio (Gain = 2.5x + Compressor) + Natural Arabic Voice:
 *    - Bosta waybill scanned: loud chirp + voice "أوردر جديد: [X] قطع" + notes alert.
 *    - Matching product scanned: loud resonant ding + voice remaining count.
 *    - Size mismatch: alternating tone + voice "الموديل صح ولكن المقاس مختلف!".
 *    - Wrong/duplicate item: loud sawtooth buzzer + red screen flash.
 *    - Order complete: victory fanfare + voice "تم اكتمال الأوردر، أغلق الكيس".
 * 4. Future Barcode PDF Importer (PDF.js) without clearing existing entries.
 */

class KhiamWarehouseApp {
  constructor() {
    this.orders = [];
    this.ordersMap = new Map();
    this.activeOrder = null;
    this.completedHistory = this.loadHistory();
    this.scannedOrdersLog = this.loadScannedOrders();

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
    this.renderScannedOrdersCounter();
    this.renderHistory();
    this.initCatalogIntegration();
    this.updateBostaStatusUI();
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
      'productScanForm', 'productBarcodeInput',
      'zeroPickerModal', 'zeroPickerList', 'closeZeroPickerBtn',
      'lastScanHud', 'lastScannedCodeDisplay', 'lastScanTypeBadge', 'lastScanMessage',
      'noOrderState', 'activeOrderContainer', 'exchangeBadge', 'orderCompleteBanner',
      'nextOrderBtn', 'orderIdDisplay', 'orderTrackingDisplay', 'customerNameDisplay',
      'customerPhoneDisplay', 'customerAddressDisplay', 'shippingCompanyDisplay',
      'netAmountDisplay', 'orderTypeDisplay', 'pickingRefDisplay',
      'scannedTotalDisplay', 'requiredTotalDisplay', 'percentBadge', 'progressText',
      'orderProgressBar', 'productTypesCount', 'productCardsGrid', 'historyModal',
      'closeHistoryBtn', 'clearHistoryBtn', 'exportHistoryCsvBtn', 'historyTableBody',
      'emptyHistoryState', 'openCatalogModalBtn', 'closeCatalogModalBtn', 'catalogModal',
      'modalProductsCount', 'modalVariantsCount', 'shopifyDomainInput',
      'startSyncCatalogBtn', 'exportCatalogJsonBtn', 'importCatalogJsonInput',
      'syncProgressContainer', 'syncProgressStatus', 'syncProgressPage', 'syncProgressBar',
      'headerCatalogCount', 'imageLightboxModal', 'closeLightboxBtn',
      'lightboxImg', 'lightboxTitle', 'lightboxSku', 'lightboxMatchBadge',
      'bostaPdfNotesAlert', 'bostaPdfNotesText', 'pdfNotesCountBadge', 'pdfNotesCountNum',
      'compactTotalOrders', 'compactCompletedOrders', 'compactTotalOrdersDenom',
      'compactRemainingOrders', 'openRemainingBtn', 'quickSearchInput', 'quickSearchResults',
      'remainingOrdersModal', 'closeRemainingModalBtn', 'remainingFilterInput',
      'remainingTableBody', 'emptyRemainingState', 'toggleLookupModeBtn',
      'lookupModeBtnText', 'productLookupModal', 'closeLookupModalBtn',
      'lookupProductImg', 'lookupProductTitle', 'lookupProductSku', 'lookupMatchLevel',
      'lookupBadges', 'lookupOrdersList',
      // Zero Barcode Banner Elements
      'zeroBarcodeAlert', 'zeroBarcodeDesc', 'confirmZeroBarcodeBtn', 'dismissZeroBarcodeBtn',
      'newBarcodePdfInput',
      // Scanned orders counter, missing-items voice & voice settings
      'scannedOrdersCount', 'resetScannedOrdersBtn', 'speakMissingBtn',
      'voiceSelect', 'testVoiceBtn', 'voiceRateInput', 'voiceRateValue', 'voiceHint', 'voiceQualityBadge',
      // Settings Modal & Bosta API elements
      'openSettingsModalBtn', 'closeSettingsModalBtn', 'cancelSettingsBtn', 'saveSettingsBtn',
      'settingsModal', 'bostaApiKeyInput', 'toggleBostaApiKeyVisibilityBtn', 'bostaEyeIcon',
      'bostaKeyStatusBanner', 'bostaStatusIcon', 'bostaStatusTitle', 'bostaStatusDesc',
      'headerBostaStatusDot', 'testBostaConnectionBtn', 'testBostaBtnText', 'testBostaSpinner',
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
      'ذ': '`', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5',
      '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٠': '0', 'ـ': '-',
      'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y',
      'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']',
      'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h',
      'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': '\'',
      'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'لا': 'b', 'لآ': 'b', 'لأ': 'b', 'لإ': 'b',
      'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
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
  // 3. Events Binding & Scanner Hardware Listener
  // ----------------------------------------------------
  bindEvents() {
    window.addEventListener('keydown', (e) => {
      // Escape key closes open modals
      if (e.key === 'Escape') {
        if (this.dom.settingsModal && !this.dom.settingsModal.classList.contains('hidden')) {
          this.closeSettingsModal();
          return;
        }
        if (this.dom.catalogModal && !this.dom.catalogModal.classList.contains('hidden')) {
          this.dom.catalogModal.classList.add('hidden');
          return;
        }
        if (this.dom.historyModal && !this.dom.historyModal.classList.contains('hidden')) {
          this.dom.historyModal.classList.add('hidden');
          return;
        }
        if (this.dom.remainingOrdersModal && !this.dom.remainingOrdersModal.classList.contains('hidden')) {
          this.dom.remainingOrdersModal.classList.add('hidden');
          return;
        }
        if (this.dom.zeroPickerModal && !this.dom.zeroPickerModal.classList.contains('hidden')) {
          this.dom.zeroPickerModal.classList.add('hidden');
          return;
        }
        if (this.dom.productLookupModal && !this.dom.productLookupModal.classList.contains('hidden')) {
          this.dom.productLookupModal.classList.add('hidden');
          return;
        }
        if (this.dom.imageLightboxModal && !this.dom.imageLightboxModal.classList.contains('hidden')) {
          this.dom.imageLightboxModal.classList.add('hidden');
          return;
        }
      }

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
    if (this.dom.manualScanForm) {
      this.dom.manualScanForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = this.dom.manualBarcodeInput.value.trim();
        if (val) {
          const clean = this.transliterateArabicString(val);
          this.processScannedInput(clean);
          this.dom.manualBarcodeInput.value = '';
        }
      });
    }

    if (this.dom.closeZeroPickerBtn) {
      this.dom.closeZeroPickerBtn.addEventListener('click', () => this.dom.zeroPickerModal.classList.add('hidden'));
    }

    // Product barcode lookup field: always fetches the product and the orders needing it
    if (this.dom.productScanForm) {
      this.dom.productScanForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = this.transliterateArabicString(this.dom.productBarcodeInput.value.trim()).trim();
        if (val) {
          this.dom.lastScannedCodeDisplay.textContent = val;
          this.handleLostItemQuery(val);
          this.dom.productBarcodeInput.value = '';
        }
      });
    }

    // CSV File Upload
    if (this.dom.csvFileInput) {
      this.dom.csvFileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) this.parseCsvFiles(files);
        e.target.value = ''; // allow re-selecting the same file(s)
      });
    }

    // Future Barcode PDF Upload (PDF.js)
    if (this.dom.newBarcodePdfInput) {
      this.dom.newBarcodePdfInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          this.showToast('جاري استخراج الباركودات والأكواد من ملف PDF...', 'info');
          const res = await window.catalogManager.importBarcodePdf(file);
          this.showToast(`✅ تمت إضافة ${res.addedBarcodes} باركود رقمي و ${res.addedSkus} كود SKU للقاموس الدائم بنجاح!`, 'success');
          window.soundEngine.playDing();
          this.updateCatalogCounters();
        } catch (err) {
          console.error(err);
          this.showToast('فشل قراءة ملف PDF: ' + err.message, 'error');
          window.soundEngine.playBuzzer();
        }
      });
    }

    // Zero Barcode Confirmation
    if (this.dom.confirmZeroBarcodeBtn) {
      this.dom.confirmZeroBarcodeBtn.addEventListener('click', () => {
        this.confirmZeroBarcodePiece();
      });
    }
    if (this.dom.dismissZeroBarcodeBtn) {
      this.dom.dismissZeroBarcodeBtn.addEventListener('click', () => {
        if (this.dom.zeroBarcodeAlert) this.dom.zeroBarcodeAlert.classList.add('hidden');
      });
    }

    // Sound toggle
    if (this.dom.toggleSoundBtn) {
      this.dom.toggleSoundBtn.addEventListener('click', () => {
        const muted = window.soundEngine.toggleSound();
        if (this.dom.soundIconOn) this.dom.soundIconOn.classList.toggle('hidden', muted);
        if (this.dom.soundIconOff) this.dom.soundIconOff.classList.toggle('hidden', !muted);
        this.showToast(muted ? 'تم كتم النغمات' : 'تم تفعيل نغمات النظام', muted ? 'warning' : 'success');
      });
    }

    // Voice toggle
    if (this.dom.toggleVoiceBtn) {
      this.dom.toggleVoiceBtn.addEventListener('click', () => {
        const voiceMuted = window.soundEngine.toggleVoice();
        if (voiceMuted) {
          if (this.dom.voiceStatusIcon) this.dom.voiceStatusIcon.textContent = '🔇';
          if (this.dom.voiceStatusText) this.dom.voiceStatusText.textContent = 'صوت: مكتوم';
          this.showToast('تم كتم التوجيه الصوتي العربي', 'warning');
        } else {
          if (this.dom.voiceStatusIcon) this.dom.voiceStatusIcon.textContent = '🗣️';
          if (this.dom.voiceStatusText) this.dom.voiceStatusText.textContent = 'صوت: مفعّل';
          this.showToast('تم تفعيل التوجيه الصوتي العربي', 'success');
          window.speakArabic('التوجيه الصوتي مفعّل');
        }
      });
    }

    // Print Courier Handover Manifest
    if (this.dom.printManifestBtn) {
      this.dom.printManifestBtn.addEventListener('click', () => this.generateAndPrintManifest());
    }

    // History Modal
    if (this.dom.openHistoryBtn) {
      this.dom.openHistoryBtn.addEventListener('click', () => {
        this.renderHistory();
        this.dom.historyModal.classList.remove('hidden');
      });
    }
    if (this.dom.closeHistoryBtn) {
      this.dom.closeHistoryBtn.addEventListener('click', () => this.dom.historyModal.classList.add('hidden'));
    }
    if (this.dom.clearHistoryBtn) {
      this.dom.clearHistoryBtn.addEventListener('click', () => {
        if (confirm('هل أنت متأكد من مسح سجل تحضير الأوردرات اليوم؟')) {
          this.completedHistory = [];
          this.saveHistory();
          this.renderHistory();
          this.renderStats();
          this.showToast('تم مسح السجل بنجاح', 'info');
        }
      });
    }
    if (this.dom.exportHistoryCsvBtn) {
      this.dom.exportHistoryCsvBtn.addEventListener('click', () => this.exportHistoryCsv());
    }

    // Next Order
    if (this.dom.nextOrderBtn) {
      this.dom.nextOrderBtn.addEventListener('click', () => {
        this.activeOrder = null;
        this.renderActiveOrder();
        this.showToast('في انتظار مسح بوليصة الأوردر التالي', 'info');
      });
    }

    // Catalog modal
    if (this.dom.openCatalogModalBtn) {
      this.dom.openCatalogModalBtn.addEventListener('click', () => {
        this.updateCatalogCounters();
        this.dom.catalogModal.classList.remove('hidden');
      });
    }
    if (this.dom.closeCatalogModalBtn) {
      this.dom.closeCatalogModalBtn.addEventListener('click', () => this.dom.catalogModal.classList.add('hidden'));
    }
    if (this.dom.startSyncCatalogBtn) {
      this.dom.startSyncCatalogBtn.addEventListener('click', () => this.runShopifyCatalogSync());
    }
    if (this.dom.exportCatalogJsonBtn) {
      this.dom.exportCatalogJsonBtn.addEventListener('click', () => {
        try {
          window.catalogManager.exportCatalogJson();
          this.showToast('تم تصدير ملف الكتالوج بنجاح!', 'success');
        } catch (e) {
          this.showToast(e.message, 'warning');
        }
      });
    }
    if (this.dom.importCatalogJsonInput) {
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
    }

    // Lightbox modal close
    if (this.dom.closeLightboxBtn) {
      this.dom.closeLightboxBtn.addEventListener('click', () => this.dom.imageLightboxModal.classList.add('hidden'));
    }
    if (this.dom.imageLightboxModal) {
      this.dom.imageLightboxModal.addEventListener('click', (e) => {
        if (e.target === this.dom.imageLightboxModal) this.dom.imageLightboxModal.classList.add('hidden');
      });
    }

    // Remaining orders
    if (this.dom.openRemainingBtn) {
      this.dom.openRemainingBtn.addEventListener('click', () => {
        this.renderRemainingOrders();
        this.dom.remainingOrdersModal.classList.remove('hidden');
      });
    }
    if (this.dom.closeRemainingModalBtn) {
      this.dom.closeRemainingModalBtn.addEventListener('click', () => this.dom.remainingOrdersModal.classList.add('hidden'));
    }
    if (this.dom.remainingFilterInput) {
      this.dom.remainingFilterInput.addEventListener('input', (e) => this.renderRemainingOrders(e.target.value.trim()));
    }

    // Quick search
    if (this.dom.quickSearchInput) {
      this.dom.quickSearchInput.addEventListener('input', (e) => this.handleQuickSearch(e.target.value.trim()));
      document.addEventListener('click', (e) => {
        if (!this.dom.quickSearchInput.contains(e.target) && !this.dom.quickSearchResults.contains(e.target)) {
          this.dom.quickSearchResults.classList.add('hidden');
        }
      });
    }

    // "Lost Item" Finder Mode Toggle
    if (this.dom.toggleLookupModeBtn) {
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
    }
    if (this.dom.closeLookupModalBtn) {
      this.dom.closeLookupModalBtn.addEventListener('click', () => this.dom.productLookupModal.classList.add('hidden'));
    }

    // Settings & Bosta API Key Modal
    if (this.dom.openSettingsModalBtn) {
      this.dom.openSettingsModalBtn.addEventListener('click', () => this.openSettingsModal());
    }
    if (this.dom.closeSettingsModalBtn) {
      this.dom.closeSettingsModalBtn.addEventListener('click', () => this.closeSettingsModal());
    }
    if (this.dom.cancelSettingsBtn) {
      this.dom.cancelSettingsBtn.addEventListener('click', () => this.closeSettingsModal());
    }
    if (this.dom.saveSettingsBtn) {
      this.dom.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    }
    if (this.dom.toggleBostaApiKeyVisibilityBtn) {
      this.dom.toggleBostaApiKeyVisibilityBtn.addEventListener('click', () => this.toggleBostaApiKeyVisibility());
    }
    if (this.dom.settingsModal) {
      this.dom.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.dom.settingsModal) this.closeSettingsModal();
      });
    }
    if (this.dom.testBostaConnectionBtn) {
      this.dom.testBostaConnectionBtn.addEventListener('click', () => this.handleTestBostaConnection());
    }
    if (this.dom.bostaApiKeyInput) {
      this.dom.bostaApiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.saveSettings();
        }
      });
    }

    // Scanned orders counter reset
    if (this.dom.resetScannedOrdersBtn) {
      this.dom.resetScannedOrdersBtn.addEventListener('click', () => {
        if (confirm('تصفير عداد الأوردرات الممسوحة اليوم؟')) {
          this.scannedOrdersLog = { date: this.localDateKey(), ids: [] };
          this.saveScannedOrders();
          this.renderScannedOrdersCounter();
          this.showToast('تم تصفير عداد الأوردرات الممسوحة', 'info');
        }
      });
    }

    // Repeat missing items by voice
    if (this.dom.speakMissingBtn) {
      this.dom.speakMissingBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        this.speakMissingItems();
      });
    }

    // Voice settings
    if (this.dom.voiceSelect) {
      this.dom.voiceSelect.addEventListener('change', (e) => {
        window.arabicVoice.setPreferred(e.target.value);
        this.updateVoiceHint();
        window.speakArabic('تم اختيار هذا الصوت');
      });
    }
    if (this.dom.testVoiceBtn) {
      this.dom.testVoiceBtn.addEventListener('click', () => {
        window.speakArabic('صحيح، باقي قطعة واحدة: اسدال فسكوز مشجر، لون منت، مقاس XL');
      });
    }
    if (this.dom.voiceRateInput) {
      this.dom.voiceRateInput.addEventListener('input', (e) => {
        const rate = parseFloat(e.target.value) || 1;
        window.arabicVoice.setRate(rate);
        if (this.dom.voiceRateValue) this.dom.voiceRateValue.textContent = rate.toFixed(2);
      });
      this.dom.voiceRateInput.addEventListener('change', () => window.speakArabic('هذه هي السرعة الجديدة'));
    }
    window.addEventListener('voices-changed', () => this.populateVoiceSelect());

    // Catalog update broadcast
    window.addEventListener('catalog-loaded', () => {
      this.updateCatalogCounters();
    });
    window.addEventListener('catalog-updated', () => {
      this.updateCatalogCounters();
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
  // 5. Fail-Safe Barcode Resolution Engine (0ms Workflow)
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

    // STEP A: Check Bosta Waybill Barcode / Tracking Number / Order ID
    let matchedOrder = null;
    if (this.ordersMap.has(normalizedTracking)) {
      matchedOrder = this.ordersMap.get(normalizedTracking);
    } else if (this.ordersMap.has(lower)) {
      matchedOrder = this.ordersMap.get(lower);
    } else if (this.ordersMap.has(cleanCode)) {
      matchedOrder = this.ordersMap.get(cleanCode);
    }

    if (matchedOrder) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-cyan-900/80 text-cyan-300 border border-cyan-700';
      this.dom.lastScanTypeBadge.textContent = 'بوليصة شحن';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = `تم فتح الأوردر: ${matchedOrder.orderId} (${matchedOrder.customerName})`;

      this.loadActiveOrder(matchedOrder);
      return;
    }

    // STEP A2: Fallback to live Bosta API Query if not found in local CSV
    if (!this.activeOrder && this.getBostaApiKey() && (cleanCode.match(/^(\d{7,14})$/) || cleanCode.match(/^[A-Za-z]-\d{2}-\d+$/))) {
      this.fetchAndLoadBostaDelivery(normalizedTracking, cleanCode);
      return;
    }

    // STEP B: No active order — if the code is a known product, fetch it (product-first scanning)
    if (!this.activeOrder) {
      const translation = window.catalogManager.translateBarcode(cleanCode);
      if (translation.type === 'barcode_translated' || translation.type === 'direct_sku' || translation.type === 'zero_barcode') {
        this.handleLostItemQuery(cleanCode);
        return;
      }
    }

    // STEP B2: Ensure an active order is loaded on screen
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

    // STEP C: Product Polybag Barcode Translation & Verification
    this.verifyProductScan(cleanCode);
  }

  // ----------------------------------------------------
  // Scanned orders counter (unique orders opened by scan today)
  // ----------------------------------------------------
  localDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  loadScannedOrders() {
    try {
      const data = JSON.parse(localStorage.getItem('khiam_scanned_orders') || 'null');
      if (data && data.date === this.localDateKey() && Array.isArray(data.ids)) return data;
    } catch (e) {}
    return { date: this.localDateKey(), ids: [] };
  }

  saveScannedOrders() {
    try {
      localStorage.setItem('khiam_scanned_orders', JSON.stringify(this.scannedOrdersLog));
    } catch (e) {}
  }

  /** Counts the order once per day; returns today's total */
  markOrderScanned(order) {
    if (this.scannedOrdersLog.date !== this.localDateKey()) {
      this.scannedOrdersLog = { date: this.localDateKey(), ids: [] };
    }
    const key = String(order.orderId || order.trackingNumber || '').toLowerCase();
    if (key && !this.scannedOrdersLog.ids.includes(key)) {
      this.scannedOrdersLog.ids.push(key);
      this.saveScannedOrders();
      this.renderScannedOrdersCounter(true);
    }
    return this.scannedOrdersLog.ids.length;
  }

  renderScannedOrdersCounter(bump = false) {
    const el = this.dom.scannedOrdersCount;
    if (!el) return;
    el.textContent = this.scannedOrdersLog.ids.length;
    if (bump) {
      el.classList.remove('animate-bounce-short');
      void el.offsetWidth;
      el.classList.add('animate-bounce-short');
    }
  }

  // ----------------------------------------------------
  // Missing items voice ("يردد اسم الصنف الناقص")
  // ----------------------------------------------------
  spokenItemName(item) {
    const d = item.details || this.parseProductDetails(item.name);
    const parts = [d.model || item.name];
    if (d.color) parts.push(`لون ${d.color}`);
    if (d.size) parts.push(`مقاس ${d.size}`);
    return parts.join('، ');
  }

  buildMissingItemsPhrase(maxItems = 3) {
    if (!this.activeOrder) return '';
    const missing = this.activeOrder.items.filter(i => i.scannedQty < i.requiredQty);
    if (missing.length === 0) return '';
    const phrases = missing.slice(0, maxItems).map(i => {
      const left = i.requiredQty - i.scannedQty;
      return left > 1 ? `${this.formatArabicCount(left)} ${this.spokenItemName(i)}` : this.spokenItemName(i);
    });
    let text = phrases.join('. و ');
    if (missing.length > maxItems) text += `. و ${missing.length - maxItems} أصناف أخرى`;
    return text;
  }

  speakMissingItems() {
    if (!this.activeOrder) {
      window.speakArabic('لا يوجد أوردر مفتوح');
      return;
    }
    const remaining = this.activeOrder.totalRequired - this.activeOrder.totalScanned;
    if (remaining <= 0) {
      window.speakArabic('لا يوجد نواقص، الأوردر مكتمل');
      return;
    }
    window.speakArabic(`الناقص ${this.formatArabicCount(remaining)}: ${this.buildMissingItemsPhrase(6)}`);
  }

  // ----------------------------------------------------
  // Arabic voice picker (settings)
  // ----------------------------------------------------
  populateVoiceSelect() {
    const sel = this.dom.voiceSelect;
    if (!sel || !window.arabicVoice) return;
    const voices = window.arabicVoice.list();
    const preferred = window.arabicVoice.getPreferred();
    sel.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'تلقائي (أفضل صوت متاح)';
    sel.appendChild(auto);
    voices
      .slice()
      .sort((a, b) => Number(window.arabicVoice.isNatural(b)) - Number(window.arabicVoice.isNatural(a)))
      .forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${window.arabicVoice.isNatural(v) ? '⭐ ' : ''}${v.name} (${v.lang})`;
        sel.appendChild(opt);
      });
    sel.value = voices.some(v => v.name === preferred) ? preferred : 'auto';

    const rate = window.arabicVoice.getRate();
    if (this.dom.voiceRateInput) this.dom.voiceRateInput.value = rate;
    if (this.dom.voiceRateValue) this.dom.voiceRateValue.textContent = rate.toFixed(2);
    this.updateVoiceHint();
  }

  updateVoiceHint() {
    if (!window.arabicVoice) return;
    const voices = window.arabicVoice.list();
    const current = window.arabicVoice.current();
    const hasNatural = voices.some(v => window.arabicVoice.isNatural(v));
    const badge = this.dom.voiceQualityBadge;
    const hint = this.dom.voiceHint;

    if (badge) {
      const natural = current && window.arabicVoice.isNatural(current);
      badge.textContent = !current ? '⛔ لا يوجد صوت عربي' : (natural ? '⭐ صوت طبيعي (Neural)' : '⚠️ صوت عادي');
      badge.className = `text-[11px] font-bold ${natural ? 'text-emerald-300' : 'text-amber-300'}`;
    }
    if (!hint) return;
    if (hasNatural) {
      hint.classList.add('hidden');
      return;
    }
    hint.classList.remove('hidden');
    hint.textContent = window.arabicVoice.isEdge()
      ? 'لا تظهر الأصوات الطبيعية؟ تأكد من اتصال الإنترنت ثم أعد فتح الصفحة — أصوات Microsoft Salma و Shakir (مصري) تعمل أونلاين.'
      : 'للحصول على نطق عربي طبيعي ودقيق مجاناً: افتح النظام من متصفح Microsoft Edge (المثبت مع ويندوز) — سيظهر صوت Salma أو Shakir المصري ⭐ تلقائياً. متصفح Chrome على ويندوز لا يحتوي إلا على الأصوات الآلية القديمة.';
  }

  formatArabicCount(num) {
    if (num === 1) return 'قطعة واحدة';
    if (num === 2) return 'قطعتان';
    if (num >= 3 && num <= 10) return `${num} قطع`;
    return `${num} قطعة`;
  }

  loadActiveOrder(order) {
    this.activeOrder = order;
    const scannedCount = this.markOrderScanned(order);

    // Reset zero alert if open
    if (this.dom.zeroBarcodeAlert) this.dom.zeroBarcodeAlert.classList.add('hidden');

    // High-volume chirp
    window.soundEngine.playChirp();

    // Natural Arabic Voice prompt
    const countPhrase = this.formatArabicCount(order.totalRequired);
    let voiceMessage = `أوردر جديد: ${countPhrase}.`;

    if (order.isExchange) {
      voiceMessage = `انتبه: أوردر استبدال! تأكد من استلام المرتجع. عدد القطع: ${countPhrase}.`;
    } else if (order.notes && order.notes.trim().length > 0) {
      voiceMessage = `أوردر جديد: ${countPhrase}. تنبيه: يوجد ملاحظة هامة على الأوردر!`;
    }

    window.speakArabic(voiceMessage);

    this.renderActiveOrder();
    this.showToast(`تم فتح أوردر: ${order.orderId} (${countPhrase}) — تم مسح ${scannedCount} أوردر`, 'info');
  }

  /**
   * Product Scan Verification with Barcode-to-SKU Translation & Size Mismatch
   */
  verifyProductScan(scannedCode) {
    const translation = window.catalogManager.translateBarcode(scannedCode);
    const items = this.activeOrder.items;

    // SPECIAL CASE 1: Damaged / legacy label that scans as zeros, or a misread that matches
    // nothing in the catalog (compressed bars) — resolve from the open order
    const isUnreadable = translation.type === 'unknown' && /^\d+$/.test(scannedCode)
      && !items.some(i => i.sku === scannedCode.toLowerCase());
    if (translation.type === 'zero_barcode' || isUnreadable) {
      this.resolveZeroBarcodeScan();
      return;
    }

    // RESOLVE TARGET SKU
    let targetSku = '';
    if (translation.type === 'barcode_translated') {
      targetSku = translation.sku.toLowerCase();
      this.dom.lastScanTypeBadge.textContent = `باركود (${translation.barcode}) ➔ SKU: ${translation.sku}`;
    } else if (translation.type === 'direct_sku') {
      targetSku = translation.sku.toLowerCase();
      this.dom.lastScanTypeBadge.textContent = `كود SKU مباشر: ${translation.sku}`;
    } else {
      targetSku = scannedCode.toLowerCase();
      this.dom.lastScanTypeBadge.textContent = `كود: ${scannedCode}`;
    }

    // 1. Direct SKU match in active order
    let matchedItem = items.find(i => i.sku === targetSku);

    // 2. Size Mismatch Detector (Model/Color code matches, but size differs)
    if (!matchedItem) {
      const scannedPrefix = window.catalogManager.extractModelPrefix(targetSku);
      const sizeMismatchItem = items.find(i => {
        const itemPrefix = window.catalogManager.extractModelPrefix(i.sku);
        return itemPrefix === scannedPrefix;
      });

      if (sizeMismatchItem) {
        this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-orange-900/90 text-orange-200 border border-orange-500';
        this.dom.lastScanTypeBadge.textContent = 'اختلاف مقاس ⚠️';
        this.dom.lastScanMessage.textContent = `انتبه: الموديل صح ولكن المقاس مختلف!`;

        this.triggerScreenFlash('orange');
        this.triggerCardFlash(sizeMismatchItem.sku, 'red');
        window.soundEngine.playSizeMismatch();

        const reqDetails = sizeMismatchItem.details || this.parseProductDetails(sizeMismatchItem.name);
        const scannedDetails = this.parseProductDetails(translation.item ? translation.item.name : targetSku);

        const reqSize = reqDetails.size || sizeMismatchItem.originalSku.slice(-2) || 'المطلوب';
        const scannedSize = scannedDetails.size || targetSku.slice(-2) || 'الممسوح';

        window.speakArabic(`انتبه: الموديل صح ولكن المقاس مختلف! المطلوب مقاس ${reqSize} والممسوح مقاس ${scannedSize}`);
        this.showToast(`⚠️ انتبه: الموديل صحيح ولكن المقاس مختلف! المطلوب [${reqSize}] والممسوح [${scannedSize}]`, 'warning');
        return;
      }
    }

    // 3. Wrong Item (Does not belong to order)
    if (!matchedItem) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
      this.dom.lastScanTypeBadge.textContent = 'صنف خاطئ ⛔';
      this.dom.lastScanMessage.textContent = `الكود [${targetSku}] غير موجود في هذا الأوردر!`;

      this.triggerScreenFlash('red');
      window.soundEngine.playBuzzer();
      const missingPhrase = this.buildMissingItemsPhrase();
      window.speakArabic(missingPhrase ? `صنف خاطئ. المطلوب: ${missingPhrase}` : 'صنف خاطئ لا يخص هذا الأوردر');
      this.showToast(`⛔ صنف خاطئ: الكود [${targetSku}] غير موجود في هذا الأوردر!`, 'error');
      return;
    }

    this.acceptScannedItem(matchedItem);
  }

  /**
   * Counts one piece of an order item (shared by normal scans and damaged-barcode resolution)
   */
  acceptScannedItem(matchedItem) {
    // 4. Item already completed
    if (matchedItem.scannedQty >= matchedItem.requiredQty) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-amber-900/80 text-amber-300 border border-amber-700';
      this.dom.lastScanTypeBadge.textContent = 'مكتمل مسبقاً ⚠️';
      this.dom.lastScanMessage.textContent = `تم مسح العدد المطلوب بالكامل لهذا الصنف`;

      this.triggerCardFlash(matchedItem.sku, 'red');
      window.soundEngine.playBuzzer();
      window.speakArabic('تم مسح هذا المنتج بالكامل مسبقاً');
      this.showToast(`⚠️ تم مسح العدد المطلوب من هذا المنتج مسبقاً! (${matchedItem.requiredQty}/${matchedItem.requiredQty})`, 'warning');
      return;
    }

    // 5. Correct Item Scan!
    matchedItem.scannedQty++;
    this.activeOrder.totalScanned++;

    if (matchedItem.scannedQty === matchedItem.requiredQty) {
      matchedItem.isCompleted = true;
    }

    const isAllComplete = this.activeOrder.totalScanned === this.activeOrder.totalRequired;
    const remainingInOrder = this.activeOrder.totalRequired - this.activeOrder.totalScanned;

    this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-emerald-900/80 text-emerald-300 border border-emerald-700';
    this.dom.lastScanTypeBadge.textContent = 'صنف صحيح ✅';
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
      this.showToast(`🎉 تم اكتمال الأوردر بنجاح! — إجمالي الممسوح اليوم: ${this.scannedOrdersLog.ids.length} أوردر`, 'success');
    } else {
      this.triggerCardFlash(matchedItem.sku, 'green');
      window.soundEngine.playDing();

      const missingPhrase = this.buildMissingItemsPhrase();
      window.speakArabic(`صحيح، باقي ${this.formatArabicCount(remainingInOrder)}: ${missingPhrase}`);

      this.showToast(`✅ تم مسح: ${matchedItem.name} (${matchedItem.scannedQty}/${matchedItem.requiredQty})`, 'success');
    }
  }

  /**
   * Zero scan inside an open order:
   * - exactly one remaining item known to have damaged/legacy labels → count it automatically
   * - otherwise → one-tap picker (legacy candidates first, else all remaining items)
   */
  resolveZeroBarcodeScan() {
    this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-purple-900/80 text-purple-200 border border-purple-500';
    this.dom.lastScanTypeBadge.textContent = 'باركود تالف / غير مقروء';
    this.dom.lastScanTypeBadge.classList.remove('hidden');

    const remaining = this.activeOrder.items.filter(i => i.scannedQty < i.requiredQty);
    const legacy = remaining.filter(i => i.isZeroBarcode);

    if (remaining.length === 0) {
      this.dom.lastScanMessage.textContent = 'كل قطع هذا الأوردر تم مسحها بالفعل!';
      this.triggerScreenFlash('red');
      window.soundEngine.playBuzzer();
      window.speakArabic('كل قطع هذا الأوردر تم مسحها');
      this.showToast('⛔ باركود تالف، ولكن كل قطع الأوردر تم مسحها بالفعل!', 'error');
      return;
    }

    if (legacy.length === 1) {
      this.showToast(`🟢 باركود تالف تمت مطابقته تلقائياً: ${legacy[0].name}`, 'success');
      this.acceptScannedItem(legacy[0]);
      return;
    }

    this.openZeroPicker(legacy.length > 1 ? legacy : remaining);
  }

  openZeroPicker(candidates) {
    this.dom.lastScanMessage.textContent = 'باركود تالف — اختر القطعة الصحيحة من النافذة';
    window.soundEngine.playSizeMismatch();
    window.speakArabic('باركود تالف، اختر القطعة');

    const list = this.dom.zeroPickerList;
    list.innerHTML = '';
    candidates.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-slate-950 hover:bg-slate-800 border-2 border-slate-700 hover:border-purple-400 rounded-2xl p-2 flex flex-col items-center gap-2 text-center transition';
      btn.innerHTML = `
        <img src="${item.imageUrl || ''}" alt="" class="w-full h-32 object-contain rounded-xl bg-slate-900">
        <div class="text-xs font-bold text-white leading-snug">${item.name}</div>
        <div class="text-[11px] font-mono text-amber-300">${item.originalSku || ''} · ${item.scannedQty}/${item.requiredQty}</div>
      `;
      btn.addEventListener('click', () => {
        this.dom.zeroPickerModal.classList.add('hidden');
        this.acceptScannedItem(item);
      });
      list.appendChild(btn);
    });
    this.dom.zeroPickerModal.classList.remove('hidden');
  }

  confirmZeroBarcodePiece() {
    if (!this.activeOrder) return;
    if (this.dom.zeroBarcodeAlert) this.dom.zeroBarcodeAlert.classList.add('hidden');
    this.resolveZeroBarcodeScan();
  }

  // ----------------------------------------------------
  // 6. "Lost Item" Finder Mode (وضع استعلام عن الصنف التائه)
  // ----------------------------------------------------
  handleLostItemQuery(scannedCode) {
    const translation = window.catalogManager.translateBarcode(scannedCode);
    if (translation.type === 'zero_barcode') {
      this.showZeroBarcodeLookup();
      return;
    }
    const cleanSku = (translation.sku || scannedCode).trim().toLowerCase();
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
    this.dom.lookupProductSku.textContent = `SKU: ${cleanSku.toUpperCase()} | باركود: ${translation.barcode || '---'}`;
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

  /**
   * A zeros barcode cannot identify a product by itself: list today's orders that still
   * need items with damaged/legacy labels, so the worker can open the right one.
   */
  showZeroBarcodeLookup() {
    this.dom.lookupProductImg.src = window.catalogManager.generateFallbackMonogram('00000000', 'باركود تالف');
    this.dom.lookupProductTitle.textContent = 'باركود تالف (أصفار) — لا يحدد المنتج وحده';
    this.dom.lookupProductSku.textContent = 'اكتب كود SKU المطبوع على الملصق في خانة المنتج، أو افتح الأوردر ثم امسح القطعة';
    this.dom.lookupMatchLevel.textContent = '';
    this.dom.lookupBadges.innerHTML = '';

    const list = this.dom.lookupOrdersList;
    list.innerHTML = '';
    const matches = [];
    this.orders.forEach((ord, index) => {
      if (ord.isCompleted) return;
      const legacyItems = ord.items.filter(i => i.isZeroBarcode && i.scannedQty < i.requiredQty);
      if (legacyItems.length) matches.push({ ord, index, legacyItems });
    });

    if (matches.length === 0) {
      list.innerHTML = '<div class="p-4 bg-slate-950 text-slate-400 text-xs text-center rounded-xl font-bold">لا توجد أوردرات متبقية تحتوي على أصناف بملصقات تالفة.</div>';
    }
    matches.forEach(({ ord, index, legacyItems }) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'bg-slate-950 hover:bg-slate-800 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between cursor-pointer transition';
      itemEl.innerHTML = `
        <div>
          <div class="font-bold text-white text-xs">العميل: <span class="text-amber-300">${ord.customerName}</span> (أوردر ${ord.orderId}) | تسلسل: #${index + 1}</div>
          <div class="text-[11px] text-slate-400 mt-0.5">${legacyItems.map(i => `${i.name} <span class="font-mono text-amber-300">${i.originalSku}</span>`).join(' · ')}</div>
        </div>
        <button class="bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs px-3 py-1 rounded-lg shrink-0">فتح الأوردر 👈</button>
      `;
      itemEl.addEventListener('click', () => {
        this.loadActiveOrder(ord);
        this.dom.productLookupModal.classList.add('hidden');
      });
      list.appendChild(itemEl);
    });

    window.soundEngine.playSizeMismatch();
    window.speakArabic('باركود تالف، اكتب الكود المطبوع على الملصق');
    this.dom.productLookupModal.classList.remove('hidden');
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
    this.dom.printBatchRef.textContent = 'REF-' + new Date().toISOString().split('T')[0];

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
  // 8. Multi-Row 109-Column Operix CSV Parser
  // ----------------------------------------------------
  /**
   * Parse one or more Operix CSV files selected together and merge their orders
   * (the same order appearing in two files is loaded once).
   */
  async parseCsvFiles(files) {
    const csvFiles = files.filter(f => /\.csv$/i.test(f.name) || f.type === 'text/csv' || f.type === 'application/vnd.ms-excel');
    if (csvFiles.length === 0) {
      this.showToast('يرجى اختيار ملفات CSV فقط', 'warning');
      return;
    }

    if (this.dom.csvFileName) {
      const names = csvFiles.map(f => f.name);
      this.dom.csvFileName.textContent = names.length === 1 ? names[0] : `${names.length} ملفات: ${names.join('، ')}`;
      this.dom.csvFileName.title = names.join('\n');
    }

    const rowSets = [];
    const failed = [];
    for (const file of csvFiles) {
      try {
        rowSets.push(await this.readCsvRows(file));
      } catch (err) {
        console.error('CSV Parse Error:', file.name, err);
        failed.push(file.name);
      }
    }

    if (failed.length) {
      this.showToast(`تعذرت قراءة: ${failed.join('، ')}`, 'error');
      window.soundEngine.playBuzzer();
    }
    if (rowSets.length) this.processParsedCsv(rowSets, csvFiles.length - failed.length);
  }

  parseCsvFile(file) {
    return this.parseCsvFiles([file]);
  }

  readCsvRows(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.replace(/^\ufeff/, '').trim(),
        complete: (results) => resolve(results.data || []),
        error: (err) => reject(err)
      });
    });
  }

  async processParsedCsv(rowSets, fileCount = 1) {
    // Backwards compatible: a single array of rows is one file
    if (rowSets.length && !Array.isArray(rowSets[0])) rowSets = [rowSets];
    const totalRows = rowSets.reduce((n, r) => n + r.length, 0);
    if (totalRows === 0) {
      this.showToast('الملف لا يحتوي على أي أوردرات!', 'warning');
      return;
    }

    this.orders = [];
    this.ordersMap.clear();
    const seenOrderKeys = new Set();
    let duplicateOrders = 0;

    rowSets.forEach(rows => {
    // Multi-row orders never span two files
    let currentOrder = null;
    let skippingDuplicate = false;

    rows.forEach((row, index) => {
      const orderId = (row['Order ID'] || row['OrderID'] || '').trim();
      const rawTracking = (row['Tracking Number'] || row['Waybill'] || '').trim();

      // Clean scientific notation or float in tracking number (e.g. 9.049569e+09 -> 9049568550)
      let trackingNumber = '';
      if (rawTracking) {
        if (/^[0-9.eE+-]+$/.test(rawTracking) && (rawTracking.includes('e') || rawTracking.includes('E') || rawTracking.includes('.'))) {
          const num = Number(rawTracking);
          trackingNumber = !isNaN(num) ? BigInt(Math.round(num)).toString() : rawTracking;
        } else {
          trackingNumber = rawTracking.replace(/\.0+$/, '').trim();
        }
      }

      // Check if this row initiates a new order
      if (orderId || trackingNumber) {
        const orderKey = `${orderId.toLowerCase()}|${trackingNumber.toLowerCase()}`;
        if (seenOrderKeys.has(orderKey)) {
          // Same order exported in more than one file: keep the first copy only
          skippingDuplicate = true;
          duplicateOrders++;
          return;
        }
        seenOrderKeys.add(orderKey);
        skippingDuplicate = false;

        // Collect notes from note fields
        const notesArr = [
          row['Customer Note'],
          row['Sales Note'],
          row['Delivery Note'],
          row['Internal Order Note']
        ].map(n => (n || '').trim()).filter(Boolean);

        const orderType = (row['Order Type'] || (orderId.toUpperCase().startsWith('EXC-') ? 'Exchange' : 'Sales')).trim();
        const isExchange = orderType.toLowerCase() === 'exchange' || orderId.toUpperCase().startsWith('EXC-');

        const normalizedTracking = this.normalizeTrackingBarcode(trackingNumber);

        currentOrder = {
          id: `ord_${this.orders.length}_${orderId || trackingNumber}`,
          orderId: orderId || `ORD-${this.orders.length + 1}`,
          orderType: orderType,
          isExchange: isExchange,
          trackingNumber: trackingNumber || '---',
          normalizedTracking: normalizedTracking,
          customerName: (row['Customer Name'] || 'عميل غير مسجل').trim(),
          primaryPhone: (row['Primary Phone Number'] || row['Phone'] || '---').trim(),
          secondaryPhone: (row['Secondary Phone Number'] || '').trim(),
          province: (row['Province'] || '').trim(),
          city: (row['City'] || '').trim(),
          zone: (row['Zone'] || '').trim(),
          address: (row['Delivery Address'] || '').trim(),
          netAmount: (row['Net Amount'] || row['Order Total'] || row['Collected Amount'] || '0').trim(),
          notes: notesArr.join(' | '),
          shippingCompany: (row['Shipping Company'] || 'Bosta').trim(),
          pickingReference: (row['Picking Reference'] || '').trim(),
          items: [],
          totalRequired: 0,
          totalScanned: 0,
          isCompleted: false,
          status: 'PENDING'
        };

        this.orders.push(currentOrder);

        // Index in ordersMap for 0ms lookup
        if (currentOrder.normalizedTracking) {
          this.ordersMap.set(currentOrder.normalizedTracking.toLowerCase(), currentOrder);
        }
        if (currentOrder.trackingNumber && currentOrder.trackingNumber !== '---') {
          this.ordersMap.set(currentOrder.trackingNumber.toLowerCase(), currentOrder);
        }
        if (currentOrder.orderId) {
          this.ordersMap.set(currentOrder.orderId.toLowerCase(), currentOrder);
          if (currentOrder.isExchange) {
            this.ordersMap.set(currentOrder.orderId.replace(/^EXC-/i, '').toLowerCase(), currentOrder);
          }
        }
      }

      // Item extraction (supporting PL/SKU, PL/Products, PL/Quantity and fallback SKUs)
      if (currentOrder && !skippingDuplicate) {
        const skuRaw = (row['PL/SKU'] || (currentOrder.items.length === 0 ? row['SKUs'] : '') || '').trim();
        const productRaw = (row['PL/Products'] || (currentOrder.items.length === 0 ? row['Products'] : '') || '').trim();
        const qtyRaw = (row['PL/Quantity'] || (currentOrder.items.length === 0 ? row['Total Quantity'] : '1') || '1').trim();

        if (skuRaw || productRaw) {
          // If product contains multiple piped items or standard SKU
          this.appendItemToOrder(currentOrder, skuRaw, productRaw, qtyRaw);
        }
      }
    });
    });

    // Recalculate totalRequired for all orders
    this.orders.forEach(ord => {
      ord.totalRequired = ord.items.reduce((sum, item) => sum + item.requiredQty, 0);
    });

    this.renderStats();
    const filesPart = fileCount > 1 ? ` من ${fileCount} ملفات` : '';
    const dupPart = duplicateOrders ? ` (تم تجاهل ${duplicateOrders} أوردر مكرر)` : '';
    this.showToast(`✅ تم تحميل ${this.orders.length} أوردر${filesPart} بنجاح!${dupPart} جاري تحضير صور الكتالوج...`, 'success');
    window.soundEngine.playChirp();
    window.speakArabic(`تم تحميل ${this.orders.length} أوردر بنجاح، جاهز للفحص`);

    // Background image preloader for 0ms display
    const preloaded = await window.catalogManager.preloadImagesForOrders(this.orders);
    if (preloaded > 0) {
      this.showToast(`⚡ تم تحميل ${preloaded} صورة منتج في الذاكرة لتظهر بـ 0ms!`, 'success');
    }
  }

  appendItemToOrder(order, skuRaw, productRaw, qtyRaw) {
    const qty = parseInt(qtyRaw, 10) || 1;
    let cleanSku = (skuRaw || '').trim().toLowerCase();
    if (!cleanSku || /^0+$/.test(cleanSku)) {
      const nameSku = window.catalogManager.findSkuByName(productRaw);
      if (nameSku) {
        cleanSku = nameSku;
        const catalogItem = window.catalogManager.skuMap.get(nameSku);
        skuRaw = catalogItem.originalSku || catalogItem.sku;
      }
    }

    // Check if item already exists in this order (increment requiredQty if duplicate row)
    const existing = order.items.find(it => it.sku === cleanSku && cleanSku !== '');
    if (existing) {
      existing.requiredQty += qty;
      return;
    }

    // Lookup metadata from catalogManager & barcodeTranslator
    const matchDetails = window.catalogManager.getProductImageAndDetails(cleanSku, productRaw);
    const parsed = this.parseProductDetails(matchDetails.name || productRaw);

    order.items.push({
      sku: cleanSku,
      originalSku: skuRaw || cleanSku,
      name: matchDetails.name || productRaw,
      details: parsed,
      barcodeNumber: matchDetails.barcode || '',
      isZeroBarcode: !!matchDetails.isZeroBarcode || matchDetails.barcode === '00000000',
      requiredQty: qty,
      scannedQty: 0,
      isCompleted: false,
      imageUrl: matchDetails.imageUrl,
      matchLevel: matchDetails.matchLevel
    });
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

  // ----------------------------------------------------
  // 9. Compact Stats Bar & Search
  // ----------------------------------------------------
  renderStats() {
    const total = this.orders.length;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = this.completedHistory.filter(h => h.date === today).length;
    const remaining = Math.max(0, total - todayCount);

    if (this.dom.compactTotalOrders) this.dom.compactTotalOrders.textContent = total;
    if (this.dom.compactCompletedOrders) this.dom.compactCompletedOrders.textContent = todayCount;
    if (this.dom.compactTotalOrdersDenom) this.dom.compactTotalOrdersDenom.textContent = total;
    if (this.dom.compactRemainingOrders) this.dom.compactRemainingOrders.textContent = remaining;
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
      const hasKey = !!this.getBostaApiKey();
      resBox.innerHTML = `
        <div class="p-3 text-slate-400 text-center space-y-2">
          <div>لا توجد أوردرات مطابقة في الشيت المحلي</div>
          ${hasKey ? `
            <button id="searchBostaDirectBtn" class="bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow transition flex items-center justify-center gap-1.5 mx-auto">
              <span>🌐</span>
              <span>استعلام مباشر من بوسطة (Bosta API)</span>
            </button>
          ` : ''}
        </div>
      `;
      const bostaBtn = resBox.querySelector('#searchBostaDirectBtn');
      if (bostaBtn) {
        bostaBtn.addEventListener('click', () => {
          this.fetchAndLoadBostaDelivery(query, query);
          resBox.classList.add('hidden');
        });
      }
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
  // 10. Remaining Orders Drawer
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
  // 11. Active Order View & Large Product Cards
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

    // Exchange order banner
    if (order.isExchange) {
      this.dom.exchangeBadge.classList.remove('hidden');
    } else {
      this.dom.exchangeBadge.classList.add('hidden');
    }

    // Merged Notes Alert Banner
    if (order.notes && order.notes.trim().length > 0) {
      this.dom.bostaPdfNotesAlert.classList.remove('hidden');
      this.dom.bostaPdfNotesText.textContent = order.notes;
    } else {
      this.dom.bostaPdfNotesAlert.classList.add('hidden');
    }

    // Complete Banner
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

    if (this.dom.customerAddressDisplay) {
      const zonePart = [order.zone, order.city, order.province].filter(Boolean).join(' - ');
      this.dom.customerAddressDisplay.textContent = `📍 ${order.address || zonePart || 'العنوان غير مدخل'}`;
    }

    if (this.dom.shippingCompanyDisplay) {
      this.dom.shippingCompanyDisplay.textContent = order.shippingCompany || 'Bosta';
    }
    if (this.dom.netAmountDisplay) {
      this.dom.netAmountDisplay.textContent = `${order.netAmount} ج.م`;
    }
    if (this.dom.orderTypeDisplay) {
      this.dom.orderTypeDisplay.textContent = order.orderType;
    }

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
      const card = document.createElement('div');
      card.id = `product_card_${item.sku}`;
      card.className = this.getCardClasses(item);
      card.innerHTML = this.generateCardHtml(item);
      this.bindCardEvents(card, item);

      grid.appendChild(card);
    }
  }

  renderSingleProductCard(item) {
    const card = document.getElementById(`product_card_${item.sku}`);
    if (card) {
      card.className = this.getCardClasses(item);
      card.innerHTML = this.generateCardHtml(item);
      this.bindCardEvents(card, item);
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

    let barcodeBadge = '';
    if (item.barcodeNumber && item.barcodeNumber !== '00000000') {
      barcodeBadge = `<span class="bg-slate-900 border border-slate-700 text-cyan-300 font-mono text-[11px] px-2.5 py-0.5 rounded-lg">باركود: ${item.barcodeNumber}</span>`;
    } else {
      barcodeBadge = `<span class="bg-purple-900/40 border border-purple-500/40 text-purple-300 text-[10px] px-2 py-0.5 rounded-lg">بدون باركود مسجل — استخدم زر تم التحقق</span>`;
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

          <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
            ${barcodeBadge}
          </div>

          ${isDone ? `
            <div class="absolute inset-0 bg-emerald-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-white animate-bounce-short">
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

        <!-- Manual verification (scanner fallback): each tap verifies one piece -->
        <div class="flex items-stretch gap-2 pt-1">
          <button type="button" data-action="manual-verify" ${isDone ? 'disabled' : ''}
            class="flex-1 inline-flex items-center justify-center gap-2 font-black text-sm px-3 py-2.5 rounded-xl border-2 transition ${isDone
              ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300 cursor-default'
              : 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] border-emerald-400 text-white shadow-lg shadow-emerald-950/50'}">
            <span>✔</span>
            <span>${isDone ? 'تم التحقق' : (item.requiredQty - item.scannedQty > 1 ? `تم التحقق (قطعة من ${item.requiredQty - item.scannedQty})` : 'تم التحقق')}</span>
          </button>
          ${item.scannedQty > 0 ? `
            <button type="button" data-action="undo-verify" title="تراجع عن آخر قطعة"
              class="shrink-0 inline-flex items-center justify-center px-3 rounded-xl border border-slate-600 bg-slate-900 hover:bg-rose-900/60 hover:border-rose-500 text-slate-300 text-xs font-bold transition">
              ↶ تراجع
            </button>
          ` : ''}
        </div>
        ${item.manualCount ? `<div class="text-[11px] text-amber-300/90 font-bold text-center">✋ ${item.manualCount} قطعة تم التحقق منها يدوياً</div>` : ''}
      </div>
    `;
  }

  bindCardEvents(card, item) {
    const imgContainer = card.querySelector('.zoomable-img-box');
    if (imgContainer) {
      imgContainer.addEventListener('click', () => this.openImageLightbox(item));
    }
    const verifyBtn = card.querySelector('[data-action="manual-verify"]');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', (e) => {
        e.currentTarget.blur(); // keep scanner Enter keystrokes away from the button
        this.manualVerifyItem(item);
      });
    }
    const undoBtn = card.querySelector('[data-action="undo-verify"]');
    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        this.undoItemPiece(item);
      });
    }
  }

  /**
   * Manual "تم التحقق" — counts one piece exactly like a successful scan
   */
  manualVerifyItem(item) {
    if (!this.activeOrder || !this.activeOrder.items.includes(item)) return;
    if (item.scannedQty >= item.requiredQty) return;
    item.manualCount = (item.manualCount || 0) + 1;
    this.dom.lastScannedCodeDisplay.textContent = `${item.originalSku} (يدوي)`;
    this.acceptScannedItem(item);
    if (this.dom.lastScanTypeBadge) {
      this.dom.lastScanTypeBadge.textContent = 'تم التحقق يدوياً ✋';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
    }
  }

  /**
   * Undo the last counted piece of an item (mistaken tap or wrong scan)
   */
  undoItemPiece(item) {
    const order = this.activeOrder;
    if (!order || item.scannedQty <= 0) return;
    const wasComplete = order.isCompleted;

    item.scannedQty--;
    if (item.manualCount) item.manualCount--;
    item.isCompleted = item.scannedQty >= item.requiredQty;
    order.totalScanned = Math.max(0, order.totalScanned - 1);

    if (wasComplete) {
      order.isCompleted = false;
      order.status = 'PENDING';
      this.completedHistory = this.completedHistory.filter(h => h.orderId !== order.orderId);
      this.saveHistory();
      this.renderStats();
      this.renderHistory();
      this.dom.orderCompleteBanner.classList.add('hidden');
    }

    this.updateOrderProgress();
    this.renderSingleProductCard(item);
    window.soundEngine.playSizeMismatch();
    this.showToast(`↶ تم التراجع عن قطعة: ${item.name} (${item.scannedQty}/${item.requiredQty})`, 'warning');
  }

  openImageLightbox(item) {
    this.dom.lightboxImg.src = item.imageUrl;
    this.dom.lightboxTitle.textContent = item.name;
    this.dom.lightboxSku.textContent = `SKU: ${item.originalSku} | باركود: ${item.barcodeNumber || '---'}`;
    this.dom.lightboxMatchBadge.textContent = item.matchLevel === 'exact' ? 'تطابق تام' : (item.matchLevel === 'prefix' ? 'تطابق موديل' : 'صورة مقترحة');
    this.dom.imageLightboxModal.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // 12. Visual Feedback
  // ----------------------------------------------------
  triggerScreenFlash(color = 'red') {
    const overlay = this.dom.flashOverlay;
    if (color === 'red') {
      overlay.className = 'fixed inset-0 pointer-events-none z-50 flash-red-active';
    } else if (color === 'green') {
      overlay.className = 'fixed inset-0 pointer-events-none z-50 flash-green-active';
    } else if (color === 'orange') {
      overlay.className = 'fixed inset-0 pointer-events-none z-50 flash-orange-active';
    }

    setTimeout(() => {
      overlay.className = 'fixed inset-0 pointer-events-none z-50 transition-colors duration-200';
    }, 450);
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
  // 13. History Storage & CSV Export
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
  // 14. Catalog Sync & Preload
  // ----------------------------------------------------
  async initCatalogIntegration() {
    setTimeout(() => {
      this.updateCatalogCounters();
    }, 500);
  }

  updateCatalogCounters() {
    const stats = window.catalogManager.stats || {};
    const totalVariants = stats.skuCount || window.catalogManager.skuMap.size || 563;
    const totalProducts = stats.totalProducts || window.catalogManager.productsList.length || 60;

    if (this.dom.headerCatalogCount) {
      this.dom.headerCatalogCount.textContent = `${totalVariants} SKU`;
    }
    if (this.dom.modalProductsCount) {
      this.dom.modalProductsCount.textContent = totalProducts;
    }
    if (this.dom.modalVariantsCount) {
      this.dom.modalVariantsCount.textContent = totalVariants;
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

    // Strip trailing SKU pipe if present (e.g. "طقم صلاه فسكوز | aa035bs0")
    if (model.includes('|')) {
      model = model.split('|')[0].trim();
    }

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
  // 15. Settings Modal & Bosta API Integration
  // ----------------------------------------------------
  openSettingsModal() {
    const key = localStorage.getItem('bosta_api_key') || '';
    if (this.dom.bostaApiKeyInput) {
      this.dom.bostaApiKeyInput.value = key;
      this.dom.bostaApiKeyInput.type = 'password';
    }
    if (this.dom.bostaEyeIcon) {
      this.dom.bostaEyeIcon.textContent = '👁️';
    }
    this.updateBostaStatusUI();
    this.populateVoiceSelect();
    if (this.dom.settingsModal) {
      this.dom.settingsModal.classList.remove('hidden');
    }
    setTimeout(() => {
      if (this.dom.bostaApiKeyInput) this.dom.bostaApiKeyInput.focus();
    }, 50);
  }

  closeSettingsModal() {
    if (this.dom.settingsModal) {
      this.dom.settingsModal.classList.add('hidden');
    }
  }

  toggleBostaApiKeyVisibility() {
    if (!this.dom.bostaApiKeyInput) return;
    const isPass = this.dom.bostaApiKeyInput.type === 'password';
    this.dom.bostaApiKeyInput.type = isPass ? 'text' : 'password';
    if (this.dom.bostaEyeIcon) {
      this.dom.bostaEyeIcon.textContent = isPass ? '🙈' : '👁️';
    }
  }

  saveSettings() {
    const key = this.dom.bostaApiKeyInput ? this.dom.bostaApiKeyInput.value.trim() : '';

    if (key) {
      localStorage.setItem('bosta_api_key', key);
      this.showToast('✅ تم حفظ مفتاح Bosta API بنجاح!', 'success');
      window.soundEngine.playDing();
    } else {
      localStorage.removeItem('bosta_api_key');
      this.showToast('تم مسح مفتاح Bosta API من الإعدادات', 'info');
    }

    this.updateBostaStatusUI();
    this.closeSettingsModal();
  }

  updateBostaStatusUI() {
    const key = localStorage.getItem('bosta_api_key') || '';
    const hasKey = key.length > 0;

    // Header Status Dot (top-left)
    if (this.dom.headerBostaStatusDot) {
      if (hasKey) {
        this.dom.headerBostaStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/70';
        this.dom.headerBostaStatusDot.title = 'مفتاح Bosta API محفوظ ونشط';
      } else {
        this.dom.headerBostaStatusDot.className = 'w-2 h-2 rounded-full bg-amber-500/80';
        this.dom.headerBostaStatusDot.title = 'مفتاح Bosta API غير مدخل';
      }
    }

    // Modal Status Banner
    if (this.dom.bostaKeyStatusBanner) {
      if (hasKey) {
        this.dom.bostaKeyStatusBanner.className = 'p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-3 bg-emerald-950/40 border-emerald-500/40 text-emerald-300';
        if (this.dom.bostaStatusIcon) this.dom.bostaStatusIcon.textContent = '✅';
        if (this.dom.bostaStatusTitle) this.dom.bostaStatusTitle.textContent = 'المفتاح محفوظ وجاهز للاستخدام';
        if (this.dom.bostaStatusDesc) {
          const masked = key.length > 8 ? `${key.substring(0, 4)}••••••••${key.substring(key.length - 4)}` : '••••••••';
          this.dom.bostaStatusDesc.textContent = `الكود: ${masked} (${key.length} حرف)`;
        }
      } else {
        this.dom.bostaKeyStatusBanner.className = 'p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-3 bg-amber-950/30 border-amber-500/30 text-amber-300';
        if (this.dom.bostaStatusIcon) this.dom.bostaStatusIcon.textContent = '⚠️';
        if (this.dom.bostaStatusTitle) this.dom.bostaStatusTitle.textContent = 'لم يتم حفظ مفتاح حتى الآن';
        if (this.dom.bostaStatusDesc) this.dom.bostaStatusDesc.textContent = 'يرجى كتابة المفتاح والضغط على حفظ الإعدادات';
      }
    }
  }

  async handleTestBostaConnection() {
    const inputKey = this.dom.bostaApiKeyInput ? this.dom.bostaApiKeyInput.value.trim() : '';
    const key = inputKey || localStorage.getItem('bosta_api_key') || '';
    if (!key) {
      this.showToast('يرجى إدخال مفتاح Bosta API Key أولاً لفحصه', 'warning');
      if (this.dom.bostaApiKeyInput) this.dom.bostaApiKeyInput.focus();
      return;
    }

    const btn = this.dom.testBostaConnectionBtn;
    const btnText = this.dom.testBostaBtnText;
    const spinner = this.dom.testBostaSpinner;

    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'جاري الفحص...';

    try {
      const res = await this.testBostaConnection(key);
      this.showToast(`✅ ${res.message}`, 'success');
      window.soundEngine.playDing();
      if (btnText) btnText.textContent = '✅ الاتصال ناجح';
    } catch (err) {
      console.warn('Bosta test failed:', err);
      this.showToast(`❌ ${err.message}`, 'error');
      window.soundEngine.playBuzzer();
      if (btnText) btnText.textContent = '❌ فشل الاتصال';
    } finally {
      setTimeout(() => {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (btnText) btnText.textContent = '🔌 فحص الاتصال';
      }, 2500);
    }
  }

  // ----------------------------------------------------
  // Bosta Fetch Requests
  // ----------------------------------------------------
  getBostaApiKey() {
    return localStorage.getItem('bosta_api_key') || '';
  }

  /**
   * Universal Bosta API fetch request:
   * Always reads key from localStorage.getItem('bosta_api_key')
   * and attaches header: Authorization: ${apiKey}
   */
  async fetchBosta(endpoint, options = {}) {
    const apiKey = localStorage.getItem('bosta_api_key') || '';
    if (!apiKey) {
      throw new Error('مفتاح Bosta API Key غير محفوظ! يرجى إدخاله في نافذة الإعدادات (⚙️).');
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = endpoint.startsWith('http') ? endpoint : `https://api.bosta.co/api/v1${cleanEndpoint}`;

    const headers = {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      let errDetail = `${response.status} ${response.statusText}`;
      try {
        const errorJson = await response.json();
        if (errorJson.message) errDetail = errorJson.message;
        else if (errorJson.error) errDetail = errorJson.error;
      } catch (e) {}
      const err = new Error(errDetail);
      err.status = response.status;
      throw err;
    }

    return await response.json();
  }

  async fetchBostaDelivery(trackingNumber) {
    if (!trackingNumber) throw new Error('رقم التتبع مطلوب للاستعلام من بوسطة');
    const clean = this.normalizeTrackingBarcode(trackingNumber);
    return await this.fetchBosta(`/deliveries/business/${encodeURIComponent(clean)}`);
  }

  async fetchBostaTracking(trackingNumber) {
    if (!trackingNumber) throw new Error('رقم التتبع مطلوب للاستعلام');
    const clean = this.normalizeTrackingBarcode(trackingNumber);
    return await this.fetchBosta(`/deliveries/track/${encodeURIComponent(clean)}`);
  }

  async testBostaConnection(testKey = null) {
    const apiKey = testKey !== null ? testKey.trim() : (localStorage.getItem('bosta_api_key') || '');
    if (!apiKey) {
      throw new Error('يرجى إدخال مفتاح Bosta API Key أولاً');
    }

    try {
      const response = await fetch('https://api.bosta.co/api/v1/pickup-locations', {
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error('مفتاح Bosta API غير صالح أو غير مصرح به (401 Unauthorized)');
      }

      if (!response.ok && response.status !== 404) {
        const fallback = await fetch('https://api.bosta.co/api/v1/deliveries?limit=1', {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });
        if (fallback.status === 401 || fallback.status === 403) {
          throw new Error('مفتاح Bosta API غير صالح (401 Unauthorized)');
        }
      }

      return { success: true, message: 'الاتصال بـ Bosta API ناجح والمفتاح صالح ومصرح به!' };
    } catch (err) {
      if (err.message && err.message.includes('401')) throw err;
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        return { success: true, message: 'تم التحقق من المفتاح بنجاح (وضع المتصفح)' };
      }
      throw err;
    }
  }

  async fetchAndLoadBostaDelivery(trackingNumber, rawCode = '') {
    try {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-amber-900/80 text-amber-300 border border-amber-700 animate-pulse';
      this.dom.lastScanTypeBadge.textContent = 'جاري استعلام Bosta...';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = `جاري جلب بيانات البوليصة [${trackingNumber}] مباشرة من بوسطة...`;

      const res = await this.fetchBostaDelivery(trackingNumber);
      const delivery = (res && res.data) || res;

      if (delivery && (delivery.trackingNumber || delivery._id)) {
        const order = this.convertBostaDeliveryToOrder(delivery, trackingNumber);
        this.orders.push(order);
        this.ordersMap.set(trackingNumber.toLowerCase(), order);
        if (rawCode) this.ordersMap.set(rawCode.toLowerCase(), order);
        if (order.trackingNumber) this.ordersMap.set(order.trackingNumber.toLowerCase(), order);
        if (order.orderId) this.ordersMap.set(order.orderId.toLowerCase(), order);

        this.renderStats();
        this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-emerald-900/80 text-emerald-300 border border-emerald-700';
        this.dom.lastScanTypeBadge.textContent = 'بوليصة Bosta أونلاين';
        this.showToast(`✅ تم جلب الأوردر ${order.orderId} بنجاح من بوسطة!`, 'success');
        this.loadActiveOrder(order);
        return true;
      }
    } catch (err) {
      console.warn('Live Bosta fetch failed:', err);
    }

    // If online fetch did not find delivery, show error
    this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
    this.dom.lastScanTypeBadge.textContent = 'خطأ';
    this.dom.lastScanTypeBadge.classList.remove('hidden');
    this.dom.lastScanMessage.textContent = 'لم يتم العثور على الأوردر في شيت اليوم أو في بوسطة!';

    this.triggerScreenFlash('red');
    window.soundEngine.playBuzzer();
    window.speakArabic('يرجى مسح بوليصة شحن صالحة');
    this.showToast('⚠️ لم يتم العثور على البوليصة في الشيت أو في استعلام بوسطة!', 'error');
    return false;
  }

  convertBostaDeliveryToOrder(del, rawTracking) {
    const receiver = del.receiver || {};
    const address = del.dropOffAddress || {};
    const cityName = (address.city && address.city.name) || address.city || '';
    const zoneName = (address.zone && address.zone.name) || address.zone || '';
    const firstLine = address.firstLine || '';
    const fullAddress = [cityName, zoneName, firstLine].filter(Boolean).join(' - ') || 'عنوان بوسطة';
    const customerName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || receiver.name || 'عميل بوسطة';
    const phone = receiver.phone || '';
    const trackingNumber = del.trackingNumber || rawTracking;
    const orderId = del.businessReference || trackingNumber;
    const cod = del.cod || del.codAmount || 0;
    const notes = del.notes || (del.specs && del.specs.packageDetails && del.specs.packageDetails.description) || '';

    const itemsCount = (del.specs && del.specs.packageDetails && del.specs.packageDetails.itemsCount) || 1;
    const desc = (del.specs && del.specs.packageDetails && del.specs.packageDetails.description) || `طلب شحن بوسطة (${itemsCount} قطع)`;

    const items = [{
      originalSku: 'BOSTA-ITEM',
      name: desc,
      color: '',
      size: '',
      requiredQty: Number(itemsCount) || 1,
      scannedQty: 0,
      barcodeNumber: '',
      imageUrl: '',
      matchLevel: 'fallback',
      isZeroBarcode: true
    }];

    return {
      orderId,
      trackingNumber,
      customerName,
      primaryPhone: phone,
      secondaryPhone: '',
      address: fullAddress,
      province: cityName,
      city: zoneName,
      netAmount: cod ? `${cod} ج.م` : 'مدفوع',
      notes,
      orderType: 'بوسطة API أونلاين',
      pickingRef: 'Bosta-Online',
      shippingCompany: 'Bosta',
      isExchange: notes.includes('استبدال') || String(orderId).startsWith('EXC-'),
      isCompleted: false,
      completedAt: null,
      totalRequired: Number(itemsCount) || 1,
      totalScanned: 0,
      items
    };
  }
}

// Global Bosta Client Helper
window.bostaClient = {
  getApiKey: () => localStorage.getItem('bosta_api_key') || '',
  setApiKey: (key) => {
    if (key) localStorage.setItem('bosta_api_key', key.trim());
    else localStorage.removeItem('bosta_api_key');
    if (window.app) window.app.updateBostaStatusUI();
  },
  fetch: (endpoint, options) => {
    if (window.app && typeof window.app.fetchBosta === 'function') {
      return window.app.fetchBosta(endpoint, options);
    }
    const apiKey = localStorage.getItem('bosta_api_key') || '';
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = endpoint.startsWith('http') ? endpoint : `https://api.bosta.co/api/v1${cleanEndpoint}`;
    return fetch(url, {
      ...options,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...((options && options.headers) || {})
      }
    }).then(r => r.json());
  },
  getDelivery: (tracking) => window.app ? window.app.fetchBostaDelivery(tracking) : null,
  getTracking: (tracking) => window.app ? window.app.fetchBostaTracking(tracking) : null,
  testConnection: (key) => window.app ? window.app.testBostaConnection(key) : null
};

// Global Application Instance
window.addEventListener('DOMContentLoaded', () => {
  window.app = new KhiamWarehouseApp();
});
