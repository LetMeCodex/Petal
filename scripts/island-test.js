// Renders every Petal Island state over a fake desktop (.snap/island-live/), and checks a real result
// flows through: an actual Compress runs in the main process, its result goes to the island, and the
// island must land in "done" with the drip showing.  Run: npx electron scripts/island-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', '.snap', 'island-live');
const W = 780, H = 600;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG = path.join(__dirname, 'mockup', 'img');

const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="a" cx=".7" cy="1.1" r=".8"><stop offset="0" stop-color="#2f62ff"/><stop offset="1" stop-color="#2f62ff" stop-opacity="0"/></radialGradient>
  <linearGradient id="b" x2="0" y2="1"><stop offset="0" stop-color="#0f1226"/><stop offset="1" stop-color="#1c2e7a"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#a)"/>
  <rect x="40" y="150" width="380" height="240" rx="10" fill="#1d1f26"/><text x="60" y="176" font-family="Segoe UI" font-size="12" fill="#cfd3dc">Downloads</text></svg>`;

app.whenReady().then(async () => {
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));
  fs.mkdirSync(OUT, { recursive: true });
  const actions = require('../src/actions');
  actions.init(app.getPath('userData'));

  const sample = (name, action) => ({ file: path.join(IMG, name), name, action, at: Date.now() - 120000, url: pathToFileURL(path.join(IMG, name)).href, ext: name.split('.').pop() });
  ipcMain.handle('island:recent', () => ({
    files: [sample('mug-nobg.png', 'removebg'), sample('addbg.png', 'addbg'), { ...sample('receipt.png', 'merge'), name: 'Invoice Merged.pdf', ext: 'pdf' }],
    texts: [{ text: 'CHAI POINT · Koramangala  Order #4471  TOTAL 409.50', at: Date.now() }],
  }));
  for (const ch of ['island:interactive', 'island:dropped', 'island:wantBackdrop', 'island:open', 'island:reveal', 'island:copy', 'island:settings', 'island:startDrag', 'island:state', 'island:resetPosition', 'island:moveTo', 'island:moveEnd']) ipcMain.on(ch, () => {});
  const prefsLog = [], statsLog = [];
  ipcMain.handle('island:prefs', () => ({ island: true, widgets: { cpu: true, gpu: true, ram: true, net: true, battery: true, clock: true }, islandPulse: true, motion: 'full', islandPos: { mode: 'top', fx: 0.5, fy: 0 }, trigger: 'Shift' }));
  ipcMain.on('island:setPrefs', (_e, p) => prefsLog.push(p));
  ipcMain.on('island:wantStats', (_e, w) => statsLog.push(w));

  const desktop = await sharp(Buffer.from(desktopSvg)).jpeg().toBuffer();
  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, transparent: true, opacity: 0, skipTaskbar: true, focusable: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'island', 'island.html'));
  win.showInactive();
  win.webContents.send('island:backdrop', `data:image/jpeg;base64,${desktop.toString('base64')}`);
  await wait(800);

  const js = (code) => win.webContents.executeJavaScript(`(() => { const i = window.__island; ${code} })()`);
  const mug = path.join(IMG, 'mug-nobg.png');
  const send = (ch, v) => win.webContents.send(ch, v);
  const TOP = { mode: 'top', dx: 390, dy: 0, dby: 0, up: false };
  let tick = 0;
  const stat = () => send('island:stats', { cpu: 30 + 25 * Math.sin(tick / 2), gpu: 8 + 6 * Math.cos(tick++), ram: 74, ramUsed: 17.6, ramTotal: 23.8, rx: 380000 + 90000 * Math.sin(tick), tx: 42000, bat: 64, ac: 1 });
  send('island:layout', TOP);
  for (let k = 0; k < 12; k++) stat();
  const statTimer = setInterval(stat, 300);
  const scenes = [
    ['1-idle', `i.setState('idle')`],
    ['2-hover', `i.showTab('recent'); i.setState('hover')`],
    ['2b-glance', `i.showTab('glance')`],
    ['2c-settings', `i.showTab('settings')`],
    ['3-drag', `i.setState('drag'); i.setHot('removebg'); i.drawTendril(600, 330)`],
    ['4-work', `i.startWork('Removing background', 'Mug.jpg · 62%')`],
    ['5-done', `i.showDone('Mug No BG.png is ready', 'Drag it anywhere', ${JSON.stringify(mug)})`],
    ['6-error', `i.showError('No text in Receipt.png', 'Try a sharper image')`],
    ['7-moving', `i.setState('idle'); document.body.classList.add('moving'); document.body.style.setProperty('--sx','1.18'); document.body.style.setProperty('--sy','0.9')`, () => send('island:layout', { mode: 'float', dx: 390, dy: 120, dby: 0, up: false })],
    ['8-float-glance', `document.body.classList.remove('moving'); document.body.style.setProperty('--sx','1'); document.body.style.setProperty('--sy','1'); i.showTab('glance'); i.setState('hover')`, () => send('island:layout', { mode: 'float', dx: 390, dy: 40, dby: 0, up: false })],
    ['9-up-glance', `i.setState('idle'); i.setState('hover')`, () => send('island:layout', { mode: 'float', dx: 390, dy: 0, dby: 40, up: true })],
  ];
  for (const [name, code, pre] of scenes) {
    pre?.();
    await js(code);
    await wait(1100);
    const shot = (await win.webContents.capturePage()).toPNG();
    await sharp(desktop).composite([{ input: await sharp(shot).resize(W, H).toBuffer() }]).png().toFile(path.join(OUT, `${name}.png`));
    console.log('saved', name);
  }

  clearInterval(statTimer);
  send('island:layout', TOP);

  // Widgets + settings: all six tiles render from prefs, the chip toggles one off and saves it,
  // and stats are only requested while someone can see them.
  await js(`i.setState('idle'); i.showTab('glance'); i.setState('hover')`);
  await wait(300);
  const w1 = await win.webContents.executeJavaScript(`({ tiles: document.querySelectorAll('#paneGlance .w').length, chips: document.querySelectorAll('.wchip.on').length, want: window.__island.wantedStats, cpu: document.querySelector('[data-w=cpu] .val').textContent })`);
  await js(`i.showTab('settings'); document.querySelector('.wchip[data-w=gpu]').click(); document.querySelector('.sw[data-pref=islandPulse]').click(); document.querySelector('#motionSeg [data-motion=calm]').click()`);
  await wait(200);
  const w2 = await win.webContents.executeJavaScript(`({ tiles: document.querySelectorAll('#paneGlance .w').length, want: window.__island.wantedStats, calm: document.body.classList.contains('calm'), pulse: document.body.classList.contains('pulse-on') })`);
  await js(`i.setState('idle')`);
  await wait(100);
  const w3 = await win.webContents.executeJavaScript('window.__island.wantedStats');
  const saved = Object.assign({}, ...prefsLog);
  const wOk = w1.tiles === 6 && w1.chips === 6 && w1.want === 2 && /[0-9]/.test(w1.cpu) && w2.tiles === 5 && w2.want === 0 && w2.calm && !w2.pulse && w3 === 0
    && saved.widgets?.gpu === false && saved.islandPulse === false && saved.motion === 'calm';
  console.log(`${wOk ? 'PASS' : 'FAIL'} widgets + settings`, JSON.stringify({ w1, w2, w3, saved, statsLog }));
  await js(`document.querySelector('.wchip[data-w=gpu]').click(); document.querySelector('.sw[data-pref=islandPulse]').click(); document.querySelector('#motionSeg [data-motion=full]').click()`);

  // A desktop has no battery: the tile must say Power / AC with a plug, not a full battery.
  await js(`i.showTab('glance'); i.setState('hover')`);
  send('island:stats', { cpu: 12, gpu: -1, ram: 50, ramUsed: 8, ramTotal: 16, rx: 0, tx: 0, bat: -1, ac: 1 });
  await wait(900);
  const desk = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('[data-w=battery]'); return { cls: b.className, lbl: b.querySelector('.lbl').textContent, val: b.querySelector('.val').textContent, plug: getComputedStyle(b.querySelector('.plug')).display, batt: getComputedStyle(b.querySelector('.batt')).display, gpu: document.querySelector('[data-w=gpu] .val').textContent }; })()`);
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(OUT, '10-desktop-no-battery.png'), img.toPNG()));
  await js(`i.setState('idle')`);
  const deskOk = desk.lbl === 'Power' && desk.val === 'AC' && desk.plug === 'block' && desk.batt === 'none' && desk.gpu === '—';
  console.log(`${deskOk ? 'PASS' : 'FAIL'} desktop without battery, GPU not ready yet`, JSON.stringify(desk));

  // Motion auto: full by default, calm once the flowers' frames run slow (simulated with a busy main thread).
  await js(`document.querySelector('#motionSeg [data-motion=auto]').click()`);
  await wait(200);
  const autoBefore = await win.webContents.executeJavaScript(`document.body.classList.contains('calm')`);
  await js(`i.setState('drag'); window.__hog = setInterval(() => { const t = performance.now(); while (performance.now() - t < 30); }, 0)`);
  await wait(2500);
  const autoAfter = await win.webContents.executeJavaScript(`clearInterval(window.__hog); document.body.classList.contains('calm')`);
  await js(`i.setState('idle'); document.querySelector('#motionSeg [data-motion=full]').click()`);
  const autoOk = (require('os').cpus().length > 4 ? autoBefore === false : true) && autoAfter === true;
  console.log(`${autoOk ? 'PASS' : 'FAIL'} motion auto drops to calm when frames are slow`, JSON.stringify({ autoBefore, autoAfter }));

  // Placement maths: top edge stays inside the display; floating near the bottom grows upward.
  const { computeLayout, dropRect } = require('../src/island-main');
  const disp = { bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 816 } };
  const top = computeLayout(disp, { mode: 'top', fx: 0.99, fy: 0 });
  const mid = computeLayout(disp, { mode: 'float', fx: 0.5, fy: 0.4 });
  const low = computeLayout(disp, { mode: 'float', fx: 0.2, fy: 0.97 });
  const lOk = top.bounds.x + top.bounds.width <= 1536 && top.layout.dy === 0 && !mid.layout.up && Math.abs(dropRect(mid.bounds, mid.layout).cx - 768) < 1
    && low.layout.up && low.bounds.y + low.bounds.height <= 816 && Math.abs(dropRect(low.bounds, low.layout).cx - 307.2) < 1;
  console.log(`${lOk ? 'PASS' : 'FAIL'} layout`, JSON.stringify({ top: top.layout, mid: mid.layout, low: low.layout }));

  // Functional check: a real action's result, delivered the way the wheel's results are, must drip from the island.
  await js(`i.setState('idle')`);
  await wait(600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-test-island-'));
  const photo = path.join(dir, 'Photo.jpg');
  await sharp({ create: { width: 900, height: 600, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 98 }).toFile(photo);
  const res = await actions.run('compress', [photo]);
  win.webContents.send('island:external', { action: 'compress', res });
  await wait(500);
  const st = await win.webContents.executeJavaScript(`({ state: window.__island.state, drip: document.body.classList.contains('has-drip'), title: document.getElementById('doneTitle').textContent })`);
  const extOk = st.state === 'done' && st.drip && st.title.includes('Photo Compressed.jpg') && !errors.length;
  const ok = wOk && lOk && deskOk && autoOk && extOk;
  console.log(`${extOk ? 'PASS' : 'FAIL'} external result -> island`, JSON.stringify(st), errors.length ? `errors: ${errors.join(' | ')}` : '');
  fs.rmSync(dir, { recursive: true, force: true });

  // Contact sheet of the states.
  const files = scenes.map(([n]) => path.join(OUT, `${n}.png`));
  const cw = 520, ch = Math.round(H * cw / W);
  const parts = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(cw).toBuffer(), left: 12 + (i % 2) * (cw + 12), top: 12 + Math.floor(i / 2) * (ch + 12) })));
  await sharp({ create: { width: cw * 2 + 36, height: (ch + 12) * Math.ceil(files.length / 2) + 12, channels: 3, background: '#160a12' } }).composite(parts).png().toFile(path.join(OUT, 'sheet.png'));
  console.log(ok ? '\nALL OK' : '\nFAILED');
  app.exit(ok ? 0 : 1);
});
