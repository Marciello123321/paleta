"use strict";
/* Paleta – czat ekipy: grupki, wspólne notatniki, rozmowy.
   Telefony łączą się bezpośrednio (WebRTC przez PeerJS), nick = adres.
   Dane trzymane są na telefonie; wiadomości do osób offline czekają w kolejce. */

const KEY = "paleta:v2";
const PREFIX = "paleta-app-v1-";
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const KEY_RE = /^[a-z0-9_]{3,16}$/;
const THEMES = [
  { id: "noc", name: "Noc", sw: "linear-gradient(135deg,#0d0b14 50%,#8b5cf6 50%)" },
  { id: "dzien", name: "Dzień", sw: "linear-gradient(135deg,#f4f2fb 50%,#7c3aed 50%)" },
  { id: "neon", name: "Neon", sw: "linear-gradient(135deg,#05080a 50%,#00e0a0 50%)" },
  { id: "pastel", name: "Pastel", sw: "linear-gradient(135deg,#fff3f1 50%,#ec4899 50%)" },
  { id: "ocean", name: "Ocean", sw: "linear-gradient(135deg,#08131f 50%,#38bdf8 50%)" },
  { id: "zachod", name: "Zachód", sw: "linear-gradient(135deg,#170d12 50%,#fb923c 50%)" },
];
const GROUP_EMOJI = ["🔥", "🎮", "⚽", "🎧", "🍕", "😈", "👻", "🌴"];
const REACTIONS = ["😂", "😱", "🔥", "👀"];
const PAL = [["#8b5cf6", "#ec4899"], ["#f59e0b", "#ef4444"], ["#10b981", "#06b6d4"], ["#3b82f6", "#8b5cf6"], ["#ec4899", "#f59e0b"], ["#14b8a6", "#84cc16"], ["#6366f1", "#22d3ee"], ["#f43f5e", "#fb923c"]];
const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
];

const $ = (s) => document.querySelector(s);
const k = (n) => String(n).toLowerCase();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const params = new URLSearchParams(location.search);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [n, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (n === "class") el.className = v;
    else if (n === "html") el.innerHTML = v;
    else if (n.startsWith("on")) el[n] = v;
    else el.setAttribute(n, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const ic = (n, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

/* ============ Stan ============ */
function fresh() {
  return { v: 2, me: null, theme: "noc", sound: true, contacts: [], requests: [], pending: [], names: {}, groups: [], dms: {}, outbox: {}, current: null, tab: "notes", notebook: {}, unread: {} };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 2) return { ...fresh(), ...s };
  } catch {}
  return fresh();
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
const meKey = () => k(state.me.nick);
const isContact = (key) => state.contacts.some((c) => c.id === key);
const online = new Set();
let netStatus = "connecting";

function nameOf(key) {
  if (state.me && key === meKey()) return state.me.nick;
  return state.names[key] || key;
}
function pal(key) {
  let x = 0;
  for (const c of String(key)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return PAL[x % PAL.length];
}
function avatar(key, cls = "") {
  const [a, b] = pal(key);
  const el = h("span", { class: `avatar ${cls} ${online.has(key) ? "on" : ""}` }, nameOf(key).slice(0, 1));
  el.style.background = `linear-gradient(135deg,${a},${b})`;
  return el;
}
function time(ts) {
  const d = new Date(ts);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
let toastT;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 2800);
}

/* ============ Dźwięk ============ */
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
document.addEventListener("pointerdown", unlockAudio);
function tone(list) {
  if (!state.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    for (const [f, d, len = 0.22] of list) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d);
      o.stop(t + d + len + 0.02);
    }
  } catch {}
}
const ping = () => tone([[880, 0], [1175, 0.12]]);
let ringTimer = null;
function ring(on) {
  clearInterval(ringTimer);
  ringTimer = null;
  if (!on) { navigator.vibrate?.(0); return; }
  const beep = () => { tone([[660, 0, 0.3], [880, 0.2, 0.3]]); navigator.vibrate?.([300, 150, 300]); };
  beep();
  ringTimer = setInterval(beep, 1900);
}

/* ============ Okienko z pytaniem ============ */
function ask(o) {
  return new Promise((resolve) => {
    const sheet = $("#ask"), form = $("#askForm"), body = $("#askBody"), err = $("#askErr");
    body.replaceChildren();
    err.textContent = "";
    let input = null, emoji = o.emojis ? GROUP_EMOJI[0] : null;
    if (o.text) body.append(h("p", { class: "ask-text" }, o.text));
    if (o.input) {
      input = h("input", { id: "askInput", maxlength: o.input.maxLength || 40, placeholder: o.input.placeholder || "", autocomplete: "off", autocapitalize: o.input.nick ? "none" : "sentences", autocorrect: "off", spellcheck: "false" });
      body.append(h("label", { class: "field" }, input));
    }
    if (o.emojis) {
      const row = h("div", { class: "emojis" });
      for (const e of GROUP_EMOJI) {
        const b = h("button", { type: "button", class: e === emoji ? "on" : "" }, e);
        b.onclick = () => { emoji = e; [...row.children].forEach((c) => c.classList.toggle("on", c === b)); };
        row.append(b);
      }
      body.append(h("div", { class: "field" }, h("span", { class: "lbl" }, "Ikonka grupki"), row));
    }
    if (o.people) {
      const box = h("div", { class: "field" }, h("span", { class: "lbl" }, o.peopleLabel || "Wybierz osoby"));
      for (const p of o.people) {
        const cb = h("input", { type: o.single ? "radio" : "checkbox", name: "pp", value: p.id });
        box.append(h("label", { class: "pick" }, cb, avatar(p.id, "sm"), h("span", { class: "nm" }, nameOf(p.id)), online.has(p.id) ? null : h("span", { class: "off" }, "offline")));
      }
      body.append(box);
    }
    $("#askTitle").textContent = o.title;
    const ok = $("#askOk");
    ok.textContent = o.ok || "OK";
    ok.classList.toggle("danger-fill", !!o.danger);
    sheet.hidden = false;
    if (input) setTimeout(() => input.focus(), 60);
    const done = (v) => { sheet.hidden = true; form.onsubmit = $("#askClose").onclick = sheet.onclick = null; resolve(v); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const value = input ? input.value.trim().replace(/^@/, "") : "";
      if (input && !value) { err.textContent = "Wpisz coś"; return input.focus(); }
      const picked = [...body.querySelectorAll(".pick input:checked")].map((x) => x.value);
      const bad = o.validate && o.validate({ value, picked });
      if (bad) { err.textContent = bad; return; }
      done({ value, picked, emoji });
    };
    $("#askClose").onclick = () => done(null);
    sheet.onclick = (e) => { if (e.target === sheet) done(null); };
  });
}

