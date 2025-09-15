const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

/* إعدادات */
const SUPERADMIN_USER = "ArabAdmin";
const SUPERADMIN_PASS = "az77@";
const ROOM = "#الوطن_العربي";
const REJOIN_SUPPRESS_MS = 5*60*1000; // ٥ دقائق
const PUBLIC_HISTORY_LIMIT = 300;
const PM_HISTORY_LIMIT = 150;

/* الصلاحيات */
const PERMS = {
  KICK:"kick", BAN_IP:"ban_ip", BAN_DEV:"ban_dev",
  CLEAR:"clear", STAR:"star", TEMP_OP:"temp_op", SPY:"spy"
};
const ROLE_DEFS = {
  superadmin:new Set(Object.values(PERMS)),
  admin:new Set([PERMS.KICK,PERMS.BAN_IP,PERMS.BAN_DEV,PERMS.CLEAR,PERMS.STAR,PERMS.TEMP_OP,PERMS.SPY]),
  mod:new Set([PERMS.KICK,PERMS.STAR,PERMS.TEMP_OP])
};

/* حالة السيرفر */
const users=new Map(); // sid -> {nick,role,ip,ua,joinedAt}
const admins=new Map(); // nick->role
const bansByIP=new Set(), bansByUA=new Set();
const stars=new Set(), tempOps=new Set();
const spySockets=new Set();
const pub=[]; // history
const pm=new Map(); // "a|b" -> []

const presence=new Map(); // nick->timestamps

/* Helpers */
function keyPM(a,b){return [a,b].sort().join("|");}
function pushPM(a,b,r){const k=keyPM(a,b);if(!pm.has(k))pm.set(k,[]);const arr=pm.get(k);arr.push(r);if(arr.length>PM_HISTORY_LIMIT)arr.shift();}
function pushPub(m){pub.push(m);if(pub.length>PUBLIC_HISTORY_LIMIT)pub.shift();}
function randGuest(){return "Guest"+Math.floor(1000+Math.random()*9000);}
function isNickOK(n){return /^[A-Za-z0-9_]{3,20}$/.test(n);}
function listNicks(){return Array.from(users.values()).map(u=>u.nick);}
function findByNick(n){for(const [sid,u] of users)if(u.nick===n)return{sid,u};return null;}
function hasPerm(role,p){if(role==="superadmin")return true;return (ROLE_DEFS[role]||new Set()).has(p);}
function isOpNick(n){return n===SUPERADMIN_USER||admins.has(n)||tempOps.has(n);}
function clientIP(s){const xf=s.handshake.headers["x-forwarded-for"];return xf?xf.split(",")[0]:s.handshake.address;}
function clientUA(s){return (s.handshake.headers["user-agent"]||"").slice(0,120);}
function joinSpamAllowed(nick,type){
  const now=Date.now();
  if(!presence.has(nick))presence.set(nick,{});
  const obj=presence.get(nick);
  const key=type==="join"?"j":"l";
  const last=obj[key]||0;
  obj[key]=now;presence.set(nick,obj);
  return now-last>REJOIN_SUPPRESS_MS;
}

