const cards = [...document.querySelectorAll('.card')];
const warn = document.getElementById('warn');
const practiceHint = document.getElementById('practiceHint');
const customLabel = document.getElementById('customLabel');
const customHint = document.getElementById('customHint');
const sample = document.getElementById('sample');

let keys;

function kindOf(trigger) {
  if (trigger.type === 'dwell') return 'dwell';
  if (trigger.vk === keys.Shift) return 'shift';
  if (trigger.vk === keys.Ctrl) return 'ctrl';
  return 'custom';
}

function render(trigger) {
  const kind = kindOf(trigger);
  cards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.trigger === kind)));
  warn.hidden = kind !== 'shift';
  if (kind === 'custom') customLabel.textContent = trigger.label;
  practiceHint.innerHTML = trigger.type === 'dwell'
    ? 'then hold it still for half a second without letting go.'
    : `then tap <kbd>${trigger.label}</kbd> while you're still holding the mouse.`;
}

async function choose(kind) {
  let trigger;
  if (kind === 'shift') trigger = { type: 'key', vk: keys.Shift, label: 'Shift' };
  if (kind === 'ctrl') trigger = { type: 'key', vk: keys.Ctrl, label: 'Ctrl' };
  if (kind === 'dwell') trigger = { type: 'dwell', ms: 500, label: 'Pause' };
  if (kind === 'custom') {
    const card = cards.find((c) => c.dataset.trigger === 'custom');
    card.classList.add('listening');
    customHint.textContent = 'Listening… press a key';
    trigger = await new Promise((resolve) => window.petal.captureKey(({ vk, label }) => resolve({ type: 'key', vk, label })));
    card.classList.remove('listening');
    customHint.textContent = 'Click to pick a different key.';
  }
  const s = await window.petal.setSettings({ trigger });
  render(s.trigger);
}

cards.forEach((c) => c.addEventListener('click', () => choose(c.dataset.trigger)));

// A real OS file drag (not an HTML drag), so practising goes through exactly the same path as Explorer.
const zone = document.getElementById('zone');
sample.addEventListener('dragstart', (e) => {
  e.preventDefault();
  zone.classList.add('dragging');
  window.petal.startSampleDrag();
});
// The OS drag loop swallows pointer events, so the first move after it ends tells us the drag is over.
window.addEventListener('pointermove', () => zone.classList.remove('dragging'));

document.getElementById('done').addEventListener('click', () => window.petal.finishOnboarding());
document.getElementById('close').addEventListener('click', () => window.petal.editorClose());

// Glass cards lean toward the pointer; glare follows it across each card. (The hero flower lives in living.js.)
for (const card of cards) {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
    card.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
  });
  card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
}

const islandSw = document.getElementById('islandSw');
islandSw.addEventListener('click', async (e) => {
  e.preventDefault();
  const on = islandSw.getAttribute('aria-checked') !== 'true';
  islandSw.setAttribute('aria-checked', String(on));
  await window.petal.setSettings({ island: on });
});

window.petal.onIslandSwitched((on) => islandSw.setAttribute('aria-checked', String(on)));

window.petal.getSettings().then((s) => {
  keys = s.keys;
  islandSw.setAttribute('aria-checked', String(s.island !== false));
  // Opened again later from the tray, this is Settings, not a first run.
  if (s.onboarded) {
    document.querySelector('.titlebar .mono').textContent = 'Petal — settings';
    document.querySelector('#done .silver').textContent = 'Done';
  }
  sample.src = s.sampleUrl;
  render(s.trigger);
});
