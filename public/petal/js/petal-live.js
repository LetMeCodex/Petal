// The real Petal flower on the website: the same glass-flower.js the app's wheel runs.
//   window.petalHero.frame(lensState, hotIndex)  called from the page's single rAF loop
//   window.petalDrag.step(n)                     0 drag · 1 bloom · 2 hover Remove background · 3 pluck
// Each flower renders only while its section is on screen, and freezes for Calm / reduced motion.
import { createFlower } from './glass-flower.js';

// Same order as the app's wheel; the hero's HUD chips use these indices too.
const PETALS = ['compress', 'clean.exif', 'copy.text', 'edit', 'annotate', 'add.bg', 'remove.bg', 'crop', 'redact', 'merge.pdf'];
const calm = () => document.documentElement.dataset.motion === 'calm' || matchMedia('(prefers-reduced-motion: reduce)').matches;

function mount(container, { labels = false } = {}) {
  const size = Math.round(container.clientWidth || 440);
  const k = size / 440;            // the app's wheel is drawn at 440 px; scale its proportions
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${size}px;height:${size}px;display:block`;
  canvas.setAttribute('aria-label', 'Petal’s 3D glass flower of tools');
  container.append(canvas);
  const flower = createFlower(canvas, { size, base: 64 * k, reach: 196 * k, petalWidth: 42 * k, domeRadius: 56 * k, maxFps: 60 });

  // Mono HUD labels pinned to the petals as they move.
  let tags = [];
  if (labels) {
    const layer = document.createElement('div');
    layer.className = 'pointer-events-none absolute inset-0';
    container.append(layer);
    tags = PETALS.map((name, i) => {
      const t = document.createElement('span');
      t.className = 'petal-tag';
      t.textContent = `${String(i + 1).padStart(2, '0')} ${name}`;
      layer.append(t);
      return t;
    });
    flower.onFrame(() => {
      flower.anchors().forEach((a, i) => {
        const t = tags[i];
        t.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(-50%, -50%) scale(${(0.9 + a.hot * 0.18).toFixed(3)})`;
        t.style.opacity = (a.opacity * (0.55 + a.hot * 0.45)).toFixed(3);
        t.classList.toggle('hot', a.hot > 0.5);
      });
    });
  }

  // Render only while visible; a still frame stays on the canvas otherwise.
  let visible = false;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !calm()) flower.start(); else flower.stop();
  }, { rootMargin: '120px' }).observe(container);
  new MutationObserver(() => { if (calm()) flower.stop(); else if (visible) flower.start(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return { flower, canvas, size };
}

// ---------------- hero ----------------
const heroBox = document.getElementById('hero-webgl-container');
if (heroBox) {
  const { flower, canvas, size } = mount(heroBox, { labels: true });
  flower.open();
  let lastHot;
  window.petalHero = {
    // The site's lens follows the cursor across the hero stage; the flower's light follows the lens.
    frame(lens, hot) {
      const stage = document.getElementById('hero-lens-stage');
      if (stage && lens?.inside) {
        const s = stage.getBoundingClientRect(), c = canvas.getBoundingClientRect();
        flower.setPointer(lens.x + s.left - c.left, lens.y + s.top - c.top);
      } else flower.setPointer(null);
      const key = hot == null || hot < 0 ? (hot === -1 ? 'dome' : null) : hot;
      if (key !== lastHot) { lastHot = key; flower.setHot(key); }
    },
    flower, size,
  };
}

// ---------------- drag scene ----------------
const dragBox = document.getElementById('drag-flower-canvas');
if (dragBox) {
  const { flower } = mount(dragBox);
  const label = document.getElementById('drag-dome-label');
  flower.setBloom(0);
  flower.close();
  let current = -1;
  const DOME = ['', 'Convert · pick a format', 'Remove background · on-device AI', 'Saved · mug No BG.png'];
  window.petalDrag = {
    step(n) {
      if (n === current) return;
      const from = current;
      current = n;
      if (label) { label.textContent = DOME[n] || ''; label.style.opacity = n ? '1' : '0'; }
      if (n === 0) { flower.setHot(null); flower.close(); return; }
      // A fast scroll can skip steps, so any step past 0 blooms a closed (or plucked) flower first.
      if (from <= 0 || from === 3) { flower.setBloom(1); flower.open(); }
      if (n === 1) { flower.setHot('dome'); return; }
      if (n === 2) { flower.setHot(6); flower.setPointer(110, 330); return; }
      if (n === 3) flower.pluck(6);
    },
  };
}
