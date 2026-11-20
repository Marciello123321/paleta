// Paleta – prototyp strony głównej.
// Na razie wszystko trzyma się w pamięci telefonu (localStorage), a karty
// przeglądarki synchronizują się na żywo przez BroadcastChannel.
// Później podmienimy warstwę "store" na prawdziwy serwer (np. Firebase/Supabase).

const STORAGE_KEY = "paleta:v1";
const COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#a855f7"];
const THEMES = [
  { id: "noc", name: "Noc", swatch: "linear-gradient(135deg,#14121c 50%,#8b5cf6 50%)" },
  { id: "dzien", name: "Dzień", swatch: "linear-gradient(135deg,#f6f5fa 50%,#6d28d9 50%)" },
  { id: "neon", name: "Neon", swatch: "linear-gradient(135deg,#07090d 50%,#00f5a0 50%)" },
  { id: "pastel", name: "Pastel", swatch: "linear-gradient(135deg,#fff4f2 50%,#f472b6 50%)" },
  { id: "ocean", name: "Ocean", swatch: "linear-gradient(135deg,#0b1724 50%,#38bdf8 50%)" },
];
const REACTIONS = ["😂", "😱", "🔥", "👀"];

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const $ = (s) => document.querySelector(s);

// ---------- Dane startowe ----------
function seed() {
  const me = { id: "me", name: "Ja", color: COLORS[0] };
  const contacts = [
    { id: "c1", name: "Kuba", color: COLORS[1], online: true },
    { id: "c2", name: "Olek", color: COLORS[2], online: true },
    { id: "c3", name: "Szymon", color: COLORS[3], online: false },
    { id: "c4", name: "Bartek", color: COLORS[4], online: false },
  ];
  const t = now();
  const groups = [
    {
      id: "g1",
      name: "Ekipa z klasy",
      emoji: "🔥",
      members: ["me", "c1", "c2", "c3"],
      notebooks: [
        {
          id: "n1",
          name: "Plotki",
          entries: [
            { id: uid(), author: "c1", text: "Słyszeliście, że na imprezie u Olka ktoś się w kimś zakochał? 👀", ts: t - 3600e3, reactions: { "👀": ["c2", "c3"] } },
            { id: uid(), author: "c2", text: "Potwierdzam, widziałem na własne oczy 😂", ts: t - 3000e3, reactions: { "😂": ["c1"] } },
          ],
        },
        { id: "n2", name: "Plany na weekend", entries: [] },
      ],
      messages: [
        { id: uid(), author: "c2", text: "Siema, kto wbija dziś na dc?", ts: t - 1800e3 },
        { id: uid(), author: "c1", text: "Ja po 20", ts: t - 1700e3 },
      ],
    },
    {
      id: "g2",
      name: "Piłka w czwartki",
      emoji: "⚽",
      members: ["me", "c2", "c4"],
      notebooks: [{ id: "n3", name: "Notatnik", entries: [] }],
      messages: [],
    },
  ];
  const dms = { c1: [{ id: uid(), author: "c1", text: "Masz notatki z matmy?", ts: t - 7200e3 }] };
  return {
    me,
    contacts,
    groups,
    dms,
    theme: "noc",
    sound: true,
    current: { type: "group", id: "g1" },
    tab: "notes",
    notebook: { g1: "n1" },
    unread: {},
  };
}

// ---------- Store (pamięć + synchronizacja kart) ----------
let state = load();
const channel = "BroadcastChannel" in window ? new BroadcastChannel("paleta") : null;

// Każda karta może udawać innego kolegę: index.html?jako=Kuba
const params = new URLSearchParams(location.search);
const actingAs = params.get("jako");

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return seed();
}

function save(broadcast = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  if (broadcast && channel) channel.postMessage({ type: "sync" });
}

if (channel) {
  channel.onmessage = (e) => {
    if (e.data?.type !== "sync") return;
    const local = { current: state.current, tab: state.tab, notebook: state.notebook };
    const prevCounts = roomCounts();
    state = load();
    Object.assign(state, local);
    // Policz nieprzeczytane w innych pokojach
    const counts = roomCounts();
    let gotNew = false;
    for (const key in counts) {
      const diff = counts[key] - (prevCounts[key] || 0);
      if (diff > 0) {
        gotNew = true;
        if (key !== roomKey(state.current)) state.unread[key] = (state.unread[key] || 0) + diff;
      }
    }
    if (gotNew) ping();
    render();
  };
}

