// ArabChat Pro — single-file server + client
// (c) you — deploy on Render: build=npm install, start=node server.js

import express from "express";
import http from "http";
import { Server } from "socket.io";
import fetch from "node-fetch";

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

/* ====== SETTINGS ====== */
const SUPERADMIN_USER = "Rido77a";
const SUPERADMIN_PASS = "1200@";
const ROOM            = "#الوطن_العربي";
const REJOIN_SUPPRESS_MS = 5 * 60 * 1000;
const PUBLIC_HISTORY_LIMIT = 400;
const PM_HISTORY_LIMIT     = 200;

/* ====== ROLES & PERMS ====== */
const PERMS = {
  KICK:"kick", BAN_IP:"ban_ip", BAN_DEV:"ban_dev",
  CLEAR:"clear", STAR:"star", TEMP_OP:"temp_op", SPY:"spy"
};
const ROLE_DEFS = {
  superadmin: new Set(Object.values(PERMS)),
  admin:      new Set([PERMS.KICK, PERMS.BAN_IP, PERMS.BAN_DEV, PERMS.CLEAR, PERMS.STAR, PERMS.TEMP_OP, PERMS.SPY]),
  mod:        new Set([PERMS.KICK, PERMS.STAR, PERMS.TEMP_OP])
};

/* ====== STATE ====== */
const users = new Map();          // sid -> {nick, role, ip, ua, deviceId, flag, joinedAt}
const admins = new Map();         // nick -> role
const stars  = new Set();         // nick with star
const tempOps= new Set();         // nick temporary op
const bansIP = new Set();         // strings
const bansDV = new Set();         // deviceId
const spySids= new Set();         // sockets in spy mode
const pub    = [];                // public history
const pmHist = new Map();         // key "a|b" -> array
const presence = new Map();       // nick -> {j,l}

