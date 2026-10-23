// Petal Ask: turns a typed request into a plan, on the device, instantly. English and Hinglish.
// Covers the common asks (size, age, place, file kind, duplicates, junk, Petal actions); anything
// it can't read comes back as { kind: 'unknown' } for the optional AI fallback.
//
//   parse('show me huge files that are more than 300MB')
//   -> { kind: 'find', filters: { minSize: 314572800 }, label: 'Files over 300 MB' }

const MB = 1024 * 1024, GB = 1024 * MB;
const DAY = 24 * 60 * 60 * 1000;

const KINDS = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.heic', '.bmp', '.tif', '.tiff', '.svg', '.psd'],
  video: ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv'],
  audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.aiff'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.xz', '.bz2', '.cab'],
  installer: ['.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.iso', '.img'],
  pdf: ['.pdf'],
  document: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.rtf', '.odt', '.csv', '.md'],
};
const KIND_WORDS = [
  [/\b(images?|photos?|pics?|pictures?|imgs?|tasveer\w*|wallpapers?)\b/, 'image'],
  [/\bscreenshots?\b|\bss\b/, 'screenshot'],
  [/\b(videos?|movies?|clips?|recordings?|films?)\b/, 'video'],
  [/\b(music|songs?|audio|gaane|tracks?)\b/, 'audio'],
  [/\b(zips?|archives?|compressed files?|rars?)\b/, 'archive'],
  [/\b(installers?|setups?|setup files?|isos?|exes?|msis?)\b/, 'installer'],
  [/\bpdfs?\b/, 'pdf'],
  [/\b(documents?|docs?|word files?|excel files?|presentations?)\b/, 'document'],
];
const KIND_NAMES = { image: 'Images', screenshot: 'Screenshots', video: 'Videos', audio: 'Audio', archive: 'Archives', installer: 'Installers', pdf: 'PDFs', document: 'Documents' };

const PLACES = [
  [/\bdownloads?\b/, 'downloads', 'Downloads'],
  [/\bdesktop\b/, 'desktop', 'Desktop'],
  [/\bdocuments folder\b|\bmy documents\b|\bin documents\b/, 'documents', 'Documents'],
  [/\bpictures folder\b|\bin pictures\b|\bmy pictures\b/, 'pictures', 'Pictures'],
  [/\bvideos folder\b|\bin videos\b|\bmy videos\b/, 'videos', 'Videos'],
  [/\bmusic folder\b|\bin music\b|\bmy music\b/, 'music', 'Music'],
  [/\b(this folder|here|is folder|isme|iss? folder|current folder|yahan|yaha)\b/, 'here', 'this folder'],
];

const ACTIONS = [
  [/\b(compress|shrink|optimi[sz]e|make (them |it )?smaller|chhot[aie]|size kam)\b/, 'compress'],
  [/\b(remove|erase|cut ?out|hata\w*|nikal\w*)\b[^.]*\b(background|bg)\b|\b(background|bg) (remove|hata\w*)\b|\bcutouts?\b/, 'removebg'],
  [/\b(convert|change|turn|badal\w*|bana\w*|make)\b[^.]*\b(to|into|in|mein|me|as)\s+(webp|png|jpe?g|avif|gif|tiff?)\b|\bto (webp|png|jpe?g|avif)\b/, 'convert'],
  [/\b(merge|combine|join|jod\w*)\b|\b(into|in|ek) (one |a |single )?pdf\b/, 'merge'],
  [/\b(copy|extract|grab|read|nikal\w*)\b[^.]*\btext\b|\bocr\b/, 'ocr'],
  [/\b(strip|remove|clean|hata\w*)\b[^.]*\b(metadata|exif|location|gps)\b/, 'metadata'],
];
const ACTION_NAMES = { compress: 'Compress', removebg: 'Remove background', convert: 'Convert', merge: 'Merge into PDF', ocr: 'Copy text', metadata: 'Clean metadata' };

const UNIT = { b: 1, k: 1024, kb: 1024, m: MB, mb: MB, g: GB, gb: GB, t: 1024 * GB, tb: 1024 * GB };
const fmtSize = (b) => (b >= GB ? `${+(b / GB).toFixed(b % GB ? 1 : 0)} GB` : `${Math.round(b / MB)} MB`);

