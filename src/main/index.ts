import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { Backend } from './backend/index.ts';
import type { Protector } from './backend/errors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const PREFIX = 'v2:';

app.setName('JsonProcedure');

/** Secrets at rest are encrypted with the OS (DPAPI on Windows), tied to the signed-in user. */
const protector: Protector = {
  protect(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system, so passwords cannot be saved.');
    return PREFIX + safeStorage.encryptString(plain).toString('base64');
  },
  unprotect(text) {
    if (!text.startsWith(PREFIX)) throw new Error('Unrecognised secret format.');
    return safeStorage.decryptString(Buffer.from(text.slice(PREFIX.length), 'base64'));
  },
};

let backend: Backend | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0F1623',
    title: 'JsonProcedure',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // Links and new windows open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app never navigates away from its own page.
  win.webContents.on('will-navigate', (e, url) => {
    const own = isDev ? process.env.ELECTRON_RENDERER_URL! : '';
    if (!own || !url.startsWith(own)) e.preventDefault();
  });

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    backend = new Backend({ dataDir: app.getPath('userData'), protector });
    await backend.init();

    // Only our own window may talk to the backend.
    ipcMain.handle('api:request', (event, method: unknown, url: unknown, body: unknown) => {
      if (!mainWindow || event.sender !== mainWindow.webContents)
        return { status: 403, body: { error: 'Forbidden.' } };
      if (typeof method !== 'string' || typeof url !== 'string' || !url.startsWith('/api'))
        return { status: 400, body: { error: 'Invalid request.' } };
      return backend!.handle(method, url, body);
    });

    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  let disposing = false;
  app.on('before-quit', (e) => {
    if (disposing || !backend) return;
    e.preventDefault();
    disposing = true;
    void backend.dispose().finally(() => app.quit());
  });
}
