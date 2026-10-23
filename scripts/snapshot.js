// Renders the onboarding window (after its bloom animation) to a PNG. Wheel states live in wheel-snap.js.
// Run: npx electron scripts/snapshot.js [outDir]
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain } = require('electron');
const settings = require('../src/settings');
const out = process.argv[2] || path.join(__dirname, '..', '.snap');

app.whenReady().then(async () => {
  await settings.init(app.getPath('userData'));
  ipcMain.handle('settings:get', () => ({ ...settings.get(), keys: { Shift: 16, Ctrl: 17 }, sampleUrl: pathToFileURL(settings.sampleFile()).href }));

  const win = new BrowserWindow({
    width: 940, height: 640, show: false, frame: false, backgroundColor: '#1a2128', opacity: 0, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), backgroundThrottling: false },
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('[page]', e.message); });
  await win.loadFile(path.join(__dirname, '../src/onboarding/onboarding.html'));
  win.showInactive(); // invisible but painting, so CSS animations actually run
  await new Promise((r) => setTimeout(r, 3000));
  // Hover the second card so the tilt + glare state shows up in the shot.
  await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelectorAll('.card')[1], r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.75, clientY: r.top + r.height * 0.3, bubbles: true }));
    c.matches(':hover');
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'onboarding.png'), (await win.webContents.capturePage()).toPNG());
  console.log('saved');
  app.exit(0);
});
