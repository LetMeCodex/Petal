// Petal Island, main-process side: a dewdrop window. It clings to the top edge of a screen ('top'),
// or floats wherever you dragged it ('float'). It is click-through except where the drop actually is,
// wakes into a drop zone when a file is dragged near it (no trigger key needed), lives on whichever
// monitor you're using, steps aside while something is fullscreen there, and feeds live system
// stats to its widgets only while they're on screen.
const path = require('path');
const { BrowserWindow, ipcMain, screen, nativeImage, shell, clipboard } = require('electron');

const W = 780;
const H = 600;               // tall enough for the Ask panel's results
const DEW = 56;             // idle drop height
const MAGNET_X = 300;       // half-width of the wake-up zone around the drop
const MAGNET_REACH = 230;   // how far past the drop a dragged file still wakes it
const SNAP = 40;            // let go this close to the top edge and the drop clings to it
const FOLLOW_MS = 450;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- placement (pure, so it can be tested without real monitors) ----------
// Returns the window bounds plus where the drop sits inside the window:
//   dx: drop centre x, dy: drop top (growing down), dby: drop bottom distance from the window bottom (growing up).
function computeLayout(display, pos) {
  if (pos.mode !== 'float') {
    const b = display.bounds;
    const cx = b.x + clamp(pos.fx, 0, 1) * b.width;
    const x = Math.round(clamp(cx - W / 2, b.x, b.x + b.width - W));
    return { bounds: { x, y: b.y, width: W, height: H }, layout: { mode: 'top', dx: Math.round(cx - x), dy: 0, dby: 0, up: false } };
  }
  const a = display.workArea;
  const cx = a.x + clamp(pos.fx, 0, 1) * a.width;
  const cy = a.y + clamp(pos.fy, 0, 1) * a.height;
  const x = Math.round(clamp(cx - W / 2, a.x, a.x + a.width - W));
  const dewTop = cy - DEW / 2;
  if (dewTop + 380 <= a.y + a.height) {                      // room below: panels grow downward (Ask caps itself to the space left)
    const y = Math.round(clamp(dewTop - 24, a.y, a.y + a.height - H));
    return { bounds: { x, y, width: W, height: H }, layout: { mode: 'float', dx: Math.round(cx - x), dy: Math.round(Math.max(8, dewTop - y)), dby: 0, up: false } };
  }
  const y = Math.round(a.y + a.height - H);                  // near the bottom: grow upward, keep room for the drip
  const dewBottom = Math.min(cy + DEW / 2, a.y + a.height - 150);
  return { bounds: { x, y, width: W, height: H }, layout: { mode: 'float', dx: Math.round(cx - x), dy: 0, dby: Math.round(y + H - dewBottom), up: true } };
}

// Where the drop is on screen (DIP), from a window's bounds and its layout.
function dropRect(bounds, layout) {
  const cx = bounds.x + layout.dx;
  const top = layout.up ? bounds.y + H - layout.dby - DEW : bounds.y + layout.dy;
  return { cx, top, bottom: top + DEW };
}

