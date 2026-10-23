// Double-tap Ctrl: what counts as the gesture and what doesn't. Run: node scripts/doubletap-test.js
const { createDoubleTap } = require('../src/ask/doubletap');

const CTRL = 0x11, C = 0x43;
function play(events) {
  let t = 0, fired = 0;
  const d = createDoubleTap(() => fired++, { now: () => t });
  for (const [at, kind, vk] of events) { t = at; d[kind](vk); }
  return fired;
}
const cases = [
  ['two quick taps', [[0, 'keydown', CTRL], [80, 'keyup', CTRL], [250, 'keydown', CTRL], [320, 'keyup', CTRL]], 1],
  ['key repeat while holding is one press', [[0, 'keydown', CTRL], [30, 'keydown', CTRL], [60, 'keydown', CTRL], [90, 'keyup', CTRL], [200, 'keydown', CTRL], [260, 'keyup', CTRL]], 1],
  ['Ctrl+C then Ctrl is not a double tap', [[0, 'keydown', CTRL], [40, 'keydown', C], [90, 'keyup', CTRL], [200, 'keydown', CTRL], [260, 'keyup', CTRL]], 0],
  ['typing between taps cancels', [[0, 'keydown', CTRL], [60, 'keyup', CTRL], [150, 'keydown', C], [250, 'keydown', CTRL], [300, 'keyup', CTRL]], 0],
  ['holding Ctrl is not a tap', [[0, 'keydown', CTRL], [600, 'keyup', CTRL], [700, 'keydown', CTRL], [760, 'keyup', CTRL]], 0],
  ['taps too far apart', [[0, 'keydown', CTRL], [60, 'keyup', CTRL], [1200, 'keydown', CTRL], [1260, 'keyup', CTRL]], 0],
  ['three taps fire once', [[0, 'keydown', CTRL], [60, 'keyup', CTRL], [200, 'keydown', CTRL], [260, 'keyup', CTRL], [400, 'keydown', CTRL], [460, 'keyup', CTRL]], 1],
];
let bad = 0;
for (const [name, ev, want] of cases) { const got = play(ev); if (got !== want) bad++; console.log(`${got === want ? 'PASS' : 'FAIL'} ${name}${got === want ? '' : ` (fired ${got}, want ${want})`}`); }
console.log(bad ? `\nFAILED: ${bad}` : '\nALL OK');
process.exit(bad ? 1 : 0);
