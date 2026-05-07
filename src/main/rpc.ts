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

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.idCounter
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64')
      },
      body: JSON.stringify({ jsonrpc: '1.0', id, method, params })
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
    return this.call<string>('sendtoaddress', [address, btc, comment ?? '', '', subtractFee])
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

  withWallet(walletName: string): BitcoinRpc {
    const base = this.config.url.replace(/\/wallet\/[^/]+$/, '')
    return new BitcoinRpc({ ...this.config, url: `${base}/wallet/${walletName}` })
  }

  async ensureWallet(walletName: string): Promise<void> {
    try {
      await this.call('createwallet', [walletName])
    } catch (e: unknown) {
      const code = (e as { code?: number }).code
      // -4 = wallet file already exists on disk → need to load it
      // -35 = already loaded → we're good
      if (code === -35) return
      if (code === -4 || (e instanceof Error && e.message.toLowerCase().includes('already'))) {
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
