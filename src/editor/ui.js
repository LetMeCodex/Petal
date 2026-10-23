// Small DOM builders shared by every editor mode.

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k !== null && k !== undefined));
  return n;
}

export const row = (label, ...kids) => el('div', { class: 'row' }, el('label', {}, label), el('div', {}, ...kids));
export const cols = (...kids) => el('div', { class: 'cols' }, ...kids);

// options: [{ value, label, icon?, title? }]
export function chips(options, value, onChange) {
  const box = el('div', { class: 'chips', role: 'group' });
  const buttons = options.map((o) => {
    const b = el('button', {
      class: `chip${o.icon && !o.label ? ' icon-only' : ''}`, type: 'button', title: o.title || o.label,
      'aria-label': o.title || o.label,
      onclick: () => { set(o.value); onChange(o.value); },
    });
    if (o.icon) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${o.icon}"/></svg>`;
    if (o.label) b.append(o.icon ? ` ${o.label}` : o.label);
    box.append(b);
    return b;
  });
  function set(v) { buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v))); }
  set(value);
  return { el: box, set };
}

// One-shot buttons styled like chips (rotate, flip, undo…).
export function actions(list) {
  return el('div', { class: 'chips' }, list.map((a) => {
    const b = el('button', { class: `chip${a.label ? '' : ' icon-only'}`, type: 'button', title: a.title, 'aria-label': a.title, onclick: a.onClick });
    if (a.icon) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${a.icon}"/></svg>`;
    if (a.label) b.append(a.icon ? ` ${a.label}` : a.label);
    return b;
  }));
}

export function slider({ min, max, step = 1, value, format = (v) => v }, onInput) {
  const out = el('output', {}, format(value));
  const input = el('input', { type: 'range', min, max, step, value });
  // The track fills with the petal gradient up to the thumb.
  const paint = () => input.style.setProperty('--fill', `${((+input.value - +input.min) / (+input.max - +input.min)) * 100}%`);
  input.addEventListener('input', () => { paint(); out.textContent = format(+input.value); onInput(+input.value); });
  paint();
  const box = el('div', { class: 'slider' }, input, out);
  return {
    el: box,
    set(v, newMax) { if (newMax !== undefined) input.max = newMax; input.value = v; out.textContent = format(v); paint(); },
  };
}

// items: [{ value, css, title }]; adds a native colour picker at the end when `custom` is set.
export function swatches(items, value, onChange, { round = false, custom = false } = {}) {
  const box = el('div', { class: 'swatches' });
  const all = [];
  for (const it of items) {
    const b = el('button', {
      class: `swatch${round ? ' round' : ''}`, type: 'button', title: it.title || it.value, 'aria-label': it.title || it.value,
      style: `background:${it.css}`, onclick: () => { set(it.value); onChange(it.value); },
    });
    all.push([it.value, b]);
    box.append(b);
  }
  if (custom) {
    const input = el('input', { type: 'color', value: '#ff5a2c', 'aria-label': 'Custom colour' });
    const b = el('label', { class: `swatch picker${round ? ' round' : ''}`, title: 'Custom colour' }, input);
    input.addEventListener('input', () => { set(null); b.setAttribute('aria-pressed', 'true'); onChange(input.value); });
    box.append(b);
    all.push([Symbol('custom'), b]);
  }
  function set(v) { all.forEach(([val, b]) => b.setAttribute('aria-pressed', String(val === v))); }
  set(value);
  return { el: box, set };
}

export function number({ value, min = 1, max = 100000, label }, onChange) {
  const input = el('input', { type: 'number', min, max, value, 'aria-label': label });
  input.addEventListener('change', () => {
    const v = Math.max(min, Math.min(+input.max, Math.round(+input.value || min)));
    input.value = v;
    onChange(v);
  });
  return { el: input, set(v) { if (document.activeElement !== input) input.value = Math.round(v); } };
}

export const ICONS = {
  rotL: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  rotR: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  flipH: 'M12 3v18M16 7l4 5-4 5M8 7l-4 5 4 5',
  flipV: 'M3 12h18M7 8l5-4 5 4M7 16l5 4 5-4',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  arrow: 'M5 19L19 5M9 5h10v10',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  blur: 'M12 3s7 7.6 7 12a7 7 0 0 1-14 0c0-4.4 7-12 7-12z',
  pixel: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  box: 'M4 6h16v12H4z',
};
