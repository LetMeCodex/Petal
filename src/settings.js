const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { VK } = require('./hook');

const DEFAULTS = {
  onboarded: false,
  // type 'key': press (tap or hold) this key mid-drag. type 'dwell': hold the drag still for `ms`.
  trigger: { type: 'key', vk: VK.Shift, label: 'Shift', ms: 500 },
  island: true,
  // Where the island lives, as fractions of the monitor: 'top' clings to the top edge, 'float' hangs anywhere.
  islandPos: { mode: 'top', fx: 0.5, fy: 0 },
  // Live widgets on the island's Glance tab.
  widgets: { cpu: true, gpu: true, ram: true, net: true, battery: true, clock: true },
  islandPulse: true,      // a thin CPU ring around the idle drop
  // 'auto': full animations, dropping to calm on weak machines or when frames run slow. 'full' | 'calm' force it.
  motion: 'auto',
  motionV: 2,
};

let file, sample, data = structuredClone(DEFAULTS);

function init(userData) {
  file = path.join(userData, 'settings.json');
  sample = path.join(userData, 'Try me.png');
  try { data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  // Settings from the uiohook build stored scan-code style `keycode`s; those don't map to virtual keys.
  if (data.trigger.type === 'key' && data.trigger.vk === undefined) data.trigger = DEFAULTS.trigger;
  data.widgets = { ...DEFAULTS.widgets, ...data.widgets };   // new widgets default on for older settings files
  // Before 'auto' existed, 'full' was simply the default; move those files onto 'auto'.
  if (data.motionV !== 2) { if (data.motion === 'full') data.motion = 'auto'; data.motionV = 2; }
  return fs.existsSync(sample) ? Promise.resolve() : writeSample();
}

function writeSample() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5f45"/><stop offset=".55" stop-color="#ffb23e"/><stop offset="1" stop-color="#8a6cff"/>
    </linearGradient></defs>
    <rect width="800" height="560" fill="url(#g)"/>
    <text x="400" y="300" font-family="Segoe UI" font-size="72" font-weight="700" fill="#fff" text-anchor="middle">Try me</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toFile(sample);
}

const get = () => data;
function set(patch) {
  data = { ...data, ...patch };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

module.exports = { init, get, set, sampleFile: () => sample };
