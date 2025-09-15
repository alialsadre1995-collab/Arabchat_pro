const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingInterval: 15000, pingTimeout: 30000 });
const PORT = process.env.PORT || 3000;

// إعدادات
const ROOM = "#الوطن_العربي";
const ADMIN_USER = "ArabAdmin";
const ADMIN_PASS = "az77@";

// الحالة
// users: socket.id -> {nick, ip, isOp, ua, connectedAt}
const users = new Map();
const bansByIP = new Set();
const bansByUA = new Set(); // حظر حسب الجهاز (User-Agent)

// صفحة واحدة (HTML + CSS + JS) — واجهة مثل واتساب + إصلاح iPhone
app.get("/", (req, res) => {
  res.setHeader("content-type","text/html; charset=utf-8");
  res.end(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>شات الوطن العربي</title>
<style>
*{box-sizing:border-box}html,body{height:100%}:root{--vh:1vh}
body{margin:0;background:#0b0f17;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Tahoma,Arial,sans-serif}
.hdr{position:sticky;top:0;background:#0f1624;border-bottom:1px solid #1f2a3d;padding:10px 12px;display:flex;gap:10px;align-items:center;z-index:5}
.logo{color:#facc15;font-weight:700}
.adminbar button{border:1px solid #273449;background:#0b0f17;color:#e5e7eb;border-radius:10px;padding:6px 10px}
.app{max-width:1000px;margin:0 auto;padding:12px}
.card{background:#0f1624;border:1px solid #1f2a3d;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.card input,.composer input,.pmwrap input{padding:12px;border-radius:12px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
.card button,.sendbtn,.pmwrap button,.ghost{padding:12px;border-radius:12px;border:1px solid #22c55e;background:#16a34a;color:#fff}
.ghost{background:transparent;border-color:#273449;color:#e5e7eb}
.hidden{display:none !important}
#chat{display:grid;grid-template-columns:280px 1fr 280px;gap:12px;min-height:calc(100dvh - 56px)}
.center{display:flex;flex-direction:column;gap:8px}
.msgs{list-style:none;margin:0;padding:8px;border:1px solid #1f2a3d;border-radius:12px;flex:1;overflow:auto}
.msg{margin:6px 0}
.nick{color:#60a5fa;font-weight:700}.op{color:#f59e0b}.sys{color:#94a3b8}
.count{border:1px solid #273449;border-radius:999px;padding:4px 10px;color:#93a3b8}
.leftpane,.rightpane{background:#0f1624;border:1px solid #1f2a3d;border-radius:12px;overflow:auto}
.panehead{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #1f2a3d}
#pmConvos,#nicklist{list-style:none;margin:0;padding:8px;display:grid;gap:6px}
#pmConvos li,#nicklist li{background:#0b0f17;border:1px solid #1f2a3d;border-radius:10px;padding:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center}
.badge{font-size:12px;color:#f59e0b}
.composer{display:grid;grid-template-columns:1fr auto;gap:8px}
.sheet{position:fixed;left:0;right:0;bottom:0;background:#0f1624;border-top:1px solid #1f2a3d;border-radius:14px 14px 0 0;padding:12px;z-index:9999}
.sheettop{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sheetbtns{display:grid;gap:8px}.sheetbtns button{padding:12px;border-radius:12px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
.pmLog{list-style:none;margin:8px 0 0;padding:0;max-height:50vh;overflow:auto;border:1px solid #1f2a3d;border-radius:10px;padding:8px}
.bans{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.bans li{background:#0b0f17;border:1px solid #1f2a3d;border-radius:10px;padding:8px;display:flex;justify-content:space-between;align-items:center}
.banswrap h4{margin:8px 0 4px;color:#93a3b8}
@media(max-width:900px){#chat{grid-template-columns:1fr}.leftpane,.rightpane{display:none;position:fixed;inset:56px 10px 10px 10px;z-index:998}.leftpane.open,.rightpane.open{display:block}}
</style>
<script>
function setVH(){document.documentElement.style.setProperty('--vh',(window.innerHeight*0.01)+'px')}
addEventListener('resize',setVH);addEventListener('orientationchange',setVH);addEventListener('load',setVH);
</script>
</head><body>
<header class="hdr">
  <div class="logo">💬 شات الوطن العربي</div>
  <div id="adminBar" class="adminbar hidden"><button id="btnBans">المحظورون</button></div>
</header>
<main class="app">
  <section id="login" class="card">
    <h1>دخول</h1>
    <input id="nick" placeholder="الاسم المستعار (English فقط)" maxlength="20" dir="ltr">
    <details class="adm"><summary>تسجيل دخول مشرف</summary>
      <input id="auser" placeholder="اسم الأدمن (ArabAdmin)" dir="ltr">
      <input id="apass" placeholder="رمز الأدمن (az77@)" dir="ltr">
    </details>
    <button id="enter">دخول الغرفة</button>
    <small class="hint">A-Z a-z 0-9 _ (3–20). الأسماء العربية تتحول إلى Guest تلقائيًا.</small>
  </section>

  <section id="chat" class="hidden">
    <aside id="chatsList" class="leftpane">
      <div class="panehead"><b>المحادثات الخاصة</b><button id="closeChats">✕</button></div>
      <ul id="pmConvos"></ul>
    </aside>

    <aside id="sidebar" class="rightpane">
      <div class="panehead"><b>المتواجدون</b><button id="closeSide">✕</button></div>
      <ul id="nicklist"></ul>
    </aside>

    <div class="pane center">
      <div class="topbar">
        <button id="openChats" class="ghost">💬</button>
        <div class="room">#الوطن_العربي</div>
        <div class="actions"><button id="openSide" class="ghost">👥</button><span id="count" class="count">0</span></div>
      </div>

      <ul id="msgs" class="msgs"></ul>

      <div class="composer">
        <input id="text" placeholder="اكتب رسالة…">
        <button id="send" class="sendbtn">إرسال</button>
      </div>
    </div>

    <div id="actionSheet" class="sheet hidden">
      <div class="sheettop"><b id="sheetTitle">إجراءات</b><button id="closeSheet">✕</button></div>
      <div id="sheetBody" class="sheetbtns"></div>
    </div>

    <div id="pmPage" class="sheet hidden">
      <div class="sheettop"><b id="pmTitle">خاص</b><button id="closePm">✕</button></div>
      <ul id="pmLog" class="pmLog"></ul>
      <div class="pmwrap"><input id="pmText" placeholder="اكتب رسالة خاصة…"><button id="pmSend">إرسال</button></div>
    </div>

    <div id="bansBox" class="sheet hidden">
      <div class="sheettop"><b>المحظورون</b><button id="closeBans">✕</button></div>
      <div class="banswrap">
        <h4>IP</h4><ul id="bansIPs" class="bans"></ul>
        <h4>Devices</h4><ul id="bansUAs" class="bans"></ul>
      </div>
    </div>
  </section>
</main>

<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script>
const $ = s=>document.querySelector(s);
const sock = io({ autoConnect:true, reconnection:true, reconnectionAttempts:10, reconnectionDelay:1500 });

let isOp=false, currentTarget=null;
const pmSessions={};

function addMsg(html,cls=""){ const li=document.createElement("li"); li.className="msg "+cls; li.innerHTML=html; $("#msgs").appendChild(li); $("#msgs").scrollTop=$("#msgs").scrollHeight; }
function makeBtn(t,fn){ const b=document.createElement("button"); b.textContent=t; b.onclick=fn; return b; }

$("#enter").onclick=()=>{ const nick=$("#nick").value.trim(), auser=$("#auser").value.trim(), apass=$("#apass").value.trim(); sock.emit("enter",{nick,adminUser:auser,adminPass:apass}); };
$("#send").onclick=sendMsg; $("#text").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); sendMsg(); }});
function sendMsg(){ const t=$("#text").value; if(!t) return; sock.emit("chat",t); $("#text").value=""; }

$("#openChats").onclick=()=>$("#chatsList").classList.add("open");
$("#closeChats").onclick=()=>$("#chatsList").classList.remove("open");
$("#openSide").onclick=()=>$("#sidebar").classList.add("open");
$("#closeSide").onclick=()=>$("#sidebar").classList.remove("open");
$("#closeSheet").onclick=()=>$("#actionSheet").classList.add("hidden");
$("#closePm").onclick=()=>$("#pmPage").classList.add("hidden");
$("#btnBans").onclick=()=>sock.emit("admin-bans");
$("#closeBans").onclick=()=>$("#bansBox").classList.add("hidden");

$("#pmSend").onclick=()=>{ const txt=$("#pmText").value.trim(); if(!txt||!currentTarget) return; sock.emit("pm",{to:currentTarget,text:txt}); pushPM(currentTarget, \`أنت ➜ \${currentTarget}: \${txt}\`); $("#pmText").value=""; };

sock.on("banned",({type})=>addMsg(\`🚫 محظور (\${type}) من الدخول.\`,"sys"));

sock.on("hello",({room,nick,users,isOp:op})=>{
  $("#login").classList.add("hidden"); $("#chat").classList.remove("hidden"); document.body.classList.add("in-chat");
  isOp=!!op; if(isOp) $("#adminBar").classList.remove("hidden");
  addMsg(\`🎉 أهلاً <span class="nick \${isOp?'op':''}">\${nick}</span> — دخلت \${room}\`,"sys");
  renderNicks(users); $("#count").textContent=users.length;
});

sock.on("nicks",list=>{ renderNicks(list); $("#count").textContent=list.length; });
sock.on("sys",t=>addMsg(\`💬 <span class="sys">\${escapeHTML(t)}</span>\`,"sys"));
sock.on("chat",({nick,text,isOp})=>addMsg(\`<span class="nick \${isOp?'op':''}">\${nick}:</span> \${escapeHTML(text)}\`));

sock.on("pm",({from,text})=>{ pushPM(from,\`\${from}: \${text}\`); openPM(from); });
sock.on("pm-sent",({to,text})=>pushPM(to,\`أنت ➜ \${to}: \${text}\`));

sock.on("admin-info",info=>{ const dt=new Date(info.connectedAt||Date.now()); alert(\`Nick: \${info.nick}\\nIP: \${info.ip}\\nDevice: \${info.ua}\\nEntered: \${dt.toLocaleString()}\`); });
sock.on("admin-bans",({ips,uas})=>{
  const ipUl=$("#bansIPs"); ipUl.innerHTML=""; ips.forEach(ip=>{ const li=document.createElement("li"); li.innerHTML=\`<span>\${ip}</span>\`; const b=document.createElement("button"); b.textContent="إلغاء"; b.onclick=()=>sock.emit("admin-unban-ip",ip); li.appendChild(b); ipUl.appendChild(li); });
  const uaUl=$("#bansUAs"); uaUl.innerHTML=""; uas.forEach(ua=>{ const li=document.createElement("li"); li.innerHTML=\`<span title="\${ua}">\${ua.slice(0,48)}\${ua.length>48?'…':''}</span>\`; const b=document.createElement("button"); b.textContent="إلغاء"; b.onclick=()=>sock.emit("admin-unban-ua",ua); li.appendChild(b); uaUl.appendChild(li); });
  $("#bansBox").classList.remove("hidden");
});

function renderNicks(arr){ const ul=$("#nicklist"); ul.innerHTML=""; arr.forEach(n=>{ const li=document.createElement("li"); li.innerHTML=\`<span>\${n}</span>\${n==='ArabAdmin'?'<span class="badge">مشرف</span>':''}\`; li.onclick=()=>openActionsFor(n); ul.appendChild(li); }); }
function openActionsFor(nick){ currentTarget=nick; const body=$("#sheetBody"); body.innerHTML=""; $("#sheetTitle").textContent="إجراءات لـ "+nick;
  body.appendChild(makeBtn("رد على رسالة",()=>{ $("#text").value=\`@\${nick} \`; closeAction(); $("#text").focus(); }));
  body.appendChild(makeBtn("رسالة خاصة",()=>{ openPM(nick); closeAction(); }));
  if(isOp){ body.appendChild(makeBtn("كشف معلومات",()=>sock.emit("admin-info",nick)));
            body.appendChild(makeBtn("طرد",()=>sock.emit("admin-kick",nick)));
            body.appendChild(makeBtn("حظر (IP)",()=>sock.emit("admin-ban-ip",nick)));
            body.appendChild(makeBtn("فصل كلي (الجهاز)",()=>sock.emit("admin-ban-ua",nick))); }
  $("#actionSheet").classList.remove("hidden");
}
function closeAction(){ $("#actionSheet").classList.add("hidden"); }

function openPM(nick){ currentTarget=nick; $("#pmTitle").textContent="خاص مع "+nick; renderConvos(); renderPM(nick); $("#pmPage").classList.remove("hidden"); $("#pmText").focus(); }
function pushPM(nick,line){ if(!pmSessions[nick]) pmSessions[nick]=[]; pmSessions[nick].push(line); }
function renderPM(nick){ const ul=$("#pmLog"); ul.innerHTML=""; (pmSessions[nick]||[]).forEach(line=>{ const li=document.createElement("li"); li.textContent=line; ul.appendChild(li); }); ul.scrollTop=ul.scrollHeight; }
function renderConvos(){ const ul=$("#pmConvos"); ul.innerHTML=""; Object.keys(pmSessions).forEach(n=>{ const li=document.createElement("li"); const last=pmSessions[n][pmSessions[n].length-1]||""; li.innerHTML=\`<span>\${n}</span><span class="hint">\${escapeHTML(last.slice(0,20))}</span>\`; li.onclick=()=>openPM(n); ul.appendChild(li); }); }

function escapeHTML(s){ return String(s).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[m])); }
setInterval(()=>{ sock.emit("ping-stay"); },12000);
</script>
</body></html>`);
});

// ==== Socket.IO (سيرفر) ====
function clientIP(socket){
  const xf = socket.handshake.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") return xf.split(",")[0].trim();
  return socket.handshake.address || "0.0.0.0";
}
function clientUA(socket){ return (socket.handshake.headers["user-agent"] || "").slice(0,180); }
function listNicks(){ return Array.from(users.values()).map(u=>u.nick); }
function findByNick(n){ for (const [sid,u] of users.entries()) if (u.nick===n) return { sid, u }; return null; }
function sys(t){ io.to(ROOM).emit("sys", t); }
function randGuest(){ return "Guest" + Math.floor(1000 + Math.random()*9000); }
function isValidNick(n){ return /^[A-Za-z0-9_]{3,20}$/.test(n); }

io.on("connection",(socket)=>{
  const ip = clientIP(socket);
  const ua = clientUA(socket);

  if (bansByUA.has(ua) && !(socket.handshake.auth && socket.handshake.auth.isAdmin)) {
    socket.emit("banned",{type:"ua"}); return socket.disconnect(true);
  }

  let nick = randGuest();
  let isOp = false;

  socket.on("enter", ({ nick: wantNick, adminUser, adminPass }) => {
    const connectedAt = Date.now();

    if (adminUser === ADMIN_USER && adminPass === ADMIN_PASS) {
      isOp = true; nick = ADMIN_USER; socket.handshake.auth = { isAdmin: true };
    } else {
      if (bansByIP.has(ip)) { socket.emit("banned",{type:"ip"}); return socket.disconnect(true); }
      if (!isValidNick(String(wantNick||""))) { nick = randGuest(); socket.emit("sys","⚠ يُسمح فقط بإنجليزي/أرقام/_ (3-20). تم تحويلك إلى "+nick); }
      else { nick = String(wantNick).trim(); if (listNicks().includes(nick)) { nick = randGuest(); socket.emit("sys","⚠ الاسم مستخدم. تم تحويلك إلى "+nick); } }
    }

    socket.join(ROOM);
    users.set(socket.id, { nick, ip, isOp, ua, connectedAt });
    socket.emit("hello", { room: ROOM, nick, users: listNicks(), isOp });
    sys("✅ " + nick + " انضم"); io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("chat",(text)=>{ const u=users.get(socket.id); if(!u) return; const t=String(text||"").slice(0,1000); if(!t) return; io.to(ROOM).emit("chat",{nick:u.nick,text:t,isOp:u.isOp}); });

  socket.on("pm",({to,text})=>{ const u=users.get(socket.id); if(!u) return; const tgt=findByNick(String(to||"")); if(!tgt) return socket.emit("sys","⚠ المستخدم غير موجود."); const t=String(text||"").slice(0,1000); io.to(tgt.sid).emit("pm",{from:u.nick,text:t}); socket.emit("pm-sent",{to:tgt.u.nick,text:t}); });

  socket.on("admin-info",(nickTarget)=>{ const u=users.get(socket.id); if(!u?.isOp) return; const t=findByNick(String(nickTarget||"")); if(!t) return socket.emit("sys","⚠ المستخدم غير موجود."); socket.emit("admin-info",{nick:t.u.nick,ip:t.u.ip,ua:t.u.ua,connectedAt:t.u.connectedAt}); });

  socket.on("admin-kick",(nickTarget)=>{ const u=users.get(socket.id); if(!u?.isOp) return; const t=findByNick(String(nickTarget||"")); if(!t) return socket.emit("sys","⚠ المستخدم غير موجود."); io.to(t.sid).emit("sys","🚫 تم طردك."); io.sockets.sockets.get(t.sid)?.disconnect(true); users.delete(t.sid); sys("⛔ "+t.u.nick+" تم طرده بواسطة "+u.nick); io.to(ROOM).emit("nicks", listNicks()); });

  socket.on("admin-ban-ip",(nickTarget)=>{ const u=users.get(socket.id); if(!u?.isOp) return; const t=findByNick(String(nickTarget||"")); if(!t) return socket.emit("sys","⚠ المستخدم غير موجود."); bansByIP.add(t.u.ip); io.to(t.sid).emit("sys","🚫 تم حظرك (IP)."); io.sockets.sockets.get(t.sid)?.disconnect(true); users.delete(t.sid); sys("🚫 "+t.u.nick+" (IP: "+t.u.ip+") تم حظره بواسطة "+u.nick); io.to(ROOM).emit("nicks", listNicks()); });

  socket.on("admin-ban-ua",(nickTarget)=>{ const u=users.get(socket.id); if(!u?.isOp) return; const t=findByNick(String(nickTarget||"")); if(!t) return socket.emit("sys","⚠ المستخدم غير موجود."); bansByUA.add(t.u.ua); io.to(t.sid).emit("sys","🚫 تم حظرك (الجهاز)."); io.sockets.sockets.get(t.sid)?.disconnect(true); users.delete(t.sid); sys("🚫 "+t.u.nick+" (Device) تم حظره بواسطة "+u.nick); io.to(ROOM).emit("nicks", listNicks()); });

  socket.on("admin-bans",()=>{ const u=users.get(socket.id); if(!u?.isOp) return; socket.emit("admin-bans",{ips:Array.from(bansByIP), uas:Array.from(bansByUA)}); });
  socket.on("admin-unban-ip",(ip)=>{ const u=users.get(socket.id); if(!u?.isOp) return; bansByIP.delete(String(ip||"")); socket.emit("sys","✅ إلغاء حظر IP "+ip); socket.emit("admin-bans",{ips:Array.from(bansByIP),uas:Array.from(bansByUA)}); });
  socket.on("admin-unban-ua",(ua)=>{ const u=users.get(socket.id); if(!u?.isOp) return; bansByUA.delete(String(ua||"")); socket.emit("sys","✅ إلغاء حظر الجهاز"); socket.emit("admin-bans",{ips:Array.from(bansByIP),uas:Array.from(bansByUA)}); });

  socket.on("ping-stay",()=>socket.emit("pong-stay"));

  socket.on("disconnect",()=>{ const u=users.get(socket.id); if(!u) return; users.delete(socket.id); sys("👋 "+u.nick+" خرج"); io.to(ROOM).emit("nicks", listNicks()); });
});

server.listen(PORT, ()=> console.log("ArabChat (single-file) on :"+PORT));
