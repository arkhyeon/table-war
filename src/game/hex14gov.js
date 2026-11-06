// ───────── 삼국지14식 모드: 내정(농업·상업·징병 담당관), 병량·수확, 관할 땅 넓히기, 외교, 인재 ─────────
import { makeRng } from './rng.js';
import { initTraits } from './traits.js';
import { T14, MAP14, t14, castleGens, nationT } from './hex14traits.js';

// 특성이 없는 장수(새로 나온 장수 등)에게 능력에 맞는 특성을 붙임
export function ensureTraits(s) {
  for (const g of Object.values(s.generals)) {
    if (g.status === 'gone') continue;
    if (!(g.traits || []).length) g.traits = initTraits(g, makeRng(`trait:${s.seed}:${g.id}`)).traits;
    // 이 모드에 없는 특성은 비슷한 것으로 (겹치면 높은 등급 하나만)
    const m = new Map();
    for (const [t, tier] of g.traits) { const k = T14[t] ? t : MAP14[t]; if (k && T14[k] && !(m.get(k) >= tier)) m.set(k, tier); }
    g.traits = [...m.entries()];
  }
}
import { fmtTroops, fmtGold } from './format.js';
import { POOLS } from './generals.js';
import { EXTRA, FREE_NAMES, RULERS } from './hex14roster.js';
import { log, districtTiles, landShare } from './hex14.js';
import { hasPolicy, POLICY_UPKEEP } from './hex14policy.js';
import { initPeople, peopleTurn } from './hex14people.js';
import { makeVassal, vassalTurn } from './hex14vassal.js';

export const ROLES = { farm: '농업', trade: '상업', draft: '징병' };
const FOOD_PER = 0.02; // 병사 1명이 한 순(10일)에 먹는 병량
export const SALARY = 200; // 장수 녹봉 (금/순)
export const SORTIE_COST = 0.5; // 출진: 병사 1명당 금
export const HARVEST_MONTH = 7; // 8월(가을) 상순에 수확

// ── 처음 설정 ──
export function initGov(s, rng) {
  ensureTraits(s);
  for (const c of s.castles) {
    const pass = c.kind === 'pass';
    c.devMax = pass ? 0 : Math.round(c.pop * 10);
    c.farm = pass ? 0 : Math.round(c.pop * (4 + rng() * 2));
    c.trade = pass ? 0 : Math.round(c.pop * (4 + rng() * 2));
    c.jobs = { farm: null, trade: null, draft: null };
    c.auto = true;
  }
  for (const n of s.nations) {
    const troops = s.castles.filter((c) => c.owner === n.id).reduce((a, c) => a + c.troops, 0);
    n.gold = Math.min(n.gold, 30000 + 8000 * s.castles.filter((c) => c.owner === n.id).length);
    n.food = Math.round(troops * FOOD_PER * 40 + 30000);
  }
  s.rel = {};
  s.pacts = [];
  s.inbox = [];
  // 역사 인물은 원래 능력치로 (기존 게임의 무작위 능력치 설정을 따르지 않음)
  const known = new Map(Object.values(POOLS).concat(Object.values(EXTRA), [Object.values(RULERS)]).flat().map((d) => [d.name, d]));
  for (const g of Object.values(s.generals)) { const d = known.get(g.name); if (d) Object.assign(g, { war: d.war, lead: d.lead, intel: d.intel, pol: d.pol }); }
  // 재야 명단 인물이 처음부터 어느 나라에 들어가 있으면 재야로 돌림 (연도는 따지지 않음: 랜덤·가상 판도 있으니 되도록 많이)
  for (const g of Object.values(s.generals)) if (FREE_NAMES.has(g.name) && !g.ruler) Object.assign(g, { status: 'free', nation: null });
  const used = new Set(Object.values(s.generals).map((g) => g.name));
  // 각 나라 출신 장수를 모두 불러 도시마다 나눠 둠. 같은 명단을 여러 나라가 쓰면(예: 일본 다이묘들) 도시 수에 맞춰 고르게 나눔
  const byPool = new Map();
  for (const n of s.nations) {
    if (!n.alive || !n.pools?.length || n.pools[0] === 'tk_free') continue;
    const mine = s.castles.filter((c) => c.owner === n.id && c.kind !== 'pass').sort((a, b) => b.troops - a.troops);
    if (!mine.length) continue;
    if (!byPool.has(n.pools[0])) byPool.set(n.pools[0], []);
    // 시작 장수 상한: 도시 수×3+1명(최소 4명). 작은 나라가 녹봉에 짓눌리지 않게, 남는 인물은 나중에 재야로
    const have = Object.values(s.generals).filter((g) => g.nation === n.id && g.status === 'active').length;
    byPool.get(n.pools[0]).push({ n, mine, k: 0, got: 0, room: Math.max(0, Math.max(4, mine.length * 3 + 1) - have) });
  }
  for (const [pool, members] of byPool) {
    const list = [...(POOLS[pool] || []), ...(EXTRA[pool] || [])].filter((d) => !used.has(d.name));
    for (const d of list) {
      // 도시 하나당 받은 장수가 가장 적은 나라에게 (자리가 남은 나라만)
      const open = members.filter((x) => x.got < x.room);
      if (!open.length) break;
      const m = open.reduce((a, b) => (b.got / b.mine.length < a.got / a.mine.length ? b : a));
      used.add(d.name);
      const id = `x_${m.n.id}_${m.k}`;
      s.generals[id] = { id, pool: d.pool, name: d.name, war: d.war, lead: d.lead, intel: d.intel, pol: d.pol, traits: d.trait ? [[d.trait, 1]] : [], nation: m.n.id, castle: m.mine[m.k % m.mine.length].id, unit: null, status: 'active' };
      m.k += 1;
      m.got += 1;
    }
  }
  // 재야 장수: 각 나라 출신 인재 몇 명을 아무 도시에나
  const pool = [...new Set(s.nations.flatMap((n) => n.pools || []))].flatMap((k) => [...(POOLS[k] || []), ...(EXTRA[k] || [])]).concat(POOLS.tk_free || [], EXTRA.tk_free || []).filter((x) => !used.has(x.name));
  const cities = s.castles.filter((c) => c.kind !== 'pass');
  for (let i = 0; i < Math.min(pool.length, Math.round(cities.length / 3)); i++) {
    const d = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    addFree(s, d, rng.pick(cities), `f0_${i}`);
  }
  for (const c of s.castles) if (c.owner !== null) autoJobs(s, c);
  initPeople(s, rng);
}

