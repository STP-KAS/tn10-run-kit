#!/usr/bin/env node
// run-sender.mjs: TN10 bot sender, as used for our 17 Oct 2026 TN10 load test. TESTNET-10 ONLY. Shared as-is.
// Sticky lanes: one lane = one node (tips file field `node`); a lane never moves while a tx is in flight.
// ~643 g P2W hops, fixed fee (FEE_SOMPI_PER_GRAM), cap 300 tx/s, RAM floor 1.5 GB, node-dead rule, hard stop HARD_STOP_UTC,
// kill switch <RUN_DIR>/STOP, per-minute logs/pulse-minute.csv, per-second logs/sec.csv.
// Node-dead fix (17 Oct): a dead node comes back after a 30 s cool-off plus one fresh healthy read; recovery never
// depends on an error counter that only resets on recovery (that deadlocked all nodes after a box stall).
// Modes:  --dry            connect read-only, build hops, never submit
//         --test-n N       live submit N hops now (N<=49; lifetime ledger logs/test-sends.txt must stay < 50), then exit
//         --sim [--sim-s S] scheduler test: fake submits (no network submit), START ignored, no log files
//         --live           real run; needs SAT_LIVE=1; logs from launch, sends only from start_utc to the hard stop
// Prints no key, address or txid on stdout. logs/tx.jsonl keeps txids locally: NEVER commit it.
import fs from "node:fs";
import { kaspa, NODES, HERE, STOPF, TIPS, iso, sleep, arg, flag, to, ramMB, diskGB, buildHop, REJ, rejClass, scrub, loadTips, saveTips, connectNode, laneScript } from "./lanes-lib.mjs";

const HARD_STOP = Date.parse(process.env.HARD_STOP_UTC || "");
if (!Number.isFinite(HARD_STOP)) { console.error("REFUSE: set HARD_STOP_UTC, e.g. 2026-01-01T16:30:00Z"); process.exit(5); }
const HS_LABEL = new Date(HARD_STOP).toISOString();
const CAP = Math.min(300, Number(process.env.CAP_TX_S || 300)), FEE_FIXED = BigInt(process.env.FEE_SOMPI_PER_GRAM || 400), RAM_FLOOR_MB = 1536, MASS_EXPECT = 643;
const SIM = flag("sim"), SIM_S = Number(arg("sim-s", "20"));
const DRY = flag("dry") || SIM, TESTN = Number(arg("test-n", "0")), LIVE = flag("live");
if ([DRY, TESTN > 0, LIVE].filter(Boolean).length !== 1) { console.error("REFUSE: exactly one of --dry, --test-n N, --live"); process.exit(5); }
if (LIVE && process.env.SAT_LIVE !== "1") { console.error("REFUSE: --live needs SAT_LIVE=1"); process.exit(5); }
if (Date.now() >= HARD_STOP && !DRY) { console.error("REFUSE: past HARD_STOP " + HS_LABEL); process.exit(5); }
if (!DRY && fs.existsSync(STOPF)) { console.error("REFUSE: STOP file present"); process.exit(5); }
const LEDGER = HERE + "/logs/test-sends.txt";
if (TESTN > 0) { const used = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).length : 0;
  if (TESTN > 49 || used + TESTN >= 50) { console.error(`REFUSE: test sends would reach ${used + TESTN} (limit < 50)`); process.exit(5); } }
fs.mkdirSync(HERE + "/logs", { recursive: true });
// single instance
const LOCK = HERE + "/sender.lock";
if (!DRY) { try { const fd = fs.openSync(LOCK, "wx"); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); }
  catch { const pid = Number(fs.readFileSync(LOCK, "utf8")); let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
    if (alive) { console.error("REFUSE: another sender is running (pid " + pid + ")"); process.exit(5); } fs.writeFileSync(LOCK, String(process.pid)); } }

const readCtrl = () => { try { return JSON.parse(fs.readFileSync(HERE + "/control.json", "utf8")); } catch { return null; } };
let CTRL = readCtrl(); if (!CTRL) { console.error("REFUSE: bad control.json"); process.exit(5); }
const START = Date.parse(CTRL.start_utc || process.env.START_UTC || ""); if (!Number.isFinite(START)) { console.error("REFUSE: set start_utc in control.json or START_UTC"); process.exit(5); }
const FEE = BigInt(CTRL.fee_sompi_per_gram ?? FEE_FIXED); if (FEE !== FEE_FIXED) { console.error("REFUSE: control fee must equal FEE_SOMPI_PER_GRAM"); process.exit(5); }

