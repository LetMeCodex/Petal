// Petal Island: a dewdrop of liquid glass hanging from the top edge of the screen.
// idle → hover (panel) · file dragged near → drag (drop zone + tendril) → work → done (drip) | error
import { createFlower } from '../theme/glass-flower.js';
import { createGlance } from './widgets.js';
import { createAsk } from './ask.js';

// Same order as the wheel's petals, so the big flower's petal angles mean the same thing.
const PETALS = [
  { id: 'compress', name: 'Compress' }, { id: 'metadata', name: 'Metadata' }, { id: 'ocr', name: 'Copy text' },
  { id: 'edit', name: 'Edit' }, { id: 'annotate', name: 'Annotate' }, { id: 'addbg', name: 'Add background' },
  { id: 'removebg', name: 'Remove background' }, { id: 'crop', name: 'Crop' }, { id: 'redact', name: 'Redact' },
  { id: 'merge', name: 'Merge PDF', multi: true },
];
// Beads read left-to-right in the order people reach for them most; Convert leads.
const BEADS = [{ id: 'convert', name: 'Convert' }, ...['removebg', 'compress', 'ocr', 'crop', 'addbg', 'edit', 'annotate', 'redact', 'merge'].map((id) => PETALS.find((p) => p.id === id))];
const VERB = {
  convert: 'Converting', compress: 'Compressing', metadata: 'Cleaning metadata', ocr: 'Reading text', removebg: 'Removing background', merge: 'Merging into PDF',
};
const PDF_ICON = 'M8 3h11v14H8zM5 7v14h11M11 8h5M11 12h5';

const $ = (id) => document.getElementById(id);
const body = document.body;
const dew = $('dew');
const isl = window.petal.island;
const WIN = 780;

// ---------- state ----------
let state = 'idle';
let doneTimer = 0, hoverTimer = 0, leaveTimer = 0;
function setState(next) {
  if (next === state) return;
  const prev = state;
  state = next;
  body.dataset.state = next;
  isl.state(next);   // the main process only moves the island between monitors while it's idle
  body.classList.toggle('has-drip', next === 'done' && !!dripFile);
  bud.setBloom({ idle: 0.2, hover: 0.6, drag: 1, work: 0.55, done: 1, error: 0.05, ask: 0.8 }[next]);
  if (prev === 'ask' && next !== 'ask') window.petal.ask.closed();
  bud.setSpin(next === 'work' ? 1.6 : 0);
  wakeBud();
  for (let i = 0; i < 6; i++) bud.setDormant(i, next === 'error');
  if (next === 'drag') { bloom.open(); bloom.start(); } else bloom.stop();
  if (next === 'hover') { loadRecent(); isl.wantBackdrop(); requestAnimationFrame(moveInk); }
  if (next !== 'drag') tendril.classList.remove('on');
  syncGlance();
}

// ---------- glass ----------
const bud = createFlower($('bud'), { size: 36, count: 6, base: 4.3, reach: 17, petalWidth: 6.8, domeRadius: 5.8, tint: 0.85, maxFps: 30 });
bud.open();
bud.setBloom(0.2);
// The bud only renders while it is changing shape. Once a resting state has settled its last frame
// stays on the canvas, so idle costs no frames at all (each frame recomposites this whole window).
let budSleep = 0;
function wakeBud() {
  bud.start();
  clearTimeout(budSleep);
  if (['idle', 'hover', 'error', 'ask'].includes(state) && !document.hidden) budSleep = setTimeout(() => bud.stop(), 1500);
}
wakeBud();
// Hidden (tray switch, fullscreen game): stop every animation and the bud until we're back.
document.addEventListener('visibilitychange', () => {
  body.classList.toggle('asleep', document.hidden);
  if (document.hidden) { clearTimeout(budSleep); bud.stop(); } else wakeBud();
});
const bloom = createFlower($('bloom'), { size: 176, count: 10, base: 24, reach: 82, petalWidth: 19, domeRadius: 20, tint: 0.75 });
bloom.stop();