function addFree(s, d, c, id) {
  s.generals[id] = { id, pool: d.pool, name: d.name, war: d.war, lead: d.lead, intel: d.intel, pol: d.pol, traits: d.trait ? [[d.trait, 1]] : [], nation: null, castle: c.id, unit: null, status: 'free' };
}

// ── 외교 ──
const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const relOf = (s, a, b) => s.rel?.[key(a, b)] ?? 30;
export const addRel = (s, a, b, d) => { if (a === b || a === null || b === null || a < 0 || b < 0) return; s.rel[key(a, b)] = Math.max(0, Math.min(100, relOf(s, a, b) + d)); };
export const pactOf = (s, a, b) => (s.pacts || []).find((p) => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && p.until > s.turn) || null;
export const PACT = { ally: '동맹', truce: '정전', vassal: '속국' };

export const powerOf = (s, nid) => s.castles.filter((c) => c.owner === nid).reduce((a, c) => a + c.troops, 0) + s.units.filter((u) => u.nation === nid).reduce((a, u) => a + u.troops, 0);

// 사신: 정치가 가장 높은 장수(부대에 나가 있지 않은)가 맡음 — 제안 성공률과 친선 효과가 달라짐
export function envoyOf(s, nid) {
  const g = Object.values(s.generals).filter((x) => x.nation === nid && x.status === 'active' && !x.unit).sort((x, y) => y.pol - x.pol)[0];
  const pol = g ? g.pol : 40;
  return { g: g || null, pol, bonus: Math.max(-0.05, Math.min(0.2, (pol - 60) / 200)) + nationT(s, nid, '외교'), mult: 0.7 + pol / 150 };
}
// 한 순 금 수입 (도시 세금 합)
export const incomeOf = (s, nid) => s.castles.reduce((a, c) => a + (c.owner === nid ? goldOf(s, c) : 0), 0);
// 친선 금액: 주는 나라와 받는 나라 수입(2순 치)의 기하평균 — 내가 커질수록, 상대가 클수록 같은 우호에 돈이 더 듦
// 친선: 금 1만·3만 두 가지. 큰 나라일수록 같은 돈으로 덜 오름 (도시 4곳까지는 1만에 +10, 크면 최대 1/3)
const sizeF = (s, b) => Math.max(1, Math.min(3, Math.sqrt(s.castles.filter((c) => c.owner === b && c.kind !== 'pass').length / 4)));
export const giftSizes = () => [10000, 30000];
export const giftGain = (s, a, b, amt) => Math.min(30, Math.max(1, Math.round(((amt / 10000) * 10 * envoyOf(s, a).mult) / sizeF(s, b))));
// 약소국 결속·대국 영토 관리 감점은 없앰 (크든 작든 같은 규칙) — 예전 호출과 저장을 깨지 않게 함수만 남김
export const isSmall = () => false;

