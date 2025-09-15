const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 15000,
  pingTimeout: 30000
});
const PORT = process.env.PORT || 3000;

// ===== إعدادات عامة =====
const ROOM = "#الوطن_العربي";
const ADMIN_USER = "Admin_rido";
const ADMIN_PASS = "1200@";
const PUBLIC_HISTORY_LIMIT = 300;
const PM_HISTORY_LIMIT = 150;

// ===== حالة السيرفر =====
// users: socket.id -> {nick, ip, ua, isOp, isTempOp, joinedAt, hasStar}
const users = new Map();
const bansByIP = new Set();
const bansByUA = new Set();
const spyOnByOp = new Set(); // socket.id للأدمن المفعّل للتجسس
const starsByNick = new Set(); // نكات عليها نجمة
const tempOps = new Set(); // نكات عليها إشراف مؤقت

// سجل عام (حلقة)
const pubHistory = [];
function pushPublic(line) {
  pubHistory.push(line);
  if (pubHistory.length > PUBLIC_HISTORY_LIMIT) pubHistory.shift();
}

// سجل خاص: key "a|b" (a<b) -> [{from,to,text,ts}]
const pmHistory = new Map();
function pmKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("|");
}
function pushPM(a, b, rec) {
  const k = pmKey(a, b);
  if (!pmHistory.has(k)) pmHistory.set(k, []);
  const arr = pmHistory.get(k);
  arr.push(rec);
  if (arr.length > PM_HISTORY_LIMIT) arr.shift();
}

function clientIP(socket) {
  const xf = socket.handshake.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") return xf.split(",")[0].trim();
  return socket.handshake.address || "0.0.0.0";
}
function clientUA(socket) {
  return (socket.handshake.headers["user-agent"] || "").slice(0, 180);
}
function listNicks() {
  return Array.from(users.values()).map(u => u.nick);
}
function findByNick(n) {
  for (const [sid, u] of users.entries()) if (u.nick === n) return { sid, u };
  return null;
}
function sys(t) { io.to(ROOM).emit("sys", t); }
function randGuest() { return "Guest" + Math.floor(1000 + Math.random() * 9000); }
function isValidNick(n) { return /^[A-Za-z0-9_]{3,20}$/.test(n); }

