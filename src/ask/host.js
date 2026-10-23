// Petal Ask in the main process: the shortcut, the window you came from, and the IPC between the
// island's Ask panel and the engine.
const path = require('path');
const { app, ipcMain, globalShortcut, shell } = require('electron');
const fsx = require('../fsx');
const { createEngine } = require('./engine');
const { suggest, contextLabel } = require('./suggest');
const safety = require('./safety');
const { createDoubleTap } = require('./doubletap');

// Double-tap Ctrl by default: it never takes a shortcut away from another app. A regular
// accelerator ("Alt+Shift+Space") can be set instead.
const DOUBLE_CTRL = 'DoubleCtrl';

function createAskHost({ island, settings, hook }) {
  safety.protect(app.getPath('userData'), path.join(__dirname, '..', '..'));
  const engine = createEngine({
    dirs: Object.fromEntries(['downloads', 'desktop', 'documents', 'pictures', 'videos', 'music', 'temp'].map((k) => [k, app.getPath(k)])),
    trashItem: (p) => shell.trashItem(p),
    undoFile: path.join(app.getPath('userData'), 'undo.json'),
  });
  let ctx = {};

  // What you were looking at when you called Petal (Petal's own windows never count).
  async function foreground() {
    const { items } = await fsx.run('foreground', {});
    const fg = items[0] || {};
    return fg.pid === process.pid || /\\electron\.exe$|\\petal\.exe$/i.test(fg.exe || '') ? ctx.fg || {} : fg;
  }

  async function open() {
    if (island.askIsOpen()) { island.closeAsk(); return; }
    const fg = await foreground().catch(() => ({}));
    ctx = { fg, folder: fg.folder || null };
    island.openAsk({ context: contextLabel(fg), suggestions: suggest(fg), key: label(currentKey) });
  }

  // ---------- the shortcut ----------
  let currentKey = null;
  const label = (k) => (k === DOUBLE_CTRL ? 'Ctrl Ctrl' : (k || '').replace('Control', 'Ctrl').replace(/\+/g, ' '));
  // Not while a game or video is fullscreen: pressing Ctrl twice is just playing there.
  const tap = createDoubleTap(() => { if (currentKey === DOUBLE_CTRL && !capturing && !island.fullscreenHere()) open(); });
  hook?.on('key', ({ vk }) => tap.keydown(vk));
  hook?.on('keyup', ({ vk }) => tap.keyup(vk));

  // Recording a custom shortcut: the next key pressed together with Ctrl and/or Alt (Shift optional).
  // Read from the hook, since the island never takes the keyboard just to show its settings.
  const held = new Set();
  let capturing = null;
  const MODS = { 16: 'Shift', 17: 'Control', 18: 'Alt' };
  hook?.on('key', ({ vk, name }) => {
    if (MODS[vk]) { held.add(vk); return; }
    if (!capturing) return;
    if (vk === 0x1b) { capturing({ cancelled: true }); return; }
    if (!held.has(17) && !held.has(18)) { capturing({ error: 'Use Ctrl or Alt with it, so it never gets in the way of typing' }); return; }
    const key = name.length === 1 ? name.toUpperCase() : name.replace(/^Spacebar$/i, 'Space');
    capturing({ accel: [17, 18, 16].filter((m) => held.has(m)).map((m) => MODS[m]).concat(key).join('+') });
  });
  hook?.on('keyup', ({ vk }) => held.delete(vk));
  hook?.on('down', () => tap.reset());
  function setKey(key) {
    if (currentKey && currentKey !== DOUBLE_CTRL) globalShortcut.unregister(currentKey);
    currentKey = null;
    if (!key || key === DOUBLE_CTRL) { currentKey = DOUBLE_CTRL; return currentKey; }
    try { if (globalShortcut.register(key, open)) currentKey = key; } catch { /* invalid accelerator */ }
    if (!currentKey) currentKey = DOUBLE_CTRL;   // taken by another app: fall back rather than have no way in
    return currentKey;
  }
  setKey(settings.get().askKey || DOUBLE_CTRL);

  // ---------- IPC from the Ask panel ----------
  ipcMain.on('ask:request', () => open());
  ipcMain.on('ask:query', async (e, { id, text }) => {
    const send = (msg) => { if (!e.sender.isDestroyed()) e.sender.send('ask:event', { id, ...msg }); };
    const res = await engine.ask(text, ctx, send);
    send({ ...res, type: res.type === 'error' ? 'error' : 'done', final: true });
  });
  ipcMain.handle('ask:trash', (_e, { items, allow }) => engine.trash(items, { allow }));
  ipcMain.handle('ask:undo', (_e, batchId) => engine.undo(batchId));
  ipcMain.handle('ask:purge', (_e, batchId) => engine.purge(batchId));
  ipcMain.on('ask:reveal', (_e, file) => shell.showItemInFolder(file));
  ipcMain.on('ask:openFile', (_e, file) => shell.openPath(file));
  ipcMain.handle('ask:setKey', (_e, key) => { const k = setKey(key); if (k) settings.set({ askKey: k }); return { key: k, label: label(k) }; });
  ipcMain.handle('ask:key', () => ({ key: currentKey, label: label(currentKey) }));
  ipcMain.handle('ask:captureKey', () => new Promise((resolve) => {
    const timer = setTimeout(() => done({ cancelled: true }), 10000);
    function done(r) {
      clearTimeout(timer);
      capturing = null;
      if (!r.accel) return resolve({ ...r, key: currentKey, label: label(currentKey) });
      const k = setKey(r.accel);
      settings.set({ askKey: k });
      resolve(k === r.accel ? { key: k, label: label(k) } : { error: `${label(r.accel)} is taken by another app`, key: k, label: label(k) });
    }
    capturing = done;
  }));

  app.on('will-quit', () => globalShortcut.unregisterAll());
  return { open, engine, key: () => label(currentKey) };
}

module.exports = { createAskHost };
