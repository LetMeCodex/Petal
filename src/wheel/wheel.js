// Petal: the drop target. A 3D glass flower blooms around the cursor; drop a file on a petal to run it.
import { createFlower } from '../theme/glass-flower.js';

const SIZE = 440;
const C = SIZE / 2;
const R_DOME = 60;     // drop here for Convert
const R_REACH = 200;   // beyond this, not a target

// Clockwise from the top. `multi` petals only wake up when several files are being dragged.
const PETALS = [
  { id: 'compress', name: 'Compress', verb: 'Compressing', hint: 'Smaller file', icon: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' },
  { id: 'metadata', name: 'Metadata', verb: 'Cleaning metadata', hint: 'Strip EXIF + GPS', icon: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01' },
  { id: 'ocr', name: 'Copy text', verb: 'Reading text', hint: 'Text to clipboard', icon: 'M9 9h11v12H9zM5 15H4V3h11v2M12 13h5M12 17h5' },
  { id: 'edit', name: 'Edit', verb: 'Editing', hint: 'Rotate · light · size', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { id: 'annotate', name: 'Annotate', verb: 'Annotating', hint: 'Draw + label', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
  { id: 'addbg', name: 'Add background', verb: 'Adding background', hint: 'Frame it', icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01' },
  { id: 'removebg', name: 'Remove background', verb: 'Removing background', hint: 'On-device AI', icon: 'M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1 1M18 9l-1-1M3 21l11-11' },
  { id: 'crop', name: 'Crop', verb: 'Cropping', hint: 'Trim + ratio', icon: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2' },
  { id: 'redact', name: 'Redact', verb: 'Redacting', hint: 'Hide secrets', icon: 'M17.9 17.9A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22' },
  { id: 'merge', name: 'Merge to PDF', verb: 'Merging into PDF', hint: 'One tidy PDF', multi: true, icon: 'M8 3h11v14H8zM5 7v14h11M11 8h5M11 12h5' },
];
const CONVERT_ICON = 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3';

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'image/tiff': 'tiff', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
};
const DEFAULT_TARGET = { png: 'jpg', jpg: 'png', webp: 'png', gif: 'png', avif: 'jpg', tiff: 'jpg', svg: 'png', pdf: 'jpg' };

const STEP = 360 / PETALS.length;
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;
const dome = $('dome');
const toast = $('toast');

// ---------- the flower ----------
const flower = createFlower($('gl'), { size: SIZE, count: PETALS.length, base: 64, reach: 196, petalWidth: 42, domeRadius: 56, tint: 0.65 });
const icons = PETALS.map((p) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = `<path d="${p.icon}"/>`;
  $('icons').append(svg);
  return svg;
});
// Icons ride on the 3D petals: re-projected every frame so they lift, tilt and fade with the glass.
flower.onFrame(() => {
  flower.anchors().forEach((a, i) => {
    const s = icons[i].style;
    s.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) scale(${(a.scale * (1 + a.hot * 0.14)).toFixed(3)})`;
    s.opacity = (a.opacity * (a.dormant ? 0.45 : 0.9 + a.hot * 0.1)).toFixed(3);
    icons[i].classList.toggle('hot', a.hot > 0.5);
  });
});

// ---------- dome label: says what a drop will do ----------
let convertTarget = '';
let domeKey = '';
let fileCount = 0;
function setDome(zone) {
  const p = PETALS.find((x) => x.id === zone);
  const key = zone || 'convert';
  if (key === domeKey) return;
  domeKey = key;
  const face = dome.querySelector('.dome-face');
  face.classList.remove('swap');
  void face.offsetWidth;
  face.classList.add('swap');
  if (p) {
    $('domeIcon').setAttribute('d', p.icon);
    $('domeTitle').textContent = p.name;
    $('domeSub').textContent = p.multi && fileCount < 2 ? 'Needs 2+ files' : p.hint;
  } else {
    $('domeIcon').setAttribute('d', CONVERT_ICON);
    $('domeTitle').textContent = 'Convert';
    $('domeSub').textContent = convertTarget ? `To ${convertTarget}` : 'Pick a format';
  }
}

// ---------- hit testing ----------
function zoneAt(x, y) {
  const dx = x - C, dy = y - C;
  const r = Math.hypot(dx, dy);
  if (r <= R_DOME) return 'convert';
  if (r > R_REACH) return null;
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360 + STEP / 2) % 360;
  return PETALS[Math.floor(deg / STEP)].id;
}

let hot = null;
let dormant = new Set();
function setHot(zone) {
  if (zone === hot) return;
  hot = zone;
  const idx = PETALS.findIndex((p) => p.id === zone);
  flower.setHot(zone === 'convert' ? 'dome' : idx >= 0 ? idx : null);
  setDome(zone === 'convert' ? null : zone);
  if (idx >= 0 && !dormant.has(idx)) twinkleAt(idx, 2);
}

// ---------- what's being dragged ----------
function describeDrag(dt) {
  const exts = [...(dt?.items || [])].filter((it) => it.kind === 'file').map((it) => MIME_EXT[it.type]);
  fileCount = exts.length;
  const targets = new Set(exts.map((e) => DEFAULT_TARGET[e]));
  convertTarget = targets.size === 1 && !targets.has(undefined) ? [...targets][0].toUpperCase() : '';
  dormant = new Set(PETALS.map((p, i) => (p.multi && fileCount < 2 ? i : -1)).filter((i) => i >= 0));
  PETALS.forEach((_, i) => flower.setDormant(i, dormant.has(i)));
  domeKey = '';
  setDome(hot === 'convert' || !hot ? null : hot);
}

// ---------- glass backdrop: a blurred snapshot of the screen behind the wheel ----------
const backdropCanvas = document.createElement('canvas');
backdropCanvas.width = backdropCanvas.height = SIZE;
window.petal.onBackdrop((url) => {
  const img = new Image();
  img.onload = () => {
    const ctx = backdropCanvas.getContext('2d');
    ctx.filter = 'blur(6px)';
    ctx.drawImage(img, -12, -12, SIZE + 24, SIZE + 24); // overscan hides the blur's soft border
    flower.setBackdrop(backdropCanvas);
    root.style.setProperty('--backdrop', `url(${backdropCanvas.toDataURL('image/jpeg', 0.85)})`); // for the toast pill
  };
  img.src = url;
});

// ---------- glints: tiny four-point stars, and a ring of light on success ----------
const glintCanvas = $('glints');
const gctx = glintCanvas.getContext('2d');
const dpr = devicePixelRatio || 1;
glintCanvas.width = glintCanvas.height = SIZE * dpr;
glintCanvas.style.width = glintCanvas.style.height = `${SIZE}px`;
gctx.scale(dpr, dpr);
let sparks = [], glintFrame = 0;

function emit(list) {
  sparks.push(...list);
  if (!glintFrame) glintFrame = requestAnimationFrame(stepGlints);
}
function twinkleAt(i, n = 1, delay = 0) {
  const a = (i * STEP - 90) * Math.PI / 180;
  emit(Array.from({ length: n }, () => {
    const r = 168 + Math.random() * 24, j = a + (Math.random() - 0.5) * 0.35;
    return { kind: 'star', x: C + Math.cos(j) * r, y: C + Math.sin(j) * r, t: -delay - Math.random() * 6, life: 38 + Math.random() * 18, size: 3 + Math.random() * 3 };
  }));
}
const ring = () => emit([{ kind: 'ring', x: C, y: C, t: 0, life: 46 }]);
function stepGlints() {
  gctx.clearRect(0, 0, SIZE, SIZE);
  sparks = sparks.filter((s) => ++s.t < s.life);
  for (const s of sparks) {
    if (s.t < 0) continue;
    const k = s.t / s.life;
    if (s.kind === 'star') {
      const a = Math.sin(k * Math.PI);
      const r = s.size * (0.6 + a * 0.8);
      gctx.save();
      gctx.translate(s.x, s.y);
      gctx.rotate(k * 0.8);
      gctx.globalAlpha = a;
      gctx.fillStyle = '#f7f1f3';
      gctx.shadowColor = 'rgba(240, 214, 222, 0.95)';
      gctx.shadowBlur = 7;
      gctx.beginPath();
      for (let q = 0; q < 4; q++) {
        const ang = (q * Math.PI) / 2;
        gctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        gctx.lineTo(Math.cos(ang + Math.PI / 4) * r * 0.22, Math.sin(ang + Math.PI / 4) * r * 0.22);
      }
      gctx.closePath();
      gctx.fill();
      gctx.restore();
    } else {
      const e = 1 - (1 - k) ** 3;
      gctx.globalAlpha = (1 - k) * 0.8;
      gctx.strokeStyle = '#efe4e8';
      gctx.lineWidth = 1.4;
      gctx.beginPath(); gctx.arc(s.x, s.y, 40 + e * 150, 0, Math.PI * 2); gctx.stroke();
    }
  }
  gctx.globalAlpha = 1;
  glintFrame = sparks.length ? requestAnimationFrame(stepGlints) : 0;
}

// ---------- toast: liquid mercury progress ----------
let fill = 0, fillTarget = 0, waveFrame = 0, waveT = 0;
function stepWave() {
  fill += (fillTarget - fill) * 0.1;
  waveT += 0.1;
  const W = 280, H = 64, edge = fill * (W + 16) - 8;
  let d = `M0 0L${edge.toFixed(1)} 0`;
  for (let y = 0; y <= H; y += 4) d += `L${(edge + Math.sin(y / 8 + waveT) * 4 * (1 - fill * 0.7)).toFixed(1)} ${y}`;
  d += `L0 ${H}Z`;
  $('wave').setAttribute('d', d);
  waveFrame = toast.classList.contains('show') ? requestAnimationFrame(stepWave) : 0;
}

function showToast(title, sub, frac, state = '') {
  toast.querySelector('.toast-title').textContent = title;
  toast.querySelector('.toast-sub').textContent = sub;
  fillTarget = Math.max(0.04, frac);
  toast.className = `show ${state}`;
  if (!waveFrame) waveFrame = requestAnimationFrame(stepWave);
}

// ---------- lifecycle ----------
let busy = false;

window.petal.onOpen(() => {
  busy = false;
  hot = null; domeKey = ''; fileCount = 0; convertTarget = ''; dormant = new Set();
  root.style.removeProperty('--backdrop'); // the old snapshot belongs to wherever the wheel was last time
  flower.setBackdrop(null);
  toast.className = '';
  fill = fillTarget = 0;
  body.className = '';
  setDome(null);
  sparks = [];
  flower.open();
  requestAnimationFrame(() => {
    body.classList.add('open');
    PETALS.forEach((_, i) => twinkleAt(i, 1, 12 + i * 3)); // a star catches each tip as it opens
    setTimeout(() => { if (body.classList.contains('open') && !hot) setHot('convert'); }, 460);
  });
});

window.petal.onClose(() => {
  body.className = '';
  toast.className = '';
  flower.stop(); // nothing on screen: stop rendering
});

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  window.petal.log('dragenter', [...e.dataTransfer.items].map((i) => `${i.kind}:${i.type}`).join(','));
  describeDrag(e.dataTransfer);
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  // Always report "copy": a "move" result would let Explorer delete the source after the drop.
  e.dataTransfer.dropEffect = 'copy';
  if (busy) return;
  flower.setPointer(e.clientX, e.clientY);
  setHot(zoneAt(e.clientX, e.clientY));
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget && !busy) { setHot(null); flower.setPointer(null); } });

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const zone = zoneAt(e.clientX, e.clientY);
  const paths = [...e.dataTransfer.files].map((f) => window.petal.pathFor(f)).filter(Boolean);
  window.petal.log('drop', zone, paths.join('|'));
  if (!zone || !paths.length || busy) return;
  const petal = PETALS.find((p) => p.id === zone);
  if (petal?.multi && paths.length < 2) return; // dormant petal; let the wheel close
  window.petal.dropped();
  busy = true;

  // The chosen petal sinks into the dome, the rest fold back into a bud, and the bud becomes the progress pill.
  flower.pluck(PETALS.findIndex((p) => p.id === zone));
  body.classList.add('dropping');

  const verb = zone === 'convert' ? `Converting${convertTarget ? ` to ${convertTarget}` : ''}` : petal.verb;
  setTimeout(() => { if (busy) showToast(verb, paths.length > 1 ? `0 of ${paths.length}` : fileName(paths[0]), 0.06); }, 300);

  const off = progressHandler(paths.length, verb);
  const res = await window.petal.run(zone, paths);
  off();
  finish(res, paths.length);
});

const fileName = (p) => p.split(/[\\/]/).pop();

let onProgress = null;
window.petal.onProgress((p) => onProgress?.(p));
function progressHandler(total, verb) {
  onProgress = (p) => {
    if (p.download !== undefined) return showToast('Getting the AI model', `${Math.round(p.download * 100)}% · one time, then offline`, p.download);
    const t = p.total ?? total;
    showToast(verb, `${p.done} of ${t} done`, p.done / t);
  };
  return () => { onProgress = null; };
}

function leave(after) {
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => window.petal.done(), 280);
  }, after);
}

function celebrate() {
  ring();
  for (let i = 0; i < 6; i++) twinkleAt(Math.floor(Math.random() * PETALS.length), 1, i * 4);
}

function finish(res, total) {
  if (res.opened) { // an editor window took over
    flower.close();
    body.classList.add('closing');
    return setTimeout(() => window.petal.done(), 260);
  }
  if (res.error) {
    showToast("Couldn't finish", res.error, 1, 'error');
    return leave(2400);
  }
  if (res.copied) {
    showToast(`Copied ${res.copied.words} words`, res.copied.preview, 1, 'success');
    celebrate();
    return leave(1900);
  }
  const saved = res.results.flatMap((r) => r.saved || []);
  const skipped = res.results.filter((r) => r.skipped);
  const notes = res.results.map((r) => r.note).filter(Boolean);
  if (!saved.length) {
    showToast('Nothing saved', skipped[0]?.skipped || 'Unsupported file', 1, 'error');
    return leave(2400);
  }
  const sub = notes[0] || (saved.length === 1 ? fileName(saved[0]) : `${saved.length} files next to the originals`);
  showToast(saved.length === 1 ? 'Saved' : `Saved ${saved.length} files`, `${sub}${skipped.length ? ` · ${skipped.length} skipped` : ''}`, 1, 'success');
  celebrate();
  leave(1700);
}

// Handle for scripted UI snapshots.
window.__wheel = {
  setHot, track: (x, y) => flower.setPointer(x, y), showToast, celebrate,
  describeDrag: (types) => describeDrag({ items: types.map((type) => ({ kind: 'file', type })) }),
  pluck: (id) => flower.pluck(PETALS.findIndex((p) => p.id === id)),
};