/* ============ Sieć (PeerJS) ============ */
let peer = null, peerOpen = false, loopT = null;
const conns = new Map();
const connecting = new Set();

function peerOpts() {
  const o = { debug: 0, config: { iceServers: ICE } };
  const host = params.get("peerhost"); // tylko do testów lokalnych
  if (host) Object.assign(o, { host, port: +params.get("peerport") || 9000, path: "/", secure: false });
  return o;
}
function setNet(s) {
  netStatus = s;
  const pill = $("#netPill");
  if (!pill) return;
  pill.className = "net " + s;
  pill.querySelector("span").textContent = s === "online" ? "online" : s === "error" ? "brak sieci" : "łączenie…";
  if (!state.current && state.me) renderMain();
}
function startPeer(nick) {
  return new Promise((resolve, reject) => {
    let done = false;
    const p = new Peer(PREFIX + k(nick), peerOpts());
    const to = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch {} reject({ type: "timeout" }); } }, 12000);
    p.on("open", () => { if (done) return; done = true; clearTimeout(to); peer = p; attach(p); resolve(); });
    p.on("error", (err) => { if (!done) { done = true; clearTimeout(to); try { p.destroy(); } catch {} reject(err); } });
  });
}
function connectNet(nick, retries) {
  setNet("connecting");
  startPeer(nick).catch((err) => {
    if (retries > 0 && err.type !== "browser-incompatible") setTimeout(() => connectNet(nick, retries - 1), 4000);
    else setNet("error");
  });
}
function attach(p) {
  peerOpen = true;
  setNet("online");
  p.on("connection", setupConn);
  p.on("call", onIncomingCall);
  p.on("open", () => { peerOpen = true; setNet("online"); sweep(); });
  p.on("disconnected", () => {
    peerOpen = false;
    setNet("connecting");
    setTimeout(() => { if (peer === p && !p.destroyed) { try { p.reconnect(); } catch {} } }, 1500);
  });
  p.on("close", () => { peerOpen = false; setNet("error"); if (peer === p) setTimeout(() => connectNet(state.me.nick, 10), 3000); });
  p.on("error", onPeerError);
  sweep();
  clearInterval(loopT);
  loopT = setInterval(sweep, 5000);
}
function onPeerError(err) {
  if (err.type === "peer-unavailable") {
    const m = /peer\s+(\S+)/i.exec(err.message || "");
    const key = m && m[1].startsWith(PREFIX) ? m[1].slice(PREFIX.length) : null;
    if (key) {
      connecting.delete(key);
      if (online.delete(key)) renderSoon();
      if (call && call.key === key && !call.connected) endCall(`${nameOf(key)} jest teraz offline`, false);
    }
  } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
    setNet("connecting");
  }
}
function watchKeys() {
  return new Set([...state.contacts.map((c) => c.id), ...state.pending.map((c) => c.id), ...Object.keys(state.outbox)]);
}
function sweep() {
  if (!peerOpen) return;
  for (const key of watchKeys()) if (!online.has(key)) connectTo(key);
  resendStale();
}
function connectTo(key) {
  if (!peerOpen || !peer || key === meKey()) return;
  const c = conns.get(key);
  if ((c && c.open) || connecting.has(key)) return;
  connecting.add(key);
  setTimeout(() => connecting.delete(key), 8000);
  try { setupConn(peer.connect(PREFIX + key, { reliable: true, serialization: "json" })); } catch { connecting.delete(key); }
}
function setupConn(conn) {
  const rk = conn.peer.slice(PREFIX.length);
  conn.on("open", () => {
    conns.set(rk, conn);
    connecting.delete(rk);
    online.add(rk);
    try { conn.send({ t: "hello", nick: state.me.nick }); } catch {}
    flush(rk);
    renderSoon();
  });
  conn.on("data", (d) => onData(rk, d, conn));
  conn.on("close", () => {
    if (conns.get(rk) === conn) { conns.delete(rk); online.delete(rk); renderSoon(); }
  });
  conn.on("error", () => {});
}
const lastSent = new Map();
function sendTo(key, ev) {
  ev.m = uid();
  const q = (state.outbox[key] ||= []);
  q.push(ev);
  if (q.length > 300) q.splice(0, q.length - 300);
  save();
  trySend(key, ev);
}
function trySend(key, ev) {
  const c = conns.get(key);
  if (c && c.open) {
    try { c.send(ev); lastSent.set(ev.m, now()); return; } catch {}
  }
  connectTo(key);
}
function flush(key) {
  for (const ev of state.outbox[key] || []) trySend(key, ev);
}
function resendStale() {
  for (const key of Object.keys(state.outbox)) {
    if (!online.has(key)) continue;
    for (const ev of state.outbox[key]) if (now() - (lastSent.get(ev.m) || 0) > 6000) trySend(key, ev);
  }
}
function sendEphemeral(key, ev, tries = 5) {
  const c = conns.get(key);
  if (c && c.open) { try { c.send(ev); return; } catch {} }
  if (tries <= 0) return;
  connectTo(key);
  setTimeout(() => sendEphemeral(key, ev, tries - 1), 700);
}
function ensureOnline(key, ms) {
  return new Promise((res) => {
    if (online.has(key)) return res(true);
    connectTo(key);
    const t0 = now();
    const iv = setInterval(() => {
      if (online.has(key)) { clearInterval(iv); res(true); }
      else if (now() - t0 > ms) { clearInterval(iv); res(false); }
    }, 150);
  });
}
function broadcast(g, ev) {
  for (const m of g.members) if (m.id !== meKey()) sendTo(m.id, ev);
}

