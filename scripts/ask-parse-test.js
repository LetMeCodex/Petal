// The Ask parser on the kinds of things people type, English and Hinglish.
// Run: node scripts/ask-parse-test.js
const { parse, MB, GB } = require('../src/ask/parse');

const has = (arr, x) => Array.isArray(arr) && arr.includes(x);
const cases = [
  ['Show me huge files that are more than 300MB', (p) => p.kind === 'find' && p.filters.minSize === 300 * MB && p.label === 'Files over 300 MB'],
  ['300mb se badi files dikhao', (p) => p.kind === 'find' && p.filters.minSize === 300 * MB],
  ['downloads mein 2gb se badi files', (p) => p.kind === 'find' && p.filters.minSize === 2 * GB && p.filters.places?.[0].key === 'downloads'],
  ['videos over 1gb in downloads', (p) => p.kind === 'find' && p.filters.minSize === GB && has(p.filters.exts, '.mp4') && p.filters.places[0].key === 'downloads'],
  ['old installers in Downloads', (p) => p.kind === 'find' && has(p.filters.exts, '.exe') && p.filters.before > 0],
  ['zip files older than 3 months', (p) => p.kind === 'find' && has(p.filters.exts, '.zip') && Math.abs(Date.now() - p.filters.before - 90 * 864e5) < 1e5],
  ['files from the last 7 days on desktop', (p) => p.kind === 'find' && p.filters.after > 0 && p.filters.places[0].key === 'desktop'],
  ['biggest files on D drive', (p) => p.kind === 'find' && p.filters.top === 25 && p.label === 'Biggest files in D:\\' && p.filters.places[0].path === 'D:\\'],
  ['files under 1mb in C:\\temp\\x', (p) => p.kind === 'find' && p.filters.maxSize === MB && p.filters.places[0].path === 'C:\\temp\\x'],
  ['find duplicate photos', (p) => p.kind === 'duplicates' && has(p.filters.exts, '.jpg')],
  ['duplicate files', (p) => p.kind === 'duplicates' && !p.filters.exts],
  ['clean up junk', (p) => p.kind === 'caches'],
  ['caches saaf karo', (p) => p.kind === 'caches'],
  ['old node_modules', (p) => p.kind === 'caches' && has(p.only, 'node_modules')],
  ['what is taking space', (p) => p.kind === 'space'],
  ['disk full ho gayi', (p) => p.kind === 'space'],
  ['compress all images in Downloads', (p) => p.kind === 'action' && p.action.id === 'compress' && p.filters.places[0].key === 'downloads'],
  ['convert latest screenshots to webp', (p) => p.kind === 'action' && p.action.id === 'convert' && p.action.to === 'webp' && p.filters.screenshots && p.filters.latest === 20],
  ['remove background from the latest screenshot', (p) => p.kind === 'action' && p.action.id === 'removebg' && p.filters.latest === 1 && p.filters.screenshots],
  ['latest screenshot ka bg hatao', (p) => p.kind === 'action' && p.action.id === 'removebg' && p.filters.latest === 1],
  ['merge invoices into one pdf', (p) => p.kind === 'action' && p.action.id === 'merge' && p.filters.name === 'invoice'],
  ['copy text from latest screenshot', (p) => p.kind === 'action' && p.action.id === 'ocr' && p.filters.latest === 1],
  ['strip location from photos here', (p) => p.kind === 'action' && p.action.id === 'metadata' && p.filters.places[0].key === 'here'],
  ['make these png into jpg', (p) => p.kind === 'action' && p.action.id === 'convert' && p.action.to === 'jpg' && p.filters.exts.join() === '.png'],
  ['hello there', (p) => p.kind === 'unknown'],
  ['write me a poem about rain', (p) => p.kind === 'unknown'],
];

let fails = 0;
for (const [q, ok] of cases) {
  const p = parse(q);
  const pass = (() => { try { return !!ok(p); } catch { return false; } })();
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${q.padEnd(46)} -> ${p.kind}${p.label ? ` · ${p.label}` : ''}${pass ? '' : `  ${JSON.stringify(p)}`}`);
}
console.log(fails ? `\nFAILED: ${fails}` : '\nALL OK');
process.exit(fails ? 1 : 0);
