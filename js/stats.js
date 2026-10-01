// Estadísticas, ranking y Elo calculados a partir de las partidas terminadas.
import { doneMatches, players, score } from "./store.js";

const ELO_START = 1000;
const K = 32;

const teamOf = (m, pid) => m.teams.findIndex((t) => t.players.includes(pid));

export function computeAll() {
  const list = doneMatches().slice().sort((a, b) => (a.finishedAt || a.createdAt) - (b.finishedAt || b.createdAt));
  const S = new Map();
  const get = (id) => {
    if (!S.has(id)) S.set(id, {
      id, pj: 0, pg: 0, pp: 0, elo: ELO_START, eloHist: [ELO_START], results: [],
      partners: new Map(), rivals: new Map(), pts: { envido: 0, truco: 0, flor: 0, manual: 0 },
      maxStreak: 0, puntosAFavor: 0, puntosEnContra: 0,
    });
    return S.get(id);
  };

  for (const m of list) {
    const [A, B] = m.teams.map((t) => t.players);
    if (!A.length || !B.length) continue;
    // Elo por promedio de equipo
    const avg = (ids) => ids.reduce((s, id) => s + get(id).elo, 0) / ids.length;
    const ea = 1 / (1 + 10 ** ((avg(B) - avg(A)) / 400));
    const sa = m.winner === 0 ? 1 : 0;
    const deltaA = K * (sa - ea);

    m.teams.forEach((t, ti) => {
      const won = m.winner === ti;
      const rivals = m.teams[1 - ti].players;
      for (const pid of t.players) {
        const s = get(pid);
        s.pj++; won ? s.pg++ : s.pp++;
        s.results.push({ won, matchId: m.id, ts: m.finishedAt || m.createdAt });
        s.elo += ti === 0 ? deltaA : -deltaA;
        s.eloHist.push(s.elo);
        s.puntosAFavor += score(m, ti);
        s.puntosEnContra += score(m, 1 - ti);
        for (const e of m.events) if (e.team === ti && e.pts > 0) s.pts[e.kind in s.pts ? e.kind : "manual"] += e.pts;
        for (const mate of t.players) if (mate !== pid) {
          const r = s.partners.get(mate) || { pj: 0, pg: 0 }; r.pj++; if (won) r.pg++; s.partners.set(mate, r);
        }
        for (const rv of rivals) {
          const r = s.rivals.get(rv) || { pj: 0, pg: 0 }; r.pj++; if (won) r.pg++; s.rivals.set(rv, r);
        }
      }
    });
  }

  for (const s of S.values()) {
    s.pct = s.pj ? s.pg / s.pj : 0;
    // racha actual y máxima
    let cur = 0, curWon = null, max = 0, run = 0, runWon = null;
    for (const r of s.results) {
      if (r.won === runWon) run++; else { run = 1; runWon = r.won; }
      if (r.won && run > max) max = run;
    }
    for (let i = s.results.length - 1; i >= 0; i--) {
      if (curWon === null) curWon = s.results[i].won;
      if (s.results[i].won === curWon) cur++; else break;
    }
    s.streak = { n: cur, won: curWon };
    s.maxStreak = max;
    s.elo = Math.round(s.elo);
  }
  return S;
}

export function ranking(sortBy = "elo") {
  const S = computeAll();
  const rows = players().map((p) => ({ p, s: S.get(p.id) })).filter((r) => r.s && r.s.pj > 0);
  const cmp = {
    elo: (a, b) => b.s.elo - a.s.elo,
    pg: (a, b) => b.s.pg - a.s.pg || b.s.pct - a.s.pct,
    pct: (a, b) => (b.s.pj >= 3) - (a.s.pj >= 3) || b.s.pct - a.s.pct || b.s.pj - a.s.pj,
    pj: (a, b) => b.s.pj - a.s.pj,
  }[sortBy];
  return rows.sort(cmp);
}

export function playerStats(id) {
  return computeAll().get(id) || null;
}

export { teamOf };