const app = (f) => fs.createWriteStream(HERE + "/logs/" + f, { flags: "a", mode: 0o600 });
const EV = app("events.jsonl"), TXL = app("tx.jsonl"), SEC = app("sec.csv"), PM = app("pulse-minute.csv");
const hdr = (f, h) => { const p = HERE + "/logs/" + f; if (!fs.existsSync(p) || fs.statSync(p).size === 0) fs.appendFileSync(p, h + "\n", { mode: 0o600 }); };
const PM_COLS = ["minute_utc,side,step,target_tx_s,mempool_max", ...NODES.map((n) => "mempool_" + n.name), "nodes_read,submit_ok,rejects", ...REJ.map((r) => "rej_" + r)].join(",");
if (!DRY) { hdr("pulse-minute.csv", PM_COLS); hdr("sec.csv", "utc,step,target_tx_s,attempts,submit_ok,rejects,inflight,nodes_live,lanes_ready,ram_free_mb"); }
const ev = (o) => { const line = JSON.stringify({ t: iso(), mode: DRY ? "dry" : TESTN ? "test" : "live", ...o }); if (!DRY) EV.write(line + "\n"); console.log(line); };

// ---- lanes ----
let lanes = loadTips().map((l) => ({ ...l, busy: false, cool: 0, orph: 0, dead: false, resync: false }));
const byNode = new Map(NODES.map((n) => [n.name, []])); for (const l of lanes) byNode.get(l.node)?.push(l);
ev({ ev: "lanes_loaded", lanes: lanes.length, tkas: Number(lanes.reduce((a, l) => a + l.amount, 0n)) / 1e8 });

// ---- nodes ----
const N = NODES.map((n) => ({ ...n, conns: [], rr: 0, alive: false, coolUntil: 0, errRow: 0, daa: 0n, daaAt: 0, lastDaaChange: Date.now(), synced: false, mempool: null, readOk: false, inflight: 0, why: "init" }));
const NODE = new Map(N.map((n) => [n.name, n]));
async function ensureConns(n, k = 2) {
  for (let i = 0; i < k; i++) { const c = n.conns[i]; if (c && c.isConnected) continue;
    try { if (c) { try { await c.disconnect(); } catch {} } n.conns[i] = await connectNode(n, 8000); } catch (e) { n.conns[i] = null; } }
}
const conn = (n) => { const live = n.conns.filter((c) => c && c.isConnected); return live.length ? live[n.rr++ % live.length] : null; };
function setDead(n, why) { if (n.alive || n.why !== why) ev({ ev: "node-dead", node: n.name, why }); n.alive = false; n.why = why; n.coolUntil = Date.now() + 30000; }
async function health(n) {
  try {
    await ensureConns(n); const c = conn(n); if (!c) throw new Error("no connection");
    const [si, dag, info] = await Promise.all([to(c.getServerInfo(), 5000), to(c.getBlockDagInfo(), 5000), to(c.getInfo(), 5000)]);
    n.synced = !!si.isSynced; const d = BigInt(dag.virtualDaaScore); if (d !== n.daa) { n.daa = d; n.lastDaaChange = Date.now(); }
    n.mempool = Number(info.mempoolSize); n.readOk = true; n.readsThisMin = (n.readsThisMin || 0) + 1; return true;
  } catch (e) { n.readOk = false; n.mempool = null; setDead(n, "rpc:" + rejClass(e)); const old = n.conns; n.conns = []; for (const c of old) { try { c?.disconnect(); } catch {} } return false; }
}
async function healthAll() {
  await Promise.all(N.map(health));
  const maxDaa = N.filter((n) => n.readOk).reduce((a, n) => (n.daa > a ? n.daa : a), 0n);
  for (const n of N) { if (!n.readOk) continue;
    const lag = Number(maxDaa - n.daa) / 10; n.lag = lag; let bad = "";
    if (!n.synced) bad = "not-synced"; else if (lag > 60) bad = "lag>60s"; else if (Date.now() - n.lastDaaChange > 30000) bad = "daa-still-30s"; // node-dead fix: errRow>=20 marks dead in sendOne; a good health read after the 30 s cool brings it back (never re-check errRow here)
    if (bad) setDead(n, bad);
    else if (!n.alive && Date.now() >= n.coolUntil) { n.alive = true; n.errRow = 0; ev({ ev: "node-back", node: n.name, lag_s: lag }); n.why = "ok"; } }
}

