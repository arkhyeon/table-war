// ───────── 삼국지14식 모드: 속국·항복 권유·세력 흡수 ─────────
// 속국: 종주국과 서로 칠 수 없고, 순마다 금 수입의 15%를 바치며, 종주국이 싸우는 나라를 함께 침
// 항복 권유: 아주 약한 나라(또는 오래된 속국)를 통째로 흡수 — 도시·장수·부대가 넘어옴
import { fmtGold } from './format.js';
import { log, enemy } from './hex14.js';
import { powerOf, pactOf, relOf, addRel, incomeOf, PACT, dominantOf } from './hex14gov.js';

const cities = (s, nid) => s.castles.filter((c) => c.owner === nid && c.kind !== 'pass').length;
export const lordOf = (s, nid) => (s.pacts || []).find((p) => p.type === 'vassal' && p.b === nid)?.a ?? null;
export const vassalsOf = (s, nid) => (s.pacts || []).filter((p) => p.type === 'vassal' && p.a === nid).map((p) => p.b);
const ratio = (s, a, b) => powerOf(s, b) / Math.max(1, powerOf(s, a)); // b가 a에 비해 얼마나 센가

export function makeVassal(s, lord, vas) {
  s.pacts = s.pacts.filter((p) => !((p.a === lord && p.b === vas) || (p.a === vas && p.b === lord)));
  s.pacts.push({ a: lord, b: vas, type: 'vassal', until: 1e9, since: s.turn });
  addRel(s, lord, vas, 10);
  // 서로 노리던 명령은 풀어 줌
  for (const u of s.units) {
    if (u.nation !== lord && u.nation !== vas) continue;
    const other = u.nation === lord ? vas : lord, o = u.order;
    if ((o?.kind === 'castle' && s.castles[o.id]?.owner === other) || (o?.kind === 'unit' && s.units.find((x) => x.id === o.id)?.nation === other)) { u.order = null; u.path = []; u.queue = []; }
  }
  log(s, `👑 ${s.nations[vas].name}이(가) ${s.nations[lord].name}의 속국이 되었습니다.`, 'diplo', [lord, vas]);
}

// a가 b에게 속국이 되라고 요구할 때 받아들일 확률
export function vassalChance(s, a, b) {
  if (pactOf(s, a, b)?.type === 'vassal' || lordOf(s, b) !== null) return 0;
  const r = ratio(s, a, b);
  if (r > 0.5) return 0;
  const tide = dominantOf(s) === a ? 0.25 : 0; // 대세가 기운 나라의 요구는 잘 받아들임
  return Math.max(0, Math.min(0.9, (0.5 - r) * 1.6 + (relOf(s, a, b) - 40) / 100 + tide));
}
// a가 b(더 센 나라)에게 속국으로 받아 달라고 청할 때
export function protectChance(s, a, b) {
  if (lordOf(s, a) !== null) return 0;
  const r = ratio(s, a, b);
  if (r < 2) return 0;
  return Math.max(0.1, Math.min(0.95, 0.5 + (relOf(s, a, b) - 30) / 100));
}
// a가 b에게 항복(흡수)을 권할 때: 도시 3곳 이하에 아주 약하거나, 1년 넘은 속국
export function surrenderChance(s, a, b) {
  const r = ratio(s, a, b), rel = relOf(s, a, b);
  const vas = (s.pacts || []).find((p) => p.type === 'vassal' && p.a === a && p.b === b);
  if (vas && s.turn - vas.since >= 12) return Math.max(0.05, Math.min(0.85, 0.3 + (rel - 50) / 80 + (0.3 - r)));
  if (cities(s, b) > 3 || r > 0.2) return 0;
  return Math.max(0.03, Math.min(0.6, 0.12 + (0.2 - r) * 2 + (rel - 50) / 120));
}

export function absorb(s, a, b) {
  const nb = s.nations[b];
  for (const c of s.castles) if (c.owner === b) { c.owner = a; c.bandit = null; }
  for (let t = 0; t < s.owner.length; t++) if (s.owner[t] === b) s.owner[t] = a;
  for (const g of Object.values(s.generals)) {
    if (g.nation !== b || (g.status !== 'active' && g.status !== 'prisoner')) continue;
    if (g.status === 'active') { g.nation = a; g.loyal = 60; if (g.ruler) { g.ruler = undefined; g.loyal = 70; } }
  }
  for (const u of s.units) if (u.nation === b) { u.nation = a; u.order = null; u.path = []; u.queue = []; }
  for (const f of s.forts || []) if (f.owner === b) f.owner = a;
  s.pacts = s.pacts.filter((p) => p.a !== b && p.b !== b);
  nb.alive = false;
  log(s, `🏳️ ${nb.name}이(가) ${s.nations[a].name}에 항복해 하나가 되었습니다!`, 'capture', [a, b]);
}