// ---------- Pomocnicze ----------
function meId() {
  if (actingAs) {
    const c = state.contacts.find((c) => c.name.toLowerCase() === actingAs.toLowerCase());
    if (c) return c.id;
  }
  return state.me.id;
}
function person(id) {
  if (id === state.me.id) return state.me;
  return state.contacts.find((c) => c.id === id) || { name: "?", color: "#666" };
}
function roomKey(r) {
  return `${r.type}:${r.id}`;
}
function roomCounts() {
  const out = {};
  for (const g of state.groups) {
    out[`group:${g.id}`] = g.messages.length + g.notebooks.reduce((n, nb) => n + nb.entries.length, 0);
  }
  for (const id in state.dms) out[`dm:${id}`] = state.dms[id].length;
  return out;
}
function currentGroup() {
  return state.current.type === "group" ? state.groups.find((g) => g.id === state.current.id) : null;
}
function currentNotebook(g) {
  const id = state.notebook[g.id];
  return g.notebooks.find((n) => n.id === id) || g.notebooks[0];
}
function initials(name) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}
function avatar(p, cls = "") {
  const el = document.createElement("span");
  el.className = `avatar ${cls} ${p.online ? "online" : ""}`;
  el.style.background = p.color;
  el.textContent = p.emoji || initials(p.name);
  return el;
}
function time(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function ping() {
  if (!state.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {}
}

// ---------- Render ----------
function render() {
  document.documentElement.dataset.theme = state.theme;
  const me = person(meId());
  $("#meName").textContent = me.name + (actingAs ? " (podgląd)" : "");
  const meAv = $("#meAvatar");
  meAv.style.background = me.color;
  meAv.textContent = initials(me.name);

  renderSidebar();
  renderMain();
}

function renderSidebar() {
  const q = $("#search").value.trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);

  // Grupki
  const gl = $("#groupList");
  gl.innerHTML = "";
  for (const g of state.groups.filter((g) => match(g.name))) {
    const last = lastActivity(g);
    gl.append(
      listItem({
        av: avatar({ name: g.name, emoji: g.emoji, color: "var(--panel-2)" }),
        name: g.name,
        preview: last ? `${person(last.author).name}: ${last.text}` : `${g.members.length} osób`,
        active: state.current.type === "group" && state.current.id === g.id,
        unread: state.unread[`group:${g.id}`],
        onClick: () => openRoom({ type: "group", id: g.id }),
      })
    );
  }

  // Czaty prywatne
  const cl = $("#chatList");
  cl.innerHTML = "";
  const dmIds = Object.keys(state.dms).filter((id) => state.dms[id].length);
  dmIds.sort((a, b) => state.dms[b].at(-1).ts - state.dms[a].at(-1).ts);
  for (const id of dmIds) {
    const c = person(id);
    if (!match(c.name)) continue;
    const last = state.dms[id].at(-1);
    cl.append(
      listItem({
        av: avatar(c),
        name: c.name,
        preview: last.text,
        active: state.current.type === "dm" && state.current.id === id,
        unread: state.unread[`dm:${id}`],
        onClick: () => openRoom({ type: "dm", id }),
      })
    );
  }
  if (!cl.children.length) cl.innerHTML = `<li class="preview" style="cursor:default">Brak czatów</li>`;

  // Kontakty
  const kl = $("#contactList");
  kl.innerHTML = "";
  for (const c of state.contacts.filter((c) => match(c.name))) {
    const li = listItem({
      av: avatar(c),
      name: c.name,
      preview: c.online ? "online" : "offline",
      onClick: () => openRoom({ type: "dm", id: c.id }),
    });
    const acts = document.createElement("div");
    acts.className = "mini-actions";
    for (const [kind, icon] of [["audio", "📞"], ["video", "🎥"]]) {
      const b = document.createElement("button");
      b.textContent = icon;
      b.setAttribute("aria-label", kind === "audio" ? "Zadzwoń" : "Kamerka");
      b.onclick = (e) => {
        e.stopPropagation();
        startCall(kind, c.name);
      };
      acts.append(b);
    }
    li.append(acts);
    kl.append(li);
  }
}

function listItem({ av, name, preview, active, unread, onClick }) {
  const li = document.createElement("li");
  if (active) li.classList.add("active");
  const info = document.createElement("div");
  info.className = "info";
  info.innerHTML = `<div class="name"></div><div class="preview"></div>`;
  info.querySelector(".name").textContent = name;
  info.querySelector(".preview").textContent = preview;
  li.append(av, info);
  if (unread) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = unread;
    li.append(b);
  }
  li.onclick = onClick;
  return li;
}

