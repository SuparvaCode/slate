// The one thing the site can ask the desktop app for: a Google sign-in through the system browser.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slateDesktop', {
  googleSignIn: () => ipcRenderer.invoke('slate:google-signin'),
});
