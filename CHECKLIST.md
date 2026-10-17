# Checklist

Drawn from the final recommendations of our 17 Oct 2026 TN10 run. TN10 only. Adapt it to your own setup.

## Before any run

- [ ] All nodes you'll use are synced (your own node: synced and tested well ahead, not on run day).
- [ ] Node check on the real path: wRPC connect, sync status, `getBlockTemplate`, and for mining one solved-block submit. Closed gRPC ports or an HTTP/2 curl result don't count.
- [ ] Count independent backends, not hostnames. On 17 Oct, electron, neutrino and boson returned identical numbers (one backend). Check that DAA score, mempool and fee estimate differ over about 30 minutes before you count a node as separate.
- [ ] Miner test: 60 s, all found blocks accepted, 0 rejected. kaspa-miner over gRPC on your own node, or `wminer.mjs` over wRPC as the fallback. Never mine on a node that's supposed to stay a sender-only node.
- [ ] Coins and lanes read before the first gate, so the first minute after the go is a full minute.
- [ ] Every sender, miner and logger runs as an OS service that restarts itself. A progress watchdog runs on a different machine: restart if the node answers but the process writes nothing for 3 minutes. A watchdog stall kill never writes STOP; only an operator STOP blocks restarts.
- [ ] Every helper (fee reader, loggers, watchdog) uses the same `HARD_STOP_UTC` as the sender.
- [ ] Run the whole pre-check routine end to end once, on the machine that will actually send.
- [ ] One shared gate file in UTC that every side appends to and reads (G1, B0, A2, ...). Steps count as applied only once they've been acknowledged.
- [ ] Back up the run dir and lane state locally (never pushed).

## During the run

- [ ] Watch `pulse-minute.csv`: full minutes near the target, rejects by reason, `nodes_read`.
- [ ] A gap in the logs or a `virtual machine fork` line in `dmesg` means the host paused the machine. Note the times and label it a machine stall, not a network drop.
- [ ] After a stall, all nodes should come back on their own within about 40 s (30 s cool-off plus a healthy read), with no restart.
- [ ] Keep the sender ahead of the miners: if CPU stays above 90 %, cut workers first.
- [ ] Mining share for a gate: accepted blocks in the last 60 closed minutes (counting a new miner life after a counter reset) ÷ the change in `blockCount` on one node over the same minutes. Write it to a file the other side can read, live.
- [ ] Keep the fee fixed unless a measured reject says otherwise.

## After the run

- [ ] All senders, miners and helpers have stopped at the hard stop.
- [ ] Totals come from the minute file and are cross-checked against each process's `end` event (add the processes together if the sender was restarted).
- [ ] Generate the summary from the logs. Label machine stalls separately from network problems.
- [ ] Leak scan before pushing anything: no addresses, txids, IPs, ports, seeds, keys, tokens, tunnel URLs or local paths. Leave out `tx.jsonl` and lane-state files.
