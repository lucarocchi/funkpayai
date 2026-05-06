type InstallStatus = 'not_installed' | 'in_progress' | 'installed'

interface Window {
  api: {
    install: {
      getStatus:    () => Promise<InstallStatus>
      getLog:       () => Promise<string[]>
      openTerminal: () => Promise<{ ok: boolean; error?: string }>
      onLog:  (cb: (line: string) => void) => void
      onDone: (cb: () => void) => void
    }
    settings: {
      load: () => Promise<import('../main/settings').Settings>
      save: (s: import('../main/settings').Settings) => Promise<void>
    }
    wallet: {
      getBalance:       () => Promise<number>
      getNewAddress:    () => Promise<string>
      send:             (address: string, amountSat: number, subtractFee?: boolean) => Promise<string>
      listTransactions: (limit?: number) => Promise<unknown[]>
    }
    payments: {
      list:     () => Promise<import('../main/payments').PaymentRecord[]>
      reverify: (id: string) => Promise<Record<string, unknown>>
    }
    status: () => Promise<{ bitcoind: boolean; mcp: boolean; mcpPort: number }>
  }
}