const contains = (r, p) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
// A fullscreen rect (DIP) covers this display when their centres coincide; monitors don't overlap.
const coversDisplay = (rect, display) => !!rect && contains(display.bounds, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const islandBounds = (display) => computeLayout(display, { mode: 'top', fx: 0.5, fy: 0 }).bounds;

function createIsland({ recent, cropBackdrop, captureBackdrop, openSettings, settings, hook, onPrefsChanged }) {
  let display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const prefs = () => settings?.get() || { islandPos: { mode: 'top', fx: 0.5, fy: 0 } };
  let placed = computeLayout(display, prefs().islandPos);
  const win = new BrowserWindow({
    ...placed.bounds,
    show: false, frame: false, transparent: true, resizable: false, movable: false, title: 'Petal island',
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.loadFile(path.join(__dirname, 'island', 'island.html'));

  const send = (ch, ...args) => { if (!win.isDestroyed()) win.webContents.send(ch, ...args); };
  const sendBackdrop = () => { const url = cropBackdrop(win.getBounds()); if (url) send('island:backdrop', url); };
  function place(d, pos, { quiet = false } = {}) {
    display = d;
    placed = computeLayout(d, pos);
    win.setBounds(placed.bounds);
    send('island:layout', placed.layout);
    if (!quiet) send('island:moved');   // its frosted snapshot belonged to the old spot
  }
  win.webContents.on('did-finish-load', () => send('island:layout', placed.layout));

  // ---------- visibility: the user's switch, and fullscreen on this monitor ----------
  let userVisible = settings ? settings.get().island !== false : true;
  let askOpen = false;
  let fullscreenRect = null;
  let ready = false;
  function applyVisibility() {
    if (!ready || win.isDestroyed()) return;
    // Ask (from its shortcut) shows the island even when it's switched off or a game is fullscreen.
    const show = askOpen || (userVisible && !coversDisplay(fullscreenRect, display));
    if (show && !win.isVisible()) win.showInactive();
    else if (!show && win.isVisible()) win.hide();
    updateStats();
  }
  win.once('ready-to-show', () => { ready = true; applyVisibility(); });

  // ---------- which monitor: follow the cursor while the island is idle ----------
  let rendererState = 'idle';
  const busy = () => rendererState !== 'idle' || moving;
  function moveToDisplay(d) {
    if (d.id === display.id) return;
    place(d, prefs().islandPos);
    applyVisibility();
  }
  const follow = setInterval(() => {
    if (busy() || magnet) return;
    moveToDisplay(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
  }, FOLLOW_MS);
  const replace = () => { display = { id: null }; moveToDisplay(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())); };
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  win.on('closed', () => clearInterval(follow));

  // Click-through everywhere except the drop itself; mouse moves are still forwarded so the page can tell.
  let interactive = true;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    win.setIgnoreMouseEvents(!on, { forward: true });
  };
  setInteractive(false);

  // ---------- drag the island itself somewhere else ----------
  let moving = false;
  ipcMain.on('island:moveTo', (_e, { x, y }) => {
    // x, y: where the drop's centre should be, in screen DIP.
    moving = true;
    setInteractive(true);
    const d = screen.getDisplayNearestPoint({ x, y });
    const nearTop = y - DEW / 2 - d.bounds.y < SNAP;
    const a = d.workArea;
    place(d, { mode: 'float', fx: (x - a.x) / a.width, fy: (y - a.y) / a.height }, { quiet: true });
    send('island:nearTop', nearTop);
  });
  ipcMain.on('island:moveEnd', (_e, { x, y }) => {
    moving = false;
    const d = screen.getDisplayNearestPoint({ x, y });
    const nearTop = y - DEW / 2 - d.bounds.y < SNAP;
    const pos = nearTop
      ? { mode: 'top', fx: (x - d.bounds.x) / d.bounds.width, fy: 0 }
      : { mode: 'float', fx: (x - d.workArea.x) / d.workArea.width, fy: (y - d.workArea.y) / d.workArea.height };
    settings?.set({ islandPos: pos });
    place(d, pos);
    send('island:nearTop', false);
    Promise.resolve(captureBackdrop(true)).then(sendBackdrop);
  });

  // ---------- magnet zone: a file dragged near the drop wakes the drop zone ----------
  let magnet = false, dropped = false, lastCursorAt = 0;
  function dragMove(e) {
    if (moving) return;
    const p = screen.screenToDipPoint({ x: e.x, y: e.y });
    // Dragging on another monitor: the island hops over (unless it's mid-task) so you can drop there.
    if (!magnet && !busy()) moveToDisplay(screen.getDisplayNearestPoint(p));
    if (!win.isVisible()) return;
    const b = win.getBounds();
    const drop = dropRect(b, placed.layout);
    const inX = Math.abs(p.x - drop.cx) < MAGNET_X;
    const inY = placed.layout.up
      ? p.y > drop.top - MAGNET_REACH && p.y < drop.bottom + 60
      : p.y > drop.top - 60 && p.y < drop.bottom + MAGNET_REACH;
    const inside = inX && inY && contains(b, p);
    if (inside !== magnet) {
      magnet = inside;
      dropped = false;
      setInteractive(inside);       // must accept the OLE drop, so stop being click-through
      send('island:drag', inside);
      if (inside) Promise.resolve(captureBackdrop()).then(sendBackdrop);
    }
    const now = Date.now();
    if (magnet && now - lastCursorAt > 14) { lastCursorAt = now; send('island:cursor', { x: p.x - b.x, y: p.y - b.y }); }
  }
  function dragEnd() {
    if (!magnet) return;
    // The drop event and the mouse-up race; give the drop a moment to land before standing down.
    setTimeout(() => {
      if (dropped || !magnet) return;
      magnet = false;
      setInteractive(false);
      send('island:drag', false);
    }, 400);
  }

  // ---------- live stats: sampled by the hook helper only while widgets are visible ----------
  let statsWanted = 0;    // 0 off, 1 idle pulse (CPU only), 2 Glance tab (everything)
  function updateStats() { hook?.setStats(win.isVisible() ? statsWanted : 0); }
  hook?.on('stats', (s) => send('island:stats', s));
  ipcMain.on('island:wantStats', (_e, level) => { statsWanted = +level || 0; updateStats(); });

  // ---------- preferences, changed from the island's own Settings tab ----------
  ipcMain.handle('island:prefs', () => {
    const s = prefs();
    return { island: s.island !== false, widgets: s.widgets, islandPulse: s.islandPulse, motion: s.motion, islandPos: s.islandPos, trigger: s.trigger?.label };
  });
  ipcMain.on('island:setPrefs', (_e, patch) => {
    settings?.set(patch);
    if ('island' in patch) { userVisible = patch.island; applyVisibility(); }
    send('island:prefsChanged', patch);
    onPrefsChanged?.(patch);
  });
  ipcMain.on('island:resetPosition', () => {
    const pos = { mode: 'top', fx: 0.5, fy: 0 };
    settings?.set({ islandPos: pos });
    place(display, pos);
  });

  ipcMain.on('island:state', (_e, s) => { rendererState = s; });
  ipcMain.on('island:dropped', () => { dropped = true; magnet = false; });
  ipcMain.on('island:interactive', (_e, on) => { if (!magnet && !moving) setInteractive(on); });
  ipcMain.on('island:wantBackdrop', () => Promise.resolve(captureBackdrop(true)).then(sendBackdrop));
  ipcMain.handle('island:recent', () => recent.list());
  ipcMain.on('island:open', (_e, file) => shell.openPath(file));
  ipcMain.on('island:reveal', (_e, file) => shell.showItemInFolder(file));
  ipcMain.on('island:copy', (_e, text) => clipboard.writeText(text));
  ipcMain.on('island:settings', () => openSettings());
  // Drag a result out of the island straight into any app.
  ipcMain.on('island:startDrag', (e, file) => {
    let icon = nativeImage.createFromPath(file);
    icon = icon.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')) : icon;
    e.sender.startDrag({ file, icon: icon.resize({ width: 96 }) });
  });

  // ---------- Ask: the one time the island takes the keyboard ----------
  // Normally it never steals focus from the app you're in; while Ask is open you're typing into it.
  function openAsk(payload) {
    askOpen = true;
    rendererState = 'ask';
    if (!win.isVisible()) win.showInactive();
    setInteractive(true);
    win.setFocusable(true);
    win.focus();
    win.webContents.focus();
    // Opened from a key pressed in another app: Windows may refuse a plain focus(), the hook helper won't.
    hook?.focus(win.getNativeWindowHandle().readBigUInt64LE(0).toString());
    send('ask:open', payload);
  }
  function closeAsk() { send('ask:close'); }
  ipcMain.on('ask:closed', () => {
    if (!askOpen) return;
    askOpen = false;
    win.setFocusable(false);
    applyVisibility();
  });
  win.on('blur', () => { if (askOpen) send('ask:blur'); });

  return {
    win,
    openAsk,
    closeAsk,
    askIsOpen: () => askOpen,
    fullscreenHere: () => coversDisplay(fullscreenRect, display),
    dragMove,
    dragEnd,
    // A result produced elsewhere (the wheel) still drips from the island, so it can be dragged out.
    notifyExternal: (action, res) => send('island:external', { action, res }),
    setVisible: (on) => { userVisible = on; applyVisibility(); send('island:prefsChanged', { island: on }); },
    // `physRect` comes from the hook helper in physical pixels; null when nothing is fullscreen.
    setFullscreen: (physRect) => {
      fullscreenRect = physRect ? screen.screenToDipRect(null, physRect) : null;
      applyVisibility();
    },
  };
}

module.exports = { createIsland, computeLayout, dropRect, islandBounds, coversDisplay };