// ---- counters ----
const zeroRej = () => Object.fromEntries(REJ.map((r) => [r, 0]));
let MIN = { m: Math.floor(Date.now() / 60000), ok: 0, rej: 0, rb: zeroRej(), tgt: 0 };
let SECC = { s: Math.floor(Date.now() / 1000), att: 0, ok: 0, rej: 0 };
const TOT = { att: 0, ok: 0, rej: 0, rb: zeroRej(), fee: 0n, mass: [] };
let stepNow = CTRL.step || "A0", targetNow = 0, holdWhy = "";
function flushMinute(partial = false) {
  const m = MIN; const mp = Object.fromEntries(N.map((n) => [n.name, n.mempool]));
  const vals = Object.values(mp).filter((v) => v != null); const nodesRead = N.filter((n) => (n.readsThisMin || 0) > 0).length;
  const row = [new Date(m.m * 60000).toISOString().slice(0, 16) + "Z" + (partial ? "-partial" : ""), "bot", stepNow, m.tgt, vals.length ? Math.max(...vals) : "",
    ...NODES.map((n) => mp[n.name] ?? ""), nodesRead, m.ok, m.rej, ...REJ.map((r) => m.rb[r])];
  if (!DRY) PM.write(row.join(",") + "\n"); for (const n of N) n.readsThisMin = 0;
}
function tickClocks() {
  const now = Date.now(); const s = Math.floor(now / 1000), m = Math.floor(now / 60000);
  if (s !== SECC.s) { if (!DRY) SEC.write([iso(SECC.s * 1000), stepNow, targetNow, SECC.att, SECC.ok, SECC.rej, inflight, N.filter((n) => n.alive).length, lanes.filter(ready).length, ramMB()].join(",") + "\n"); SECC = { s, att: 0, ok: 0, rej: 0 }; }
  if (m !== MIN.m) { flushMinute(); MIN = { m, ok: 0, rej: 0, rb: zeroRej(), tgt: targetNow }; }
}

// ---- submit ----
let inflight = 0;
const ready = (l) => !l.busy && !l.dead && l.cool <= Date.now() && NODE.get(l.node)?.alive;
async function resyncLane(l) {
  const n = NODE.get(l.node); const c = conn(n); if (!c) return false;
  try { const r = await to(c.getUtxosByAddresses({ addresses: [l.address] }), 8000); const es = (r.entries || []).filter((e) => !e.isCoinbase);
    if (!es.length) { l.dead = true; ev({ ev: "lane-empty", lane: l.lane }); return false; }
    es.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1)); const e = es[0];
    l.txid = e.outpoint.transactionId; l.index = e.outpoint.index; l.amount = BigInt(e.amount); l.resync = false; return true;
  } catch (e) { return false; }
}
async function sendOne(l) {
  l.busy = true; inflight++; const n = NODE.get(l.node); n.inflight++;
  try {
    if (l.resync && !(await resyncLane(l))) { l.cool = Date.now() + 3000; return; }
    const h = buildHop(l, FEE); if (!h) { l.dead = true; ev({ ev: "lane-retired", lane: l.lane, why: "below-min-or-mass" }); return; }
    const c = conn(n); if (!c) throw new Error("not connected");
    SECC.att++; TOT.att++; const t0 = Date.now();
    if (TOT.mass.length < 1000) TOT.mass.push(h.mass);
    if (DRY) { if (SIM) await sleep(80 + Math.random() * 120); SECC.ok++; TOT.ok++; return; }
    await to(c.submitTransaction({ transaction: h.tx, allowOrphan: false }), 10000, "submit");
    l.txid = h.id; l.index = 0; l.amount = h.amt; l.orph = 0; n.errRow = 0;
    SECC.ok++; MIN.ok++; TOT.ok++; TOT.fee += h.fee;
    TXL.write(JSON.stringify({ t: iso(t0), ms: Date.now() - t0, txid: h.id, node: n.name, lane: l.lane, mass: h.mass, ok: 1 }) + "\n");
    if (TESTN) fs.appendFileSync(LEDGER, iso() + " " + n.name + "\n");
  } catch (e) {
    const cls = rejClass(e); SECC.rej++; MIN.rej++; MIN.rb[cls]++; TOT.rej++; TOT.rb[cls]++;
    TXL.write(JSON.stringify({ t: iso(), node: n.name, lane: l.lane, ok: 0, cls, msg: scrub(e) }) + "\n");
    if (TESTN) fs.appendFileSync(LEDGER, iso() + " " + n.name + " rej\n");
    if (cls === "rpc_timeout" || cls === "rpc_closed") { n.errRow++; l.resync = true; l.cool = Date.now() + 3000; if (n.errRow >= 20) setDead(n, "20-rpc-errors"); }
    else if (cls === "orphan" || cls === "double_spend") { l.orph++; l.resync = true; l.cool = Date.now() + 2000; if (l.orph >= 8) { l.dead = true; ev({ ev: "lane-dropped", lane: l.lane, why: "8 orphans/double-spends" }); } }
    else l.cool = Date.now() + 400;
  } finally { l.busy = false; inflight--; n.inflight--; }
}