/* ============ Zdarzenia z sieci ============ */
const room = (type, id) => `${type}:${id}`;
const curKey = () => (state.current ? room(state.current.type, state.current.id) : null);
function bump(key) {
  if (key !== curKey() || document.hidden) state.unread[key] = (state.unread[key] || 0) + 1;
  ping();
}
function cleanEntry(e) {
  if (!e || typeof e.id !== "string" || typeof e.x !== "string" || !e.x.trim()) return null;
  return { id: e.id.slice(0, 24), x: e.x.slice(0, 2000), ts: Math.min(Number(e.ts) || now(), now() + 60000) };
}
function addUnique(list, e) {
  if (list.some((x) => x.id === e.id)) return false;
  list.push(e);
  list.sort((a, b) => a.ts - b.ts);
  if (list.length > 500) list.splice(0, list.length - 500);
  return true;
}
function becomeContacts(key, nick) {
  state.names[key] = nick;
  if (!isContact(key)) state.contacts.push({ id: key, nick });
  state.pending = state.pending.filter((p) => p.id !== key);
  state.requests = state.requests.filter((p) => p.id !== key);
}
function onData(from, d, conn) {
  if (!d || typeof d !== "object") return;
  if (d.t === "ack") {
    const q = state.outbox[from];
    const i = q ? q.findIndex((e) => e.m === d.m) : -1;
    if (i >= 0) { q.splice(i, 1); if (!q.length) delete state.outbox[from]; save(); }
    return;
  }
  if (typeof d.m === "string" && d.m.length <= 24) { try { conn.send({ t: "ack", m: d.m }); } catch {} }
  const known = isContact(from);
  switch (d.t) {
    case "hello":
      if (known && typeof d.nick === "string" && NICK_RE.test(d.nick) && k(d.nick) === from) {
        state.names[from] = d.nick;
        const c = state.contacts.find((c) => c.id === from);
        if (c) c.nick = d.nick;
        save(); renderSoon();
      }
      return;
    case "freq": {
      if (typeof d.nick !== "string" || !NICK_RE.test(d.nick) || k(d.nick) !== from) return;
      if (known || state.pending.some((p) => p.id === from)) {
        becomeContacts(from, d.nick);
        try { conn.send({ t: "facc", nick: state.me.nick }); } catch {}
        toast(`${d.nick} jest już w znajomych`);
      } else if (!state.requests.some((r) => r.id === from) && state.requests.length < 20) {
        state.requests.push({ id: from, nick: d.nick });
        state.names[from] = d.nick;
        ping();
      }
      save(); renderSoon();
      return;
    }
    case "facc":
      if (typeof d.nick === "string" && NICK_RE.test(d.nick) && k(d.nick) === from && state.pending.some((p) => p.id === from)) {
        becomeContacts(from, d.nick);
        save(); renderSoon();
        toast(`${d.nick} przyjął(ęła) twoje zaproszenie`);
        ping();
      }
      return;
  }
  if (!known) return;
  applyEvent(from, d);
}
function groupOf(gid, from) {
  return state.groups.find((g) => g.id === gid && g.members.some((m) => m.id === from));
}
function applyEvent(from, d) {
  switch (d.t) {
    case "dm": {
      const e = cleanEntry(d.e);
      if (!e) return;
      e.a = from;
      if (addUnique((state.dms[from] ||= []), e)) { bump(room("dm", from)); save(); renderSoon(); }
      return;
    }
    case "gnew": {
      const g = d.g;
      if (!g || typeof g.id !== "string" || state.groups.some((x) => x.id === g.id) || !Array.isArray(g.members)) return;
      const members = g.members.slice(0, 30).filter((m) => m && KEY_RE.test(m.id) && NICK_RE.test(m.nick || "") && k(m.nick) === m.id);
      if (!members.some((m) => m.id === meKey()) || !members.some((m) => m.id === from)) return;
      members.forEach((m) => { if (!state.names[m.id]) state.names[m.id] = m.nick; });
      state.groups.unshift({
        id: g.id.slice(0, 24), name: String(g.name || "Grupka").slice(0, 40), emoji: String(g.emoji || "💬").slice(0, 8), members,
        notebooks: (Array.isArray(g.nb) ? g.nb : []).slice(0, 20).map((n) => ({ id: String(n.id).slice(0, 24), name: String(n.name).slice(0, 40), entries: [] })),
        messages: [],
      });
      if (!state.groups[0].notebooks.length) state.groups[0].notebooks.push({ id: uid(), name: "Notatnik", entries: [] });
      toast(`${nameOf(from)} dodał(a) cię do grupki „${state.groups[0].name}”`);
      ping(); save(); renderSoon();
      return;
    }
    case "nb": {
      const g = groupOf(d.gid, from);
      if (!g || !d.nb || typeof d.nb.id !== "string" || g.notebooks.some((n) => n.id === d.nb.id)) return;
      g.notebooks.push({ id: d.nb.id.slice(0, 24), name: String(d.nb.name || "Notatnik").slice(0, 40), entries: [] });
      save(); renderSoon();
      return;
    }
    case "note": {
      const g = groupOf(d.gid, from), e = cleanEntry(d.e);
      if (!g || !e) return;
      let nb = g.notebooks.find((n) => n.id === d.nbid);
      if (!nb) { nb = { id: String(d.nbid).slice(0, 24), name: String(d.nbn || "Notatnik").slice(0, 40), entries: [] }; g.notebooks.push(nb); }
      e.a = from; e.reactions = {};
      if (addUnique(nb.entries, e)) { bump(room("group", g.id)); save(); renderSoon(); }
      return;
    }
    case "gmsg": {
      const g = groupOf(d.gid, from), e = cleanEntry(d.e);
      if (!g || !e) return;
      e.a = from;
      if (addUnique(g.messages, e)) { bump(room("group", g.id)); save(); renderSoon(); }
      return;
    }
    case "react": {
      const g = groupOf(d.gid, from);
      const nb = g && g.notebooks.find((n) => n.id === d.nbid);
      const e = nb && nb.entries.find((x) => x.id === d.eid);
      if (!e || !REACTIONS.includes(d.emo)) return;
      const list = ((e.reactions ||= {})[d.emo] ||= []);
      const i = list.indexOf(from);
      if (d.on && i < 0) list.push(from);
      if (!d.on && i >= 0) list.splice(i, 1);
      save(); renderSoon();
      return;
    }
    case "cmode":
      if (call && call.key === from && ["audio", "video", "screen"].includes(d.mode)) {
        call.remoteMode = d.mode;
        updateCallUI();
      }
      return;
    case "cend":
      if (call && call.key === from) endCall(call.connected ? "Rozmowa zakończona" : `${nameOf(from)} nie może teraz rozmawiać`, false);
      else if (incoming && incoming.from === from) { dropIncoming(); toast(`Nieodebrane połączenie od ${nameOf(from)}`); }
      return;
  }
}

