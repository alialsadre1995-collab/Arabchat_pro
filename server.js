const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// ===== أدمن ثابت =====
const ADMIN_USER = "ArabAdmin";
const ADMIN_PASS = "az77@";

// ===== غرفة رئيسية =====
const ROOM = "#الوطن_العربي";

// users: socket.id -> {nick, ip, isOp}
const users = new Map();
const bansByIP = new Set();

app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

function clientIP(socket){
  const xf = socket.handshake.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") return xf.split(",")[0].trim();
  return socket.handshake.address || "0.0.0.0";
}
function listNicks(){
  return Array.from(users.values()).map(u=>u.nick);
}
function findByNick(n){
  for (const [sid,u] of users.entries()){
    if (u.nick === n) return { sid, u };
  }
  return null;
}
function sys(t){ io.to(ROOM).emit("sys", t); }
function randGuest(){ return "Guest" + Math.floor(1000 + Math.random()*9000); }
function isValidNick(n){ return /^[A-Za-z0-9_]{3,20}$/.test(n); }

io.on("connection", (socket) => {
  const ip = clientIP(socket);
  if (bansByIP.has(ip)) {
    socket.emit("sys","🚫 محظور من الدخول.");
    return socket.disconnect(true);
  }

  let nick = randGuest();
  let isOp = false;

  socket.on("enter", ({nick: wantNick, adminUser, adminPass}) => {
    // تحقّق إدمن
    if (adminUser === ADMIN_USER && adminPass === ADMIN_PASS) {
      isOp = true;
      nick = ADMIN_USER;
    } else {
      // التحقق من الاسم: يمنع العربي & تكرار الاسم
      if (!isValidNick(String(wantNick||""))) {
        nick = randGuest();
        socket.emit("sys","⚠ يُسمح فقط بحروف إنجليزية/أرقام/شرطة سفلية (3-20). تم تحويلك إلى " + nick);
      } else {
        nick = wantNick.trim();
        // منع تكرار الاسم
        const exists = listNicks().includes(nick);
        if (exists){
          nick = randGuest();
          socket.emit("sys","⚠ الاسم مستخدم. تم تحويلك إلى " + nick);
        }
      }
    }

    socket.join(ROOM);
    users.set(socket.id, { nick, ip, isOp });

    socket.emit("hello", { room: ROOM, nick, users: listNicks(), isOp });
    io.to(ROOM).emit("nicks", listNicks());
    sys("✅ " + nick + " انضم إلى الغرفة");
  });

  // رسائل عامة وأوامر (بدون إظهار الأوامر للمستخدمين، نعتمد واجهة)
  socket.on("chat", (text) => {
    if (!text) return;
    text = String(text).slice(0,1000);
    // بث للجميع
    const u = users.get(socket.id);
    if (!u) return;
    io.to(ROOM).emit("chat", { nick: u.nick, text, isOp: u.isOp });
  });

  // رسائل خاصة
  socket.on("pm", ({to, text}) => {
    if (!to || !text) return;
    const target = findByNick(String(to));
    const u = users.get(socket.id);
    if (!u || !target) return socket.emit("sys","⚠ المستخدم غير موجود.");
    io.to(target.sid).emit("pm", { from: u.nick, text: String(text).slice(0,1000) });
    socket.emit("pm-sent", { to: target.u.nick, text });
  });

  // معلومات مستخدم (للمشرف)
  socket.on("admin-info", (nickTarget) => {
    const u = users.get(socket.id);
    if (!u?.isOp) return;
    const t = findByNick(String(nickTarget));
    if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    socket.emit("admin-info", { nick: t.u.nick, ip: t.u.ip });
  });

  socket.on("admin-kick", (nickTarget) => {
    const u = users.get(socket.id);
    if (!u?.isOp) return;
    const t = findByNick(String(nickTarget));
    if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    io.to(t.sid).emit("sys","🚫 تم طردك من الغرفة.");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    sys("⛔ " + t.u.nick + " تم طرده بواسطة " + u.nick);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-ban", (nickTarget) => {
    const u = users.get(socket.id);
    if (!u?.isOp) return;
    const t = findByNick(String(nickTarget));
    if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    bansByIP.add(t.u.ip);
    io.to(t.sid).emit("sys","🚫 تم حظرك.");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    sys("🚫 " + t.u.nick + " (IP: " + t.u.ip + ") تم حظره بواسطة " + u.nick);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-bans-list", () => {
    const u = users.get(socket.id);
    if (!u?.isOp) return;
    socket.emit("admin-bans-list", Array.from(bansByIP));
  });

  socket.on("disconnect", () => {
    const u = users.get(socket.id);
    if (!u) return;
    users.delete(socket.id);
    sys("👋 " + u.nick + " غادر الغرفة");
    io.to(ROOM).emit("nicks", listNicks());
  });
});

server.listen(PORT, () => console.log("ArabChat Pro on :" + PORT));
