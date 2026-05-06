# FunkPay MCP

Bitcoin wallet for AI agents. Exposes a local MCP server so any AI agent can send and receive Bitcoin autonomously.

Part of the [FunkPay](https://funkpay.dev) ecosystem.

---

## What it does

FunkPay MCP is an Electron desktop app that runs a Bitcoin node (bitcoind) and exposes an **MCP server** on `http://127.0.0.1:3282/mcp`. AI agents connect to it and can send payments, create invoices, and track transactions — all within the approval limits you configure.

---

## Setup

1. Download and open `FunkPayMCP-*.dmg`
2. On first launch, click **Install Bitcoin Core** — the app downloads and configures bitcoind automatically
3. Wait for the node to sync (progress shown in the app)
4. Add FunkPay to your AI agent's MCP config (see below)

---

## MCP Configuration

Add this to your agent's MCP config once. The server starts automatically when the app is open.

**Claude Code** (`~/.claude.json` or project `.claude/settings.json`):
```json
{
  "mcpServers": {
    "funkpayai": {
      "url": "http://127.0.0.1:3282/mcp"
    }
  }
}
```

**Any MCP-compatible client** (Cursor, Windsurf, etc.):
```json
{
  "mcpServers": {
    "funkpayai": {
      "url": "http://127.0.0.1:3282/mcp"
    }
  }
}
```

**System prompt** (tell your agent about the wallet):
```
You have access to a Bitcoin wallet via the FunkPay MCP server at http://127.0.0.1:3282/mcp.
Use it to send and receive Bitcoin payments autonomously.
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_balance` | Wallet balance in satoshis |
| `get_new_address` | Generate a new Bitcoin receive address |
| `send_payment` | Send BTC (subject to your approval policy) |
| `get_transaction` | Transaction status and confirmations |
| `list_transactions` | Recent transaction history |
| `create_invoice` | Create a payment invoice on a FunkPay merchant |
| `get_invoice_status` | Poll invoice status |
| `wait_for_payment` | Block until invoice is detected/confirmed |
| `list_merchants` | List trusted merchants configured in Settings |
| `discover_merchant` | Auto-discover a FunkPay merchant by domain |

---

## Approval Policy

Configure in **Settings → Payment Approval**:

- **Never** — full autonomy, agent pays without asking
- **Threshold** — asks for confirmation above X satoshis (default 100,000 sat)
- **Always ask** — every payment requires your approval

---

## Network

Supports **mainnet** (real BTC) and **testnet** (test BTC, no value). Switch in Settings — the app restarts automatically.

---

## FunkPay Ecosystem

| Project | Role |
|---------|------|
| **FunkPay MCP** (this) | Agent wallet — payer side |
| [btcfunkpay](https://github.com/lucarocchi/btcfunkpay) | Merchant payment server |
| [btcfunk](https://github.com/lucarocchi/btcfunk) | btcfunk.com website |

Demo merchant (testnet): [shop.funkpay.dev](https://shop.funkpay.dev)

---

## Requirements

- macOS (arm64 or x64), Windows, or Linux
- Internet connection for initial bitcoind download (~50 MB)
- ~5 GB disk space (pruned node)