/* ============ Rysowanie ============ */
let rq = 0;
function renderSoon() {
  if (rq) return;
  rq = requestAnimationFrame(() => { rq = 0; render(); });
}
function curGroup() {
  return state.current && state.current.type === "group" ? state.groups.find((g) => g.id === state.current.id) : null;
}
function curNotebook(g) {
  return g.notebooks.find((n) => n.id === state.notebook[g.id]) || g.notebooks[0];
}
function lastActivity(g) {
  return [...g.messages, ...g.notebooks.flatMap((n) => n.entries)].sort((a, b) => b.ts - a.ts)[0];
}
function render() {
  if (!state.me) return;
  document.documentElement.dataset.styl = state.theme;
  renderSidebar();
  renderMain();
  const unread = Object.values(state.unread).reduce((a, b) => a + b, 0);
  $("#menuDot").hidden = !(unread || state.requests.length);
}

function listItem({ av, name, preview, active, unread, dim, onClick, extra }) {
  const li = h("li", { class: (active ? "active " : "") + (dim ? "dim" : "") });
  li.append(av, h("div", { class: "info" }, h("div", { class: "name" }, name), h("div", { class: "preview" }, preview)));
  if (unread) li.append(h("span", { class: "badge" }, unread));
  if (extra) li.append(extra);
  if (onClick) li.onclick = onClick;
  return li;
}

function renderSidebar() {
  const q = $("#search").value.trim().toLowerCase();
  const m = (n) => !q || n.toLowerCase().includes(q);
  $("#meNick").textContent = state.me.nick;
  const ma = $("#meAvatar"), [a, b] = pal(meKey());
  ma.style.background = `linear-gradient(135deg,${a},${b})`;
  ma.textContent = state.me.nick.slice(0, 1);

  // prośby o dodanie
  const rb = $("#requests");
  rb.replaceChildren();
  for (const r of state.requests) {
    const yes = h("button", { class: "round yes", "aria-label": "Przyjmij", html: ic("check") });
    const no = h("button", { class: "round no", "aria-label": "Odrzuć", html: ic("close") });
    yes.onclick = () => {
      becomeContacts(r.id, r.nick);
      sendTo(r.id, { t: "facc", nick: state.me.nick });
      save(); render();
      toast(`${r.nick} jest teraz w twoich znajomych`);
    };
    no.onclick = () => { state.requests = state.requests.filter((x) => x.id !== r.id); save(); render(); };
    rb.append(h("div", { class: "req" }, avatar(r.id, "sm"), h("div", { class: "txt" }, h("b", {}, r.nick), "chce być twoim znajomym"), no, yes));
  }

  // grupki
  const gl = $("#groupList");
  gl.replaceChildren();
  for (const g of state.groups.filter((g) => m(g.name))) {
    const last = lastActivity(g);
    gl.append(listItem({
      av: h("span", { class: "avatar emoji" }, g.emoji),
      name: g.name,
      preview: last ? `${nameOf(last.a)}: ${last.x}` : `${g.members.length} osób`,
      active: state.current && state.current.type === "group" && state.current.id === g.id,
      unread: state.unread[room("group", g.id)],
      onClick: () => openRoom({ type: "group", id: g.id }),
    }));
  }
  if (!gl.children.length) gl.append(h("li", { class: "empty-li" }, q ? "Nic nie znaleziono" : "Brak grupek. Kliknij „nowa”."));

  // czaty
  const cl = $("#chatList");
  cl.replaceChildren();
  const dmKeys = Object.keys(state.dms).filter((id) => state.dms[id].length && m(nameOf(id)));
  dmKeys.sort((x, y) => state.dms[y].at(-1).ts - state.dms[x].at(-1).ts);
  for (const id of dmKeys) {
    const last = state.dms[id].at(-1);
    cl.append(listItem({
      av: avatar(id), name: nameOf(id), preview: (last.a === meKey() ? "Ty: " : "") + last.x,
      active: state.current && state.current.type === "dm" && state.current.id === id,
      unread: state.unread[room("dm", id)],
      onClick: () => openRoom({ type: "dm", id }),
    }));
  }
  if (!cl.children.length) cl.append(h("li", { class: "empty-li" }, "Brak rozmów"));

  // znajomi
  const kl = $("#contactList");
  kl.replaceChildren();
  const friends = state.contacts.filter((c) => m(c.nick)).sort((x, y) => (online.has(y.id) - online.has(x.id)) || x.nick.localeCompare(y.nick));
  for (const c of friends) {
    const call = h("button", { class: "round call-btn", "aria-label": "Zadzwoń", html: ic("callface", "big") });
    const vid = h("button", { class: "round cam-btn", "aria-label": "Wideo", html: ic("video") });
    call.onclick = (e) => { e.stopPropagation(); startCall(c.id, "audio"); };
    vid.onclick = (e) => { e.stopPropagation(); startCall(c.id, "video"); };
    kl.append(listItem({ av: avatar(c.id), name: c.nick, preview: online.has(c.id) ? "online" : "offline", onClick: () => openRoom({ type: "dm", id: c.id }), extra: h("div", { class: "mini" }, call, vid) }));
  }
  for (const p of state.pending.filter((p) => m(p.nick))) {
    kl.append(listItem({ av: avatar(p.id), name: p.nick, preview: "czeka na akceptację…", dim: true }));
  }
  if (!kl.children.length) kl.append(h("li", { class: "empty-li" }, q ? "Nic nie znaleziono" : "Dodaj kogoś po nicku"));
}