// 플레이어(또는 누구든) 행동 — 플레이어에게 오는 것은 사신 창으로
export function demandVassal(s, a, b, rng = Math.random) {
  const n = s.nations[a];
  if (n.lastAsk?.[b] === s.turn) return { ok: false, msg: '이번 턴에 이미 사신을 보냈습니다.' };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (b === s.playerId && !s.spectator) { if (!s.inbox.length && s.turn - (s.envoyAt ?? -99) >= 3) { s.inbox.push({ from: a, type: 'vassal_demand' }); s.envoyAt = s.turn; } return { ok: true, msg: '' }; }
  if (rng() < vassalChance(s, a, b)) { makeVassal(s, a, b); return { ok: true, msg: `${s.nations[b].name}이(가) 속국이 되었습니다!` }; }
  addRel(s, a, b, -8);
  return { ok: true, msg: `${s.nations[b].name}이(가) 속국 요구를 거절했습니다. (우호 −8)` };
}
export function askProtection(s, a, b, rng = Math.random) {
  const n = s.nations[a];
  if (n.lastAsk?.[b] === s.turn) return { ok: false, msg: '이번 턴에 이미 사신을 보냈습니다.' };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (b === s.playerId && !s.spectator) { if (!s.inbox.length && s.turn - (s.envoyAt ?? -99) >= 3) { s.inbox.push({ from: a, type: 'vassal_offer' }); s.envoyAt = s.turn; } return { ok: true, msg: '' }; }
  if (rng() < protectChance(s, a, b)) { makeVassal(s, b, a); return { ok: true, msg: `${s.nations[b].name}의 속국이 되었습니다. 서로 치지 않고, 순마다 금 수입의 15%를 바칩니다.` }; }
  return { ok: true, msg: `${s.nations[b].name}이(가) 받아 주지 않았습니다.` };
}
export function urgeSurrender(s, a, b, rng = Math.random) {
  const n = s.nations[a];
  if (n.lastAsk?.[b] === s.turn) return { ok: false, msg: '이번 턴에 이미 사신을 보냈습니다.' };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (rng() < surrenderChance(s, a, b)) { absorb(s, a, b); return { ok: true, msg: `${s.nations[b].name}이(가) 항복했습니다! 도시와 장수가 모두 우리 것이 되었습니다.` }; }
  addRel(s, a, b, -10);
  return { ok: true, msg: `${s.nations[b].name}이(가) 항복을 거절했습니다. (우호 −10)` };
}
export function declareIndependence(s, vas) {
  const lord = lordOf(s, vas);
  if (lord === null) return { ok: false, msg: '속국이 아닙니다.' };
  s.pacts = s.pacts.filter((p) => !(p.type === 'vassal' && p.b === vas));
  addRel(s, vas, lord, -30);
  log(s, `⚔️ ${s.nations[vas].name}이(가) ${s.nations[lord].name}에게서 독립을 선언했습니다!`, 'diplo', [vas, lord]);
  return { ok: true, msg: `독립! ${s.nations[lord].name}과(와)의 우호가 크게 떨어졌습니다.` };
}

