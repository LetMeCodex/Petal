// Glance widgets for the island: CPU, GPU, RAM, network, battery, clock.
// Values arrive once a second from the main process; everything in between is animated here
// (numbers count, rings spring, liquid sways, flows run at the speed of the data).
// Continuous motion (liquid, streams) is CSS transforms so it stays on the compositor; the JS loop
// only runs while a number is still counting toward its target.

const RING = 150.8;            // circumference of r=24
const HISTORY = 30;            // seconds of sparkline

const fmtRate = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : b >= 1024 ? `${Math.round(b / 1024)} KB/s` : `${Math.round(b)} B/s`);
// Load colour: rose when calm, warming to ember under heavy load.
const hueFor = (pct) => (pct < 50 ? 330 : 330 + Math.min(1, (pct - 50) / 50) * 45) % 360;

function sparkPath(values, w = 80, h = 14) {
  if (values.length < 2) return { line: '', fill: '' };
  const step = w / (HISTORY - 1);
  const pts = values.map((v, i) => [w - (values.length - 1 - i) * step, h - 1 - (Math.max(0, Math.min(100, v)) / 100) * (h - 2)]);
  const line = `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`;
  return { line, fill: `${line}L${pts[pts.length - 1][0]} ${h}L${pts[0][0]} ${h}Z` };
}

// A number that eases toward its target instead of jumping.
class Ticker {
  constructor(el, fmt, onStep) { this.el = el; this.fmt = fmt; this.onStep = onStep; this.v = 0; this.t = 0; this.html = ''; }
  // -1 means "no reading" (no battery, GPU not ready): switch to it at once instead of counting down through 0%.
  set(t) { this.t = t; if (t < 0 || this.v < 0) this.v = t; }
  // Returns true while still moving. Writes the DOM only when the shown text actually changes.
  step() {
    // Numbers are shown whole, so stop as soon as the whole number is reached (about 12 frames).
    if (Math.abs(this.t - this.v) < 0.5) this.v = this.t; else this.v += (this.t - this.v) * 0.22;
    const html = this.fmt(this.v);
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
    this.onStep?.(this.v);
    return this.v !== this.t;
  }
}

