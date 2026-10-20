/**
 * Khiam Store - Warehouse Order & Barcode Verification Engine
 * Manifest V3 + Web Audio + Shopify Catalog + PDF Bosta Reader
 */

class KhiamWarehouseApp {
  constructor() {
    this.orders = [];
    this.ordersMap = new Map(); // tracking/orderId -> order
    this.activeOrder = null;
    this.completedHistory = this.loadHistory();
    this.pdfNotesMap = new Map(); // tracking -> special note extracted from PDF

    // Modes & states
    this.isLookupMode = false;

    // Barcode scanner HID capture buffer
    this.scanBuffer = '';
    this.lastCharTime = 0;
    this.scannerTimeout = null;

    // DOM Elements Cache
    this.dom = {};
    this.initElements();
    this.bindEvents();
    this.renderStats();
    this.renderHistory();
    this.initCatalogIntegration();
    this.checkIncomingOperixBatch();
  }

  // ----------------------------------------------------
  // 1. DOM Elements Initializer
  // ----------------------------------------------------
  initElements() {
    const ids = [
      'flashOverlay', 'scannerStatusBadge', 'scannerStatusText',
      'loadedOrdersCount', 'completedOrdersTodayCount', 'toggleSoundBtn',
      'soundIconOn', 'soundIconOff', 'testAudioBtn', 'openHistoryBtn',
      'toastContainer', 'toastContent', 'csvFileInput', 'csvFileName',
      'loadSampleCsvBtn', 'syncShopifyQuickBtn', 'manualScanForm', 'manualBarcodeInput',
      'lastScanHud', 'lastScannedCodeDisplay', 'lastScanTypeBadge', 'lastScanMessage',
      'noOrderState', 'activeOrderContainer', 'exchangeBadge', 'orderCompleteBanner',
      'nextOrderBtn', 'orderIdDisplay', 'orderTrackingDisplay', 'customerNameDisplay',
      'customerPhoneDisplay', 'shippingCompanyDisplay', 'pickingRefDisplay',
      'scannedTotalDisplay', 'requiredTotalDisplay', 'percentBadge', 'progressText',
      'orderProgressBar', 'productTypesCount', 'productCardsGrid',
      'historyModal', 'closeHistoryBtn', 'clearHistoryBtn', 'exportHistoryCsvBtn',
      'historyTableBody', 'emptyHistoryState', 'audioTestModal', 'closeAudioModalBtn',
      'testSoundOrder', 'testSoundSuccess', 'testSoundComplete', 'testSoundError',
      // Catalog & Lightbox
      'openCatalogModalBtn', 'closeCatalogModalBtn', 'catalogModal',
      'modalProductsCount', 'modalVariantsCount', 'modalLastSyncText',
      'shopifyDomainInput', 'startSyncCatalogBtn', 'exportCatalogJsonBtn',
      'importCatalogJsonInput', 'syncProgressContainer', 'syncProgressStatus',
      'syncProgressPage', 'syncProgressBar', 'headerCatalogCount',
      'imageLightboxModal', 'closeLightboxBtn', 'lightboxImg',
      'lightboxTitle', 'lightboxSku', 'lightboxMatchBadge',
      // PDF & Compact Stats & Lookup Mode Elements
      'pdfFileInput', 'bostaPdfNotesAlert', 'bostaPdfNotesText',
      'pdfNotesCountBadge', 'pdfNotesCountNum',
      'compactTotalOrders', 'compactCompletedOrders', 'compactTotalOrdersDenom',
      'compactRemainingOrders', 'openRemainingBtn',
      'quickSearchInput', 'quickSearchResults',
      'remainingOrdersModal', 'closeRemainingModalBtn', 'remainingFilterInput',
      'remainingTableBody', 'emptyRemainingState',
      'toggleLookupModeBtn', 'lookupModeBtnText',
      'productLookupModal', 'closeLookupModalBtn',
      'lookupProductImg', 'lookupProductTitle', 'lookupProductSku',
      'lookupMatchLevel', 'lookupBadges', 'lookupOrdersList'
    ];

    ids.forEach(id => {
      this.dom[id] = document.getElementById(id);
    });
  }

  // ----------------------------------------------------
  // 2. Arabic Keyboard Converter (100% Accuracy)
  // ----------------------------------------------------
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

