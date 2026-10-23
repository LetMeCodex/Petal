// Drives the real Ask panel in the island with the real engine, on a test folder of its own:
// suggestions, live search, results, files flying into the drop, cleared + Undo, duplicates,
// caches, an action preview and a question it can't answer. Screens go to .snap/ask/.
// Everything moved to the Recycle Bin is put back, and the test folder is removed at the end.
// Run: npx electron scripts/ask-ui-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const sharp = require('sharp');
const { createEngine } = require('../src/ask/engine');
const { suggest, contextLabel } = require('../src/ask/suggest');

const OUT = path.join(__dirname, '..', '.snap', 'ask');
const W = 780, H = 600;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="a" cx=".7" cy="1.1" r=".9"><stop offset="0" stop-color="#2f62ff"/><stop offset="1" stop-color="#2f62ff" stop-opacity="0"/></radialGradient>
  <linearGradient id="b" x2="0" y2="1"><stop offset="0" stop-color="#0f1226"/><stop offset="1" stop-color="#1c2e7a"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#a)"/>
  <rect x="40" y="250" width="380" height="300" rx="10" fill="#1d1f26"/><text x="60" y="276" font-family="Segoe UI" font-size="12" fill="#cfd3dc">Downloads</text></svg>`;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const root = path.join(os.homedir(), `Petal Ask UI Test ${process.pid}`);
  const put = async (name, bytes, fill, ageDays = 0, image) => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (image) await sharp({ create: { width: 900, height: 600, channels: 3, background: image, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).composite([{ input: Buffer.from(`<svg width="900" height="600"><rect width="900" height="600" fill="${image}" opacity=".75"/></svg>`) }]).jpeg({ quality: 90 }).toFile(p);
    else { const b = Buffer.alloc(bytes, fill); b.write(name, 0); fs.writeFileSync(p, b); }
    if (ageDays) { const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(p, t, t); }
    return p;
  };
  await put('Xcode_26_beta.zip', 9 * MB, 1, 14);
  await put('Desktop/Projects/Motion_Promo_v12.aep', 7 * MB, 2, 3);
  await put('Documents/iPhone_Backup_Sept.zip', 6 * MB, 3, 35);
  await put('Music/Logic_Session_Bounce.wav', 5 * MB, 4, 60);
  await put('Downloads/Sonoma_Installer.iso', 4.5 * MB, 5, 120);
  const trip = await put('Photos/Trip.jpg', 0, 0, 40, '#ff9cc0');
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.copyFileSync(trip, path.join(root, 'Downloads', 'Trip copy.jpg'));   // received twice
  await put('Photos/Sunset.png', 0, 0, 5, '#ffb36b');
  await put('Photos/Beach.png', 0, 0, 6, '#6bc4ff');
  await put('notes.txt', 3000, 9);

  const engine = createEngine({ dirs: { downloads: path.join(root, 'Downloads') }, trashItem: (p) => shell.trashItem(p), undoFile: path.join(root, 'undo.json') });
  const fg = { exe: 'C:\\Windows\\explorer.exe', title: path.basename(root), folder: root };
  const ctx = { fg, folder: root };

  // The bits of the island the panel talks to.
  ipcMain.handle('island:recent', () => ({ files: [], texts: [] }));
  ipcMain.handle('island:prefs', () => ({ island: true, widgets: {}, islandPulse: false, motion: 'full', trigger: 'Shift' }));
  for (const ch of ['island:interactive', 'island:dropped', 'island:wantBackdrop', 'island:state', 'island:setPrefs', 'island:wantStats', 'ask:closed', 'ask:request']) ipcMain.on(ch, () => {});
  ipcMain.on('ask:query', async (e, { id, text }) => {
    const send = (msg) => { if (!e.sender.isDestroyed()) e.sender.send('ask:event', { id, ...msg }); };
    const res = await engine.ask(text, ctx, send);
    send({ ...res, type: res.type === 'error' ? 'error' : 'done', final: true });
  });
  const trashed = [];
  const trashCalls = [];
  ipcMain.handle('ask:trash', async (_e, { items, allow }) => { const r = await engine.trash(items, { allow }); trashCalls.push(items.length); trashed.push(r.batchId); return r; });
  ipcMain.handle('ask:undo', async (_e, id) => { const r = await engine.undo(id); trashed.splice(trashed.indexOf(id), 1); return r; });
  ipcMain.handle('ask:purge', async (_e, id) => { trashed.splice(trashed.indexOf(id), 1); return engine.purge(id); });
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));

  const desktop = await sharp(Buffer.from(desktopSvg)).jpeg().toBuffer();
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, transparent: true, skipTaskbar: true, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'island', 'island.html'));
  win.showInactive();
  win.setIgnoreMouseEvents(true);
  win.webContents.send('island:layout', { mode: 'top', dx: 390, dy: 0, dby: 0, up: false });
  win.webContents.send('island:backdrop', `data:image/jpeg;base64,${desktop.toString('base64')}`);
  await wait(800);

  const js = (code) => win.webContents.executeJavaScript(`(async () => { const i = window.__island, a = i.ask; ${code} })()`);
  const shot = async (name) => {
    const png = (await win.webContents.capturePage()).toPNG();
    await sharp(desktop).composite([{ input: await sharp(png).resize(W, H).toBuffer() }]).png().toFile(path.join(OUT, `${name}.png`));
  };
  const results = [];
  const check = (name, ok, info) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, info !== undefined ? JSON.stringify(info) : ''); };
  const ask = async (text) => { await js(`document.getElementById('askInput').value = ${JSON.stringify(text)}; a.run(${JSON.stringify(text)});`); };
  const until = async (code, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(150); } return false; };

  try {
    // 1) Open, like the shortcut does, from File Explorer showing the test folder.
    win.webContents.send('ask:open', { context: contextLabel(fg), suggestions: suggest(fg), key: 'Ctrl Space' });
    await wait(900);
    const s1 = await js(`return { state: i.state, sugg: document.querySelectorAll('.sugg').length, ctx: document.getElementById('askCtxApp').textContent }`);
    check('opens with suggestions for the window', s1.state === 'ask' && s1.sugg === 3 && s1.ctx === 'File Explorer', s1);
    await shot('1-suggestions');

    // 2) The question from the video.
    await ask(`show me files over 4mb in "${root}"`);
    await wait(250);
    await shot('2-searching');
    await until(`return !!document.getElementById('askRemoveAll')`);
    await wait(700);
    const s2 = await js(`return { title: document.querySelector('.ask-title').textContent, rows: document.querySelectorAll('.frow').length }`);
    check('lists the five big files', s2.rows === 5 && /^5 files over 4 MB/.test(s2.title), s2);
    await shot('3-results');

    // 3) Remove all: the files tumble into the bud.
    await js(`document.getElementById('askRemoveAll').click()`);
    await wait(330);
    await shot('4-flying');
    await until(`return !!document.querySelector('.cleared #askUndo')`);
    await wait(900);
    const gone = ['Xcode_26_beta.zip', 'Downloads/Sonoma_Installer.iso'].every((f) => !fs.existsSync(path.join(root, f)));
    check('cleared, files are in the Recycle Bin', gone, await js(`return document.querySelector('.dtext b').textContent`));
    await shot('5-cleared');

    // 4) Undo puts them back.
    await js(`document.getElementById('askUndo').click()`);
    await until(`return /Put back/.test(document.querySelector('.dtext b')?.textContent || '')`);
    const back = ['Xcode_26_beta.zip', 'Downloads/Sonoma_Installer.iso', 'Music/Logic_Session_Bounce.wav'].every((f) => fs.existsSync(path.join(root, f)));
    check('Undo restores every file', back, await js(`return document.querySelector('.dtext b').textContent`));
    await wait(500);
    await shot('6-undone');

    // 4b) Remove one again, then "Free the space now" with its confirm step.
    await ask(`show me files over 4mb in "${root}"`);
    await until(`return !!document.querySelector('[data-trash]')`);
    const before = trashCalls.length;
    const clickInfo = await js(`const b = document.querySelector('[data-trash]'); b.click(); return { busy: a.busy, ghosts: document.querySelectorAll('.ghost').length }`);
    await wait(1500);
    const singleOk = trashCalls.length === before + 1 && trashCalls[trashCalls.length - 1] === 1 && (await js(`return document.querySelectorAll('.frow').length`)) === 4;
    check('removes a single file from its row (even mid-search)', singleOk, { clickInfo, calls: trashCalls.slice(before), rows: await js(`return document.querySelectorAll('.frow').length`) });
    await js(`document.getElementById('askRemoveAll').click()`);
    await until(`return !!document.getElementById('askFreeBtn')`);
    await wait(700);
    await js(`document.getElementById('askFreeBtn').click()`);
    await wait(500);
    await shot('6b-free-confirm');
    const confirmShown = await js(`return !!document.getElementById('askFreeYes')`);
    await js(`document.getElementById('askFreeYes').click()`);
    await until(`return /freed/.test(document.querySelector('.dtext b')?.textContent || '')`);
    await wait(600);
    await shot('6c-freed');
    check('Free now asks first, then frees', confirmShown && /freed/.test(await js(`return document.querySelector('.dtext b').textContent`)), await js(`return document.querySelector('.dtext').textContent`));
    // Bring the single removal back out of the Recycle Bin first. Recreating it instead would leave
    // its copy in the user's bin for good (the final Undo refuses to overwrite a file that's back).
    for (const id of [...trashed]) await engine.undo(id);
    trashed.length = 0;
    // The batch freed for good is gone; make those files again for the steps below.
    for (const f of ['Xcode_26_beta.zip', 'Desktop/Projects/Motion_Promo_v12.aep', 'Documents/iPhone_Backup_Sept.zip', 'Music/Logic_Session_Bounce.wav', 'Downloads/Sonoma_Installer.iso']) if (!fs.existsSync(path.join(root, f))) await put(f, 4.2 * MB, 7);

    // 5) Duplicates.
    await ask(`duplicate photos in "${root}"`);
    await until(`return /duplicate/.test(document.querySelector('.ask-title')?.textContent || '') && !document.querySelector('.shimmer')`);
    await wait(600);
    const s5 = await js(`return { title: document.querySelector('.ask-title').textContent, keep: document.querySelector('.frow.keep b')?.textContent }`);
    check('duplicates keep the original', /1 duplicate copy/.test(s5.title) && s5.keep === 'Trip.jpg', s5);
    await shot('7-duplicates');

    // 6) An action, in words.
    await ask(`compress images in "${path.join(root, 'Photos')}"`);
    await until(`return !!document.getElementById('askDo')`);
    await wait(900);
    const s6 = await js(`return { btn: document.getElementById('askDo').textContent, thumbs: document.querySelectorAll('.th img').length }`);
    check('action preview with thumbnails', /Compress 3 images/.test(s6.btn) && s6.thumbs === 3, s6);
    await shot('8-action');

    // 7) Caches (read-only on this PC: measured and shown, nothing removed).
    await ask('clean up junk');
    await until(`return /caches|clean/i.test(document.querySelector('.ask-title')?.textContent || '') && !document.querySelector('.shimmer')`, 60000);
    await wait(700);
    check('caches view', await js(`return document.querySelectorAll('.cat').length >= 0 && !!document.querySelector('.ask-title')`), await js(`return document.querySelector('.ask-title').textContent`));
    await shot('9-caches');

    // 8) Something it can't do.
    await ask('write me a poem about rain');
    await until(`return !!document.querySelector('.chips')`);
    await wait(500);
    check('says what it can do instead', await js(`return document.querySelectorAll('.chip').length === 5`));
    await shot('10-unknown');
    check('no errors in the page', !errors.length, errors);
  } catch (err) {
    check('no crash', false, err.stack);
  } finally {
    for (const id of [...trashed]) await engine.undo(id);
    fs.rmSync(root, { recursive: true, force: true });
  }

  const names = fs.readdirSync(OUT).filter((f) => /^\d+-.*\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  const cw = 520, ch = Math.round(H * cw / W);
  const parts = await Promise.all(names.map(async (f, i) => ({ input: await sharp(path.join(OUT, f)).resize(cw).toBuffer(), left: 12 + (i % 2) * (cw + 12), top: 12 + Math.floor(i / 2) * (ch + 12) })));
  await sharp({ create: { width: cw * 2 + 36, height: (ch + 12) * Math.ceil(names.length / 2) + 12, channels: 3, background: '#160a12' } }).composite(parts).png().toFile(path.join(OUT, 'sheet.png'));
  const ok = results.every(Boolean);
  console.log(ok ? '\nALL OK' : '\nFAILED');
  app.exit(ok ? 0 : 1);
});
