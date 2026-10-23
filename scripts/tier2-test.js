// Tier-2 actions end to end inside Electron: Copy Text (OCR), Merge to PDF, Remove BG (downloads the model on first run).
// Run: npx electron scripts/tier2-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, clipboard } = require('electron');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

app.whenReady().then(async () => {
  const actions = require('../src/actions');
  actions.init(app.getPath('userData'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-t2-'));
  const text = path.join(dir, 'Invoice.png');
  const page2 = path.join(dir, 'Page 2.jpg');
  const page10 = path.join(dir, 'Page 10.png');
  const subject = path.join(dir, 'Product.jpg');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="900" height="300" fill="#fff"/>
    <text x="40" y="110" font-family="Segoe UI" font-size="48" fill="#111">Invoice 2041 from Arete Studio</text>
    <text x="40" y="200" font-family="Segoe UI" font-size="40" fill="#333">Total due: 12,450 INR</text></svg>`)).png().toFile(text);
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4a90d9' } }).jpeg().toFile(page2);
  await sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 255, g: 90, b: 44, alpha: 0.6 } } }).png().toFile(page10);
  // A red ball on a plain studio backdrop: an easy, checkable subject for segmentation.
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><radialGradient id="b" cx=".4" cy=".35"><stop offset="0" stop-color="#ff8a7a"/><stop offset="1" stop-color="#b3121b"/></radialGradient>
    <linearGradient id="bg" x2="0" y2="1"><stop offset="0" stop-color="#eef0f3"/><stop offset="1" stop-color="#d5d9df"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#bg)"/><circle cx="400" cy="300" r="170" fill="url(#b)"/></svg>`)).jpeg({ quality: 95 }).toFile(subject);

  let failed = 0;
  const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(9)} ${detail}`); };

  const o = await actions.run('ocr', [text]);
  check('ocr', o.copied && clipboard.readText().includes('Invoice 2041'), JSON.stringify(o.copied || o.error));

  const m = await actions.run('merge', [page10, text, page2]);
  const merged = m.results?.[0]?.saved?.[0];
  const mdoc = merged && (await PDFDocument.load(fs.readFileSync(merged)));
  const sizes = mdoc?.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`).join(', ');
  // natural order: Invoice, Page 2, Page 10
  check('merge', sizes === '675x225, 600x450, 450x600', `${merged && path.basename(merged)} pages: ${sizes}`);

  const t0 = Date.now();
  let lastPct = -1;
  const r = await actions.run('removebg', [subject], {}, (p) => {
    if (p.download === undefined) return;
    const pct = Math.floor(p.download * 10) * 10;
    if (pct !== lastPct) { lastPct = pct; process.stdout.write(`  model ${pct}%\n`); }
  });
  const nobg = r.results?.[0]?.saved?.[0];
  if (nobg) {
    const { data, info } = await sharp(nobg).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
    check('removebg', info.channels === 4 && alphaAt(400, 300) > 200 && alphaAt(30, 30) < 30,
      `${path.basename(nobg)} centre alpha ${alphaAt(400, 300)}, corner alpha ${alphaAt(30, 30)}, ${Date.now() - t0} ms`);
    fs.mkdirSync(path.join(__dirname, '..', '.snap', 'tier2'), { recursive: true });
    fs.copyFileSync(nobg, path.join(__dirname, '..', '.snap', 'tier2', 'removebg-output.png'));
    fs.copyFileSync(subject, path.join(__dirname, '..', '.snap', 'tier2', 'removebg-input.jpg'));
  } else {
    check('removebg', false, JSON.stringify(r));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\nFAILED: ${failed}` : '\nALL OK');
  app.exit(failed ? 1 : 0);
});
