// Stress check for the display (B6): 400 random view changes, 0 to 30 ms apart,
// per seed (questions, options, pictures and standings shuffled), then five known
// views whose text must be on screen. Fails on any page error. A Playwright tool,
// not a bun test (like screenshots.cjs).
//
//   bun run fixtures --port 8091 &
//   node tests/display/stress.cjs [baseUrl] [seeds, e.g. 1,2,3]
const { chromium } = require("../../tools/browser/playwright.cjs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const BASE = process.argv[2] || "http://localhost:8091";
const SEEDS = (process.argv[3] || "1,2,3,4,5,6").split(",").map(Number);
const names=["idle","lobby","lobby-holding","round_intro","asking","asking-image","asking-locked","asking-round","marking","reveal","leaderboard","halftime","leaderboard-20","leaderboard-30","sudden_death","sudden_death-revealed","ended"];
function grab(name){ return new Promise((res,rej)=>{ const ws=new WebSocket(BASE.replace("http","ws")+"/ws?fixture=display/"+name); ws.onopen=()=>ws.send(JSON.stringify({t:"hello",protocol:1,role:"display"})); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.t==="state"){ws.close(); res(m.view);}}; ws.onerror=rej; }); }
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
async function run(views, b, s) {
 seed = s;
 const p=await b.newPage({viewport:{width:1280,height:720}});
 const errs=[]; p.on("pageerror",e=>errs.push(e.message));
 await p.route(/\/vendor\//,r=>r.fulfill({path:path.join(ROOT,"public",new URL(r.request().url()).pathname),contentType:"text/javascript"}));
 await p.route(/\/(qr|media)\//,r=>r.fulfill({body:"<svg xmlns='http://www.w3.org/2000/svg'/>",contentType:"image/svg+xml"}));
 let sock, now0;
 await p.routeWebSocket(/\/ws/, ws=>{ const srv=ws.connectToServer(); sock=ws; srv.onMessage(m=>{const o=JSON.parse(m); if(o.t==="state") now0=o.serverNow; ws.send(m);}); ws.onMessage(m=>srv.send(m)); });
 await p.goto(BASE+"/display?fixture=display%2Fidle"); await p.waitForTimeout(800);
 let seq=10;
 for(let i=0;i<400;i++){ const n=names[Math.floor(rnd()*names.length)]; const v=JSON.parse(JSON.stringify(views[n])); if(v.question&&rnd()<0.5) v.question.answered=Math.floor(rnd()*6);
   if(v.question&&v.question.status==="open"){ const k=Math.floor(rnd()*3); v.question.number=1+Math.floor(rnd()*5); v.question.text="Question text "+i; v.question.image=k===2?"/media/q/x"+i:null; v.question.input=k===1?{type:"choice",options:["One "+i,"Two","Three"].slice(0,2+Math.floor(rnd()*2))}:{type:"text"}; }
   if(v.standings&&rnd()<0.5){ const r=v.standings.rows; const a=Math.floor(rnd()*r.length), c=Math.floor(rnd()*r.length); const t=r[a]; r[a]=r[c]; r[c]=t; }
   sock.send(JSON.stringify({t:"state",seq:seq++,serverNow:now0,view:v})); await p.waitForTimeout(Math.floor(rnd()*30)); }
 const finals=[["reveal","Aretha Franklin"],["halftime","Halftime"],["asking","Who sang"],["sudden_death-revealed","take 1st place"],["lobby","BKTW"]];
 const bad=[];
 for(const [n,want] of finals){ sock.send(JSON.stringify({t:"state",seq:seq++,serverNow:now0,view:views[n]})); await p.waitForTimeout(1500);
   const txt=await p.evaluate(()=>document.getElementById("display").innerText.replace(/\s+/g," ")); if(!txt.includes(want) || /=>|renderTemplate/.test(txt)) bad.push(n+": "+txt.slice(0,100)); }
 await p.close();
 return { seed: s, errors: errs.length, kinds: [...new Set(errs)], bad };
}

(async () => {
  const views = {}; for (const n of names) views[n] = await grab(n);
  const b = await chromium.launch();
  const results = [];
  for (const s of SEEDS) results.push(await run(views, b, s));
  await b.close();
  for (const r of results) console.log(JSON.stringify(r));
  process.exitCode = results.some((r) => r.errors || r.bad.length) ? 1 : 0;
})().catch((e) => { console.log(e); process.exitCode = 1; });
