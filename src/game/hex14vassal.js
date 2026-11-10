// ───────── 삼국지14식 모드: 속국·항복 권유·세력 흡수 ─────────
// 속국: 종주국과 서로 칠 수 없고, 순마다 금 수입의 15%를 바치며, 종주국이 싸우는 나라를 함께 침
// 항복 권유: 아주 약한 나라(또는 오래된 속국)를 통째로 흡수 — 도시·장수·부대가 넘어옴
import { fmtGold } from './format.js';
import { log, enemy } from './hex14.js';
import { powerOf, pactOf, relOf, addRel, incomeOf, PACT, dominantOf, bordering } from './hex14gov.js';

const cities = (s, nid) => s.castles.filter((c) => c.owner === nid && c.kind !== 'pass').length;
export const lordOf = (s, nid) => (s.pacts || []).find((p) => p.type === 'vassal' && p.b === nid)?.a ?? null;
export const vassalsOf = (s, nid) => (s.pacts || []).filter((p) => p.type === 'vassal' && p.a === nid).map((p) => p.b);
const ratio = (s, a, b) => powerOf(s, b) / Math.max(1, powerOf(s, a)); // b가 a에 비해 얼마나 센가
// 속국 요구·항복 권유는 값비싼 일: 국경이 맞닿은 작은 나라에만, 큰 예물을 걸고, 거절당하면 한동안 다시 못 청함
export const VASSAL_MAX = 6; // 속국 요구: 도시 6곳 이하인 나라만
export const SURRENDER_MAX = 8; // 오래된 속국에게 항복 권유: 도시 8곳 이하만 (그 밖의 나라는 3곳 이하)
export const ASK_COOLDOWN = 9; // 거절당하면 9순 동안 그 나라에 다시 청하지 못함
export const vassalCost = (s, b) => Math.max(20000, cities(s, b) * 15000); // 예물: 상대 도시 1곳당 금 1.5만 (적어도 2만)
export const surrenderCost = (s, b) => Math.max(40000, cities(s, b) * 30000); // 예물: 상대 도시 1곳당 금 3만 (적어도 4만)
export const askWait = (s, a, b) => Math.max(0, (s.nations[a]?.askBlock?.[b] ?? 0) - s.turn);
const block = (s, a, b) => { s.nations[a].askBlock = { ...(s.nations[a].askBlock || {}), [b]: s.turn + ASK_COOLDOWN }; };
// 청하기 전에 걸리는 것들 (없으면 null): 대세 뒤·쿨다운·국경·금
function askWhy(s, a, b, cost, grid, vassal) {
  if (vassal && s.endgame) return '천하의 대세가 기울어 더는 속국을 둘 수 없습니다.';
  if (askWait(s, a, b) > 0) return `거절당한 지 얼마 안 되어 ${askWait(s, a, b)}순 뒤에 다시 청할 수 있습니다.`;
  if (grid && !bordering(s, grid, a, b)) return '국경이 맞닿은 나라에만 청할 수 있습니다.';
  if (cost && s.nations[a].gold < cost) return `금이 모자랍니다 (예물 ${fmtGold(cost)}).`;
  if (s.nations[a].lastAsk?.[b] === s.turn) return '이번 순에 이미 사신을 보냈습니다.';
  return null;
}

