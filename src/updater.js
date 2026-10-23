// Updates from GitHub Releases (LetMeCodex/Petal), installed app only.
// Checks shortly after start and then every 6 hours, downloads quietly, and offers "Restart to
// update" in the tray; otherwise the update installs the next time Petal quits.
const { app, Notification } = require('electron');

const SIX_HOURS = 6 * 60 * 60 * 1000;

function startUpdates({ onReady } = {}) {
  if (!app.isPackaged) return { state: () => null, install: () => {} };
  const { autoUpdater } = require('electron-updater');
  let ready = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version;
    onReady?.(ready);
    if (Notification.isSupported()) {
      new Notification({ title: `Petal ${ready} is ready`, body: 'Restart Petal from the tray to update, or it updates next time Petal starts.' }).show();
    }
  });
  // Offline, rate-limited, no release yet: try again next time, never bother the user.
  autoUpdater.on('error', (err) => { if (process.env.PETAL_DEBUG) console.log('[update]', err.message); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 30 * 1000);
  setInterval(check, SIX_HOURS);
  return { state: () => ready, install: () => autoUpdater.quitAndInstall(true, true) };
}

module.exports = { startUpdates };
