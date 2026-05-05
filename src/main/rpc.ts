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

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`RPC HTTP ${res.status}: ${text}`)
    }

    const json = (await res.json()) as { result: T; error: { message: string } | null }
    if (json.error) throw new Error(`RPC error: ${json.error.message}`)
    return json.result
  }

  async getBalance(): Promise<number> {
    const btc = await this.call<number>('getbalance')
    return Math.round(btc * 1e8)
  }

  async getNewAddress(label?: string): Promise<string> {
    return this.call<string>('getnewaddress', [label ?? '', 'bech32'])
  }

  async sendToAddress(address: string, amountSat: number, comment?: string): Promise<string> {
    const btc = amountSat / 1e8
    return this.call<string>('sendtoaddress', [address, btc, comment ?? ''])
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

  async ping(): Promise<void> {
    await this.call('ping')
  }
}
