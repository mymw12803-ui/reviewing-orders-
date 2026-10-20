/**
 * Khiam Store - Operix & Bosta Content Script (Manifest V3)
 * Runs on:
 *  - https://khiiam.operix.co/stock/picking/view/*
 *  - https://*.operix.co/*
 *  - https://*.bosta.co/*
 *
 * Adds 1-click floating action button to harvest the current picking batch
 * and transfer it seamlessly to the Khiam Barcode Verification System.
 */

(() => {
  console.log('[Khiam Store Extension] Initialized on:', window.location.href);

  // Floating Button Injection
  function injectOperixBatchButton() {
    if (document.getElementById('khiam-batch-export-btn')) return;

    // Check if we are on Operix picking view
    const isPickingView = window.location.href.includes('/stock/picking/view') || 
                          window.location.href.includes('/stock/picking') ||
                          document.querySelector('table');

    const btn = document.createElement('button');
    btn.id = 'khiam-batch-export-btn';
    btn.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🚀</span>
        <span>إرسال الدفعة إلى شاشة الفحص بالباركود</span>
      </div>
    `;

    Object.assign(btn.style, {
      position: 'fixed',
      top: '16px',
      left: '20px',
      zIndex: '9999999',
      backgroundColor: '#b91c1c',
      backgroundImage: 'linear-gradient(135deg, #b91c1c, #991b1b)',
      color: '#ffffff',
      fontWeight: 'bold',
      fontSize: '13px',
      padding: '10px 18px',
      borderRadius: '14px',
      border: '2px solid rgba(255,255,255,0.4)',
      boxShadow: '0 8px 25px rgba(0,0,0,0.35)',
      cursor: 'pointer',
      fontFamily: 'Cairo, sans-serif, system-ui',
      transition: 'all 0.2s ease',
      direction: 'rtl'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px) scale(1.02)';
      btn.style.boxShadow = '0 12px 30px rgba(185,28,28,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0) scale(1)';
      btn.style.boxShadow = '0 8px 25px rgba(0,0,0,0.35)';
    });

    btn.addEventListener('click', () => {
      handleBatchExtraction(btn);
    });

    document.body.appendChild(btn);
  }

  /**
   * Scrapes the Operix picking table and sends rows to the Barcode Verifier
   */
  function handleBatchExtraction(btn) {
    btn.innerHTML = '⏳ جاري استخراج بيانات الدفعة...';

    const orders = [];
    const tables = document.querySelectorAll('table');

    tables.forEach(table => {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(tr => {
        const text = tr.innerText.trim();
        if (!text) return;

        // Try extracting Order ID, Customer, and products
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
        if (cells.length >= 3) {
          orders.push({
            rawCells: cells,
            textSnippet: text
          });
        }
      });
    });

    console.log(`[Khiam Extension] Scraped ${orders.length} potential rows from Operix.`);

    // Send payload to background service worker to open index.html
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'OPEN_SCANNER_WITH_DATA',
        payload: {
          scrapedAt: new Date().toISOString(),
          sourceUrl: window.location.href,
          ordersCount: orders.length,
          orders: orders
        }
      }, (resp) => {
        btn.innerHTML = '✅ تم الإرسال! جاري الفتح...';
        setTimeout(() => {
          btn.innerHTML = '🚀 إرسال الدفعة إلى شاشة الفحص بالباركود';
        }, 3000);
      });
    } else {
      alert('تم استخراج البيانات، يرجى فتح شاشة الفحص من أيقونة الإضافة.');
    }
  }

  // Run on load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectOperixBatchButton();
  } else {
    window.addEventListener('DOMContentLoaded', injectOperixBatchButton);
  }

  // Observe SPA navigation in Operix
  const observer = new MutationObserver(() => {
    injectOperixBatchButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