function parseSize(t) {
  // "more than 300MB", "300 mb se badi", "under 2gb", "> 1 GB", "between 100mb and 1gb"
  const between = t.match(/between\s+(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|[tgmk])\b\s*(?:and|-|to)\s*(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|[tgmk])\b/);
  if (between) return { minSize: +between[1] * UNIT[between[2]], maxSize: +between[3] * UNIT[between[4]] };
  const m = t.match(/(more than|over|above|bigger than|larger than|greater than|at least|>=?|under|below|less than|smaller than|<=?|upto|up to)?\s*(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|[tgmk])\b\s*(se (?:badi|bade|zyada|jyada|upar|kam|chhot\w*)|or (?:more|bigger|larger|less|smaller)|\+)?/);
  if (!m) return null;
  const bytes = +m[2] * UNIT[m[3]];
  const word = `${m[1] || ''} ${m[4] || ''}`;
  if (/under|below|less|smaller|<|up ?to|kam|chhot/.test(word)) return { maxSize: bytes };
  return { minSize: bytes };
}

function parseAge(t, now) {
  const units = { day: 1, days: 1, din: 1, week: 7, weeks: 7, hafte: 7, hafta: 7, month: 30, months: 30, mahine: 30, mahina: 30, year: 365, years: 365, saal: 365 };
  const unitRe = '(days?|din|weeks?|hafte|hafta|months?|mahine|mahina|years?|saal)';
  let m = t.match(new RegExp(`(older than|more than|over|not (?:used|opened|touched) (?:in|for)|untouched for)\\s*(\\d+|a|an|one)\\s*${unitRe}`)) ||
          t.match(new RegExp(`(\\d+|a|an|one)\\s*${unitRe}\\s*(?:old|se purani|se purane|purani|purane|ago or (?:more|older))`));
  if (m) {
    const nStr = m.length === 4 ? m[2] : m[1], unit = m.length === 4 ? m[3] : m[2];
    const n = /^\d+$/.test(nStr) ? +nStr : 1;
    return { before: now - n * units[unit] * DAY, ageLabel: `older than ${n} ${unit.replace(/s?$/, n === 1 ? '' : 's').replace(/^(din|hafte|hafta|mahine|mahina|saal)s?$/, (w) => w)}` };
  }
  m = t.match(new RegExp(`(?:last|past|pichle|in the last|within)\\s*(\\d+)?\\s*${unitRe}`));
  if (m) {
    const n = m[1] ? +m[1] : 1;
    return { after: now - n * units[m[2]] * DAY, ageLabel: `from the last ${n === 1 ? '' : `${n} `}${m[2].replace(/s$/, '')}${n === 1 ? '' : 's'}` };
  }
  if (/\btoday\b|\baaj\b/.test(t)) { const d = new Date(now); d.setHours(0, 0, 0, 0); return { after: +d, ageLabel: 'from today' }; }
  if (/\byesterday\b|\bkal\b/.test(t)) { const d = new Date(now); d.setHours(0, 0, 0, 0); return { after: +d - DAY, ageLabel: 'since yesterday' }; }
  if (/\bthis week\b|\bis hafte\b/.test(t)) return { after: now - 7 * DAY, ageLabel: 'from this week' };
  if (/\b(old|purani|purane|stale|unused)\b/.test(t)) return /\b(installers?|setups?|exes?|msis?|isos?)\b/.test(t) ? { before: now - 30 * DAY, ageLabel: 'older than a month' } : { before: now - 180 * DAY, ageLabel: 'older than 6 months' };
  return null;
}

// "latest screenshot", "last 5 photos", "newest 3 pdfs"
function parseLatest(t) {
  const m = t.match(/\b(latest|last|newest|recent|most recent|naye|nayi|aakhri)\s*(\d+)?\s*(screenshots?|images?|photos?|pics?|pdfs?|files?|videos?)?/);
  if (!m || (!m[2] && !m[3] && !/latest|newest|recent/.test(m[1]))) return null;
  if (/\blast\s+\d*\s*(days?|weeks?|months?|years?)/.test(t)) return null;   // "last 30 days" is an age, not a count
  const plural = m[3] && /s$/.test(m[3]);
  return m[2] ? +m[2] : plural ? 20 : 1;
}

