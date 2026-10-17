# Log format

CSV, UTF-8, comma, one header row, LF line ends. Times are UTC, ISO 8601 with `Z`. A minute is written `2026-01-01T14:00Z`. An empty cell means **not measured**; 0 means measured as zero. Counts only: no txid, key, seed, IP, port or address.

## pulse-minute.csv (one row per minute, from run-sender.mjs)

```
minute_utc,side,step,target_tx_s,mempool_max,mempool_<node>...,nodes_read,submit_ok,rejects,rej_orphan,rej_double_spend,rej_mempool_full,rej_fee_too_low,rej_mass,rej_rpc_timeout,rej_rpc_closed,rej_other
```

| Column | Meaning |
|---|---|
| `minute_utc` | The minute. The last row at a stop is marked `-partial`. |
| `side` | Who wrote the row (`bot` in this script) |
| `step` | Step name from control.json (e.g. `G1`, `A1`) |
| `target_tx_s` | Highest target rate in that minute (0 = hold) |
| `mempool_max` | Highest mempool read across the nodes in that minute |
| `mempool_<node>` | One column per node in `NODES`, in that order. On 17 Oct: `mempool_muon,mempool_electron,mempool_neutrino,mempool_boson,mempool_vector` |
| `nodes_read` | Nodes that answered at least one health read in that minute |
| `submit_ok` | Submits the nodes accepted |
| `rejects` | Submits refused or failed, total |
| `rej_*` | Rejects by reason: orphan, double_spend, mempool_full, fee_too_low, mass, rpc_timeout, rpc_closed, other |

Missing minutes mean the machine wrote nothing (on 17 Oct, a paused host). Don't fill them in.

## Other files from the same scripts

- `sec.csv`: `utc,step,target_tx_s,attempts,submit_ok,rejects,inflight,nodes_live,lanes_ready,ram_free_mb`, one row per second.
- `fee-reads.csv`: `utc,side,node,synced,sink_lag_s,virtual_daa,priority,normal0,low0,mempool_count,mempool_ready`, one row per node per minute (empty cells = read failed).
- `events.jsonl`: sender events (start, node-dead, node-back, target, stopping, end with totals).
- `tx.jsonl`: per-transaction log with txids. **Local only. Never commit or publish it.**