isl.onBackdrop((url) => document.documentElement.style.setProperty('--backdrop', `url(${url})`));
isl.onMoved(() => document.documentElement.style.removeProperty('--backdrop'));

// ---------- click-through: only the drop (and the drip) catch the mouse ----------
const inRect = (r, x, y, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
let interactive = false;
function overGlass(x, y) {
  if (inRect(dew.getBoundingClientRect(), x, y, 4)) return true;
  return body.classList.contains('has-drip') && inRect($('dripGlass').getBoundingClientRect(), x, y, 6);
}
document.addEventListener('mousemove', (e) => {
  if (moving) return;
  const over = overGlass(e.clientX, e.clientY);
  if (over !== interactive) { interactive = over; isl.interactive(over); }
  if (over) {
    clearTimeout(leaveTimer);
    if (state === 'idle') { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => state === 'idle' && setState('hover'), 90); }
    if (state === 'done') clearTimeout(doneTimer);
  } else {
    clearTimeout(hoverTimer);
    if (state === 'hover') { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => state === 'hover' && setState('idle'), 320); }
    if (state === 'done' && !doneTimer) doneTimer = setTimeout(endDone, 2500);
  }
});
document.addEventListener('mouseleave', () => {
  if (interactive) { interactive = false; isl.interactive(false); }
  if (state === 'hover') setState('idle');
});

// ---------- hover panel: tabs with a sliding glass indicator ----------
let tab = 'glance';
const PANES = { glance: 'paneGlance', recent: 'paneRecent', texts: 'paneTexts', settings: 'paneSettings' };
const META = { glance: 'Live · updates every second', recent: 'Drag any of these out', texts: 'Click to copy again', settings: 'Saved as you change it' };
function moveInk() {
  const on = document.querySelector('.tab.on');
  if (!on) return;
  $('tabInk').style.setProperty('--ink-x', `${on.offsetLeft}px`);
  $('tabInk').style.setProperty('--ink-w', `${on.offsetWidth}px`);
}
function showTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  for (const [k, id] of Object.entries(PANES)) $(id).hidden = k !== name;
  $('hoverMeta').textContent = META[name];
  $('hoverMeta').classList.remove('flash');
  moveInk();
  syncGlance();
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

// ---------- live stats: widgets on the Glance tab, and the pulse ring around the idle drop ----------
const glance = createGlance($('paneGlance'));
let prefs = { widgets: {}, islandPulse: true, motion: 'auto' };
let wantedStats = null, pulseOff = 132, pulseAt = -1e9;
function syncGlance() {
  const glanceOn = state === 'hover' && tab === 'glance';
  if (glanceOn) glance.start(); else glance.stop();
  const want = glanceOn ? 2 : state === 'idle' && prefs.islandPulse ? 1 : 0;
  if (want !== wantedStats) { wantedStats = want; isl.wantStats(want); }
  body.classList.toggle('pulse-on', !!prefs.islandPulse);
}
isl.onStats((s) => {
  glance.update(s);
  // 132 = ring circumference; the idle ring fills with CPU load.
  // Every nudge of the ring repaints this whole transparent window for as long as it eases, so the
  // idle ring moves only for a visible change and at most every 3 s (about 5 frames a second at worst).
  if (state !== 'idle' || document.hidden) return;
  const off = Math.round(132 * (1 - Math.max(0, Math.min(100, s.cpu)) / 100));
  const now = performance.now();
  if (Math.abs(off - pulseOff) >= 4 && now - pulseAt > 3000) { pulseOff = off; pulseAt = now; $('pulseArc').style.strokeDashoffset = String(off); }
});