// ---- stop handling ----
let stopping = false;
async function shutdown(why) {
  if (stopping) return; stopping = true; ev({ ev: "stopping", why });
  const t = Date.now(); while (inflight > 0 && Date.now() - t < 10000) await sleep(100);
  if (!DRY) { saveTips(lanes); flushMinute(true); }
  ev({ ev: "end", why, attempts: TOT.att, submit_ok: TOT.ok, rejects: TOT.rej, rej: TOT.rb, fee_tkas: Number(TOT.fee) / 1e8,
    mass_p50: TOT.mass.sort((a, b) => a - b)[Math.floor(TOT.mass.length / 2)] ?? null, lanes_dead: lanes.filter((l) => l.dead).length });
  for (const n of N) for (const c of n.conns) { try { await c?.disconnect(); } catch {} }
  await new Promise((r) => { let k = 0; for (const s of [EV, TXL, SEC, PM]) s.end(() => { if (++k === 4) r(); }); setTimeout(r, 2000); });
  if (!DRY) { try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK); } catch {} }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM")); process.on("SIGINT", () => shutdown("SIGINT"));

// ---- main ----
ev({ ev: "start", cap: CAP, fee: Number(FEE), start_utc: iso(START), hard_stop_utc: iso(HARD_STOP), ram_floor_mb: RAM_FLOOR_MB, node_count: N.length });
await healthAll();
ev({ ev: "nodes", live: N.filter((n) => n.alive).map((n) => n.name), mempool: Object.fromEntries(N.map((n) => [n.name, n.mempool])) });
if ((DRY && !SIM) || TESTN) {
  const want = DRY ? Number(arg("n", "20")) : TESTN; const pick = []; const per = new Map();
  for (const l of lanes) { if (pick.length >= want) break; if (!ready(l)) continue; const k = per.get(l.node) || 0; if (k >= Math.ceil(want / 5)) continue; per.set(l.node, k + 1); pick.push(l); }
  for (const l of pick) { await sendOne(l); await sleep(DRY ? 0 : 250); }
  await shutdown(DRY ? "dry-done" : "test-done");
}
const SIM_T0 = Date.now(); let lastHealth = 0, lastCtrl = 0, lastSave = Date.now(), tokens = 0, lastTick = Date.now(), rrIdx = 0;
setInterval(() => { if (!stopping && Date.now() - lastHealth > 5000) { lastHealth = Date.now(); healthAll().catch(() => {}); } }, 1000);
while (!stopping) {
  const now = Date.now(); tickClocks();
  if (now >= HARD_STOP) { await shutdown("HARD_STOP " + HS_LABEL); break; }
  if (fs.existsSync(STOPF)) { await shutdown("STOP file"); break; }
  if (now - lastCtrl > 1000) { lastCtrl = now; const c = readCtrl(); if (c) CTRL = c; stepNow = String(CTRL.step || stepNow).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12); }
  let tgt = Math.min(CAP, Math.max(0, Number(CTRL.target_tx_s) || 0)); holdWhy = "";
  if (now < START && !SIM) { tgt = 0; holdWhy = "before-start"; }
  if (SIM && now - SIM_T0 > SIM_S * 1000) { await shutdown("sim-done"); break; }
  if (CTRL.hold) { tgt = 0; holdWhy = "hold"; }
  const ram = ramMB(); if (ram >= 0 && ram < RAM_FLOOR_MB) { if (holdWhy !== "ram") ev({ ev: "ram-hold", ram_free_mb: ram }); tgt = 0; holdWhy = "ram"; }
  if (tgt !== targetNow) { ev({ ev: "target", step: stepNow, target_tx_s: tgt, why: holdWhy || "control" }); targetNow = tgt; MIN.tgt = Math.max(MIN.tgt, tgt); }
  const dt = (now - lastTick) / 1000; lastTick = now; tokens = Math.min(tokens + tgt * dt, Math.max(tgt * 0.2, 1)); if (tgt === 0) tokens = 0;
  let guard = 0;
  while (tokens >= 1 && guard++ < lanes.length) { const l = lanes[rrIdx++ % lanes.length]; if (!ready(l)) continue; if (inflight > 400) break; tokens -= 1; sendOne(l); }
  if (now - lastSave > 15000) { lastSave = now; saveTips(lanes); }
  await sleep(10);
}