// 받아들일 확률 (b가 a의 제안을)
// 패권국: 전체 도시의 30%를 넘고 2등보다 1.5배 넘게 큰 나라 (다른 나라들이 견제함)
export function hegemonOf(s) {
  const cc = (id) => s.castles.filter((c) => c.owner === id && c.kind !== 'pass').length;
  const total = s.castles.filter((c) => c.kind !== 'pass').length || 1;
  const ranked = s.nations.filter((n) => n.alive && !n.horde).map((n) => [n.id, cc(n.id)]).sort((x, y) => y[1] - x[1]);
  if (!ranked.length || ranked[0][1] < total * 0.3 || (ranked[1] && ranked[0][1] < ranked[1][1] * 1.5)) return null;
  // 대세가 기운 나라(45% 이상)나 300순이 지난 판은 견제하지 않음 — 견제만 하다 끝없이 균형이 이어지지 않게
  if (ranked[0][1] >= total * 0.45 || s.turn > 300) return null;
  return ranked[0][0];
}
// 대세: 전체 도시의 45%를 넘은 나라 (작은 나라들이 속국으로 잘 들어감)
export function dominantOf(s) {
  const total = s.castles.filter((c) => c.kind !== 'pass').length || 1;
  const ranked = s.nations.filter((n) => n.alive && !n.horde).map((n) => [n.id, s.castles.filter((c) => c.owner === n.id && c.kind !== 'pass').length]).sort((x, y) => y[1] - x[1]);
  return ranked.length && ranked[0][1] >= total * 0.45 ? ranked[0][0] : null;
}
export function acceptChance(s, a, b, type) {
  const rel = relOf(s, a, b);
  const env = envoyOf(s, a).bonus;
  const pa = powerOf(s, a), pb = powerOf(s, b);
  if (type === 'ally') {
    // 가장 강한 나라를 함께 두려워하면 잘 받아줌
    const top = s.nations.filter((n) => n.alive).sort((x, y) => powerOf(s, y.id) - powerOf(s, x.id))[0];
    const heg = hegemonOf(s);
    const fear = heg !== null && heg !== a && heg !== b ? 0.35 : top && top.id !== a && top.id !== b ? 0.2 : -0.1;
    return Math.max(0, Math.min(0.95, (rel - 35) / 60 + fear + env));
  }
  // 정전: 약한 쪽이 더 바람. 지키는 전략(수성·사방 방어·내실)인 나라는 노리는 상대가 아니면 잘 받아 줌
  const nb = s.nations[b];
  const calm = ['hold', 'center', 'build'].includes(nb?.strat) && nb.focus !== a ? 0.25 : 0;
  // 패권국이 청하는 정전은 잘 받아 주지 않음 (그 나라 속국은 예외)
  const heg = hegemonOf(s);
  const hegPenalty = heg === a && !(s.pacts || []).some((p) => p.type === 'vassal' && p.a === a && p.b === b) ? 0.2 : 0;
  return Math.max(0, Math.min(0.95, (rel - 25) / 70 + (pa > pb ? 0.2 : -0.1) + calm + env - hegPenalty));
}

export function gift(s, a, b, amt) {
  const n = s.nations[a];
  if (n.gold < amt) return { ok: false, msg: '금이 모자랍니다.' };
  const up = giftGain(s, a, b, amt);
  n.gold -= amt;
  s.nations[b].gold += amt;
  addRel(s, a, b, up);
  log(s, `🎁 ${n.name}이(가) ${s.nations[b].name}에 금 ${fmtGold(amt)}을(를) 보내 친선했습니다.`, 'diplo', [a, b]);
  return { ok: true, msg: `친선: ${s.nations[b].name} 우호 +${up}` };
}

// 약조 연장: 6순 이하로 남았을 때 같은 약조를 더 이어 감 (새로 맺는 것보다 조금 쉬움)
export const RENEW_WINDOW = 6;
export const renewChance = (s, a, b) => { const p = pactOf(s, a, b); return p && p.type !== 'vassal' ? Math.min(0.95, acceptChance(s, a, b, p.type) + 0.15) : 0; };
export function renewPact(s, a, b, rng = Math.random) {
  const p = pactOf(s, a, b);
  if (!p || p.type === 'vassal') return { ok: false, msg: '연장할 약조가 없습니다.' };
  if (p.until - s.turn > RENEW_WINDOW) return { ok: false, msg: `아직 ${p.until - s.turn}순 남았습니다 (${RENEW_WINDOW}순 이하일 때 연장).` };
  const n = s.nations[a];
  if (n.lastAsk?.[b] === s.turn) return { ok: false, msg: '이번 턴에 이미 사신을 보냈습니다.' };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (rng() < renewChance(s, a, b)) {
    p.until += p.type === 'ally' ? 36 : 18;
    log(s, `🔁 ${s.nations[a].name}과(와) ${s.nations[b].name}이(가) ${PACT[p.type]}을 연장했습니다 (${p.until - s.turn}순 남음).`, 'diplo', [a, b]);
    return { ok: true, msg: `${PACT[p.type]} 연장! (${p.until - s.turn}순 남음)` };
  }
  addRel(s, a, b, -3);
  return { ok: true, msg: `${s.nations[b].name}이(가) 연장을 거절했습니다.` };
}
export function propose(s, a, b, type, rng = Math.random) {
  if (pactOf(s, a, b)) return { ok: false, msg: '이미 맺은 약조가 있습니다.' };
  const n = s.nations[a];
  if (n.lastAsk?.[b] === s.turn) return { ok: false, msg: '이번 턴에 이미 사신을 보냈습니다.' };
  n.lastAsk = { ...(n.lastAsk || {}), [b]: s.turn };
  if (b === s.playerId && !s.spectator) {
    // 플레이어에게는 나라마다 석 달에 한 번, 한 번에 한 통만
    // 모든 나라 합쳐서도 3순에 한 통까지 (나라가 많은 세계 지도에서 사신 창이 쏟아지지 않게)
    if (s.inbox.length || s.turn - (n.askedPlayer ?? -99) < 9 || s.turn - (s.envoyAt ?? -99) < 3) return { ok: false, msg: '' };
    n.askedPlayer = s.turn;
    s.envoyAt = s.turn;
    s.inbox.push({ from: a, type });
    return { ok: true, msg: '제안을 보냈습니다.' };
  }
  const yes = rng() < acceptChance(s, a, b, type);
  if (yes) makePact(s, a, b, type);
  else { addRel(s, a, b, -3); log(s, `✉️ ${s.nations[b].name}이(가) ${n.name}의 ${PACT[type]} 제안을 거절했습니다.`, 'diplo', [a, b]); }
  return { ok: true, accepted: yes, msg: yes ? `${s.nations[b].name}과(와) ${PACT[type]}을 맺었습니다!` : `${s.nations[b].name}이(가) 거절했습니다.` };
}

