interface Window {
  api: {
    node: {
      syncInfo: () => Promise<{ blocks: number; headers: number; progress: number; syncing: boolean } | null>
    }
    settings: {
      load: () => Promise<import('../main/settings').Settings>
      save: (s: import('../main/settings').Settings) => Promise<void>
      test: (url: string, user: string, password: string) => Promise<'offline' | 'busy' | 'online'>
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
    status: () => Promise<{ nodeStatus: 'offline' | 'busy' | 'online'; mcp: boolean; mcpPort: number; cliPath: string | null; cliInstallFailed: boolean; bitcoindPath: string; dataDir: string; network: string; connectionExhausted: boolean }>
    app: {
      relaunch: () => Promise<void>
    }
  }
}