// ===== صفحة واحدة (HTML + CSS + JS) =====
app.get("/", (req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
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
.adminbar button{border:1px solid #273449;background:#0b0f17;color:#e5e7eb;border-radius:10px;padding:6px 10px;margin-inline-start:6px}
.app{max-width:1000px;margin:0 auto;padding:12px}
.card{background:#0f1624;border:1px solid #1f2a3d;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.card input,.composer input,.pmwrap input{padding:12px;border-radius:12px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
.card button,.sendbtn,.pmwrap button,.ghost{padding:12px;border-radius:12px;border:1px solid #22c55e;background:#16a34a;color:#fff}
.ghost{background:transparent;border-color:#273449;color:#e5e7eb}
.hidden{display:none !important}
#chat{display:grid;grid-template-columns:280px 1fr 280px;gap:12px;min-height:calc(100dvh - 56px)}
.center{display:flex;flex-direction:column;gap:8px}
.msgs{list-style:none;margin:0;padding:8px;border:1px solid #1f2a3d;border-radius:12px;flex:1;overflow:auto;scroll-behavior:smooth}
.msg{margin:6px 0}
.nick{font-weight:700}
.nick.op::after{content:" ~";color:#f59e0b}
.nick.star::after{content:" 🌟"}
.sys{color:#94a3b8}
.count{border:1px solid #273449;border-radius:999px;padding:4px 10px;color:#93a3b8}
.leftpane,.rightpane{background:#0f1624;border:1px solid #1f2a3d;border-radius:12px;overflow:auto}
.panehead{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #1f2a3d}
#pmConvos,#nicklist{list-style:none;margin:0;padding:8px;display:grid;gap:6px}
#pmConvos li,#nicklist li{background:#0b0f17;border:1px solid #1f2a3d;border-radius:10px;padding:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center}
.badge{font-size:12px;color:#f59e0b;margin-inline-start:6px}
.composer{display:grid;grid-template-columns:1fr auto;gap:8px}
.sheet{position:fixed;left:0;right:0;bottom:0;background:#0f1624;border-top:1px solid #1f2a3d;border-radius:14px 14px 0 0;padding:12px;z-index:9999}
.sheettop{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sheetbtns{display:grid;gap:8px}
.sheetbtns button{padding:12px;border-radius:12px;border:1px solid #273449;background:#0b0f17;color:#e5e7eb}
.pmLog{list-style:none;margin:8px 0 0;padding:0;max-height:50vh;overflow:auto;border:1px solid #1f2a3d;border-radius:10px;padding:8px}
.bans{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.bans li{background:#0b0f17;border:1px solid #1f2a3d;border-radius:10px;padding:8px;display:flex;justify-content:space-between;align-items:center}
.banswrap h4{margin:8px 0 4px;color:#93a3b8}
.color-dot{display:inline-block;width:10px;height:10px;border-radius:999px;margin-inline-end:6px;border:1px solid #1f2a3d}
@media(max-width:900px){#chat{grid-template-columns:1fr}.leftpane,.rightpane{display:none;position:fixed;inset:56px 10px 10px 10px;z-index:998}.leftpane.open,.rightpane.open{display:block}}
</style>
<script>
function setVH(){document.documentElement.style.setProperty('--vh',(window.innerHeight*0.01)+'px')}
addEventListener('resize',setVH);addEventListener('orientationchange',setVH);addEventListener('load',setVH);
// iOS visualViewport fix
if (window.visualViewport){ visualViewport.addEventListener('resize', ()=>{ document.body.style.height = visualViewport.height + 'px'; }); }
</script>
</head><body>
<header class="hdr">
  <div class="logo">💬 شات الوطن العربي</div>
  <div id="adminBar" class="adminbar hidden">
    <button id="btnBans">المحظورون</button>
    <button id="btnSpy">👁️ تجسّس الخاص</button>
    <button id="btnClear">🧹 مسح السجل</button>
  </div>
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

    <div id="spyBox" class="sheet hidden">
      <div class="sheettop"><b>الخاص المُراقَب</b><button id="closeSpy">✕</button></div>
      <ul id="spyLog" class="pmLog"></ul>
    </div>
  </section>
</main>

<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script>
const $ = s => document.querySelector(s);
const sock = io({ autoConnect: true, reconnection: true, reconnectionAttempts: 20, reconnectionDelay: 1500 });
let isOp = false, currentTarget = null;
const pmSessions = {}; // nick -> [lines]
let colorCache = {}; // nick -> color

// hash -> لون ثابت
function nickColor(n){
  if(colorCache[n]) return colorCache[n];
  let h=0; for(let i=0;i<n.length;i++) h = (h*31 + n.charCodeAt(i))>>>0;
  const palette = ["#60a5fa","#34d399","#f472b6","#f59e0b","#a78bfa","#fb7185","#22d3ee","#f97316","#4ade80"];
  const c = palette[h % palette.length];
  colorCache[n]=c; return c;
}

function addMsg(html, cls=""){
  const li = document.createElement("li");
  li.className = "msg " + cls;
  li.innerHTML = html;
  $("#msgs").appendChild(li);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
}

// إعادة التركيز على الإنپت (حتى على iPhone)
function refocusInput(){ const t=$("#text"); t.blur(); setTimeout(()=>t.focus(), 10); }

// دخول
$("#enter").onclick = () => {
  const nick = $("#nick").value.trim();
  const auser = $("#auser").value.trim();
  const apass = $("#apass").value.trim();
  localStorage.setItem("savedNick", nick || "");
  localStorage.setItem("savedAU", auser || "");
  localStorage.setItem("savedAP", apass || "");
  sock.emit("enter", { nick, adminUser: auser, adminPass: apass });
};

// إرسال عام
$("#send").onclick = ()=>{ const t=$("#text").value; if(!t) return; sock.emit("chat", t); $("#text").value=""; refocusInput(); };
$("#text").addEventListener("keydown", e => { if(e.key==="Enter"){ e.preventDefault(); $("#send").click(); } });

// جوانب
$("#openChats").onclick = ()=> $("#chatsList").classList.add("open");
$("#closeChats").onclick = ()=> $("#chatsList").classList.remove("open");
$("#openSide").onclick = ()=> $("#sidebar").classList.add("open");
$("#closeSide").onclick = ()=> $("#sidebar").classList.remove("open");

// شيتات
$("#closeSheet").onclick = ()=> $("#actionSheet").classList.add("hidden");
$("#closePm").onclick    = ()=> $("#pmPage").classList.add("hidden");
$("#closeBans").onclick  = ()=> $("#bansBox").classList.add("hidden");
$("#closeSpy").onclick   = ()=> $("#spyBox").classList.add("hidden");

// أدوات أدمن
$("#btnBans").onclick = ()=> sock.emit("admin-bans");
$("#btnClear").onclick = ()=> sock.emit("admin-clear-public");
let spyOn = false;
$("#btnSpy").onclick = ()=>{
  spyOn = !spyOn;
  sock.emit(spyOn ? "admin-spy-on" : "admin-spy-off");
  $("#spyBox").classList.toggle("hidden", !spyOn);
};

$("#pmSend").onclick = ()=>{
  const txt = $("#pmText").value.trim();
  if(!txt || !currentTarget) return;
  sock.emit("pm", { to: currentTarget, text: txt });
  pushPM(currentTarget, \`أنت ➜ \${currentTarget}: \${txt}\`);
  $("#pmText").value = "";
  refocusInput();
};

// Socket events
sock.on("banned", ({type})=> addMsg(\`🚫 محظور (\${type}) من الدخول.\`, "sys"));

sock.on("hello", ({room, nick, users, isOp: op, publicHistory, stars, tempOpsList}) => {
  // بدّل واجهة
  $("#login").classList.add("hidden");
  $("#chat").classList.remove("hidden");
  document.body.classList.add("in-chat");

  isOp = !!op;
  if (isOp) {
    $("#adminBar").classList.remove("hidden");
    addMsg('<span class="sys">ChanServ تم توكيل</span>', "sys");
  }

  // نجوم وإشراف مؤقت (للألوان والرموز)
  localStorage.setItem("stars", JSON.stringify(stars));
  localStorage.setItem("tempOps", JSON.stringify(tempOpsList));

  // حمّل السجل العام
  $("#msgs").innerHTML = "";
  publicHistory.forEach(m=>{
    const nickHtml = \`<span class="nick \${m.isOp?'op':''} \${m.hasStar?'star':''}" style="color:\${nickColor(m.nick)}">\${m.nick}</span>\`;
    addMsg(\`\${nickHtml}: \${escapeHTML(m.text)}\`);
  });

  renderNicks(users);
  $("#count").textContent = users.length;
});

// رسائل عامة
sock.on("nicks", list => { renderNicks(list); $("#count").textContent = list.length; });
sock.on("sys", t => addMsg(\`💬 <span class="sys">\${escapeHTML(t)}</span>\`, "sys"));
sock.on("chat", ({nick, text, isOp, hasStar}) => {
  const nickHtml = \`<span class="nick \${isOp?'op':''} \${hasStar?'star':''}" style="color:\${nickColor(nick)}">\${nick}</span>\`;
  addMsg(\`\${nickHtml}: \${escapeHTML(text)}\`);
});

// PM
sock.on("pm", ({from, text}) => { pushPM(from, \`\${from}: \${text}\`); openPM(from); });
sock.on("pm-sent", ({to, text}) => { pushPM(to, \`أنت ➜ \${to}: \${text}\`); });
sock.on("pm-history", ({peer, history})=>{
  pmSessions[peer] = history.map(h => \`\${h.from}: \${h.text}\`);
  openPM(peer);
});

// PM Spy (سري للأدمن فقط)
sock.on("pm-spy", ({from, to, text})=>{
  const li = document.createElement("li");
  li.textContent = \`[\${from} → \${to}] \${text}\`;
  $("#spyLog").appendChild(li);
  $("#spyLog").scrollTop = $("#spyLog").scrollHeight;
});

// Admin panels
sock.on("admin-info", info => {
  const dt = new Date(info.joinedAt || Date.now());
  alert(\`Nick: \${info.nick}\\nIP: \${info.ip}\\nDevice: \${info.ua}\\nEntered: \${dt.toLocaleString()}\`);
});
sock.on("admin-bans", ({ips, uas}) => {
  const ipUl = $("#bansIPs"); ipUl.innerHTML="";
  ips.forEach(ip => { const li=document.createElement("li"); li.innerHTML=\`<span>\${ip}</span>\`; const b=document.createElement("button"); b.textContent="إلغاء"; b.onclick=()=>sock.emit("admin-unban-ip",ip); li.appendChild(b); ipUl.appendChild(li); });
  const uaUl = $("#bansUAs"); uaUl.innerHTML="";
  uas.forEach(ua => { const li=document.createElement("li"); li.innerHTML=\`<span title="\${ua}">\${ua.slice(0,48)}\${ua.length>48?'…':''}</span>\`; const b=document.createElement("button"); b.textContent="إلغاء"; b.onclick=()=>sock.emit("admin-unban-ua",ua); li.appendChild(b); uaUl.appendChild(li); });
  $("#bansBox").classList.remove("hidden");
});

// وظائف
function renderNicks(arr){
  const stars = new Set(JSON.parse(localStorage.getItem("stars")||"[]"));
  const temps = new Set(JSON.parse(localStorage.getItem("tempOps")||"[]"));
  const ul = $("#nicklist"); ul.innerHTML = "";
  arr.forEach(n => {
    const li = document.createElement("li");
    const badge = temps.has(n) || n==="ArabAdmin" ? '<span class="badge">~</span>' : '';
    const star = stars.has(n) ? ' 🌟' : '';
    li.innerHTML = \`<span><span class="color-dot" style="background:\${nickColor(n)}"></span>\${n}\${badge}\${star}</span>\`;
    li.onclick = ()=> openActionsFor(n);
    ul.appendChild(li);
  });
}
function openActionsFor(nick){
  currentTarget = nick;
  const body = $("#sheetBody"); body.innerHTML = "";
  $("#sheetTitle").textContent = "إجراءات لـ " + nick;

  body.appendChild(btn("رد على رسالة", ()=>{ $("#text").value = \`@\${nick} \`; closeAction(); $("#text").focus(); }));
  body.appendChild(btn("رسالة خاصة", ()=>{ requestPMHistory(nick); closeAction(); }));

  if (isOp){
    body.appendChild(btn("كشف معلومات", ()=> sock.emit("admin-info", nick)));
    body.appendChild(btn("طرد", ()=> sock.emit("admin-kick", nick)));
    body.appendChild(btn("حظر (IP)", ()=> sock.emit("admin-ban-ip", nick)));
    body.appendChild(btn("فصل كلي (الجهاز)", ()=> sock.emit("admin-ban-ua", nick)));
    body.appendChild(btn("إعطاء/سحب نجمة 🌟", ()=> sock.emit("admin-toggle-star", nick)));
    body.appendChild(btn("إشراف مؤقت (تبديل)", ()=> sock.emit("admin-toggle-tempop", nick)));
  }
  $("#actionSheet").classList.remove("hidden");
}
function btn(t, fn){ const b=document.createElement("button"); b.textContent=t; b.onclick=fn; return b; }
function closeAction(){ $("#actionSheet").classList.add("hidden"); }

function pushPM(nick, line){
  if(!pmSessions[nick]) pmSessions[nick] = [];
  pmSessions[nick].push(line);
  renderConvos();
}
function openPM(nick){
  currentTarget = nick;
  $("#pmTitle").textContent = "خاص مع " + nick;
  renderConvos();
  renderPM(nick);
  $("#pmPage").classList.remove("hidden");
  $("#pmText").focus();
}
function renderPM(nick){
  const ul = $("#pmLog"); ul.innerHTML = "";
  (pmSessions[nick]||[]).forEach(line => {
    const li = document.createElement("li");
    li.innerHTML = escapeHTML(line);
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}
function renderConvos(){
  const ul = $("#pmConvos"); ul.innerHTML="";
  Object.keys(pmSessions).forEach(n => {
    const last = pmSessions[n][pmSessions[n].length-1] || "";
    const li = document.createElement("li");
    li.innerHTML = \`<span>\${n}</span><span class="hint">\${escapeHTML(last.slice(0,24))}</span>\`;
    li.onclick = ()=> openPM(n);
    ul.appendChild(li);
  });
}
function requestPMHistory(peer){
  // طلب سجل الخاص من السيرفر
  sock.emit("pm-fetch", peer);
}

function escapeHTML(s){ return String(s).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[m])); }

// Keep-alive + إعادة دخول تلقائي
setInterval(()=>{ sock.emit("ping-stay"); }, 12000);
sock.on("connect", ()=>{
  const nick = localStorage.getItem("savedNick")||"";
  const auser = localStorage.getItem("savedAU")||"";
  const apass = localStorage.getItem("savedAP")||"";
  if (nick || auser) sock.emit("enter", { nick, adminUser: auser, adminPass: apass });
});
</script>
</body></html>`);
});

// ===== Socket.IO =====
io.on("connection", (socket) => {
  const ip = clientIP(socket);
  const ua = clientUA(socket);
  let isAdmin = false;

  if (bansByUA.has(ua)) { socket.emit("banned", {type:"ua"}); return socket.disconnect(true); }
  if (bansByIP.has(ip)) { socket.emit("banned", {type:"ip"}); return socket.disconnect(true); }

  socket.on("enter", ({ nick: wantNick, adminUser, adminPass }) => {
    let nick = randGuest();
    let isOp = false;

    if (adminUser === ADMIN_USER && adminPass === ADMIN_PASS) {
      isAdmin = true;
      isOp = true;
      nick = ADMIN_USER;
    } else {
      if (!isValidNick(String(wantNick||""))) {
        nick = randGuest();
        socket.emit("sys","⚠ يُسمح فقط بإنجليزي/أرقام/_ (3-20). تم تحويلك إلى " + nick);
      } else {
        nick = String(wantNick).trim();
        if (listNicks().includes(nick)) {
          nick = randGuest();
          socket.emit("sys","⚠ الاسم مستخدم. تم تحويلك إلى " + nick);
        }
      }
    }

    socket.join(ROOM);
    const hasStar = starsByNick.has(nick);
    const isTempOp = tempOps.has(nick);
    users.set(socket.id, { nick, ip, ua, isOp: isOp || isTempOp, isTempOp, joinedAt: Date.now(), hasStar });

    // أرسل hello + السجل العام + قوائم النجوم/الإشراف المؤقت
    socket.emit("hello", {
      room: ROOM,
      nick,
      users: listNicks(),
      isOp: users.get(socket.id).isOp,
      publicHistory: pubHistory,
      stars: Array.from(starsByNick),
      tempOpsList: Array.from(tempOps)
    });

    // إعلان “تم توكيل” عند دخول الأدمن فقط (سراً تم داخل الواجهة أيضاً)
    if (isAdmin) sys("تم توكيل");

    io.to(ROOM).emit("nicks", listNicks());
    pushPublic({ nick: "النظام", text: `✅ ${nick} انضم`, isOp:false, hasStar:false });
    sys(`✅ ${nick} انضم`);
  });

  // عام
  socket.on("chat", (text) => {
    const u = users.get(socket.id); if (!u) return;
    const t = String(text||"").slice(0, 1000); if (!t) return;
    const rec = { nick: u.nick, text: t, isOp: u.isOp, hasStar: u.hasStar === true || starsByNick.has(u.nick) };
    pushPublic(rec);
    io.to(ROOM).emit("chat", rec);
  });

  // خاص
  socket.on("pm", ({to, text}) => {
    const u = users.get(socket.id); if (!u) return;
    const tgt = findByNick(String(to||"")); if (!tgt) return socket.emit("sys","⚠ المستخدم غير موجود.");
    const t = String(text||"").slice(0,1000);
    const rec = { from: u.nick, to: tgt.u.nick, text: t, ts: Date.now() };

    // سجل الخاص
    pushPM(u.nick, tgt.u.nick, rec);

    // إرسال للطرفين
    io.to(tgt.sid).emit("pm", { from: u.nick, text: t });
    socket.emit("pm-sent", { to: tgt.u.nick, text: t });

    // تجسّس سري: أرسل نسخة للمشرفين المفعّلين دون أي إعلان
    for (const sid of spyOnByOp) {
      const op = users.get(sid);
      if (op && op.isOp) io.to(sid).emit("pm-spy", rec);
    }
  });

  // جلب سجل PM للمحادثة
  socket.on("pm-fetch", (peer) => {
    const u = users.get(socket.id); if (!u) return;
    const k = pmKey(u.nick, String(peer||""));
    const history = (pmHistory.get(k) || []).slice(-PM_HISTORY_LIMIT);
    socket.emit("pm-history", { peer, history });
  });

  // إدارة أدمن
  socket.on("admin-info", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    socket.emit("admin-info", { nick: t.u.nick, ip: t.u.ip, ua: t.u.ua, joinedAt: t.u.joinedAt });
  });

  socket.on("admin-kick", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    io.to(t.sid).emit("sys","🚫 تم طردك.");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    io.to(ROOM).emit("nicks", listNicks());
    pushPublic({ nick:"النظام", text:`⛔ ${t.u.nick} طُرد`, isOp:false }); sys(`⛔ ${t.u.nick} طُرد`);
  });

  socket.on("admin-ban-ip", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    bansByIP.add(t.u.ip);
    io.to(t.sid).emit("sys","🚫 تم حظرك (IP).");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    io.to(ROOM).emit("nicks", listNicks());
    pushPublic({ nick:"النظام", text:`🚫 ${t.u.nick} (IP) حُظر`, isOp:false }); sys(`🚫 ${t.u.nick} (IP) حُظر`);
  });

  socket.on("admin-ban-ua", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    bansByUA.add(t.u.ua);
    io.to(t.sid).emit("sys","🚫 تم حظرك (الجهاز).");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    io.to(ROOM).emit("nicks", listNicks());
    pushPublic({ nick:"النظام", text:`🚫 ${t.u.nick} (Device) حُظر`, isOp:false }); sys(`🚫 ${t.u.nick} (Device) حُظر`);
  });

  socket.on("admin-bans", () => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    socket.emit("admin-bans", { ips: Array.from(bansByIP), uas: Array.from(bansByUA) });
  });

  socket.on("admin-unban-ip", (ip) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    bansByIP.delete(String(ip||""));
    socket.emit("sys", `✅ إلغاء حظر IP ${ip}`);
    socket.emit("admin-bans", { ips: Array.from(bansByIP), uas: Array.from(bansByUA) });
  });

  socket.on("admin-unban-ua", (ua) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    bansByUA.delete(String(ua||""));
    socket.emit("sys", `✅ إلغاء حظر الجهاز`);
    socket.emit("admin-bans", { ips: Array.from(bansByIP), uas: Array.from(bansByUA) });
  });

  // نجمة و إشراف مؤقت + مسح سجل
  socket.on("admin-toggle-star", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    if (starsByNick.has(nickTarget)) starsByNick.delete(nickTarget);
    else starsByNick.add(nickTarget);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-toggle-tempop", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    if (tempOps.has(nickTarget)) tempOps.delete(nickTarget); else tempOps.add(nickTarget);
    // لو المستخدم متصل، حدّث حالته
    const entry = Array.from(users.entries()).find(([,x])=>x.nick===nickTarget);
    if (entry){ const [sid, obj] = entry; obj.isTempOp = tempOps.has(nickTarget); obj.isOp = obj.isTempOp || (obj.nick===ADMIN_USER); users.set(sid, obj); }
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-clear-public", () => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    pubHistory.length = 0;
    io.to(ROOM).emit("sys", "🧹 تم مسح السجل بواسطة المشرف.");
  });

  // تجسس تشغيل/إيقاف
  socket.on("admin-spy-on", () => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    spyOnByOp.add(socket.id);
    socket.emit("sys", "👁️ تم تفعيل مراقبة الخاص.");
  });
  socket.on("admin-spy-off", () => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    spyOnByOp.delete(socket.id);
    socket.emit("sys", "🙈 تم إيقاف مراقبة الخاص.");
  });

  // إبقاء الجلسة
  socket.on("ping-stay", ()=> socket.emit("pong-stay"));

  socket.on("disconnect", () => {
    const u = users.get(socket.id);
    if (!u) return;
    users.delete(socket.id);
    spyOnByOp.delete(socket.id);
    io.to(ROOM).emit("nicks", listNicks());
    pushPublic({ nick:"النظام", text:`👋 ${u.nick} خرج`, isOp:false }); sys(`👋 ${u.nick} خرج`);
  });
});

server.listen(PORT, () => console.log("ArabChat Pro (pm-spy, stars, temp-op, iphone-fix) on :"+PORT));
