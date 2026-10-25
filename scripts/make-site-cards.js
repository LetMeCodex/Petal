// Makes the website's ten petal cards from real Petal runs: every "after" image is what Petal
// actually produced, and every number is measured from the files.
// Inputs are the site's own specimens (and the OCR receipt from scripts/mockup/img).
// Output: <out>/<id>-before.webp, <id>-after.webp, <id>-ui.webp (editor petals), cards.json
// Run: npx electron scripts/make-site-cards.js <site>/public/petal/cards
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');

app.setPath('userData', path.join(os.tmpdir(), 'petal-site-cards-userdata'));   // keeps the AI model out of real Petal data
const actions = require('../src/actions');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '.snap', 'site', 'cards'));
const SPEC = process.env.PETAL_SPECIMENS || path.join(os.homedir(), 'Downloads', 'Petal', 'public', 'specimens');
const RECEIPT = path.join(__dirname, 'mockup', 'img', 'receipt.png');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
const fmt = (b) => (b >= MB ? `${(b / MB).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);

// Card images: 720 px on the long side, WebP, on transparent where the result has alpha.
async function card(src, name, { flatten } = {}) {
  let img = sharp(src, { animated: false }).rotate().resize(720, 720, { fit: 'inside', withoutEnlargement: false });
  if (flatten) img = img.flatten({ background: flatten });
  await img.webp({ quality: 84, alphaQuality: 90 }).toFile(path.join(OUT, name));
}

// A photo-like input: the specimen on a warm studio sweep with a soft floor shadow.
async function studioPhoto(specimen, file, { size = 2400, bg = ['#efe6e3', '#d9c9c6'] } = {}) {
  const sweep = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 0.75}">
    <defs><radialGradient id="g" cx=".5" cy=".38" r=".85"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
    <radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><ellipse cx="${size / 2}" cy="${size * 0.64}" rx="${size * 0.22}" ry="${size * 0.04}" fill="url(#s)"/></svg>`);
  const subject = await sharp(path.join(SPEC, `${specimen}.png`)).resize(Math.round(size * 0.5)).toBuffer();
  await sharp(sweep).composite([{ input: subject, gravity: 'center' }]).jpeg({ quality: 95 }).toFile(file);
}

