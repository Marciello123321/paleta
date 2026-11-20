"use strict";
/* Paleta – czat ekipy: grupki, wspólne notatniki, rozmowy.
   Telefony łączą się bezpośrednio (WebRTC przez PeerJS), nick = adres.
   Dane trzymane są na telefonie; wiadomości do osób offline czekają w kolejce. */

const KEY = "paleta:v2";
const PREFIX = "paleta-app-v1-";
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const KEY_RE = /^[a-z0-9_]{3,16}$/;
const THEMES = [
  { id: "noc", name: "Noc", sw: "linear-gradient(135deg,#111b21 50%,#00a884 50%)" },
  { id: "dzien", name: "Dzień", sw: "linear-gradient(135deg,#efeae2 50%,#008069 50%)" },
  { id: "fiolet", name: "Fiolet", sw: "linear-gradient(135deg,#14121c 50%,#8b5cf6 50%)" },
  { id: "pastel", name: "Pastel", sw: "linear-gradient(135deg,#fffaf9 50%,#e0457b 50%)" },
  { id: "ocean", name: "Ocean", sw: "linear-gradient(135deg,#0c1622 50%,#3aa6f0 50%)" },
  { id: "zachod", name: "Zachód", sw: "linear-gradient(135deg,#1a1012 50%,#f97316 50%)" },
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
  return { v: 2, me: null, theme: "noc", sound: true, contacts: [], requests: [], pending: [], names: {}, groups: [], dms: {}, outbox: {}, current: null, view: {}, unread: {} };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 2) return migrate({ ...fresh(), ...s });
  } catch {}
  return fresh();
}
function migrate(s) {
  for (const g of s.groups || []) {
    if (!g.notes) {
      g.notes = {};
      for (const nb of g.notebooks || []) for (const e of nb.entries || []) (g.notes[e.a] ||= []).push(e);
      for (const l of Object.values(g.notes)) l.sort((a, b) => a.ts - b.ts);
      delete g.notebooks;
      s.unread = {};
    }
  }
  s.view ||= {};
  if (!THEMES.some((t) => t.id === s.theme)) s.theme = s.theme === "neon" ? "fiolet" : "noc";
  return s;
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
  const el = h("span", { class: `avatar ${cls} ${online.has(key) ? "on" : ""}` }, nameOf(key).slice(0, 1));
  el.style.background = pal(key)[0];
  return el;
}
const hm = (ts) => new Date(ts).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
function dayLabel(ts) {
  const d = new Date(ts).toDateString(), t = new Date(), y = new Date(t);
  y.setDate(t.getDate() - 1);
  if (d === t.toDateString()) return "Dzisiaj";
  if (d === y.toDateString()) return "Wczoraj";
  return new Date(ts).toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
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
  if (state.me) renderSoon();
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
function viewingKey() {
  const g = curGroup();
  if (g) { const v = viewOf(g); return v === "chat" ? `g:${g.id}` : `n:${g.id}:${v}`; }
  return state.current && state.current.type === "dm" ? `d:${state.current.id}` : null;
}
function bump(ukey) {
  if (ukey !== viewingKey() || document.hidden) state.unread[ukey] = (state.unread[ukey] || 0) + 1;
  ping();
}
function groupUnread(g) {
  let n = state.unread[`g:${g.id}`] || 0;
  for (const m of g.members) n += state.unread[`n:${g.id}:${m.id}`] || 0;
  return n;
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
    if (i >= 0) { q.splice(i, 1); if (!q.length) delete state.outbox[from]; save(); renderSoon(); }
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
      if (addUnique((state.dms[from] ||= []), e)) { bump(`d:${from}`); save(); renderSoon(); }
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
        notes: {}, messages: [],
      });
      toast(`${nameOf(from)} dodał(a) cię do grupki „${state.groups[0].name}”`);
      ping(); save(); renderSoon();
      return;
    }
    case "note": {
      const g = groupOf(d.gid, from), e = cleanEntry(d.e);
      if (!g || !e) return;
      e.a = from; e.reactions = {};
      if (addUnique(((g.notes ||= {})[from] ||= []), e)) { bump(`n:${g.id}:${from}`); save(); renderSoon(); }
      return;
    }
    case "gmsg": {
      const g = groupOf(d.gid, from), e = cleanEntry(d.e);
      if (!g || !e) return;
      e.a = from;
      if (addUnique(g.messages, e)) { bump(`g:${g.id}`); save(); renderSoon(); }
      return;
    }
    case "react": {
      const g = groupOf(d.gid, from);
      const owner = typeof d.owner === "string" ? d.owner : "";
      if (!g || !g.members.some((m) => m.id === owner)) return;
      const e = ((g.notes || {})[owner] || []).find((x) => x.id === d.eid);
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
function viewOf(g) {
  const v = state.view[g.id];
  if (v === "chat" || (v && g.members.some((m) => m.id === v))) return v;
  let best = null, ts = 0;
  for (const m of g.members) {
    const l = (g.notes || {})[m.id] || [];
    if (l.length && l[l.length - 1].ts > ts) { ts = l[l.length - 1].ts; best = m.id; }
  }
  return best || meKey();
}
const plural = (n) => `${n} ${n === 1 ? "osoba" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 > 20) ? "osoby" : "osób"}`;
function render() {
  if (!state.me) return;
  document.documentElement.dataset.styl = state.theme;
  if (!document.hidden) { const vk = viewingKey(); if (vk) delete state.unread[vk]; }
  const head = getComputedStyle(document.documentElement).getPropertyValue("--head").trim();
  if (head) document.querySelector('meta[name="theme-color"]').content = head;
  renderRail();
  renderMain();
}

function railItem({ av, label, active, unread, dim, onClick }) {
  const b = h("button", { class: "ri" + (active ? " active" : "") + (dim ? " dim" : "") }, av, h("span", { class: "lbl" }, label));
  if (unread) b.append(h("span", { class: "badge" }, unread > 99 ? "99+" : unread));
  if (onClick) b.onclick = onClick;
  return b;
}
function renderRail() {
  const gl = $("#groupList"), cl = $("#chatList");
  gl.replaceChildren();
  cl.replaceChildren();
  for (const g of state.groups) {
    gl.append(railItem({
      av: h("span", { class: "avatar emoji" }, g.emoji), label: g.name, unread: groupUnread(g),
      active: state.current && state.current.type === "group" && state.current.id === g.id,
      onClick: () => openRoom({ type: "group", id: g.id }),
    }));
  }
  if (!state.groups.length) gl.append(h("div", { class: "rail-hint" }, "brak"));
  const friends = [...state.contacts].sort((x, y) => (online.has(y.id) - online.has(x.id)) || x.nick.localeCompare(y.nick));
  for (const c of friends) {
    cl.append(railItem({
      av: avatar(c.id), label: c.nick, unread: state.unread[`d:${c.id}`],
      active: state.current && state.current.type === "dm" && state.current.id === c.id,
      onClick: () => openRoom({ type: "dm", id: c.id }),
    }));
  }
  for (const p of state.pending) cl.append(railItem({ av: avatar(p.id), label: p.nick, dim: true }));
  if (!cl.children.length) cl.append(h("div", { class: "rail-hint" }, "brak"));
  const av = avatar(meKey());
  av.classList.remove("on");
  av.classList.add(netStatus === "online" ? "on" : netStatus === "error" ? "bad" : "wait");
  $("#railMe").replaceChildren(av, h("span", { class: "lbl" }, state.me.nick));
  $("#reqDot").hidden = !state.requests.length;
}

let lastFeedId = "";
let forceScroll = true;
function renderMain() {
  const g = curGroup();
  const dm = state.current && state.current.type === "dm" ? state.current.id : null;
  if (state.current && !g && !dm) state.current = null;
  const inRoom = !!(g || dm);
  const me = meKey();
  $("#roomActions").hidden = !inRoom;
  const bar = $("#notebookBar");
  bar.replaceChildren();
  let view = null, canWrite = inRoom;

  const roomAv = $("#roomAv");
  roomAv.replaceChildren(g ? h("span", { class: "avatar emoji" }, g.emoji) : dm ? avatar(dm) : h("span", { html: ic("logo") }));
  if (g) {
    view = viewOf(g);
    const on = g.members.filter((x) => x.id !== me && online.has(x.id)).length;
    $("#roomName").textContent = g.name;
    $("#roomSub").textContent = `${plural(g.members.length)} · ${on} online`;
    const chips = [["chat", "Czat", "chat", state.unread[`g:${g.id}`]], [me, "Mój notatnik", "notebook", state.unread[`n:${g.id}:${me}`]]];
    for (const m of g.members) if (m.id !== me) chips.push([m.id, nameOf(m.id), "notebook", state.unread[`n:${g.id}:${m.id}`]]);
    for (const [id, label, icon, n] of chips) {
      const chip = h("button", { class: "chip" + (id === view ? " active" : "") }, h("span", { html: ic(icon) }), label, n ? h("span", { class: "badge" }, n) : null);
      chip.onclick = () => { state.view[g.id] = id; forceScroll = true; save(); render(); };
      bar.append(chip);
    }
    canWrite = view === "chat" || view === me;
  } else if (dm) {
    $("#roomName").textContent = nameOf(dm);
    $("#roomSub").textContent = online.has(dm) ? "online" : "offline";
  } else {
    $("#roomName").textContent = "Paleta";
    $("#roomSub").textContent = netStatus === "online" ? "jesteś online" : netStatus === "error" ? "brak połączenia z siecią" : "łączenie…";
  }

  $("#composer").hidden = !(inRoom && canWrite);
  $("#input").placeholder = g ? (view === "chat" ? "Napisz do grupki…" : "Zapisz coś w swoim notatniku…") : "Napisz wiadomość…";

  const id = `${curKey()}|${view}`;
  if (id !== lastFeedId) { forceScroll = true; lastFeedId = id; }
  const feed = $("#feed");
  const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  const top = feed.scrollTop;
  feed.replaceChildren();
  const notes = g && view !== "chat";
  if (!inRoom) renderHome(feed);
  else if (notes) renderNotes(feed, g, view);
  else renderChat(feed, g ? g.messages : state.dms[dm] || [], !!g);
  if (!inRoom) feed.scrollTop = 0;
  else feed.scrollTop = forceScroll || near ? feed.scrollHeight : top;
  forceScroll = false;
}

function renderHome(feed) {
  const btn = (icon, label, fn) => h("button", { onclick: fn }, h("span", { html: ic(icon) }), label);
  feed.append(h("div", { class: "home" },
    h("span", { html: `<svg class="ic face"><use href="#i-callface"/></svg>` }),
    h("h2", {}, `Cześć, ${state.me.nick}`),
    h("p", {}, "Wybierz grupkę albo znajomego po lewej. Jeśli nikogo jeszcze nie masz, zacznij tutaj:"),
    h("div", { class: "home-btns" }, btn("userplus", "Dodaj znajomego", addFriend), btn("users", "Stwórz grupkę", addGroup))));
}

function pendingIds() {
  const ids = new Set();
  for (const q of Object.values(state.outbox)) for (const ev of q) if (ev.e && ev.e.id) ids.add(ev.e.id);
  return ids;
}
function meta(ts, mine, pending) {
  const m = h("span", { class: "meta" }, hm(ts));
  if (mine) m.append(h("span", { class: pending ? "" : "done", html: ic(pending ? "tick" : "ticks"), title: pending ? "czeka na wysłanie" : "dostarczone" }));
  return m;
}
// Wiadomości i wpisy w stylu dymków: daty między dniami, ogonek przy pierwszym dymku danej osoby
function bubbles(feed, list, { isGroup, note, onTap }) {
  const me = meKey(), pend = pendingIds();
  let day = "", prev = null;
  for (const m of list) {
    const d = dayLabel(m.ts);
    if (d !== day) { feed.append(h("div", { class: "day" }, d)); day = d; prev = null; }
    const mine = m.a === me, cont = prev === m.a;
    prev = m.a;
    const b = h("div", { class: "msg" + (mine ? " mine" : "") + (cont ? " cont" : "") + (note ? " note" : "") });
    if (isGroup && !mine && !cont) {
      const who = h("div", { class: "who" }, nameOf(m.a));
      who.style.color = pal(m.a)[0];
      b.append(who);
    }
    b.append(h("span", { class: "txt" }, m.x), meta(m.ts, mine, pend.has(m.id)));
    if (onTap) onTap(b, m);
    feed.append(b);
  }
}

let picking = null;
document.addEventListener("click", (e) => { if (picking && !e.target.closest(".msg.note")) { picking = null; renderMain(); } });
function renderNotes(feed, g, owner) {
  const list = (g.notes || {})[owner] || [];
  const me = meKey(), mine = owner === me;
  feed.append(h("div", { class: "notice" }, mine
    ? "To twój notatnik. Wszyscy z grupki widzą, co tu zapiszesz."
    : `Notatnik: ${nameOf(owner)}. Pisze tu tylko ${nameOf(owner)}. Stuknij wpis, żeby zareagować.`));
  if (!list.length) {
    feed.append(h("div", { class: "empty", html: ic("notebook") + "<p></p>" }));
    feed.querySelector(".empty p").textContent = mine ? "Pusto. Zapisz coś na dole." : `${nameOf(owner)} nic jeszcze nie zapisał(a).`;
    return;
  }
  bubbles(feed, list, {
    isGroup: false, note: true,
    onTap: (b, e) => {
      const counts = REACTIONS.map((emo) => [emo, ((e.reactions || {})[emo] || []).length]).filter(([, n]) => n);
      if (counts.length) {
        b.classList.add("has-rx");
        b.append(h("span", { class: "rx" }, counts.map(([emo, n]) => (n > 1 ? `${emo}${n}` : emo)).join(" ")));
      }
      if (picking === e.id) {
        const bar = h("div", { class: "picker" });
        for (const emo of REACTIONS) {
          const on = ((e.reactions || {})[emo] || []).includes(me);
          bar.append(h("button", { class: on ? "on" : "", "aria-label": `Reakcja ${emo}`, onclick: (ev) => { ev.stopPropagation(); react(g, owner, e, emo); } }, emo));
        }
        b.append(bar);
      }
      b.onclick = (ev) => { ev.stopPropagation(); picking = picking === e.id ? null : e.id; renderMain(); };
    },
  });
}
function react(g, owner, e, emo) {
  const me = meKey();
  e.reactions ||= {};
  const l = (e.reactions[emo] ||= []);
  const i = l.indexOf(me);
  i < 0 ? l.push(me) : l.splice(i, 1);
  picking = null;
  save(); renderMain();
  broadcast(g, { t: "react", gid: g.id, owner, eid: e.id, emo, on: i < 0 });
}

function renderChat(feed, list, isGroup) {
  if (!list.length) {
    feed.append(h("div", { class: "empty", html: ic("chat") + "<p>Jeszcze cicho. Napisz pierwszy!</p>" }));
    return;
  }
  bubbles(feed, list, { isGroup });
}

/* ============ Akcje ============ */
function pickView(g) {
  for (const m of g.members) if (state.unread[`n:${g.id}:${m.id}`]) return m.id;
  if (state.unread[`g:${g.id}`]) return "chat";
  return viewOf(g);
}
function openRoom(r) {
  state.current = r;
  if (r.type === "dm" && !state.dms[r.id]) state.dms[r.id] = [];
  if (r.type === "group") { const g = curGroup(); if (g) state.view[g.id] = pickView(g); }
  forceScroll = true;
  save();
  render();
}
function send(text) {
  const g = curGroup();
  const e = { id: uid(), a: meKey(), x: text.slice(0, 2000), ts: now() };
  const wire = { id: e.id, x: e.x, ts: e.ts };
  if (g) {
    const v = viewOf(g);
    if (v === "chat") { g.messages.push(e); broadcast(g, { t: "gmsg", gid: g.id, e: wire }); }
    else if (v === meKey()) { ((g.notes ||= {})[v] ||= []).push({ ...e, reactions: {} }); broadcast(g, { t: "note", gid: g.id, e: wire }); }
    else return;
  } else if (state.current && state.current.type === "dm") {
    (state.dms[state.current.id] ||= []).push(e);
    sendTo(state.current.id, { t: "dm", e: wire });
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
    notes: {}, messages: [],
  };
  state.groups.unshift(g);
  save();
  broadcast(g, { t: "gnew", g: { id: g.id, name: g.name, emoji: g.emoji, members: g.members } });
  openRoom({ type: "group", id: g.id });
}
function acceptRequest(r) {
  becomeContacts(r.id, r.nick);
  sendTo(r.id, { t: "facc", nick: state.me.nick });
  save(); render(); renderPlus();
  toast(`${r.nick} jest teraz w twoich znajomych`);
}
function renderPlus() {
  const box = $("#plusBody");
  box.replaceChildren();
  const btn = (icon, title, sub, fn) => h("button", { class: "menu-btn", onclick: fn }, h("span", { html: ic(icon) }), h("span", {}, title, h("small", {}, sub)));
  box.append(
    btn("userplus", "Dodaj znajomego", "wpisz jego nick", () => { closePlus(); addFriend(); }),
    btn("users", "Stwórz grupkę", "czat i notatniki dla ekipy", () => { closePlus(); addGroup(); }),
    btn("share", "Zaproś kogoś do Palety", `twój nick: ${state.me.nick}`, () => shareNick()),
  );
  if (state.requests.length) {
    box.append(h("div", { class: "sec-h" }, "Zaproszenia do znajomych"));
    for (const r of state.requests) {
      const yes = h("button", { class: "round yes", "aria-label": "Przyjmij", html: ic("check") });
      const no = h("button", { class: "round no", "aria-label": "Odrzuć", html: ic("close") });
      yes.onclick = () => acceptRequest(r);
      no.onclick = () => { state.requests = state.requests.filter((x) => x.id !== r.id); save(); render(); renderPlus(); };
      box.append(h("div", { class: "req" }, avatar(r.id, "sm"), h("div", { class: "txt" }, h("b", {}, r.nick), "chce być twoim znajomym"), no, yes));
    }
  }
}
function openPlus() { renderPlus(); $("#plus").hidden = false; }
function closePlus() { $("#plus").hidden = true; }
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
  $("#railAdd").onclick = openPlus;
  $("#closePlus").onclick = closePlus;
  $("#plus").onclick = (e) => { if (e.target.id === "plus") closePlus(); };
  $("#railMe").onclick = () => $("#openSettings").click();
  document.querySelectorAll("[data-call]").forEach((b) => (b.onclick = () => callFromHeader(b.dataset.call)));
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) $("#cScreen").hidden = true;

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
