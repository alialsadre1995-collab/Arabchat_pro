const $ = s => document.querySelector(s);
const sock = io({ autoConnect: true, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1500 });

let isOp = false;
let currentTarget = null;

function addMsg(html, cls=""){
  const li = document.createElement("li");
  li.className = "msg " + cls;
  li.innerHTML = html;
  $("#msgs").appendChild(li);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
}
function saveSession(nick, isOpFlag){ localStorage.setItem("nick", nick||""); localStorage.setItem("isOp", isOpFlag? "1":"0"); }

$("#enter").onclick = () => {
  const nick = $("#nick").value.trim();
  const auser = $("#auser").value.trim();
  const apass = $("#apass").value.trim();
  sock.emit("enter", { nick, adminUser: auser, adminPass: apass });
  $("#login").classList.add("hidden");
  $("#chat").classList.remove("hidden");
};

$("#send").onclick = sendMsg;
$("#text").addEventListener("keydown", e => { if(e.key==="Enter"){ e.preventDefault(); sendMsg(); } });
function sendMsg(){ const t = $("#text").value; if(!t) return; sock.emit("chat", t); $("#text").value = ""; }

document.querySelectorAll(".st").forEach(b => b.onclick = ()=>{ $("#text").value += " " + b.textContent + " "; $("#text").focus(); });

$("#openSide").onclick = ()=> $("#sidebar").classList.add("open");
$("#closeSide").onclick = ()=> $("#sidebar").classList.remove("open");

$("#closeSheet").onclick = ()=> $("#actionSheet").classList.add("hidden");
$("#closePm").onclick = ()=> $("#pmBox").classList.add("hidden");
$("#pmSend").onclick = ()=> { const txt = $("#pmText").value.trim(); if(!txt || !currentTarget) return; sock.emit("pm", { to: currentTarget, text: txt }); $("#pmText").value = ""; logPM(`أنت ➜ ${currentTarget}: ${txt}`); };

$("#btnBans").onclick = ()=> { sock.emit("admin-bans-list"); };
$("#closeBans").onclick = ()=> $("#bansBox").classList.add("hidden");

sock.on("banned", ()=> { addMsg("🚫 محظور من الدخول.", "sys"); });
sock.on("hello", ({room, nick, users, isOp: op}) => {
  isOp = !!op; saveSession(nick, isOp);
  if (isOp) $("#adminBar").classList.remove("hidden");
  addMsg(`🎉 أهلاً <span class="nick ${isOp?'op':''}">${nick}</span> — دخلت ${room}`, "sys");
  renderNicks(users); $("#count").textContent = users.length;
});
sock.on("nicks", list => { renderNicks(list); $("#count").textContent = list.length; });
sock.on("sys", t => addMsg(`💬 <span class="sys">${escapeHTML(t)}</span>`, "sys"));
sock.on("chat", ({nick, text, isOp}) => addMsg(`<span class="nick ${isOp?'op':''}">${nick}:</span> ${escapeHTML(text)}`));
sock.on("pm", ({from, text}) => { logPM(`${from}: ${text}`); $("#pmTitle").textContent = "خاص مع " + from; $("#pmBox").classList.remove("hidden"); });
sock.on("pm-sent", ({to, text}) => { logPM(`أنت ➜ ${to}: ${text}`); });

sock.on("admin-info", info => alert(`Nick: ${info.nick}\nIP: ${info.ip}`));
sock.on("admin-bans-list", arr => {
  const ul = $("#bansList"); ul.innerHTML="";
  arr.forEach(ip => { const li = document.createElement("li"); li.innerHTML = `<span>${ip}</span>`; const un = document.createElement("button"); un.textContent = "إلغاء الحظر"; un.onclick = ()=> sock.emit("admin-unban-ip", ip); li.appendChild(un); ul.appendChild(li); });
  $("#bansBox").classList.remove("hidden");
});

function renderNicks(arr){
  const ul = $("#nicklist"); ul.innerHTML = "";
  arr.forEach(n => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${n}</span>${n=== 'ArabAdmin' ? '<span class="badge">مشرف</span>': ''}`;
    li.onclick = ()=> openActionsFor(n);
    ul.appendChild(li);
  });
}
function openActionsFor(nick){
  currentTarget = nick;
  const body = $("#sheetBody"); body.innerHTML = "";
  $("#sheetTitle").textContent = "إجراءات لـ " + nick;
  body.appendChild(makeBtn("رد على رسالة", ()=>{ $("#text").value = `@${nick} `; closeAction(); $("#text").focus(); }));
  body.appendChild(makeBtn("رسالة خاصة", ()=>{ $("#pmTitle").textContent="خاص مع "+nick; $("#pmBox").classList.remove("hidden"); closeAction(); }));
  if (isOp){
    body.appendChild(makeBtn("كشف معلومات", ()=> sock.emit("admin-info", nick)));
    body.appendChild(makeBtn("طرد", ()=> sock.emit("admin-kick", nick)));
    body.appendChild(makeBtn("حظر (IP)", ()=> sock.emit("admin-ban", nick)));
  }
  $("#actionSheet").classList.remove("hidden");
}
function closeAction(){ $("#actionSheet").classList.add("hidden"); }
function makeBtn(t,fn){ const b=document.createElement("button"); b.textContent=t; b.onclick=fn; return b; }

function logPM(txt){ const ul = $("#pmLog"); const li = document.createElement("li"); li.textContent = txt; ul.appendChild(li); ul.scrollTop = ul.scrollHeight; }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

setInterval(()=>{ sock.emit("ping-stay"); }, 12000);