// 종주국이 지금 가장 많이 싸우는 나라
function lordEnemy(s, lord) {
  const m = new Map();
  for (const u of s.units) {
    const o = u.order?.kind === 'castle' ? s.castles[u.order.id]?.owner : null;
    if (u.nation === lord && o !== null && o !== undefined && o !== lord) m.set(o, (m.get(o) || 0) + u.troops);
    if (o === lord && u.nation !== lord) m.set(u.nation, (m.get(u.nation) || 0) + u.troops);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// 순마다: 조공, 속국이 종주국 전쟁을 돕기, 끼인 약소국은 속국을 청함, 오래된 속국은 흡수되기도
export function vassalTurn(s, grid, rng) {
  for (const p of (s.pacts || []).filter((x) => x.type === 'vassal')) {
    const lord = s.nations[p.a], vas = s.nations[p.b];
    if (!lord?.alive || !vas?.alive) continue;
    // 컴퓨터 속국이 종주국보다 1.2배 넘게 세지면 독립 (종주국보다 커진 속국이 계속 조공하지 않게)
    if ((p.b !== s.playerId || s.spectator) && powerOf(s, p.b) > powerOf(s, p.a) * 1.2 && cities(s, p.b) > cities(s, p.a)) { declareIndependence(s, p.b); continue; }
    const pay = Math.round(incomeOf(s, p.b) * 0.15);
    if (pay > 0 && vas.gold >= pay) { vas.gold -= pay; lord.gold += pay; }
    // 컴퓨터 속국은 종주국의 적을 함께 침
    if (p.b !== s.playerId || s.spectator) {
      const foe = lordEnemy(s, p.a);
      if (foe !== null && foe !== p.b && enemy(s, p.b, foe)) { vas.strat = 'ride'; vas.focus = foe; vas.stratAt = s.turn; }
    }
    // 컴퓨터끼리: 1년 넘은 속국은 가끔 흡수
    const ai = (id) => id !== s.playerId || s.spectator;
    if (ai(p.a) && ai(p.b) && s.turn - p.since >= 36 && relOf(s, p.a, p.b) >= 55 && rng() < 0.03) absorb(s, p.a, p.b);
  }
  // 컴퓨터 강국: 가끔 아주 약한 이웃에게 속국을 요구하거나 항복을 권함
  for (const n of s.nations) {
    if (!n.alive || n.horde || (n.id === s.playerId && !s.spectator) || rng() > 0.03) continue;
    const mine = s.castles.filter((c) => c.owner === n.id);
    const weak = [...new Set(s.castles.filter((c) => c.owner !== null && c.owner !== n.id && s.nations[c.owner]?.alive && !s.nations[c.owner].horde && mine.some((m) => grid.dist(m.tile, c.tile) <= 10 * grid.k)).map((c) => c.owner))]
      .filter((x) => lordOf(s, x) === null && !vassalsOf(s, x).length && powerOf(s, x) < powerOf(s, n.id) * 0.25);
    if (!weak.length) continue;
    const t = weak[Math.floor(rng() * weak.length)];
    if (t !== s.playerId && surrenderChance(s, n.id, t) > 0.2) urgeSurrender(s, n.id, t, rng);
    else demandVassal(s, n.id, t, rng);
  }
  // 강한 이웃 사이에 끼인 컴퓨터 약소국: 가장 센 이웃에게 속국을 청함
  for (const n of s.nations) {
    if (!n.alive || n.horde || (n.id === s.playerId && !s.spectator) || lordOf(s, n.id) !== null || vassalsOf(s, n.id).length) continue;
    const mine = s.castles.filter((c) => c.owner === n.id);
    if (!mine.length || mine.length > 3) continue;
    // 적 부대가 우리 성 앞까지 왔으면 훨씬 자주 (멸망 직전에 강국에 기댐)
    const pressed = s.units.some((u) => u.nation !== n.id && enemy(s, n.id, u.nation) && mine.some((m) => grid.dist(m.tile, u.tile) <= 4 * grid.k));
    if (rng() > (pressed ? 0.2 : 0.05)) continue;
    const near = new Set();
    for (const c of s.castles) if (c.owner !== null && c.owner !== n.id && s.nations[c.owner]?.alive && mine.some((m) => grid.dist(m.tile, c.tile) <= 10 * grid.k)) near.add(c.owner);
    const strong = [...near].filter((x) => powerOf(s, x) > powerOf(s, n.id) * 2.5).sort((a, b) => powerOf(s, b) - powerOf(s, a));
    if (strong.length >= 1 && (strong.length >= 2 || pressed || rng() < 0.4)) askProtection(s, n.id, strong[0], rng);
  }
}

export const vassalInboxText = (s, p) => (p.type === 'ransom' ? `사로잡은 ${s.generals[p.gid]?.name}을(를) 금 ${fmtGold(p.price)}에 돌려주겠다고 합니다. (지금 금 ${fmtGold(s.nations[s.playerId].gold)})` : p.type === 'vassal_offer' ? `우리의 속국이 되겠다고 청합니다. 받아들이면 서로 치지 않고, 순마다 금 수입의 15%를 바치며 우리 전쟁을 돕습니다.` : p.type === 'vassal_demand' ? `우리에게 속국이 되라고 요구합니다. 받아들이면 그 나라와 싸우지 않게 되지만 순마다 금 수입의 15%(지금 약 ${fmtGold(Math.round(incomeOf(s, s.playerId) * 0.15))})를 바칩니다.` : null);
export { PACT };
