// Petal Ask: the island opens into a command bar. Type a question about your files, see exactly
// what would happen, act with one click, undo with one more.
// Views: suggestions → (searching) → results | duplicates | caches | space | action preview → cleared.
const ask = window.petal.ask;
const $ = (id) => document.getElementById(id);
const body = document.body;

const GB = 1024 ** 3, MB = 1024 ** 2;
const fmt = (b) => (b >= GB ? `${(b / GB).toFixed(b >= 10 * GB ? 1 : 2)} GB` : b >= MB ? `${Math.round(b / MB)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  if (!t) return '';
  const d = (Date.now() - t) / 864e5;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 14 ? `${Math.round(d)} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`;
};
const fileUrl = (p) => encodeURI(`file:///${p.replace(/\\/g, '/')}`).replace(/#/g, '%23');

// "Files over 300 MB in Downloads" + 6 -> "6 files over 300 MB in Downloads".
function countTitle(label, n) {
  const rest = label.replace(/^(Biggest|Latest(?: \d+)?) /, '');
  const m = rest.match(/^(\S+)(.*)$/);
  let noun = m[1].toLowerCase();
  if (n === 1) noun = noun.replace(/ies$/, 'y').replace(/s$/, '');
  return `${n} ${noun}${m[2]}`;
}

// File kinds → a tinted tile and a glyph.
const KIND = [
  ['image', /^(png|jpe?g|webp|gif|avif|heic|bmp|tiff?|svg|psd)$/, 330, 'M4 16l4-4 3 3 4-5 5 6M4 5h16v14H4zM9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0'],
  ['video', /^(mp4|mov|mkv|avi|webm|m4v|wmv|flv)$/, 268, 'M4 6h12v12H4zM16 10l4-2v8l-4-2'],
  ['audio', /^(mp3|wav|flac|m4a|aac|ogg|wma|aiff)$/, 160, 'M9 17V5l10-2v12M9 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0M19 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  ['archive', /^(zip|rar|7z|tar|gz|tgz|xz|bz2|cab|cpk)$/, 38, 'M5 4h14v16H5zM12 4v2m0 2v2m0 2v2M10 15h4v3h-4z'],
  ['installer', /^(exe|msi|msix|msixbundle|appx|iso|img|apk|dmg)$/, 208, 'M12 4v10m-4-4l4 4 4-4M5 18h14'],
  ['doc', /^(pdf|docx?|pptx?|xlsx?|txt|rtf|odt|csv|md)$/, 4, 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5'],
  ['folder', /^$/, 290, 'M3 6h6l2 2h10v11H3z'],
];
function kindOf(item) {
  if (item.files != null && !item.ext) return KIND[6];
  return KIND.find(([, re]) => re.test(item.ext || '')) || ['other', /./, 300, 'M7 3h7l4 4v14H7zM14 3v4h4'];
}
const tile = (item) => {
  const [, , hue, d] = kindOf(item);
  return `<span class="ftile" style="--hue:${hue}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg>${item.ext ? `<i>${esc(item.ext.slice(0, 4))}</i>` : ''}</span>`;
};
const SUGGEST_ICON = {
  size: 'M4 20V10M10 20V4M16 20v-7M22 20H2', compress: 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5', dupes: 'M8 8h12v12H8zM4 16V4h12',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18', installer: 'M12 4v10m-4-4l4 4 4-4M5 18h14', cutout: 'M6 6l12 12M6 18L18 6M4 4h4v4H4zM16 16h4v4h-4z',
  convert: 'M4 7h13l-3-3M20 17H7l3 3', box: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10', broom: 'M14 4l-4 9M6 13h8l2 7H4zM9 17v3M12 17v3',
  merge: 'M6 4v6a6 6 0 0 0 6 6h6M14 12l4 4-4 4', text: 'M5 6h14M12 6v13M9 19h6', pie: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z', video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
};
const HUES = { size: 330, compress: 300, dupes: 268, clock: 38, installer: 208, cutout: 330, convert: 160, box: 38, broom: 160, merge: 4, text: 208, pie: 268, video: 268 };

export function createAsk({ setState, startWork, finish, getState, gulp }) {
  const input = $('askInput');
  const view = $('askBody');
  let suggestions = [], picked = -1, queryId = 0, current = null, lastBatch = null, busy = false;

  // ---------- size: the drop follows its content ----------
  const panel = document.querySelector('.ask');
  // The window is always fully on screen, so the room left inside it is the room left on screen.
  const room = () => {
    const css = getComputedStyle(body);
    const gap = body.classList.contains('up') ? parseFloat(css.getPropertyValue('--dby')) : parseFloat(css.getPropertyValue('--dy'));
    return window.innerHeight - (gap || 0) - 14;
  };
  const fit = () => {
    const max = Math.min(560, room());
    body.style.setProperty('--ask-h', `${Math.min(max, Math.max(150, panel.scrollHeight))}px`);
    view.style.setProperty('--rows-max', `${Math.max(120, max - 230)}px`);
  };
  new ResizeObserver(fit).observe(panel);

  // ---------- open / close ----------
  ask.onOpen(({ context, suggestions: s, key }) => {
    suggestions = s || [];
    $('askKey').textContent = key || 'Ctrl Ctrl';
    $('askPillKey').textContent = key || 'Ctrl Ctrl';
    const ctx = $('askCtx');
    ctx.hidden = !context;
    if (context) { $('askCtxApp').textContent = context.app; $('askCtxDetail').textContent = context.detail ? ` · ${context.detail}` : ''; }
    if (getState() !== 'ask') { input.value = ''; showSuggestions(); }
    setState('ask');
    window.petal.island.wantBackdrop();   // frost what's behind, so text behind the panel doesn't show through
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
  ask.onClose(() => close());
  ask.onBlur(() => { if (!busy) close(); });
  function close() {
    if (getState() === 'ask') setState('idle');
    ask.closed();
  }
  $('askCtxX').addEventListener('click', () => { $('askCtx').hidden = true; });

  // ---------- typing ----------
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.ctrlKey && /^[1-3]$/.test(e.key) && suggestions[+e.key - 1]) { e.preventDefault(); pick(+e.key - 1); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && lastBatch && (!input.value || view.classList.contains('cleared'))) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && e.key === 'Delete') { const b = $('askRemoveAll') || $('askClean'); if (b) { e.preventDefault(); b.click(); } return; }
    if (!current && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
      e.preventDefault();
      picked = (picked + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1) + (picked < 0 && e.key === 'ArrowUp' ? 1 : 0)) % suggestions.length;
      view.querySelectorAll('.sugg').forEach((el, i) => el.classList.toggle('on', i === picked));
      return;
    }
    if (e.key === 'Enter' && !input.value.trim() && picked >= 0) { e.preventDefault(); pick(picked); }
  });
  document.addEventListener('keydown', (e) => {
    if (getState() !== 'ask' || e.target === input) return;
    if (e.key === 'Escape') close();
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && lastBatch) undo();
  });
  function pick(i) { input.value = suggestions[i].query; run(input.value); }

  // ---------- suggestions ----------
  function showSuggestions() {
    current = null; picked = -1;
    view.className = 'ask-body';
    view.innerHTML = suggestions.length ? `<div class="ask-sec mono">Suggested for this window</div>${suggestions.map((s, i) => `
      <button class="sugg" data-i="${i}" style="--i:${i};--hue:${HUES[s.icon] ?? 330}">
        <span class="stile"><svg viewBox="0 0 24 24"><path d="${SUGGEST_ICON[s.icon] || SUGGEST_ICON.size}"/></svg></span>
        <span class="stext"><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></span>
        <kbd>Ctrl ${i + 1}</kbd>
      </button>`).join('')}` : '';
    view.querySelectorAll('.sugg').forEach((el) => el.addEventListener('click', () => pick(+el.dataset.i)));
  }

  // ---------- asking ----------
  function run(text) {
    if (!text.trim()) return showSuggestions();
    const id = ++queryId;
    current = { id, text, started: performance.now() };
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">Thinking…</b><small class="ask-sub shimmer">Looking through your files</small></div></div><div class="rows" id="askRows"></div>`;
    ask.query(id, text);
  }
  ask.onEvent((ev) => {
    if (!current || ev.id !== current.id) return;          // an older question; ignore
    if (current.settled) return;                           // acted on already; late results mustn't redraw
    current.intent = ev.intent || current.intent;
    if (ev.type === 'plan') return plan(ev.intent);
    if (ev.type === 'status') { const s = view.querySelector('.ask-sub'); if (s) s.textContent = ev.text; return; }
    if (ev.type === 'error') return showError(ev.error);
    const intent = current.intent;
    if (!intent) return;
    if (intent.kind === 'unknown') return showUnknown();
    if (intent.kind === 'find') return showFiles(ev, intent);
    if (intent.kind === 'action') return ev.type === 'done' && showAction(ev, intent);
    if (intent.kind === 'duplicates' && ev.type === 'done') return showDupes(ev);
    if (intent.kind === 'caches' && ev.type === 'done') return showCaches(ev);
    if (intent.kind === 'space' && ev.type === 'done') return showSpace(ev);
  });
  function plan(intent) {
    const t = view.querySelector('.ask-title');
    if (t && intent.label) t.textContent = intent.label;
    const s = view.querySelector('.ask-sub');
    if (s) s.textContent = { find: 'Searching the index, then the disk', duplicates: 'Listing files', caches: 'Measuring caches', space: 'Measuring folders', action: 'Finding the files' }[intent.kind] || 'Working';
  }

  // ---------- files ----------
  function row(item, { trash = true } = {}) {
    const blocked = item.blocked ? `<span class="why">${esc(item.blocked)}</span>` : '';
    return `<div class="frow${item.blocked ? ' off' : ''}" data-id="${esc(item.id)}">
      ${tile(item)}
      <span class="ftext"><b title="${esc(item.path)}">${esc(item.name)}</b><small>${esc(item.where)}${item.mtime ? ` · ${ago(item.mtime)}` : ''}${item.files > 1 ? ` · ${item.files.toLocaleString()} files` : ''}</small>${blocked}</span>
      <span class="fsize mono">${fmt(item.onDisk ?? item.size)}</span>
      ${trash && !item.blocked ? `<button class="fbtn" data-trash="${esc(item.id)}" title="Move to Recycle Bin" aria-label="Move ${esc(item.name)} to Recycle Bin"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>` : '<span></span>'}
    </div>`;
  }
  function showFiles(ev, intent) {
    const items = (ev.items || []).filter((i) => !current.removed?.has(i.id));
    const final = ev.type === 'done';
    if (ev.ready) { current.ready = true; current.readyMs = ev.ms; }
    const actionable = final || !!current.ready;   // a real boolean: row()'s default would show trash buttons
    const ok = items.filter((i) => !i.blocked);
    const bytes = ok.reduce((s, i) => s + (i.onDisk ?? i.size), 0);
    current.items = items;
    const title = actionable ? (ok.length ? countTitle(intent.label, ok.length) : final ? 'Nothing found' : intent.label) : intent.label;
    const shownSecs = ((current.readyMs ?? (performance.now() - current.started)) / 1000).toFixed(1);
    const sub = final ? `${fmt(bytes)} total · found in ${shownSecs} s${ev.partial ? ' · some folders skipped for time' : ''}`
      : current.ready ? `${fmt(bytes)} total · found in ${shownSecs} s · still checking folders the index skips`
      : `${items.length} so far${ev.scanned ? ` · ${ev.scanned.toLocaleString()} files looked at` : ''}`;
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">${esc(title)}</b><small class="ask-sub${final ? '' : ' shimmer'}">${esc(sub)}</small></div>
      ${actionable && ok.length ? `<button class="ask-danger" id="askRemoveAll"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>${ok.length > 1 ? 'Remove all' : 'Remove'}<kbd class="on-dark">Ctrl Del</kbd></button>` : ''}</div>
      ${items.length ? `<div class="rows">${items.map((i) => row(i, { trash: actionable })).join('')}</div>` : final ? `<div class="ask-empty">${intent.filters?.minSize ? 'Nothing that big. Your files are lean.' : 'No files match that.'}</div>` : ''}`;
    if (!actionable) return;
    $('askRemoveAll')?.addEventListener('click', () => remove(ok));
    bindRowTrash(items);
  }
  function bindRowTrash(items, allow) {
    view.querySelectorAll('[data-trash]').forEach((b) => b.addEventListener('click', () => {
      const it = items.find((i) => i.id === b.dataset.trash);
      if (it) remove([it], allow, { single: true });
    }));
  }

  // ---------- removing: files tumble into the drop, then Undo ----------
  async function remove(items, allow = [], { single = false } = {}) {
    if (busy || !items.length) return;
    busy = true;
    if (!single && current) current.settled = true;
    // Gone from the list right away: a redraw from the still-running search mustn't bring it back.
    if (single && current) (current.removed ||= new Set()).add(items[0].id);
    const rows = items.map((i) => view.querySelector(`.frow[data-id="${CSS.escape(i.id)}"]`)).filter(Boolean);
    const flight = fly(rows);
    const res = await ask.trash(items.map((i) => ({ path: i.path, onDisk: i.onDisk ?? i.size, size: i.size })), allow);
    await flight;
    busy = false;
    if (single && res.moved.length && !res.failed.length) {
      // One file: just let its row go and keep the list (the row on screen now, after any redraw).
      view.querySelector(`.frow[data-id="${CSS.escape(items[0].id)}"]`)?.remove();
      current.items = current.items?.filter((i) => i.id !== items[0].id);
      lastBatch = res.batchId;
      toast(`${fmt(res.bytes)} moved to the Recycle Bin`, true);
      return;
    }
    if (single) {
      current?.removed?.delete(items[0].id);     // it stayed; show it again with the reason
      toast(`Left alone: ${res.failed[0]?.reason || 'couldn’t move it'}`, false);
      return;
    }
    showCleared(res);
  }
  // Each file icon lifts out of its row and tumbles up into the drop's bud.
  function fly(rows) {
    const bud = document.getElementById('bud').getBoundingClientRect();
    const tx = bud.left + bud.width / 2, ty = bud.top + bud.height / 2;
    const anims = rows.slice(0, 14).map((r, i) => {
      const src = r.querySelector('.ftile');
      const box = src.getBoundingClientRect();
      const ghost = src.cloneNode(true);
      ghost.classList.add('ghost');
      Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      document.body.append(ghost);
      src.style.visibility = 'hidden';
      r.classList.add('leaving');
      const dx = tx - (box.left + box.width / 2), dy = ty - (box.top + box.height / 2);
      const spin = (i % 2 ? 1 : -1) * (160 + i * 23);
      const a = ghost.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.35 + (i % 3 - 1) * 26}px, ${dy * 0.25 - 34}px) rotate(${spin * 0.4}deg) scale(1.08)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(0.18)`, opacity: 0.2 },
      ], { duration: 640, delay: i * 45, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' });
      return a.finished.then(() => ghost.remove());
    });
    if (rows.length) setTimeout(() => gulp?.(), 420);
    return Promise.all(anims);
  }
  function showCleared(res) {
    lastBatch = res.batchId || null;
    const n = res.moved.length;
    view.className = 'ask-body cleared';
    view.innerHTML = `<div class="done-row">
        <span class="check${n ? '' : ' warn'}"><svg viewBox="0 0 24 24"><path d="${n ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 7v6M12 17h.01'}"/></svg></span>
        <span class="dtext"><b>${n ? `${fmt(res.bytes)} cleaned up` : 'Nothing was moved'}</b>
          <small>${n ? `${n} ${n === 1 ? 'item' : 'items'} in the Recycle Bin, so Undo still works` : 'Every item was skipped'}</small></span>
        ${n ? '<span class="dacts"><button class="ask-soft" id="askUndo">Undo <kbd>Ctrl Z</kbd></button></span>' : ''}
      </div>
      ${n ? `<div class="free" id="askFree"><span>Windows gives the space back when the Recycle Bin is emptied.</span><button class="ask-link" id="askFreeBtn">Free ${fmt(res.bytes)} now</button></div>` : ''}`;
    $('askFreeBtn')?.addEventListener('click', () => {
      // Second step on purpose: this one can't be undone.
      $('askFree').innerHTML = `<span><b>Delete these ${n} for good?</b> Only what Petal just moved, nothing else in the bin.</span>
        <span class="dacts"><button class="ask-soft small" id="askFreeNo">Keep in bin</button><button class="ask-danger small" id="askFreeYes">Free ${fmt(res.bytes)}</button></span>`;
      $('askFree').classList.add('confirm');
      $('askFreeNo').addEventListener('click', () => showCleared(res));
      $('askFreeYes').addEventListener('click', () => purge(res));
    });
    view.insertAdjacentHTML('beforeend', res.failed.length ? `<div class="skipped"><div class="ask-sec mono">Left alone</div>${res.failed.slice(0, 4).map((f) => `<div class="srow"><b>${esc(f.path.split(/[\\/]/).pop())}</b><small>${esc(f.reason)}</small></div>`).join('')}${res.failed.length > 4 ? `<small class="more">and ${res.failed.length - 4} more</small>` : ''}</div>` : '');
    $('askUndo')?.addEventListener('click', undo);
  }
  async function purge(res) {
    if (busy || !lastBatch) return;
    busy = true;
    const r = await ask.purge(lastBatch);
    busy = false;
    lastBatch = null;
    view.className = 'ask-body cleared';
    view.innerHTML = `<div class="done-row"><span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="dtext"><b>${r.error ? 'Couldn’t free it' : `${fmt(r.bytes)} freed`}</b><small>${esc(r.error || (r.failed?.length ? `${r.failed.length} still in the Recycle Bin` : 'The space is yours again'))}</small></span></div>`;
  }
  async function undo() {
    if (!lastBatch || busy) return;
    busy = true;
    const res = await ask.undo(lastBatch);
    busy = false;
    lastBatch = null;
    view.className = 'ask-body cleared';
    view.innerHTML = `<div class="done-row"><span class="check back"><svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-2"/></svg></span>
      <span class="dtext"><b>${res.error ? 'Couldn\'t undo' : `Put back ${res.restored.length} ${res.restored.length === 1 ? 'item' : 'items'}`}</b>
      <small>${esc(res.error || (res.failed?.length ? `${res.failed.length} couldn't come back: ${res.failed[0].err}` : 'Right where they were'))}</small></span></div>`;
  }
  function toast(text, canUndo) {
    view.querySelector('.ask-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'ask-toast';
    t.innerHTML = `<span>${esc(text)}</span>${canUndo ? '<button class="ask-soft small">Undo</button>' : ''}`;
    t.querySelector('button')?.addEventListener('click', undo);
    view.append(t);
    setTimeout(() => t.classList.add('gone'), 4000);
  }

  // ---------- duplicates ----------
  function showDupes(ev) {
    const groups = ev.groups || [];
    const copies = groups.flatMap((g) => g.copies);
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">${groups.length ? `${copies.length} duplicate ${copies.length === 1 ? 'copy' : 'copies'}` : 'No duplicates'}</b>
      <small class="ask-sub">${groups.length ? `${fmt(ev.bytes)} you can get back · byte-for-byte identical` : 'Every file here is one of a kind'}</small></div>
      ${copies.length ? '<button class="ask-danger" id="askRemoveAll">Remove copies</button>' : ''}</div>
      <div class="rows">${groups.slice(0, 40).map((g) => `<div class="dgroup">${row({ ...g.keep, blocked: null }, { trash: false }).replace('class="frow"', 'class="frow keep"').replace('<span class="fsize', '<span class="badge">keep</span><span class="fsize')}${g.copies.map((c) => row(c)).join('')}</div>`).join('')}</div>`;
    $('askRemoveAll')?.addEventListener('click', () => remove(copies));
    bindRowTrash(copies);
  }

  // ---------- caches ----------
  function showCaches(ev) {
    const cats = ev.categories || [];
    const on = new Set(cats.map((c) => c.id));
    const total = () => cats.filter((c) => on.has(c.id)).reduce((s, c) => s + c.bytes, 0);
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">${cats.length ? `${fmt(ev.bytes)} of caches and junk` : 'Already clean'}</b>
      <small class="ask-sub">${cats.length ? 'Only things that rebuild themselves or nobody needs back' : 'No caches or leftovers worth clearing'}</small></div>
      ${cats.length ? `<button class="ask-danger" id="askClean">Clean · <span id="askCleanSize">${fmt(total())}</span></button>` : ''}</div>
      <div class="rows">${cats.map((c, i) => `<label class="cat" style="--i:${i}">
        <button class="sw" role="switch" aria-checked="true" data-cat="${c.id}"><i></i></button>
        <span class="ctext"><b>${esc(c.title)}</b><small>${esc(c.why)}</small><small class="cmeta">${c.items.length} ${c.items.length === 1 ? 'item' : 'items'}</small></span>
        <span class="fsize mono">${fmt(c.bytes)}</span></label>`).join('')}</div>`;
    view.querySelectorAll('.cat .sw').forEach((sw) => sw.addEventListener('click', (e) => {
      e.preventDefault();
      const id = sw.dataset.cat;
      if (on.has(id)) on.delete(id); else on.add(id);
      sw.setAttribute('aria-checked', String(on.has(id)));
      $('askCleanSize').textContent = fmt(total());
    }));
    $('askClean')?.addEventListener('click', () => {
      const chosen = cats.filter((c) => on.has(c.id));
      busy = true;
      const rows = [...view.querySelectorAll('.cat')].filter((el) => on.has(el.querySelector('.sw').dataset.cat));
      rows.forEach((r) => { r.classList.add('frow'); if (!r.querySelector('.ftile')) r.insertAdjacentHTML('afterbegin', tile({ ext: '', files: 1 })); r.querySelector('.ftile').classList.add('mini'); });
      const flight = fly(rows);
      ask.trash(chosen.flatMap((c) => c.items.map((i) => ({ path: i.path, onDisk: i.size, size: i.size }))), chosen.flatMap((c) => c.allow || []))
        .then(async (res) => { await flight; busy = false; showCleared(res); });
    });
  }

  // ---------- what's taking space ----------
  function showSpace(ev) {
    const max = Math.max(1, ...ev.folders.map((f) => f.bytes));
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">Where your space went</b><small class="ask-sub">Measured just now · tap a folder to see inside</small></div></div>
      <div class="drives">${ev.drives.map((d) => `<div class="drive"><span class="mono">${esc(d.drive.replace('\\', ''))}</span><span class="dbar"><i style="--f:${((d.total - d.free) / d.total).toFixed(3)}"></i></span><span class="mono">${fmt(d.free)} free of ${fmt(d.total)}</span></div>`).join('')}</div>
      <div class="rows">${ev.folders.map((f, i) => `<button class="frow fold" data-path="${esc(f.path)}" style="--i:${i}">${tile({ ext: '', files: 1 })}<span class="ftext"><b>${esc(f.name)}</b><span class="bar"><i style="--f:${(f.bytes / max).toFixed(3)}"></i></span></span><span class="fsize mono">${fmt(f.bytes)}${f.partial ? '+' : ''}</span><span></span></button>`).join('')}
      ${ev.items.length ? `<div class="ask-sec mono">Biggest files</div>${ev.items.map((i) => row(i)).join('')}` : ''}</div>`;
    view.querySelectorAll('.fold').forEach((b) => b.addEventListener('click', () => { input.value = `biggest files in "${b.dataset.path}"`; run(input.value); }));
    current.items = ev.items;
    bindRowTrash(ev.items);
  }

  // ---------- Petal actions in words ----------
  const VERB = { compress: 'Compress', convert: 'Convert', removebg: 'Remove background from', merge: 'Merge', ocr: 'Copy text from', metadata: 'Clean metadata of' };
  function showAction(ev, intent) {
    const items = ev.items || [];
    const { id, to } = intent.action;
    const n = items.length;
    const enough = id === 'merge' ? n >= 2 : n >= 1;
    const noun = id === 'merge' ? 'files' : n === 1 ? 'image' : 'images';
    const verb = `${VERB[id]}${id === 'convert' ? '' : ''}`;
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">${esc(intent.label)}</b><small class="ask-sub">${n ? `${n} ${noun} · ${fmt(ev.bytes || 0)} · originals stay as they are` : 'Couldn\'t find any'}</small></div>
      ${enough ? `<button class="ask-primary" id="askDo">${esc(verb)} ${n} ${noun}${id === 'convert' ? ` to ${to.toUpperCase()}` : id === 'merge' ? ' into a PDF' : ''}</button>` : ''}</div>
      ${n ? `<div class="thumbs">${items.slice(0, 7).map((i, k) => `<span class="th" style="--i:${k}">${/^(png|jpe?g|webp|gif|avif|bmp)$/.test(i.ext) ? `<img src="${fileUrl(i.path)}" alt="" loading="lazy">` : tile(i)}</span>`).join('')}${n > 7 ? `<span class="th more">+${n - 7}</span>` : ''}</div>
      <div class="rows">${items.map((i) => row(i, { trash: false }).replace('<span></span>', `<button class="fbtn" data-skip="${esc(i.id)}" title="Leave this one out"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`)).join('')}</div>`
        : `<div class="ask-empty">${id === 'merge' && n === 1 ? 'Merging needs at least two files.' : 'Nothing matched. Try naming the folder, like “in Downloads”.'}</div>`}`;
    let chosen = [...items];
    view.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', () => {
      chosen = chosen.filter((i) => i.id !== b.dataset.skip);
      b.closest('.frow').classList.add('leaving');
      setTimeout(() => b.closest('.frow').remove(), 260);
      const btn = $('askDo');
      if (btn) { btn.textContent = `${verb} ${chosen.length} ${id === 'merge' ? 'files' : chosen.length === 1 ? 'image' : 'images'}${id === 'convert' ? ` to ${to.toUpperCase()}` : id === 'merge' ? ' into a PDF' : ''}`; btn.disabled = id === 'merge' ? chosen.length < 2 : !chosen.length; }
    }));
    $('askDo')?.addEventListener('click', async () => {
      const paths = chosen.map((i) => i.path);
      ask.closed();
      startWork({ compress: 'Compressing', convert: `Converting to ${String(to).toUpperCase()}`, removebg: 'Removing background', merge: 'Merging into PDF', ocr: 'Reading text', metadata: 'Cleaning metadata' }[id], paths.length > 1 ? `${paths.length} files` : paths[0].split(/[\\/]/).pop());
      const res = await window.petal.run(id, paths, id === 'convert' ? { to } : undefined);
      finish(id, res);
    });
  }

  // ---------- nothing understood / errors ----------
  function showUnknown() {
    const tries = ['files over 1 GB', 'duplicate photos', 'clean up junk', 'compress images in Downloads', 'what is taking space'];
    view.className = 'ask-body';
    view.innerHTML = `<div class="ask-head"><div><b class="ask-title">Not sure what to do with that</b><small class="ask-sub">Petal answers questions about your files. Try one of these:</small></div></div>
      <div class="chips">${tries.map((t) => `<button class="chip">${esc(t)}</button>`).join('')}</div>`;
    view.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { input.value = c.textContent; run(input.value); }));
  }
  function showError(msg) {
    view.className = 'ask-body';
    view.innerHTML = `<div class="done-row"><span class="check warn"><svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg></span><span class="dtext"><b>${esc(msg)}</b><small>Nothing was changed</small></span></div>`;
  }

  // Test hooks (scripts/ask-ui-test.js).
  return { run, showSuggestions, get view() { return view; }, get current() { return current; }, get lastBatch() { return lastBatch; }, get busy() { return busy; } };
}
