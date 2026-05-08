export interface RpcConfig {
  url: string
  user: string
  password: string
}

export class BitcoinRpc {
  private config: RpcConfig
  private idCounter = 0

  constructor(config: RpcConfig) {
    this.config = config
  }

  // F-10: default 30s timeout — prevents hanging the Electron main process
  async call<T>(method: string, params: unknown[] = [], timeoutMs = 30_000): Promise<T> {
    const id = ++this.idCounter
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64')
      },
      body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    })

    const text = await res.text()
    let json: { result: T; error: { code: number; message: string } | null }
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`RPC HTTP ${res.status}: ${text}`)
    }

    if (json.error) {
      const err = new Error(`RPC error: ${json.error.message}`) as Error & { code: number }
      err.code = json.error.code
      throw err
    }
    return json.result
  }

  async getBalance(): Promise<number> {
    const btc = await this.call<number>('getbalance')
    return Math.round(btc * 1e8)
  }

  async getNewAddress(label?: string): Promise<string> {
    return this.call<string>('getnewaddress', [label ?? '', 'bech32'])
  }

  async sendToAddress(address: string, amountSat: number, comment?: string, subtractFee = false): Promise<string> {
    const btc = amountSat / 1e8
    // 60s — broadcast can be slow under mempool congestion
    return this.call<string>('sendtoaddress', [address, btc, comment ?? '', '', subtractFee], 60_000)
  }

  async getTransaction(txid: string): Promise<{
    txid: string
    confirmations: number
    amount: number
    time: number
  }> {
    return this.call('gettransaction', [txid])
  }

  async listTransactions(count = 20): Promise<unknown[]> {
    return this.call('listtransactions', ['*', count])
  }

  async getBlockchainInfo(): Promise<{
    blocks: number
    headers: number
    verificationprogress: number
    initialblockdownload: boolean
  }> {
    return this.call('getblockchaininfo')
  }

  async ping(): Promise<void> {
    await this.call('ping')
  }

  async isAlive(): Promise<boolean> {
    const s = await this.getNodeStatus()
    return s !== 'offline'
  }

  async getNodeStatus(): Promise<'offline' | 'busy' | 'online'> {
    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64') },
        body: JSON.stringify({ jsonrpc: '1.0', id: 0, method: 'ping', params: [] }),
        signal: AbortSignal.timeout(15000)
      })
      if (res.status === 200) return 'online'
      if (res.status === 503) return 'busy'
      return 'offline'
    } catch {
      return 'offline'
    }
  }

  withWallet(walletName: string): BitcoinRpc {
    const parsed = new URL(this.config.url)
    parsed.pathname = `/wallet/${walletName}`
    return new BitcoinRpc({ ...this.config, url: parsed.toString() })
  }

  async ensureWallet(walletName: string): Promise<void> {
    try {
      await this.call('createwallet', [walletName])
    } catch (e: unknown) {
      const code = (e as { code?: number }).code
      // -35 = already loaded → we're good
      if (code === -35) return
      // -4 + "already" in message = wallet file exists on disk but not loaded → loadwallet
      // Other -4 errors (e.g. verification failed) are real — re-throw
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      if (code === -4 && msg.includes('already')) {
        try {
          await this.call('loadwallet', [walletName])
        } catch (le: unknown) {
          const lcode = (le as { code?: number }).code
          if (lcode !== -35) throw le
        }
      } else {
        throw e
      }
    }
  }
}
