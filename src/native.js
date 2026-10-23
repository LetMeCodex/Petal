// Where Petal's native helpers live, and building them.
// In development they're compiled from src/native/*.cs on first run (csc ships with Windows).
// In the installed app they're prebuilt (scripts/build-native.js) and unpacked next to app.asar,
// since Windows can't run an .exe from inside an archive and Program Files isn't writable.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, 'native').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const PACKAGED = DIR.includes('app.asar.unpacked');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

// Compiles native/<name>.cs to <name>.exe when the .exe is missing or older than its source.
function build(name, extraArgs = [], { force = false } = {}) {
  const src = path.join(DIR, `${name}.cs`), exe = path.join(DIR, `${name}.exe`);
  if (PACKAGED) return exe;     // shipped prebuilt; never rebuilt in place
  if (!force && fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(src).mtimeMs) return exe;
  execFileSync(CSC, ['/nologo', '/target:exe', '/optimize', ...extraArgs, `/out:${exe}`, src]);
  return exe;
}

module.exports = { DIR, PACKAGED, build, file: (name) => path.join(DIR, name) };
