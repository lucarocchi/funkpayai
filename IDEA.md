---
name: FunkPayAI
description: Idea prodotto — AI agent con wallet Bitcoin locale per pagamenti autonomi via FunkPay
type: project
originSessionId: a2d81c9b-84cf-4f41-8251-b584a2ff297c
---
## Concept

FunkPayAI è un tool Python che permette a un AI agent di effettuare pagamenti Bitcoin in autonomia, senza custody esterna e senza intervento umano su ogni transazione.

## Flusso completo

**Lato agente (Mac locale):**
1. Agente si sveglia su trigger (cron, evento, istruzione utente)
2. Chiama `sellABC.com` → richiede invoice FunkPay → riceve `{ address, amount_sat, payment_id }`
3. Chiama `sendtoaddress(address, amount_sat)` su Bitcoin Core locale → torna `txid`
4. Fa polling `gettransaction(txid)` finché `confirmations >= 1`
5. Notifica `sellABC.com` con `txid` e `payment_id` → ordine attivato

**Lato merchant (sellABC.com con FunkPay):**
- `POST /invoices` → crea indirizzo dedicato
- Bitcoin Core del merchant monitora → `detected` → `confirmed`
- Webhook → attiva l'ordine

## Stack tecnico

- **Bitcoin Core locale** (Mac) — wallet hot con budget limitato (es. $100), chiavi mai escono dal Mac
- **RPC locale** `http://luca:***@127.0.0.1:8332` — `sendtoaddress`, `gettransaction`
- **FunkPay API** — `POST /invoices` per richiedere indirizzo al merchant
- **AI agent** (Claude o altro LLM con tool use) — orchestra il flusso

## Perché è interessante

- Gli AI agent oggi non hanno wallet — si bloccano quando devono pagare
- Su Ethereum/Solana ci sono esperimenti (ai16z, Virtuals) ma richiedono smart contract
- Su Bitcoin nessuno lo ha fatto seriamente — Bitcoin Core RPC + FunkPay risolve senza smart contract
- Modello "budget fisso": l'umano carica il wallet una volta, l'agente opera in autonomia nei limiti

## Stato

- Idea documentata (2026-05-05)
- Bitcoin Core installato in locale su Mac (pruned 10GB, sync in corso)
- RPC configurato: `http://luca:funkpay123@127.0.0.1:8332`
- Da fare: definire il flusso completo, implementare il client Python FunkPayAI
