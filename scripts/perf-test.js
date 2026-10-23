// How much CPU Petal costs while you're not using it. Loads the real island and wheel pages the way
// the app does, puts them in each resting state, and reads Electron's own per-process CPU for 6 s.
// Numbers are % of ONE core (100 = a whole core). Budgets are for a slow 4-core laptop.
// Run: npx electron scripts/perf-test.js
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLE_MS = 6000;

app.whenReady().then(async () => {
  ipcMain.handle('island:recent', () => ({ files: [], texts: [] }));
  ipcMain.handle('island:prefs', () => ({ island: true, widgets: { cpu: true, gpu: true, ram: true, net: true, battery: true, clock: true }, islandPulse: true, motion: 'full', islandPos: { mode: 'top', fx: 0.5, fy: 0 }, trigger: 'Shift' }));
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));
  for (const ch of ['ask:closed', 'ask:request', 'island:interactive', 'island:dropped', 'island:wantBackdrop', 'island:state', 'island:setPrefs', 'island:wantStats', 'island:moveTo', 'island:moveEnd', 'wheel:dropped', 'wheel:done', 'debug:log']) ipcMain.on(ch, () => {});

  const make = (page, w, h) => {
    const win = new BrowserWindow({
      width: w, height: h, show: false, frame: false, transparent: true, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js') },
    });
    win.setIgnoreMouseEvents(true);           // the real cursor must not hover it mid-measurement
    return win.loadFile(path.join(__dirname, '..', 'src', page)).then(() => win);
  };
  const island = await make('island/island.html', 780, 600);
  const wheel = await make('wheel/wheel.html', 560, 560);
  island.webContents.send('island:layout', { mode: 'top', dx: 390, dy: 0, dby: 0, up: false });
  const stats = (n) => ({ cpu: 20 + (n % 7) * 3, gpu: 3, ram: 70, ramUsed: 16, ramTotal: 24, rx: 20000, tx: 3000, bat: 60, ac: 1 });
  let n = 0;
  const feed = setInterval(() => island.webContents.send('island:stats', stats(n++)), 1000);

  async function measure() {
    // cumulativeCPUUsage is CPU-seconds since the process started; the difference over the window is the load.
    const before = new Map(app.getAppMetrics().map((p) => [p.pid, p.cpu.cumulativeCPUUsage]));
    await wait(SAMPLE_MS);
    const m = app.getAppMetrics();
    const pid = { island: island.webContents.getOSProcessId(), wheel: wheel.webContents.getOSProcessId() };
    const of = (fn) => m.filter(fn).reduce((s, p) => s + ((p.cpu.cumulativeCPUUsage - (before.get(p.pid) ?? p.cpu.cumulativeCPUUsage)) / (SAMPLE_MS / 1000)) * 100, 0);
    return {
      island: of((p) => p.pid === pid.island),
      wheel: of((p) => p.pid === pid.wheel),
      gpu: of((p) => p.type === 'GPU'),
      main: of((p) => p.type === 'Browser'),
    };
  }
  const js = (code) => island.webContents.executeJavaScript(`(() => { const i = window.__island; ${code} })()`);

  const scenes = [
    // [name, setup, budget for island+wheel+gpu+main in % of one core]
    ['island idle (on screen)', async () => { island.showInactive(); await js(`i.setState('idle')`); }, 5],
    ['island idle · pulse off', async () => { island.webContents.send('island:prefsChanged', { islandPulse: false }); }, 3],
    ['island idle · pulse back on', async () => { island.webContents.send('island:prefsChanged', { islandPulse: true }); }, 6],
    ['island hidden', async () => { island.hide(); }, 3],
    ['island hover · glance', async () => { island.showInactive(); await js(`i.showTab('glance'); i.setState('hover')`); }, 20],
    ['island hover · glance · calm', async () => { await js(`i.setState('hover')`); island.webContents.send('island:prefsChanged', { motion: 'calm' }); }, 15],
    ['island idle · calm motion', async () => { await js(`i.setState('idle')`); }, 3],
    ['Ask open, waiting to type', async () => {
      island.webContents.send('island:prefsChanged', { motion: 'full' });
      island.webContents.send('ask:open', { context: { app: 'File Explorer', detail: 'Downloads' }, key: 'Ctrl Ctrl', suggestions: [
        { icon: 'size', title: 'Biggest files in Downloads', sub: 'Sorted by size', query: 'biggest files in downloads' },
        { icon: 'dupes', title: 'Duplicates in Downloads', sub: 'Identical copies', query: 'duplicate files in downloads' },
        { icon: 'broom', title: 'Caches and junk', sub: 'Temp files', query: 'clean up junk' }] });
    }, 6],
    ['Ask closed again', async () => { await js(`i.setState('idle')`); }, 5],
    // While you're actively using Petal: short-lived, so the budgets are looser (measured on a 144 Hz screen).
    ['island drag (file over it)', async () => { island.webContents.send('island:prefsChanged', { motion: 'full' }); await js(`i.setState('drag'); i.setHot('compress')`); }, 25],
    ['island working', async () => { await js(`i.startWork('Compressing', 'Photo.jpg')`); }, 25],
    ['wheel open', async () => { await js(`i.setState('idle')`); island.hide(); wheel.showInactive(); wheel.webContents.send('wheel:open'); }, 30],
    ['wheel closed again', async () => { wheel.webContents.send('wheel:close'); wheel.hide(); }, 2],
  ];
  let ok = true;
  for (const [name, setup, budget] of scenes) {
    await setup();
    await wait(2200);                         // let transitions finish and the bud settle
    if (process.env.PERF_DEBUG) {
      await island.webContents.executeJavaScript(`window.__rafN = 0; window.__rafBy = {}; if (!window.__rafWrapped) { window.__rafWrapped = 1; const o = requestAnimationFrame; window.requestAnimationFrame = (f) => { window.__rafN++; const k = (f.name || 'anon') + ':' + String(f).slice(0, 40).replace(/s+/g, ' '); (window.__rafBy ||= {})[k] = (window.__rafBy[k] || 0) + 1; return o(f); }; } 0`);
    }
    if (process.env.PERF_DEBUG) island.webContents.executeJavaScript(`window.__seen = {}; window.__probe = setInterval(() => { for (const a of document.getAnimations()) if (a.playState === 'running') { const k = (a.animationName || a.transitionProperty) + '@' + (a.effect?.target?.id || a.effect?.target?.className?.baseVal || a.effect?.target?.className); window.__seen[k] = (window.__seen[k] || 0) + 1; } }, 300); 0`);
    const r = await measure();
    if (process.env.PERF_DEBUG) console.log('    seen', await island.webContents.executeJavaScript('clearInterval(window.__probe); JSON.stringify(window.__seen)'));
    if (process.env.PERF_DEBUG) console.log('   ', await island.webContents.executeJavaScript(`JSON.stringify({ raf: window.__rafN, by: window.__rafBy, anims: document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty) + '@' + (a.effect?.target?.id || a.effect?.target?.className?.baseVal || a.effect?.target?.className) + (a.effect?.pseudoElement || '')) })`));
    const total = r.island + r.wheel + r.gpu + r.main;
    const pass = total <= budget;
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name.padEnd(28)} total ${total.toFixed(1).padStart(5)}% (budget ${budget}%)  island ${r.island.toFixed(1)}  wheel ${r.wheel.toFixed(1)}  gpu ${r.gpu.toFixed(1)}  main ${r.main.toFixed(1)}`);
  }
  clearInterval(feed);
  console.log(ok ? '\nALL OK' : '\nFAILED');
  app.exit(ok ? 0 : 1);
});
