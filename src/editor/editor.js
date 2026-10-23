// Editor shell: loads the dropped file(s), hosts one mode (crop, addbg, edit, annotate, redact),
// handles canvas sizing, pointer routing, shortcuts and saving. Modes own their controls and drawing.
import crop from './modes/crop.js';
import addbg from './modes/addbg.js';
import edit from './modes/edit.js';
import annotate from './modes/annotate.js';
import redact from './modes/redact.js';
import { createBackground } from '../theme/bloom-bg.js';

createBackground(document.getElementById('bg'), { scale: 0.35 });

const MODES = { crop, addbg, edit, annotate, redact };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const stage = $('stage');

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const job = await window.petal.editorLoad();
const mode = MODES[job.mode];
if (!job.files.length) {
  showToast("This file type can't be edited yet");
  setTimeout(() => window.petal.editorClose(), 1800);
  throw new Error('nothing to edit');
}
const images = await Promise.all(job.files.map((f) => loadImage(f.dataUrl)));

let frame = 0;
const api = {
  img: images[0],
  file: job.files[0],
  images,
  files: job.files,
  ctx,
  canvas,
  stage,
  controls: $('controls'),
  overlay: $('overlay'),
  view: { scale: 1, ox: 0, oy: 0 },
  render() { if (!frame) frame = requestAnimationFrame(draw); },
  // Fit a w×h scene into the stage; modes draw in scene units after applying `view`.
  fit(w, h, pad = 24) {
    const r = stage.getBoundingClientRect();
    const scale = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h);
    api.view = { scale, ox: (r.width - w * scale) / 2, oy: (r.height - h * scale) / 2 };
    return api.view;
  },
  toScene(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - api.view.ox) / api.view.scale, y: (e.clientY - r.top - api.view.oy) / api.view.scale };
  },
  toScreen(p) {
    return { x: p.x * api.view.scale + api.view.ox, y: p.y * api.view.scale + api.view.oy };
  },
  // Apply the scene transform on top of the device-pixel transform.
  applyView() {
    const { scale, ox, oy } = api.view;
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
  },
  get dpr() { return devicePixelRatio; },
  setMeta(text) { $('meta').textContent = text; },
  setCursor(c) { canvas.style.cursor = c; },
};

function draw() {
  frame = 0;
  const r = stage.getBoundingClientRect();
  const w = Math.round(r.width * devicePixelRatio), h = Math.round(r.height * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  mode.render(api);
  ctx.restore();
}
new ResizeObserver(() => api.render()).observe(stage);

// ---------- chrome ----------
$('title').textContent = mode.title;
document.title = `${mode.title} · Petal`;
$('file').textContent = mode.batch && job.files.length > 1
  ? `${job.files[0].name} + ${job.files.length - 1} more`
  : job.files[0].name;
$('save').textContent = mode.saveLabel || 'Save';
$('close').addEventListener('click', () => window.petal.editorClose());
$('cancel').addEventListener('click', () => window.petal.editorClose());
$('save').addEventListener('click', save);

mode.init(api);
api.render();

// ---------- pointer ----------
let pointerDown = false;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !mode.pointer) return;
  pointerDown = true;
  canvas.setPointerCapture(e.pointerId);
  mode.pointer('down', api.toScene(e), e);
});
canvas.addEventListener('pointermove', (e) => {
  if (!mode.pointer) return;
  mode.pointer(pointerDown ? 'drag' : 'hover', api.toScene(e), e);
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDown) return;
  pointerDown = false;
  mode.pointer('up', api.toScene(e), e);
});

// ---------- shortcuts ----------
window.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input[type="text"], input[type="number"], [contenteditable]');
  if (e.key === 'Escape' && !typing) return window.petal.editorClose();
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); return save(); }
  if (typing) return;
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); mode.undo?.(); api.render(); }
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); mode.redo?.(); api.render(); }
});

// ---------- save ----------
function toBlob(source, ext) {
  let c = source;
  if (ext === 'jpg') { // JPEG has no alpha: flatten onto white instead of letting transparency turn black
    c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(source, 0, 0);
  }
  return new Promise((resolve) => c.toBlob(resolve, MIME[ext] || 'image/png', 0.92));
}

async function save() {
  const button = $('save');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const targets = mode.batch ? images.map((img, i) => [img, job.files[i]]) : [[images[0], job.files[0]]];
    const outputs = [];
    for (const [img, file] of targets) {
      const out = await mode.export(img, file);
      const ext = mode.outExt || file.ext;
      const blob = await toBlob(out, ext);
      outputs.push({ src: file.path, ext, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    const saved = await window.petal.editorSave(outputs);
    const name = saved[0].split(/[\\/]/).pop();
    button.classList.add('done');
    button.textContent = 'Saved';
    const r = button.getBoundingClientRect();
    petalBurst(r.left + r.width / 2, r.top + r.height / 2);
    showToast(saved.length === 1 ? `Saved ${name}` : `Saved ${saved.length} files`, saved[0]);
    setTimeout(() => window.petal.editorClose(), 1700);
  } catch (err) {
    showToast(`Couldn't save: ${err.message || err}`);
    button.disabled = false;
  }
}

// ---------- micro-interactions ----------
// A petal-shaped ripple blooms from wherever a button is pressed.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button, .chip, .swatch');
  if (!b || b.classList.contains('swatch')) return;
  const r = b.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.left = `${e.clientX - r.left}px`;
  s.style.top = `${e.clientY - r.top}px`;
  s.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
  b.append(s);
  s.addEventListener('animationend', () => s.remove());
});

// Save success: a handful of petals burst from the button and drift down.
const confetti = $('confetti');
const cctx = confetti.getContext('2d');
function petalBurst(x, y) {
  confetti.width = innerWidth * devicePixelRatio;
  confetti.height = innerHeight * devicePixelRatio;
  cctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const bits = Array.from({ length: 28 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 3 + Math.random() * 5;
    return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, size: 3 + Math.random() * 4, tone: Math.random() < 0.18 ? 'blush' : 'pearl', life: 1 };
  });
  const step = () => {
    cctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of bits) {
      if ((p.life -= 0.012) <= 0) continue;
      alive++;
      p.vy += 0.16; p.vx *= 0.99; p.x += p.vx + Math.sin(p.y / 20) * 0.4; p.y += p.vy; p.rot += p.vr;
      cctx.save();
      cctx.globalAlpha = Math.min(1, p.life * 1.5);
      cctx.translate(p.x, p.y); cctx.rotate(p.rot); cctx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(p.rot * 2)));
      const g = cctx.createLinearGradient(0, -p.size, 0, p.size);
      // Pearl shards with the odd blush one, the same palette as the wheel's glass.
      g.addColorStop(0, p.tone === 'blush' ? '#f3ddd6' : '#f4f8fa');
      g.addColorStop(1, p.tone === 'blush' ? '#c99f95' : '#8e9da7');
      cctx.fillStyle = g;
      cctx.beginPath(); cctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2); cctx.fill();
      cctx.restore();
    }
    if (alive) requestAnimationFrame(step); else cctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(step);
}

function showToast(text, reveal) {
  const t = $('toast');
  t.textContent = text;
  if (reveal) {
    const a = document.createElement('a');
    a.textContent = 'Show in folder';
    a.addEventListener('click', () => window.petal.reveal(reveal));
    t.append(a);
  }
  t.hidden = false;
}

// Handle for scripted tests (scripts/editor-test.js).
window.__editor = { api, mode, save };
