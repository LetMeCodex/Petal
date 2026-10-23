// Global mouse/keyboard events from native/hook.exe (a tiny C# low-level hook).
// uiohook-napi can't register its hooks on current Windows 11 builds (SetWindowsHookEx -> 0x7E),
// and a separate process also keeps a stuck hook from ever freezing input for the app itself.
const readline = require('readline');
const { spawn } = require('child_process');
const native = require('./native');
const { EventEmitter } = require('events');

const VK = { Shift: 0x10, Ctrl: 0x11, Alt: 0x12, Escape: 0x1b };
const EXE = native.file('hook.exe');
const ensureBuilt = (opts) => native.build('hook', [], opts);

class Hook extends EventEmitter {
  // Every listener gets every event: one throwing listener must not stop the wheel from opening.
  emit(type, ...args) {
    for (const fn of this.listeners(type)) {
      try { fn(...args); } catch (err) { console.error(`[hook] ${type} listener failed:`, err); }
    }
    return true;
  }

  // `ownerPid`: windows of this process never count as fullscreen (Petal's own windows).
  start(ownerPid = process.pid) {
    ensureBuilt();
    this.stopping = false;
    this.ownerPid = ownerPid;
    this.proc = spawn(EXE, [String(ownerPid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const [type, a, b, c, d] = line.split(' ');
      if (type === 'down' || type === 'move') this.emit(type, { x: +a, y: +b });
      else if (type === 'up') this.emit('up');
      else if (type === 'key') this.emit('key', { vk: +a, name: (b || `Key ${a}`).replace(/_/g, ' ') });
      else if (type === 'keyup') this.emit('keyup', { vk: +a });
      else if (type === 'ready') this.emit('ready');
      // Physical-pixel rect of the monitor a fullscreen window covers, or null when nothing is fullscreen.
      else if (type === 'fs') this.emit('fullscreen', a === '1' ? { x: +b, y: +c, width: +d - +b, height: +line.split(' ')[5] - +c } : null);
      else if (type === 'error') console.error(`[hook] SetWindowsHookEx failed: ${a}`);
      else if (type === 'stats') this.emit('stats', parseStats(line));
    });
    this.proc.on('exit', (code) => {
      if (this.stopping) return;
      console.error(`[hook] helper exited (${code}), restarting`);
      setTimeout(() => {
        this.start(this.ownerPid);
        const level = this.statsLevel;   // the new helper starts at 0; ask again
        this.statsLevel = 0;
        this.setStats(level);
      }, 1000);
    });
  }

  // How much the helper samples once a second: 0 nothing, 1 CPU/RAM/battery (the idle pulse),
  // 2 everything including GPU and network (the Glance tab). Level 2 costs more, so ask only when shown.
  setStats(level) {
    level = level === true ? 2 : +level || 0;
    if (level === (this.statsLevel || 0)) return;
    this.statsLevel = level;
    try { this.proc?.stdin.write(`stats ${level}\n`); } catch { /* helper restarting */ }
  }

  // Bring one of Petal's windows forward (Windows won't let a background app take focus on its own).
  focus(hwnd) {
    try { this.proc?.stdin.write(`focus ${hwnd}\n`); } catch { /* helper restarting */ }
  }

  stop() {
    this.stopping = true;
    this.proc?.kill();
  }
}

// "stats cpu=12.5 gpu=-1 ..." -> { cpu: 12.5, gpu: -1, ... }
function parseStats(line) {
  return Object.fromEntries(line.slice(6).trim().split(' ').map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
}

module.exports = { Hook, VK, ensureBuilt, parseStats, EXE };
