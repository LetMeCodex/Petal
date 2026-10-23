// Runs every live action against generated fixtures inside real Electron: `npx electron scripts/selftest.js`
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const sharp = require('sharp');

app.whenReady().then(async () => {
  const actions = require('../src/actions');
  actions.init(app.getPath('userData'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-test-'));
  const photo = path.join(dir, 'Photo.jpg');
  const shot = path.join(dir, 'Screenshot.png');
  const doc = path.join(dir, 'Page 001.pdf');

  const noise = { create: { width: 1200, height: 800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } };
  await sharp(noise).jpeg({ quality: 98 }).withExif({ IFD0: { Make: 'TestCam', Model: 'X1' } }).toFile(photo);
  await sharp(noise).png().toFile(shot);
  fs.writeFileSync(doc, minimalPdf(['Hello from page one', 'And page two']));

  const cases = [
    ['convert', [photo]], ['convert', [shot]], ['convert', [doc]],
    ['compress', [photo, shot]], ['metadata', [photo]], ['metadata', [shot], 'skip'], ['crop', [photo], 'skip'],
  ];
  let failed = 0;
  for (const [action, files, expect] of cases) {
    const res = await actions.run(action, files);
    const lines = res.error ? [`error: ${res.error}`] : res.results.map((r) =>
      r.saved ? `${path.basename(r.file)} -> ${r.saved.map((s) => `${path.basename(s)} (${fs.statSync(s).size}B)`).join(', ')}${r.note ? ` [${r.note}]` : ''}`
              : `${path.basename(r.file)} skipped: ${r.skipped}`);
    console.log(`\n[${action}]\n  ${lines.join('\n  ')}`);
    if (expect !== 'skip' && !res.results?.some((r) => r.saved)) failed++;
  }
  const clean = path.join(dir, 'Photo Clean.jpg');
  console.log('\nEXIF left after clean:', Boolean((await sharp(clean).metadata()).exif));
  console.log('Files in dir:', fs.readdirSync(dir).join(' | '));
  console.log(failed ? `\nFAILED: ${failed}` : '\nALL OK');
  app.exit(failed ? 1 : 0);
});

// Tiny hand-written 2-page PDF, so the test needs no fixtures on disk.
function minimalPdf(texts) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = texts.map((t) => {
    const stream = `BT /F1 28 Tf 72 700 Td (${t}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}