function lastActivity(g) {
  const all = [...g.messages, ...g.notebooks.flatMap((n) => n.entries)];
  return all.sort((a, b) => b.ts - a.ts)[0];
}

function renderMain() {
  const g = currentGroup();
  const tabs = document.querySelector(".tabs");
  const nbBar = $("#notebookBar");
  nbBar.innerHTML = "";

  if (g) {
    $("#roomName").textContent = `${g.emoji} ${g.name}`;
    $("#roomSub").textContent = g.members.map((id) => person(id).name).join(", ");
    tabs.hidden = false;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  } else {
    const c = person(state.current.id);
    $("#roomName").textContent = c.name;
    $("#roomSub").textContent = c.online ? "online" : "offline";
    tabs.hidden = true;
  }

  const showNotes = g && state.tab === "notes";
  $("#input").placeholder = showNotes
    ? "Wpisz plotkę – grupka zobaczy od razu…"
    : "Napisz wiadomość…";

  if (showNotes) {
    const active = currentNotebook(g);
    for (const nb of g.notebooks) {
      const chip = document.createElement("button");
      chip.className = "chip" + (nb.id === active.id ? " active" : "");
      chip.textContent = `📓 ${nb.name}`;
      chip.onclick = () => {
        state.notebook[g.id] = nb.id;
        save(false);
        renderMain();
      };
      nbBar.append(chip);
    }
    const add = document.createElement("button");
    add.className = "chip";
    add.textContent = "+ notatnik";
    add.onclick = () => {
      const name = prompt("Nazwa notatnika:");
      if (!name?.trim()) return;
      const nb = { id: uid(), name: name.trim(), entries: [] };
      g.notebooks.push(nb);
      state.notebook[g.id] = nb.id;
      save();
      renderMain();
    };
    nbBar.append(add);
    renderNotes(active);
  } else {
    renderChat(g ? g.messages : state.dms[state.current.id] || []);
  }
}

function renderNotes(nb) {
  const feed = $("#feed");
  feed.innerHTML = "";
  if (!nb.entries.length) {
    feed.innerHTML = `<div class="empty"><div class="big">📓</div><p>Notatnik „${escapeHtml(nb.name)}” jest pusty.<br>Wpisz coś na dole – cała grupka zobaczy to od razu.</p></div>`;
    return;
  }
  const me = meId();
  for (const e of [...nb.entries].reverse()) {
    const p = person(e.author);
    const card = document.createElement("article");
    card.className = "note";
    const head = document.createElement("div");
    head.className = "note-head";
    head.append(avatar(p, "sm"));
    const who = document.createElement("span");
    who.className = "note-author";
    who.textContent = e.author === me ? `${p.name} (ty)` : p.name;
    const when = document.createElement("span");
    when.className = "note-time";
    when.textContent = time(e.ts);
    head.append(who, when);

    const text = document.createElement("div");
    text.className = "note-text";
    text.textContent = e.text;

    const reacts = document.createElement("div");
    reacts.className = "reactions";
    for (const emo of REACTIONS) {
      const users = e.reactions?.[emo] || [];
      const b = document.createElement("button");
      b.className = "react" + (users.includes(me) ? " on" : "");
      b.textContent = users.length ? `${emo} ${users.length}` : emo;
      b.onclick = () => {
        e.reactions ||= {};
        const list = (e.reactions[emo] ||= []);
        const i = list.indexOf(me);
        i === -1 ? list.push(me) : list.splice(i, 1);
        save();
        renderMain();
      };
      reacts.append(b);
    }
    card.append(head, text, reacts);
    feed.append(card);
  }
  feed.scrollTop = 0;
}

