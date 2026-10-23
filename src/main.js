const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, desktopCapturer } = require('electron');
const { Hook, VK } = require('./hook');
const settings = require('./settings');
const actions = require('./actions');
const { migrate } = require('./migrate');
const recent = require('./recent');
const { createIsland } = require('./island-main');
const { createAskHost } = require('./ask/host');
const { startUpdates } = require('./updater');

// Pin the data folder to %APPDATA%\Petal regardless of how the app is launched (npm start, packaged exe).
app.setName('Petal');
app.setPath('userData', path.join(app.getPath('appData'), 'Petal'));

const WHEEL_SIZE = 440;
const DRAG_THRESHOLD = 8; // px of movement before a held button counts as a drag

if (!app.requestSingleInstanceLock()) app.quit();

let wheel, onboarding, tray, island, ask, updates;
let paused = false;

// ---------- drag + trigger detection (global low-level hooks) ----------
const hook = new Hook();
const drag = { down: null, active: false, dwellTimer: null };
let wheelOpen = false;
let dropReceived = false;

function armDwell() {
  const t = settings.get().trigger;
  if (t.type !== 'dwell') return;
  clearTimeout(drag.dwellTimer);
  drag.dwellTimer = setTimeout(() => { if (drag.active && !wheelOpen) showWheel(); }, t.ms);
}

function startHooks() {
  if (process.env.PETAL_DEBUG) {
    hook.on('ready', () => console.log('[hook] ready'));
    hook.on('down', (e) => console.log('[hook] down', e.x, e.y));
    hook.on('up', () => console.log('[hook] up, dragActive:', drag.active, 'wheelOpen:', wheelOpen));
    hook.on('key', (e) => console.log('[hook] key', e.vk, e.name, 'dragActive:', drag.active));
  }

  hook.on('down', (e) => {
    drag.down = e;
    drag.active = false;
  });

  hook.on('move', (e) => {
    if (!drag.down || paused) return;
    if (!drag.active && Math.hypot(e.x - drag.down.x, e.y - drag.down.y) > DRAG_THRESHOLD) {
      drag.active = true;
      captureBackdrop(); // grab it now, before the wheel is on screen, so the glass has something to refract
    }
    if (drag.active && !wheelOpen) armDwell();
    if (drag.active) island?.dragMove(e);
  });

  hook.on('up', () => {
    drag.down = null;
    drag.active = false;
    clearTimeout(drag.dwellTimer);
    island?.dragEnd();
    // The renderer's drop event and this hook event race; give the drop a moment to land.
    if (wheelOpen) setTimeout(() => { if (!dropReceived) hideWheel(); }, 350);
  });

  hook.on('key', ({ vk }) => {
    if (vk === VK.Escape) { if (wheelOpen && !dropReceived) hideWheel(); return; }
    if (paused || !drag.active || wheelOpen) return;
    const t = settings.get().trigger;
    if (t.type === 'key' && vk === t.vk) showWheel();
  });

  // Step the island aside while a game or video is fullscreen on its monitor.
  hook.on('fullscreen', (rect) => island?.setFullscreen(rect));
  if (process.env.PETAL_DEBUG) hook.on('fullscreen', (rect) => console.log('[hook] fullscreen', JSON.stringify(rect)));

  hook.start();
}

// ---------- glass backdrop ----------
// A transparent window can't blur what's behind it, so the petals refract a snapshot of the screen instead.
// It's taken in memory when a drag starts, cropped to the wheel, and never written anywhere.
let backdrop = null;   // { image: NativeImage, display, at }
let capturing = null;

function captureBackdrop(force = false) {
  if (capturing) return capturing;
  if (!force && backdrop && Date.now() - backdrop.at < 600) return Promise.resolve();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  capturing = desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    .then((sources) => {
      const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (src) backdrop = { image: src.thumbnail, display, at: Date.now() };
      if (wheelOpen) sendBackdrop();
    })
    .catch(() => {})
    .finally(() => { capturing = null; });
  return capturing;
}