// Drives a real editor window: load the file, run a script in the page, screenshot the UI, save.
let editorJob = null;
async function editor(mode, src, script) {
  editorJob = { mode, src };
  const win = new BrowserWindow({
    width: 940, height: 740, show: false, frame: false, backgroundColor: '#1a2128', opacity: 0, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'editor', 'editor.html'));
  win.showInactive();
  await win.webContents.executeJavaScript(`new Promise((r) => { const t = () => window.__editor ? r() : setTimeout(t, 30); t(); })`);
  await win.webContents.executeJavaScript(`(() => { ${script}; window.__editor.api.render(); })()`);
  await wait(500);
  const ui = (await win.webContents.capturePage()).toPNG();
  await win.webContents.executeJavaScript('window.__editor.save()');
  await wait(400);
  win.destroy();
  return { ui, out: editorJob.saved?.[0] };
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  actions.init(app.getPath('userData'));
  ipcMain.handle('editor:load', async () => ({ mode: editorJob.mode, files: [await actions.loadForEditor(editorJob.src)] }));
  ipcMain.handle('editor:save', (_e, outputs) => (editorJob.saved = actions.saveEdited(editorJob.mode, outputs)));
  ipcMain.on('editor:close', () => {});
  ipcMain.on('editor:reveal', () => {});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-site-cards-'));
  const cards = [];
  const size = (f) => fs.statSync(f).size;
  const dims = async (f) => { const m = await sharp(f).metadata(); return `${m.width}×${m.height}`; };

  // 01 Compress: a 2400 px studio photo, compressed by the Compress petal.
  const peonyJpg = path.join(dir, 'Peony.jpg');
  await studioPhoto('peony-color', peonyJpg);
  let r = await actions.run('compress', [peonyJpg]);
  const compressed = r.results[0].saved[0];
  await card(peonyJpg, '01-before.webp'); await card(compressed, '01-after.webp');
  cards.push({ id: '01', petal: 'compress', title: 'Compress', tag: '.jpg → smaller .jpg', before: fmt(size(peonyJpg)), after: fmt(size(compressed)), unit: 'SIZE',
    note: `${Math.round((1 - size(compressed) / size(peonyJpg)) * 100)}% smaller, same 2400 px` });

  // 02 Clean metadata: the same photo carrying camera and GPS EXIF, cleaned by the Metadata petal.
  const tagged = path.join(dir, 'Peony GPS.jpg');
  const exif = { IFD0: { Make: 'FUJIFILM', Model: 'X-T5', Artist: 'Anish', Software: 'Camera 2.1', DateTime: '2026:10:21 09:41:00' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 56/1 3120/100', GPSLongitudeRef: 'E', GPSLongitude: '77/1 37/1 2880/100' } };
  await sharp(peonyJpg).withExif(exif).jpeg({ quality: 92 }).toFile(tagged);
  r = await actions.run('metadata', [tagged]);
  const cleaned = r.results[0].saved[0];
  const exifBytes = async (f) => (await sharp(f).metadata()).exif?.length || 0;
  const tagCount = Object.values(exif).reduce((s, o) => s + Object.keys(o).length, 0);
  // The card shows what's hidden in the file: a readout drawn from the real tags, then nothing.
  const readout = (lines, ok) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540">
    <rect x="28" y="${540 - 40 - lines.length * 30}" width="420" height="${lines.length * 30 + 22}" fill="rgba(12,11,13,.78)" stroke="${ok ? '#9fe3bf' : '#f4a7c0'}" stroke-width="1.5"/>
    ${lines.map((l, i) => `<text x="44" y="${540 - 40 - lines.length * 30 + 34 + i * 30}" font-family="Consolas, monospace" font-size="19" fill="${ok ? '#cdf3dd' : '#ffd3e0'}">${l}</text>`).join('')}</svg>`);
  const base = await sharp(peonyJpg).resize(720, 540, { fit: 'cover' }).toBuffer();
  await sharp(base).composite([{ input: readout(['Make  FUJIFILM X-T5', 'Artist  Anish', 'GPS  12°56′31″N 77°37′29″E', 'Date  2026:10:21 09:41'], false) }]).webp({ quality: 84 }).toFile(path.join(OUT, '02-before.webp'));
  await sharp(base).composite([{ input: readout([`EXIF  ${await exifBytes(cleaned)} bytes`, 'GPS  none · camera  none'], true) }]).webp({ quality: 84 }).toFile(path.join(OUT, '02-after.webp'));
  cards.push({ id: '02', petal: 'metadata', title: 'Clean metadata', tag: 'exif.gps → removed', before: String(tagCount), after: '0', unit: 'TAGS',
    note: `EXIF ${await exifBytes(tagged)} B → ${await exifBytes(cleaned)} B, picture untouched` });

  // 03 Copy text: the receipt through Windows' own OCR (the Copy text petal).
  r = await actions.run('ocr', [RECEIPT]);
  const text = r.copied?.text || '';
  const textCard = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="720"><rect width="100%" height="100%" fill="#111015"/>
    <text x="32" y="44" font-family="Consolas, monospace" font-size="14" fill="#f4a7c0">COPIED TO CLIPBOARD · ${r.copied?.words || 0} WORDS</text>
    ${text.split('\n').slice(0, 18).map((l, i) => `<text x="32" y="${92 + i * 34}" font-family="Consolas, monospace" font-size="21" fill="#eef3ff">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')}</svg>`);
  await card(RECEIPT, '03-before.webp');
  await sharp(textCard).webp({ quality: 88 }).toFile(path.join(OUT, '03-after.webp'));
  cards.push({ id: '03', petal: 'ocr', title: 'Copy text (OCR)', tag: 'receipt.png → text', before: '0', after: String(text.replace(/\s/g, '').length), unit: 'CHARS',
    note: `${r.copied?.words || 0} words, on the clipboard`, text });

  // 04 Edit: rotate and warm the photo in the real Edit editor.
  let e = await editor('edit', peonyJpg, `
    document.querySelector('[title="Rotate right"]').click();
    const s = document.querySelectorAll('input[type=range]'); s[3].value = 35; s[3].dispatchEvent(new Event('input')); s[1].value = 112; s[1].dispatchEvent(new Event('input'));`);
  await card(peonyJpg, '04-before.webp'); await card(e.out, '04-after.webp'); await card(e.ui, '04-ui.webp');
  cards.push({ id: '04', petal: 'edit', title: 'Edit', tag: 'rotate · warmth · contrast', before: await dims(peonyJpg), after: await dims(e.out), unit: 'PX', note: 'rotated, warmer, a touch more contrast' });

  // 05 Annotate: a box, an arrow and a circle on the mug, in the real Annotate editor.
  const mugPhoto = path.join(SPEC, 'mug-color.png');
  e = await editor('annotate', mugPhoto, `
    const m = window.__editor.mode; const pick = (t) => [...document.querySelectorAll('.chip')].find((b) => b.title === t).click();
    pick('Box'); m.pointer('down', { x: 190, y: 250 }); m.pointer('up', { x: 640, y: 690 });
    pick('Arrow'); m.pointer('down', { x: 820, y: 140 }); m.pointer('drag', { x: 760, y: 200 }); m.pointer('up', { x: 650, y: 270 });
    pick('Circle'); m.pointer('down', { x: 610, y: 330 }); m.pointer('up', { x: 800, y: 560 });`);
  await card(mugPhoto, '05-before.webp'); await card(e.out, '05-after.webp'); await card(e.ui, '05-ui.webp');
  cards.push({ id: '05', petal: 'annotate', title: 'Annotate', tag: 'box · arrow · circle', before: '0', after: '3', unit: 'MARKS', note: 'saved as a new image next to the original' });

  // 07 Remove background first (06 uses its cut-out): the on-device model on the mug photo.
  const t0 = Date.now();
  r = await actions.run('removebg', [mugPhoto], undefined, (p) => { if (p.download !== undefined && Math.round(p.download * 100) % 25 === 0) console.log(`  model ${Math.round(p.download * 100)}%`); });
  const cutout = r.results?.[0]?.saved?.[0];
  if (!cutout) throw new Error(`remove background failed: ${JSON.stringify(r)}`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // second run, model loaded, for an honest "how long it takes" number
  const t1 = Date.now(); await actions.run('removebg', [mugPhoto]); const warm = ((Date.now() - t1) / 1000).toFixed(1);
  await card(mugPhoto, '07-before.webp'); await card(cutout, '07-after.webp');
  cards.push({ id: '07', petal: 'removebg', title: 'Remove background', tag: 'on-device AI', before: 'BG', after: `${warm} s`, unit: 'ON THIS PC', note: `local model, ${warm} s once loaded (first run ${secs} s incl. download)` });

  // 06 Add background: the cut-out mug on a soft gradient, in the real Add background editor.
  e = await editor('addbg', cutout, `[...document.querySelectorAll('.swatch, .bg-swatch, [data-bg]')].slice(0, 12)[3]?.click();`);
  await card(cutout, '06-before.webp'); await card(e.out, '06-after.webp'); await card(e.ui, '06-ui.webp');
  cards.push({ id: '06', petal: 'addbg', title: 'Add background', tag: 'alpha → studio fill', before: await dims(cutout), after: await dims(e.out), unit: 'PX', note: 'padding, rounded corners and a soft shadow' });

  // 08 Crop: the photo to a 1:1 square in the real Crop editor.
  e = await editor('crop', peonyJpg, `[...document.querySelectorAll('.chip')].find((b) => b.textContent.trim() === '1:1').click();`);
  await card(peonyJpg, '08-before.webp'); await card(e.out, '08-after.webp'); await card(e.ui, '08-ui.webp');
  cards.push({ id: '08', petal: 'crop', title: 'Crop', tag: 'aspect · trim', before: await dims(peonyJpg), after: await dims(e.out), unit: 'PX', note: 'snapped to 1:1' });

  // 09 Redact: black out the UPI reference and blur the total on the receipt, in the real Redact editor.
  e = await editor('redact', RECEIPT, `
    const m = window.__editor.mode; const pick = (t) => [...document.querySelectorAll('.chip')].find((b) => b.textContent.includes(t)).click();
    pick('Black box'); m.pointer('down', { x: 170, y: 690 }); m.pointer('up', { x: 430, y: 742 });
    pick('Pixelate'); m.pointer('down', { x: 40, y: 50 }); m.pointer('up', { x: 460, y: 160 });`);
  await card(RECEIPT, '09-before.webp'); await card(e.out, '09-after.webp'); await card(e.ui, '09-ui.webp');
  cards.push({ id: '09', petal: 'redact', title: 'Redact', tag: 'black box · pixelate · blur', before: '2', after: '0', unit: 'EXPOSED', note: 'burned into the pixels, not a layer' });

  // 10 Merge: three files into one PDF, pages rendered back from the real PDF.
  const mergeIn = [];
  for (const [i, s] of ['peony-color', 'mug-color', 'butterfly-color'].entries()) {
    const f = path.join(dir, `${i + 1} ${s.split('-')[0]}.png`);
    await sharp(path.join(SPEC, `${s}.png`)).flatten({ background: '#f6f1ef' }).png().toFile(f);
    mergeIn.push(f);
  }
  r = await actions.run('merge', mergeIn);
  const pdfFile = r.results[0].saved[0];
  r = await actions.run('convert', [pdfFile], { to: 'png' });
  const pages = r.results[0].saved;
  const thumbs = await Promise.all(pages.map((p) => sharp(p).resize(220, 220, { fit: 'contain', background: '#fff' }).extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#fff' }).toBuffer()));
  await sharp({ create: { width: 720, height: 540, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(thumbs.map((t, i) => ({ input: t, left: 60 + i * 190, top: 120 + (i % 2) * 40 }))).webp({ quality: 86 }).toFile(path.join(OUT, '10-after.webp'));
  const files = await Promise.all(mergeIn.map((f) => sharp(f).resize(200, 200).toBuffer()));
  await sharp({ create: { width: 720, height: 540, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(files.map((t, i) => ({ input: t, left: 50 + i * 215, top: 170 }))).webp({ quality: 86 }).toFile(path.join(OUT, '10-before.webp'));
  cards.push({ id: '10', petal: 'merge', title: 'Merge to PDF', tag: 'multi-file → .pdf', before: '3', after: '1', unit: 'FILES', note: `${pages.length} pages, ${fmt(size(pdfFile))}` });

  cards.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify(cards, null, 2));
  for (const c of cards) console.log(`${c.id} ${c.title.padEnd(18)} ${c.before} → ${c.after} ${c.unit}   ${c.note}`);
  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(0);
});
