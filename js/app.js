import * as S from "./store.js";
import { computeAll, ranking, playerStats } from "./stats.js";

const $app = document.getElementById("app");
const $sheetRoot = document.getElementById("sheet-root");
const $toast = document.getElementById("toast");

/* ================= Utilidades ================= */
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ts) => new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ts);
const fmtDay = (ts) => new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(ts);
const pct = (x) => `${Math.round(x * 100)}%`;
const dur = (a, b) => {
  const min = Math.max(1, Math.round((b - a) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};
const hue = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const avatar = (name, cls = "") => `<span class="avatar ${cls}" style="background:hsl(${hue(name)} 45% 38%)">${h(initials(name))}</span>`;
const teamPlayers = (t) => t.players.map(S.playerName).join(", ");
const modeLabel = (m) => `${m.teams[0].players.length || "?"} vs ${m.teams[1].players.length || "?"}`;
const half = (m) => m.target / 2;

let toastTimer;
function toast(msg, undoFn) {
  $toast.innerHTML = `<span>${h(msg)}</span>` + (undoFn ? `<button type="button" id="toast-undo">Deshacer</button>` : "");
  $toast.classList.add("show");
  if (undoFn) document.getElementById("toast-undo").onclick = () => { undoFn(); $toast.classList.remove("show"); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), undoFn ? 3500 : 2200);
}

function openSheet(html, onMount) {
  $toast.classList.remove("show");
  $sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  onMount?.($sheetRoot.querySelector(".sheet"));
}
function closeSheet() {
  $sheetRoot.innerHTML = "";
  if (pendingRender) { pendingRender = false; setTimeout(() => route({ scroll: false }), 0); }
}

/* ================= Palitos ================= */
// Un cuadrado de 5: 4 lados + diagonal (como en la servilleta)
function box(n) {
  const L = [
    [6, 6, 6, 28], [6, 6, 28, 6], [28, 6, 28, 28], [6, 28, 28, 28], [6, 28, 28, 6],
  ];
  const lines = L.slice(0, n).map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  return `<svg viewBox="0 0 34 34" aria-hidden="true"><rect x="2" y="2" width="30" height="30" rx="6"/>${lines}</svg>`;
}
function palitos(points, target) {
  const hf = target / 2;
  const boxesPerHalf = Math.ceil(hf / 5);
  const renderHalf = (pts) => {
    let out = "";
    for (let i = 0; i < boxesPerHalf; i++) out += box(Math.max(0, Math.min(5, pts - i * 5)));
    return out;
  };
  const malas = Math.min(points, hf);
  const buenas = Math.max(0, points - hf);
  return `<div class="palitos">
    <div class="half">${renderHalf(malas)}</div>
    <div class="half buenas-half">${renderHalf(buenas)}</div>
  </div>`;
}

/* ================= Router ================= */
const routes = [
  [/^#?\/?$/, renderHome, "inicio"],
  [/^#\/nueva$/, renderNew, "nueva"],
  [/^#\/partida\/([\w-]+)$/, renderMatch, "nueva"],
  [/^#\/historial$/, renderHistory, "historial"],
  [/^#\/historial\/([\w-]+)$/, renderMatchDetail, "historial"],
  [/^#\/jugadores$/, renderPlayers, "jugadores"],
  [/^#\/jugadores\/([\w-]+)$/, renderPlayer, "jugadores"],
  [/^#\/ranking$/, renderRanking, "ranking"],
  [/^#\/ajustes$/, renderSettings, ""],
];
let currentView = null;
function route({ scroll = true } = {}) {
  const hash = location.hash || "#/";
  document.body.classList.toggle("no-group", !S.getGroup());
  if (!S.getGroup() && hash !== "#/ajustes") {
    currentView = renderWelcome; renderWelcome();
    document.querySelectorAll(".bottomnav a").forEach((a) => a.classList.remove("active"));
    return;
  }
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      currentView = () => fn(...m.slice(1));
      currentView();
      document.querySelectorAll(".bottomnav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
      if (scroll) window.scrollTo(0, 0);
      manageWakeLock(hash.startsWith("#/partida/"));
      return;
    }
  }
  location.hash = "#/";
}
const rerender = () => currentView?.();
window.addEventListener("hashchange", () => { closeSheet(); justWon = null; route(); });

/* ================= Grupos ================= */
function renderWelcome() {
  $app.innerHTML = `<div class="stack">
    <section class="hero">
      <div class="suits" aria-hidden="true">♣♥</div>
      <h1>Bienvenido a Truquito</h1>
      <p>Primero armá el grupo de tu barra. Todos los que estén en el grupo ven los mismos jugadores, partidas y ranking, desde cualquier celular o compu.</p>
    </section>
    <form class="card stack" data-form="create-group">
      <h2>Crear un grupo nuevo</h2>
      <label class="field">Nombre del grupo <input type="text" name="name" placeholder="ej: Barra del jueves" maxlength="40" autocomplete="off" required></label>
      <button class="btn felt block" type="submit">Crear grupo</button>
    </form>
    <form class="card stack" data-form="join-group">
      <h2>Ya tengo un grupo</h2>
      <div class="small muted">Pegá el link de invitación o el código que te pasaron.</div>
      <input type="text" name="code" placeholder="ej: barra-del-jueves-x7k2" autocomplete="off" autocapitalize="off" aria-label="Código o link del grupo" required>
      <button class="btn block" type="submit">Unirme</button>
    </form>
  </div>`;
}

function groupSheet() {
  const list = S.groups();
  const cur = S.getGroup();
  openSheet(`<h2>Mis grupos</h2>
    <div class="stack" style="margin-top:12px;gap:8px">
      ${list.map((g) => `<button type="button" class="opt" data-action="switch-group" data-code="${h(g.code)}" style="${g.code === cur ? "border-color:var(--accent)" : ""}">
        <span>${h(g.name)}<br><small class="muted" style="font-weight:500">${h(g.code)}</small></span><b>${g.code === cur ? "✓" : ""}</b></button>`).join("")}
    </div>
    ${cur ? `<button type="button" class="btn primary block" data-action="invite" style="margin-top:12px">Invitar a “${h(S.groupName())}”</button>` : ""}
    <div class="row" style="margin-top:8px">
      <button type="button" class="btn grow" data-action="new-group">+ Crear grupo</button>
      <button type="button" class="btn grow" data-action="join-group">Unirme a otro</button>
    </div>`);
}

async function invite() {
  const link = S.inviteLink();
  const text = `Sumate a "${S.groupName()}" en Truquito para anotar el truco: ${link}`;
  try {
    if (navigator.share) await navigator.share({ title: "Truquito", text, url: link });
    else { await navigator.clipboard.writeText(link); toast("Link copiado"); }
  } catch {}
}

async function doJoin(value) {
  try {
    toast("Buscando grupo…");
    const name = await S.joinGroup(value);
    closeSheet();
    location.hash = "#/";
    route();
    toast(`Estás en “${name}”`);
  } catch (e) { toast(e.message || "No se pudo unir"); }
}

/* ================= Inicio ================= */
function matchRow(m, highlightPid) {
  const s0 = S.score(m, 0), s1 = S.score(m, 1);
  const href = m.status === "live" ? `#/partida/${m.id}` : `#/historial/${m.id}`;
  let badge = "";
  if (m.status === "live") badge = `<span class="badge live">En juego</span>`;
  else if (m.status === "abandoned") badge = `<span class="badge">Abandonada</span>`;
  else if (highlightPid) {
    const ti = m.teams.findIndex((t) => t.players.includes(highlightPid));
    if (ti >= 0) badge = m.winner === ti ? `<span class="badge w">Ganó</span>` : `<span class="badge l">Perdió</span>`;
  }
  const n0 = `<span class="${m.winner === 0 ? "w" : ""}">${h(m.teams[0].name)}</span>`;
  const n1 = `<span class="${m.winner === 1 ? "w" : ""}">${h(m.teams[1].name)}</span>`;
  const who = m.teams.map(teamPlayers).filter(Boolean).join(" vs ");
  return `<a class="card card-link" href="${href}">
    <div class="match-item">
      <div class="grow">
        <div class="match-teams">${n0} <span class="muted">vs</span> ${n1}</div>
        <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h(who || modeLabel(m))}</div>
        <div class="row small muted" style="margin-top:4px;gap:6px">${badge}<span>${fmtDate(m.createdAt)} · a ${m.target}</span></div>
      </div>
      <div class="match-score">${s0}<span class="muted"> – </span>${s1}</div>
    </div>
  </a>`;
}

function renderHome() {
  const live = S.liveMatches();
  const recent = S.matches().filter((m) => m.status !== "live").slice(0, 5);
  const top = ranking("elo").slice(0, 3);
  $app.innerHTML = `<div class="stack">
    <section class="hero">
      <div class="suits" aria-hidden="true">♣♥</div>
      <h1>¿Echamos un truco?</h1>
      <p>Anotá los puntos, guardá cada partida y mirá quién manda en la mesa.</p>
      <a class="btn primary" href="#/nueva">Nueva partida</a>
    </section>

    ${live.length ? `<div class="section-title"><h2>En juego</h2></div>${live.map((m) => matchRow(m)).join("")}` : ""}

    <div class="section-title"><h2>Últimas partidas</h2>${recent.length ? `<a href="#/historial">Ver todas</a>` : ""}</div>
    ${recent.length ? recent.map((m) => matchRow(m)).join("") : `<div class="empty">Todavía no hay partidas. ¡Arrancá la primera!</div>`}

    ${top.length ? `<div class="section-title"><h2>Top de la mesa</h2><a href="#/ranking">Ranking</a></div>
    <div class="card">${top.map((r, i) => `
      <a class="row" href="#/jugadores/${r.p.id}" style="text-decoration:none;padding:6px 0">
        <span class="rank-n ${i === 0 ? "rank-1" : ""}">${["🥇", "🥈", "🥉"][i]}</span>
        ${avatar(r.p.name)}
        <span class="grow"><b>${h(r.p.name)}</b><br><span class="small muted">${r.s.pg} de ${r.s.pj} ganadas · ${pct(r.s.pct)}</span></span>
        <b>${r.s.elo}</b>
      </a>`).join("")}
    </div>` : ""}
  </div>`;
}

/* ================= Nueva partida ================= */
let draft = null;
function newDraft(from) {
  if (from) {
    return {
      size: Math.max(from.teams[0].players.length, from.teams[1].players.length, 1),
      target: from.target, flor: from.flor,
      names: from.teams.map((t) => t.name),
      teams: from.teams.map((t) => [...t.players]),
    };
  }
  return { size: 2, target: 30, flor: true, names: ["Nosotros", "Ellos"], teams: [[], []] };
}

function renderNew() {
  if (!draft) draft = newDraft();
  const d = draft;
  const all = S.players();
  const slot = (ti) => {
    let out = "";
    for (let i = 0; i < d.size; i++) {
      const pid = d.teams[ti][i];
      out += pid
        ? `<div class="slot">${h(S.playerName(pid))}<button type="button" data-action="unassign" data-pid="${pid}" aria-label="Quitar">×</button></div>`
        : `<div class="slot empty-slot">Jugador ${i + 1}</div>`;
    }
    return out;
  };
  const assigned = (pid) => d.teams[0].includes(pid) ? 0 : d.teams[1].includes(pid) ? 1 : -1;
  const full = d.teams[0].length >= d.size && d.teams[1].length >= d.size;

  $app.innerHTML = `<div class="stack">
    <h1>Nueva partida</h1>

    <div class="card stack">
      <div class="stack" style="gap:6px"><b class="small">Modalidad</b>
        <div class="seg">${[1, 2, 3].map((n) => `<button type="button" data-action="d-size" data-v="${n}" class="${d.size === n ? "on" : ""}">${n} vs ${n}</button>`).join("")}</div>
      </div>
      <div class="stack" style="gap:6px"><b class="small">Se juega a</b>
        <div class="seg">${[30, 40].map((n) => `<button type="button" data-action="d-target" data-v="${n}" class="${d.target === n ? "on" : ""}">${n} puntos<br><span class="muted small">${n / 2} malas y ${n / 2} buenas</span></button>`).join("")}</div>
      </div>
      <label class="switch">Con flor <input type="checkbox" data-action="d-flor" ${d.flor ? "checked" : ""}></label>
    </div>

    <div class="team-pick">
      ${[0, 1].map((ti) => `<div class="team-box">
        <h3>Equipo ${ti + 1}</h3>
        <input type="text" maxlength="24" value="${h(d.names[ti])}" data-input="d-name" data-ti="${ti}" aria-label="Nombre del equipo ${ti + 1}">
        <div class="slots">${slot(ti)}</div>
      </div>`).join("")}
    </div>

    <div class="card stack">
      <div><b>Jugadores</b><div class="small muted">Tocá un nombre para mandarlo al equipo 1, otra vez al equipo 2, otra vez para sacarlo.</div></div>
      <div class="chips">
        ${all.map((p) => {
          const a = assigned(p.id);
          return `<button type="button" class="chip ${a >= 0 ? "on" : ""} ${a === 1 ? "t1" : ""}" data-action="cycle" data-pid="${p.id}">${a >= 0 ? `<small>${a + 1}</small>` : ""}${h(p.name)}</button>`;
        }).join("") || `<span class="small muted">No hay jugadores todavía. Agregá abajo.</span>`}
      </div>
      <form class="row" data-form="quick-player">
        <input type="text" name="name" placeholder="Nuevo jugador…" maxlength="30" autocomplete="off">
        <button class="btn sm" type="submit">Agregar</button>
      </form>
    </div>

    ${!full ? `<p class="small muted" style="margin:0">Podés empezar sin completar jugadores, pero solo cuentan para el ranking las partidas con todos los nombres.</p>` : ""}
    <button class="btn felt block" type="button" data-action="start" style="min-height:54px;font-size:1.05rem">Empezar partida</button>
  </div>`;
}

function cyclePlayer(pid) {
  const d = draft;
  const a = d.teams[0].includes(pid) ? 0 : d.teams[1].includes(pid) ? 1 : -1;
  d.teams = d.teams.map((t) => t.filter((x) => x !== pid));
  const order = a === -1 ? [0, 1] : a === 0 ? [1] : [];
  for (const ti of order) if (d.teams[ti].length < d.size) { d.teams[ti].push(pid); break; }
}

function startMatch() {
  const d = draft;
  const m = S.createMatch({
    target: d.target, flor: d.flor, mode: `${d.size}v${d.size}`,
    teams: [0, 1].map((ti) => ({ name: d.names[ti].trim() || (ti ? "Ellos" : "Nosotros"), players: d.teams[ti].slice(0, d.size) })),
  });
  draft = null;
  location.hash = `#/partida/${m.id}`;
}

/* ================= Anotador ================= */
const CALLS = {
  envido: {
    title: "Envido",
    opts: [["Envido", 2], ["Real envido", 3], ["Envido, envido", 4], ["Envido, real", 5], ["Env., env., real", 7], ["Falta envido", "falta"], ["No quiso", 1], ["No quiso (2)", 2], ["No quiso (4)", 4]],
  },
  truco: {
    title: "Truco",
    opts: [["Truco", 2], ["Retruco", 3], ["Vale cuatro", 4], ["Mano sin cantar", 1], ["No quiso truco", 1], ["No quiso retruco", 2], ["No quiso vale 4", 3]],
  },
  flor: {
    title: "Flor",
    opts: [["Flor", 3], ["Contraflor", 6], ["Contraflor al resto", "falta"], ["Con flor me achico", 4]],
  },
};
const falta = (m) => m.target - Math.max(S.score(m, 0), S.score(m, 1));

function renderMatch(id) {
  const m = S.match(id);
  if (!m) { $app.innerHTML = `<div class="empty">No encontré esa partida. <a href="#/">Volver</a></div>`; return; }
  if (m.status !== "live" && justWon !== id) { location.replace(`#/historial/${id}`); return; }
  const hf = half(m);
  const col = (ti) => {
    const s = S.score(m, ti);
    const sub = s > hf ? `<span class="score-sub buenas">Buenas · ${s - hf}</span>` : `<span class="score-sub">Malas · ${s}</span>`;
    return `<div class="team-col">
      <div class="team-name">${h(m.teams[ti].name)}</div>
      <div class="team-players">${h(teamPlayers(m.teams[ti]))}</div>
      <div class="score-big" id="score-${ti}">${s}</div>
      ${sub}
      <button type="button" class="palitos-tap" data-action="add" data-ti="${ti}" data-pts="1" aria-label="Sumar 1 a ${h(m.teams[ti].name)}">${palitos(s, m.target)}</button>
      <div class="team-actions">
        <button type="button" class="minus" data-action="add" data-ti="${ti}" data-pts="-1" aria-label="Restar 1">−1</button>
        <button type="button" data-action="add" data-ti="${ti}" data-pts="1">+1</button>
        <button type="button" data-action="add" data-ti="${ti}" data-pts="2">+2</button>
        <button type="button" data-action="add" data-ti="${ti}" data-pts="3">+3</button>
      </div>
    </div>`;
  };
  const evs = m.events.slice().reverse().slice(0, 12);
  $app.innerHTML = `<div class="stack">
    <div class="board">
      <div class="board-head"><span>${modeLabel(m)} · a ${m.target}${m.flor ? " · con flor" : ""}</span><span>${m.events.length ? dur(m.createdAt, Date.now()) : "Recién empieza"}</span></div>
      <div class="board-cols">${col(0)}<div class="board-divider"></div>${col(1)}</div>
    </div>

    <div class="call-bar ${m.flor ? "" : "no-flor"}">
      <button type="button" class="call-btn" data-action="call" data-kind="envido">Envido<small>2 · 3 · falta</small></button>
      <button type="button" class="call-btn" data-action="call" data-kind="truco">Truco<small>2 · 3 · 4</small></button>
      ${m.flor ? `<button type="button" class="call-btn" data-action="call" data-kind="flor">Flor<small>3 · 6 · resto</small></button>` : ""}
    </div>

    <div class="row">
      <button type="button" class="btn grow" data-action="undo" ${m.events.length ? "" : "disabled"}>↶ Deshacer</button>
      <button type="button" class="btn" data-action="match-menu" aria-label="Más opciones">⋯</button>
    </div>

    <div class="card">
      <div class="row between"><h2>Jugadas</h2><span class="small muted">${m.events.length} anotaciones</span></div>
      <div class="log">${evs.length ? evs.map((e) => logItem(m, e)).join("") : `<div class="small muted" style="padding:10px 0">Tocá los palitos para sumar 1, o usá Envido / Truco${m.flor ? " / Flor" : ""}.</div>`}</div>
    </div>
  </div>`;
}

function logItem(m, e) {
  return `<div class="log-item">
    <span class="dot ${e.team === 1 ? "t1" : ""}"></span>
    <span class="grow"><b>${h(m.teams[e.team].name)}</b> <span class="muted">· ${h(e.label || (e.pts < 0 ? "Corrección" : "Puntos"))}</span></span>
    <span class="small muted">${new Intl.DateTimeFormat("es-UY", { hour: "2-digit", minute: "2-digit" }).format(e.ts)}</span>
    <span class="pts ${e.pts < 0 ? "neg" : ""}">${e.pts > 0 ? "+" : ""}${e.pts}</span>
  </div>`;
}

let justWon = null;
function doAdd(id, ti, pts, kind = "manual", label = "") {
  const before = S.match(id);
  if (!before) return;
  const prevLen = before.events.length;
  const m = S.addEvent(id, { team: ti, pts, kind, label });
  if (!m) return;
  if (m.events.length === prevLen) { toast(pts > 0 ? "Ya llegó al máximo" : "Ya está en 0"); return; }
  if (m.status === "done") justWon = id;
  rerender();
  document.getElementById(`score-${ti}`)?.classList.add("pop");
  if (navigator.vibrate) navigator.vibrate(12);
  if (m.status === "done") { $toast.classList.remove("show"); showWinner(m); return; }
  const real = m.events[m.events.length - 1].pts;
  toast(`${real > 0 ? "+" : ""}${real} ${m.teams[ti].name}${label ? ` · ${label}` : ""}`, () => { S.undo(id); rerender(); });
}

function openCall(id, kind) {
  const m = S.match(id); const c = CALLS[kind];
  let team = null, custom = 2, customLabel = c.title;
  const draw = (sheet) => {
    const f = falta(m);
    sheet.innerHTML = `<div class="grab"></div>
      <h2>${c.title}</h2>
      <div class="small muted">¿Quién se lo lleva? Después tocá la jugada.</div>
      <div class="team-toggle">
        ${[0, 1].map((ti) => `<button type="button" class="${team === ti ? "on" : ""} ${ti ? "t1" : ""}" data-t="${ti}">${h(m.teams[ti].name)}</button>`).join("")}
      </div>
      <div class="opt-grid">
        ${c.opts.map(([label, v], i) => `<button type="button" class="opt" data-i="${i}"><span>${h(label)}</span><b>${v === "falta" ? f : v}</b></button>`).join("")}
      </div>
      <div class="card flat" style="margin-top:12px">
        <div class="row between">
          <span class="small"><b>Otro valor</b><br><span class="muted">Si en tu mesa se cuenta distinto</span></span>
          <div class="stepper"><button type="button" data-step="-1">−</button><output>${custom}</output><button type="button" data-step="1">+</button></div>
        </div>
        <button type="button" class="btn primary block" data-custom style="margin-top:10px" ${team === null ? "disabled" : ""}>Anotar ${custom}${team !== null ? ` a ${h(m.teams[team].name)}` : ""}</button>
      </div>`;
    sheet.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { team = +b.dataset.t; draw(sheet); });
    sheet.querySelectorAll("[data-step]").forEach((b) => b.onclick = () => { custom = Math.max(1, Math.min(m.target, custom + +b.dataset.step)); draw(sheet); });
    sheet.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => {
      const [label, v] = c.opts[+b.dataset.i];
      const pts = v === "falta" ? f : v;
      if (team === null) {
        custom = pts; customLabel = label; draw(sheet);
        sheet.querySelector(".team-toggle").classList.add("pop");
        toast("Elegí primero qué equipo");
        return;
      }
      closeSheet(); doAdd(id, team, pts, kind, label);
    });
    sheet.querySelector("[data-custom]").onclick = () => { if (team === null) return; closeSheet(); doAdd(id, team, custom, kind, customLabel); };
  };
  openSheet("", draw);
}

function matchMenu(id) {
  const m = S.match(id);
  openSheet(`<h2>Partida</h2>
    <div class="stack" style="margin-top:12px">
      <button type="button" class="btn block" data-action="share-match" data-id="${id}">Compartir marcador</button>
      <button type="button" class="btn block" data-action="abandon" data-id="${id}">Terminar sin ganador</button>
      <button type="button" class="btn block danger" data-action="delete-match" data-id="${id}">Borrar partida</button>
      <button type="button" class="btn block" data-action="close-sheet">Cancelar</button>
    </div>`);
}

function showWinner(m) {
  const w = m.teams[m.winner];
  openSheet(`<div class="winner">
      <div class="trophy">🏆</div>
      <h2>¡Ganó ${h(w.name)}!</h2>
      <div class="muted">${h(teamPlayers(w))}</div>
      <div class="match-score" style="margin:10px 0 4px">${S.score(m, 0)} – ${S.score(m, 1)}</div>
      <div class="small muted">${dur(m.createdAt, m.finishedAt)} · ${m.events.length} anotaciones</div>
    </div>
    <div class="stack" style="margin-top:14px">
      <button type="button" class="btn felt block" data-action="rematch" data-id="${m.id}">Revancha</button>
      <div class="row">
        <button type="button" class="btn grow" data-action="share-match" data-id="${m.id}">Compartir</button>
        <button type="button" class="btn grow" data-action="undo-win" data-id="${m.id}">↶ Deshacer</button>
      </div>
      <a class="btn block" href="#/historial/${m.id}">Ver resumen</a>
    </div>`);
}

async function shareMatch(id) {
  const m = S.match(id);
  const s0 = S.score(m, 0), s1 = S.score(m, 1);
  const status = m.status === "done" ? `¡Ganó ${m.teams[m.winner].name}!` : "Partida en juego";
  const text = `🃏 Truco a ${m.target}\n${m.teams[0].name} ${s0} – ${s1} ${m.teams[1].name}\n${status}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("Copiado al portapapeles"); }
  } catch {}
}

let wakeLock = null;
async function manageWakeLock(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

/* ================= Historial ================= */
let historyFilter = "";
function renderHistory() {
  const all = S.matches();
  const list = historyFilter ? all.filter((m) => m.teams.some((t) => t.players.includes(historyFilter))) : all;
  const groups = new Map();
  for (const m of list) {
    const k = new Date(m.createdAt).toDateString();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  $app.innerHTML = `<div class="stack">
    <div class="row between"><h1>Historial</h1><span class="muted small">${list.length} partidas</span></div>
    ${S.players().length ? `<select data-input="history-filter" aria-label="Filtrar por jugador">
      <option value="">Todos los jugadores</option>
      ${S.players().map((p) => `<option value="${p.id}" ${historyFilter === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}
    </select>` : ""}
    ${list.length ? [...groups.entries()].map(([k, ms]) => `
      <div class="section-title"><h2 style="text-transform:capitalize;font-size:.9rem" class="muted">${fmtDay(ms[0].createdAt)}</h2></div>
      ${ms.map((m) => matchRow(m, historyFilter)).join("")}`).join("")
      : `<div class="empty">No hay partidas ${historyFilter ? "de este jugador" : "todavía"}.</div>`}
  </div>`;
}

function chart(m) {
  const W = 600, H = 200, P = 26;
  const pts = [[0, 0]];
  let a = 0, b = 0;
  for (const e of m.events) { e.team === 0 ? (a += e.pts) : (b += e.pts); pts.push([Math.min(a, m.target), Math.min(b, m.target)]); }
  const n = Math.max(1, pts.length - 1);
  const x = (i) => P + (i / n) * (W - P - 8);
  const y = (v) => H - P - (v / m.target) * (H - P - 10);
  const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const hf = half(m);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del marcador">
    ${[0, hf, m.target].map((v) => `<line class="grid" x1="${P}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" ${v === hf ? 'stroke-dasharray="4 4"' : ""}/><text class="axis" x="${P - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join("")}
    <path d="${path(0)}" fill="none" stroke="var(--felt-2)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path(1)}" fill="none" stroke="var(--red)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <text class="axis" x="${W - 8}" y="${y(hf) - 5}" text-anchor="end">buenas</text>
  </svg>`;
}

function renderMatchDetail(id) {
  const m = S.match(id);
  if (!m) { $app.innerHTML = `<div class="empty">No encontré esa partida. <a href="#/historial">Volver</a></div>`; return; }
  if (m.status === "live") { location.replace(`#/partida/${id}`); return; }
  const by = (ti, kind) => m.events.filter((e) => e.team === ti && e.kind === kind && e.pts > 0).reduce((s, e) => s + e.pts, 0);
  const kinds = [["envido", "Envido"], ["truco", "Truco"], ...(m.flor ? [["flor", "Flor"]] : []), ["manual", "Sueltos"]];
  $app.innerHTML = `<div class="stack">
    <a href="#/historial" class="small muted" style="text-decoration:none">← Historial</a>
    <div class="board">
      <div class="board-head"><span>${fmtDay(m.createdAt)}</span><span>${m.finishedAt ? dur(m.createdAt, m.finishedAt) : ""}</span></div>
      <div class="board-cols">
        ${[0, 1].map((ti) => `${ti ? `<div class="board-divider"></div>` : ""}<div class="team-col">
          <div class="team-name">${m.winner === ti ? "🏆 " : ""}${h(m.teams[ti].name)}</div>
          <div class="team-players">${h(teamPlayers(m.teams[ti]))}</div>
          <div class="score-big">${S.score(m, ti)}</div>
        </div>`).join("")}
      </div>
      <div class="board-head" style="justify-content:center;padding-top:10px">${m.status === "abandoned" ? "Terminada sin ganador" : `${modeLabel(m)} · a ${m.target}${m.flor ? " · con flor" : ""}`}</div>
    </div>

    <div class="card stack">
      <div class="row between"><h2>Cómo fue</h2>
        <div class="legend"><span><i style="background:var(--felt-2)"></i>${h(m.teams[0].name)}</span><span><i style="background:var(--red)"></i>${h(m.teams[1].name)}</span></div>
      </div>
      <div class="chart">${chart(m)}</div>
      <table class="table">
        <thead><tr><th>Puntos por</th><th></th><th>${h(m.teams[0].name)}</th><th>${h(m.teams[1].name)}</th></tr></thead>
        <tbody>${kinds.map(([k, l]) => `<tr><td>${l}</td><td></td><td>${by(0, k)}</td><td>${by(1, k)}</td></tr>`).join("")}</tbody>
      </table>
    </div>

    <div class="row">
      <button type="button" class="btn felt grow" data-action="rematch" data-id="${m.id}">Revancha</button>
      <button type="button" class="btn grow" data-action="share-match" data-id="${m.id}">Compartir</button>
    </div>

    <div class="card">
      <h2>Jugadas</h2>
      <div class="log">${m.events.slice().reverse().map((e) => logItem(m, e)).join("") || `<div class="small muted">Sin anotaciones.</div>`}</div>
    </div>
    <div class="row">
      <button type="button" class="btn grow" data-action="reopen" data-id="${m.id}">Reabrir</button>
      <button type="button" class="btn danger grow" data-action="delete-match" data-id="${m.id}">Borrar</button>
    </div>
  </div>`;
}

/* ================= Jugadores ================= */
function renderPlayers() {
  const stats = computeAll();
  const list = S.players();
  $app.innerHTML = `<div class="stack">
    <h1>Jugadores</h1>
    <form class="row" data-form="add-player">
      <input type="text" name="name" placeholder="Nombre del jugador" maxlength="30" autocomplete="off" aria-label="Nombre del jugador">
      <button class="btn primary" type="submit">Agregar</button>
    </form>
    ${list.length ? list.map((p) => {
      const s = stats.get(p.id);
      return `<a class="card card-link" href="#/jugadores/${p.id}"><div class="row">
        ${avatar(p.name)}
        <div class="grow"><b>${h(p.name)}</b><div class="small muted">${s ? `${s.pj} partidas · ${s.pg} ganadas` : "Sin partidas"}</div></div>
        ${s ? `<div style="text-align:right"><b>${pct(s.pct)}</b><div class="small muted">Elo ${s.elo}</div></div>` : ""}
      </div></a>`;
    }).join("") : `<div class="empty">Agregá a los de la barra para empezar a llevar estadísticas.</div>`}
  </div>`;
}

function renderPlayer(id) {
  const p = S.player(id);
  if (!p || p.deleted) { $app.innerHTML = `<div class="empty">No encontré ese jugador. <a href="#/jugadores">Volver</a></div>`; return; }
  const s = playerStats(id);
  const recent = S.matches().filter((m) => m.teams.some((t) => t.players.includes(id))).slice(0, 5);
  const relList = (map, label) => {
    const rows = [...map.entries()].map(([pid, r]) => ({ pid, ...r })).filter((r) => S.player(r.pid) && !S.player(r.pid).deleted)
      .sort((a, b) => b.pj - a.pj || b.pg / b.pj - a.pg / a.pj).slice(0, 5);
    if (!rows.length) return "";
    return `<div class="card"><h2 style="margin-bottom:8px">${label}</h2>${rows.map((r) => `
      <a class="row" href="#/jugadores/${r.pid}" style="text-decoration:none;padding:6px 0">
        ${avatar(S.playerName(r.pid))}
        <span class="grow"><b>${h(S.playerName(r.pid))}</b><br><span class="small muted">${r.pg} de ${r.pj} ganadas</span></span>
        <span style="width:90px"><div class="bar"><i style="width:${(r.pg / r.pj) * 100}%"></i></div></span>
        <b style="width:42px;text-align:right">${pct(r.pg / r.pj)}</b>
      </a>`).join("")}</div>`;
  };
  const totalPts = s ? Object.values(s.pts).reduce((a, b) => a + b, 0) || 1 : 1;
  $app.innerHTML = `<div class="stack">
    <a href="#/jugadores" class="small muted" style="text-decoration:none">← Jugadores</a>
    <div class="row">
      ${avatar(p.name, "lg")}
      <div class="grow"><h1>${h(p.name)}</h1>
        ${s?.streak?.n ? `<div class="small muted">${s.streak.won ? "🔥" : "🥶"} ${s.streak.n} ${s.streak.won ? "ganada" : "perdida"}${s.streak.n > 1 ? "s" : ""} seguida${s.streak.n > 1 ? "s" : ""}</div>` : ""}
      </div>
      <button type="button" class="icon-btn" data-action="player-menu" data-id="${id}" aria-label="Opciones">⋯</button>
    </div>

    ${s ? `
    <div class="stats-grid">
      <div class="stat"><b>${s.pj}</b><span>Partidas</span></div>
      <div class="stat"><b>${s.pg}</b><span>Ganadas</span></div>
      <div class="stat"><b>${pct(s.pct)}</b><span>Efectividad</span></div>
      <div class="stat"><b>${s.elo}</b><span>Elo</span></div>
      <div class="stat"><b>${s.maxStreak}</b><span>Mejor racha</span></div>
      <div class="stat"><b>${s.puntosAFavor - s.puntosEnContra > 0 ? "+" : ""}${s.puntosAFavor - s.puntosEnContra}</b><span>Dif. puntos</span></div>
    </div>

    <div class="card stack">
      <div class="row between"><h2>Últimas</h2>
        <div class="form-dots">${s.results.slice(-10).map((r) => `<i class="${r.won ? "w" : "l"}">${r.won ? "G" : "P"}</i>`).join("")}</div>
      </div>
      <div><div class="small muted" style="margin-bottom:8px">Puntos de su equipo según la jugada</div>
        ${[["envido", "Envido"], ["truco", "Truco"], ["flor", "Flor"], ["manual", "Sueltos"]].map(([k, l]) => `
          <div class="row small" style="margin:6px 0"><span style="width:70px">${l}</span><span class="grow"><div class="bar"><i style="width:${(s.pts[k] / totalPts) * 100}%"></i></div></span><b style="width:36px;text-align:right">${s.pts[k]}</b></div>`).join("")}
      </div>
    </div>
    ${relList(s.partners, "Con quién gana")}
    ${relList(s.rivals, "Contra quién juega")}
    ` : `<div class="empty">Todavía no terminó ninguna partida.</div>`}

    ${recent.length ? `<div class="section-title"><h2>Partidas recientes</h2></div>${recent.map((m) => matchRow(m, id)).join("")}` : ""}
  </div>`;
}

function playerMenu(id) {
  const p = S.player(id);
  openSheet(`<h2>${h(p.name)}</h2>
    <form class="stack" data-form="rename-player" data-id="${id}" style="margin-top:12px">
      <label class="field">Cambiar nombre <input type="text" name="name" value="${h(p.name)}" maxlength="30"></label>
      <button class="btn primary block" type="submit">Guardar</button>
      <button class="btn danger block" type="button" data-action="delete-player" data-id="${id}">Borrar jugador</button>
    </form>`);
}

/* ================= Ranking ================= */
let rankSort = "elo";
function renderRanking() {
  const rows = ranking(rankSort);
  $app.innerHTML = `<div class="stack">
    <h1>Ranking</h1>
    <div class="seg">${[["elo", "Elo"], ["pg", "Victorias"], ["pct", "%"], ["pj", "Partidas"]].map(([k, l]) => `<button type="button" data-action="rank-sort" data-v="${k}" class="${rankSort === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${rows.length ? `<div class="card" style="padding:6px 10px"><table class="table">
      <thead><tr><th>#</th><th>Jugador</th><th>PJ</th><th>PG</th><th>%</th><th>Elo</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="rank-n ${i === 0 ? "rank-1" : ""}">${i + 1}</td>
        <td><a href="#/jugadores/${r.p.id}">${h(r.p.name)}</a>${r.s.streak.n >= 3 && r.s.streak.won ? " 🔥" : ""}</td>
        <td>${r.s.pj}</td><td>${r.s.pg}</td><td>${pct(r.s.pct)}</td><td><b>${r.s.elo}</b></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <p class="small muted" style="margin:0">El Elo arranca en 1000 y sube más cuando le ganás a alguien mejor rankeado. En parejas se usa el promedio del equipo.${rankSort === "pct" ? " Para el %, primero van los que tienen 3 partidas o más." : ""}</p>`
    : `<div class="empty">El ranking aparece cuando terminen partidas con jugadores cargados.</div>`}
  </div>`;
}

/* ================= Ajustes ================= */
function renderSettings() {
  const theme = safeTheme();
  $app.innerHTML = `<div class="stack">
    <h1>Ajustes</h1>

    ${S.getGroup() ? `<div class="card stack">
      <h2>Grupo</h2>
      <form class="row" data-form="rename-group">
        <input type="text" name="name" value="${h(S.groupName())}" maxlength="40" aria-label="Nombre del grupo">
        <button class="btn sm" type="submit">Guardar</button>
      </form>
      <div class="small muted">Código: <code>${h(S.getGroup())}</code>${S.cloudConfigured() ? " · se comparte en la nube" : " · solo en este dispositivo"}</div>
      <div class="row wrap">
        <button type="button" class="btn sm primary" data-action="invite">Invitar</button>
        <button type="button" class="btn sm" data-action="groups">Cambiar de grupo</button>
        <button type="button" class="btn sm" data-action="sync-now">Sincronizar</button>
        <button type="button" class="btn sm danger" data-action="leave-group">Salir del grupo</button>
      </div>
    </div>` : ""}

    <div class="card stack">
      <h2>Apariencia</h2>
      <div class="seg">${[["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]].map(([k, l]) => `<button type="button" data-action="theme" data-v="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div>
    </div>

    <div class="card stack">
      <h2>Copia de seguridad</h2>
      <div class="row wrap">
        <button type="button" class="btn sm" data-action="export">Descargar backup</button>
        <label class="btn sm">Importar backup<input type="file" accept="application/json,.json" data-input="import" hidden></label>
      </div>
      <button type="button" class="btn sm danger" data-action="reset" style="align-self:flex-start">Borrar todo en este dispositivo</button>
    </div>

    <div class="card stack">
      <h2>Reglas que usa el anotador</h2>
      <ul class="small" style="margin:0;padding-left:18px">
        <li>Partida a 30 (15 malas y 15 buenas) o a 40 (20 y 20).</li>
        <li>Tocá los palitos para sumar 1. Envido, Truco y Flor abren las jugadas con su valor.</li>
        <li>Falta envido y contraflor al resto suman lo que le falta al que va ganando para cerrar la partida. Si en tu mesa se cuenta distinto, usá "Otro valor".</li>
        <li>Cualquier anotación se puede deshacer, incluso la que cierra la partida.</li>
      </ul>
    </div>
    <p class="small muted" style="text-align:center">Truquito · hecho en Uruguay 🇺🇾</p>
  </div>`;
}

function safeTheme() { try { return localStorage.getItem("truquito:theme") || "auto"; } catch { return "auto"; } }
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("truquito:theme", t); } catch {}
}

/* ================= Eventos ================= */
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const matchId = (location.hash.match(/^#\/partida\/([\w-]+)/) || [])[1];

  switch (a) {
    case "close-sheet": closeSheet(); if (justWon) location.hash = `#/historial/${justWon}`; break;
    // nueva partida
    case "d-size": draft.size = +el.dataset.v; draft.teams = draft.teams.map((t) => t.slice(0, draft.size)); renderNew(); break;
    case "d-target": draft.target = +el.dataset.v; renderNew(); break;
    case "d-flor": draft.flor = el.checked; break;
    case "cycle": cyclePlayer(el.dataset.pid); renderNew(); break;
    case "unassign": draft.teams = draft.teams.map((t) => t.filter((x) => x !== el.dataset.pid)); renderNew(); break;
    case "start": startMatch(); break;
    // anotador
    case "add": doAdd(matchId, +el.dataset.ti, +el.dataset.pts, "manual", +el.dataset.pts < 0 ? "Corrección" : ""); break;
    case "call": openCall(matchId, el.dataset.kind); break;
    case "undo": S.undo(matchId); rerender(); toast("Deshecho"); break;
    case "undo-win": S.undo(el.dataset.id); justWon = null; closeSheet(); rerender(); break;
    case "match-menu": matchMenu(matchId); break;
    case "share-match": shareMatch(el.dataset.id); break;
    case "abandon": S.abandonMatch(el.dataset.id); closeSheet(); location.hash = `#/historial/${el.dataset.id}`; break;
    case "delete-match":
      if (confirmTwice(el, "¿Seguro? Tocá de nuevo")) { S.deleteMatch(el.dataset.id); closeSheet(); location.hash = "#/historial"; toast("Partida borrada"); }
      break;
    case "rematch": { const m = S.match(el.dataset.id); draft = newDraft(m); closeSheet(); startMatch(); break; }
    case "reopen": {
      S.reopenMatch(el.dataset.id);
      location.hash = `#/partida/${el.dataset.id}`;
      toast("Partida reabierta");
      break;
    }
    // jugadores
    case "player-menu": playerMenu(el.dataset.id); break;
    case "delete-player":
      if (confirmTwice(el, "Se borra el jugador (las partidas quedan). ¿Seguro?")) { S.deletePlayer(el.dataset.id); closeSheet(); location.hash = "#/jugadores"; }
      break;
    // ranking
    case "rank-sort": rankSort = el.dataset.v; renderRanking(); break;
    // ajustes
    case "theme": applyTheme(el.dataset.v); renderSettings(); break;
    case "copy-link": navigator.clipboard?.writeText(el.dataset.link).then(() => toast("Link copiado")).catch(() => toast(el.dataset.link)); break;
    case "sync-now": S.sync(); break;
    case "leave-group":
      if (confirmTwice(el, "¿Salir? Tocá de nuevo")) { S.leaveGroup(); location.hash = "#/"; route(); toast("Saliste del grupo"); }
      break;
    case "groups": groupSheet(); break;
    case "invite": invite(); break;
    case "switch-group": S.switchGroup(el.dataset.code); closeSheet(); draft = null; location.hash = "#/"; route(); toast(`Grupo: ${S.groupName()}`); break;
    case "new-group":
      openSheet(`<h2>Nuevo grupo</h2><form class="stack" data-form="create-group" style="margin-top:12px">
        <input type="text" name="name" placeholder="ej: Barra del jueves" maxlength="40" required>
        <button class="btn felt block" type="submit">Crear grupo</button></form>`, (sh) => sh.querySelector("input").focus());
      break;
    case "join-group":
      openSheet(`<h2>Unirme a un grupo</h2><form class="stack" data-form="join-group" style="margin-top:12px">
        <input type="text" name="code" placeholder="Link o código" autocapitalize="off" required>
        <button class="btn felt block" type="submit">Unirme</button></form>`, (sh) => sh.querySelector("input").focus());
      break;
    case "export": {
      const blob = new Blob([S.exportJSON()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: `truquito-backup-${new Date().toISOString().slice(0, 10)}.json` });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case "reset":
      if (confirmTwice(el, "Esto borra todo de este dispositivo. ¿Seguro?")) { S.resetAll(); toast("Listo, quedó vacío"); renderSettings(); }
      break;
  }
});

// Confirmación sin alert(): el primer toque cambia el texto, el segundo confirma.
function confirmTwice(el, msg) {
  if (el.dataset.armed) return true;
  el.dataset.armed = "1";
  const old = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = old; } }, 3500);
  return false;
}

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.input === "d-name") draft.names[+el.dataset.ti] = el.value;
});
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset.action === "d-flor") draft.flor = el.checked;
  if (el.dataset.input === "history-filter") { historyFilter = el.value; renderHistory(); }
  if (el.dataset.input === "import" && el.files[0]) {
    try { S.importJSON(await el.files[0].text()); toast("Backup importado"); } catch (e) { toast("No se pudo leer el archivo"); }
    el.value = "";
  }
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("[data-form]");
  if (!f) return;
  ev.preventDefault();
  const val = (f.elements.name || f.elements.code)?.value || "";
  switch (f.dataset.form) {
    case "add-player": if (S.addPlayer(val)) renderPlayers(); setTimeout(() => $app.querySelector("input[name=name]")?.focus(), 0); break;
    case "quick-player": {
      const p = S.addPlayer(val);
      if (p && !draft.teams.flat().includes(p.id)) cyclePlayer(p.id);
      renderNew();
      $app.querySelector("[data-form=quick-player] input")?.focus();
      break;
    }
    case "rename-player": S.renamePlayer(f.dataset.id, val); closeSheet(); rerender(); break;
    case "create-group": {
      if (!S.createGroup(val)) return;
      closeSheet(); draft = null; location.hash = "#/"; route();
      toast("¡Grupo creado! Ahora invitá a la barra");
      break;
    }
    case "join-group": doJoin(val); break;
    case "rename-group": S.renameGroup(val); renderSettings(); toast("Nombre guardado"); break;
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* ================= Arranque ================= */
applyTheme(safeTheme());
const params = new URLSearchParams(location.search);
const inviteCode = params.get("grupo");
if (inviteCode) history.replaceState(null, "", location.pathname + (location.hash || "#/"));
const $chip = document.getElementById("sync-chip");
$chip.addEventListener("click", groupSheet);
const paintChip = (st = lastSync) => {
  lastSync = st;
  $chip.hidden = !S.getGroup();
  const dot = st.state === "ok" ? "ok" : st.state === "err" ? "err" : st.state === "busy" ? "busy" : "";
  $chip.innerHTML = `<i class="sdot ${dot}"></i><span>${h(S.groupName())}</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
  $chip.title = st.state === "err" ? "Sin conexión: se guarda en el celular y se sube cuando vuelva internet" : st.msg;
};
let lastSync = { state: "off", msg: "" };
S.onSync(paintChip);
// Cuando llegan datos nuevos de la nube, redibujar sin perder lo que se está tipeando
let pendingRender = false;
document.addEventListener("focusout", () => setTimeout(() => {
  if (pendingRender && !$sheetRoot.innerHTML) { pendingRender = false; route({ scroll: false }); }
}, 0));
S.subscribe((_, { remote }) => {
  paintChip();
  if (!remote) return;
  const active = document.activeElement;
  if ($sheetRoot.innerHTML || (active && /INPUT|TEXTAREA/.test(active.tagName) && active.value)) { pendingRender = true; return; }
  route({ scroll: false });
});
route();
S.sync();
if (inviteCode && inviteCode !== S.getGroup()) doJoin(inviteCode);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { S.sync(); if (location.hash.startsWith("#/partida/")) manageWakeLock(true); }
});
setInterval(() => { if (document.visibilityState === "visible") S.sync(); }, 10000);
