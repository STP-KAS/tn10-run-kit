#!/usr/bin/env node
// fee-reads.mjs: one row per node per minute (aligned to :00 UTC) into <RUN_DIR>/fee-reads.csv
// (also linked as logs/fee-reads.csv). Read-only, never sends. Stops at HARD_STOP_UTC (+ FEE_READS_TAIL_S, default 0) or STOP file.
// Columns (LOGGING.md fee reads): utc,side,node,synced,sink_lag_s,virtual_daa,priority,normal0,low0,mempool_count,mempool_ready
// sink_lag_s = DAA distance behind the highest of the nodes / 10 (TN10 10 BPS). Empty cell = not measured.
import fs from "node:fs";
import { NODES, HERE, STOPF, iso, sleep, to, connectNode, flag } from "./lanes-lib.mjs";
const OUT = HERE + "/fee-reads.csv", END = Date.parse(process.env.HARD_STOP_UTC || "") + 1000 * Number(process.env.FEE_READS_TAIL_S || 0), ONCE = flag("once");
if (!Number.isFinite(END)) { console.error("REFUSE: set HARD_STOP_UTC"); process.exit(5); }
const COLS = "utc,side,node,synced,sink_lag_s,virtual_daa,priority,normal0,low0,mempool_count,mempool_ready";
if (!fs.existsSync(OUT) || fs.statSync(OUT).size === 0) fs.writeFileSync(OUT, COLS + "\n", { mode: 0o644 });
try { if (!fs.existsSync(HERE + "/logs/fee-reads.csv")) fs.symlinkSync("../fee-reads.csv", HERE + "/logs/fee-reads.csv"); } catch {}
const C = new Map();
async function read(n) {
  try { let c = C.get(n.name); if (!c || !c.isConnected) { try { await c?.disconnect(); } catch {} c = await connectNode(n, 8000); C.set(n.name, c); }
    const [si, dag, fe, info] = await Promise.all([to(c.getServerInfo(), 6000), to(c.getBlockDagInfo(), 6000), to(c.getFeeEstimate({}), 6000), to(c.getInfo(), 6000)]);
    const e = fe.estimate || fe; return { ok: true, synced: si.isSynced, daa: BigInt(dag.virtualDaaScore), pri: e.priorityBucket?.feerate, n0: e.normalBuckets?.[0]?.feerate, l0: e.lowBuckets?.[0]?.feerate, mp: Number(info.mempoolSize) };
  } catch (err) { const c = C.get(n.name); C.delete(n.name); try { c?.disconnect(); } catch {} return { ok: false }; }
}
while (true) {
  const t = iso(Math.floor(Date.now() / 60000) * 60000);
  const rs = await Promise.all(NODES.map(read));
  const max = rs.filter((r) => r.ok).reduce((a, r) => (r.daa > a ? r.daa : a), 0n);
  const f = (x) => (x == null ? "" : (Math.round(Number(x) * 1000) / 1000));
  const lines = NODES.map((n, i) => { const r = rs[i]; return r.ok ? [t, "bot", n.name, r.synced, Number(max - r.daa) / 10, String(r.daa), f(r.pri), f(r.n0), f(r.l0), r.mp, ""].join(",") : [t, "bot", n.name, "", "", "", "", "", "", "", ""].join(","); });
  fs.appendFileSync(OUT, lines.join("\n") + "\n");
  if (ONCE || Date.now() > END || fs.existsSync(STOPF)) break;
  await sleep(60000 - (Date.now() % 60000) + 200);
}
for (const c of C.values()) { try { await c.disconnect(); } catch {} }
process.exit(0);