/* واجهة */
app.get("/",(req,res)=>{
res.setHeader("content-type","text/html; charset=utf-8");
res.end(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="dark">
<title>شات الوطن العربي</title>
<style>
*{box-sizing:border-box}html,body{height:100%}
:root{--safe-bottom: env(safe-area-inset-bottom,0px);}
body{margin:0;background:#0b0f17;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Tahoma,Arial,sans-serif;overscroll-behavior:none;overflow:hidden}
.hdr{position:sticky;top:0;background:#0f1624;border-bottom:1px solid #1f2a3d;padding:10px;display:flex;align-items:center;gap:8px;z-index:5}
.logo{color:#facc15;font-weight:800}
.adminbar button{border:1px solid #273449;background:#0b0f17;color:#e5e7eb;border-radius:10px;padding:6px 10px}
.hidden{display:none!important}
.app{height:calc(100dvh - 56px);display:flex;flex-direction:column;max-width:1024px;margin:0 auto;padding:12px}
.card{background:#0f1624;border:1px solid #1f2a3d;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
#chat{flex:1;display:flex;flex-direction:column;min-height:0}
.msgs{list-style:none;margin:0;padding:8px;border:1px solid #1f2a3d;border-radius:12px;flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}
.msg{margin:6px 0}
.nick{font-weight:800}
.nick.op::after{content:" ~";color:#f59e0b}
.nick.star::after{content:" 🌟"}
.sys{color:#94a3b8}
.composer{position:sticky;bottom:0;background:#0b0f17;padding-bottom:calc(6px + var(--safe-bottom));display:grid;grid-template-columns:1fr auto;gap:8px}
.composer input{font-size:16px}
</style>
</head><body>
<header class="hdr"><div class="logo">💬 شات الوطن العربي</div><div id="adminBar" class="adminbar hidden"><button id="btnClear">🧹</button><button id="btnSpy">👁️</button></div></header>
<main class="app">
<section id="login" class="card">
  <h1>دخول</h1>
  <input id="nick" placeholder="Nickname (EN only)" dir="ltr">
  <details><summary>SuperAdmin</summary><input id="auser"><input id="apass" type="password"></details>
  <button id="enter">دخول</button>
</section>
<section id="chat" class="hidden">
  <ul id="msgs" class="msgs"></ul>
  <div class="composer"><input id="text" placeholder="اكتب…"><button id="send">إرسال</button></div>
</section>
</main>
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script>
const $=s=>document.querySelector(s);
const sock=io();let isOp=false;
$("#enter").onclick=()=>{sock.emit("enter",{nick:$("#nick").value,adminUser:$("#auser").value,adminPass:$("#apass").value});}
$("#send").onclick=()=>{const t=$("#text").value;if(!t)return;sock.emit("chat",t);$("#text").value="";setTimeout(()=>$("#text").focus(),10);}
$("#text").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#send").click();}});
sock.on("hello",({nick,isOp:op,history})=>{isOp=op;$("#login").classList.add("hidden");$("#chat").classList.remove("hidden");if(op)$("#adminBar").classList.remove("hidden");$("#msgs").innerHTML="";history.forEach(m=>addMsg(m));});
sock.on("chat",m=>addMsg(m));
sock.on("sys",t=>{const li=document.createElement("li");li.className="msg sys";li.textContent=t;$("#msgs").appendChild(li);$("#msgs").scrollTop=$("#msgs").scrollHeight;});
function addMsg(m){const li=document.createElement("li");li.className="msg";li.innerHTML='<span class="nick'+(m.isOp?' op':'')+(m.hasStar?' star':'')+'">'+m.nick+'</span>: '+m.text;$("#msgs").appendChild(li);$("#msgs").scrollTop=$("#msgs").scrollHeight;}
</script>
</body></html>`);
});

/* Socket */
io.on("connection",socket=>{
  const ip=clientIP(socket), ua=clientUA(socket);
  if(bansByIP.has(ip)||bansByUA.has(ua)){socket.disconnect(true);return;}
  socket.on("enter",({nick,adminUser,adminPass})=>{
    let role="user", n=nick;
    if(adminUser===SUPERADMIN_USER&&adminPass===SUPERADMIN_PASS){role="superadmin";n=SUPERADMIN_USER;admins.set(n,"superadmin");}
    else if(!isNickOK(n)){n=randGuest();}
    if(listNicks().includes(n)) n=randGuest();
    users.set(socket.id,{nick:n,role,ip,ua,joinedAt:Date.now()});
    socket.join(ROOM);
    socket.emit("hello",{nick:n,isOp:role!=="user",history:pub});
    if(joinSpamAllowed(n,"join")){pub.push({nick:"النظام",text:`✅ ${n} دخل`});io.to(ROOM).emit("sys",`✅ ${n} دخل`);}
  });
  socket.on("chat",t=>{
    const u=users.get(socket.id);if(!u)return;
    const rec={nick:u.nick,text:String(t).slice(0,500),isOp:isOpNick(u.nick),hasStar:stars.has(u.nick)};
    pushPub(rec);io.to(ROOM).emit("chat",rec);
  });
  socket.on("disconnect",()=>{const u=users.get(socket.id);if(!u)return;users.delete(socket.id);if(joinSpamAllowed(u.nick,"leave")){pub.push({nick:"النظام",text:`👋 ${u.nick} خرج`});io.to(ROOM).emit("sys",`👋 ${u.nick} خرج`);}});
});
server.listen(PORT,()=>console.log("Running on "+PORT));
