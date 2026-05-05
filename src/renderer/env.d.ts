interface Window {
  api: {
    settings: {
      load: () => Promise<import('../main/settings').Settings>
      save: (s: import('../main/settings').Settings) => Promise<void>
    }
    bitcoind: {
      status: () => Promise<{ running: boolean }>
    }
  }
}
