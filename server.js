import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;

// ذاكرة مؤقتة (للتجربة). لاحقًا ممكن نبدّلها بقاعدة بيانات.
const users = new Map();          // socket.id -> {nick, role, banned, color}
const nicks = new Map();          // nick -> socket.id
const bans = new Map();           // nick/ip -> {by, at}
const admins = new Map();         // nick -> {token, temp: false}

// مسؤول افتراضي
admins.set("ArabAdmin", { token: "az77@", temp: false });

app.use(express.static(__dirname)); // يتيح index.html و client.js و style.css

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// أدوات صغيرة
const isAsciiNick = (s)=>/^[A-Za-z0-9_-]{3,20}$/.test(s);
const nickColor = (nick)=> {
  // لون ثابت مستند على الاسم
  let h = 0;
  for (const c of nick) h = (h*31 + c.charCodeAt(0)) % 360;
  return `hsl(${h},70%,70%)`;
};
const publicUser = (u)=>({ nick: u.nick, role: u.role, color: u.color });

// بث قائمة المتواجدين
function broadcastRoster() {
  const list = Array.from(users.values()).map(publicUser);
  io.emit("roster", list);
}

// فك الحظر
function unban(nickOrIp) {
  bans.delete(nickOrIp.toLowerCase());
}

// حدث الاتصال
io.on("connection", (socket) => {
  let ip = (socket.handshake.headers["x-forwarded-for"] || socket.handshake.address || "").toString().split(",")[0].trim();

  socket.on("join", ({ nick, room = "#الوطن_العربي", adminName, adminToken }) => {
    // منع تكرار الدخول السريع
    if (!nick || !isAsciiNick(nick)) nick = `Guest${Math.floor(Math.random()*9999)}`;

    // التحقق من الحظر
    if (bans.has(nick.toLowerCase()) || bans.has(ip)) {
      socket.emit("joinDenied", "أنت محظور من الدخول.");
      return;
    }

    // التحقق من صلاحية المشرف
    let role = "user";
    if (adminName && adminToken) {
      const a = admins.get(adminName);
      if (a && a.token === adminToken) {
        role = "admin";
        io.emit("sys", `تم توكيل ${adminName} كمشرف.`);
      } else {
        socket.emit("sys", "رمز المشرف غير صحيح.");
      }
    }

    // لو الاسم محجوز حاليًا نضيف لاحقة
    if (nicks.has(nick)) nick = `${nick}_${Math.floor(Math.random()*99)}`;

    const user = {
      id: socket.id,
      nick,
      role,          // admin | mod | user
      color: nickColor(nick),
      ip,
      room
    };

    users.set(socket.id, user);
    nicks.set(nick, socket.id);

    socket.join(room);
    socket.emit("joined", publicUser(user));
    socket.emit("sys", `مرحبًا بك ${nick} في ${room}`);
    io.to(room).emit("sys", `${nick} انضمّ إلى الغرفة.`);

    broadcastRoster();
  });

  // رسالة عامة
  socket.on("msg", (text) => {
    const u = users.get(socket.id);
    if (!u || !text) return;
    io.to(u.room).emit("msg", { from: publicUser(u), text, ts: Date.now() });
  });

  // رسالة خاص
  socket.on("pm", ({ to, text }) => {
    const u = users.get(socket.id);
    if (!u || !to || !text) return;
    const toId = nicks.get(to);
    if (!toId) {
      socket.emit("sys", "المستخدم غير متواجد.");
      return;
    }
    io.to(toId).emit("pm", { from: publicUser(u), text, ts: Date.now() });
    socket.emit("pm", { from: publicUser(u), text, ts: Date.now(), self: true });
  });

  // نقر على اسم → إرسال بطاقة معلومات
  socket.on("whois", (nick) => {
    const id = nicks.get(nick);
    if (!id) { socket.emit("sys", "غير متواجد."); return; }
    const u = users.get(id);
    if (!u) return;
    // لا نظهر IP للمستخدمين العاديين
    const me = users.get(socket.id);
    const info = {
      nick: u.nick,
      role: u.role,
      color: u.color,
      ip: (me?.role === "admin" ? u.ip : undefined)
    };
    socket.emit("whois", info);
  });

  // أوامر المشرف
  socket.on("admin:ban", (nick) => {
    const me = users.get(socket.id);
    if (!me || me.role !== "admin") return;
    const id = nicks.get(nick);
    if (!id) return;
    const u = users.get(id);
    if (!u) return;
    bans.set(u.ip, { by: me.nick, at: Date.now() });
    io.to(u.id).emit("sys", "تم حظرك.");
    io.sockets.sockets.get(u.id)?.disconnect(true);
    io.emit("sys", `${nick} تم حظره.`);
  });

  socket.on("admin:unban", (nickOrIp) => {
    const me = users.get(socket.id);
    if (!me || me.role !== "admin") return;
    unban(nickOrIp);
    socket.emit("sys", "تم فك الحظر.");
  });

  socket.on("admin:kick", (nick) => {
    const me = users.get(socket.id);
    if (!me || me.role !== "admin") return;
    const id = nicks.get(nick);
    if (!id) return;
    io.sockets.sockets.get(id)?.disconnect(true);
    io.emit("sys", `${nick} تم طرده.`);
  });

  // نجمة لمستخدم
  socket.on("admin:star", (nick) => {
    const me = users.get(socket.id);
    if (!me || me.role !== "admin") return;
    const id = nicks.get(nick);
    if (!id) return;
    const u = users.get(id);
    if (!u) return;
    u.role = "star"; // يظهر كـ 🌟 في القائمة
    broadcastRoster();
    io.emit("sys", `${nick} حصل على نجمة 🌟`);
  });

  // عند الفصل
  socket.on("disconnect", () => {
    const u = users.get(socket.id);
    if (!u) return;
    users.delete(socket.id);
    nicks.delete(u.nick);
    io.to(u.room).emit("sys", `${u.nick} غادر الغرفة.`);
    broadcastRoster();
  });
});

server.listen(PORT, () => {
  console.log(`ArabChat Pro running on http://localhost:${PORT}`);
});