// ---------- preferences: the inline Settings tab ----------
const WIDGETS = [['cpu', 'CPU'], ['gpu', 'GPU'], ['ram', 'RAM'], ['net', 'Network'], ['battery', 'Battery'], ['clock', 'Clock']];
const chipsEl = $('widgetChips');
for (const [id, name] of WIDGETS) {
  const b = document.createElement('button');
  b.className = 'wchip';
  b.dataset.w = id;
  b.textContent = name;
  b.addEventListener('click', () => {
    prefs.widgets = { ...prefs.widgets, [id]: !(prefs.widgets[id] !== false) };
    isl.setPrefs({ widgets: prefs.widgets });
    applyPrefs();
  });
  chipsEl.append(b);
}
for (const sw of document.querySelectorAll('.sw')) {
  sw.addEventListener('click', (e) => {
    e.preventDefault();
    const key = sw.dataset.pref;
    const next = !(prefs[key] !== false);
    prefs[key] = next;
    applyPrefs();
    // Hiding the island hides this switch too, so say where it lives before going.
    if (key === 'island' && !next) {
      $('hoverMeta').textContent = 'Bring it back from the tray icon';
      $('hoverMeta').classList.add('flash');
      setTimeout(() => { if (prefs.island === false) isl.setPrefs({ island: false }); }, 1600);
      return;
    }
    isl.setPrefs({ [key]: next });
  });
}
for (const b of document.querySelectorAll('#motionSeg button')) {
  b.addEventListener('click', () => { prefs.motion = b.dataset.motion; isl.setPrefs({ motion: prefs.motion }); applyPrefs(); });
}
$('resetPos').addEventListener('click', () => isl.resetPosition());
$('triggerBtn').addEventListener('click', () => isl.settings());

// Ask shortcut: Ctrl Ctrl, or a combo recorded from the keys you press next.
function showAskKey({ key, label, error }) {
  for (const b of document.querySelectorAll('#askKeySeg button')) b.classList.toggle('on', key === 'DoubleCtrl' ? b.dataset.key === 'DoubleCtrl' : b.dataset.key === 'custom');
  $('askKeyCustom').textContent = key && key !== 'DoubleCtrl' ? label : 'Custom';
  $('askKeyNote').textContent = error || '';
  $('askPillKey').textContent = label;
  $('askKey').textContent = label;
}
window.petal.ask.key().then(showAskKey).catch(() => { /* no Ask host (scripted renders) */ });
for (const b of document.querySelectorAll('#askKeySeg button')) {
  b.addEventListener('click', async () => {
    if (b.dataset.key === 'DoubleCtrl') return showAskKey(await window.petal.ask.setKey('DoubleCtrl'));
    b.textContent = 'Press keys…';
    $('askKeyNote').textContent = 'Hold Ctrl or Alt and press a key · Esc cancels';
    showAskKey(await window.petal.ask.captureKey());
  });
}

function applyPrefs() {
  for (const sw of document.querySelectorAll('.sw')) sw.setAttribute('aria-checked', String(prefs[sw.dataset.pref] !== false));
  for (const b of chipsEl.children) b.classList.toggle('on', prefs.widgets?.[b.dataset.w] !== false);
  for (const b of document.querySelectorAll('#motionSeg button')) b.classList.toggle('on', b.dataset.motion === prefs.motion);
  body.classList.toggle('calm', prefs.motion === 'calm' || (prefs.motion === 'auto' && autoCalm));
  if (prefs.trigger) $('triggerBtn').textContent = `Trigger · ${prefs.trigger}`;
  glance.setEnabled(prefs.widgets || {});
  syncGlance();
}
// ---------- Motion "auto": calm on weak machines, or once animation frames run slow ----------
// Measured from the 3D flowers' own frames (they only run while something is moving), so the check
// itself never asks for extra frames. Slow = the median frame took over 25 ms (under ~40 fps).
let autoCalm = (navigator.hardwareConcurrency || 8) <= 4;
// Each flower is measured against its own frame-rate cap (the bud draws at 30 fps on purpose):
// slow means frames arriving at least 1.6x later than planned.
const frameRatios = [];
function sampler(fps) {
  let lastAt = 0;
  return () => {
    const now = performance.now();
    const dt = now - lastAt;
    lastAt = now;
    if (dt > 400) return;                // just woke up; not a frame interval
    frameRatios.push(dt / (1000 / fps));
    if (frameRatios.length < 40) return;
    const median = frameRatios.sort((a, b) => a - b)[20];
    frameRatios.length = 0;
    if (median > 1.6 && !autoCalm) { autoCalm = true; applyPrefs(); }
  };
}
bud.onFrame(sampler(30));
bloom.onFrame(sampler(60));
// A slow spell (a game, an export) passes; give full motion another chance every few minutes.
setInterval(() => { if (autoCalm && (navigator.hardwareConcurrency || 8) > 4) { autoCalm = false; applyPrefs(); } }, 5 * 60 * 1000);

