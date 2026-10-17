// lanes-lib.mjs: shared helpers for the TN10 bot sender. TESTNET-10 ONLY.
// Config comes from environment variables (see config.example.env). Lane shape = P2W:
// P2SH(push4(id) OP_DROP OP_TRUE), unsigned 1-in-1-out hops back into the same lane address, ~643 g, no payload.
// Label: no-signature hop, anyone-can-spend, not realistic payments. tKAS has no value.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
globalThis.WebSocket = require("websocket").w3cwebsocket;
const need = (k) => { const v = process.env[k]; if (!v) { console.error("REFUSE: set " + k + " (see config.example.env)"); process.exit(5); } return v; };
export const kaspa = require(need("KASPA_SDK"));   // path to kaspa-wasm32-sdk/nodejs/kaspa/kaspa.js (SDK 2.1.0)
export const NET = "testnet-10";
export const HERE = process.env.RUN_DIR || process.cwd();
export const STOPF = HERE + "/STOP";
export const TIPS = need("TIPS_FILE");   // lane state file: keep it local, mode 600, never in git
// NODES="name=host,name=host,..."  public TN10 wRPC hosts (or your own node). Example in config.example.env.
export const NODES = [
  ...need("NODES").split(",").map((p) => p.trim()).filter(Boolean).map((p) => { const [name, host] = p.split("="); return { name, host }; }),
].map((n) => ({ ...n, url: n.host.includes("://") ? n.host : `wss://${n.host}/kaspa/testnet-10/wrpc/borsh` }));
export const iso = (ms = Date.now()) => new Date(ms).toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
export const flag = (n) => process.argv.includes("--" + n);
export const to = (p, ms, l = "rpc") => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(l + " timeout")), ms))]);
export const ramMB = () => { try { return Math.round(Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) / 1024); } catch { return -1; } };
export const diskGB = () => { try { const s = fs.statfsSync(HERE); return Number(s.bavail) * Number(s.bsize) / 2 ** 30; } catch { return -1; } };

const le32 = (id) => Buffer.from(Uint32Array.of(id >>> 0).buffer).toString("hex");
export function laneScript(id) {
  const redeem = "04" + le32(id) + "75" + "51"; const spk = kaspa.payToScriptHashScript(redeem);
  return { id, redeem, sigScript: "07" + redeem, spk, address: kaspa.addressFromScriptPublicKey(spk, NET).toString() };
}
export const massOf = (tx) => Number(kaspa.calculateTransactionMass(NET, tx));
export const MIN_LANE = 30000000n;   // 0.3 tKAS: lane retires below this (KIP-9 storage mass)
export const MASS_MAX = 800;
// c = { txid, index, amount(BigInt), spk, sigScript, address }
export function buildHop(c, fr) {
  const ins = [{ address: c.address, outpoint: { transactionId: c.txid, index: c.index },
    utxoEntry: { amount: c.amount, scriptPublicKey: c.spk, blockDaaScore: 0n, isCoinbase: false } }];
  const mk = (amt) => { const t = kaspa.createTransaction(ins, [{ address: c.address, amount: amt }], 0n, null, 0); t.inputs[0].signatureScript = c.sigScript; return t; };
  let tx = mk(c.amount - 1n), m = massOf(tx), fee = BigInt(m) * fr, amt;
  for (let it = 0; it < 3; it++) { amt = c.amount - fee; if (amt < MIN_LANE) return null; tx = mk(amt); m = massOf(tx); const f2 = BigInt(m) * fr; if (f2 <= fee) break; fee = f2; }
  if (m > MASS_MAX) return null;
  return { tx, id: tx.id, fee, mass: m, amt };
}
// Pulse reject columns
export const REJ = ["orphan", "double_spend", "mempool_full", "fee_too_low", "mass", "rpc_timeout", "rpc_closed", "other"];
export function rejClass(raw) {
  const s = String(raw?.message || raw);
  if (/orphan/i.test(s)) return "orphan";
  if (/already spent|double.?spend|spent by|already in the mempool|already accepted|already exists/i.test(s)) return "double_spend";
  if (/mempool is full|mempool full|evict/i.test(s)) return "mempool_full";
  if (/fee|feerate/i.test(s)) return "fee_too_low";
  if (/mass/i.test(s)) return "mass";
  if (/timeout|timed out/i.test(s)) return "rpc_timeout";
  if (/closed|not connected|disconnect|websocket/i.test(s)) return "rpc_closed";
  return "other";
}
export const scrub = (s) => String(s?.message || s).replace(/[0-9a-f]{64}/gi, "<h>").replace(/kaspatest:[a-z0-9]+/g, "<addr>").replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>").slice(0, 160);
// tips file: [{ lane, id, node, txid, index, amount }]
export function loadTips(file = TIPS) {
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  return arr.map((e) => { const L = laneScript(e.id); return { lane: e.lane, node: e.node, ...L, txid: e.txid, index: Number(e.index), amount: BigInt(e.amount) }; });
}
export function saveTips(lanes, file = TIPS) {
  const arr = lanes.map((l) => ({ lane: l.lane, id: l.id, node: l.node, txid: l.txid, index: l.index, amount: String(l.amount) }));
  const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(arr), { mode: 0o600 }); fs.renameSync(tmp, file); fs.chmodSync(file, 0o600);
}
export async function connectNode(n, timeout = 10000) {
  const c = new kaspa.RpcClient({ url: n.url, encoding: kaspa.Encoding.Borsh, networkId: NET });
  await to(c.connect({ timeoutDuration: timeout, blockAsyncConnect: true }), timeout + 2000, "connect");
  return c;
}
