// Estado, persistencia local y sincronización opcional con Supabase.

const LEGACY_KEY = "truquito:v1";
const GROUP_KEY = "truquito:grupo";      // grupo activo
const GROUPS_KEY = "truquito:grupos";    // [{code, name}] grupos de este dispositivo
const keyFor = (code) => `truquito:g:${code}`;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const now = () => Date.now();

const empty = () => ({ version: 1, meta: { name: "", updatedAt: 0 }, players: [], matches: [] });

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function readJSON(k, fallback) { try { return JSON.parse(safeGet(k)) ?? fallback; } catch { return fallback; } }

migrate();
let state = load();
let listeners = new Set();

// Versión anterior: un solo bloque de datos + código de grupo opcional → pasa a ser el primer grupo.
function migrate() {
  const legacy = safeGet(LEGACY_KEY);
  if (!legacy) return;
  let code = safeGet(GROUP_KEY);
  try {
    const data = JSON.parse(legacy);
    if (data.players?.length || data.matches?.length || code) {
      if (!code) code = "mi-barra-" + Math.random().toString(36).slice(2, 6);
      const list = readJSON(GROUPS_KEY, []);
      if (!list.some((g) => g.code === code)) list.push({ code, name: code });
      safeSet(GROUPS_KEY, JSON.stringify(list));
      safeSet(keyFor(code), JSON.stringify({ ...empty(), ...data, meta: { name: code, updatedAt: 1 } }));
      safeSet(GROUP_KEY, code);
    }
  } catch {}
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
}

function load() {
  const code = getGroup();
  if (!code) return empty();
  const s = readJSON(keyFor(code), null);
  return s ? { ...empty(), ...s } : empty();
}

export const getState = () => state;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function commit({ sync = true, remote = false } = {}) {
  if (getGroup()) {
    safeSet(keyFor(getGroup()), JSON.stringify(state));
    const n = state.meta?.name;
    if (n) updateGroupList(getGroup(), n);
  }
  listeners.forEach((fn) => fn(state, { remote }));
  if (sync) schedulePush();
}

/* ---------- Jugadores ---------- */
export const players = () => state.players.filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name, "es"));
export const player = (id) => state.players.find((p) => p.id === id);
export const playerName = (id) => player(id)?.name ?? "¿?";

export function addPlayer(name) {
  name = name.trim();
  if (!name) return null;
  const existing = players().find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const p = { id: uid(), name, createdAt: now(), updatedAt: now() };
  state.players.push(p);
  commit();
  return p;
}
export function renamePlayer(id, name) {
  const p = player(id); if (!p || !name.trim()) return;
  p.name = name.trim(); p.updatedAt = now(); commit();
}
export function deletePlayer(id) {
  const p = player(id); if (!p) return;
  p.deleted = true; p.updatedAt = now(); commit();
}

/* ---------- Partidas ---------- */
export const matches = () => state.matches.filter((m) => !m.deleted).sort((a, b) => b.createdAt - a.createdAt);
export const match = (id) => state.matches.find((m) => m.id === id && !m.deleted);
export const liveMatches = () => matches().filter((m) => m.status === "live");
export const doneMatches = () => matches().filter((m) => m.status === "done");

export function createMatch({ target, mode, flor, teams }) {
  const m = {
    id: uid(), createdAt: now(), updatedAt: now(), finishedAt: null,
    target, mode, flor, teams, events: [], winner: null, status: "live",
  };
  state.matches.push(m);
  commit();
  return m;
}

export function score(m, team) {
  const s = m.events.filter((e) => e.team === team).reduce((a, e) => a + e.pts, 0);
  return Math.max(0, Math.min(m.target, s));
}

export function addEvent(id, { team, pts, kind = "manual", label = "" }) {
  const m = match(id); if (!m || m.status !== "live") return null;
  const cur = score(m, team);
  // No pasarse del objetivo ni bajar de 0
  const real = Math.max(-cur, Math.min(pts, m.target - cur));
  if (real === 0) return m;
  m.events.push({ id: uid(), team, pts: real, kind, label, ts: now() });
  m.updatedAt = now();
  if (score(m, team) >= m.target) {
    m.status = "done"; m.winner = team; m.finishedAt = now();
  }
  commit();
  return m;
}

export function undo(id) {
  const m = match(id); if (!m || !m.events.length) return;
  m.events.pop();
  if (m.status === "done") { m.status = "live"; m.winner = null; m.finishedAt = null; }
  m.updatedAt = now();
  commit();
}

export function abandonMatch(id) {
  const m = match(id); if (!m) return;
  m.status = "abandoned"; m.finishedAt = now(); m.updatedAt = now(); commit();
}
export function reopenMatch(id) {
  const m = match(id); if (!m) return;
  if (m.status === "done") { undo(id); return; }
  m.status = "live"; m.finishedAt = null; m.updatedAt = now(); commit();
}
export function deleteMatch(id) {
  const m = state.matches.find((x) => x.id === id); if (!m) return;
  m.deleted = true; m.updatedAt = now(); commit();
}

/* ---------- Backup ---------- */
export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(text) {
  const incoming = JSON.parse(text);
  if (!incoming || !Array.isArray(incoming.players) || !Array.isArray(incoming.matches)) throw new Error("Archivo inválido");
  state = merge(state, incoming);
  commit();
}
export function resetAll() {
  for (const g of groups()) { try { localStorage.removeItem(keyFor(g.code)); } catch {} }
  safeSet(GROUPS_KEY, "[]"); safeSet(GROUP_KEY, "");
  state = empty(); commit({ sync: false, remote: true });
}

