// TN10-only wRPC CPU miner (Kaspa WASM SDK 2.1.0). Fallback when gRPC is closed (e.g. the public TN10 nodes).
// Usage: KASPA_SDK=<path to kaspa.js> WS_MOD=<path to websocket/index.js> \
//        node wminer.mjs <your TN10 address> <workers> <seconds|0=forever> <host1,host2,...>
// No restart loop inside: run it under a supervisor that watches progress (see CHECKLIST.md).
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const SDK = process.env.KASPA_SDK; if (!SDK) { console.error('set KASPA_SDK'); process.exit(1); }
const WS  = process.env.WS_MOD;     if (!WS)  { console.error('set WS_MOD'); process.exit(1); }
const toURL = p => p.startsWith('file:') ? p : (p.match(/^[A-Za-z]:\\/) ? 'file:///'+p.replace(/\\/g,'/') : p);
if (isMainThread) {
  const [addr, nw='2', secs='60', hostsArg=process.env.MINER_HOSTS || ''] = process.argv.slice(2);
  if (!addr || !addr.startsWith('kaspatest:')) { console.error('need kaspatest: address (TN10 only)'); process.exit(1); }
  const hosts = hostsArg.split(',').filter(Boolean); if (!hosts.length) { console.error('give hosts or set MINER_HOSTS'); process.exit(1); } const N = Number(nw); const tot = {hashes:0, found:0, ok:0, rej:0};
  const ws = [];
  for (let i=0;i<N;i++){ const w = new Worker(fileURLToPath(import.meta.url), { workerData:{addr, host:hosts[i%hosts.length], id:i, SDK, WS} });
    w.on('message', m => { for (const k in m) tot[k]+=m[k]; }); w.on('error', e=>console.error('worker',i,e)); ws.push(w); }
  const t0 = Date.now();
  const iv = setInterval(()=>{ const dt=(Date.now()-t0)/1000; console.log(new Date().toISOString(), `t=${dt.toFixed(0)}s H/s=${Math.round(tot.hashes/dt)} found=${tot.found} accepted=${tot.ok} rejected=${tot.rej}`); }, 10000);
  if (Number(secs)>0) setTimeout(()=>{ clearInterval(iv); const dt=(Date.now()-t0)/1000; console.log('FINAL', JSON.stringify({...tot, secs:dt, hps:Math.round(tot.hashes/dt)})); process.exit(0); }, Number(secs)*1000);
} else {
  const {addr, host, id, SDK, WS} = workerData;
  globalThis.WebSocket = (await import(toURL(WS))).default.w3cwebsocket;
  const k = await import(toURL(SDK));
  const c = new k.RpcClient({url:`wss://${host}/kaspa/testnet-10/wrpc/borsh`, encoding:k.Encoding.Borsh, networkId:'testnet-10'});
  await c.connect();
  const si = await c.getServerInfo(); if (si.networkId !== 'testnet-10') { console.error('NOT TN10, abort'); process.exit(1); }
  let cur=null, pow=null, fetching=false;
  const refresh = async()=>{ if(fetching) return; fetching=true; try{ const bt=await c.getBlockTemplate({payAddress:addr, extraData:'wminer'}); cur=bt.block; pow?.free?.(); pow=new k.PoW(cur.header);}catch(e){console.error('tmpl',host,String(e).slice(0,100))} fetching=false; };
  await refresh(); setInterval(refresh, 1000);
  let n = BigInt(Math.floor(Math.random()*2**52)) << 8n; let h=0;
  setInterval(()=>{ parentPort.postMessage({hashes:h}); h=0; }, 2000);
  const loop = async()=>{
    for(;;){ const p=pow, b=cur; for(let i=0;i<3000;i++){ const [ok]=p.checkWork(n); n++; h++;
        if(ok){ parentPort.postMessage({found:1}); b.header.nonce=n-1n;
          c.submitBlock({block:b, allowNonDAABlocks:false}).then(r=>parentPort.postMessage(r.report.type==='success'?{ok:1}:{rej:1}), e=>{console.error('submit',String(e).slice(0,100)); parentPort.postMessage({rej:1})});
          await refresh(); break; } }
      await new Promise(r=>setImmediate(r)); }
  }; loop();
}
