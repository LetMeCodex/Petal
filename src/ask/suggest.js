// Three suggestions for whatever window you were in when you called Petal.
// Input: the foreground window from fs.exe ({ exe, title, folder }). Each suggestion is a query the
// parser understands, so picking one is the same as typing it.
const path = require('path');

const APPS = [
  [/\\explorer\.exe$/i, 'explorer'],
  [/\\(chrome|msedge|firefox|opera|brave|vivaldi|arc|zen)\.exe$/i, 'browser'],
  [/\\(figma|photoshop|illustrator|afterfx|canva|affinity\w*|gimp\w*|krita|lightroom\w*|paint\w*|snippingtool|screenclippinghost)\.exe$/i, 'design'],
  [/\\(code|cursor|windsurf|devenv|idea64|webstorm64|pycharm64|rider64|studio64|sublime_text|zed)\.exe$/i, 'code'],
  [/\\(winword|excel|powerpnt|acrobat|acrord32|sumatrapdf|onenote|notion)\.exe$/i, 'office'],
  [/\\(steam|epicgameslauncher|eadesktop|battle\.net|riotclientservices|xboxpcapp)\.exe$/i, 'games'],
  [/\\(whatsapp\w*|telegram|discord|slack|teams|ms-teams)\.exe$/i, 'chat'],
];

function appOf(exe) {
  for (const [re, kind] of APPS) if (exe && re.test(exe)) return kind;
  return 'other';
}

// "Google Chrome", "File Explorer · Downloads": what the context chip says.
function contextLabel(fg) {
  if (!fg) return null;
  const kind = appOf(fg.exe);
  if (kind === 'explorer' && fg.folder) return { app: 'File Explorer', detail: path.basename(fg.folder) || fg.folder, folder: fg.folder };
  if (kind === 'explorer') return null;   // the desktop or taskbar: nothing to "see"
  const name = fg.exe ? path.basename(fg.exe, '.exe') : '';
  const pretty = { msedge: 'Edge', chrome: 'Chrome', code: 'VS Code', winword: 'Word', powerpnt: 'PowerPoint', excel: 'Excel', afterfx: 'After Effects', whatsapp: 'WhatsApp' }[name.toLowerCase()] || name.replace(/^\w/, (c) => c.toUpperCase());
  return name ? { app: pretty, detail: (fg.title || '').split(' - ')[0].slice(0, 40) } : null;
}

function suggest(fg) {
  const kind = appOf(fg?.exe);
  const s = (icon, title, sub, query) => ({ icon, title, sub, query });
  if (kind === 'explorer' && fg.folder) {
    const name = path.basename(fg.folder) || fg.folder;
    const pics = /pictures|photos|screenshots|camera|images|wallpapers/i.test(fg.folder);
    return [
      s('size', `Biggest files in ${name}`, 'Sorted by size, with what\'s safe to remove', 'biggest files here'),
      pics ? s('compress', `Compress the images in ${name}`, 'Smaller files, same look, saved as copies', 'compress images here')
        : s('dupes', `Duplicates in ${name}`, 'Byte-for-byte identical copies', 'duplicate files here'),
      s('clock', `Untouched for 6 months in ${name}`, 'Old files you may not need', 'old files here'),
    ];
  }
  if (kind === 'browser') return [
    s('installer', 'Old installers in Downloads', 'Setup files you already ran', 'old installers in downloads'),
    s('size', 'Biggest downloads', 'Everything over 100 MB in Downloads', 'big files in downloads'),
    s('dupes', 'Things downloaded twice', 'Identical copies in Downloads', 'duplicate files in downloads'),
  ];
  if (kind === 'design') return [
    s('cutout', 'Remove the background from your latest screenshot', 'Runs on this PC, saved as a new PNG', 'remove background from the latest screenshot'),
    s('convert', 'Turn recent screenshots into WebP', 'Much smaller, still sharp', 'convert latest screenshots to webp'),
    s('compress', 'Compress images on the Desktop', 'Copies saved next to the originals', 'compress images on desktop'),
  ];
  if (kind === 'code') return [
    s('box', 'Old node_modules folders', 'From projects untouched for a month', 'old node_modules'),
    s('broom', 'Developer caches', 'npm, pip, Gradle and friends', 'clean up caches'),
    s('size', 'Files over 1 GB', 'Across your user folder', 'files over 1gb'),
  ];
  if (kind === 'office') return [
    s('merge', 'Merge the PDFs in Downloads', 'One PDF, in name order', 'merge pdfs in downloads into one pdf'),
    s('text', 'Copy text from your latest screenshot', 'On this PC, straight to the clipboard', 'copy text from the latest screenshot'),
    s('dupes', 'Duplicate documents', 'Identical copies of the same file', 'duplicate documents'),
  ];
  if (kind === 'games') return [
    s('pie', 'What\'s taking space', 'Folders and drives, biggest first', 'what is taking space'),
    s('size', 'Files over 2 GB', 'Across your user folder', 'files over 2gb'),
    s('broom', 'Caches and junk', 'Temp files, crash dumps, old installers', 'clean up junk'),
  ];
  if (kind === 'chat') return [
    s('dupes', 'Photos received twice', 'Identical images in Downloads and Pictures', 'duplicate photos'),
    s('video', 'Big videos', 'Over 200 MB, biggest first', 'videos over 200mb'),
    s('broom', 'Caches and junk', 'Temp files, crash dumps, old installers', 'clean up junk'),
  ];
  return [
    s('pie', 'What\'s taking space', 'Folders and drives, biggest first', 'what is taking space'),
    s('size', 'Huge files over 300 MB', 'Biggest first, with one-click cleanup', 'show me huge files over 300mb'),
    s('broom', 'Caches and junk', 'Temp files, crash dumps, old installers', 'clean up junk'),
  ];
}

module.exports = { suggest, contextLabel, appOf };