export function makeVassal(s, lord, vas) {
  if (s.endgame) return; // 대세가 기운 뒤에는 속국을 맺지 않음
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
  if (s.endgame || pactOf(s, a, b)?.type === 'vassal' || lordOf(s, b) !== null) return 0;
  if (cities(s, b) > VASSAL_MAX) return 0; // 도시가 많은 나라는 속국으로 삼을 수 없음
  const r = ratio(s, a, b);
  if (r > 0.5) return 0;
  const tide = dominantOf(s) === a ? 0.25 : 0; // 대세가 기운 나라의 요구는 잘 받아들임
  return Math.max(0, Math.min(0.9, (0.5 - r) * 1.6 + (relOf(s, a, b) - 40) / 100 + tide));
}
// a가 b(더 센 나라)에게 속국으로 받아 달라고 청할 때
export function protectChance(s, a, b) {
  if (s.endgame || lordOf(s, a) !== null) return 0;
  const r = ratio(s, a, b);
  if (r < 2) return 0;
  return Math.max(0.1, Math.min(0.95, 0.5 + (relOf(s, a, b) - 30) / 100));
}
// a가 b에게 항복(흡수)을 권할 때: 도시 3곳 이하에 아주 약하거나, 1년 넘은 속국
export function surrenderChance(s, a, b) {
  const r = ratio(s, a, b), rel = relOf(s, a, b);
  const vas = (s.pacts || []).find((p) => p.type === 'vassal' && p.a === a && p.b === b);
  if (vas && s.turn - vas.since >= 12) return cities(s, b) > SURRENDER_MAX ? 0 : Math.max(0.05, Math.min(0.85, 0.3 + (rel - 50) / 80 + (0.3 - r)));
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
// 속국 요구: 예물(금)을 보냄 — 받아들이든 말든 금은 건너가고, 거절당하면 우호 −8·한동안 다시 못 청함
export function demandVassal(s, a, b, rng = Math.random, grid = null) {
  const n = s.nations[a], cost = vassalCost(s, b);
  if (vassalChance(s, a, b) <= 0) return { ok: false, msg: s.endgame ? '천하의 대세가 기울어 더는 속국을 둘 수 없습니다.' : `속국으로 삼을 수 없는 나라입니다 (도시 ${VASSAL_MAX}곳 이하·우리 힘의 절반 이하만).` };
  const why = askWhy(s, a, b, cost, grid, true);
  if (why) return { ok: false, msg: why };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  // 플레이어에게 온 요구: 받아들이면 그때 예물을 받음
  if (b === s.playerId && !s.spectator) { if (!s.inbox.length && s.turn - (s.envoyAt ?? -99) >= 3) { s.inbox.push({ from: a, type: 'vassal_demand', gift: cost }); s.envoyAt = s.turn; } return { ok: true, msg: '' }; }
  const ch = vassalChance(s, a, b);
  n.gold -= cost; s.nations[b].gold += cost;
  if (rng() < ch) { makeVassal(s, a, b); return { ok: true, msg: `${s.nations[b].name}이(가) 속국이 되었습니다! (예물 금 ${fmtGold(cost)})` }; }
  addRel(s, a, b, -8); block(s, a, b);
  return { ok: true, msg: `${s.nations[b].name}이(가) 예물만 받고 속국 요구를 거절했습니다. (금 −${fmtGold(cost)}, 우호 −8, ${ASK_COOLDOWN}순 뒤 다시 청할 수 있음)` };
}
export function askProtection(s, a, b, rng = Math.random, grid = null) {
  const n = s.nations[a];
  if (protectChance(s, a, b) <= 0) return { ok: false, msg: s.endgame ? '천하의 대세가 기울어 더는 속국이 될 수 없습니다.' : '받아 줄 만큼 센 나라가 아닙니다.' };
  const why = askWhy(s, a, b, 0, grid, true);
  if (why) return { ok: false, msg: why };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (b === s.playerId && !s.spectator) { if (!s.inbox.length && s.turn - (s.envoyAt ?? -99) >= 3) { s.inbox.push({ from: a, type: 'vassal_offer' }); s.envoyAt = s.turn; } return { ok: true, msg: '' }; }
  if (rng() < protectChance(s, a, b)) { makeVassal(s, b, a); return { ok: true, msg: `${s.nations[b].name}의 속국이 되었습니다. 서로 치지 않고, 순마다 금 수입의 15%를 바칩니다.` }; }
  block(s, a, b);
  return { ok: true, msg: `${s.nations[b].name}이(가) 받아 주지 않았습니다. (${ASK_COOLDOWN}순 뒤 다시 청할 수 있음)` };
}
// 항복 권유: 큰 예물을 걸어야 함 — 받아들이면 나라가 통째로 들어오고, 거절당하면 예물만 넘어가고 우호 −10
export function urgeSurrender(s, a, b, rng = Math.random, grid = null) {
  const n = s.nations[a], cost = surrenderCost(s, b), ch = surrenderChance(s, a, b);
  if (ch <= 0) return { ok: false, msg: '항복을 권할 수 없는 나라입니다 (도시 3곳 이하의 아주 약한 나라, 또는 1년 넘은 작은 속국만).' };
  const why = askWhy(s, a, b, cost, grid, false);
  if (why) return { ok: false, msg: why };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  n.gold -= cost;
  if (rng() < ch) { absorb(s, a, b); return { ok: true, msg: `${s.nations[b].name}이(가) 항복했습니다! 도시와 장수가 모두 우리 것이 되었습니다. (예물 금 ${fmtGold(cost)})` }; }
  s.nations[b].gold += cost;
  addRel(s, a, b, -10); block(s, a, b);
  return { ok: true, msg: `${s.nations[b].name}이(가) 예물만 받고 항복을 거절했습니다. (금 −${fmtGold(cost)}, 우호 −10, ${ASK_COOLDOWN}순 뒤 다시 권할 수 있음)` };
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
    if (ai(p.a) && ai(p.b) && s.turn - p.since >= 36 && relOf(s, p.a, p.b) >= 55 && cities(s, p.b) <= SURRENDER_MAX && lord.gold >= surrenderCost(s, p.b) && rng() < 0.03) { lord.gold -= surrenderCost(s, p.b); absorb(s, p.a, p.b); }
  }
  // 컴퓨터 강국: 가끔 아주 약한 이웃에게 속국을 요구하거나 항복을 권함
  for (const n of s.nations) {
    if (!n.alive || n.horde || (n.id === s.playerId && !s.spectator) || rng() > 0.03) continue;
    const mine = s.castles.filter((c) => c.owner === n.id);
    const weak = [...new Set(s.castles.filter((c) => c.owner !== null && c.owner !== n.id && s.nations[c.owner]?.alive && !s.nations[c.owner].horde && mine.some((m) => grid.dist(m.tile, c.tile) <= 10 * grid.k)).map((c) => c.owner))]
      .filter((x) => lordOf(s, x) === null && !vassalsOf(s, x).length && powerOf(s, x) < powerOf(s, n.id) * 0.25);
    if (!weak.length) continue;
    const t = weak[Math.floor(rng() * weak.length)];
    // 금이 넉넉할 때만 (예물을 치르고도 징병·녹봉에 쓸 금이 남게)
    if (t !== s.playerId && surrenderChance(s, n.id, t) > 0.2 && n.gold >= surrenderCost(s, t) * 2) urgeSurrender(s, n.id, t, rng, grid);
    else if (n.gold >= vassalCost(s, t) * 2 || t === s.playerId) demandVassal(s, n.id, t, rng, grid);
  }
  // 강한 이웃 사이에 끼인 컴퓨터 약소국: 가장 센 이웃에게 속국을 청함
  for (const n of s.nations) {
    if (!n.alive || n.horde || (n.id === s.playerId && !s.spectator) || lordOf(s, n.id) !== null || vassalsOf(s, n.id).length) continue;
    const mine = s.castles.filter((c) => c.owner === n.id);
    if (!mine.length || mine.length > 3) continue;
    // 적 부대가 우리 성 앞까지 왔으면 훨씬 자주 (멸망 직전에 강국에 기댐) — 도시 2곳 이하는 처음부터 서둘러 기댐 (통일 시험: 2성 나라가 16순 만에 멸망)
    const pressed = s.units.some((u) => u.nation !== n.id && enemy(s, n.id, u.nation) && mine.some((m) => grid.dist(m.tile, u.tile) <= 4 * grid.k));
    const tiny = mine.length <= 2;
    if (rng() > (tiny ? (pressed ? 0.5 : 0.25) : pressed ? 0.2 : 0.05)) continue;
    const near = new Set();
    for (const c of s.castles) if (c.owner !== null && c.owner !== n.id && s.nations[c.owner]?.alive && mine.some((m) => grid.dist(m.tile, c.tile) <= 10 * grid.k)) near.add(c.owner);
    const strong = [...near].filter((x) => powerOf(s, x) > powerOf(s, n.id) * (tiny ? 2 : 2.5)).sort((a, b) => powerOf(s, b) - powerOf(s, a));
    if (!s.endgame && strong.length >= 1 && (tiny || strong.length >= 2 || pressed || rng() < 0.4)) askProtection(s, n.id, strong[0], rng, grid);
  }
}

export const vassalInboxText = (s, p) => (p.type === 'ransom' ? `사로잡은 ${s.generals[p.gid]?.name}을(를) 금 ${fmtGold(p.price)}에 돌려주겠다고 합니다. (지금 금 ${fmtGold(s.nations[s.playerId].gold)})` : p.type === 'vassal_offer' ? `우리의 속국이 되겠다고 청합니다. 받아들이면 서로 치지 않고, 순마다 금 수입의 15%를 바치며 우리 전쟁을 돕습니다.` : p.type === 'vassal_demand' ? `우리에게 속국이 되라고 요구합니다.${p.gift ? ` 예물로 금 ${fmtGold(p.gift)}을(를) 보내왔습니다.` : ''} 받아들이면 그 나라와 싸우지 않게 되지만 순마다 금 수입의 15%(지금 약 ${fmtGold(Math.round(incomeOf(s, s.playerId) * 0.15))})를 바칩니다.` : null);
export { PACT };