export function makePact(s, a, b, type) {
  s.pacts = s.pacts.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
  s.pacts.push({ a, b, type, until: s.turn + (type === 'ally' ? 36 : 18) });
  addRel(s, a, b, 10);
  // 서로의 부대가 상대를 노리던 명령은 풀어 줌
  for (const u of s.units) {
    if (u.nation !== a && u.nation !== b) continue;
    const o = u.order;
    const other = u.nation === a ? b : a;
    if ((o?.kind === 'castle' && s.castles[o.id]?.owner === other) || (o?.kind === 'unit' && s.units.find((x) => x.id === o.id)?.nation === other)) { u.order = null; u.path = []; }
  }
  log(s, `🤝 ${s.nations[a].name}과(와) ${s.nations[b].name}이(가) ${PACT[type]}을 맺었습니다 (${type === 'ally' ? '1년' : '반년'}).`, 'diplo', [a, b]);
}

export function answerInbox(s, i, yes) {
  const p = s.inbox[i];
  if (!p) return;
  s.inbox.splice(i, 1);
  if (p.type === 'ransom') {
    const g = s.generals[p.gid], me = s.nations[s.playerId];
    if (!yes || !g || g.status !== 'prisoner') { addRel(s, p.from, s.playerId, -3); return; }
    if (me.gold < p.price) { log(s, `금이 모자라 ${g.name}의 몸값 ${fmtGold(p.price)}을(를) 낼 수 없습니다.`, 'bad', [s.playerId]); return; }
    me.gold -= p.price; s.nations[p.from].gold += p.price;
    const home = s.castles.find((c) => c.owner === s.playerId);
    Object.assign(g, { status: 'active', castle: home?.id ?? null, held: 0, captor: null });
    log(s, `💰 몸값 금 ${fmtGold(p.price)}을(를) 내고 ${g.name}을(를) 데려왔습니다.`, 'diplo', [s.playerId, p.from]);
    return;
  }
  if (!yes) { addRel(s, p.from, s.playerId, p.type === 'vassal_demand' ? -10 : -5); return; }
  if (p.type === 'vassal_offer') makeVassal(s, s.playerId, p.from);
  else if (p.type === 'vassal_demand') makeVassal(s, p.from, s.playerId);
  else makePact(s, p.from, s.playerId, p.type);
}

// ── 시장: 금으로 병량을 사고팔기 ──
export const MARKET = { buy: 1.5, sell: 0.5 }; // 금 1 → 병량 1.5, 병량 1 → 금 0.5
export function trade(s, nid, kind, amt) {
  const n = s.nations[nid];
  if (kind === 'buy') {
    if (n.gold < amt) return { ok: false, msg: '금이 모자랍니다.' };
    n.gold -= amt; n.food += Math.round(amt * MARKET.buy);
    return { ok: true, msg: `병량 +${fmtTroops(Math.round(amt * MARKET.buy))} (금 -${fmtGold(amt)})` };
  }
  if (n.food < amt) return { ok: false, msg: '병량이 모자랍니다.' };
  n.food -= amt; n.gold += Math.round(amt * MARKET.sell);
  return { ok: true, msg: `금 +${fmtGold(Math.round(amt * MARKET.sell))} (병량 -${fmtTroops(amt)})` };
}

// ── 인재 ──
// 군주였던 사람은 남의 신하가 되지 않음
export const isRuler = (g) => !!(g.ruler || g.exRuler);
export function recruitChance(s, g, nid, cityId) {
  if (isRuler(g)) return 0;
  const pol = Math.max(0, ...Object.values(s.generals).filter((x) => x.nation === nid && x.status === 'active' && (cityId === undefined || x.castle === cityId)).map((x) => x.pol));
  if (s.nations[g.nation]?.outlaw || g.boss) return 0; // 도적 두목은 등용 불가
  const jin = nationT(s, nid, '인덕');
  if (g.status === 'prisoner') return Math.max(0.05, Math.min(0.35 + jin, 0.08 + jin + (pol - 50) / 250 + (!s.nations[g.nation]?.alive ? 0.08 : 0)));
  return Math.max(0.1, Math.min(0.9, 0.3 + jin + (pol - 50) / 100 + (hasPolicy(s, nid, 'talent') ? 0.15 : 0) + (isSmall(s, nid) ? 0.1 : 0)));
}

export function recruit(s, gid, nid, rng = Math.random) {
  const g = s.generals[gid];
  if (!g) return { ok: false, msg: '없는 장수입니다.' };
  if (g.tried === s.turn) return { ok: false, msg: '이번 턴에는 이미 설득했습니다.' };
  if (isRuler(g)) return { ok: false, msg: `${g.name}은(는) 한 나라의 군주였던 사람이라 신하가 되지 않습니다.` };
  const city = g.status === 'free' ? s.castles[g.castle] : s.castles.find((c) => c.owner === nid);
  if (!city || (g.status === 'free' && city.owner !== nid)) return { ok: false, msg: '내 도시에 있는 재야만 등용할 수 있습니다.' };
  g.tried = s.turn;
  if (rng() >= recruitChance(s, g, nid, g.status === 'free' ? city.id : undefined)) return { ok: true, msg: `${g.name}이(가) 거절했습니다.` };
  const at = city;
  if (g.status === 'prisoner' && s.nations[g.nation]?.alive) addRel(s, nid, g.nation, -5);
  Object.assign(g, { nation: nid, status: 'active', castle: at.id, held: 0, captor: null, loyal: g.status === 'prisoner' ? 50 : 65 });
  log(s, `⭐ ${g.name}(무${g.war}/통${g.lead}/지${g.intel}/정${g.pol})이(가) ${s.nations[nid].name}에 들어왔습니다.`, 'info', [nid]);
  return { ok: true, msg: `${g.name} 등용 성공!` };
}

