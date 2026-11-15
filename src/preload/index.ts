import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only thing the renderer can reach: one call that forwards a method, URL and JSON body to the
 * backend in the main process. The renderer has no Node.js and no direct access to the database.
 */
contextBridge.exposeInMainWorld('jp', {
  request: (method: string, url: string, body?: unknown) =>
    ipcRenderer.invoke('api:request', method, url, body) as Promise<{ status: number; body: unknown }>,
  platform: process.platform,
});
