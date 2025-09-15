const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingInterval: 15000, pingTimeout: 30000 });
const PORT = process.env.PORT || 3000;

const ROOM = "#الوطن_العربي";
const ADMIN_USER = "ArabAdmin";
const ADMIN_PASS = "az77@";

const users = new Map();      // socket.id -> {nick, ip, isOp}
const bansByIP = new Set();   // IPs

app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

function clientIP(socket){
  const xf = socket.handshake.headers["x-forwarded-for"];
  if (xf && typeof xf === "string") return xf.split(",")[0].trim();
  return socket.handshake.address || "0.0.0.0";
}
function listNicks(){ return Array.from(users.values()).map(u=>u.nick); }
function findByNick(n){ for (const [sid,u] of users.entries()) if (u.nick===n) return { sid, u }; return null; }
function sys(t){ io.to(ROOM).emit("sys", t); }
function randGuest(){ return "Guest" + Math.floor(1000 + Math.random()*9000); }
function isValidNick(n){ return /^[A-Za-z0-9_]{3,20}$/.test(n); }

io.on("connection", (socket) => {
  const ip = clientIP(socket);
  let nick = randGuest();
  let isOp = false;

  socket.on("enter", ({ nick: wantNick, adminUser, adminPass }) => {
    if (adminUser === ADMIN_USER && adminPass === ADMIN_PASS) { // admin bypass
      isOp = true;
      nick = ADMIN_USER;
    } else {
      if (bansByIP.has(ip)) { socket.emit("banned", true); return socket.disconnect(true); }
      if (!isValidNick(String(wantNick||""))) {
        nick = randGuest();
        socket.emit("sys","⚠ يُسمح فقط بإنجليزي/أرقام/_ (3-20). تم تحويلك إلى " + nick);
      } else {
        nick = String(wantNick).trim();
        if (listNicks().includes(nick)) { nick = randGuest(); socket.emit("sys","⚠ الاسم مستخدم. تم تحويلك إلى " + nick); }
      }
    }
    socket.join(ROOM);
    users.set(socket.id, { nick, ip, isOp });
    socket.emit("hello", { room: ROOM, nick, users: listNicks(), isOp });
    sys(`✅ ${nick} انضم`);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("chat", (text) => {
    const u = users.get(socket.id); if (!u) return;
    const t = String(text||"").slice(0,1000); if (!t) return;
    io.to(ROOM).emit("chat", { nick: u.nick, text: t, isOp: u.isOp });
  });

  socket.on("pm", ({to, text}) => {
    const u = users.get(socket.id); if (!u) return;
    const tgt = findByNick(String(to||"")); if (!tgt) return socket.emit("sys","⚠ المستخدم غير موجود.");
    const t = String(text||"").slice(0,1000);
    io.to(tgt.sid).emit("pm", { from: u.nick, text: t });
    socket.emit("pm-sent", { to: tgt.u.nick, text: t });
  });

  socket.on("admin-info", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    socket.emit("admin-info", { nick: t.u.nick, ip: t.u.ip });
  });

  socket.on("admin-kick", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    io.to(t.sid).emit("sys","🚫 تم طردك.");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    sys(`⛔ ${t.u.nick} تم طرده بواسطة ${u.nick}`);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-ban", (nickTarget) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    const t = findByNick(String(nickTarget||"")); if (!t) return socket.emit("sys","⚠ المستخدم غير موجود.");
    bansByIP.add(t.u.ip);
    io.to(t.sid).emit("sys","🚫 تم حظرك.");
    io.sockets.sockets.get(t.sid)?.disconnect(true);
    users.delete(t.sid);
    sys(`🚫 ${t.u.nick} (IP: ${t.u.ip}) تم حظره بواسطة ${u.nick}`);
    io.to(ROOM).emit("nicks", listNicks());
  });

  socket.on("admin-bans-list", () => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    socket.emit("admin-bans-list", Array.from(bansByIP));
  });

  socket.on("admin-unban-ip", (ip) => {
    const u = users.get(socket.id); if (!u?.isOp) return;
    bansByIP.delete(String(ip||""));
    socket.emit("sys", `✅ تم إلغاء حظر ${ip}`);
    socket.emit("admin-bans-list", Array.from(bansByIP));
  });

  socket.on("ping-stay", ()=> socket.emit("pong-stay"));

  socket.on("disconnect", () => {
    const u = users.get(socket.id); if (!u) return;
    users.delete(socket.id);
    sys(`👋 ${u.nick} خرج`);
    io.to(ROOM).emit("nicks", listNicks());
  });
});

server.listen(PORT, () => console.log("ArabChat Ultimate on :"+PORT));