// ── 몸값 흥정: 포로의 가치(능력치 합, 군주는 3배)보다 싸게 부를수록 잘 받아 줌. 돈이 모자라면 못 냄 ──
export const ransomValue = (g) => Math.round(((g.war + g.lead + g.intel + g.pol) * 150 * (isRuler(g) ? 3 : 1)) / 1000) * 1000;
export function ransomChance(s, g, price) {
  const payer = s.nations[g.nation];
  if (!payer?.alive || price > payer.gold) return 0;
  const r = price / Math.max(1, ransomValue(g));
  return Math.max(0.03, Math.min(0.95, 1.2 - r * 0.7));
}
// 내가(또는 by가) 잡은 포로를 돌려주는 대가로 몸값을 부름
export function offerRansom(s, by, gid, price, rng = Math.random) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== by) return { ok: false, msg: '내 포로가 아닙니다.' };
  if (g.ransomAsked === s.turn) return { ok: false, msg: '이번 턴에 이미 몸값을 불렀습니다.' };
  const payer = s.nations[g.nation];
  if (!payer?.alive) return { ok: false, msg: '돌려보낼 나라가 없습니다.' };
  g.ransomAsked = s.turn;
  if (rng() < ransomChance(s, g, price)) {
    payer.gold -= price; s.nations[by].gold += price;
    const home = s.castles.find((c) => c.owner === g.nation);
    Object.assign(g, { status: 'active', castle: home?.id ?? null, held: 0, captor: null });
    log(s, `💰 ${payer.name}이(가) 금 ${fmtGold(price)}을(를) 내고 ${g.name}을(를) 데려갔습니다.`, 'diplo', [by, g.nation]);
    return { ok: true, msg: `몸값 금 ${fmtGold(price)}을(를) 받고 ${g.name}을(를) 돌려보냈습니다.` };
  }
  addRel(s, by, g.nation, -3);
  return { ok: true, msg: `${payer.name}이(가) 금 ${fmtGold(price)}은(는) 너무 비싸다며 거절했습니다.` };
}
// 컴퓨터가 잡은 플레이어 장수: 가끔 몸값을 요구하는 사신 (가치의 0.8~1.2배)
function ransomDemands(s, rng) {
  const me = s.spectator ? null : s.playerId;
  if (me === null || s.inbox.length || s.turn - (s.envoyAt ?? -99) < 3) return;
  const g = Object.values(s.generals).find((x) => x.status === 'prisoner' && x.nation === me && x.captor !== me && x.captor !== null && s.nations[x.captor]?.alive && (x.held || 0) >= 1 && rng() < 0.35);
  if (!g) return;
  const price = Math.round((ransomValue(g) * (0.8 + rng() * 0.4)) / 1000) * 1000;
  s.inbox.push({ from: g.captor, type: 'ransom', gid: g.id, price });
  s.envoyAt = s.turn;
}
export function release(s, gid, by = s.playerId) {
  const g = s.generals[gid];
  const home = s.nations[g.nation]?.alive ? s.castles.find((c) => c.owner === g.nation) : null;
  // 군주(였던 사람)는 신하가 되지 않음: 나라가 살아 있으면 몸값을 받고 돌려보내고, 망했으면 은거
  let extra = '';
  if (home && isRuler(g)) {
    const pay = Math.min(30000, Math.round(s.nations[g.nation].gold * 0.3));
    s.nations[g.nation].gold -= pay;
    if (s.nations[by]) s.nations[by].gold += pay;
    extra = pay > 0 ? ` 몸값 금 ${fmtGold(pay)}을(를) 받았습니다.` : '';
  }
  if (home) { Object.assign(g, { status: 'active', castle: home.id, held: 0, captor: null }); addRel(s, by, g.nation, 8); }
  else if (isRuler(g)) { Object.assign(g, { status: 'gone', castle: null, captor: null }); return { ok: true, msg: `${g.name}은(는) 풀려나 은거했습니다.` }; }
  else Object.assign(g, { status: 'free', nation: null, castle: s.castles.find((c) => c.owner === by && c.kind !== 'pass')?.id ?? s.castles.find((c) => c.kind !== 'pass').id, captor: null });
  return { ok: true, msg: `${g.name}을(를) 풀어 주었습니다.${extra}` };
}

export function execute(s, gid) {
  const g = s.generals[gid];
  g.status = 'gone';
  if (s.nations[g.nation]?.alive) addRel(s, s.playerId, g.nation, -25);
  log(s, `🗡️ ${g.name}이(가) 처단되었습니다.`, 'info', [s.playerId]);
  return { ok: true, msg: `${g.name} 처단` };
}

// ── 담당관: 자동이면 성에 있는 장수 중 정치 높은 순으로 농업·상업, 통솔 높은 장수를 징병에 ──
export function autoJobs(s, c) {
  const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active' && g.nation === c.owner);
  const left = gs.slice().sort((a, b) => b.pol - a.pol);
  c.jobs = { farm: null, trade: null, draft: null };
  if (c.kind === 'pass') return;
  const take = (id) => { const i = left.findIndex((g) => g.id === id); if (i >= 0) left.splice(i, 1); return id; };
  if (left.length >= 3) c.jobs.draft = take(left.slice().sort((a, b) => b.lead - a.lead)[0].id);
  if (left[0]) c.jobs.farm = take(left[0].id);
  if (left[0]) c.jobs.trade = take(left[0].id);
}