export function createGlance(container) {
  const tickers = [];
  const hist = { cpu: [], gpu: [], rx: [] };
  let enabled = {};
  let raf = 0, running = false, last = null;

  const tiles = {
    cpu: ring('cpu', 'CPU'),
    gpu: ring('gpu', 'GPU'),
    ram: tile('ram', 'RAM', `<div class="tank"><div class="liquid"><i></i></div><span class="val"></span></div><span class="sub"></span>`),
    net: tile('net', 'Network', `<div class="flow">
      <div class="row down"><span>↓</span><span class="stream"><i></i></span><b></b></div>
      <div class="row up"><span>↑</span><span class="stream"><i></i></span><b></b></div>
    </div><svg class="spark" viewBox="0 0 80 14" preserveAspectRatio="none"><path class="fill"/><path class="line"/></svg>`),
    battery: tile('battery', 'Battery', `<div class="batt"><i></i></div><svg class="plug" viewBox="0 0 24 24"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/></svg><span class="val"></span>
      <svg class="bolt" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`),
    clock: tile('clock', 'Time', `<div class="clock"></div><span class="sub"></span>`),
  };

  function tile(id, label, inner) {
    const el = document.createElement('div');
    el.className = 'w';
    el.dataset.w = id;
    el.innerHTML = `${inner}<span class="lbl">${label}</span>`;
    return el;
  }
  function ring(id, label) {
    const el = tile(id, label, `<div class="ring"><svg viewBox="0 0 58 58"><circle class="track" cx="29" cy="29" r="24"/><circle class="arc" cx="29" cy="29" r="24"/></svg><span class="val"></span></div>
      <svg class="spark" viewBox="0 0 80 14" preserveAspectRatio="none"><path class="fill"/><path class="line"/></svg>`);
    // The arc moves with the number, from the same 30 fps loop (a CSS transition on an SVG stroke
    // repaints at the display's refresh rate, 144 times a second on many laptops).
    const arc = el.querySelector('.arc');
    let shown = -1;
    const t = new Ticker(el.querySelector('.val'), (v) => (v < 0 ? '—' : `${Math.round(v)}<small>%</small>`), (v) => {
      const off = Math.round(RING * (1 - Math.max(0, Math.min(100, v)) / 100) * 2) / 2;
      if (off !== shown) { shown = off; arc.style.strokeDashoffset = String(off); }
    });
    tickers.push(t);
    el.ticker = t;
    return el;
  }

  const ramT = new Ticker(tiles.ram.querySelector('.val'), (v) => `${Math.round(v)}<small>%</small>`);
  const batT = new Ticker(tiles.battery.querySelector('.val'), (v) => (v < 0 ? 'AC' : `${Math.round(v)}<small>%</small>`));
  tickers.push(ramT, batT);

  // Clock with rolling digits.
  const clockEl = tiles.clock.querySelector('.clock');
  const slots = [];
  'dd:dd'.split('').forEach((c) => {
    if (c === ':') { clockEl.insertAdjacentHTML('beforeend', '<span class="colon">:</span>'); return; }
    const d = document.createElement('span');
    d.className = 'digit';
    d.innerHTML = `<span>0</span>`;
    clockEl.append(d);
    slots.push({ el: d, val: null });
  });
  function setDigit(slot, ch) {
    if (slot.val === ch) return;
    const old = slot.el.firstElementChild;
    const nu = document.createElement('span');
    nu.textContent = ch;
    nu.style.transform = 'translateY(100%)';
    slot.el.append(nu);
    requestAnimationFrame(() => { nu.style.transform = 'translateY(0)'; if (old) old.style.transform = 'translateY(-100%)'; });
    setTimeout(() => old?.remove(), 600);
    slot.val = ch;
  }
  function tickClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    [...hh, ...mm].forEach((ch, i) => setDigit(slots[i], ch));
    clockEl.classList.toggle('tock', d.getSeconds() % 2 === 1);
    tiles.clock.querySelector('.sub').textContent = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function render() {
    container.innerHTML = '';
    let i = 0;
    for (const [id, el] of Object.entries(tiles)) {
      if (enabled[id] === false) continue;
      if (id === 'battery' && last && last.bat < 0 && last.ac) { /* desktop: still show "AC" */ }
      el.style.setProperty('--i', i++);
      container.append(el);
    }
    if (!container.children.length) container.innerHTML = '<div class="empty">All widgets are off. Turn some on in Settings.</div>';
    tickClock();
  }

  // Count numbers toward their targets, then go quiet until the next sample.
  let stepAt = 0;
  function frame(now) {
    if (now - stepAt < 32) { raf = requestAnimationFrame(frame); return; }   // 30 fps on any screen
    stepAt = now;
    let moving = false;
    for (const t of tickers) moving = t.step() || moving;
    raf = running && moving ? requestAnimationFrame(frame) : 0;
  }
  const wake = () => { if (running && !raf) raf = requestAnimationFrame(frame); };

  // Motion that means something: the streams flow only while data is moving, and the liquid sloshes
  // when the panel opens or RAM use changes, then settles. Driven by a 30 fps timer (CSS animations
  // would run at the display's 144 Hz), and when nothing is changing it draws no frames at all.
  // Every frame of this transparent window costs about 1% of a core. Off in Calm motion.
  let ambient = 0, sloshUntil = 0, lastRam = null;
  const BUSY_NET = 20 * 1024;
  const liquid = tiles.ram.querySelector('.liquid i');
  const streams = [...tiles.net.querySelectorAll('.row')].map((row) => [row, row.querySelector('.stream i')]);
  const t0 = performance.now();
  function drift() {
    if (document.body.classList.contains('calm')) return;
    const now = performance.now(), t = (now - t0) / 1000;
    // transform set directly on layer-promoted elements: the GPU just moves them, nothing repaints.
    if (now < sloshUntil) liquid.style.transform = `translateX(${(-((t / 2.6) % 1) * 50).toFixed(1)}px)`;
    for (const [row, el] of streams) {
      if (!(+row.dataset.rate > BUSY_NET)) continue;
      const dur = parseFloat(row.style.getPropertyValue('--dur')) || 2;
      const p = (t / dur) % 1;
      el.style.transform = `translateX(${((row.classList.contains('up') ? p - 1 : -p) * 10).toFixed(2)}px)`;
    }
  }

  return {
    setEnabled(map) { enabled = { ...map }; render(); },
    start() { running = true; if (last) this.update(last); wake(); tickClock(); this.clockTimer ??= setInterval(tickClock, 1000); sloshUntil = performance.now() + 2500; ambient ||= setInterval(drift, 33); },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; clearInterval(this.clockTimer); this.clockTimer = null; clearInterval(ambient); ambient = 0; },
    update(s) {
      last = s;
      if (!running) return;                 // off screen: keep the sample, draw it when shown
      wake();
      for (const id of ['cpu', 'gpu']) {
        const v = s[id];
        const el = tiles[id];
        if (v >= 0) { hist[id].push(v); if (hist[id].length > HISTORY) hist[id].shift(); }
        el.ticker.set(v);
        el.style.setProperty('--hue', hueFor(v));
        const p = sparkPath(hist[id]);
        el.querySelector('.spark .line').setAttribute('d', p.line);
        el.querySelector('.spark .fill').setAttribute('d', p.fill);
      }
      ramT.set(s.ram);
      if (lastRam != null && Math.abs(s.ram - lastRam) >= 0.5) sloshUntil = performance.now() + 3000;
      lastRam = s.ram;
      tiles.ram.style.setProperty('--fill', Math.max(0, Math.min(1, s.ram / 100)));
      tiles.ram.querySelector('.sub').textContent = `${s.ramUsed.toFixed(1)} / ${Math.round(s.ramTotal)} GB`;

      // Network: dash speed follows throughput (faster flow = more data), sparkline of download.
      const rows = tiles.net.querySelectorAll('.row');
      rows[0].querySelector('b').textContent = fmtRate(s.rx);
      rows[1].querySelector('b').textContent = fmtRate(s.tx);
      // Only touch the duration when it changes a step: rewriting it restarts the CSS animation.
      const dur = (b) => `${Math.max(0.3, 2.4 - Math.round(Math.log10(1 + b / 1024) * 2) * 0.4).toFixed(1)}s`;
      for (const [row, b] of [[rows[0], s.rx], [rows[1], s.tx]]) {
        if (row.style.getPropertyValue('--dur') !== dur(b)) row.style.setProperty('--dur', dur(b));
        row.dataset.rate = Math.round(b);
      }
      hist.rx.push(s.rx); if (hist.rx.length > HISTORY) hist.rx.shift();
      const peak = Math.max(1, ...hist.rx);
      const p = sparkPath(hist.rx.map((b) => (b / peak) * 100));
      tiles.net.querySelector('.spark .line').setAttribute('d', p.line);
      tiles.net.querySelector('.spark .fill').setAttribute('d', p.fill);

      batT.set(s.bat);
      const b = tiles.battery;
      // No battery (a desktop): a plug and "Power · AC" instead of a battery that looks full.
      const noBat = s.bat < 0;
      if (b.classList.contains('nobat') !== noBat) {
        b.classList.toggle('nobat', noBat);
        b.querySelector('.lbl').textContent = noBat ? 'Power' : 'Battery';
      }
      b.style.setProperty('--lvl', s.bat < 0 ? 1 : s.bat / 100);
      b.querySelector('.batt').classList.toggle('low', s.bat >= 0 && s.bat <= 20);
      b.classList.toggle('charging', !!s.ac && s.bat >= 0 && s.bat < 100);
    },
    get cpu() { return last?.cpu ?? 0; },
  };
}
