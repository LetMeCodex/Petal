// Island placement + fullscreen behaviour.  Run: npx electron scripts/fullscreen-test.js
// 1. Placement maths on two fake monitors (different positions and sizes).
// 2. A real island hides while its monitor is fullscreen, comes back after, and ignores other monitors.
// 3. The hook helper notices a real fullscreen window (an invisible one, open for about a second).
const path = require('path');
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { createIsland, islandBounds, coversDisplay } = require('../src/island-main');
const { Hook } = require('../src/hook');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };

app.whenReady().then(async () => {
  ipcMain.handle('ask:key', () => ({ key: 'DoubleCtrl', label: 'Ctrl Ctrl' }));
  // ---------- 1. placement ----------
  const left = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 } };
  const right = { id: 2, bounds: { x: 1536, y: -200, width: 2560, height: 1440 } };   // taller monitor, offset up
  const bl = islandBounds(left), br = islandBounds(right);
  check('island centred at top of left monitor', bl.x === 378 && bl.y === 0, JSON.stringify(bl));
  check('island centred at top of right monitor', br.x === 1536 + 890 && br.y === -200, JSON.stringify(br));
  const fsRight = { x: 1536, y: -200, width: 2560, height: 1440 };
  check('fullscreen on right hides only there', coversDisplay(fsRight, right) && !coversDisplay(fsRight, left));
  check('no fullscreen covers nothing', !coversDisplay(null, left));

  // ---------- 2. a real island reacts ----------
  const island = createIsland({
    recent: { list: () => ({ files: [], texts: [] }) },
    cropBackdrop: () => null, captureBackdrop: () => Promise.resolve(), openSettings: () => {},
  });
  await new Promise((r) => island.win.once('ready-to-show', r));
  await wait(300);
  const d = screen.getDisplayMatching(island.win.getBounds());
  const phys = screen.dipToScreenRect(null, d.bounds);
  check('island visible at start', island.win.isVisible());
  island.setFullscreen(phys);
  check('hides when its monitor goes fullscreen', !island.win.isVisible());
  island.setFullscreen(null);
  await wait(100);
  check('returns when fullscreen ends', island.win.isVisible());
  island.setFullscreen({ x: phys.x + phys.width + 4000, y: phys.y, width: 1920, height: 1080 });
  check('ignores fullscreen on another monitor', island.win.isVisible());
  island.setFullscreen(null);
  island.setVisible(false);
  check('tray switch still hides it', !island.win.isVisible());
  island.setVisible(true);

  // ---------- 3. the helper spots a real fullscreen window ----------
  const hook = new Hook();
  const events = [];
  hook.on('fullscreen', (r) => events.push(r));
  hook.start(1);   // owner pid 1: this test's own window must count
  if (process.env.FS_DEBUG) {
    const dbg = require('child_process').spawn(path.join(__dirname, '..', 'src', 'native', 'hook.exe'), ['1', 'debug']);
    require('readline').createInterface({ input: dbg.stdout }).on('line', (l) => { if (l.startsWith('dbg') || l.startsWith('fs')) console.log('   ', l); });
    app.on('will-quit', () => dbg.kill());
  }
  await wait(800);
  const before = events.length;
  const fsWin = new BrowserWindow({ show: false, frame: false, opacity: 0, fullscreen: true, skipTaskbar: true, backgroundColor: '#000' });
  await fsWin.loadURL('data:text/html,<body style="background:#000"></body>');
  // Windows won't hand the foreground to a background app on request; a brief top-most flash wins it.
  fsWin.setAlwaysOnTop(true);
  fsWin.show();
  fsWin.focus();
  fsWin.setAlwaysOnTop(false);
  await wait(1600); // the helper checks every 400 ms; leave room for the window to settle
  console.log('  test window focused:', fsWin.isFocused(), 'fullscreen:', fsWin.isFullScreen(), 'bounds:', JSON.stringify(fsWin.getBounds()), 'display:', JSON.stringify(d.bounds), ' events:', JSON.stringify(events.slice(before)));
  const seen = events.slice(before).find(Boolean);
  fsWin.destroy();
  await wait(900);
  const cleared = events[events.length - 1] === null;
  check('helper reports the fullscreen window', !!seen && seen.width >= phys.width - 2, JSON.stringify(seen));
  check('helper reports when it ends', cleared);
  hook.stop();

  console.log(failed ? `\nFAILED: ${failed}` : '\nALL OK');
  app.exit(failed ? 1 : 0);
});