function renderChat(messages) {
  const feed = $("#feed");
  feed.innerHTML = "";
  if (!messages.length) {
    feed.innerHTML = `<div class="empty"><div class="big">💬</div><p>Jeszcze nic tu nie ma. Napisz pierwszy!</p></div>`;
    return;
  }
  const me = meId();
  for (const m of messages) {
    const mine = m.author === me;
    const wrap = document.createElement("div");
    wrap.className = "msg" + (mine ? " mine" : "");
    if (!mine && state.current.type === "group") {
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = person(m.author).name;
      wrap.append(who);
    }
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = m.text;
    const t = document.createElement("div");
    t.className = "time";
    t.textContent = time(m.ts);
    wrap.append(b, t);
    feed.append(wrap);
  }
  feed.scrollTop = feed.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- Akcje ----------
function openRoom(room) {
  state.current = room;
  delete state.unread[roomKey(room)];
  if (room.type === "dm" && !state.dms[room.id]) state.dms[room.id] = [];
  save(false);
  closeSidebar();
  render();
}

function send(text) {
  const entry = { id: uid(), author: meId(), text, ts: now() };
  const g = currentGroup();
  if (g && state.tab === "notes") {
    currentNotebook(g).entries.push({ ...entry, reactions: {} });
  } else if (g) {
    g.messages.push(entry);
  } else {
    (state.dms[state.current.id] ||= []).push(entry);
  }
  save();
  render();
}

function addContact() {
  const name = prompt("Nick kolegi:");
  if (!name?.trim()) return;
  state.contacts.push({
    id: uid(),
    name: name.trim(),
    color: COLORS[state.contacts.length % COLORS.length],
    online: false,
  });
  save();
  render();
  toast(`Dodano ${name.trim()} do kontaktów`);
}

function addGroup() {
  const name = prompt("Nazwa grupki:");
  if (!name?.trim()) return;
  const others = state.contacts.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  const pick = prompt(`Kogo dodać? Wpisz numery po przecinku:\n${others}`, "1,2") || "";
  const members = pick
    .split(",")
    .map((s) => state.contacts[parseInt(s, 10) - 1]?.id)
    .filter(Boolean);
  const g = {
    id: uid(),
    name: name.trim(),
    emoji: "💬",
    members: ["me", ...new Set(members)],
    notebooks: [{ id: uid(), name: "Notatnik", entries: [] }],
    messages: [],
  };
  state.groups.unshift(g);
  save();
  openRoom({ type: "group", id: g.id });
}

// ---------- Rozmowy (na razie podgląd lokalny) ----------
let stream = null;
async function startCall(kind, who) {
  const title = who || $("#roomName").textContent;
  try {
    if (kind === "screen") {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        toast("Ten telefon/przeglądarka nie pozwala udostępniać ekranu ze strony www");
        return;
      }
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" });
    }
  } catch (err) {
    toast("Brak dostępu do " + (kind === "screen" ? "ekranu" : kind === "video" ? "kamerki" : "mikrofonu"));
    return;
  }
  $("#callVideo").srcObject = kind === "audio" ? null : stream;
  $("#callTitle").textContent = title;
  $("#callSub").textContent =
    kind === "screen" ? "Udostępniasz ekran…" : kind === "video" ? "Łączenie z kamerką…" : "Dzwonię…";
  $("#call").hidden = false;
  stream.getTracks().forEach((t) => (t.onended = endCall));
}
function endCall() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("#call").hidden = true;
}

// ---------- Panel boczny na telefonie ----------
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#backdrop").classList.add("show");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#backdrop").classList.remove("show");
}

// ---------- Ustawienia ----------
function renderThemes() {
  const box = $("#themes");
  box.innerHTML = "";
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.className = "theme" + (state.theme === t.id ? " active" : "");
    b.innerHTML = `<span class="swatch" style="background:${t.swatch}"></span>${t.name}`;
    b.onclick = () => {
      state.theme = t.id;
      save(false);
      render();
      renderThemes();
    };
    box.append(b);
  }
}

// ---------- Zdarzenia ----------
$("#openSidebar").onclick = openSidebar;
$("#closeSidebar").onclick = closeSidebar;
$("#backdrop").onclick = closeSidebar;
$("#search").oninput = renderSidebar;
$("#addContact").onclick = addContact;
$("#addGroup").onclick = addGroup;

document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    state.tab = t.dataset.tab;
    save(false);
    renderMain();
  };
});

document.querySelectorAll("[data-call]").forEach((b) => (b.onclick = () => startCall(b.dataset.call)));
$("#hangup").onclick = endCall;

const input = $("#input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#composer").onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  send(text);
  input.value = "";
  input.style.height = "auto";
};

$("#openSettings").onclick = () => {
  $("#nickInput").value = state.me.name;
  $("#soundToggle").checked = state.sound;
  renderThemes();
  $("#settings").hidden = false;
};
$("#closeSettings").onclick = () => ($("#settings").hidden = true);
$("#settings").onclick = (e) => {
  if (e.target.id === "settings") $("#settings").hidden = true;
};
$("#nickInput").oninput = (e) => {
  state.me.name = e.target.value.trim() || "Ja";
  save();
  render();
};
$("#soundToggle").onchange = (e) => {
  state.sound = e.target.checked;
  save(false);
};
$("#resetData").onclick = () => {
  if (!confirm("Na pewno wyczyścić wszystko na tym telefonie?")) return;
  state = seed();
  save();
  render();
  $("#settings").hidden = true;
  toast("Wyczyszczono");
};

render();