let lastFeedId = "";
let forceScroll = true;
function renderMain() {
  const g = curGroup();
  const dm = state.current && state.current.type === "dm" ? state.current.id : null;
  if (state.current && !g && !dm) state.current = null;
  const inRoom = !!(g || dm);
  $("#tabs").hidden = !g;
  $("#composer").hidden = !inRoom;
  $("#roomActions").hidden = !inRoom;
  const nbBar = $("#notebookBar");
  nbBar.replaceChildren();

  if (g) {
    $("#roomName").textContent = `${g.emoji} ${g.name}`;
    const on = g.members.filter((x) => x.id !== meKey() && online.has(x.id)).length;
    $("#roomSub").textContent = `${g.members.length} osób · ${on} online`;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  } else if (dm) {
    $("#roomName").textContent = nameOf(dm);
    $("#roomSub").textContent = online.has(dm) ? "online" : "offline";
  } else {
    $("#roomName").textContent = "Paleta";
    $("#roomSub").textContent = netStatus === "online" ? "jesteś online" : netStatus === "error" ? "brak połączenia z siecią" : "łączenie…";
  }

  const notes = !!g && state.tab === "notes";
  $("#input").placeholder = notes ? "Wpisz plotkę – grupka zobaczy od razu…" : "Napisz wiadomość…";
  const feed = $("#feed");
  const nb = notes ? curNotebook(g) : null;
  if (notes) {
    for (const n of g.notebooks) {
      const chip = h("button", { class: "chip" + (n.id === nb.id ? " active" : "") }, n.name);
      chip.onclick = () => { state.notebook[g.id] = n.id; save(); renderMain(); };
      nbBar.append(chip);
    }
    nbBar.append(h("button", { class: "chip add", onclick: addNotebook }, "+ notatnik"));
  }

  const id = `${curKey()}|${state.tab}|${nb ? nb.id : ""}`;
  if (id !== lastFeedId) { forceScroll = true; lastFeedId = id; }
  const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  const top = feed.scrollTop;
  feed.replaceChildren();
  if (!inRoom) renderHome(feed);
  else if (notes) renderNotes(feed, g, nb);
  else renderChat(feed, g ? g.messages : state.dms[dm] || [], !!g);
  if (!inRoom || notes) feed.scrollTop = forceScroll ? 0 : top;
  else feed.scrollTop = forceScroll || near ? feed.scrollHeight : top;
  forceScroll = false;
}

function renderHome(feed) {
  const step = (n, title, sub, fn) => {
    const b = h("button", { class: "step" }, h("span", { class: "n" }, n), h("span", {}, title, h("small", {}, sub)));
    b.onclick = fn;
    return b;
  };
  feed.append(h("div", { class: "home" },
    h("span", { html: `<svg class="ic face"><use href="#i-callface"/></svg>` }),
    h("h2", {}, `Cześć, ${state.me.nick}!`),
    h("p", {}, "Tu masz wszystko w jednym miejscu: czat, wspólny notatnik i rozmowy."),
    h("div", { class: "steps" },
      step("1", "Dodaj znajomego", "wpisz jego nick", addFriend),
      step("2", "Zrób grupkę", "z kolegami z ekipy", addGroup),
      step("3", "Piszcie w notatniku", "każdy widzi wpisy od razu", () => (state.groups[0] ? openRoom({ type: "group", id: state.groups[0].id }) : addGroup())),
    )));
}

function renderNotes(feed, g, nb) {
  if (!nb.entries.length) {
    feed.append(h("div", { class: "empty", html: ic("notebook") + `<p><b></b><br>Wpisz coś na dole. Cała grupka zobaczy to od razu.</p>` }));
    feed.querySelector("b").textContent = `Notatnik „${nb.name}” jest pusty`;
    return;
  }
  const me = meKey();
  for (const e of [...nb.entries].sort((x, y) => y.ts - x.ts)) {
    const reacts = h("div", { class: "reactions" });
    for (const emo of REACTIONS) {
      const users = (e.reactions && e.reactions[emo]) || [];
      const b = h("button", { class: "react" + (users.includes(me) ? " on" : "") }, users.length ? `${emo} ${users.length}` : emo);
      b.onclick = () => {
        e.reactions ||= {};
        const list = (e.reactions[emo] ||= []);
        const i = list.indexOf(me);
        i < 0 ? list.push(me) : list.splice(i, 1);
        save(); renderMain();
        broadcast(g, { t: "react", gid: g.id, nbid: nb.id, eid: e.id, emo, on: i < 0 });
      };
      reacts.append(b);
    }
    const mine = e.a === me;
    feed.append(h("article", { class: "note" }, avatar(e.a),
      h("div", { class: "note-body" },
        h("div", { class: "note-head" }, h("span", { class: "note-author" }, mine ? "Ty" : nameOf(e.a)), h("span", { class: "note-time" }, time(e.ts))),
        h("div", { class: "note-text" }, e.x), reacts)));
  }
}

function renderChat(feed, list, isGroup) {
  if (!list.length) {
    feed.append(h("div", { class: "empty", html: ic("chat") + "<p>Jeszcze cicho. Napisz pierwszy!</p>" }));
    return;
  }
  const me = meKey();
  for (const m of list) {
    const mine = m.a === me;
    const wrap = h("div", { class: "msg" + (mine ? " mine" : "") });
    if (!mine && isGroup) {
      const who = h("div", { class: "who" }, nameOf(m.a));
      who.style.color = pal(m.a)[0];
      wrap.append(who);
    }
    wrap.append(h("div", { class: "bubble" }, m.x), h("div", { class: "time" }, time(m.ts)));
    feed.append(wrap);
  }
}