isl.prefs().then((p) => { prefs = { ...prefs, ...p }; applyPrefs(); });
isl.onPrefsChanged((patch) => { prefs = { ...prefs, ...patch }; applyPrefs(); });

// ---------- layout from the main process: top edge or floating, growing down or up ----------
isl.onLayout((l) => {
  body.style.setProperty('--dx', `${l.dx}px`);
  body.style.setProperty('--dy', `${l.dy}px`);
  body.style.setProperty('--dby', `${l.dby}px`);
  body.classList.toggle('float', l.mode === 'float');
  body.classList.toggle('up', !!l.up);
});
isl.onNearTop((near) => body.classList.toggle('near-top', near));

// ---------- drag the island itself: grab the drop and put it anywhere ----------
// It stretches with your speed while it moves, previews clinging when near the top edge,
// and wobbles as it settles. Press anywhere on it (tabs, tiles and switches included): a press that
// doesn't travel stays a normal click, one that travels 5px becomes a move and its click is dropped.
// Only the recent-file cards are left out, since dragging those drags the file out instead.
let moving = false, press = null, grab = { x: 0, y: 0 }, lastMove = null, moveRaf = 0, pendingPt = null, swallowClick = false;
dew.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !(state === 'idle' || state === 'hover')) return;
  if (e.target.closest('[draggable="true"], .card')) return;
  press = { x: e.screenX, y: e.screenY, id: e.pointerId };
});
// The drop centres itself under the cursor (a wide panel collapsing to a small drop would
// otherwise leave it far from where you grabbed).
dew.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
dew.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!moving) {
    if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < 5) return;
    moving = true;
    swallowClick = true;
    dew.setPointerCapture(press.id);
    setState('idle');
    body.classList.add('moving');
  }
  const now = performance.now();
  if (lastMove) {
    const dt = Math.max(8, now - lastMove.t);
    const vx = (e.screenX - lastMove.x) / dt, vy = (e.screenY - lastMove.y) / dt;
    const k = Math.min(0.22, Math.hypot(vx, vy) * 0.12);       // jelly: stretch along the motion
    const horiz = Math.abs(vx) >= Math.abs(vy);
    body.style.setProperty('--sx', (horiz ? 1 + k : 1 - k * 0.6).toFixed(3));
    body.style.setProperty('--sy', (horiz ? 1 - k * 0.6 : 1 + k).toFixed(3));
  }
  lastMove = { x: e.screenX, y: e.screenY, t: now };
  pendingPt = { x: e.screenX - grab.x, y: e.screenY - grab.y };
  if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = 0; if (pendingPt) isl.moveTo(pendingPt); });
});
function endMove(e) {
  if (!press) return;
  const wasMoving = moving;
  press = null;
  if (!wasMoving) return;
  moving = false;
  lastMove = null;
  // A move queued for the next frame would reach the main process after moveEnd and float the
  // island again after it had snapped to the edge.
  cancelAnimationFrame(moveRaf);
  moveRaf = 0;
  pendingPt = null;
  body.classList.remove('moving');
  body.style.setProperty('--sx', '1');
  body.style.setProperty('--sy', '1');
  body.classList.remove('settle');
  void body.offsetWidth;
  body.classList.add('settle');
  setTimeout(() => body.classList.remove('settle'), 700);
  setTimeout(() => { swallowClick = false; }, 0);   // the click (if any) fires right after pointerup
  isl.moveEnd({ x: e.screenX - grab.x, y: e.screenY - grab.y });
}
dew.addEventListener('pointerup', endMove);
dew.addEventListener('pointercancel', endMove);
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
const ACTION_LABEL = { convert: 'Convert', compress: 'Compress', metadata: 'Clean', ocr: 'Text', removebg: 'Remove BG', merge: 'Merge', crop: 'Crop', addbg: 'Add BG', edit: 'Edit', annotate: 'Annotate', redact: 'Redact' };
function thumbHtml(f) {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(f.ext)
    ? `<img src="${f.url}" alt="">`
    : `<svg viewBox="0 0 24 24"><path d="${PDF_ICON}"/></svg>`;
}
async function loadRecent() {
  const { files, texts } = await isl.recent();
  const pr = $('paneRecent');
  pr.innerHTML = files.length ? '' : '<div class="empty">Nothing yet. Drag a file up here to start.</div>';
  for (const f of files.slice(0, 3)) {
    const c = document.createElement('div');
    c.className = 'card';
    c.draggable = true;
    c.title = 'Click to open, drag into any app';
    c.innerHTML = `<div class="thumb">${thumbHtml(f)}</div><b></b><span class="mono">${ACTION_LABEL[f.action] || f.action} · ${ago(f.at)}</span>`;
    c.querySelector('b').textContent = f.name;
    c.addEventListener('click', () => isl.open(f.file));
    c.addEventListener('dragstart', (e) => { e.preventDefault(); isl.startDrag(f.file); });
    pr.append(c);
  }
  const pt = $('paneTexts');
  pt.innerHTML = texts.length ? '' : '<div class="empty">Copy text from a picture and it shows up here.</div>';
  for (const t of texts.slice(0, 3)) {
    const c = document.createElement('div');
    c.className = 'text-card';
    c.textContent = t.text.replace(/\s+/g, ' ');
    c.title = 'Click to copy again';
    c.addEventListener('click', () => { isl.copy(t.text); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 500); });
    pt.append(c);
  }
  META.recent = files.length ? 'Drag any of these out' : 'Drag a file up here';
  if (tab === 'recent') $('hoverMeta').textContent = META.recent;
}

