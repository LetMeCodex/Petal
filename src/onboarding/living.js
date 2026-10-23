// Onboarding's living layer: the pastel background, the same glass flower as the wheel (refracting
// the background behind it), and a headline whose letters swell toward the pointer.
import { createBackground } from '../theme/bloom-bg.js';
import { createFlower } from '../theme/glass-flower.js';

const SIZE = 260;
const bg = createBackground(document.getElementById('bg'));

const holder = document.getElementById('bloom');
const canvas = document.createElement('canvas');
holder.append(canvas);
const flower = createFlower(canvas, { size: SIZE, count: 8, base: 36, reach: 118, petalWidth: 30, domeRadius: 32, refract: 0.07, tint: 0.7 });

// Every 4th background frame, copy the patch behind the flower into its backdrop so the glass bends the colour.
// (The copy happens straight after the background renders, while its frame is still readable.)
const patch = document.createElement('canvas');
patch.width = patch.height = 128;
const pctx = patch.getContext('2d');
let holderRect = holder.getBoundingClientRect();
addEventListener('resize', () => { holderRect = holder.getBoundingClientRect(); });
bg.onFrame((n) => {
  if (n % 4) return;
  const src = bg.canvas, k = src.width / innerWidth, r = holderRect;
  pctx.drawImage(src, r.left * k, r.top * k, r.width * k, r.height * k, 0, 0, 128, 128);
  flower.setBackdrop(patch);
});

// The flower watches the pointer from wherever it is on the window.
let pointer = null, movedAt = 0;
addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  movedAt = performance.now();
  const r = holderRect;
  flower.setPointer(SIZE / 2 + (e.clientX - r.left - SIZE / 2) * 0.35, SIZE / 2 + (e.clientY - r.top - SIZE / 2) * 0.35);
}, { passive: true });

flower.open();
// Now and then a petal leans out on its own, so the flower never feels frozen.
setInterval(() => {
  flower.setHot(Math.floor(Math.random() * 8));
  setTimeout(() => flower.setHot(null), 1400);
}, 4200);

// ---------- alive type ----------
// Letters near the pointer get heavier and wider; when the pointer rests, a slow wave of weight
// travels through the word instead. Variable-font axes, so it's all one font file.
const letters = [...document.querySelectorAll('#headline .ch')];
let centres = [];
const measure = () => { centres = letters.map((l) => { const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); };
setTimeout(measure, 1200); // after the settle-in animation
addEventListener('resize', measure);

let last = 0;
function typeFrame(now) {
  requestAnimationFrame(typeFrame);
  if (now - last < 33 || !centres.length) return; // 30 fps is plenty for type
  last = now;
  const resting = !pointer || now - movedAt > 1600;
  letters.forEach((l, i) => {
    let k;
    if (resting) k = 0.5 + 0.5 * Math.sin(now / 900 - i * 0.45);
    else {
      const d = Math.hypot(pointer.x - centres[i].x, pointer.y - centres[i].y);
      k = Math.exp(-(d * d) / (2 * 140 * 140));
    }
    l.style.setProperty('--w', Math.round(380 + k * 380));
    l.style.setProperty('--wd', `${Math.round(84 + k * 16)}%`);
  });
}
requestAnimationFrame(typeFrame);