export const jobGen = (s, c, role) => {
  const g = s.generals[c.jobs?.[role]];
  return g && g.castle === c.id && g.status === 'active' && g.nation === c.owner ? g : null;
};

// 금 수입: 상업 × 관할 땅 비율, 병량 수확: 농업 × 관할 땅 비율 (가을에 한 해 몫)
// 금 수입: 도시 기본 세금 1,200(인구와 상관없이, 작은 나라도 움직일 수 있게) + 상업×5 × 관할 땅 비율
// 넓은 영토 관리: 도시 15개를 넘으면 1개마다 수입·수확·자원병 −1.2% (최대 −45%) — 큰 나라가 끝없이 불어나지 않게
export const sprawlOf = () => 1;
// 특성: 머무는 장수의 정치·교역, 나라의 상업
const traitGold = (s, c) => { const g = castleGens(s, c); return 1 + t14(g, '정치') + (c.port ? t14(g, '교역') : 0) + nationT(s, c.owner, '상업'); };
// 특성: 머무는 장수의 모병·인덕 (자원병 명/순)
const traitDraft = (s, c) => { const g = castleGens(s, c); return t14(g, '모병') + Math.round(t14(g, '인덕') * 100); };
export const goldOf = (s, c) => (c.kind === 'pass' || c.owner === null ? 0 : Math.round(traitGold(s, c) * (1200 + c.trade * 5 * (0.4 + 0.6 * landShare(s, c))) * (hasPolicy(s, c.owner, 'commerce') ? 1.25 : 1) * (1 + 0.25 * (c.bld?.market || 0)) * sprawlOf(s, c.owner) * (c.founding ? 0.3 : 1)));
export const harvestOf = (s, c) => (c.kind === 'pass' || c.owner === null ? 0 : Math.round((1 + (jobGen(s, c, 'farm') ? t14([jobGen(s, c, 'farm')], '농정') : 0)) * c.farm * 48 * (0.4 + 0.6 * landShare(s, c)) * (hasPolicy(s, c.owner, 'farming') ? 2 : 1) * (1 + 1 * (c.bld?.farmland || 0)) * sprawlOf(s, c.owner) * (c.founding ? 0.3 : 1)));
export const foodUse = (s, nid) => Math.round(powerOf(s, nid) * FOOD_PER * (hasPolicy(s, nid, 'farming') ? 0.7 : 1));
export const isHarvest = (s) => (s.turn - 1) % 36 === HARVEST_MONTH * 3;

// ── 한 턴 마무리의 내정 ──
export function govTurn(s, grid) {
  ensureTraits(s);
  const rng = makeRng(`gov:${s.seed}:${s.turn}`);
  const harvest = isHarvest(s);
  for (const n of s.nations) {
    if (!n.alive) continue;
    let gold = 0, food = 0;
    const small = isSmall(s, n.id);
    for (const c of s.castles) {
      if (c.owner !== n.id) continue;
      if (c.auto || n.id !== s.playerId || s.spectator) autoJobs(s, c);
      const f = jobGen(s, c, 'farm'), t = jobGen(s, c, 'trade'), d = jobGen(s, c, 'draft');
      const edu = 1;
      if (f) c.farm = Math.min(c.devMax, c.farm + Math.round((3 + f.pol / 6) * edu));
      if (t) c.trade = Math.min(c.devMax, c.trade + Math.round((3 + t.pol / 6) * edu));
      gold += goldOf(s, c);
      if (harvest) food += harvestOf(s, c);
      // 자원병: 인구에 비례, 징병 담당관이 있으면 통솔만큼 더 (인구의 25%까지 성에 참)
      if (c.kind !== 'pass' && !(c.unrest >= s.turn) && c.troops < c.pop * 250) c.troops += Math.round((c.pop * 15 * (0.5 + 0.5 * landShare(s, c)) + (d ? d.lead * 12 + t14([d], '징병') : 0) + traitDraft(s, c)) * (hasPolicy(s, c.owner, 'conscript') ? 1.1 : 1) * sprawlOf(s, c.owner) * (small ? 1.5 : 1));
      // 성벽 보수, 인구 회복
      c.dur = Math.min(c.maxDur, c.dur + c.maxDur * ((hasPolicy(s, c.owner, 'fortify') ? 0.1 : 0.05) + t14(castleGens(s, c), '축성')));
      c.popMax = c.popMax || c.pop * 1.2;
      if (c.pop < c.popMax) c.pop = Math.round(Math.min(c.popMax, c.pop * 1.01 + 0.1) * 10) / 10;
    }
    // 장수 녹봉: 1명당 금 150
    const gens = Object.values(s.generals).filter((g) => g.nation === n.id && g.status === 'active').length;
    // 장수 녹봉 1명당 200, 시설 유지비 단계당 300
    const upkeep = s.castles.filter((c) => c.owner === n.id).reduce((a, c) => a + ((c.bld?.wall || 0) + (c.bld?.shipyard || 0)) * 300, 0);
    n.gold = Math.round(n.gold + gold - gens * SALARY - upkeep - (n.policies || []).length * POLICY_UPKEEP);
    n.food = Math.round(n.food + food - foodUse(s, n.id));
    if (harvest && n.id === s.playerId) log(s, `🌾 가을 수확! 병량 +${fmtTroops(food)}`, 'info', [n.id]);
    if (n.gold < 0) n.gold = 0;
    {
      const capG = 100000 + s.castles.filter((c) => c.owner === n.id && c.kind !== 'pass').length * 10000;
      if (n.gold > capG) { const loss = Math.round((n.gold - capG) * 0.05); n.gold -= loss; if (n.id === s.playerId && loss >= 5000 && s.turn % 6 === 0) log(s, `💸 국고가 넘쳐(${fmtGold(capG)} 넘음) 금 ${fmtGold(loss)}이 새어 나갔습니다. 징병·용병·시설에 쓰세요.`, 'info', [n.id]); }
    }
    if (n.food < 0) {
      // 병량이 떨어지면 병사가 흩어지고 사기가 꺾임
      for (const c of s.castles) if (c.owner === n.id) c.troops = Math.round(c.troops * 0.93);
      for (const u of s.units) if (u.nation === n.id) { u.troops = Math.round(u.troops * 0.93); u.morale = Math.max(0, u.morale - 10); }
      if (n.id === s.playerId) log(s, '🍚 병량이 바닥나 병사들이 흩어지고 있습니다!', 'bad', [n.id]);
      n.food = 0;
    }
  }
  spreadLand(s, grid);
  peopleTurn(s);
  diplomacyTurn(s, rng, grid);
  ransomDemands(s, rng);
  vassalTurn(s, grid, rng);
  people(s, rng);
}

