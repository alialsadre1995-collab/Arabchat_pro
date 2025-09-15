const $ = (s, p=document)=>p.querySelector(s);
const $$ = (s, p=document)=>Array.from(p.querySelectorAll(s));
const tpl = $("#msgTpl").content;

const loginSec = $("#login");
const chatSec = $("#chat");
const rosterUl = $("#roster");
const msgsUl = $("#msgs");
const pmPanel = $("#pmPanel");
const pmMsgsUl = $("#pmMsgs");
const pmWith = $("#pmWith");
const pmClose = $("#pmClose");

const inputNick = $("#nick");
const inputAdmin = $("#adminName");
const inputToken = $("#adminToken");
const joinBtn = $("#joinBtn");

const composer = $("#composer");
const text = $("#text");
const sendBtn = $("#sendBtn");

const socket = io();

let me = null;
let pmTarget = null;

// ————— أدوات واجهة —————
function addMsg(list, from, text, color) {
  const li = tpl.cloneNode(true);
  const u = li.querySelector(".u");
  const t = li.querySelector(".t");
  if (from) {
    u.textContent = `<${from}>`;
    u.style.color = color || "#9aa4b2";
  } else {
    u.textContent = "•";
    u.style.color = "#9aa4b2";
  }
  t.textContent = text;
  list.appendChild(li);
  list.scrollTop = list.scrollHeight + 1000;
}

function sys(msg) { addMsg(msgsUl, null, msg); }

function setupIOSKeyboardStickiness() {
  // يركز الكومبوزر بعد الإرسال ويمنع فقدان التركيز على iOS
  composer.addEventListener("submit", e => e.preventDefault());
  sendBtn.addEventListener("click", () => {
    if (!text.value.trim()) { text.focus(); return; }
    socket.emit("msg", text.value);
    text.value = "";
    // إعادة التركيز للحفاظ على الكيبورد
    setTimeout(()=> text.focus(), 0);
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });
}

function openPM(nick) {
  if (!nick || nick === me?.nick) return;
  pmTarget = nick;
  pmWith.textContent = `خاص مع ${nick}`;
  pmPanel.hidden = false;
}
pmClose.onclick = ()=> { pmPanel.hidden = true; pmTarget = null; };

function setRoster(list) {
  rosterUl.innerHTML = "";
  list.forEach(u => {
    const li = document.createElement("li");
    li.textContent = `${u.nick}${u.role==="admin"?" ~":u.role==="star"?" 🌟":""}`;
    li.style.color = u.color;
    li.title = "اضغط للمعلومات/الخيارات";
    li.onclick = () => {
      // معلومات
      socket.emit("whois", u.nick);
      // فتح قائمة صغيرة (خيارات سريعة)
      if (me?.role === "admin" && u.nick !== me.nick) {
        const acts = [
          ["خاص", ()=>openPM(u.nick)],
          ["طرد", ()=>socket.emit("admin:kick", u.nick)],
          ["حظر", ()=>socket.emit("admin:ban", u.nick)],
          ["نجمة 🌟", ()=>socket.emit("admin:star", u.nick)],
        ];
        // للسريع: نفّذ أول خيار (خاص) عند النقر المطوّل
        // (تركتها بسيطة بدون نافذة منبثقة حتى لا تتعارض مع الجوال)
      } else if (u.nick !== me?.nick) {
        openPM(u.nick);
      }
    };
    rosterUl.appendChild(li);
  });
}

// ————— أحداث Socket —————
socket.on("joined", (u) => {
  me = u;
  loginSec.hidden = true;
  chatSec.hidden = false;
  sys(`تم تسجيل الدخول باسم ${u.nick}.`);
  setTimeout(()=> text.focus(), 100);
});

socket.on("joinDenied", (why)=> {
  alert(why);
});

socket.on("sys", (msg)=> sys(msg));

socket.on("roster", (list)=> setRoster(list));

socket.on("msg", ({from, text: body}) => {
  addMsg(msgsUl, from.nick, body, from.color);
});

socket.on("pm", ({from, text: body, self}) => {
  if (self) {
    addMsg(pmMsgsUl, `أنا → ${pmTarget}`, body, from.color);
  } else {
    openPM(from.nick);
    addMsg(pmMsgsUl, from.nick, body, from.color);
  }
});

// معلومات مستخدم
socket.on("whois", (info)=> {
  const lines = [`الاسم: ${info.nick}`, `الدور: ${info.role}`];
  if (info.ip) lines.push(`IP: ${info.ip}`);
  alert(lines.join("\n"));
});

// ————— دخول —————
joinBtn.onclick = () => {
  let nick = inputNick.value.trim();
  const adminName = inputAdmin.value.trim();
  const adminToken = inputToken.value.trim();

  // فرض إنجليزي
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(nick)) {
    nick = `Guest${Math.floor(Math.random()*9999)}`;
  }
  socket.emit("join", { nick, adminName, adminToken });
};

// إرسال للمحادثة/الخاص
setupIOSKeyboardStickiness();

// إرسال خاص إذا كان اللوح مفتوح
composer.addEventListener("submit", (e) => e.preventDefault());
sendBtn.addEventListener("click", () => {
  const v = text.value.trim();
  if (!v) return;
  if (pmTarget) {
    socket.emit("pm", { to: pmTarget, text: v });
    addMsg(pmMsgsUl, `أنا → ${pmTarget}`, v);
  } else {
    socket.emit("msg", v);
  }
  text.value = "";
  text.focus();
});