/* ============ Akcje ============ */
function openRoom(r) {
  state.current = r;
  delete state.unread[room(r.type, r.id)];
  if (r.type === "dm" && !state.dms[r.id]) state.dms[r.id] = [];
  forceScroll = true;
  save();
  closeSidebar();
  render();
}
function send(text) {
  const g = curGroup();
  const e = { id: uid(), a: meKey(), x: text.slice(0, 2000), ts: now() };
  if (g && state.tab === "notes") {
    const nb = curNotebook(g);
    nb.entries.push({ ...e, reactions: {} });
    broadcast(g, { t: "note", gid: g.id, nbid: nb.id, nbn: nb.name, e: { id: e.id, x: e.x, ts: e.ts } });
  } else if (g) {
    g.messages.push(e);
    broadcast(g, { t: "gmsg", gid: g.id, e: { id: e.id, x: e.x, ts: e.ts } });
  } else if (state.current && state.current.type === "dm") {
    (state.dms[state.current.id] ||= []).push(e);
    sendTo(state.current.id, { t: "dm", e: { id: e.id, x: e.x, ts: e.ts } });
  }
  forceScroll = true;
  save();
  render();
}
async function addFriend() {
  const r = await ask({
    title: "Dodaj znajomego",
    text: "Wpisz nick kolegi. Dostanie prośbę, a po jej przyjęciu możecie pisać i dzwonić.",
    input: { placeholder: "nick kolegi", maxLength: 16, nick: true },
    ok: "Wyślij prośbę",
    validate: ({ value }) => {
      if (!NICK_RE.test(value)) return "Nick: 3–16 znaków, litery, cyfry lub _";
      if (k(value) === meKey()) return "To twój własny nick :)";
      if (isContact(k(value))) return "Ta osoba już jest w znajomych";
      if (state.pending.some((p) => p.id === k(value))) return "Prośba do tej osoby już poszła";
      return "";
    },
  });
  if (!r) return;
  const key = k(r.value);
  const inc = state.requests.find((x) => x.id === key);
  if (inc) { // on już prosił – przyjmujemy od razu
    becomeContacts(key, inc.nick);
    sendTo(key, { t: "facc", nick: state.me.nick });
    save(); render();
    return toast(`${inc.nick} jest teraz w znajomych`);
  }
  state.pending.push({ id: key, nick: r.value });
  state.names[key] = r.value;
  sendTo(key, { t: "freq", nick: state.me.nick });
  save(); render();
  toast(`Prośba poszła do ${r.value}. Zobaczy ją, gdy wejdzie do Palety.`);
}
async function addGroup() {
  if (!state.contacts.length) { toast("Najpierw dodaj znajomego po nicku"); return addFriend(); }
  const r = await ask({
    title: "Nowa grupka", input: { placeholder: "Nazwa grupki", maxLength: 30 }, emojis: true,
    people: state.contacts, peopleLabel: "Kto jest w grupce?", ok: "Utwórz",
    validate: ({ picked }) => (picked.length ? "" : "Zaznacz przynajmniej jedną osobę"),
  });
  if (!r) return;
  const g = {
    id: uid(), name: r.value, emoji: r.emoji,
    members: [{ id: meKey(), nick: state.me.nick }, ...r.picked.map((id) => ({ id, nick: nameOf(id) }))],
    notebooks: [{ id: uid(), name: "Notatnik", entries: [] }], messages: [],
  };
  state.groups.unshift(g);
  save();
  broadcast(g, { t: "gnew", g: { id: g.id, name: g.name, emoji: g.emoji, members: g.members, nb: g.notebooks.map((n) => ({ id: n.id, name: n.name })) } });
  openRoom({ type: "group", id: g.id });
}
async function addNotebook() {
  const g = curGroup();
  if (!g) return;
  const r = await ask({ title: "Nowy notatnik", input: { placeholder: "np. Plotki z wycieczki", maxLength: 30 }, ok: "Utwórz" });
  if (!r) return;
  const nb = { id: uid(), name: r.value, entries: [] };
  g.notebooks.push(nb);
  state.notebook[g.id] = nb.id;
  save(); render();
  broadcast(g, { t: "nb", gid: g.id, nb: { id: nb.id, name: nb.name } });
}
async function shareNick() {
  const text = `Dodaj mnie w Paleta! Mój nick: ${state.me.nick}`;
  const url = location.origin + location.pathname;
  if (navigator.share) {
    try { await navigator.share({ title: "Paleta", text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Zaproszenie skopiowane"); } catch { toast(text); }
}
async function callFromHeader(mode) {
  const cur = state.current;
  if (!cur) return toast("Najpierw wybierz rozmowę");
  let key = cur.id;
  if (cur.type === "group") {
    const g = curGroup();
    const others = g.members.filter((m) => m.id !== meKey());
    const r = await ask({ title: mode === "screen" ? "Komu pokazać ekran?" : "Do kogo dzwonisz?", people: others, single: true, peopleLabel: "Wybierz osobę", ok: "Dzwoń", validate: ({ picked }) => (picked.length ? "" : "Wybierz kogoś") });
    if (!r) return;
    key = r.picked[0];
  }
  if (!isContact(key)) return toast("Najpierw dodaj tę osobę do znajomych");
  startCall(key, mode);
}

/* ============ Rozmowy ============ */
let call = null, incoming = null;
const rv = () => $("#remoteVideo");
const lv = () => $("#localVideo");

function blankTrack() {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 240;
  const x = c.getContext("2d");
  let n = 0;
  const draw = () => { x.fillStyle = "#10101a"; x.fillRect(0, 0, 320, 240); x.fillStyle = n++ % 2 ? "#10101b" : "#10101a"; x.fillRect(0, 0, 4, 4); };
  draw();
  const iv = setInterval(draw, 1000);
  const track = c.captureStream(1).getVideoTracks()[0];
  return { track, stop() { clearInterval(iv); track.stop(); } };
}
async function camTrack(facing) {
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } });
  return s.getVideoTracks()[0];
}
async function screenTrack() {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
  return s.getVideoTracks()[0];
}
async function getLocal(mode, facing) {
  const stream = new MediaStream();
  let warn = "", m = mode, vtrack = null, blank = null;
  try {
    const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    a.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch { warn = "Brak dostępu do mikrofonu"; }
  try {
    if (mode === "video") vtrack = await camTrack(facing);
    else if (mode === "screen") vtrack = await screenTrack();
  } catch { warn = warn || (mode === "screen" ? "Nie udało się udostępnić ekranu" : "Brak dostępu do kamery"); m = "audio"; }
  if (!vtrack) { blank = blankTrack(); vtrack = blank.track; }
  stream.addTrack(vtrack);
  return { stream, vtrack, blank, mode: m, warn };
}

async function startCall(key, mode) {
  if (call || incoming) return toast("Już trwa rozmowa");
  if (!peerOpen) return toast("Brak połączenia z siecią");
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast("Ta przeglądarka nie obsługuje rozmów");
  toast(`Łączę z ${nameOf(key)}…`);
  if (!(await ensureOnline(key, 3000))) return toast(`${nameOf(key)} jest teraz offline`);
  const L = await getLocal(mode, "user");
  if (call || incoming) { L.stream.getTracks().forEach((t) => t.stop()); return; }
  if (L.warn) toast(L.warn);
  let mc;
  try { mc = peer.call(PREFIX + key, L.stream, { metadata: { mode: L.mode } }); } catch { L.stream.getTracks().forEach((t) => t.stop()); return toast("Nie udało się zadzwonić"); }
  call = { key, mc, stream: L.stream, vtrack: L.vtrack, blank: L.blank, mode: L.mode, facing: "user", remoteMode: "audio", muted: false, connected: false };
  wireCall(mc);
  openCallUI("Dzwonię…");
  call.ring = setTimeout(() => { if (call && !call.connected) endCall(`${nameOf(key)} nie odbiera`, true); }, 30000);
}
function wireCall(mc) {
  mc.on("stream", (rs) => {
    if (!call || call.mc !== mc) return;
    rv().srcObject = rs;
    rv().play().catch(() => {});
    if (!call.connected) {
      call.connected = true;
      call.start = now();
      clearTimeout(call.ring);
      tick();
      call.timer = setInterval(tick, 1000);
    }
    updateCallUI();
  });
  mc.on("close", () => { if (call && call.mc === mc) endCall("Rozmowa zakończona", false); });
  mc.on("error", () => { if (call && call.mc === mc) endCall("Błąd połączenia", false); });
}
function tick() {
  if (!call || !call.connected) return;
  const s = Math.floor((now() - call.start) / 1000);
  $("#callStatus").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function openCallUI(status) {
  $("#callName").textContent = nameOf(call.key);
  $("#callStatus").textContent = status;
  $("#callAvatar").replaceChildren(avatar(call.key));
  lv().srcObject = call.blank ? null : new MediaStream([call.vtrack]);
  $("#call").hidden = false;
  updateCallUI();
}
function updateCallUI() {
  if (!call) return;
  const el = $("#call");
  el.classList.toggle("audio", call.remoteMode === "audio");
  el.classList.toggle("nopip", !!call.blank);
  lv().classList.toggle("screen", call.mode === "screen");
  $("#cMute").classList.toggle("off", call.muted);
  $("#cMute use").setAttribute("href", call.muted ? "#i-micoff" : "#i-mic");
  $("#cCam").classList.toggle("off", call.mode !== "video");
  $("#cCam use").setAttribute("href", call.mode === "video" ? "#i-video" : "#i-camoff");
  $("#cFlip").hidden = call.mode !== "video";
  $("#cScreen").classList.toggle("off", call.mode === "screen");
}
async function swapVideo(track, mode) {
  if (!call) return;
  const old = { v: call.vtrack, blank: call.blank };
  let blank = null;
  if (!track) { blank = blankTrack(); track = blank.track; }
  const senders = call.mc.peerConnection.getSenders().filter((s) => s.track && s.track.kind === "video");
  const sender = senders.find((s) => s.track === old.v) || senders[0];
  if (!sender) throw new Error("brak nadawcy");
  await sender.replaceTrack(track);
  if (old.blank) old.blank.stop(); else old.v.stop();
  call.stream.removeTrack(old.v);
  call.stream.addTrack(track);
  Object.assign(call, { vtrack: track, blank, mode });
  lv().srcObject = blank ? null : new MediaStream([track]);
  track.onended = mode === "screen" ? () => { if (call && call.vtrack === track) swapVideo(null, "audio").catch(() => {}); } : null;
  sendEphemeral(call.key, { t: "cmode", mode });
  updateCallUI();
}
async function toggleCam() {
  if (!call) return;
  try {
    if (call.mode === "video") await swapVideo(null, "audio");
    else { call.vtrack.stop(); await swapVideo(await camTrack(call.facing), "video"); }
  } catch { toast("Brak dostępu do kamery"); swapVideo(null, "audio").catch(() => {}); }
}
async function flipCam() {
  if (!call || call.mode !== "video") return;
  const next = call.facing === "user" ? "environment" : "user";
  try { call.vtrack.stop(); await swapVideo(await camTrack(next), "video"); call.facing = next; }
  catch { toast("Nie udało się przełączyć kamery"); swapVideo(null, "audio").catch(() => {}); }
}
async function toggleScreen() {
  if (!call) return;
  try {
    if (call.mode === "screen") await swapVideo(null, "audio");
    else await swapVideo(await screenTrack(), "screen");
  } catch { toast("Nie udało się udostępnić ekranu"); }
}
function endCall(reason, notify) {
  if (!call) return;
  const c = call;
  call = null;
  clearInterval(c.timer);
  clearTimeout(c.ring);
  c.stream.getTracks().forEach((t) => t.stop());
  c.vtrack.stop();
  if (c.blank) c.blank.stop();
  try { c.mc.close(); } catch {}
  rv().srcObject = null;
  lv().srcObject = null;
  $("#call").hidden = true;
  if (notify) sendEphemeral(c.key, { t: "cend" });
  if (reason) toast(reason);
}
function onIncomingCall(mc) {
  const from = mc.peer.slice(PREFIX.length);
  if (!isContact(from) || call || incoming) { try { mc.close(); } catch {} return; }
  const mode = ["video", "screen"].includes(mc.metadata && mc.metadata.mode) ? mc.metadata.mode : "audio";
  incoming = { mc, from, mode };
  $("#incAvatar").replaceChildren(avatar(from));
  $("#incName").textContent = nameOf(from);
  $("#incSub").textContent = { audio: "dzwoni do ciebie…", video: "dzwoni wideo…", screen: "chce ci pokazać ekran…" }[mode];
  $("#incoming").hidden = false;
  ring(true);
  mc.on("close", () => { if (incoming && incoming.mc === mc) { dropIncoming(); toast(`Nieodebrane połączenie od ${nameOf(from)}`); } });
}
function dropIncoming() {
  incoming = null;
  $("#incoming").hidden = true;
  ring(false);
}
async function acceptIncoming() {
  const inc = incoming;
  if (!inc) return;
  dropIncoming();
  const L = await getLocal(inc.mode === "video" ? "video" : "audio", "user");
  if (L.warn) toast(L.warn);
  call = { key: inc.from, mc: inc.mc, stream: L.stream, vtrack: L.vtrack, blank: L.blank, mode: L.mode, facing: "user", remoteMode: inc.mode === "audio" ? "audio" : "video", muted: false, connected: false };
  inc.mc.answer(L.stream);
  wireCall(inc.mc);
  openCallUI("Łączenie…");
  sendEphemeral(inc.from, { t: "cmode", mode: L.mode });
  call.ring = setTimeout(() => { if (call && !call.connected) endCall("Nie udało się połączyć", true); }, 20000);
}
function declineIncoming() {
  const inc = incoming;
  if (!inc) return;
  dropIncoming();
  try { inc.mc.close(); } catch {}
  sendEphemeral(inc.from, { t: "cend" });
}

/* ============ Panel, ustawienia, zdarzenia ============ */
function openSidebar() { $("#sidebar").classList.add("open"); $("#backdrop").classList.add("show"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#backdrop").classList.remove("show"); }
function renderThemes() {
  const box = $("#themes");
  box.replaceChildren();
  for (const t of THEMES) {
    const b = h("button", { type: "button", class: "theme" + (state.theme === t.id ? " active" : "") }, h("span", { class: "swatch", style: `background:${t.sw}` }), t.name);
    b.onclick = () => { state.theme = t.id; save(); render(); renderThemes(); };
    box.append(b);
  }
}
function wireUI() {
  $("#openSidebar").onclick = openSidebar;
  $("#closeSidebar").onclick = closeSidebar;
  $("#backdrop").onclick = closeSidebar;
  $("#search").oninput = renderSidebar;
  $("#addFriend").onclick = addFriend;
  $("#addGroup").onclick = addGroup;
  $("#shareNick").onclick = shareNick;
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { state.tab = t.dataset.tab; save(); renderMain(); }));
  document.querySelectorAll("[data-call]").forEach((b) => (b.onclick = () => callFromHeader(b.dataset.call)));
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { $("#screenBtn").hidden = true; $("#cScreen").hidden = true; }

  $("#cMute").onclick = () => { if (!call) return; call.muted = !call.muted; call.stream.getAudioTracks().forEach((t) => (t.enabled = !call.muted)); updateCallUI(); };
  $("#cCam").onclick = toggleCam;
  $("#cFlip").onclick = flipCam;
  $("#cScreen").onclick = toggleScreen;
  $("#cHang").onclick = () => endCall("Rozmowa zakończona", true);
  $("#incYes").onclick = acceptIncoming;
  $("#incNo").onclick = declineIncoming;

  const input = $("#input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover)").matches) { e.preventDefault(); $("#composer").requestSubmit(); }
  });
  $("#composer").onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send(text);
    input.value = "";
    input.style.height = "auto";
    input.focus();
  };

  $("#openSettings").onclick = () => {
    $("#setNick").textContent = state.me.nick;
    $("#soundToggle").checked = state.sound;
    renderThemes();
    $("#settings").hidden = false;
  };
  $("#closeSettings").onclick = () => ($("#settings").hidden = true);
  $("#settings").onclick = (e) => { if (e.target.id === "settings") $("#settings").hidden = true; };
  $("#copyNick").onclick = async () => { try { await navigator.clipboard.writeText(state.me.nick); toast("Nick skopiowany"); } catch { toast(state.me.nick); } };
  $("#soundToggle").onchange = (e) => { state.sound = e.target.checked; save(); };
  $("#resetData").onclick = async () => {
    $("#settings").hidden = true;
    const r = await ask({ title: "Wylogować?", text: "Znikną wpisy, czaty i znajomi zapisani na tym telefonie. Twój nick znowu będzie wolny.", ok: "Wyloguj", danger: true });
    if (!r) return;
    try { localStorage.removeItem(KEY); } catch {}
    try { peer && peer.destroy(); } catch {}
    location.replace(location.pathname + location.search);
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.me) {
      if (curKey()) delete state.unread[curKey()];
      sweep();
      renderSoon();
    }
  });
}