// ---------- drag: drop zone, beads, and a tendril reaching for the file ----------
const beadsEl = $('beads');
const beadEls = BEADS.map((b) => {
  const s = document.createElement('span');
  s.className = 'bead';
  s.dataset.action = b.id;
  s.textContent = b.name;
  beadsEl.append(s);
  return s;
});
const tendril = $('tendril');
let fileCount = 0, hot = null;

isl.onDrag((on) => {
  if (on) { if (state !== 'work') setState('drag'); }
  else if (state === 'drag') setState('idle');
});
isl.onCursor(({ x, y }) => drawTendril(x, y));

function drawTendril(cx, cy) {
  if (state !== 'drag') return;
  const r = dew.getBoundingClientRect();
  if (cy < r.bottom + 10) { tendril.classList.remove('on'); return; }   // the file is over the drop itself
  tendril.classList.add('on');
  const x0 = Math.max(r.left + 40, Math.min(r.right - 40, cx)), y0 = r.bottom - 6;
  const x1 = cx, y1 = cy - 20;
  const pts = [], N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // A quadratic that drops straight down first, then bends toward the cursor.
    const qx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x0 + t * t * x1;
    const qy = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * (y0 + (y1 - y0) * 0.75) + t * t * y1;
    const dx = 2 * (1 - t) * 0 + 2 * t * (x1 - x0), dy = 2 * (1 - t) * (y0 + (y1 - y0) * 0.75 - y0) + 2 * t * (y1 - (y0 + (y1 - y0) * 0.75));
    const len = Math.hypot(dx, dy) || 1;
    const w = 13 * (1 - t) ** 0.8 + 4 + 9 * Math.exp(-(((1 - t) / 0.13) ** 2));   // thick at the root, a bead at the tip
    pts.push({ x: qx, y: qy, nx: -dy / len, ny: dx / len, w });
  }
  const left = pts.map((p) => `${(p.x + p.nx * p.w).toFixed(1)} ${(p.y + p.ny * p.w).toFixed(1)}`);
  const right = pts.map((p) => `${(p.x - p.nx * p.w).toFixed(1)} ${(p.y - p.ny * p.w).toFixed(1)}`).reverse();
  $('tendrilPath').setAttribute('d', `M${left.join('L')}Q${x1} ${y1 + 16} ${right[0]}L${right.join('L')}Z`);
}

