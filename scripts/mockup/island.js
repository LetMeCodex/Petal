// Mockup driver: ?state=idle|hover|drag|work|done|suggest|error shows one state of Petal Island,
// with real 3D glass buds (the same flower as the wheel) in the states that have one.
import { createFlower } from '../../src/theme/glass-flower.js';

const state = new URLSearchParams(location.search).get('state') || 'idle';
document.body.dataset.state = state;

for (const c of document.querySelectorAll(`.s-${state} canvas.bud`)) {
  const big = c.classList.contains('big');
  const size = big ? 176 : c.classList.contains('sm') ? 26 : 32;
  const flower = createFlower(c, big
    ? { size, count: 10, base: 24, reach: 82, petalWidth: 19, domeRadius: 20, tint: 0.75 }
    : { size, count: 6, base: size * 0.12, reach: size * 0.47, petalWidth: size * 0.19, domeRadius: size * 0.16, tint: 0.85 });
  flower.open();
  flower.setBloom(+c.dataset.bloom);
  if (c.dataset.spin) flower.setSpin(1.6);
  if (c.dataset.wilt) for (let i = 0; i < 6; i++) flower.setDormant(i, true);
  if (big) flower.setHot(6); // "Remove background" petal, matching the hot chip
}
