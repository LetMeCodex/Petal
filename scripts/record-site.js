// Records Petal's real UI as transparent video loops for the website.
// Renders the actual app pages (wheel, island, Ask) off-screen at 30 fps, drives them through their
// states with the same test hooks the test suites use, and encodes each clip three ways:
//   <name>.webm  VP9 with alpha (Chrome, Edge, Firefox)
//   <name>.mp4   H.264 over the site's paper colour (Safari and anything without VP9 alpha)
//   <name>.png   first-good-frame poster
// Run: npx electron scripts/record-site.js <out dir> [clip names…]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '.snap', 'site'));
const ONLY = process.argv.slice(3);
const FPS = 30;
const PAPER = '#0c0b0d';
const SRC = path.join(__dirname, '..', 'src');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The site is near-black paper; give the glass the same thing to frost and refract.
async function paper(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="v" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#1a171c"/><stop offset="1" stop-color="${PAPER}"/></radialGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .05 0"/></filter></defs>
    <rect width="100%" height="100%" fill="url(#v)"/><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `data:image/jpeg;base64,${(await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()).toString('base64')}`;
}

function ffmpeg(args) { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); }

// Captures `seconds` of an off-screen window at a steady FPS while `script` drives it.
async function record({ name, page, size: [w, h], crop, seconds, setup, script }) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `petal-rec-${name}-`));
  const win = new BrowserWindow({
    width: w, height: h, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { preload: path.join(SRC, 'preload.js'), offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => { latest = image; });
  await win.loadFile(path.join(SRC, page));
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const send = (ch, ...a) => win.webContents.send(ch, ...a);
  await setup?.({ js, send, win });
  await wait(900);

  // Fixed ticks: whatever was last painted is frame N, so the clip plays at real speed.
  let n = 0;
  const total = Math.round(seconds * FPS);
  const t0 = Date.now();
  const writing = [];
  const ticker = setInterval(() => {
    if (!latest || n >= total) return;
    const due = Math.floor(((Date.now() - t0) / 1000) * FPS);
    while (n <= due && n < total) {
      const png = latest.toPNG();
      writing.push(fs.promises.writeFile(path.join(dir, `f${String(n).padStart(5, '0')}.png`), png));
      n++;
    }
  }, 1000 / FPS / 2);
  await script({ js, send, win, wait });
  while (n < total) await wait(20);
  clearInterval(ticker);
  await Promise.all(writing);
  win.destroy();

  const scale = latest ? latest.getSize().width / w : 1;   // device pixels per CSS pixel
  // H.264 needs even dimensions (at 125% scaling, 700 CSS px is 877 device px).
  const c = crop ? crop.map((v, i) => { const d = Math.round(v * scale); return i >= 2 ? d - (d % 2) : d; }) : null;
  const vf = [c ? `crop=${c[2]}:${c[3]}:${c[0]}:${c[1]}` : null].filter(Boolean).join(',');
  const input = ['-framerate', String(FPS), '-i', path.join(dir, 'f%05d.png')];
  ffmpeg([...input, ...(vf ? ['-vf', vf] : []), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-auto-alt-ref', '0', '-an', path.join(OUT, `${name}.webm`)]);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${PAPER}:s=16x16`, ...input, '-filter_complex', `[1:v]${vf ? `${vf},` : ''}format=rgba[fg];[0:v][fg]scale2ref[bg][fg2];[bg][fg2]overlay=shortest=1,format=yuv420p`, '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', '-an', path.join(OUT, `${name}.mp4`)]);
  const posterFrame = path.join(dir, `f${String(Math.min(total - 1, Math.round(total * 0.6))).padStart(5, '0')}.png`);
  let poster = sharp(posterFrame);
  if (c) poster = poster.extract({ left: c[0], top: c[1], width: c[2], height: c[3] });
  await poster.png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));
  fs.rmSync(dir, { recursive: true, force: true });
  const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
  console.log(`${name}: ${n} frames · webm ${kb(`${name}.webm`)} KB · mp4 ${kb(`${name}.mp4`)} KB`);
}

// Each clip closes its window before the next opens; don't let that quit the app.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // The island page asks the main process for these; answer like the app would.
  ipcMain.handle('island:recent', () => ({ files: [], texts: [] }));
  ipcMain.handle('island:prefs', () => ({ island: true, widgets: { cpu: true, gpu: true, ram: true, net: true, battery: true, clock: true }, islandPulse: true, motion: 'full', islandPos: { mode: 'top', fx: 0.5, fy: 0 }, trigger: 'Shift' }));
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));
  for (const ch of ['island:interactive', 'island:dropped', 'island:wantBackdrop', 'island:state', 'island:setPrefs', 'island:wantStats', 'island:moveTo', 'island:moveEnd', 'ask:closed', 'ask:request', 'wheel:dropped', 'wheel:done', 'debug:log', 'island:startDrag']) ipcMain.on(ch, () => {});

  // ---------------- the wheel ----------------
  // Opens under the cursor, the light follows a file as it sweeps over the petals, settles on
  // Remove background, the petal is plucked into the dome, and the toast fills and succeeds.
  const PETAL_IDS = ['compress', 'metadata', 'ocr', 'edit', 'annotate', 'addbg', 'removebg', 'crop', 'redact', 'merge'];
  const at = (i, r = 150) => { const a = (-90 + i * 36) * Math.PI / 180; return [220 + Math.cos(a) * r, 220 + Math.sin(a) * r]; };
  await record({
    name: 'wheel-bloom', page: 'wheel/wheel.html', size: [440, 440], seconds: 7.5,
    setup: async ({ send }) => { send('wheel:backdrop', await paper(440, 440)); },
    script: async ({ js, send, wait }) => {
      await wait(300);
      send('wheel:open');
      await js(`window.__wheel.describeDrag(['image/jpeg'])`);
      await wait(900);
      for (const i of [0, 1, 2, 3, 4, 5, 6]) {
        const [x, y] = at(i);
        await js(`window.__wheel.track(${x}, ${y}); window.__wheel.setHot('${PETAL_IDS[i]}')`);
        await wait(i === 6 ? 900 : 380);
      }
      await js(`window.__wheel.pluck('removebg'); window.__wheel.showToast('Removing background', 'mug.jpg', 0.2, '')`);
      for (const f of [0.35, 0.55, 0.75, 0.92]) { await wait(320); await js(`window.__wheel.showToast('Removing background', 'mug.jpg', ${f}, '')`); }
      await wait(300);
      await js(`window.__wheel.showToast('Saved', 'mug No BG.png', 1, 'success'); window.__wheel.celebrate?.()`);
      await wait(1600);
    },
  });

  // ---------------- the island ----------------
  // One canvas size for every state (so the site can swap clips without a jump): 700 x 340 from
  // the top of the 780 px island window, centred on the drop.
  const ISLAND = { page: 'island/island.html', size: [780, 600], crop: [40, 0, 700, 340] };
  const islandSetup = async ({ send }) => {
    send('island:layout', { mode: 'top', dx: 390, dy: 0, dby: 0, up: false });
    send('island:backdrop', await paper(780, 600));
  };
  // Believable live stats: a busy-ish laptop, values drifting each second like the real feed.
  let tick = 0;
  const stats = () => {
    tick++;
    return { cpu: 22 + 14 * Math.sin(tick / 2.2) + (tick % 3) * 3, gpu: 18 + 9 * Math.cos(tick / 1.7), ram: 54 + (tick % 5 === 0 ? 2 : 0), ramUsed: 8.6, ramTotal: 16,
      rx: tick % 4 === 0 ? 2.1e6 : 14.2e6 + 3e6 * Math.sin(tick), tx: 420e3, bat: 94, ac: 1 };
  };
  const feedStats = (send, seconds) => (async () => { for (let i = 0; i < seconds; i++) { send('island:stats', stats()); await wait(1000); } })();

  await record({
    ...ISLAND, name: 'island-idle', seconds: 5, setup: islandSetup,
    script: async ({ js, send }) => { await js(`window.__island.setState('idle')`); await feedStats(send, 5); },
  });
  await record({
    ...ISLAND, name: 'island-glance', seconds: 6.5, setup: islandSetup,
    script: async ({ js, send }) => {
      send('island:stats', stats());
      await wait(400);
      await js(`window.__island.showTab('glance'); window.__island.setState('hover')`);
      await feedStats(send, 6);
    },
  });
  await record({
    ...ISLAND, name: 'island-drag', seconds: 5.5, setup: islandSetup,
    script: async ({ js }) => {
      await wait(300);
      await js(`window.__island.setState('drag')`);
      // A file approaches from below; the tendril follows it; petals light up as it passes.
      const hot = ['convert', 'removebg', 'compress', 'ocr', 'removebg'];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const x = 180 + 420 * t, y = 330 - 40 * Math.sin(t * Math.PI);
        await js(`window.__island.drawTendril(${x.toFixed(1)}, ${y.toFixed(1)}); ${i % 8 === 0 ? `window.__island.setHot('${hot[i / 8]}')` : ''}`);
        await wait(110);
      }
    },
  });
  await record({
    ...ISLAND, name: 'island-work', seconds: 5, setup: islandSetup,
    script: async ({ js, send }) => {
      await js(`window.__island.startWork('Removing background', 'mug.jpg')`);
      for (let i = 1; i <= 8; i++) { await wait(520); send('action:progress', { done: i, total: 8 }); }
      await wait(500);
    },
  });
  const cutout = process.env.PETAL_DONE_FILE || path.join(os.homedir(), 'Downloads', 'Petal', 'public', 'specimens', 'mug-cutout.png');
  await record({
    ...ISLAND, name: 'island-done', seconds: 5, setup: islandSetup,
    script: async ({ js }) => {
      await wait(200);
      await js(`window.__island.showDone('mug No BG.png is ready', 'Drag it anywhere', ${JSON.stringify(cutout)})`);
      await wait(4800);
    },
  });
  // Carried across the screen: it stretches with speed, previews the edge snap, and wobbles home.
  await record({
    ...ISLAND, name: 'island-jelly', seconds: 6, setup: islandSetup,
    script: async ({ js, send }) => {
      await js(`window.__island.setState('idle')`);
      await wait(400);
      const path2 = [];
      for (let i = 0; i <= 60; i++) { const t = i / 60; path2.push([390 + 230 * Math.sin(t * Math.PI * 2), 40 + 150 * Math.sin(t * Math.PI)]); }
      await js(`document.body.classList.add('moving')`);
      let prev = path2[0];
      for (const [x, y] of path2) {
        const vx = x - prev[0], vy = y - prev[1];
        const k = Math.min(0.22, Math.hypot(vx, vy) * 0.018);
        const horiz = Math.abs(vx) >= Math.abs(vy);
        send('island:layout', { mode: 'float', dx: Math.round(x), dy: Math.round(y), dby: 0, up: false });
        send('island:nearTop', y < 60);
        await js(`document.body.style.setProperty('--sx', '${(horiz ? 1 + k : 1 - k * 0.6).toFixed(3)}'); document.body.style.setProperty('--sy', '${(horiz ? 1 - k * 0.6 : 1 + k).toFixed(3)}')`);
        prev = [x, y];
        await wait(55);
      }
      send('island:layout', { mode: 'top', dx: 390, dy: 0, dby: 0, up: false });
      send('island:nearTop', false);
      await js(`document.body.classList.remove('moving'); document.body.style.setProperty('--sx', '1'); document.body.style.setProperty('--sy', '1'); document.body.classList.add('settle'); setTimeout(() => document.body.classList.remove('settle'), 700)`);
      await wait(1800);
    },
  });

  // ---------------- Petal Ask ----------------
  // The real panel, fed sample results: open from Explorer, type, results stream in, Remove all,
  // the files tumble into the bud, cleaned up, then Undo.
  const MB = 1024 * 1024;
  const now = Date.now(), day = 864e5;
  const item = (name, where, mb, days) => ({ id: name, path: `C:\\Users\\you\\Downloads\\${name}`, name, where, ext: name.split('.').pop(), size: Math.round(mb * MB), onDisk: Math.round(mb * MB), mtime: now - days * day, blocked: null });
  const results = [
    item('raw_capture_4k_60fps.mkv', 'Downloads › Captures', 612.4, 9),
    item('old_sdk_archive_2025.zip', 'Downloads › Temp', 428.0, 41),
    item('win_eval_preview_old.iso', 'Downloads', 342.8, 120),
    item('Figma_Export_Final_v9.mp4', 'Downloads › Work', 318.6, 3),
  ];
  const total = results.reduce((s, i) => s + i.size, 0);
  ipcMain.on('ask:query', async (e, { id }) => {
    const send = (msg) => { if (!e.sender.isDestroyed()) e.sender.send('ask:event', { id, ...msg }); };
    send({ type: 'plan', intent: { kind: 'find', filters: { minSize: 300 * MB, sort: 'size' }, label: 'Files over 300 MB' } });
    for (let k = 1; k <= results.length; k++) { await wait(140); send({ type: 'items', items: results.slice(0, k), partial: true, ready: k === results.length, ms: 300 }); }
    await wait(900);
    send({ type: 'done', final: true, items: results, count: results.length, bytes: total, ms: 300, partial: false, intent: { kind: 'find', filters: { minSize: 300 * MB }, label: 'Files over 300 MB' } });
  });
  ipcMain.handle('ask:trash', async () => { await wait(350); return { batchId: 'demo', moved: results.map((r) => ({ path: r.path, bytes: r.size })), failed: [], bytes: total }; });
  ipcMain.handle('ask:undo', async () => { await wait(300); return { restored: results.map((r) => r.path), failed: [], bytes: total }; });

  await record({
    name: 'ask-flow', page: 'island/island.html', size: [780, 600], crop: [60, 0, 660, 520], seconds: 12,
    setup: islandSetup,
    script: async ({ js, send }) => {
      await wait(300);
      send('ask:open', {
        context: { app: 'File Explorer', detail: 'Downloads' }, key: 'Ctrl Ctrl',
        suggestions: [
          { icon: 'size', title: 'Biggest files in Downloads', sub: "Sorted by size, with what's safe to remove", query: 'biggest files here' },
          { icon: 'dupes', title: 'Duplicates in Downloads', sub: 'Byte-for-byte identical copies', query: 'duplicate files here' },
          { icon: 'clock', title: 'Untouched for 6 months in Downloads', sub: 'Old files you may not need', query: 'old files here' },
        ],
      });
      await wait(1400);
      const q = 'show me huge files over 300 MB';
      for (let i = 1; i <= q.length; i++) { await js(`document.getElementById('askInput').value = ${JSON.stringify(q.slice(0, i))}`); await wait(42); }
      await wait(250);
      await js(`window.__island.ask.run(${JSON.stringify(q)})`);
      await wait(2600);
      await js(`document.getElementById('askRemoveAll').click()`);
      await wait(2600);
      await js(`document.getElementById('askUndo')?.click()`);
      await wait(2200);
    },
  });
  app.exit(0);
});
