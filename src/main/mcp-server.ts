import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { IncomingMessage, ServerResponse, createServer } from 'http'
import { z } from 'zod'
import { BitcoinRpc } from './rpc'
import { loadSettings } from './settings'

type ApprovalHandler = (address: string, amountSat: number) => Promise<boolean>

export class McpServerManager {
  private server: McpServer
  private httpServer: ReturnType<typeof createServer> | null = null
  private rpc: BitcoinRpc
  private onApprovalRequired: ApprovalHandler

  constructor(rpc: BitcoinRpc, onApprovalRequired: ApprovalHandler) {
    this.rpc = rpc
    this.onApprovalRequired = onApprovalRequired
    this.server = this.buildServer()
  }

  private buildServer(): McpServer {
    const s = new McpServer({ name: 'funkpayai', version: '0.1.0' })

    s.tool('get_balance', 'Get wallet balance in satoshis', {}, async () => {
      const sat = await this.rpc.getBalance()
      return { content: [{ type: 'text', text: `${sat} sat` }] }
    })

    s.tool(
      'get_new_address',
      'Generate a new Bitcoin receive address',
      { label: z.string().optional() },
      async ({ label }) => {
        const address = await this.rpc.getNewAddress(label)
        return { content: [{ type: 'text', text: address }] }
      }
    )

    s.tool(
      'send_payment',
      'Send Bitcoin to an address (subject to user approval policy)',
      {
        address: z.string().describe('Bitcoin address'),
        amount_sat: z.number().int().positive().describe('Amount in satoshis'),
        comment: z.string().optional()
      },
      async ({ address, amount_sat, comment }) => {
        const settings = loadSettings()
        const needsApproval =
          settings.approvalMode === 'always' ||
          (settings.approvalMode === 'threshold' && amount_sat >= settings.approvalThresholdSat)

        if (needsApproval) {
          const approved = await this.onApprovalRequired(address, amount_sat)
          if (!approved) {
            return { content: [{ type: 'text', text: 'Payment rejected by user.' }], isError: true }
          }
        }

        const txid = await this.rpc.sendToAddress(address, amount_sat, comment)
        return { content: [{ type: 'text', text: txid }] }
      }
    )

    s.tool(
      'get_transaction',
      'Get transaction status and confirmations',
      { txid: z.string() },
      async ({ txid }) => {
        const tx = await this.rpc.getTransaction(txid)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ txid: tx.txid, confirmations: tx.confirmations }, null, 2)
            }
          ]
        }
      }
    )

    s.tool(
      'list_transactions',
      'List recent wallet transactions',
      { limit: z.number().int().min(1).max(100).default(20) },
      async ({ limit }) => {
        const txs = await this.rpc.listTransactions(limit)
        return { content: [{ type: 'text', text: JSON.stringify(txs, null, 2) }] }
      }
    )

    return s
  }

  async start(port: number): Promise<void> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404)
        res.end()
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      })
      await this.server.connect(transport)
      await transport.handleRequest(req, res, await bodyOf(req))
    })

    await new Promise<void>((resolve) => this.httpServer!.listen(port, '127.0.0.1', resolve))
    console.log(`[mcp] listening on http://127.0.0.1:${port}/mcp`)
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.httpServer ? this.httpServer.close((e) => (e ? reject(e) : resolve())) : resolve()
    )
  }
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
