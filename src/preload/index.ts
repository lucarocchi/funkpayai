import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  node: {
    syncInfo: () => ipcRenderer.invoke('node:syncInfo')
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s: unknown) => ipcRenderer.invoke('settings:save', s),
    test: (url: string, user: string, password: string) => ipcRenderer.invoke('settings:test', url, user, password)
  },
  wallet: {
    getBalance:       () => ipcRenderer.invoke('wallet:getBalance'),
    getNewAddress:    () => ipcRenderer.invoke('wallet:getNewAddress'),
    send:    (address: string, amountSat: number, subtractFee?: boolean) => ipcRenderer.invoke('wallet:send', address, amountSat, subtractFee),
    listTransactions: (limit?: number) => ipcRenderer.invoke('wallet:listTransactions', limit)
  },
  payments: {
    list:     () => ipcRenderer.invoke('payments:list'),
    reverify: (id: string) => ipcRenderer.invoke('payments:reverify', id)
  },
  status: () => ipcRenderer.invoke('status'),
  app: {
    relaunch: () => ipcRenderer.invoke('app:relaunch')
  }
})