// Crop the latest snapshot to a window's bounds (DIP). Null when there's no snapshot or the window
// hangs off the snapshot's screen; callers then fall back to plain frosted glass.
function cropBackdrop(b) {
  if (!backdrop || backdrop.image.isEmpty()) return null;
  const d = backdrop.display;
  const k = backdrop.image.getSize().width / d.bounds.width; // physical px per DIP
  const rect = {
    x: Math.round((b.x - d.bounds.x) * k), y: Math.round((b.y - d.bounds.y) * k),
    width: Math.round(b.width * k), height: Math.round(b.height * k),
  };
  const full = backdrop.image.getSize();
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > full.width || rect.y + rect.height > full.height) return null;
  return `data:image/jpeg;base64,${backdrop.image.crop(rect).toJPEG(82).toString('base64')}`;
}

function sendBackdrop() {
  const url = cropBackdrop(wheel.getBounds());
  if (url) wheel.webContents.send('wheel:backdrop', url);
}

// ---------- wheel overlay ----------
function createWheel() {
  wheel = new BrowserWindow({
    width: WHEEL_SIZE, height: WHEEL_SIZE,
    show: false, frame: false, transparent: true, resizable: false, movable: false, title: 'Petal wheel',
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  wheel.setAlwaysOnTop(true, 'screen-saver');
  wheel.loadFile(path.join(__dirname, 'wheel', 'wheel.html'));
}

function showWheel() {
  const p = screen.getCursorScreenPoint();
  wheel.setBounds({ x: Math.round(p.x - WHEEL_SIZE / 2), y: Math.round(p.y - WHEEL_SIZE / 2), width: WHEEL_SIZE, height: WHEEL_SIZE });
  dropReceived = false;
  wheelOpen = true;
  wheel.webContents.send('wheel:open');
  sendBackdrop();
  wheel.showInactive();
  if (process.env.PETAL_DEBUG) console.log('[wheel] shown at', JSON.stringify(wheel.getBounds()));
}

function hideWheel() {
  wheelOpen = false;
  dropReceived = false;
  wheel.webContents.send('wheel:close');
  wheel.hide();
}

ipcMain.on('debug:log', (_e, msg) => { if (process.env.PETAL_DEBUG) console.log('[wheel]', msg); });
ipcMain.on('wheel:dropped', () => { dropReceived = true; });
ipcMain.on('wheel:done', () => hideWheel());
ipcMain.handle('action:run', async (e, { action, paths, options }) => {
  if (actions.EDITORS[action]) { openEditor(action, paths); return { opened: true }; }
  const res = await actions.run(action, paths, options, (p) => e.sender.send('action:progress', p));
  recent.record(action, res);
  if (island && e.sender !== island.win.webContents) island.notifyExternal(action, res);
  return res;
});

// ---------- editors (crop, add bg, edit, annotate, redact) ----------
const editorJobs = new Map(); // webContents id -> { mode, paths }

function openEditor(mode, paths) {
  const win = new BrowserWindow({
    width: 940, height: 740, minWidth: 720, minHeight: 600,
    show: false, frame: false, backgroundColor: '#1a2128', title: 'Petal',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const id = win.webContents.id;
  editorJobs.set(id, { mode, paths });
  win.on('closed', () => editorJobs.delete(id));
  win.loadFile(path.join(__dirname, 'editor', 'editor.html'));
  win.once('ready-to-show', () => {
    // We're launched from an unfocusable overlay, so Windows may refuse a plain focus(); a brief top-most flash wins it.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.setAlwaysOnTop(false);
  });
}

ipcMain.handle('editor:load', async (e) => {
  const job = editorJobs.get(e.sender.id);
  const files = (await Promise.all(job.paths.map((p) => actions.loadForEditor(p).catch(() => null)))).filter(Boolean);
  return { mode: job.mode, files };
});
ipcMain.handle('editor:save', (e, outputs) => actions.saveEdited(editorJobs.get(e.sender.id).mode, outputs));
ipcMain.on('editor:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on('editor:reveal', (_e, file) => shell.showItemInFolder(file));

// ---------- onboarding / settings ----------
function openOnboarding() {
  if (onboarding && !onboarding.isDestroyed()) {
    if (onboarding.isMinimized()) onboarding.restore();
    return onboarding.focus();
  }
  onboarding = new BrowserWindow({
    width: 940, height: 640, resizable: false, title: 'Petal', frame: false,
    backgroundColor: '#1a2128',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  onboarding.loadFile(path.join(__dirname, 'onboarding', 'onboarding.html'));
}

ipcMain.handle('settings:get', () => ({
  ...settings.get(),
  keys: { Shift: VK.Shift, Ctrl: VK.Ctrl },
  sampleUrl: pathToFileURL(settings.sampleFile()).href,
}));
ipcMain.handle('settings:set', (_e, patch) => {
  if ('island' in patch) { setIslandVisible(patch.island); delete patch.island; }
  return settings.set(patch);
});
ipcMain.on('onboarding:startDrag', (e) => {
  e.sender.startDrag({ file: settings.sampleFile(), icon: nativeImage.createFromPath(settings.sampleFile()).resize({ width: 64 }) });
});
ipcMain.on('onboarding:finish', () => { settings.set({ onboarded: true }); onboarding?.close(); });

// The "custom key" picker reads from the global hook, so the key it records is exactly what the hook will see.
let captureSender = null;
ipcMain.on('settings:captureKey', (e) => {
  captureSender = e.sender;
  // Closing the window mid-capture must not leave a dead sender behind for the next key press.
  e.sender.once('destroyed', () => { if (captureSender === e.sender) captureSender = null; });
});
hook.on('key', ({ vk, name }) => {
  if (!captureSender || captureSender.isDestroyed()) { captureSender = null; return; }
  if (vk === VK.Escape) return; // Esc cancels Windows drags; never a valid trigger
  captureSender.send('settings:keyCaptured', { vk, label: name });
  captureSender = null;
});

// ---------- tray ----------
function setIslandVisible(on) {
  settings.set({ island: on });
  island?.setVisible(on);
  islandSwitched();
}
function setStartAtLogin(on) {
  settings.set({ startAtLogin: on });
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, name: 'Petal' });
  buildTrayMenu();
}

// The island can be switched from three places (tray, Settings window, the island's own Settings
// tab); keep the other two showing the truth.
function islandSwitched() {
  buildTrayMenu();
  if (onboarding && !onboarding.isDestroyed()) onboarding.webContents.send('settings:island', settings.get().island !== false);
}

function buildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: paused ? 'Resume Petal' : 'Pause Petal', click: () => { paused = !paused; buildTrayMenu(); } },
    // Menus treat "&" as a shortcut-letter marker and draw "\t" as an arrow, so neither appears here.
    { label: 'Settings and trigger key…', click: openOnboarding },
    { label: `Ask Petal${ask?.key() ? ` (${ask.key()})` : ''}`, click: () => ask?.open() },
    // Flip from the saved value, not item.checked: the island can be switched off from its own Settings tab.
    { label: 'Show island', type: 'checkbox', checked: settings.get().island !== false, click: () => setIslandVisible(settings.get().island === false) },
    // Only the installed app registers itself (a dev run would register electron.exe).
    ...(app.isPackaged ? [{ label: 'Start with Windows', type: 'checkbox', checked: settings.get().startAtLogin !== false, click: () => setStartAtLogin(settings.get().startAtLogin === false) }] : []),
    { type: 'separator' },
    ...(updates?.state() ? [{ label: `Restart to update to ${updates.state()}`, click: () => updates.install() }] : []),
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip(paused ? 'Petal (paused)' : 'Petal: drag a file, then tap your trigger key');
}

app.whenReady().then(async () => {
  const moved = migrate(app.getPath('appData'), app.getPath('userData'));
  if (moved.length && process.env.PETAL_DEBUG) console.log('[migrate] moved from dropwheel:', moved.join(', '));
  await settings.init(app.getPath('userData'));
  actions.init(app.getPath('userData'));
  recent.init(app.getPath('userData'));
  createWheel();
  island = createIsland({ recent, cropBackdrop, captureBackdrop, openSettings: openOnboarding, settings, hook, onPrefsChanged: (patch) => ('island' in patch ? islandSwitched() : buildTrayMenu()) });
  ask = createAskHost({ island, settings, hook });
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.on('click', openOnboarding);
  buildTrayMenu();
  startHooks();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.get().startAtLogin !== false, path: process.execPath, name: 'Petal' });
  updates = startUpdates({ onReady: buildTrayMenu });
  if (!settings.get().onboarded) openOnboarding();
});

app.on('second-instance', openOnboarding);
app.on('window-all-closed', (e) => e.preventDefault()); // tray app: keep running
app.on('will-quit', () => hook.stop());
