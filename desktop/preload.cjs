// Narrow bridge between the overlay page and the Electron shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidekickDesktop', {
  setInteractive: (on) => ipcRenderer.send('sidekick:interactive', !!on),
  openApp: () => ipcRenderer.send('sidekick:open-app'),
  quit: () => ipcRenderer.send('sidekick:quit'),
});