function setHot(id) {
  if (id === hot) return;
  hot = id;
  beadEls.forEach((b) => b.classList.toggle('hot', b.dataset.action === id && !b.classList.contains('off')));
  const idx = PETALS.findIndex((p) => p.id === id);
  bloom.setHot(idx >= 0 ? idx : id === 'convert' ? 'dome' : null);
  $('dropTitle').textContent = id ? (BEADS.find((b) => b.id === id)?.name || 'Let go on a petal') : 'Let go on a petal';
}

// Which action is under the pointer: a bead, or a petal of the big flower (by angle, like the wheel).
function actionAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.bead');
  if (el && !el.classList.contains('off')) return el.dataset.action;
  const r = $('bloom').getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(x - cx, y - cy);
  if (d < 24) return 'convert';
  if (d > r.width / 2) return null;
  const step = 360 / PETALS.length;
  const deg = (Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90 + 360 + step / 2) % 360;
  const p = PETALS[Math.floor(deg / step)];
  return p.multi && fileCount < 2 ? null : p.id;
}

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  fileCount = [...e.dataTransfer.items].filter((i) => i.kind === 'file').length;
  beadEls.forEach((b) => b.classList.toggle('off', b.dataset.action === 'merge' && fileCount < 2));
  PETALS.forEach((p, i) => bloom.setDormant(i, !!p.multi && fileCount < 2));
  $('dropFile').textContent = fileCount > 1 ? `${fileCount} files` : '';
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy'; // never "move": Explorer would delete the source after the drop
  if (state !== 'drag') return;
  const r = $('bloom').getBoundingClientRect();
  bloom.setPointer(e.clientX - r.left, e.clientY - r.top);
  setHot(actionAt(e.clientX, e.clientY));
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const action = actionAt(e.clientX, e.clientY);
  const paths = [...e.dataTransfer.files].map((f) => window.petal.pathFor(f)).filter(Boolean);
  setHot(null);
  if (!action || !paths.length || state !== 'drag') { setState('idle'); return; }
  isl.dropped();
  const name = paths.length > 1 ? `${paths.length} files` : paths[0].split(/[\\/]/).pop();
  startWork(VERB[action] || 'Opening editor', name);
  const res = await window.petal.run(action, paths);
  finish(action, res);
});