/* ====== HELPERS ====== */
const regLatin = /^[A-Za-z0-9_]{3,20}$/;
const sys = (t) => ({ nick:"النظام", text:t, isSys:true });
function isLatinNick(n){ return regLatin.test(n); }
function guest(){ return "Guest" + Math.floor(1000 + Math.random()*9000); }
function keyPM(a,b){ return [a,b].sort().join("|"); }
function pushPM(a,b,obj){ const k=keyPM(a,b); const arr = pmHist.get(k) || []; arr.push(obj); while(arr.length>PM_HISTORY_LIMIT) arr.shift(); pmHist.set(k,arr); }
function pushPub(m){ pub.push(m); while(pub.length>PUBLIC_HISTORY_LIMIT) pub.shift(); }
function listNicks(){ return Array.from(users.values()).map(u=>u.nick); }
function findByNick(n){ for(const [sid,u] of users) if(u.nick===n) return {sid,u}; return null; }
function hasPerm(role,p){ if(role==="superadmin") return true; return (ROLE_DEFS[role]||new Set()).has(p); }
function isOp(n){ return n===SUPERADMIN_USER || admins.has(n) || tempOps.has(n); }
function ipOf(s){ const xf = s.handshake.headers["x-forwarded-for"]; return (xf?xf.split(",")[0].trim():s.handshake.address||"").replace("::ffff:",""); }
function uaOf(s){ return (s.handshake.headers["user-agent"]||"").slice(0,160); }
function now(){ return Date.now(); }
function joinAllowed(nick,type){
  const o = presence.get(nick)||{};
  const k = type==="join"?"j":"l";
  const last = o[k]||0;
  o[k]=now(); presence.set(nick,o);
  return now()-last > REJOIN_SUPPRESS_MS;
}
function emojiFlag(cc){ // "US"->🇺🇸
  if(!cc || cc.length!==2) return "🏳️";
  const A=0x1F1E6, base='A'.charCodeAt(0);
  const f = String.fromCodePoint(A+cc[0].toUpperCase().charCodeAt(0)-base, A+cc[1].toUpperCase().charCodeAt(0)-base);
  return f;
}
async function lookupFlag(ip){
  try{
    if(!ip || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16") || ip.startsWith("127.") || ip.includes(":")) return "🏳️";
    const r = await fetch(`https://ipapi.co/${ip}/country_code/`, {timeout:3000});
    const cc = (await r.text()).trim();
    return emojiFlag(cc);
  }catch{ return "🏳️"; }
}

/* ====== HTTP (Single-page) ====== */
app.get("/", (req,res)=>{
  res.setHeader("content-type","text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="dark">
<title>مرسال الجديد</title>
<style>
*{box-sizing:border-box} html,body{height:100%}
:root{
  --safe-bottom: env(safe-area-inset-bottom,0px);
  --composerH: 56px;
  --accent:#16a34a; --line:#1f2a3d; --bg:#0b0f17; --card:#0f1624; --muted:#94a3b8; --text:#e5e7eb;
}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Tahoma,Arial,sans-serif;overscroll-behavior:none;overflow:hidden}
.hidden{display:none!important}
.hdr{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 12px;display:flex;align-items:center;gap:10px}
.logo{color:#facc15;font-weight:800}
.adminbar{display:flex;gap:6px}
.btn{padding:8px 12px;border-radius:10px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
.btn.g{border-color:var(--accent);background:var(--accent);color:#fff}
.app{height:calc(100dvh - 56px);display:flex;flex-direction:column;max-width:1024px;margin:0 auto;padding:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.grid{display:grid;gap:12px;grid-template-columns:280px 1fr 280px;flex:1;min-height:0}
.pane{background:var(--card);border:1px solid var(--line);border-radius:12px;min-height:0;display:flex;flex-direction:column}
.panehead{display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid var(--line)}
.scroll{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
#msgs{list-style:none;margin:0;padding:8px 8px calc(var(--composerH) + var(--safe-bottom) + 8px);border-top:1px solid var(--line)}
.msg{margin:6px 0}
.nick{font-weight:800}
.nick.op::after{content:" ~";color:#f59e0b}
.nick.star::after{content:" 🌟"}
.flag{opacity:.9;margin-inline:4px}
.sys{color:var(--muted)}
.composer{position:sticky;bottom:0;background:var(--bg);padding:8px 8px calc(6px + var(--safe-bottom));border-top:1px solid var(--line);display:grid;grid-template-columns:1fr auto;gap:8px;z-index:2}
input,select{padding:10px;border-radius:10px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
ul.clean{list-style:none;margin:0;padding:8px;display:grid;gap:6px}
li.row{display:flex;align-items:center;justify-content:space-between;gap:6px}
a.small{color:#93a3b8;text-decoration:underline;cursor:pointer}
.badge{border:1px solid #273449;border-radius:999px;padding:2px 8px;color:#93a3b8}
@media (max-width: 920px){ .grid{grid-template-columns:1fr} .pane.side{order:-1} }
</style>
</head><body>
<header class="hdr">
  <div class="logo">💬 شات الوطن العربي</div>
  <div id="adminBar" class="adminbar hidden">
    <button class="btn" id="btnClear">🧹 مسح</button>
    <button class="btn" id="btnSpy">👁️ تجسس خاص</button>
    <button class="btn" id="btnBans">🚫 محظورين</button>
  </div>
</header>

<main class="app">
  <!-- Login -->
  <section id="login" class="card">
    <h2>دخول</h2>
    <input id="nick" placeholder="الاسم (إنجليزي فقط)" dir="ltr">
    <details><summary>تسجيل دخول مشرف</summary>
      <input id="auser" placeholder="اسم الأدمن" value="">
      <input id="apass" type="password" placeholder="رمز الأدمن">
    </details>
    <button class="btn g" id="enter">دخول الغرفة</button>
    <div class="sys">يسمح بحروف إنجليزية/أرقام/شرطة سفلية (3–20). الأسماء العربية تُحوّل إلى ضيف تلقائيًا.</div>
  </section>

  <!-- Chat -->
  <section id="chat" class="grid hidden">
    <aside class="pane side">
      <div class="panehead"><div>المتواجدون <span class="badge" id="count">0</span></div></div>
      <ul id="nicklist" class="scroll clean"></ul>
    </aside>

    <section class="pane">
      <div class="panehead">
        <div>#الوطن_العربي</div>
        <div id="youBadge" class="badge"></div>
      </div>
      <ul id="msgs" class="scroll"></ul>
      <div class="composer">
        <input id="text" placeholder="اكتب رسالة…" autocomplete="off">
        <button class="btn g" id="send">إرسال</button>
      </div>
    </section>

    <aside class="pane side">
      <div class="panehead"><div>محادثات خاصة</div></div>
      <ul id="pmList" class="scroll clean"></ul>
    </aside>
  </section>

  <!-- Modals -->
  <section id="modal" class="hidden" style="position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:50">
    <div class="card" style="width:min(92vw,520px)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h3 id="modalTitle" style="margin:0">خيارات</h3>
        <button class="btn" id="modalClose">✖</button>
      </div>
      <div id="modalBody"></div>
    </div>
  </section>
</main>

<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script>
const $=s=>document.querySelector(s);
const E=(h)=>{const d=document.createElement("div");d.innerHTML=h.trim();return d.firstChild;}

let sock, you={nick:"", role:"user", isOp:false, star:false, flag:"🏳️"}, spy=false;

// ===== viewport/composer fix for iPhone =====
(function fixComposerPad(){
  const composer = document.querySelector('.composer');
  function setPad(){
    if(!composer) return;
    const h = composer.offsetHeight || 56;
    document.documentElement.style.setProperty('--composerH', h+'px');
  }
  new ResizeObserver(setPad).observe(composer);
  if (window.visualViewport){
    visualViewport.addEventListener('resize', setPad);
    visualViewport.addEventListener('scroll', setPad);
  }
  window.addEventListener('resize', setPad);
  document.addEventListener('DOMContentLoaded', setPad);
  setTimeout(setPad,50);
})();

// ===== local deviceId (not IMEI) =====
let deviceId = localStorage.getItem('deviceId');
if(!deviceId){
  deviceId = (crypto.randomUUID? crypto.randomUUID() : 'dev-'+Math.random().toString(36).slice(2));
  localStorage.setItem('deviceId', deviceId);
}

// ===== UI actions =====
$("#enter").onclick=()=>{
  sock = io();

  sock.on("connect", ()=>{
    const nick  = $("#nick").value.trim() || localStorage.getItem("lastNick") || "";
    const auser = $("#auser").value.trim();
    const apass = $("#apass").value.trim();
    sock.emit("enter", {nick, adminUser:auser, adminPass:apass, deviceId});
  });

  sock.on("hello", ({me, users, history})=>{
    you=me; you.isOp = me.isOp; you.role=me.role; you.flag=me.flag; you.star=me.star;
    $("#youBadge").textContent = you.flag+" "+you.nick+(you.isOp?" ~":"")+(you.star?" 🌟":"");
    $("#login").classList.add("hidden"); $("#chat").classList.remove("hidden");
    renderUsers(users);
    $("#msgs").innerHTML="";
    history.forEach(m=>addMsg(m));
    localStorage.setItem("lastNick", you.nick);
  });

  sock.on("users", renderUsers);
  sock.on("sys", t=> addSys(t));
  sock.on("chat", m=> addMsg(m));
  sock.on("pm",   ({from,to,msg})=>{
    addPM(from,to,msg);
    if (spy && you.isOp) addSys("🔍 (تجسس) "+from+" ⇄ "+to+": "+msg.text);
  });
  sock.on("spy", s=>{ spy=s; $("#btnSpy").classList.toggle("g", spy); });
  sock.on("bans", showBansModal);

  $("#send").onclick = sendMsg;
  $("#text").addEventListener("keydown", e=>{
    if(e.key==="Enter"){ e.preventDefault(); sendMsg(); }
  });
};
function sendMsg(){
  const t=$("#text").value.trim(); if(!t) return;
  sock.emit("chat", t);
  $("#text").value=""; setTimeout(()=>$("#text").focus(), 10);
}

function addMsg(m){
  const li=E(\`<li class="msg">\${m.isSys?'<span class="sys">':''}
    \${m.isSys?m.text:\`<span class="flag">\${m.flag||"🏳️"}</span><span class="nick\${m.isOp?' op':''}\${m.hasStar?' star':''}" data-nick="\${m.nick}">\${m.nick}</span>: \${escapeHTML(m.text)}\`}
    \${m.isSys?'</span>':''}</li>\`);
  $("#msgs").appendChild(li);
  $("#msgs").scrollTop=$("#msgs").scrollHeight;
  const nk = li.querySelector(".nick"); if(nk) nk.onclick=()=>showUserActions(nk.dataset.nick);
}
function addSys(t){ addMsg({isSys:true,text:t}); }
function escapeHTML(s){ return s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }

function renderUsers(list){
  $("#count").textContent=list.length;
  const ul=$("#nicklist"); ul.innerHTML="";
  list.forEach(u=>{
    const li=E(\`<li class="row"><div><span class="flag">\${u.flag||"🏳️"}</span><span class="nick\${u.isOp?' op':''}\${u.star?' star':''}" data-nick="\${u.nick}">\${u.nick}</span></div><a class="small" data-nk="\${u.nick}">خيارات</a></li>\`);
    ul.appendChild(li);
  });
  ul.querySelectorAll(".nick").forEach(n=> n.onclick=()=>showUserActions(n.dataset.nick));
  ul.querySelectorAll("a.small").forEach(a=> a.onclick=()=>showUserActions(a.dataset.nk));
  $("#adminBar").classList.toggle("hidden", !you.isOp);
}

function showUserActions(nick){
  const me=you.isOp;
  const body=$("#modalBody"); body.innerHTML="";
  $("#modalTitle").textContent="خيارات • "+nick;

  if(nick===you.nick){
    body.appendChild(E('<div class="sys">هذا أنت.</div>'));
  }else{
    if(me){
      body.appendChild(E(\`<button class="btn" id="kick">طرد</button>\`));
      body.appendChild(E(\`<button class="btn" id="banip">حظر IP</button>\`));
      body.appendChild(E(\`<button class="btn" id="bandv">حظر جهاز</button>\`));
      body.appendChild(E(\`<button class="btn" id="star">🌟 منح/إزالة نجمة</button>\`));
      body.appendChild(E(\`<button class="btn" id="tempop">~ توكيل مؤقت</button>\`));
    }
    body.appendChild(E(\`<button class="btn g" id="pm">رسالة خاصة</button>\`));
  }
  $("#modal").classList.remove("hidden");
  $("#modalClose").onclick=()=>$("#modal").classList.add("hidden");

  if(me){
    $("#kick") && ($("#kick").onclick=()=>{ sock.emit("cmd",{t:"kick",nick}); closeM(); });
    $("#banip")&& ($("#banip").onclick=()=>{ sock.emit("cmd",{t:"ban_ip",nick}); closeM(); });
    $("#bandv")&& ($("#bandv").onclick=()=>{ sock.emit("cmd",{t:"ban_dev",nick}); closeM(); });
    $("#star") && ($("#star").onclick=()=>{ sock.emit("cmd",{t:"star",nick}); closeM(); });
    $("#tempop")&&($("#tempop").onclick=()=>{ sock.emit("cmd",{t:"temp_op",nick}); closeM(); });
  }
  $("#pm") && ($("#pm").onclick=()=>{ startPM(nick); closeM(); });
  function closeM(){ $("#modal").classList.add("hidden"); }
}

function startPM(to){
  const msg = prompt("أكتب رسالة إلى "+to);
  if(!msg || !msg.trim()) return;
  sock.emit("pm",{to, text:msg.trim()});
}
function addPM(from,to,msg){
  const other = (from===you.nick)? to : from;
  const li = E(\`<li class="row"><div><span class="flag">\${msg.flag||"🏳️"}</span><b>\${other}</b> — خاص</div><a class="small">فتح</a></li>\`);
  li.querySelector("a").onclick=()=> alert(\`[\${from} → \${to}]\n\${msg.text}\`);
  $("#pmList").prepend(li);
}

$("#btnClear").onclick = ()=> sock.emit("cmd",{t:"clear"});
$("#btnSpy").onclick   = ()=> sock.emit("cmd",{t:"spy", on: !document.getElementById("btnSpy").classList.contains("g")});
$("#btnBans").onclick  = ()=> sock.emit("cmd",{t:"bans"});

$("#modalClose").onclick=()=>$("#modal").classList.add("hidden");

</script>
</body></html>`);
});

/* ====== SOCKET ====== */
io.on("connection", (socket)=>{
  const ip = ipOf(socket);
  const ua = uaOf(socket);
  if (bansIP.has(ip)) { socket.disconnect(true); return; }

  socket.on("enter", async ({nick,adminUser,adminPass,deviceId})=>{
    if (bansDV.has(deviceId)) { socket.disconnect(true); return; }

    let role = "user";
    let n = (nick||"").trim();
    if (adminUser===SUPERADMIN_USER && adminPass===SUPERADMIN_PASS){
      role="superadmin"; n=SUPERADMIN_USER; admins.set(n,"superadmin");
    }else if(!isLatinNick(n)){ n = guest(); }

    if (listNicks().includes(n)) n = guest();

    const flag = await lookupFlag(ip);

    users.set(socket.id, {nick:n, role, ip, ua, deviceId, flag, joinedAt:now()});
    socket.join(ROOM);

    const meInfo = {nick:n, role, isOp:isOp(n), star:stars.has(n), flag};
    socket.emit("hello", {
      me: meInfo,
      users: Array.from(users.values()).map(u=>({nick:u.nick,isOp:isOp(u.nick),star:stars.has(u.nick),flag:u.flag})),
      history: pub
    });

    if (joinAllowed(n,"join")){
      const t = `✅ ${n} دخل`;
      pushPub(sys(t)); io.to(ROOM).emit("sys",t);
    }
    io.to(ROOM).emit("users", Array.from(users.values()).map(u=>({nick:u.nick,isOp:isOp(u.nick),star:stars.has(u.nick),flag:u.flag})));
  });

  socket.on("chat", (text)=>{
    const u = users.get(socket.id); if(!u) return;
    const msg = {nick:u.nick, text:String(text).slice(0,600), isOp:isOp(u.nick), hasStar:stars.has(u.nick), flag:u.flag};
    pushPub(msg);
    io.to(ROOM).emit("chat", msg);
  });

  socket.on("pm", ({to,text})=>{
    const u = users.get(socket.id); if(!u) return;
    const target = findByNick(to); if(!target) return;
    const msg = {from:u.nick,to:to,text:String(text).slice(0,600),flag:u.flag};
    pushPM(u.nick,to,msg);
    io.to(target.sid).emit("pm",{from:u.nick,to, msg});
    io.to(socket.id).emit("pm",{from:u.nick,to, msg});
    // spy to ops in spy mode
    spySids.forEach(sid=>{
      const op = users.get(sid);
      if(op && isOp(op.nick)) io.to(sid).emit("pm",{from:u.nick,to, msg});
    });
  });

  socket.on("cmd", (c)=>{
    const u = users.get(socket.id); if(!u) return;
    const role = u.role;
    function ok(p){ return hasPerm(role,p); }
    if (c.t==="clear"){
      if(!ok(PERMS.CLEAR)) return;
      pub.length=0; io.to(ROOM).emit("sys","🧹 تم مسح الدردشة بواسطة المشرف.");
      return;
    }
    if (c.t==="spy"){
      if(!ok(PERMS.SPY)) return;
      if(c.on){ spySids.add(socket.id); } else { spySids.delete(socket.id); }
      io.to(socket.id).emit("spy", !!c.on);
      return;
    }
    if (c.t==="bans"){
      if(!u.isOp && !ok(PERMS.BAN_IP)) return;
      const list = {
        ip: Array.from(bansIP),
        dev: Array.from(bansDV)
      };
      io.to(socket.id).emit("bans", list);
      return;
    }
    if (["kick","ban_ip","ban_dev","star","temp_op"].includes(c.t)){
      const tgt = findByNick(c.nick); if(!tgt) return;
      if (c.t==="kick"){ if(!ok(PERMS.KICK)) return; io.to(tgt.sid).disconnectSockets(true); io.to(ROOM).emit("sys",`🚫 تم طرد ${tgt.u.nick}`); }
      if (c.t==="ban_ip"){ if(!ok(PERMS.BAN_IP)) return; bansIP.add(tgt.u.ip); io.to(tgt.sid).disconnectSockets(true); io.to(ROOM).emit("sys",`🚫 تم حظر مستخدم.`); }
      if (c.t==="ban_dev"){ if(!ok(PERMS.BAN_DEV)) return; bansDV.add(tgt.u.deviceId); io.to(tgt.sid).disconnectSockets(true); io.to(ROOM).emit("sys",`🚫 تم حظر مستخدم.`); }
      if (c.t==="star"){ if(!ok(PERMS.STAR)) return; if(stars.has(tgt.u.nick)) stars.delete(tgt.u.nick); else stars.add(tgt.u.nick); io.to(ROOM).emit("users", Array.from(users.values()).map(u=>({nick:u.nick,isOp:isOp(u.nick),star:stars.has(u.nick),flag:u.flag}))); }
      if (c.t==="temp_op"){ if(!ok(PERMS.TEMP_OP)) return; if(tempOps.has(tgt.u.nick)) tempOps.delete(tgt.u.nick); else tempOps.add(tgt.u.nick); io.to(ROOM).emit("sys",`تم توكيل ${tgt.u.nick}`); io.to(ROOM).emit("users", Array.from(users.values()).map(u=>({nick:u.nick,isOp:isOp(u.nick),star:stars.has(u.nick),flag:u.flag}))); }
    }
  });

  socket.on("disconnect", ()=>{
    const u = users.get(socket.id); if(!u) return;
    users.delete(socket.id);
    if (joinAllowed(u.nick,"leave")){
      const t = `👋 ${u.nick} خرج`;
      pushPub(sys(t)); io.to(ROOM).emit("sys", t);
    }
    io.to(ROOM).emit("users", Array.from(users.values()).map(u=>({nick:u.nick,isOp:isOp(u.nick),star:stars.has(u.nick),flag:u.flag})));
    spySids.delete(socket.id);
  });
});

/* ====== START ====== */
srv.listen(PORT, ()=> console.log("ArabChat Pro running on http://localhost:"+PORT));