/* ---------- Merge (last-write-wins por id) ---------- */
function mergeList(a = [], b = []) {
  const map = new Map();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    if (!x || (y.updatedAt || 0) > (x.updatedAt || 0)) map.set(y.id, y);
  }
  return [...map.values()];
}
function merge(a, b) {
  const ma = a.meta || { updatedAt: 0 }, mb = b.meta || { updatedAt: 0 };
  return {
    version: 1,
    meta: (mb.updatedAt || 0) > (ma.updatedAt || 0) ? mb : ma,
    players: mergeList(a.players, b.players),
    matches: mergeList(a.matches, b.matches),
  };
}

/* ---------- Nube (Supabase REST, sin librerías) ---------- */
const cfg = () => window.TRUQUITO_CONFIG || {};
export const cloudConfigured = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);
export function getGroup() { return safeGet(GROUP_KEY) || ""; }
export const cleanCode = (code) => (code || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
export function groups() { return readJSON(GROUPS_KEY, []); }
export const groupName = () => state.meta?.name || groups().find((g) => g.code === getGroup())?.name || getGroup();
function updateGroupList(code, name) {
  const list = groups();
  const g = list.find((x) => x.code === code);
  if (g) { if (g.name === name) return; g.name = name; } else list.push({ code, name });
  safeSet(GROUPS_KEY, JSON.stringify(list));
}
export function switchGroup(code) {
  safeSet(GROUP_KEY, code);
  state = load();
  commit({ sync: false, remote: true });
  sync();
}
// Crea un grupo nuevo con nombre; el código lleva una parte al azar para que nadie lo adivine.
export function createGroup(name) {
  name = name.trim();
  if (!name) return null;
  const slug = cleanCode(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).slice(0, 24).replace(/-+$/, "") || "grupo";
  const code = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  safeSet(keyFor(code), JSON.stringify({ ...empty(), meta: { name, updatedAt: now() } }));
  updateGroupList(code, name);
  switchGroup(code);
  return code;
}
// Unirse a un grupo existente por código o link. Devuelve el nombre o tira error si no existe.
export async function joinGroup(input) {
  let code = input.trim();
  const m = code.match(/[?&]grupo=([^&#]+)/);
  if (m) code = decodeURIComponent(m[1]);
  code = cleanCode(code);
  if (code.length < 4) throw new Error("Código inválido");
  if (groups().some((g) => g.code === code)) { switchGroup(code); return groupName(); }
  if (cloudConfigured()) {
    const r = await fetch(`${endpoint()}?code=eq.${encodeURIComponent(code)}&select=data`, { headers: headers() });
    if (!r.ok) throw new Error("Sin conexión");
    const rows = await r.json();
    if (!rows[0]) throw new Error("No existe ningún grupo con ese código");
    const data = { ...empty(), ...rows[0].data };
    safeSet(keyFor(code), JSON.stringify(data));
    updateGroupList(code, data.meta?.name || code);
  } else {
    updateGroupList(code, code);
  }
  switchGroup(code);
  return groupName();
}
export function renameGroup(name) {
  name = name.trim(); if (!name) return;
  state.meta = { name, updatedAt: now() };
  updateGroupList(getGroup(), name);
  commit();
}
export function leaveGroup(code = getGroup()) {
  safeSet(GROUPS_KEY, JSON.stringify(groups().filter((g) => g.code !== code)));
  try { localStorage.removeItem(keyFor(code)); } catch {}
  const next = groups()[0]?.code || "";
  switchGroup(next);
}
export const inviteLink = (code = getGroup()) => `${location.origin}${location.pathname}?grupo=${encodeURIComponent(code)}`;
// compat
export const setGroup = (code) => { code = cleanCode(code); safeSet(GROUP_KEY, code); return code; };
export const cloudActive = () => cloudConfigured() && !!getGroup();

let syncStatus = { state: "off", msg: "" };
const syncListeners = new Set();
export const onSync = (fn) => { syncListeners.add(fn); fn(syncStatus); };
function setSync(s, msg = "") { syncStatus = { state: s, msg }; syncListeners.forEach((fn) => fn(syncStatus)); }

function headers() {
  const key = cfg().supabaseAnonKey;
  const h = { apikey: key, "Content-Type": "application/json" };
  // Las claves viejas (anon) son JWT y van también en Authorization; las nuevas (sb_publishable_…) no.
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}
const endpoint = () => `${cfg().supabaseUrl.replace(/\/$/, "")}/rest/v1/truco_groups`;

// Trae lo remoto, lo mezcla con lo local y sube el resultado (así dos celulares no se pisan).
let syncing = null;
export function sync() {
  if (!cloudActive()) { setSync("off"); return Promise.resolve(); }
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}
export const pull = sync;

let pushTimer = null;
function schedulePush() {
  if (!cloudActive()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(sync, 800);
}
async function doSync() {
  const code = getGroup();
  setSync("busy", "Sincronizando…");
  try {
    const g = await fetch(`${endpoint()}?code=eq.${encodeURIComponent(code)}&select=data`, { headers: headers() });
    if (!g.ok) throw new Error(`HTTP ${g.status}`);
    const rows = await g.json();
    if (code !== getGroup()) return; // cambió de grupo mientras tanto
    if (rows[0]?.data) {
      const before = JSON.stringify(state);
      state = merge(state, rows[0].data);
      if (JSON.stringify(state) !== before) commit({ sync: false, remote: true });
    }
    const r = await fetch(`${endpoint()}?on_conflict=code`, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ code, data: state, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setSync("ok", "En la nube");
  } catch (e) {
    setSync("err", "Sin conexión");
    console.warn("[truquito] sync", e);
  }
}
