// Double-tap Ctrl opens Petal Ask. Read from the global key hook, so it never takes a shortcut away
// from any app (Ctrl+Space is autocomplete in every code editor and switches input languages).
// A tap is Ctrl pressed and released on its own, quickly; two taps close together fire.
// Ctrl+C, Ctrl held down, or any other key in between don't count.
const CTRL = 0x11;
const TAP_MS = 280;       // longest a single tap may be held
const GAP_MS = 380;       // longest pause between the two taps

function createDoubleTap(onFire, { now = () => Date.now() } = {}) {
  let downAt = 0, down = false, dirty = false, lastTap = 0;
  return {
    keydown(vk) {
      if (vk === CTRL) {
        if (down) return;                 // key repeat while held
        down = true; dirty = false; downAt = now();
        return;
      }
      dirty = true; lastTap = 0;          // Ctrl+something, or typing between taps
    },
    keyup(vk) {
      if (vk !== CTRL) return;
      const t = now();
      const tap = down && !dirty && t - downAt <= TAP_MS;
      down = false;
      if (!tap) { lastTap = 0; return; }
      if (lastTap && t - lastTap <= GAP_MS + TAP_MS) { lastTap = 0; onFire(); }
      else lastTap = t;
    },
    reset() { down = false; lastTap = 0; },
  };
}

module.exports = { createDoubleTap };