// 관할 땅 넓히기: 도시마다 내 땅과 맞닿은 관할 칸을 한 턴에 몇 칸씩 (적 부대 옆은 안 됨)
function spreadLand(s, grid) {
  const near = new Set();
  for (const u of s.units) { near.add(u.tile); for (const t of grid.nb[u.tile]) near.add(t); }
  const dt = districtTiles(s);
  for (const c of s.castles) {
    if (c.owner === null || c.kind === 'pass' || c.unrest >= s.turn) continue;
    let n = 4 + Math.round((s.generals[c.jobs?.farm]?.pol || 40) / 20);
    for (const t of dt[c.id]) {
      if (n <= 0) break;
      // 삼국지14처럼: 남이 칠해 둔 땅은 저절로 되찾지 않음 (부대가 직접 칠해야 함) — 빈 땅만 넓힘
      if (s.owner[t] !== -1 || near.has(t)) continue;
      if (!grid.nb[t].some((x) => s.owner[x] === c.owner)) continue;
      s.owner[t] = c.owner;
      n -= 1;
    }
  }
}

// 외교: 약조가 끝나면 알림, 우호는 조금씩 30으로, 컴퓨터끼리 동맹·정전
// 국경이 맞닿은 나라: 두 나라 성 사이가 12칸 안 (멀리 떨어진 나라끼리는 약조를 맺지 않음)
export function bordering(s, grid, a, b) {
  if (!grid) return true;
  const ca = s.castles.filter((c) => c.owner === a), cb = s.castles.filter((c) => c.owner === b);
  return ca.some((x) => cb.some((y) => grid.dist(x.tile, y.tile) <= 12 * (grid.k || 1)));
}
// 같은 적: 두 나라 모두 맞닿아 있으며 둘 다 약조가 없는 제3국
const commonFoe = (s, grid, a, b) => s.nations.some((m) => m.alive && m.id !== a && m.id !== b && !pactOf(s, a, m.id) && !pactOf(s, b, m.id) && bordering(s, grid, a, m.id) && bordering(s, grid, b, m.id));
function diplomacyTurn(s, rng, grid) {
  const me = s.spectator ? null : s.playerId;
  const other = (p) => (p.a === me ? p.b : p.a);
  s.eventsQ = s.eventsQ || [];
  for (const p of s.pacts) {
    if (p.type === 'vassal') continue;
    // 플레이어 약조는 끝나기 3순 전에 미리, 끝날 때 한 번 더 크게 알림
    if (me !== null && (p.a === me || p.b === me) && p.until === s.turn + 4) s.eventsQ.push({ title: '약조 만료 임박', text: `${s.nations[other(p)].name}과(와)의 ${PACT[p.type]}이 3순 뒤 끝납니다. 외교 탭의 「🔁 연장 요청」으로 이어 갈 수 있습니다.`, nations: [other(p)] });
    if (p.until === s.turn + 1) {
      log(s, `📜 ${s.nations[p.a].name}과(와) ${s.nations[p.b].name}의 ${PACT[p.type]}이 끝납니다.`, 'diplo', [p.a, p.b]);
      if (me !== null && (p.a === me || p.b === me)) s.eventsQ.push({ title: `${PACT[p.type]} 종료`, text: `${s.nations[other(p)].name}과(와)의 ${PACT[p.type]}이 끝났습니다. 이제 서로 칠 수 있습니다!`, nations: [other(p)] });
    }
  }
  s.pacts = s.pacts.filter((p) => (p.type === 'vassal' || p.until > s.turn + 1) && s.nations[p.a].alive && s.nations[p.b].alive);
  for (const k of Object.keys(s.rel)) s.rel[k] += s.rel[k] > 30 ? -0.5 : 0.5;
  const alive = s.nations.filter((n) => n.alive && !n.horde);
  const ranked = alive.slice().sort((a, b) => powerOf(s, b.id) - powerOf(s, a.id));
  for (const n of alive) {
    if ((n.id === s.playerId && !s.spectator) || rng() > 0.08) continue;
    const top = ranked[0];
    // 가장 강한 나라를 견제할 동맹, 또는 밀리는 상대와 정전
    if (top && top.id !== n.id) {
      // 견제 동맹은 1등과 맞닿은 나라끼리, 서로 맞닿았거나 같은 적이 있을 때만
      const cand = alive.filter((m) => m.id !== n.id && m.id !== top.id && !pactOf(s, n.id, m.id) && bordering(s, grid, n.id, top.id) && bordering(s, grid, m.id, top.id) && (bordering(s, grid, n.id, m.id) || commonFoe(s, grid, n.id, m.id)));
      const m = cand.length ? rng.pick(cand) : null;
      if (m) propose(s, n.id, m.id, 'ally', rng);
    }
    if (n.gold > 80000 && rng() < 0.3) { const m = rng.pick(alive.filter((x) => x.id !== n.id && bordering(s, grid, n.id, x.id))); const amt = 10000; if (m && n.gold > amt * 4) gift(s, n.id, m.id, amt); }
    const foe = ranked.find((m) => m.id !== n.id && !pactOf(s, n.id, m.id) && powerOf(s, m.id) > powerOf(s, n.id) * 1.8 && bordering(s, grid, n.id, m.id)); // 맞닿은 강국과만 정전
    if (foe && rng() < 0.4) propose(s, n.id, foe.id, 'truce', rng);
  }
  // 약한 나라는 훨씬 센 플레이어에게 먼저 조공(금)을 바치고 약조를 청함
  if (me !== null && s.nations[me]?.alive) {
    const pp = powerOf(s, me);
    for (const n of alive) {
      if (n.id === me || pactOf(s, n.id, me) || powerOf(s, n.id) * 2 > pp || rng() > 0.05 || !bordering(s, grid, n.id, me)) continue; // 맞닿은 약소국만
      const pay = Math.min(20000, Math.round(n.gold * 0.15 / 1000) * 1000);
      if (pay >= 2000) {
        n.gold -= pay; s.nations[me].gold += pay; addRel(s, n.id, me, 6);
        log(s, `🎁 ${n.name}이(가) 우리에게 금 ${fmtGold(pay)}을(를) 바쳤습니다.`, 'diplo', [n.id, me]);
      }
      propose(s, n.id, me, rng() < 0.5 ? 'truce' : 'ally', rng);
    }
  }
}

