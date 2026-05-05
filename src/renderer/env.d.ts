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
    status: () => Promise<{ bitcoind: boolean; mcp: boolean; mcpPort: number }>
  }
}
