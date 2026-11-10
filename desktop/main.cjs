// Sidekick desktop: a transparent, always-on-top strip along the bottom of the screen where the
// sidekick walks about. Clicks pass straight through to your desktop except on the sidekick itself.
//
//   SIDEKICK_URL   where the Sidekick server is (default http://localhost:8787)
//   SIDEKICK_SHOT  write a screenshot of the overlay to this path after a few seconds, then quit (used for testing)
const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const URL_BASE = (process.env.SIDEKICK_URL || 'http://localhost:8787').replace(/\/$/, '');
const STRIP = 440;
let pet = null, main = null, tray = null;

// transparent windows need this on some Linux setups
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

function createPet() {
  const { workArea } = screen.getPrimaryDisplay();
  pet = new BrowserWindow({
    x: workArea.x, y: workArea.y + workArea.height - STRIP, width: workArea.width, height: STRIP,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, skipTaskbar: true, fullscreenable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.loadURL(`${URL_BASE}/pet.html?desktop=1`);
  pet.once('ready-to-show', () => pet.showInactive());
  pet.webContents.on('did-fail-load', (_e, code, desc) => { console.error(`Sidekick could not reach ${URL_BASE} (${desc}). Is the server running?`); if (!process.env.SIDEKICK_SHOT) setTimeout(() => pet && pet.loadURL(`${URL_BASE}/pet.html?desktop=1`), 5000); });
  pet.webContents.setWindowOpenHandler(({ url }) => { openApp(url); return { action: 'deny' }; });
  pet.on('closed', () => { pet = null; });
}

function openApp(url) {
  if (url && !url.startsWith(URL_BASE)) return shell.openExternal(url);
  if (main) { main.focus(); return; }
  main = new BrowserWindow({ width: 460, height: 860, title: 'Sidekick', backgroundColor: '#1b2a1b', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  main.loadURL(`${URL_BASE}/?panel=tasks`);
  // sign-in pages for school accounts open in the real browser, never inside the app
  main.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  main.on('closed', () => { main = null; });
}

ipcMain.on('sidekick:interactive', (_e, on) => { if (pet) pet.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('sidekick:open-app', () => openApp());
ipcMain.on('sidekick:quit', () => app.quit());

app.whenReady().then(() => {
  createPet();
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (!icon.isEmpty()) {
      tray = new Tray(icon.resize({ width: 18, height: 18 }));
      tray.setToolTip('Sidekick');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Sidekick', click: () => openApp() }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    }
  } catch { /* no tray on this platform */ }
  screen.on('display-metrics-changed', () => { if (pet) { const { workArea } = screen.getPrimaryDisplay(); pet.setBounds({ x: workArea.x, y: workArea.y + workArea.height - STRIP, width: workArea.width, height: STRIP }); } });

  if (process.env.SIDEKICK_SHOT) {
    setTimeout(async () => {
      try { const img = await pet.webContents.capturePage(); fs.writeFileSync(process.env.SIDEKICK_SHOT, img.toPNG()); console.log('wrote', process.env.SIDEKICK_SHOT); }
      catch (e) { console.error('capture failed', e); }
      app.quit();
    }, Number(process.env.SIDEKICK_SHOT_DELAY || 9000));
  }
});

app.on('window-all-closed', () => app.quit());