// 인재: 재야가 가끔 나타남, 컴퓨터는 자기 도시 재야를 등용, 포로는 등용하거나 몇 턴 뒤 돌려보냄
function people(s, rng) {
  // 재야로 떠돌던 옛 군주는 은거
  for (const g of Object.values(s.generals)) if (g.status === 'free' && isRuler(g)) { g.status = 'gone'; g.castle = null; }
  const used = new Set(Object.values(s.generals).map((g) => g.name));
  const cities = s.castles.filter((c) => c.kind !== 'pass');
  if (rng() < 0.25) {
    const pool = [...new Set(s.nations.flatMap((n) => n.pools || []))].flatMap((k) => [...(POOLS[k] || []), ...(EXTRA[k] || [])]).concat(POOLS.tk_free || [], EXTRA.tk_free || []).filter((x) => !used.has(x.name));
    if (pool.length) {
      const c = rng.pick(cities);
      addFree(s, rng.pick(pool), c, `f${s.turn}_${Math.floor(rng() * 1e6)}`);
    }
  }
  for (const n of s.nations) {
    if (!n.alive || n.horde) continue;
    const ai = n.id !== s.playerId || s.spectator;
    const mine = cities.filter((c) => c.owner === n.id);
    const gens = Object.values(s.generals).filter((g) => g.nation === n.id && g.status === 'active');
    if (ai) for (const g of Object.values(s.generals)) if (g.status === 'free' && s.castles[g.castle]?.owner === n.id && rng() < 0.4) recruit(s, g.id, n.id, rng);
    // 장수가 너무 모자라면 지방 무관이 나섬
    if (gens.length < Math.ceil(mine.length / 3) + 1 && rng() < 0.3 && mine.length) {
      const at = rng.pick(mine), id = `h${s.turn}_${n.id}_${Math.floor(rng() * 1e6)}`;
      s.generals[id] = { id, pool: n.pools?.[0], name: `${at.name} 교위`, war: rng.int(45, 70), lead: rng.int(45, 70), intel: rng.int(35, 65), pol: rng.int(35, 65), traits: [], nation: n.id, castle: at.id, unit: null, status: 'active' };
      if (!ai) log(s, `⭐ ${at.name} 교위가 벼슬길에 나섰습니다.`, 'info', [n.id]);
    }
  }
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'prisoner') continue;
    g.held = (g.held || 0) + 1;
    const cap = s.nations[g.captor];
    if (!cap?.alive) { release(s, g.id, g.captor); continue; }
    if (g.captor === s.playerId && !s.spectator) continue; // 내 포로는 내가 처리
    if (rng() < 0.3) { recruit(s, g.id, cap.id, () => 0); continue; }
    if (g.held >= 6) {
      const home = s.nations[g.nation]?.alive ? s.castles.find((c) => c.owner === g.nation) : null;
      if (home) Object.assign(g, { status: 'active', castle: home.id, held: 0, captor: null });
      else Object.assign(g, { status: 'free', nation: null, castle: rng.pick(cities).id, captor: null });
    }
  }
}
