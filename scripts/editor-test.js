// Opens every editor on a generated picture, drives it from script, screenshots it, saves, and checks the output.
// Run: npx electron scripts/editor-test.js   (screenshots land in .snap/editors/)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');
const actions = require('../src/actions');

const SNAP = path.join(__dirname, '..', '.snap', 'editors');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Each case: interaction script (runs in the editor page) and the output size we expect for a 1200×800 input.
const CASES = [
  { mode: 'crop', expect: [1200, 675], script: `[...document.querySelectorAll('.chip')].find((b) => b.textContent.trim() === '16:9').click();` },
  { mode: 'addbg', expect: [1440, 1040], script: `` },
  {
    mode: 'edit', expect: [800, 1200], script: `
      document.querySelector('[title="Rotate right"]').click();
      const s = document.querySelectorAll('input[type=range]')[3]; s.value = 40; s.dispatchEvent(new Event('input'));`,
  },
  {
    mode: 'annotate', expect: [1200, 800], script: `
      const m = window.__editor.mode;
      m.pointer('down', { x: 200, y: 600 }); m.pointer('drag', { x: 420, y: 430 }); m.pointer('up', { x: 520, y: 360 });
      [...document.querySelectorAll('.chip')].find((b) => b.title === 'Box').click();
      m.pointer('down', { x: 560, y: 220 }); m.pointer('up', { x: 1020, y: 470 });
      [...document.querySelectorAll('.chip')].find((b) => b.title === 'Pen').click();
      document.querySelectorAll('.swatch')[4].click();
      m.pointer('down', { x: 120, y: 120 });
      for (let i = 0; i < 40; i++) m.pointer('drag', { x: 120 + i * 9, y: 120 + Math.sin(i / 4) * 40 });
      m.pointer('up', { x: 480, y: 120 });`,
  },
  {
    mode: 'redact', expect: [1200, 800], script: `
      const m = window.__editor.mode;
      m.pointer('down', { x: 90, y: 300 }); m.pointer('up', { x: 560, y: 420 });
      [...document.querySelectorAll('.chip')].find((b) => b.textContent.includes('Pixelate')).click();
      m.pointer('down', { x: 620, y: 300 }); m.pointer('up', { x: 1110, y: 420 });
      [...document.querySelectorAll('.chip')].find((b) => b.textContent.includes('Blur')).click();
      m.pointer('down', { x: 90, y: 520 }); m.pointer('up', { x: 1110, y: 640 });`,
  },
];

app.whenReady().then(async () => {
  actions.init(app.getPath('userData'));
  fs.mkdirSync(SNAP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-editor-'));
  const src = path.join(dir, 'Screenshot.jpg');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <rect width="1200" height="800" fill="#f7f7f9"/><rect width="1200" height="90" fill="#24292f"/>
    <text x="40" y="58" font-family="Segoe UI" font-size="34" fill="#fff">Account settings</text>
    <text x="90" y="380" font-family="Segoe UI" font-size="44" fill="#222">Email: anish@example.com</text>
    <text x="620" y="380" font-family="Segoe UI" font-size="44" fill="#222">Card: 4242 4242 4242</text>
    <text x="90" y="600" font-family="Segoe UI" font-size="44" fill="#222">Password: hunter2-super-secret</text>
    <circle cx="1060" cy="220" r="90" fill="#ff5a2c"/></svg>`)).jpeg({ quality: 92 }).toFile(src);

  let job;
  ipcMain.handle('editor:load', async () => ({ mode: job.mode, files: [await actions.loadForEditor(src)] }));
  ipcMain.handle('editor:save', (_e, outputs) => (job.saved = actions.saveEdited(job.mode, outputs)));
  ipcMain.on('editor:close', () => {});
  ipcMain.on('editor:reveal', () => {});

  let failed = 0;
  for (const c of CASES) {
    job = { mode: c.mode };
    const win = new BrowserWindow({
      width: 940, height: 740, show: false, frame: false, backgroundColor: '#1a2128', opacity: 0, skipTaskbar: true, focusable: false,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), backgroundThrottling: false },
    });
    const errors = [];
    win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    await win.loadFile(path.join(__dirname, '..', 'src', 'editor', 'editor.html'));
    win.showInactive(); // invisible (opacity 0) but painting, so screenshots show the live state
    await win.webContents.executeJavaScript(`new Promise((r) => { const t = () => window.__editor ? r() : setTimeout(t, 30); t(); })`);
    await win.webContents.executeJavaScript(`(() => { ${c.script}; window.__editor.api.render(); })()`);
    await wait(400);
    fs.writeFileSync(path.join(SNAP, `${c.mode}.png`), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.__editor.save()');
    await wait(300);
    const out = job.saved?.[0];
    const meta = out && (await sharp(out).metadata());
    const ok = meta && meta.width === c.expect[0] && meta.height === c.expect[1] && !errors.length;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.mode.padEnd(9)} -> ${out ? path.basename(out) : '(nothing saved)'} ${meta ? `${meta.width}x${meta.height}` : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`);
    if (out) fs.copyFileSync(out, path.join(SNAP, `${c.mode}-output.${meta.format === 'jpeg' ? 'jpg' : meta.format}`));
    win.destroy();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\nFAILED: ${failed}` : '\nALL OK');
  app.exit(failed ? 1 : 0);
});
