import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', s)
  },
  bitcoind: {
    status: () => ipcRenderer.invoke('bitcoind:status')
  }
})
