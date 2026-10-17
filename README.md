# tn10-run-kit

These are the scripts we used for our own TN10 load test (17 Oct 2026), shared as-is. The goal is that anyone can run the same kind of TN10 load test and compare their numbers with ours. It isn't polished, and it isn't meant as more than that.

**Testnet-10 only.** tKAS has no value.

## What's in it

| Path | What it is |
|---|---|
| `scripts/run-sender.mjs` | The bot's sender: sticky lanes (one lane = one node), fixed fee, rate cap, RAM floor, node-dead rule with the recovery fix, hard stop, STOP file, per-second and per-minute logs |
| `scripts/lanes-lib.mjs` | Shared helpers: node list, lane scripts, hop building, reject classes, tips file load/save |
| `scripts/fee-reads.mjs` | Read-only fee and mempool reader, one row per node per minute |
| `scripts/run.sh` | Starts the fee reader and the sender from a config file |
| `scripts/wminer.mjs` | Small wRPC CPU miner (Kaspa SDK), the fallback when gRPC is closed |
| `config.example.env` | All settings as environment variables. Copy to `config.env`, which is git-ignored |
| `control.example.json` | The control file the sender re-reads every second (step, target, hold) |
| `CHECKLIST.md` | Before, during and after a run |
| `LOG-FORMAT.md` | The `pulse-minute.csv` columns and the other log files |

Lanes are no-signature hops (P2SH `push4(id) OP_DROP OP_TRUE`), anyone-can-spend, ~643 g, 1 in / 1 out. That's a load shape, not realistic payments. Funding the lanes and writing the tips file are not included here.

## Our setup

- **Desk side:** desk sender and miners on a Windows 11 desktop, with Node.js. Miners were `kaspa-miner.exe` (gRPC) or the wRPC miner in this kit.
- **Bot side:** the bot's sender runs on a Linux machine (a cloud VM) with Node.js.
- **Our own node:** a Windows laptop running 24/7.
- **Node software:** Rusty Kaspa `kaspad` 2.1.0 on TN10.
- **Public TN10 nodes:** wRPC only. gRPC is closed on them, so `kaspa-miner.exe` can't mine there; `wminer.mjs` can.
- **SDK:** Kaspa SDK 2.1.0 for Node (`kaspa-wasm32-sdk`), plus the `websocket` npm package.

**Known limits:**
- The Linux VM can be paused by its host. That happened six times on 17 Oct and cost about 25 minutes of sending. Run the senders on a machine you control if you can.
- Some public TN10 hostnames share one backend, so five hostnames aren't five independent paths.
- `wminer.mjs` has no restart loop of its own. Run it under a supervisor.

## Quick start

1. `cd scripts && npm install`
2. Copy `config.example.env` to `config.env` and fill it in. Copy `control.example.json` to `<RUN_DIR>/control.json`.
3. Read-only check first: `node fee-reads.mjs --once`, then `node run-sender.mjs --dry` (with the config loaded into your environment).
4. A real run needs an explicit go: `RUN_ENV=../config.env ./run.sh`. To stop: `touch <RUN_DIR>/STOP`.

## Rules

- TN10 only.
- Counts only in anything you publish.
- No keys, seeds, addresses, txids, IPs, ports, tunnel URLs or local paths in git.
- `tx.jsonl` and the tips file stay local.

## Credit

The per-minute format follows Kaspa Pulse's CSV. Thanks to Kaspa Pulse (@gokugalax, kaspapulse.com) for comparing counts with us.