/* ============ Start ============ */
function showApp() {
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  render();
}
function showWelcome() {
  document.documentElement.dataset.styl = state.theme;
  $("#welcome").hidden = false;
  const form = $("#welcomeForm"), err = $("#welcomeErr"), btn = $("#welcomeBtn"), f = $("#nickField");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nick = f.value.trim().replace(/^@/, "");
    err.textContent = "";
    if (!NICK_RE.test(nick)) { err.textContent = "Nick: 3–16 znaków, tylko litery, cyfry i _"; return; }
    btn.disabled = true;
    btn.textContent = "Sprawdzam nick…";
    try {
      await startPeer(nick);
      state.me = { nick };
      state.names[k(nick)] = nick;
      save();
      showApp();
    } catch (e2) {
      err.textContent = e2.type === "unavailable-id" ? "Ten nick jest już zajęty. Wybierz inny." : "Nie mogę połączyć się z siecią. Sprawdź internet i spróbuj jeszcze raz.";
    }
    btn.disabled = false;
    btn.textContent = "Zaczynamy";
  };
}

wireUI();
if (typeof Peer === "undefined") {
  document.body.append(h("p", { style: "padding:24px;color:#fff" }, "Nie udało się wczytać biblioteki sieciowej. Odśwież stronę."));
} else if (state.me) {
  showApp();
  connectNet(state.me.nick, 10);
} else {
  showWelcome();
}
window.__paleta = { get state() { return state; }, online };