// ---------- work: blush liquid rising ----------
let progress = 0, target = 0, waveT = 0, waveRaf = 0;
function startWork(title, sub) {
  $('workTitle').textContent = title;
  $('workSub').textContent = sub;
  progress = 0; target = 0.08;
  setState('work');
  if (!waveRaf) waveRaf = requestAnimationFrame(wave);
}
let waveAt = 0;
function wave(now = performance.now()) {
  if (now - waveAt < 32) { waveRaf = state === 'work' ? requestAnimationFrame(wave) : 0; return; }   // 30 fps on any screen
  waveAt = now;
  progress += (target - progress) * 0.08;
  waveT += 0.08;
  const h = 52, level = h - progress * h;
  let d = `M0 ${level.toFixed(1)}`;
  for (let x = 0; x <= 340; x += 20) d += `L${x} ${(level + Math.sin(x / 40 + waveT) * 3).toFixed(1)}`;
  $('risePath').setAttribute('d', `${d}L340 ${h}L0 ${h}Z`);
  waveRaf = state === 'work' ? requestAnimationFrame(wave) : 0;
}
window.petal.onProgress((p) => {
  if (state !== 'work') return;
  if (p.download !== undefined) { $('workSub').textContent = `Getting the AI model · ${Math.round(p.download * 100)}%`; target = p.download; return; }
  target = Math.max(target, p.done / (p.total || 1));
  $('workSub').textContent = `${p.done} of ${p.total} done`;
});

// ---------- done (drip) / error ----------
let dripFile = null;
function showDone(title, sub, file) {
  dripFile = file || null;
  $('doneTitle').textContent = title;
  $('doneSub').textContent = sub;
  $('doneActs').hidden = !file;
  if (file) {
    const ext = file.split('.').pop().toLowerCase();
    $('dripThumb').innerHTML = thumbHtml({ ext, url: encodeURI(`file:///${file.replace(/\\/g, '/')}`) });
  }
  state = '';            // force setState to re-run its side effects
  setState('done');
  clearTimeout(doneTimer);
  doneTimer = setTimeout(endDone, 7000);
}
function endDone() {
  doneTimer = 0;
  if (state !== 'done') return;
  body.classList.remove('has-drip');
  setTimeout(() => state === 'done' && setState('idle'), 300);
}
function showError(title, sub) {
  $('errTitle').textContent = title;
  $('errSub').textContent = sub;
  setState('error');
  setTimeout(() => state === 'error' && setState('idle'), 4200);
}

function finish(action, res) {
  if (res.opened) return setState('idle');
  if (res.error) return showError("Couldn't finish", res.error);
  if (res.copied) return showDone(`Copied ${res.copied.words} words`, res.copied.preview || 'On your clipboard', null);
  const saved = res.results.flatMap((r) => r.saved || []);
  const skipped = res.results.filter((r) => r.skipped);
  if (!saved.length) return showError('Nothing saved', skipped[0]?.skipped || 'Unsupported file');
  const name = saved[0].split(/[\\/]/).pop();
  const note = res.results.find((r) => r.note)?.note;
  showDone(saved.length > 1 ? `${saved.length} files ready` : `${name} is ready`, note || (saved.length > 1 ? 'Next to the originals' : 'Drag it anywhere'), saved[0]);
}

// Results made with the wheel drip from here too, so there's always one place to grab them.
isl.onExternal(({ action, res }) => {
  if (state === 'idle' || state === 'hover') finish(action, res);
});

$('openBtn').addEventListener('click', () => dripFile && isl.open(dripFile));
$('folderBtn').addEventListener('click', () => dripFile && isl.reveal(dripFile));
$('dripGlass').addEventListener('dragstart', (e) => {
  e.preventDefault();
  if (dripFile) isl.startDrag(dripFile);
});

// ---------- Ask ----------
const askUi = createAsk({
  setState, startWork, finish, getState: () => state,
  gulp: () => { body.classList.remove('gulp'); void body.offsetWidth; body.classList.add('gulp'); wakeBud(); setTimeout(() => body.classList.remove('gulp'), 600); },
});
$('askPill').addEventListener('click', () => window.petal.ask.request());

// Handle for the scripted state renders (scripts/island-test.js).
window.__island = { ask: askUi, setState, showDone, showError, startWork, setHot, drawTendril, finish, showTab, get state() { return state; }, get prefs() { return prefs; }, get wantedStats() { return wantedStats; } };
