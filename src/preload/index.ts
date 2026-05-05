import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  install: {
    getStatus:      () => ipcRenderer.invoke('install:getStatus'),
    getLog:         () => ipcRenderer.invoke('install:getLog'),
    openTerminal:   () => ipcRenderer.invoke('install:openTerminal'),
    onLog:  (cb: (line: string) => void) => ipcRenderer.on('install:log',  (_, l) => cb(l)),
    onDone: (cb: () => void)             => ipcRenderer.on('install:done', () => cb())
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', s)
  },
  status: () => ipcRenderer.invoke('status')
})
