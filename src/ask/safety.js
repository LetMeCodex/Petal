// What Petal will never offer to remove, whatever was asked.
// Windows and installed apps, system files at the root of a drive, the inside of git repos,
// app data (except the specific caches the cleanup knows are safe), and the user's own folders
// themselves (their contents are fair game, the folders aren't).
const path = require('path');
const os = require('os');

const lower = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const env = (k) => process.env[k] && lower(process.env[k]);

const HOME = lower(os.homedir());
const SYSTEM_DIRS = [env('WINDIR') || 'c:\\windows', env('ProgramFiles') || 'c:\\program files', env('ProgramFiles(x86)') || 'c:\\program files (x86)', env('ProgramW6432'), env('ProgramData') || 'c:\\programdata'].filter(Boolean);
// At the root of any drive.
const ROOT_DIRS = new Set(['$recycle.bin', 'system volume information', 'recovery', 'perflogs', 'config.msi', 'boot', 'efi', 'msocache', 'windowsapps', '$windows.~bt', '$windows.~ws', '$winreagent', 'windows', 'program files', 'program files (x86)', 'programdata', 'xboxgames', 'onedrivetemp']);
const ROOT_FILES = /^(pagefile|hiberfil|swapfile)\.sys$|^dumpstack\.log/;
// Folder names that are part of something bigger: deleting a file inside breaks the whole.
const NEVER_INSIDE = new Set(['.git', '.svn', '.hg', 'windowsapps', 'steamapps', 'epic games', 'riot games', 'ubisoft game launcher', '.android', '.gradle\\wrapper', '$recycle.bin']);
// Walks skip these by name (fast) on top of the full-path rules.
const WALK_SKIP = ['appdata', '.git', '.svn', '.hg', '$recycle.bin', 'system volume information', 'windowsapps', 'steamapps', 'onedrivetemp', 'node_modules', '.cache', '.nuget', '.gradle', '.m2', '.cargo', '.rustup', '.vscode', '.cursor'];

let extraProtected = [];
// Petal's own data, and any other paths the app wants kept safe.
function protect(...dirs) { extraProtected.push(...dirs.filter(Boolean).map(lower)); }

const within = (p, dir) => p === dir || p.startsWith(`${dir}\\`);

// Returns why `p` must not be removed, or null when it may be. `allow`: exact app-data paths the
// cache cleanup has vetted (npm cache, Temp...).
function blocked(p, { allow = [] } = {}) {
  const lp = lower(p);
  const allowed = allow.map(lower).some((a) => within(lp, a));
  const parts = lp.split('\\');
  if (parts.length <= 1 || lp.length <= 3) return 'a whole drive';
  if (ROOT_DIRS.has(parts[1]) || (parts.length === 2 && ROOT_FILES.test(parts[1]))) return 'part of Windows';
  for (const d of SYSTEM_DIRS) if (within(lp, d)) return 'part of Windows or an installed app';
  for (const d of extraProtected) if (within(lp, d)) return 'Petal uses it';
  if (lp === HOME || path.dirname(lp) === path.dirname(HOME) && parts.length <= 3) return 'a user folder';
  if (path.dirname(lp) === HOME && /^(desktop|documents|downloads|pictures|videos|music|onedrive.*|appdata|favorites|contacts|links|saved games|searches|3d objects)$/.test(parts[parts.length - 1])) return 'one of your main folders';
  if (/^ntuser\./.test(parts[parts.length - 1]) || /^usrclass\./.test(parts[parts.length - 1])) return 'part of your Windows profile';
  if (!allowed && within(lp, `${HOME}\\appdata`)) return 'app data an app is using';
  for (let i = 1; i < parts.length - 1; i++) if (NEVER_INSIDE.has(parts[i])) return parts[i] === '.git' ? 'inside a git repository' : 'part of an installed app or game';
  return null;
}

module.exports = { blocked, protect, WALK_SKIP, HOME, SYSTEM_DIRS };
