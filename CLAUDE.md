# FunkPayAI — Claude Code Context

## Cos'è questo progetto

**FunkPayAI** è un'app Electron desktop cross-platform (Mac/Win/Linux) che funge da **Bitcoin wallet per AI agents**.

Espone un **MCP server stdio** (`~/.funkpay/mcp-stdio.mjs`) che Claude Code (e altri agent) usano per pagare in Bitcoin in autonomia. Il proxy stdio comunica con la REST API su `http://127.0.0.1:3282/api`. L'utente configura il wallet una volta, l'agent opera nei limiti impostati.

È il componente **lato payer** dell'ecosistema FunkPay.

---

## Ecosistema FunkPay — 3 progetti

| Repo | Ruolo | Path locale |
|------|-------|-------------|
| `funkpayai` (questo) | Agent wallet + MCP server | `../funkpayai` |
| `btcfunkpay` | Merchant payment server (Python/FastAPI) | `../btcfunkpay` |
| `btcfunk` | Website btcfunk.com (analytics + serve funkpay.js) | `../btcfunk` |

### Flusso completo
```
Claude Code
  └─[MCP]→ FunkPayAI → firma tx → broadcast via bitcoind
                                        │
                                   Bitcoin network
                                        │
              btcfunkpay (merchant) ←──┘ rileva on-chain
                └── webhook → attiva ordine → notifica agent
```

---

## Stack tecnico

- **Electron** + electron-vite + TypeScript + React
- **bitcoind v28.0** — scaricato a runtime al primo avvio (non bundlato)
- **MCP server** — `@modelcontextprotocol/sdk`, HTTP/StreamableHTTP su :3282
- **FunkPay REST API** — `https://btcfunk.com/pay` (produzione)

## Struttura src/

```
src/main/
  index.ts        — entry: window, IPC, avvia bitcoind + MCP
  installer.ts    — download bitcoind a runtime via Terminal.app
  bitcoind.ts     — gestisce child process bitcoind
  rpc.ts          — client JSON-RPC Bitcoin Core
  mcp-server.ts   — MCP server con tools
  settings.ts     — settings (approvalMode, RPC, porta MCP)
src/preload/
  index.ts        — contextBridge → window.api
src/renderer/
  App.tsx         — routing: Install → Dashboard/Settings
  pages/Install.tsx   — primo avvio: apre Terminal per installare bitcoind
  pages/Dashboard.tsx — stato nodo + snippet config MCP
  pages/Settings.tsx  — Never/Threshold/Always ask, RPC, porta
```

## Comandi

```bash
npm run dev          # avvia in dev mode (hot reload)
npm run build        # build produzione
npm run package      # genera installer (dmg/exe/AppImage)
```

## Primo avvio / installazione bitcoind

1. App mostra pagina Install
2. Utente clicca "Install Bitcoin Core" → si apre Terminal.app
3. Script bash: scarica, estrae, rimuove quarantena, firma il binario
4. App rileva `install.done` via `fs.watch` → avvia servizi
5. Se app chiusa a metà → al prossimo avvio riprende da `in_progress`

**Firma binario (macOS):**
- Dev: `codesign --force --sign - <binary>` (ad-hoc)
- Distribuzione: serve **"Developer ID Application"** certificate — TODO (Luca Rocchi ha solo Apple Development ora)

## MCP Tools esposti

| Tool | Descrizione |
|------|-------------|
| `get_balance` | Saldo wallet in satoshi |
| `get_new_address` | Genera nuovo indirizzo Bitcoin |
| `send_payment` | Invia BTC (soggetto ad approval policy) |
| `get_transaction` | Stato e conferme di una tx |
| `list_transactions` | Storico transazioni |
| `create_invoice` | Crea invoice su merchant btcfunkpay; allega shipping/billing da Settings; accetta `sku` |
| `get_invoice_status` | Polling stato invoice su merchant btcfunkpay |

**Claude Code config:**
```json
{ "mcpServers": { "funkpayai": { "command": "node", "args": ["~/.funkpay/mcp-stdio.mjs"] } } }
```

## Approval Policy

Configurabile in Settings:
- **Never** — autonomia totale
- **Threshold** — chiede conferma sopra X sat (default 100.000)
- **Always ask** — ogni pagamento richiede approvazione

## Decisioni architetturali importanti

- bitcoind NON è bundlato — scaricato a runtime per evitare Gatekeeper e alleggerire l'app
- MCP usa HTTP/StreamableHTTP (non stdio) — l'app è già running come GUI
- `startServices()` avvia sia bitcoind che MCP server
- Porta MCP occupata → auto-libera con `lsof` e riprova

## Stato corrente (2026-05-09)

- ✅ Scaffold completo, typecheck OK
- ✅ Installer con Terminal.app reale + fs.watch
- ✅ bitcoind v28.0 installato e running
- ✅ MCP server in ascolto su :3282
- ✅ Dashboard mostra nodo verde + MCP verde
- ✅ Shipping/billing info nelle Settings (per acquisti beni fisici)
- ✅ MCP tools `create_invoice` e `get_invoice_status` (integrazione merchant btcfunkpay)
- ✅ `create_invoice` accetta `sku` — il merchant risolve il prezzo via `/funkpay/product?sku=`
- 🔲 Light/dark theme toggle
- 🔲 Developer ID Application certificate per distribuzione
- 🔲 App mobile FunkPay (futuro — push notification per approvals)

## FunkPay API (btcfunkpay)

Base URL produzione: `https://btcfunk.com/pay`

```
POST /pay/invoices        { amount_sat?, label? } → { payment_id, address, bip21_uri, ... }
GET  /pay/invoices/:id    → { status, confirmations, txid, received_sat, ... }
GET  /pay/invoices        → lista invoice
```

Status: `pending → detected → confirmed | overpaid | expired`
