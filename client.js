const $ = s => document.querySelector(s);
const sock = io();

let isOp = false;
let currentTarget = null; // لرسالة خاصة/أكشن

function addMsg(html, cls=""){
  const li = document.createElement("li");
  li.className = "msg " + cls;
  li.innerHTML = html;
  $("#msgs").appendChild(li);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
}

$("#enter").onclick = () => {
  const nick = $("#nick").value.trim() || "Guest";
  const auser = $("#auser").value.trim();
  const apass = $("#apass").value.trim();
  sock.emit("enter", { nick, adminUser: auser, adminPass: apass });
  $("#login").classList.add("hidden");
  $("#chat").classList.remove("hidden");
};

$("#send").onclick = () => {
  const t = $("#text").value;
  if(!t) return;
  sock.emit("chat", t);
  $("#text").value = "";
};
$("#text").addEventListener("keydown", e => { if(e.key==="Enter") $("#send").click(); });

// جانب المتواجدين
$("#openSide").onclick = ()=> $("#sidebar").classList.add("open");
$("#closeSide").onclick = ()=> $("#sidebar").classList.remove("open");

// لوحة إجراءات على مستخدم
$("#closeSheet").onclick = ()=> $("#actionSheet").classList.add("hidden");
$("#closePm").onclick = ()=> $("#pmBox").classList.add("hidden");
$("#pmSend").onclick = ()=> {
  const txt = $("#pmText").value;
  if(!txt || !currentTarget) return;
  sock.emit("pm", { to: currentTarget, text: txt });
  $("#pmText").value = "";
  $("#pmBox").classList.add("hidden");
};

sock.on("hello", ({room, nick, users, isOp: op}) => {
  isOp = !!op;
  addMsg(`🎉 أهلاً <span class="nick ${isOp?'op':''}">${nick}</span> — دخلت ${room}`, "sys");
  renderNicks(users);
  $("#count").textContent = users.length;
});

sock.on("nicks", list => { renderNicks(list); $("#count").textContent = list.length; });
sock.on("sys", t => addMsg(`💬 <span class="sys">${escapeHTML(t)}</span>`, "sys"));
sock.on("chat", ({nick, text, isOp}) => addMsg(`<span class="nick ${isOp?'op':''}">${nick}:</span> ${escapeHTML(text)}`));
sock.on("pm", ({from, text}) => addMsg(`🔒 <span class="nick">${from} (خاص):</span> ${escapeHTML(text)}`));
sock.on("pm-sent", ({to, text}) => addMsg(`🔒 <span class="nick">إلى ${to}:</span> ${escapeHTML(text)}`, "sys"));
sock.on("admin-info", info => {
  alert(`معلومات المستخدم:\nNick: ${info.nick}\nIP: ${info.ip}`);
});

function renderNicks(arr){
  const ul = $("#nicklist"); ul.innerHTML = "";
  arr.forEach(n => {
    const li = document.createElement("li");
    const lbl = document.createElement("span");
    lbl.textContent = n;
    li.appendChild(lbl);

    // عند الضغط على الاسم
    li.onclick = () => openActionsFor(n);
    ul.appendChild(li);
  });
}

function openActionsFor(nick){
  currentTarget = nick;
  $("#sheetTitle").textContent = "إجراءات لـ " + nick;
  const body = $("#sheetBody"); body.innerHTML = "";
  // أزرار مشتركة
  body.appendChild(makeBtn("رد على رسالة", () => { $("#text").value = `@${nick} `; $("#actionSheet").classList.add("hidden"); $("#text").focus(); }));
  body.appendChild(makeBtn("رسالة خاصة", () => { $("#pmTitle").textContent = "خاص إلى " + nick; $("#pmBox").classList.remove("hidden"); $("#actionSheet").classList.add("hidden"); }));
  if (isOp){
    body.appendChild(makeBtn("كشف معلومات", () => sock.emit("admin-info", nick)));
    body.appendChild(makeBtn("طرد", () => sock.emit("admin-kick", nick)));
    body.appendChild(makeBtn("حظر (IP)", () => sock.emit("admin-ban", nick)));
  }
  $("#actionSheet").classList.remove("hidden");
}

function makeBtn(text, fn){
  const b = document.createElement("button");
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
