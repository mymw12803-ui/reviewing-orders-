/**
 * Rebuilds builtin_barcode_map.js from a label PDF + products-cache.json (Shopify).
 * Usage: node tools/build-barcode-map.js "<labels.pdf>"
 *
 * - Every label: first text = SKU (or 00000000 when the variant has no SKU), last = 9-digit barcode.
 * - Names/images come from Shopify by SKU; SKU-less labels are matched to SKU-less Shopify variants by name.
 * - The barcode IMAGE on every label is decoded (Code128) and compared with the printed number:
 *   isZeroBarcode is set only when the bars do not scan as the printed 9-digit barcode
 *   (e.g. the old damaged batch whose bars encoded 00000000).
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pdfjs = require(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));

// Same logic as CatalogManager.reconstructLabelLines in catalog.js
function reconstructLabelLines(items) {
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
    // Arabic labels are RTL: read right-to-left, add a space where glyphs are visibly apart
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


// ---- Code128 decoder for the label's barcode image (verifies what a scanner will read) ----
const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'.split(' ');
function decodeCode128Runs(runs) {
  const vals = [];
  let i = 0;
  while (i + 6 <= runs.length) {
    const seg = runs.slice(i, i + 6);
    const unit = seg.reduce((a, b) => a + b, 0) / 11;
    const v = C128.indexOf(seg.map(w => Math.max(1, Math.min(4, Math.round(w / unit)))).join(''));
    if (v === -1) break;
    vals.push(v);
    i += 6;
  }
  if (vals.length < 3 || ![103, 104, 105].includes(vals[0])) return null;
  let sum = vals[0];
  for (let k = 1; k < vals.length - 1; k++) sum += vals[k] * k;
  if (sum % 103 !== vals[vals.length - 1]) return null;
  let set = vals[0] === 103 ? 'A' : vals[0] === 104 ? 'B' : 'C';
  let txt = '';
  for (let k = 1; k < vals.length - 1; k++) {
    const v = vals[k];
    if (set === 'C') { if (v < 100) txt += String(v).padStart(2, '0'); else if (v === 100) set = 'B'; else if (v === 101) set = 'A'; }
    else if (v === 99) set = 'C';
    else if (v === 100 && set === 'A') set = 'B';
    else if (v === 101 && set === 'B') set = 'A';
    else if (v < 96) txt += String.fromCharCode(set === 'B' ? v + 32 : (v < 64 ? v + 32 : v - 64));
  }
  return txt;
}
function decodeBarcodeImage(img) {
  const { width: w, height: h, data } = img;
  let dark;
  if (img.kind === 1) {
    const rb = Math.ceil(w / 8);
    dark = (x, y) => !((data[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1);
  } else {
    const ch = data.length / (w * h);
    dark = (x, y) => {
      const o = (y * w + x) * ch;
      if (ch === 4) return data[o + 3] > 128 && data[o] < 128;
      return (ch === 3 ? (data[o] + data[o + 1] + data[o + 2]) / 3 : data[o]) < 128;
    };
  }
  const seen = {};
  for (const fy of [0.3, 0.5, 0.7]) {
    const y = Math.floor(h * fy);
    const row = [];
    for (let x = 0; x < w; x++) row.push(dark(x, y) ? 1 : 0);
    const first = row.indexOf(1), last = row.lastIndexOf(1);
    if (first < 0) continue;
    const runs = [];
    let cur = row[first], len = 0;
    for (let x = first; x <= last; x++) { if (row[x] === cur) len++; else { runs.push(len); cur = row[x]; len = 1; } }
    runs.push(len);
    const txt = decodeCode128Runs(runs);
    if (txt !== null) seen[txt] = (seen[txt] || 0) + 1;
  }
  const best = Object.entries(seen).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
async function decodePageBarcode(pdfjs, page) {
  const ol = await page.getOperatorList();
  for (let i = 0; i < ol.fnArray.length; i++) {
    if (ol.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
    // Some image types never resolve in Node (no canvas): give up after 2s → "unverified"
    const img = await Promise.race([
      new Promise(r => page.objs.get(ol.argsArray[i][0], r)),
      new Promise(r => setTimeout(() => r(null), 2000))
    ]);
    const txt = img && decodeBarcodeImage(img);
    if (txt) return txt;
  }
  return null;
}

const normName = s => (s || '').normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/[^؀-ۿa-z0-9]/gi, '').toLowerCase();

(async () => {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error('Pass the labels PDF path');

  const cache = JSON.parse(fs.readFileSync(path.join(root, 'products-cache.json'), 'utf8'));
  const shopBySku = new Map();
  const shopNoSku = [];
  cache.variants.forEach(v => {
    const product = cache.products.find(p => p.id === v.productId);
    const entry = { ...v, imageUrl: v.imageUrl || (product && product.mainImage) || '' };
    if (v.sku) shopBySku.set(v.sku.toLowerCase(), entry);
    else shopNoSku.push(entry);
  });

  const oldMapPath = path.join(root, 'builtin_barcode_map.js');

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  const barcodeToSku = {};
  const skuToData = {};
  const unmatched = [];
  const badBars = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = reconstructLabelLines(content.items);
    if (lines.length < 2) continue;

    const rawSku = lines[0].replace(/\s+/g, '');
    const barcodeMatch = lines[lines.length - 1].match(/\d{8,9}/);
    const barcode = barcodeMatch ? barcodeMatch[0] : '';
    const pdfName = lines.slice(1, -1).join(' ');
    const hasSku = !/^0+$/.test(rawSku);

    let shop = hasSku ? shopBySku.get(rawSku.toLowerCase()) : null;
    if (!hasSku) {
      // Word order in the PDF is unreliable (mixed RTL/LTR), so compare word sets
      const words = s => new Set(s.split(/[\s/()\-]+/).map(normName).filter(Boolean));
      const target = words(pdfName);
      shop = shopNoSku.find(v => {
        const w = words(`${v.title} ${v.variantTitle}`);
        return w.size === target.size && [...w].every(t => target.has(t));
      });
    }
    if (!shop) unmatched.push(`${p}: ${rawSku} | ${pdfName}`);

    const scanned = await decodePageBarcode(pdfjs, page);
    const barsOk = !!barcode && scanned === barcode;
    if (!barsOk) badBars.push(`${p}: ${rawSku} printed=${barcode} bars=${scanned}`);

    // SKU-less variants get a stable key derived from their barcode
    const sku = hasSku ? rawSku : `NOSKU-${barcode}`;
    const key = sku.toLowerCase();
    const title = shop ? shop.title : '';
    const variantTitle = shop ? shop.variantTitle : '';

    skuToData[key] = {
      sku,
      barcode,
      title,
      variantTitle,
      name: shop ? `${title} - ${variantTitle}` : pdfName,
      imageUrl: shop ? shop.imageUrl : '',
      price: shop ? shop.price : '',
      page: p,
      isZeroBarcode: !barsOk,
      legacyBarcode: !barsOk ? (scanned || '00000000') : ''
    };
    if (barcode) barcodeToSku[barcode] = sku;
  }

  const zeroBarcodeItems = Object.values(skuToData).filter(d => d.isZeroBarcode);
  const dict = {
    version: '4.0',
    generatedAt: new Date().toISOString(),
    barcodeCount: Object.keys(barcodeToSku).length,
    skuCount: Object.keys(skuToData).length,
    zeroCount: zeroBarcodeItems.length,
    barcodeToSku,
    skuToData,
    zeroBarcodeItems
  };

  const header = `/**
 * Khiam Warehouse - Built-in Barcode to SKU Translation Dictionary
 * Generated by tools/build-barcode-map.js from ${path.basename(pdfPath)}
 * - ${dict.barcodeCount} 9-digit barcodes, ${dict.skuCount} SKUs
 * - ${dict.zeroCount} labels whose bars do not scan as the printed number (resolved from the open order)
 * - Every other label's Code128 bars were decoded and verified against the printed barcode
 * Names & images cross-referenced with Shopify products-cache.json.
 */
`;
  fs.writeFileSync(oldMapPath, `${header}\nwindow.KHIAM_BUILTIN_BARCODE_DICT = ${JSON.stringify(dict, null, 2)};\n`);
  console.log({ barcodes: dict.barcodeCount, skus: dict.skuCount, zero: dict.zeroCount, unmatched, badBars });
})();