  transliterateArabicString(str) {
    if (!str) return '';
    const map = {
      'ش': 'a', 'لا': 'b', 'لآ': 'b', 'لأ': 'b', 'لإ': 'b',
      'ؤ': 'c', 'ي': 'd', 'ث': 'e', 'ب': 'f', 'ل': 'g',
      'ا': 'h', 'أ': 'h', 'إ': 'h', 'آ': 'h',
      'ه': 'i', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ة': 'm',
      'ى': 'n', 'خ': 'o', 'ح': 'p', 'ض': 'q', 'ق': 'r',
      'س': 's', 'ف': 't', 'ع': 'u', 'ر': 'v', 'ص': 'w',
      'ء': 'x', 'غ': 'y', 'ئ': 'z', 'ذ': '`', 'ط': '\'',
      'ك': ';', 'ظ': '/', 'ز': '.', 'و': ',', 'د': ']',
      'ج': '[', 'ـ': '-',
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };

    let result = '';
    let normalized = str.replace(/لا/g, 'b');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      result += map[char] !== undefined ? map[char] : char;
    }
    return result;
  }

  // ----------------------------------------------------
  // 3. Events Binding & Listeners
  // ----------------------------------------------------
  bindEvents() {
    // Global Scanner HID Listener
    window.addEventListener('keydown', (e) => {
      const targetTag = e.target.tagName;
      if (targetTag === 'INPUT' && e.target.id !== 'manualBarcodeInput') {
        return;
      }
      if (targetTag === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.scanBuffer.trim().length > 0) {
          const scannedCode = this.scanBuffer.trim();
          this.scanBuffer = '';
          this.handleScannedCode(scannedCode);
        }
        return;
      }

      if (e.key.length === 1) {
        const mappedChar = this.mapEventKey(e);
        this.scanBuffer += mappedChar;

        clearTimeout(this.scannerTimeout);
        this.scannerTimeout = setTimeout(() => {
          this.scanBuffer = '';
        }, 300);
      }
    });

    // Manual input form
    this.dom.manualScanForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.dom.manualBarcodeInput.value.trim();
      if (val) {
        const cleanVal = this.transliterateArabicString(val);
        this.handleScannedCode(cleanVal);
        this.dom.manualBarcodeInput.value = '';
      }
    });

    // CSV File Upload
    this.dom.csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.parseCsvFile(file);
      }
    });

    // PDF Bosta Notes File Upload
    this.dom.pdfFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.parseBostaPdf(file);
      }
    });

    // Demo Data
    this.dom.loadSampleCsvBtn.addEventListener('click', () => {
      this.loadSampleData();
    });

    // Sound controls
    this.dom.toggleSoundBtn.addEventListener('click', () => {
      const isMuted = window.soundEngine.toggleMute();
      this.dom.soundIconOn.classList.toggle('hidden', isMuted);
      this.dom.soundIconOff.classList.toggle('hidden', !isMuted);
      this.showToast(isMuted ? 'تم كتم الصوت' : 'تم تفعيل الصوت', isMuted ? 'warning' : 'success');
    });

    // Audio Test Modal
    this.dom.testAudioBtn.addEventListener('click', () => {
      this.dom.audioTestModal.classList.remove('hidden');
    });
    this.dom.closeAudioModalBtn.addEventListener('click', () => {
      this.dom.audioTestModal.classList.add('hidden');
    });
    this.dom.testSoundOrder.addEventListener('click', () => window.soundEngine.playOrderLoadedSound());
    this.dom.testSoundSuccess.addEventListener('click', () => window.soundEngine.playProductSuccessSound());
    this.dom.testSoundComplete.addEventListener('click', () => window.soundEngine.playOrderCompleteSound());
    this.dom.testSoundError.addEventListener('click', () => window.soundEngine.playErrorSound());

    // History Modal
    this.dom.openHistoryBtn.addEventListener('click', () => {
      this.renderHistory();
      this.dom.historyModal.classList.remove('hidden');
    });
    this.dom.closeHistoryBtn.addEventListener('click', () => {
      this.dom.historyModal.classList.add('hidden');
    });
    this.dom.clearHistoryBtn.addEventListener('click', () => {
      if (confirm('هل أنت متأكد من مسح سجل تحضير الأوردرات اليوم؟')) {
        this.completedHistory = [];
        this.saveHistory();
        this.renderHistory();
        this.renderStats();
        this.showToast('تم مسح السجل بنجاح', 'info');
      }
    });
    this.dom.exportHistoryCsvBtn.addEventListener('click', () => {
      this.exportHistoryCsv();
    });

    // Next Order
    this.dom.nextOrderBtn.addEventListener('click', () => {
      this.activeOrder = null;
      this.renderActiveOrder();
      this.showToast('في انتظار مسح بوليصة الأوردر التالي', 'info');
    });

    // Catalog Modal
    const openCatalogModal = () => {
      this.updateCatalogCounters();
      this.dom.catalogModal.classList.remove('hidden');
    };
    this.dom.openCatalogModalBtn.addEventListener('click', openCatalogModal);
    this.dom.syncShopifyQuickBtn.addEventListener('click', openCatalogModal);
    this.dom.closeCatalogModalBtn.addEventListener('click', () => {
      this.dom.catalogModal.classList.add('hidden');
    });
    this.dom.startSyncCatalogBtn.addEventListener('click', async () => {
      await this.runShopifyCatalogSync();
    });
    this.dom.exportCatalogJsonBtn.addEventListener('click', () => {
      try {
        window.catalogManager.exportCatalogJson();
        this.showToast('تم تصدير ملف الكتالوج بنجاح!', 'success');
      } catch (e) {
        this.showToast(e.message, 'warning');
      }
    });
    this.dom.importCatalogJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = await window.catalogManager.importCatalogJson(text);
        this.updateCatalogCounters();
        this.showToast(`تم استيراد ${res.productsCount} منتج و ${res.variantsCount} كود SKU بنجاح!`, 'success');
        if (this.activeOrder) {
          this.renderProductCards();
        }
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Lightbox modal close
    this.dom.closeLightboxBtn.addEventListener('click', () => {
      this.dom.imageLightboxModal.classList.add('hidden');
    });
    this.dom.imageLightboxModal.addEventListener('click', (e) => {
      if (e.target === this.dom.imageLightboxModal) {
        this.dom.imageLightboxModal.classList.add('hidden');
      }
    });

    // Remaining Orders Modal Triggers
    this.dom.openRemainingBtn.addEventListener('click', () => {
      this.renderRemainingOrders();
      this.dom.remainingOrdersModal.classList.remove('hidden');
    });
    this.dom.closeRemainingModalBtn.addEventListener('click', () => {
      this.dom.remainingOrdersModal.classList.add('hidden');
    });
    this.dom.remainingFilterInput.addEventListener('input', (e) => {
      this.renderRemainingOrders(e.target.value.trim());
    });

    // Quick Search Input
    this.dom.quickSearchInput.addEventListener('input', (e) => {
      this.handleQuickSearch(e.target.value.trim());
    });
    document.addEventListener('click', (e) => {
      if (!this.dom.quickSearchInput.contains(e.target) && !this.dom.quickSearchResults.contains(e.target)) {
        this.dom.quickSearchResults.classList.add('hidden');
      }
    });

    // Product Lookup Mode Toggle
    this.dom.toggleLookupModeBtn.addEventListener('click', () => {
      this.isLookupMode = !this.isLookupMode;
      if (this.isLookupMode) {
        this.dom.toggleLookupModeBtn.className = 'flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-lg shadow-cyan-900/40 ring-2 ring-cyan-400 animate-pulse';
        this.dom.lookupModeBtnText.textContent = 'وضع الاستعلام نشط 🟢';
        this.showToast('🔍 تم تفعيل وضع استعلام عن منتج! امسح أي قطعة لمعرفة أوردراتها وتفاصيلها.', 'info');
      } else {
        this.dom.toggleLookupModeBtn.className = 'flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-200 transition';
        this.dom.lookupModeBtnText.textContent = 'استعلام عن منتج';
        this.showToast('تم الرجوع لوضع فحص وتجهيز الأوردرات العادي.', 'info');
      }
    });
    this.dom.closeLookupModalBtn.addEventListener('click', () => {
      this.dom.productLookupModal.classList.add('hidden');
    });
  }

  // ----------------------------------------------------
  // 4. PDF.js Bosta Shipping Label Notes Extractor
  // ----------------------------------------------------
  /**
   * Reads Bosta PDF labels using PDF.js and extracts special notes
   * (e.g. 'تغيير الموديل Ab056a0 - اسدال عباية - اسود' or 'ملاحظات: ...')
   */
  async parseBostaPdf(file) {
    if (!window.pdfjsLib) {
      this.showToast('مكتبة PDF.js غير متوفرة حالياً!', 'error');
      return;
    }

    this.showToast('جاري قراءة ملف بوالص PDF واستخراج الملاحظات...', 'info');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      let notesFoundCount = 0;

      for (let p = 1; p <= numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const fullPageText = textContent.items.map(item => item.str).join(' ');

        // 1. Extract Tracking Number (Bosta pattern e.g. G-09-8007640884 or 8 to 12 digits)
        let tracking = '';
        const bostaMatch = fullPageText.match(/([A-Za-z]-\d{2}-\d{7,12})/);
        if (bostaMatch) {
          tracking = bostaMatch[1];
        } else {
          const digitsMatch = fullPageText.match(/\b(\d{8,12})\b/);
          if (digitsMatch) {
            tracking = digitsMatch[1];
          }
        }

        // 2. Extract Notes (Look for 'ملاحظات' or 'Notes' or 'ملاحظة')
        const noteMatch = fullPageText.match(/(?:ملاحظات|ملاحظة|Notes?)\s*[:|]?\s*([^\n\r]+?)(?:الراسل|المستلم|Receiver|Sender|Bosta|$)/i);
        if (noteMatch && tracking) {
          const rawNote = noteMatch[1].trim();
          if (rawNote.length > 2) {
            const cleanNote = rawNote.replace(/^[:|\-\s]+/, '').trim();
            const normalized = this.normalizeTrackingBarcode(tracking);

            this.pdfNotesMap.set(normalized.toLowerCase(), cleanNote);
            this.pdfNotesMap.set(tracking.toLowerCase(), cleanNote);
            notesFoundCount++;
          }
        }
      }

      this.dom.pdfNotesCountBadge.classList.remove('hidden');
      this.dom.pdfNotesCountNum.textContent = this.pdfNotesMap.size;

      this.showToast(`تم استخراج ${notesFoundCount} ملاحظة خاصة من ${numPages} بوليصة PDF بنجاح!`, 'success');
      window.soundEngine.playProductSuccessSound();

      // If active order is currently on screen, refresh its notes alert
      if (this.activeOrder) {
        this.renderActiveOrder();
      }
    } catch (err) {
      console.error('PDF parsing error:', err);
      this.showToast('حدث خطأ أثناء قراءة ملف PDF: ' + err.message, 'error');
      window.soundEngine.playErrorSound();
    }
  }

  // ----------------------------------------------------
  // 5. Check Incoming Operix Batch (Chrome Extension Bridge)
  // ----------------------------------------------------
  checkIncomingOperixBatch() {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('khiam_incoming_batch', (res) => {
        if (res && res.khiam_incoming_batch) {
          const batch = res.khiam_incoming_batch;
          console.log('[Khiam Store] Loaded batch from Operix:', batch);
          this.showToast(`🚀 تم استلام دفعة جديدة من أوبريكس (${batch.ordersCount} أوردر)!`, 'success');
          // Clear storage to avoid reloading on refresh
          chrome.storage.local.remove('khiam_incoming_batch');
        }
      });
    }
  }

  // ----------------------------------------------------
  // 6. Compact Stats Bar & Search Logic
  // ----------------------------------------------------
  renderStats() {
    const total = this.orders.length;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = this.completedHistory.filter(h => h.date === today).length;
    const remaining = Math.max(0, total - todayCount);

    // Header counters
    this.dom.loadedOrdersCount.textContent = total;
    this.dom.completedOrdersTodayCount.textContent = todayCount;

    // Compact Bar counters
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

    const cleanQ = query.toLowerCase();
    const matches = this.orders.filter(ord => 
      ord.orderId.toLowerCase().includes(cleanQ) ||
      ord.customerName.toLowerCase().includes(cleanQ) ||
      ord.primaryPhone.includes(cleanQ) ||
      ord.trackingNumber.toLowerCase().includes(cleanQ)
    ).slice(0, 8);

    if (matches.length === 0) {
      resBox.innerHTML = '<div class="p-3 text-slate-400 text-center">لا توجد أوردرات مطابقة</div>';
      resBox.classList.remove('hidden');
      return;
    }

    resBox.innerHTML = '';
    matches.forEach(ord => {
      const itemEl = document.createElement('div');
      itemEl.className = 'p-2.5 hover:bg-slate-800 cursor-pointer flex items-center justify-between transition';
      itemEl.innerHTML = `
        <div>
          <span class="font-bold text-white">${ord.orderId}</span>
          <span class="text-slate-400 text-[11px] mr-2">(${ord.customerName})</span>
        </div>
        <div class="text-left font-mono text-[11px]">
          <span class="text-amber-400">${ord.trackingNumber}</span>
          <span class="text-emerald-400 font-bold mr-2">${ord.totalRequired} قطع</span>
        </div>
      `;
      itemEl.addEventListener('click', () => {
        this.loadActiveOrder(ord);
        resBox.classList.add('hidden');
        this.dom.quickSearchInput.value = '';
      });
      resBox.appendChild(itemEl);
    });

    resBox.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // 7. Remaining Orders Modal
  // ----------------------------------------------------
  renderRemainingOrders(filterText = '') {
    const tbody = this.dom.remainingTableBody;
    tbody.innerHTML = '';

    const remaining = this.orders.filter(ord => !ord.isCompleted);
    const cleanFilter = filterText ? filterText.toLowerCase() : '';

    const filtered = remaining.filter(ord => 
      !cleanFilter || 
      ord.orderId.toLowerCase().includes(cleanFilter) ||
      ord.customerName.toLowerCase().includes(cleanFilter) ||
      ord.trackingNumber.toLowerCase().includes(cleanFilter)
    );

    if (filtered.length === 0) {
      this.dom.emptyRemainingState.classList.remove('hidden');
      return;
    }

    this.dom.emptyRemainingState.classList.add('hidden');

    filtered.forEach((ord, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/50 transition';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-white">${ord.orderId}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400 font-bold">${ord.trackingNumber}</td>
        <td class="py-2.5 px-3 text-slate-300 truncate max-w-[150px]">${ord.customerName}</td>
        <td class="py-2.5 px-3 font-mono text-emerald-400 font-bold">${ord.totalRequired}</td>
        <td class="py-2.5 px-3 text-center">
          <button class="select-order-btn bg-slate-800 hover:bg-rose-600 text-white px-2.5 py-1 rounded-lg font-bold text-xs transition">
            فتح الأوردر 👈
          </button>
        </td>
      `;

      tr.querySelector('.select-order-btn').addEventListener('click', () => {
        this.loadActiveOrder(ord);
        this.dom.remainingOrdersModal.classList.add('hidden');
      });

      tbody.appendChild(tr);
    });
  }

  // ----------------------------------------------------
  // 8. Product Lookup Mode ("وضع استعلام عن منتج")
  // ----------------------------------------------------
  handleProductLookup(scannedSku) {
    const cleanSku = scannedSku.trim().toLowerCase();
    const details = window.catalogManager.getProductImageAndDetails(cleanSku, '');

    // Find all orders in today's sheet containing this product
    const matchingOrders = [];
    this.orders.forEach(ord => {
      const foundItem = ord.items.find(item => 
        item.sku === cleanSku || 
        window.catalogManager.extractModelPrefix(item.sku) === window.catalogManager.extractModelPrefix(cleanSku)
      );
      if (foundItem) {
        matchingOrders.push({
          order: ord,
          neededQty: foundItem.requiredQty,
          scannedQty: foundItem.scannedQty
        });
      }
    });

    // Populate lookup modal
    this.dom.lookupProductImg.src = details.imageUrl;
    this.dom.lookupProductTitle.textContent = details.title || 'منتج غير مسجل';
    this.dom.lookupProductSku.textContent = `SKU: ${scannedSku}`;
    this.dom.lookupMatchLevel.textContent = details.matchLevel === 'exact' ? '✓ تطابق تام' : '🔍 صورة تقريبية للموديل';

    // Parse Badges
    const parsed = this.parseProductDetails(details.title);
    let badgesHtml = '';
    if (parsed.color) {
      badgesHtml += `<span class="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold px-2.5 py-0.5 rounded-lg">اللون: ${parsed.color}</span>`;
    }
    if (parsed.size) {
      badgesHtml += `<span class="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold px-2.5 py-0.5 rounded-lg">المقاس: ${parsed.size}</span>`;
    }
    this.dom.lookupBadges.innerHTML = badgesHtml;

    // Populate Orders List
    const list = this.dom.lookupOrdersList;
    list.innerHTML = '';

    if (matchingOrders.length === 0) {
      list.innerHTML = '<div class="p-3 bg-slate-950 text-slate-400 text-xs text-center rounded-xl">هذا الصنف غير مطلوب في أي أوردر ضمن شيت اليوم المرفوع.</div>';
    } else {
      matchingOrders.forEach(m => {
        const itemEl = document.createElement('div');
        itemEl.className = 'bg-slate-950 hover:bg-slate-800 p-3 rounded-xl border border-slate-800 flex items-center justify-between cursor-pointer transition';
        itemEl.innerHTML = `
          <div>
            <div class="font-bold text-white text-xs">${m.order.orderId} - <span class="text-slate-300 font-normal">${m.order.customerName}</span></div>
            <div class="text-[11px] text-slate-400 font-mono">بوليصة: ${m.order.trackingNumber}</div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs font-bold text-amber-300">مطلوب: ${m.neededQty} قطعة</span>
            <button class="bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg">
              فتح 👈
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
    window.soundEngine.playOrderLoadedSound();
  }

  // ----------------------------------------------------
  // 9. Master Barcode Scanner Engine
  // ----------------------------------------------------
  handleScannedCode(rawCode) {
    if (!rawCode) return;
    const cleanCode = rawCode.trim();
    const lowerCode = cleanCode.toLowerCase();
    const normalizedTracking = this.normalizeTrackingBarcode(cleanCode).toLowerCase();

    this.dom.lastScannedCodeDisplay.textContent = cleanCode;

    // IF in "Product Lookup Mode", intercept all product scans!
    if (this.isLookupMode) {
      this.handleProductLookup(cleanCode);
      return;
    }

    // STEP 1: Check Bosta Tracking / Order ID
    let matchedOrder = null;
    if (this.ordersMap.has(normalizedTracking)) {
      matchedOrder = this.ordersMap.get(normalizedTracking);
    } else if (this.ordersMap.has(lowerCode)) {
      matchedOrder = this.ordersMap.get(lowerCode);
    }

    if (matchedOrder) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-cyan-900/80 text-cyan-300 border border-cyan-700';
      this.dom.lastScanTypeBadge.textContent = 'بوليصة شحن';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = `تم فتح الأوردر: ${matchedOrder.orderId} (${matchedOrder.customerName})`;

      this.loadActiveOrder(matchedOrder);
      return;
    }

    // STEP 2: Check Active Order
    if (!this.activeOrder) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
      this.dom.lastScanTypeBadge.textContent = 'خطأ';
      this.dom.lastScanTypeBadge.classList.remove('hidden');
      this.dom.lastScanMessage.textContent = 'يرجى مسح بوليصة الشحن (Bosta Tracking) أولاً لفتح الأوردر!';

      this.triggerScreenFlash('red');
      window.soundEngine.playErrorSound();
      this.showToast('⚠️ يرجى مسح بوليصة الشحن (Bosta Tracking) أولاً لفتح الأوردر!', 'error');
      return;
    }

    // STEP 3: Verify SKU against active order items
    this.verifyProductSku(cleanCode);
  }

  loadActiveOrder(order) {
    this.activeOrder = order;
    window.soundEngine.playOrderLoadedSound();
    this.renderActiveOrder();
    this.showToast(`تم فتح أوردر: ${order.orderId}`, 'info');
  }

  verifyProductSku(scannedSku) {
    const cleanSku = scannedSku.trim().toLowerCase();
    const items = this.activeOrder.items;

    let matchedItem = items.find(item => item.sku === cleanSku);

    if (!matchedItem) {
      const scannedPrefix = window.catalogManager.extractModelPrefix(cleanSku);
      if (scannedPrefix && scannedPrefix.length >= 4) {
        matchedItem = items.find(item => {
          const itemPrefix = window.catalogManager.extractModelPrefix(item.sku);
          return itemPrefix === scannedPrefix;
        });
      }
    }

    if (!matchedItem) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-rose-900/80 text-rose-300 border border-rose-700';
      this.dom.lastScanTypeBadge.textContent = 'صنف غير مطلوب';
      this.dom.lastScanMessage.textContent = `الكود [${scannedSku}] غير موجود في هذا الأوردر!`;

      this.triggerScreenFlash('red');
      window.soundEngine.playErrorSound();
      this.showToast(`⛔ كود خطأ: الصنف [${scannedSku}] غير موجود في هذا الأوردر!`, 'error');
      return;
    }

    if (matchedItem.scannedQty >= matchedItem.requiredQty) {
      this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-amber-900/80 text-amber-300 border border-amber-700';
      this.dom.lastScanTypeBadge.textContent = 'مكتمل مسبقاً';
      this.dom.lastScanMessage.textContent = `تم مسح العدد المطلوب بالكامل من: ${matchedItem.name}`;

      this.triggerCardFlash(matchedItem.sku, 'red');
      window.soundEngine.playErrorSound();
      this.showToast(`⚠️ تم مسح العدد المطلوب من هذا المنتج مسبقاً! (${matchedItem.requiredQty}/${matchedItem.requiredQty})`, 'warning');
      return;
    }

    // Success scan
    matchedItem.scannedQty++;
    this.activeOrder.totalScanned++;

    if (matchedItem.scannedQty === matchedItem.requiredQty) {
      matchedItem.isCompleted = true;
    }

    const isAllComplete = this.activeOrder.totalScanned === this.activeOrder.totalRequired;

    this.dom.lastScanTypeBadge.className = 'font-bold px-2 py-0.5 rounded text-[11px] bg-emerald-900/80 text-emerald-300 border border-emerald-700';
    this.dom.lastScanTypeBadge.textContent = 'صنف صحيح';
    this.dom.lastScanMessage.textContent = `تم مسح: ${matchedItem.name} (${matchedItem.scannedQty}/${matchedItem.requiredQty})`;

    this.updateOrderProgress();
    this.renderSingleProductCard(matchedItem);

    if (isAllComplete) {
      this.activeOrder.isCompleted = true;
      this.triggerScreenFlash('green');
      window.soundEngine.playOrderCompleteSound();
      this.dom.orderCompleteBanner.classList.remove('hidden');
      this.recordOrderCompletion(this.activeOrder);
      this.showToast('🎉 رائع! تم استيفاء واجتياز الأوردر بالكامل بنجاح 100%', 'success');
    } else {
      this.triggerCardFlash(matchedItem.sku, 'green');
      window.soundEngine.playProductSuccessSound();
      this.showToast(`✅ تم مسح: ${matchedItem.name} (${matchedItem.scannedQty}/${matchedItem.requiredQty})`, 'success');
    }
  }

  // ----------------------------------------------------
  // 10. Visual Flash & Feedback
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

    const ringClass = color === 'green' ? 'ring-emerald-500' : 'ring-rose-500';
    const bgClass = color === 'green' ? 'bg-emerald-950/40' : 'bg-rose-950/40';

    card.classList.add('ring-4', ringClass, bgClass);
    setTimeout(() => {
      card.classList.remove('ring-4', ringClass, bgClass);
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
  // 11. Active Order UI & Product Cards
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

    // Exchange order badge
    if (order.isExchange) {
      this.dom.exchangeBadge.classList.remove('hidden');
    } else {
      this.dom.exchangeBadge.classList.add('hidden');
    }

    // Check PDF Special Notes for this Tracking Number
    const pdfNote = this.pdfNotesMap.get(order.normalizedTracking.toLowerCase()) || 
                    this.pdfNotesMap.get((order.trackingNumber || '').toLowerCase());

    if (pdfNote) {
      this.dom.bostaPdfNotesAlert.classList.remove('hidden');
      this.dom.bostaPdfNotesText.textContent = pdfNote;
    } else {
      this.dom.bostaPdfNotesAlert.classList.add('hidden');
    }

    // Complete banner state
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
        imgContainer.addEventListener('click', () => {
          this.openImageLightbox(item);
        });
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
        imgContainer.addEventListener('click', () => {
          this.openImageLightbox(item);
        });
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
  // 12. History Tracking & Persistence
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
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
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
  // 13. Catalog UI Integration & Preloading
  // ----------------------------------------------------
  async initCatalogIntegration() {
    setTimeout(() => {
      this.updateCatalogCounters();
    }, 600);
  }

  updateCatalogCounters() {
    const stats = window.catalogManager.stats || {};
    const totalVariants = stats.totalVariants || window.catalogManager.variantsBySku.size || 0;
    const totalProducts = stats.totalProducts || window.catalogManager.productsList.length || 0;

    this.dom.headerCatalogCount.textContent = totalVariants;
    this.dom.modalProductsCount.textContent = totalProducts;
    this.dom.modalVariantsCount.textContent = totalVariants;

    if (stats.lastSync) {
      const d = new Date(stats.lastSync);
      this.dom.modalLastSyncText.textContent = d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    } else {
      this.dom.modalLastSyncText.textContent = totalVariants > 0 ? 'مخزن محلياً' : 'لم تتم بعد';
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
      this.showToast(`تمت مزامنة ${result.variantsCount} كود SKU وصورها بنجاح!`, 'success');
      window.soundEngine.playProductSuccessSound();

      if (this.activeOrder) {
        this.renderProductCards();
      }
    } catch (err) {
      console.error('Catalog sync failed:', err);
      progressStatus.textContent = 'حدث خطأ: ' + err.message;
      this.showToast('فشل سحب الكتالوج: ' + err.message, 'error');
      window.soundEngine.playErrorSound();
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
  // 14. CSV File Parsing & Tracking Normalization
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
        window.soundEngine.playErrorSound();
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

      if (!orderId && !trackingNumber && !productsRaw) {
        return;
      }

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
        isCompleted: false
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
    this.showToast(`تم تحميل ${this.orders.length} أوردر بنجاح! جاري تحضير الصور في الذاكرة...`, 'success');
    window.soundEngine.playOrderLoadedSound();

    const preloaded = await window.catalogManager.preloadImagesForOrders(this.orders);
    if (preloaded > 0) {
      this.showToast(`⚡ تم تحميل ${preloaded} صورة منتج في الذاكرة لتظهر بـ 0ms أثناء الفحص!`, 'success');
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
    if (bostaPrefixMatch) {
      return bostaPrefixMatch[1];
    }

    const dashedMatch = clean.match(/^[A-Za-z0-9]+-[A-Za-z0-9]+-(\d{6,14})$/);
    if (dashedMatch) {
      return dashedMatch[1];
    }

    const pureDigitsMatch = clean.match(/^(\d{7,14})$/);
    if (pureDigitsMatch) {
      return pureDigitsMatch[1];
    }

    return clean.replace(/\s+/g, '');
  }

  // ----------------------------------------------------
  // 15. Sample Demo Data
  // ----------------------------------------------------
  loadSampleData() {
    const sampleCsv = `Order ID,Customer Name,Primary Phone Number,Secondary Phone Number,Products,SKUs,Picking Reference,Shipping Company,Tracking Number
10488,سارة أحمد مصطفى,01012345678,01123456789,"[2] خمار بأكمام سادة - بتنجاني / الثاني | aa011f6\n[1] خمار بأكمام سادة - كشميري / الثاني | aa011e6",aa011f6,PICK-001,Bosta,8007640884
EXC-10492,منى عبد الرحمن محمود,01287654321,,"[1] فستان كتان صيفي مطرز - كحلي / L | Ab056a0\n[2] طقم صلاه اطفالي مشجر - بينك / المقاس الثالث | ba51ei3",Ab056a0,PICK-002,Bosta,G-09-8251439823
10501,نورهان طارق السيد,01599887766,01099887766,"[1] عباية كريب ملكي كلوش - أسود / 56 | Ac010bn9",Ac010bn9,PICK-003,Bosta,E-07-357595273`;

    // Add a sample PDF note for demo
    this.pdfNotesMap.set('8007640884', 'تغيير الموديل Ab056a0 - اسدال عباية - اسود / برجاء معاينة الشحنة قبل الاستلام');
    this.pdfNotesMap.set('8251439823', 'أوردر استبدال عاجل - استلام المرتجع أولاً');
    this.dom.pdfNotesCountBadge.classList.remove('hidden');
    this.dom.pdfNotesCountNum.textContent = '2';

    Papa.parse(sampleCsv, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        this.dom.csvFileName.textContent = 'بيانات تجريبية (Demo)';
        this.processParsedCsv(results.data);
      }
    });
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new KhiamWarehouseApp();
});