function parsePaths(t, raw) {
  const out = [];
  for (const m of raw.matchAll(/"([a-zA-Z]:\\[^"]+)"|\b([a-zA-Z]:\\[^\s,;]*)/g)) out.push((m[1] || m[2]).replace(/\\$/, '') || `${m[2]}`);
  for (const m of t.matchAll(/\b([d-z])\s*(?:drive|:)(?=\s|$)/g)) out.push(`${m[1].toUpperCase()}:\\`);
  return out;
}

function parse(raw, { now = Date.now() } = {}) {
  const text = String(raw || '').trim();
  const t = ` ${text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ')} `;
  if (!text) return { kind: 'empty' };

  const filters = {};
  const size = parseSize(t);
  if (size) Object.assign(filters, size);
  const age = parseAge(t, now);
  if (age) Object.assign(filters, age);
  const latest = parseLatest(t);
  if (latest) { filters.latest = latest; filters.sort = 'date'; }

  const kinds = new Set();
  for (const [re, k] of KIND_WORDS) if (re.test(t)) kinds.add(k);
  const extWords = [...t.matchAll(/(?:\.|\b)(psd|ai|sketch|fig|blend|raw|cr2|nef|dng|mkv|mp4|mov|wav|flac|mp3|zip|rar|7z|iso|exe|msi|apk|dmg|pdf|png|jpe?g|webp|gif|heic|docx?|pptx?|xlsx?|csv|cpk)\s*(?:files?)?\b/g)].map((m) => `.${m[1]}`);
  if (kinds.has('screenshot')) { kinds.delete('screenshot'); kinds.add('image'); filters.screenshots = true; }
  const exts = new Set(extWords.filter((e) => !(e === '.pdf' && kinds.has('pdf'))));
  for (const k of kinds) for (const e of KINDS[k]) exts.add(e);
  if (exts.size) filters.exts = [...exts];

  const places = [];
  for (const [re, key, name] of PLACES) if (re.test(t)) places.push({ key, name });
  for (const p of parsePaths(t, text)) places.push({ key: 'path', path: p, name: p });
  if (places.length) filters.places = places;

  const kindLabel = filters.screenshots ? 'Screenshots' : kinds.size === 1 ? KIND_NAMES[[...kinds][0]] : exts.size && exts.size <= 3 ? [...exts].map((e) => e.slice(1).toUpperCase()).join(', ') + ' files' : 'Files';
  const placeLabel = places.length ? ` ${places[0].key === 'desktop' ? 'on' : 'in'} ${places.map((p) => p.name).join(' and ')}` : '';

  // ---- what kind of request ----
  if (/\b(duplicates?|dupes?|same files?|identical|copies of|duplicate copies|ek jaisi|ek jaise|double files?)\b/.test(t)) {
    return { kind: 'duplicates', filters, label: `Duplicate ${kindLabel === 'Files' ? 'files' : kindLabel.toLowerCase()}${placeLabel}` };
  }
  if (/\b(node[_ ]?modules)\b/.test(t)) return { kind: 'caches', only: ['node_modules'], filters, label: 'Old node_modules folders' };
  if (/\b(cache|caches|junk|temp|temporary|kachra|faltu|leftovers?|crash dumps?|clean ?up|cleanup|safai|saaf)\b/.test(t) && !kinds.size && !size) {
    return { kind: 'caches', filters, label: 'Caches and junk' };
  }
  if (/\b(what|whats|kya|kaun|where)\b.*\b(space|storage|disk|jagah)\b|\b(disk|storage|space|jagah)\b.*\b(full|kha|eating|taking|bhar|gayi|gaya|used)\b|\bfree (up )?(some )?space\b|\bspace (bachao|khali)\b/.test(t)) {
    return { kind: 'space', filters, label: 'What is taking space' };
  }

  for (const [re, id] of ACTIONS) {
    const m = t.match(re);
    if (!m) continue;
    const action = { id };
    if (id === 'convert') {
      action.to = ((m[3] || m[4]) || 'webp').replace('jpeg', 'jpg');
      // "png into jpg": the target isn't a source.
      const target = action.to === 'jpg' ? ['.jpg', '.jpeg'] : [`.${action.to}`];
      if (filters.exts) filters.exts = filters.exts.filter((e) => !target.includes(e));
      if (filters.exts && !filters.exts.length) delete filters.exts;
    }
    // "merge invoices into one pdf": the PDF is the result, not the input, and a word naming the
    // files ("invoices") becomes a name filter.
    if (id === 'merge') {
      if (filters.exts?.join() === '.pdf' && /\b(into|in|ek|as)\s+(?:one |a |single |ek )?pdf\b/.test(t) && !/\bpdfs\b/.test(t)) delete filters.exts;
      const named = t.match(/\b(?:merge|combine|join)\s+(?:all\s+|my\s+|the\s+)?([a-z]{3,})\b/);
      if (named && !/^(all|these|this|them|files?|images?|photos?|pdfs?|screenshots?|pics?)$/.test(named[1])) filters.name = named[1].replace(/ies$/, 'y').replace(/s$/, '');
    }
    if (!filters.exts) filters.exts = id === 'merge' ? [...KINDS.image, '.pdf'] : KINDS.image.filter((e) => e !== '.svg' && e !== '.psd');
    if (!filters.latest && !filters.after && !filters.before) filters.sort = 'date';
    const srcLabel = filters.screenshots ? 'Screenshots' : extWords.length ? filters.exts.map((e) => e.slice(1).toUpperCase()).join(', ') + ' files' : kindLabel;
    const what = id === 'merge' ? (filters.name ? `"${filters.name}" files` : filters.exts.join() === '.pdf' ? 'PDFs' : 'images and PDFs') : filters.latest === 1 ? `latest ${srcLabel === 'Files' ? 'image' : srcLabel.replace(/s$/, '').toLowerCase()}` : srcLabel === 'Files' ? 'images' : srcLabel.replace(/^Screenshots$/, 'screenshots').replace(/^Images$/, 'images');
    return { kind: 'action', action, filters, label: `${ACTION_NAMES[id]}${id === 'convert' ? ` to ${action.to.toUpperCase()}` : ''} · ${what}${placeLabel}` };
  }

  const wantsFiles = /\b(files?|show|find|list|dikha\w*|dhoond\w*|kaun|which|where|big|bigger|biggest|huge|large|largest|heavy|badi|bade|bhari|delete|remove|trash|hata\w*|clear|old|purani)\b/.test(t) || size || age || exts.size || places.length;
  if (wantsFiles) {
    if (!filters.minSize && !filters.maxSize && /\b(biggest|largest|sabse badi|sabse bade)\b/.test(t)) { filters.top = 25; filters.sort = 'size'; }
    else if (!filters.minSize && !filters.maxSize && /\b(huge|heavy|bhari|bahut badi)\b/.test(t)) filters.minSize = 500 * MB;
    else if (!filters.minSize && !filters.maxSize && /\b(big|bigger|large|badi|bade)\b/.test(t)) filters.minSize = 100 * MB;
    const parts = [kindLabel];
    if (filters.minSize && filters.maxSize) parts.push(`between ${fmtSize(filters.minSize)} and ${fmtSize(filters.maxSize)}`);
    else if (filters.minSize) parts.push(`over ${fmtSize(filters.minSize)}`);
    else if (filters.maxSize) parts.push(`under ${fmtSize(filters.maxSize)}`);
    if (filters.ageLabel) parts.push(filters.ageLabel);
    if (filters.latest) parts.unshift(filters.latest === 1 ? 'Latest' : `Latest ${filters.latest}`);
    if (filters.top) parts[0] = `Biggest ${parts[0].toLowerCase()}`;
    if (!filters.sort) filters.sort = filters.minSize || !filters.after ? 'size' : 'date';
    return { kind: 'find', filters, label: parts.join(' ').replace(/^Latest (\d+ )?Files/, (s) => s) + placeLabel };
  }
  return { kind: 'unknown', text };
}

module.exports = { parse, KINDS, fmtSize, MB, GB, DAY };
