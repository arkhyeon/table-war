import { stateRng } from './rng.js';
import { T, TERRAIN, EDGE, BUILDINGS, COST, TAX, G } from './rules.js';
import { fmtTroops, fmtGold } from './format.js';
import { POOLS, rating, randomStats, fairTarget, gradeScore } from './generals.js';
import { fixJosa } from './josa.js';
import { weatherOf } from './weather.js';
import { simulateDuel, duelist } from './duel.js';
import { tv, initTraits, growTrait, TITLES, traitLabel } from './traits.js';

// ───────── 조회 헬퍼 ─────────
export const relKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const getRel = (s, a, b) => s.relations[relKey(a, b)] || { type: 'none' };
export const setRel = (s, a, b, rel) => {
  if (!rel || rel.type === 'none') delete s.relations[relKey(a, b)];
  else s.relations[relKey(a, b)] = rel;
};
// 육지 영토만 (바다 구역의 함대는 제외)
export const nationRegions = (s, nid) => s.regions.reduce((acc, r, i) => (r.owner === nid && !r.sea ? (acc.push(i), acc) : acc), []);
export const nationFleets = (s, nid) => s.regions.reduce((acc, r, i) => (r.owner === nid && r.sea ? (acc.push(i), acc) : acc), []);
export const gensIn = (s, rid, nid) => Object.values(s.generals).filter((g) => g.status === 'active' && g.region === rid && (nid === undefined || g.nation === nid));
export const nationGenerals = (s, nid) => Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === nid);
export const edgeBetween = (world, a, b) => world.regions[a].neighbors.find((n) => n.id === b) || null;
export const nationTrait = (s, nid, id) => tv(nationGenerals(s, nid), id);
export const landCount = (s) => s.regions.filter((r) => !r.sea).length;

export function log(s, text, nations = [], kind = 'info') {
  text = fixJosa(text);
  s.log.unshift({ turn: s.turn, text, nations, kind });
  if (s.log.length > 300) s.log.length = 300;
  if (nations.includes(s.playerId) && s.turnNews) s.turnNews.push(text);
}

export function nationPower(s, nid) {
  let p = 0;
  for (const r of s.regions) if (r.owner === nid) p += r.troops / 1000 + (r.sea ? 0 : 6 + r.pop * 0.2);
  return p + s.nations[nid].gold / (10 * G) + nationGenerals(s, nid).length * 8;
}

export function isVassalOf(s, a, b) {
  const r = getRel(s, a, b);
  return r.type === 'vassal' && r.overlord === b;
}

export function computeMaxAp(s, nid) {
  const regions = nationRegions(s, nid).length;
  const fast = Math.min(2, nationTrait(s, nid, '신속'));
  // 큰 지도(지역이 잘게 나뉨)는 행동력 상한도 비례해서 늘림
  const cap = Math.round(7 * Math.max(1, landCount(s) / 150));
  let ap = 3 + Math.min(cap, Math.floor(regions / 6)) + fast;
  if (s.nations.some((o) => o.alive && o.id !== nid && isVassalOf(s, nid, o.id))) ap -= 1;
  return Math.max(2, ap);
}

// ───────── 경제 ─────────
export const effTax = (s, rid) => s.regions[rid].tax || s.nations[s.regions[rid].owner]?.taxRate || 'normal';

export function regionTax(s, rid) {
  const r = s.regions[rid];
  if (r.sea || r.owner === null) return 0;
  let g = (1 + r.pop * 0.4) * TAX[effTax(s, rid)].mult * (0.4 + (0.6 * (r.loyalty ?? 100)) / 100);
  const w = weatherOf(s, rid);
  let wt = w.tax;
  if (wt < 1) wt = 1 - (1 - wt) * (1 - tv(gensIn(s, rid, r.owner), '농정') / 2);
  g *= wt;
  if (r.buildings.market) g *= 1.5;
  const gens = gensIn(s, rid, r.owner);
  g *= 1 + tv(gens, '정치') + (r.river ? tv(gens, '치수') : 0) + (r.buildings.port ? tv(gens, '교역') : 0) + governorBonus(governorOf(s, rid)).tax;
  return Math.round((g + (r.buildings.port ? 3 : 0)) * G);
}

// 태수: 주둔 장수 중 정치가 가장 높은 장수(문관 우선). 문관은 효과 그대로, 무관은 절반
export function governorOf(s, rid) {
  const r = s.regions[rid];
  if (r.owner === null || r.sea) return null;
  const gens = gensIn(s, rid, r.owner);
  if (!gens.length) return null;
  const val = (g) => g.pol * (g.role === 'civ' ? 1 : 0.5);
  return gens.reduce((a, b) => (val(b) > val(a) ? b : a));
}
export function governorBonus(g) {
  if (!g) return { tax: 0, loyalty: 0 };
  const k = g.role === 'civ' ? 1 : 0.5;
  return { tax: (Math.max(0, g.pol - 50) / 250) * k, loyalty: g.pol >= 90 ? 2 * k : g.pol >= 70 ? 1 * k : 0 };
}

// 병력 유지비는 1명 단위로 계산(2,500명당 1금), 장수 녹봉 1금
export function income(s, nid) {
  let inc = 0, troops = 0;
  s.regions.forEach((r, i) => {
    if (r.owner !== nid) return;
    inc += regionTax(s, i);
    troops += r.troops;
  });
  inc = Math.round(inc * (1 + nationTrait(s, nid, '상업')));
  // 병사 1명당 1금, 장수 녹봉 1인당 2,500금, 영토 15곳 초과분 1곳당 통치비 1,250금
  const army = Math.round(troops * (1 - nationTrait(s, nid, '병참')));
  const salary = nationGenerals(s, nid).length * G;
  // 세분화한 지도에서는 지역당 통치비를 나눔 (s.df = 세분화 배율)
  const df = s.df || 1;
  const admin = Math.round((Math.max(0, nationRegions(s, nid).length - 15 * df) * (G / 2)) / df);
  return { gross: inc, upkeep: army + salary + admin, army, salary, admin, net: inc - army - salary - admin, troops };
}

export function moveCost(world, from, to, s) {
  const e = edgeBetween(world, from, to);
  if (!e) return Infinity;
  let c = COST.move;
  if (world.regions[to].terrain === T.MOUNTAIN) c += 1;
  if (e.type === 'cliff' || e.type === 'strait') c += 1;
  if (s) c += weatherOf(s, to).ap;
  return c;
}

// 보급: 수도에서 내 땅과 내 함대가 있는 바다로 이어진 지역
export function supplied(s, world, nid) {
  const set = new Set();
  const cap = s.nations[nid]?.capital;
  if (cap === null || cap === undefined || s.regions[cap].owner !== nid) return set;
  const q = [cap];
  set.add(cap);
  for (let i = 0; i < q.length; i++) {
    for (const nb of world.regions[q[i]].neighbors) {
      if (set.has(nb.id) || s.regions[nb.id].owner !== nid) continue;
      set.add(nb.id);
      q.push(nb.id);
    }
  }
  return set;
}

export const nationBuff = (s, nid, key) => (s.buffs || []).filter((b) => b.nid === nid && b.until >= s.turn).reduce((m, b) => m * (b[key] || 1), 1);

export const WALL_MAX = 3;
export const ENGINE_MAX = 3;

// ───────── 전투 계산 ─────────
// 장수 보정은 여러 장수·특성이 겹쳐도 무한히 커지지 않게 완만한 상한(+60%)을 둔다
// 실제 = 0.6 × (1 − e^(−합/0.6)) : 합 +20% → +17%, +40% → +29%, +80% → +44%, +150% → +55%
export const GEN_CAP = 0.6;
export const capBonus = (x) => (x <= 0 ? x : GEN_CAP * (1 - Math.exp(-x / GEN_CAP)));

// opts.mode: 'siege'(포위: 성벽을 깎음) | 'assault'(강습: 이기면 즉시 함락, 성벽 효과·손실 증가)
// opts.engines: 동행 공성병기 수
export function battleFactors(s, world, nid, from, to, genIds, opts = {}) {
  const e = edgeBetween(world, from, to);
  const tr = s.regions[to];
  const wr = world.regions[to];
  const terr = wr.terrain;
  const att = genIds.map((id) => s.generals[id]).filter(Boolean);
  const def = tr.owner === null ? [] : gensIn(s, to, tr.owner);
  const mods = [];
  const add = (label, v) => {
    if (v) mods.push(`${label} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
    return v;
  };
  let a = 0; // 장수로 인한 공격 보정 합 (상한 적용 전)
  let betrayal = 0;
  if (att.length) {
    const best = Math.max(...att.map((g) => g.lead * 0.5 + g.war * 0.5));
    a += add('장수 지휘', best / 250);
    a += add('명장', tv(att, '명장'));
    a += add('맹장', tv(att, '맹장'));
    a += add('책략', tv(att, '책략'));
    if (e.type !== 'sea' && e.type !== 'landing' && [T.PLAINS, T.DESERT, T.TUNDRA].includes(terr)) a += add('기마', tv(att, '기마'));
    if ([T.MOUNTAIN, T.HILLS].includes(terr)) a += add('산악', tv(att, '산악'));
    if (e.type === 'river') a += add('도하', tv(att, '도하'));
    if (e.type === 'sea' || e.type === 'landing' || e.type === 'cliff') a += add('수군', tv(att, '수군'));
    if (opts.count && opts.count < tr.troops) a += add('돌격', tv(att, '돌격'));
    if (terr === T.DESERT) a += add('사막', tv(att, '사막'));
  }
  let edgeMult = EDGE[e.type].mult;
  if (e.type === 'river' && tv(att, '도하')) edgeMult = 1;
  if (e.type === 'landing' && tv(att, '수군')) edgeMult = 1;
  if (e.type === 'landing' || e.type === 'cliff' || e.type === 'strait') edgeMult = 1 - (1 - edgeMult) * (1 - Math.max(tv(att, '상륙'), e.type === 'strait' ? tv(att, '수군') : 0));
  if (edgeMult < 1) mods.push(`${EDGE[e.type].name} ${Math.round((edgeMult - 1) * 100)}%`);
  if (terr === T.DESERT && !tv(att, '사막')) { edgeMult *= 0.9; mods.push('사막 소모 -10%'); }
  const rel = tr.owner === null ? { type: 'none' } : getRel(s, nid, tr.owner);
  if (rel.type === 'nap' || rel.type === 'vassal') { betrayal = 0.15; mods.push('배신 사기저하 -15%'); }
  // 상륙은 출발한 바다의 날씨, 그 외는 전장 날씨
  const seaSide = e.type === 'landing' || e.type === 'cliff';
  const w = weatherOf(s, seaSide ? from : to);
  let weather = w.att;
  if (e.type === 'river' && w.river) weather *= w.river;
  const wk = s.weather?.[seaSide ? from : to];
  if ((wk === 'snow' && tv(att, '설중')) || (wk === 'rain' && tv(att, '우전'))) {
    weather = 1;
    a += add(wk === 'snow' ? '설중' : '우전', tv(att, wk === 'snow' ? '설중' : '우전'));
  }
  if ((wk === 'clear' || wk === 'drought' || !wk) && [T.FOREST, T.HILLS].includes(terr)) a += add('화공', tv(att, '화공'));
  if (weather !== 1) mods.push(`${w.icon}${w.name} ${weather > 1 ? '+' : ''}${Math.round((weather - 1) * 100)}%`);
  let attSupply = supplied(s, world, nid).has(from) ? 1 : 0.8;
  if (attSupply < 1) attSupply = 1 - 0.2 * (1 - tv(att, '보급'));
  if (attSupply < 1) mods.push(`보급 끊김 -${Math.round((1 - attSupply) * 100)}%`);
  let buffA = nationBuff(s, nid, 'att');
  if (buffA !== 1) mods.push(`특수 효과 ${buffA > 1 ? '+' : ''}${Math.round((buffA - 1) * 100)}%`);

  let d = 0; // 장수로 인한 방어 보정 합 (상한 적용 전)
  if (def.length) {
    const best = Math.max(...def.map((g) => g.lead * 0.6 + g.intel * 0.4));
    d += best / 250 + tv(def, '수성') + tv(def, '책략') + tv(def, '궁술');
    if ([T.FOREST, T.HILLS, T.MOUNTAIN].includes(terr)) d += tv(def, '매복');
    if (wr.sea) d += tv(def, '수군');
    if (e.type === 'sea' || seaSide) d += tv(def, '해안방어');
  }
  const awe = 1 - tv(att, '위압');
  if (awe < 1) mods.push(`위압 적 방어 -${Math.round((1 - awe) * 100)}%`);
  let terrDef = wr.sea ? 1 : TERRAIN[terr].def || 1;
  if (terr === T.MOUNTAIN && tv(att, '산악')) terrDef = 1.1;
  const hp = Math.min(WALL_MAX, tr.buildings?.walls || 0);
  const engines = opts.engines || 0;
  const wallPower = hp ? Math.max(0.1, (opts.mode === 'assault' ? 1 : 0.5) + tv(def, '축성') - 0.15 * engines) : 0;
  const walls = 1 + (wallPower * hp) / WALL_MAX;
  const capital = tr.owner !== null && !wr.sea && s.nations[tr.owner].capital === to ? 1.1 : 1;
  const defSupply = tr.owner === null || supplied(s, world, tr.owner).has(to) ? 1 : 0.8;
  let buffD = tr.owner === null ? 1 : nationBuff(s, tr.owner, 'def');
  // 대동맹 연합군은 패권국을 칠 때 사기가 오름
  if (s.coalition && s.coalition.target === tr.owner && s.coalition.members?.includes(nid)) {
    buffA *= 1.1;
    mods.push('대동맹 연합군 +10%');
  }
  // 대동맹 회원국은 패권국의 침공에 결사항전
  if (s.coalition && s.coalition.target === nid && s.coalition.members?.includes(tr.owner)) buffD *= 1.15;
  return {
    attMult: (1 + capBonus(a) - betrayal) * edgeMult * weather * attSupply * buffA,
    defMult: (1 + capBonus(d)) * terrDef * walls * capital * defSupply * buffD * awe,
    genAtt: capBonus(a), genAttRaw: a, genDef: capBonus(d), genDefRaw: d,
    mods, def, att, edge: e, terrDef, walls, defSupply, weather: w,
  };
}

export function estimateBattle(s, world, nid, from, to, count, genIds, opts = {}) {
  const f = battleFactors(s, world, nid, from, to, genIds, { ...opts, count });
  const A = count * f.attMult;
  const D = s.regions[to].troops * f.defMult;
  let wins = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const a = A * (0.85 + Math.random() * 0.3), d = D * (0.85 + Math.random() * 0.3);
    if (a > d) wins++;
  }
  return { ...f, A, D, ratio: D > 0 ? A / D : 99, winChance: D <= 0 ? 1 : wins / trials };
}

// ───────── 행동 ─────────
const fail = (msg) => ({ ok: false, msg });

export function canAct(s, nid, ap) {
  const n = s.nations[nid];
  if (!n.alive) return '멸망한 국가입니다.';
  if (n.ap < ap) return `행동력이 부족합니다 (필요 ${ap}).`;
  return null;
}

// 징병: 징집(싸지만 인구의 5%를 넘게 뽑으면 민심 하락) 또는 모병(비싸지만 민심 영향 없음, 최대치 절반)
export const CONSCRIPT = {
  draft: { name: '징집', gold: 5, desc: '1명당 5금. 인구의 5%를 넘게 뽑으면 넘는 만큼 민심 하락' },
  hire: { name: '모병', gold: 12, desc: '1명당 12금. 자원자를 모아 민심 영향 없음, 최대 인원 절반' },
};

export function conscriptMax(s, rid, nid, mode = 'draft') {
  const r = s.regions[rid];
  let add = r.pop * 300 * (r.buildings.barracks ? 1.5 : 1) * (1 + tv(gensIn(s, rid, nid), '징병'));
  if ((r.loyalty ?? 100) < 40) add *= 0.5;
  if (mode === 'hire') add *= 0.5;
  return Math.max(100, Math.round(add / 100) * 100);
}

export function conscriptCost(s, rid, amount, mode = 'draft') {
  const r = s.regions[rid];
  const ratio = amount / Math.max(1000, r.pop * 1000);
  return {
    gold: amount * CONSCRIPT[mode].gold,
    loyalty: mode === 'hire' ? 0 : Math.round(Math.max(0, ratio - 0.05) * 45),
    pop: (amount / 1000) * 0.5,
  };
}

export function doConscript(s, world, nid, rid, amount, mode = 'draft') {
  const r = s.regions[rid];
  const n = s.nations[nid];
  if (r.owner !== nid || r.sea) return fail('내 지역이 아닙니다.');
  if (r.conscripted) return fail('이번 턴에 이미 징병했습니다.');
  const max = conscriptMax(s, rid, nid, mode);
  amount = Math.max(100, Math.min(max, Math.round((amount ?? max) / 100) * 100));
  const c = conscriptCost(s, rid, amount, mode);
  if (n.gold < c.gold) return fail(`금이 부족합니다 (필요 ${fmtGold(c.gold)}).`);
  const err = canAct(s, nid, COST.conscript);
  if (err) return fail(err);
  r.troops += amount;
  r.pop = Math.max(3, r.pop - c.pop);
  r.loyalty = Math.max(0, (r.loyalty ?? 100) - c.loyalty);
  r.conscripted = true;
  n.gold -= c.gold;
  n.ap -= COST.conscript;
  return { ok: true, msg: `${r.name}에서 병사 ${fmtTroops(amount)}을 ${CONSCRIPT[mode].name}했습니다. (금 -${fmtGold(c.gold)}${c.loyalty ? `, 민심 -${c.loyalty}` : ''})` };
}

// 진휼: 곡식을 풀어 민심을 달램. 비싸고 지역마다 6턴에 한 번
export const reliefCost = (s, rid) => Math.round(((8 + s.regions[rid].pop * 1.5) * G) / 100) * 100;
export const RELIEF_COOLDOWN = 6;

export function doRelief(s, nid, rid) {
  const r = s.regions[rid];
  const n = s.nations[nid];
  if (r.owner !== nid || r.sea) return fail('내 지역이 아닙니다.');
  if (r.reliefTurn !== undefined && s.turn - r.reliefTurn < RELIEF_COOLDOWN) return fail(`${RELIEF_COOLDOWN - (s.turn - r.reliefTurn)}턴 뒤에 다시 할 수 있습니다.`);
  const cost = reliefCost(s, rid);
  if (n.gold < cost) return fail(`금이 부족합니다 (필요 ${fmtGold(cost)}).`);
  const err = canAct(s, nid, 1);
  if (err) return fail(err);
  const gain = (r.loyalty ?? 100) < 40 ? 14 : 7;
  n.gold -= cost;
  n.ap -= 1;
  r.reliefTurn = s.turn;
  r.loyalty = Math.min(100, (r.loyalty ?? 100) + gain);
  return { ok: true, msg: `${r.name}에 진휼을 베풀었습니다. (민심 +${gain})` };
}

export function buildCost(s, rid, nid, kind) {
  const b = BUILDINGS[kind];
  const w = s.regions[rid].buildings.walls;
  const repair = kind === 'walls' && w > 0 && w < WALL_MAX ? 0.5 : 1;
  return Math.round(b.cost * repair * (1 - tv(gensIn(s, rid, nid), '건축')));
}

export function doBuild(s, world, nid, rid, kind) {
  const r = s.regions[rid];
  const n = s.nations[nid];
  const b = BUILDINGS[kind];
  if (r.owner !== nid || r.sea) return fail('내 지역이 아닙니다.');
  const repair = kind === 'walls' && r.buildings.walls > 0 && r.buildings.walls < WALL_MAX;
  if (r.buildings[kind] && !repair) return fail(`이미 ${b.name}이(가) 있습니다.`);
  if (b.coastal && !world.regions[rid].coastal) return fail('해안 지역에만 건설할 수 있습니다.');
  const cost = buildCost(s, rid, nid, kind);
  if (n.gold < cost) return fail(`금이 부족합니다 (필요 ${fmtGold(cost)}).`);
  const err = canAct(s, nid, b.ap);
  if (err) return fail(err);
  n.gold -= cost;
  n.ap -= b.ap;
  r.buildings[kind] = kind === 'walls' ? WALL_MAX : 1;
  return { ok: true, msg: repair ? `${r.name}의 성벽을 보수했습니다.` : `${r.name}에 ${b.name}을(를) 건설했습니다.` };
}

export const engineCost = (s, rid) => (s.regions[rid].buildings.barracks ? 35 : 50) * G;

export function doBuildEngine(s, nid, rid) {
  const r = s.regions[rid];
  const n = s.nations[nid];
  if (r.owner !== nid || r.sea) return fail('내 지역이 아닙니다.');
  if ((r.engines || 0) >= ENGINE_MAX) return fail(`공성병기는 지역당 ${ENGINE_MAX}대까지입니다.`);
  const cost = engineCost(s, rid);
  if (n.gold < cost) return fail(`금이 부족합니다 (필요 ${fmtGold(cost)}).`);
  const err = canAct(s, nid, 1);
  if (err) return fail(err);
  n.gold -= cost;
  n.ap -= 1;
  r.engines = (r.engines || 0) + 1;
  return { ok: true, msg: `${r.name}에서 공성병기를 제작했습니다. (${r.engines}대)` };
}

export function canSail(s, nid, from, genIds) {
  return !!s.regions[from].buildings?.port || genIds.some((id) => tv([s.generals[id]].filter(Boolean), '수군'));
}

export function moveCheck(s, world, nid, from, to, count, genIds = []) {
  const fr = s.regions[from], tr = s.regions[to];
  if (fr.owner !== nid) return '내 지역에서만 출발할 수 있습니다.';
  const e = edgeBetween(world, from, to);
  if (!e) return '인접하지 않은 지역입니다.';
  if (e.type === 'coast' && !canSail(s, nid, from, genIds)) return '배를 띄우려면 출발지에 항구가 있거나 수군 장수가 필요합니다.';
  const seaMove = e.type === 'coast' || e.type === 'sea' || e.type === 'landing' || e.type === 'cliff';
  const sailor = genIds.some((id) => (s.generals[id]?.traits || []).some(([t, l]) => t === '항해' && l >= 3));
  if (seaMove && !sailor && (weatherOf(s, from).noSea || weatherOf(s, to).noSea)) return '폭풍·용오름으로 항해할 수 없습니다. (항해Ⅲ 장수는 가능)';
  const maxCount = fr.sea ? fr.troops : fr.troops - 1;
  if (count < 1 || count > maxCount) return fr.sea ? '이동 병력이 올바르지 않습니다.' : '이동 병력이 올바르지 않습니다 (최소 1명은 남겨야 함).';
  if (tr.owner !== null && tr.owner !== nid) {
    const rel = getRel(s, nid, tr.owner);
    // 동맹국 땅으로는 원군(병사만)을 보낼 수 있음
    if (rel.type === 'alliance') {
      if (tr.sea) return '동맹 함대와는 합류할 수 없습니다.';
      if (genIds.length) return '원군에는 장수를 보낼 수 없습니다. (장수 선택 해제)';
    }
  }
  return canAct(s, nid, moveCost(world, from, to, s));
}

function betray(s, nid, victim) {
  const rel = getRel(s, nid, victim);
  const n = s.nations[nid];
  const what = rel.type === 'vassal' ? '종속 관계' : '불가침 조약';
  setRel(s, nid, victim, null);
  n.reputation = Math.max(0, n.reputation - 25);
  n.apPenalty = (n.apPenalty || 0) + 2;
  for (const o of s.nations) if (o.alive && o.id !== nid) s.opinion[o.id][nid] -= 15;
  s.opinion[victim][nid] -= 40;
  log(s, `⚠️ ${n.name}이(가) ${s.nations[victim].name}과(와)의 ${what}을 깨고 공격했습니다! (평판 -25, 다음 턴 행동력 -2)`, [nid, victim], 'betray');
}

function relocateRefugees(s, world, gens, nation, around) {
  const own = world.regions[around].neighbors.map((n) => n.id).filter((id) => s.regions[id].owner === nation && !s.regions[id].sea);
  for (const g of gens) {
    if (own.length) g.region = own[0];
    else {
      const any = nationRegions(s, nation);
      if (any.length) g.region = s.nations[nation].capital ?? any[0];
    }
  }
}

function transferRegion(s, world, rid, newOwner) {
  const r = s.regions[rid];
  const old = r.owner;
  r.owner = newOwner;
  if (old !== null) {
    s.nations[old].lost = (s.nations[old].lost || 0) + 1;
    const gens = gensIn(s, rid, old);
    if (gens.length) relocateRefugees(s, world, gens, old, rid);
    const n = s.nations[old];
    if (n.capital === rid) {
      const rest = nationRegions(s, old);
      n.capital = rest.length ? rest.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] : null;
    }
    checkElimination(s, world, old, newOwner);
  }
}

export function checkElimination(s, world, nid, by = null) {
  const n = s.nations[nid];
  if (!n.alive) return;
  if (nationRegions(s, nid).length > 0) return;
  n.alive = false;
  n.capital = null;
  // 정복으로 멸망: 살아 있는 군주는 정복국의 장수로 귀순
  const king = s.generals[n.ruler];
  const conq = by !== null ? s.nations[by] : null;
  if (king && conq?.alive && (king.status === 'active' || king.status === 'prisoner')) {
    king.status = 'active';
    king.captor = null;
    king.nation = by;
    king.region = conq.capital ?? nationRegions(s, by)[0];
    king.loyalty = 55;
    king.exKing = n.name;
    king.joined = s.turn;
    log(s, `🙇 ${n.name}의 군주 ${king.name}이(가) ${conq.name}에 귀순해 장수가 되었습니다.`, [by, nid], 'general');
  }
  for (const r of s.regions) {
    if (r.owner === nid && r.sea) {
      r.owner = null;
      r.troops = 0;
    }
  }
  for (const g of Object.values(s.generals)) {
    if (g.nation === nid && g.status === 'active') g.status = 'gone';
    if (g.status === 'prisoner' && g.captor === nid) {
      g.status = 'active';
      g.captor = null;
      const home = s.nations[g.nation];
      if (!home.alive || home.capital === null) g.status = 'gone';
      else g.region = home.capital;
    }
  }
  for (const k of Object.keys(s.relations)) if (k.split('-').map(Number).includes(nid)) delete s.relations[k];
  s.joint = s.joint.filter((j) => j.a !== nid && j.b !== nid && j.target !== nid);
  log(s, `☠️ ${n.name}이(가) 멸망했습니다.`, [nid], 'dead');
}

const STAT_NAME = { war: '무력', lead: '통솔', intel: '지력', pol: '정치' };

// 장수 성장: 레벨마다 100×레벨 경험치. 레벨업 시 역할에 맞는 능력치 상승, 3·5·7·9레벨에 특성 획득/승급과 칭호
export function gainExp(s, g, amt) {
  if (!g || g.status === 'dead') return;
  g.exp = (g.exp || 0) + Math.round(amt * (1 + nationTrait(s, g.nation, '학문')));
  g.level = g.level || 1;
  const rng = stateRng(s);
  while (g.exp >= g.level * 100) {
    g.exp -= g.level * 100;
    g.level++;
    const prefer = g.role === 'civ' ? ['pol', 'intel', 'pol', 'intel', 'lead', 'war'] : ['war', 'lead', 'war', 'lead', 'intel', 'pol'];
    const keys = [...new Set([rng.pick(prefer), rng.pick(prefer), rng.pick(prefer)])].slice(0, 2);
    const ups = keys.map((k) => {
      const inc = rng.int(2, 4);
      g[k] = Math.min(100, g[k] + inc);
      return `${STAT_NAME[k]}+${inc}`;
    });
    let extra = '';
    if ([3, 5, 7, 9].includes(g.level)) {
      const grown = growTrait(g, rng);
      if (grown) extra += ` · ${grown}`;
      const t = TITLES[g.role || 'mil'].filter(([lv]) => g.level >= lv).pop();
      if (t && t[1] !== g.title) {
        g.title = t[1];
        extra += ` · 칭호 「${t[1]}」`;
      }
    }
    log(s, `🎖️ ${g.name} Lv${g.level} 달성 (${ups.join(', ')})${extra}`, [g.nation], 'general');
  }
}

// 지도 애니메이션용 이동 기록 (턴마다 초기화)
function trackMove(s, from, to, nid, count, kind) {
  s.moveSeq = (s.moveSeq || 0) + 1;
  (s.moves = s.moves || []).push({ id: s.moveSeq, from, to, n: nid, c: count, k: kind });
  if (s.moves.length > 200) s.moves.shift();
}

export function doMove(s, world, nid, from, to, count, genIds = [], opts = {}) {
  const err = moveCheck(s, world, nid, from, to, count, genIds);
  if (err) return fail(err);
  const rng = stateRng(s);
  const n = s.nations[nid];
  const fr = s.regions[from], tr = s.regions[to];
  const cost = moveCost(world, from, to, s);
  const gens = genIds.map((id) => s.generals[id]).filter((g) => g && g.status === 'active' && g.nation === nid && g.region === from);
  const engines = Math.min(opts.engines || 0, fr.engines || 0);
  // 원군: 병사를 동맹국에 넘겨줌
  if (tr.owner !== null && tr.owner !== nid && getRel(s, nid, tr.owner).type === 'alliance') {
    n.ap -= cost;
    fr.troops -= count;
    tr.troops += count;
    s.opinion[tr.owner][nid] += Math.min(20, count / 2000);
    log(s, `🤝 ${n.name}이(가) 동맹국 ${s.nations[tr.owner].name}의 ${tr.name}에 원군 ${fmtTroops(count)}을 보냈습니다.`, [nid, tr.owner], 'diplo');
    trackMove(s, from, to, nid, count, 'aid');
    return { ok: true, msg: `${tr.name}에 원군 ${fmtTroops(count)} 파견.` };
  }
  const leaveSea = () => {
    if (fr.sea && fr.troops <= 0) {
      fr.troops = 0;
      fr.owner = null;
    }
  };
  n.ap -= cost;
  // 아군 지역 또는 빈 바다로 이동
  if (tr.owner === nid || (tr.sea && (tr.owner === null || tr.troops <= 0))) {
    fr.troops -= count;
    tr.owner = nid;
    tr.troops += count;
    for (const g of gens) g.region = to;
    if (engines && !tr.sea && !fr.sea) {
      fr.engines -= engines;
      tr.engines = Math.min(ENGINE_MAX, (tr.engines || 0) + engines);
    }
    leaveSea();
    const verb = tr.sea && !fr.sea ? '승선' : fr.sea && !tr.sea ? '상륙' : '이동';
    trackMove(s, from, to, nid, count, 'move');
    return { ok: true, msg: `${fr.name} → ${tr.name}: 병사 ${fmtTroops(count)} ${verb}.` };
  }
  const defender = tr.owner;
  if (defender !== null) {
    const rel = getRel(s, nid, defender);
    if (rel.type === 'nap' || rel.type === 'vassal') betray(s, nid, defender);
  }
  const hasWalls = !tr.sea && (tr.buildings.walls || 0) > 0;
  const mode = hasWalls ? opts.mode || 'siege' : 'field';
  const f = battleFactors(s, world, nid, from, to, gens.map((g) => g.id), { mode, engines, count });
  const defName = defender === null ? '중립 세력' : s.nations[defender].name;
  const et = edgeBetween(world, from, to)?.type;
  const kind = tr.sea ? 'naval' : fr.sea ? (et === 'cliff' ? 'cliff' : 'landing') : et === 'strait' ? 'strait' : et === 'river' ? 'river' : mode !== 'field' ? 'siege' : 'field';
  const battle = { from, to, attacker: nid, defender, count, defTroops: tr.troops, turn: s.turn, naval: !!tr.sea, mode, kind };
  const lines = [];

  // 일기토: 플레이어가 직접 치른 결과(opts.duel) 또는 자동 진행
  let duel = opts.duel || null;
  if (!duel && opts.duel !== false && tr.troops > 0) {
    const ag = duelist(gens), dg = duelist(f.def);
    if (ag && dg && rng() < 0.7 && (dg.war >= ag.war - 15 || rng() < 0.3)) duel = simulateDuel(rng, ag, dg);
  }
  let duelMult = 1;
  if (duel) {
    const ag = s.generals[duel.a], dg = s.generals[duel.b];
    battle.duel = { a: ag.name, b: dg.name, winner: duel.winner, ko: duel.ko, rounds: duel.rounds };
    if (duel.winner === 1) { duelMult = 1.15; gainExp(s, ag, 40); ag.duelWins = (ag.duelWins || 0) + 1; }
    else if (duel.winner === 2) { duelMult = 1 / 1.15; gainExp(s, dg, 40); dg.duelWins = (dg.duelWins || 0) + 1; }
    if (duel.winner === 1 && nid === s.playerId) (s.stats = s.stats || {}).duels = (s.stats.duels || 0) + 1;
    const loser = duel.winner === 1 ? dg : duel.winner === 2 ? ag : null;
    if (duel.ko && loser && rng() < 0.4) {
      loser.status = 'dead';
      battle.duel.killed = loser.name;
    }
    const res = duel.winner === 0 ? '무승부' : `${duel.winner === 1 ? ag.name : dg.name} 승리`;
    lines.push(`일기토 ${ag.name} vs ${dg.name}: ${res}${battle.duel.killed ? ` (${battle.duel.killed} 전사)` : ''}`);
  }
  const defGens = f.def.filter((g) => g.status === 'active');
  const atkGens = gens.filter((g) => g.status === 'active');
  const A = count * f.attMult * duelMult * rng.range(0.85, 1.15);
  const D = tr.troops * f.defMult * rng.range(0.85, 1.15);
  fr.troops -= count;
  if (engines) fr.engines -= engines;
  (s.battles = s.battles || []).push(battle);
  const report = { from, to, attacker: nid, defender, count, defTroops: tr.troops, A, D, captured: [], killed: [], fled: [] };
  if (battle.duel?.killed) report.killed.push(battle.duel.killed);
  const finish = (kind, msg) => {
    leaveSea();
    if (lines.length) msg += ` [${lines.join(' / ')}]`;
    report.msg = msg;
    battle.result = kind;
    battle.attLoss = report.attLoss;
    battle.defLoss = report.defLoss;
    battle.win = kind === 'win';
    battle.msg = fixJosa(msg);
    // 전공 기록 (승리 요약·업적용)
    for (const g of kind === 'lose' ? defGens : atkGens) g.wins = (g.wins || 0) + 1;
    const st = (s.stats = s.stats || {});
    if (nid === s.playerId) st[kind === 'lose' ? 'lost' : 'won'] = (st[kind === 'lose' ? 'lost' : 'won'] || 0) + 1;
    log(s, msg, defender === null ? [nid] : [nid, defender], 'battle');
    if (defender !== null) {
      s.opinion[defender][nid] -= 15;
      for (const o of s.nations) if (o.alive && isVassalOf(s, defender, o.id) && o.id !== nid) s.opinion[o.id][nid] -= 10;
    }
    trackMove(s, from, to, nid, count, kind);
    return { ok: true, msg, report };
  };
  const assaultLoss = mode === 'assault' ? (tv(atkGens, '공성') && atkGens.some((g) => g.traits.some(([t, l]) => t === '공성' && l >= 2)) ? 1.05 : 1.5) : 1;

  // 포위: 성벽이 남아 있으면 이겨도 성벽만 깎이고 함락되지 않음
  if (mode === 'siege' && A > D) {
    const before = tr.buildings.walls;
    const dmg = 1 + (A > D * 2 ? 1 : 0) + Math.min(2, engines) + tv(atkGens, '공성');
    tr.buildings.walls = Math.max(0, before - dmg);
    tr.siegedTurn = s.turn;
    battle.siege = { before, after: tr.buildings.walls };
    if (tr.buildings.walls > 0) {
      report.defLoss = Math.min(Math.max(0, tr.troops - 100), Math.round(tr.troops * Math.min(0.5, (0.3 * A) / Math.max(1, D))));
      report.attLoss = Math.round(count * Math.min(0.6, (0.45 * D) / A + 0.1));
      tr.troops -= report.defLoss;
      fr.troops += count - report.attLoss;
      fr.engines = Math.min(ENGINE_MAX, (fr.engines || 0) + engines);
      for (const g of atkGens) gainExp(s, g, 10);
      return finish('siege', `🏰 ${n.name}이(가) ${tr.name}(${defName})을(를) 포위 공격! 성벽 ${before}→${tr.buildings.walls}${engines ? ` (공성병기 ${engines}대)` : ''}. 아군 손실 ${fmtTroops(report.attLoss)}, 적 손실 ${fmtTroops(report.defLoss)}.`);
    }
    lines.push('성벽 붕괴');
  }

  if (A > D) {
    const ratio = D / A;
    const loss = Math.min(count - 1, Math.round(count * ratio * 0.7 * assaultLoss));
    const survivors = Math.max(1, count - loss);
    report.win = true;
    report.attLoss = count - survivors;
    report.defLoss = tr.troops;
    const wasCapital = defender !== null && !tr.sea && s.nations[defender].capital === to;
    const plunder = wasCapital ? Math.floor(s.nations[defender].gold * 0.2) : 0;
    const fierce = tv(atkGens, '맹장') ? 0.12 : 0;
    for (const g of defGens) {
      if (rng() < 0.45 + tv(atkGens, '추격')) {
        if (rng() < 0.1 + fierce) {
          g.status = 'dead';
          report.killed.push(g.name);
        } else {
          g.status = 'prisoner';
          g.captor = nid;
          report.captured.push(g.name);
        }
      } else report.fled.push(g.name);
    }
    tr.troops = 0;
    if (defender !== null && plunder) {
      s.nations[defender].gold -= plunder;
      n.gold += plunder;
      report.plunder = plunder;
    }
    if (mode === 'assault') tr.buildings.walls = Math.max(0, tr.buildings.walls - 1);
    transferRegion(s, world, to, nid);
    tr.troops = survivors;
    if (!tr.sea) {
      tr.loyalty = defender === null ? 35 : 15;
      tr.conscripted = true;
      tr.engines = Math.min(ENGINE_MAX, (tr.engines || 0) + engines);
    }
    for (const g of atkGens) {
      g.region = to;
      gainExp(s, g, 25);
    }
    const what = tr.sea ? '해전에서 승리하고 제해권을 장악' : mode === 'assault' ? '강습으로 함락' : '점령';
    let msg = `${tr.sea ? '⚓' : '⚔️'} ${n.name}이(가) ${tr.name}(${defName})을(를) ${what}! 아군 손실 ${fmtTroops(report.attLoss)}, 적 ${fmtTroops(report.defLoss)} 격파.`;
    if (wasCapital) msg += ` 수도 함락, ${fmtGold(plunder)}금 약탈.`;
    if (report.captured.length) msg += ` 포로: ${report.captured.join(', ')}.`;
    if (report.killed.length) msg += ` 전사: ${report.killed.join(', ')}.`;
    return finish('win', msg);
  }
  const ratio = D > 0 ? A / D : 1;
  const back = fr.sea || tr.sea ? 0 : Math.round(count * (0.25 + tv(atkGens, '노련')) * rng());
  report.win = false;
  report.attLoss = count - back;
  const archery = 1 + 2 * tv(defGens, '궁술');
  report.defLoss = Math.max(0, Math.min(tr.troops - 1, Math.round((tr.troops * ratio * 0.6) / archery / (1 + tv(defGens, '철벽')))));
  tr.troops -= report.defLoss;
  fr.troops += back;
  if (engines) fr.engines = Math.min(ENGINE_MAX, (fr.engines || 0) + Math.floor(engines / 2));
  for (const g of atkGens) {
    const r = rng();
    if (r < 0.05) {
      g.status = 'dead';
      report.killed.push(g.name);
    } else if (r < 0.3 && defender !== null) {
      g.status = 'prisoner';
      g.captor = defender;
      report.captured.push(g.name);
    } else if (fr.sea && fr.troops <= 0) {
      // 바다에서 패한 장수는 가까운 아군 땅으로 귀환
      const home = nationRegions(s, nid);
      g.region = s.nations[nid].capital ?? home[0];
    }
  }
  for (const g of defGens) gainExp(s, g, 25);
  let msg = `🛡️ ${n.name}의 ${tr.name}(${defName}) ${tr.sea ? '해전' : mode === 'assault' ? '강습' : '공격'} 실패. 아군 손실 ${fmtTroops(report.attLoss)}, 적 손실 ${fmtTroops(report.defLoss)}.`;
  if (report.captured.length) msg += ` 포로로 잡힘: ${report.captured.join(', ')}.`;
  if (report.killed.length) msg += ` 전사: ${report.killed.join(', ')}.`;
  return finish('lose', msg);
}

export function doRelocate(s, nid, gid, to) {
  const g = s.generals[gid];
  if (!g || g.nation !== nid || g.status !== 'active') return fail('이동할 수 없는 장수입니다.');
  if (s.regions[to].owner !== nid || s.regions[to].sea) return fail('내 땅으로만 배치할 수 있습니다.');
  const err = canAct(s, nid, COST.relocate);
  if (err) return fail(err);
  s.nations[nid].ap -= COST.relocate;
  g.region = to;
  return { ok: true, msg: `${g.name}을(를) ${s.regions[to].name}에 배치했습니다.` };
}

// ───────── 장수: 등용·처형·석방·회유 ─────────
export function isRuler(s, g) {
  return s.nations.some((n) => n.alive && n.ruler === g.id);
}

export function recruitChance(s, nid, g) {
  const n = s.nations[nid];
  let c = 30 + (n.reputation - 50) * 0.5 + (100 - g.loyalty) * 0.3 + nationTrait(s, nid, '인덕') * 5 + nationTrait(s, nid, '설득');
  if (isRuler(s, g)) c = 0;
  return Math.max(0, Math.min(90, Math.round(c)));
}

export function doRecruit(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('등용할 수 없습니다.');
  if (isRuler(s, g)) return fail('적국의 군주는 등용할 수 없습니다.');
  if (s.tried[gid] === s.turn) return fail('이번 턴에 이미 설득했습니다.');
  const err = canAct(s, nid, COST.recruit);
  if (err) return fail(err);
  const rng = stateRng(s);
  s.nations[nid].ap -= COST.recruit;
  s.tried[gid] = s.turn;
  if (rng() * 100 < recruitChance(s, nid, g)) {
    const old = g.nation;
    g.status = 'active';
    g.nation = nid;
    g.captor = null;
    g.loyalty = 60;
    g.region = s.nations[nid].capital;
    const msg = `🤝 ${g.name}이(가) ${s.nations[nid].name}에 투항했습니다!`;
    log(s, msg, [nid, old], 'general');
    return { ok: true, msg };
  }
  g.loyalty = Math.max(0, g.loyalty - 10);
  return { ok: true, msg: `${g.name}이(가) 등용을 거절했습니다. (다음 턴 재시도 가능, 충성 하락)` };
}

export function doExecute(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('처형할 수 없습니다.');
  g.status = 'dead';
  const n = s.nations[nid];
  n.reputation = Math.max(0, n.reputation - 4);
  if (s.nations[g.nation].alive) s.opinion[g.nation][nid] -= 30;
  const ruler = isRulerId(s, g.id);
  if (ruler !== null) succession(s, ruler);
  const msg = `🗡️ ${n.name}이(가) ${g.name}을(를) 처형했습니다. (평판 -4)`;
  log(s, msg, [nid, g.nation], 'general');
  return { ok: true, msg };
}

function isRulerId(s, gid) {
  const n = s.nations.find((x) => x.alive && x.ruler === gid);
  return n ? n.id : null;
}

export function succession(s, nid) {
  const gens = nationGenerals(s, nid).sort((a, b) => rating(b) - rating(a));
  const n = s.nations[nid];
  n.ruler = gens.length ? gens[0].id : null;
  if (gens.length) log(s, `👑 ${n.name}의 새 군주로 ${gens[0].name}이(가) 즉위했습니다.`, [nid], 'general');
}

export function doRelease(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('석방할 수 없습니다.');
  const home = s.nations[g.nation];
  g.captor = null;
  if (home.alive && home.capital !== null) {
    g.status = 'active';
    g.region = home.capital;
    s.opinion[g.nation][nid] += 25;
  } else g.status = 'gone';
  const n = s.nations[nid];
  n.reputation = Math.min(100, n.reputation + 3);
  const msg = `🕊️ ${n.name}이(가) ${g.name}을(를) 석방했습니다. (평판 +3)`;
  log(s, msg, [nid, g.nation], 'general');
  return { ok: true, msg };
}

export function poachChance(s, nid, g) {
  if (isRuler(s, g)) return 0;
  const mine = nationGenerals(s, nid);
  const intel = mine.length ? Math.max(...mine.map((x) => x.intel)) : 40;
  const c = 12 + (intel - g.intel) / 2 + (s.nations[nid].reputation - 50) / 4 + (70 - g.loyalty) / 3 + nationTrait(s, nid, '첩보');
  return Math.max(0, Math.min(65, Math.round(c)));
}

export function doPoach(s, nid, gid) {
  const g = s.generals[gid];
  const n = s.nations[nid];
  if (!g || g.status !== 'active' || g.nation === nid) return fail('회유할 수 없습니다.');
  if (isRuler(s, g)) return fail('군주는 회유할 수 없습니다.');
  if (s.tried[gid] === s.turn) return fail('이번 턴에 이미 시도했습니다.');
  if (n.gold < COST.poachGold) return fail(`금이 부족합니다 (필요 ${fmtGold(COST.poachGold)}).`);
  const err = canAct(s, nid, COST.poach);
  if (err) return fail(err);
  const rng = stateRng(s);
  n.gold -= COST.poachGold;
  n.ap -= COST.poach;
  s.tried[gid] = s.turn;
  const old = g.nation;
  if (rng() * 100 < poachChance(s, nid, g)) {
    g.nation = nid;
    g.region = n.capital;
    g.loyalty = 50;
    s.opinion[old][nid] -= 20;
    const msg = `💰 ${g.name}이(가) 회유되어 ${n.name}(으)로 넘어왔습니다!`;
    log(s, msg, [nid, old], 'general');
    return { ok: true, msg };
  }
  s.opinion[old][nid] -= 10;
  return { ok: true, msg: `${g.name} 회유에 실패했습니다.` };
}

// ───────── 장수 출현 (공평 규칙) ─────────
// 낮은 기본값 × 공평 보정 × 민심 × 국고 × 평판 × 인사 특성
export function appearChance(s, nid) {
  const n = s.nations[nid];
  const alive = s.nations.filter((x) => x.alive);
  const counts = alive.map((x) => nationGenerals(s, x.id).length);
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const mine = nationGenerals(s, nid).length;
  const regs = nationRegions(s, nid);
  const loy = regs.reduce((a, r) => a + (s.regions[r].loyalty ?? 100), 0) / Math.max(1, regs.length);
  let p = 0.06 * Math.max(0.25, Math.min(2.5, 1 + (avg - mine) * 0.4));
  p *= Math.max(0.5, Math.min(1.3, loy / 75));
  p *= n.gold >= 200 * G ? 1.2 : n.gold < 30 * G ? 0.7 : 1;
  p *= Math.max(0.5, Math.min(1.4, n.reputation / 60));
  p *= 1 + nationTrait(s, nid, '인사');
  if (regs.length <= 3) p += 0.02;
  return Math.min(0.3, p);
}

function generalWeight(s, g, strength) {
  const hist = s.appearHistory[g.id] || 0;
  let w = 1 / (1 + hist * 0.5);
  const dev = (rating(g) - 65) / 12;
  w *= Math.exp(-dev * (strength - 1) * 1.2);
  return Math.max(0.02, Math.min(20, w));
}

export function spawnGeneral(s, nid, rng, forced = false) {
  const n = s.nations[nid];
  if (!n.alive || n.capital === null) return null;
  if (!forced && !rng.chance(appearChance(s, nid))) return null;
  const alive = s.nations.filter((x) => x.alive);
  const totals = alive.map((x) => nationGenerals(s, x.id).reduce((a, g) => a + rating(g), 0));
  const avgT = totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length);
  const myT = nationGenerals(s, nid).reduce((a, g) => a + rating(g), 0);
  const strength = avgT > 0 ? Math.max(0.5, Math.min(2, myT / avgT)) : 1;
  const cands = [];
  n.pools.forEach((pool, i) => {
    for (const g of POOLS[pool] || []) if (!s.usedGen[g.id]) cands.push({ g, w: (i === 0 ? 1 : 0.45) * generalWeight(s, g, strength) });
  });
  if (!cands.length) {
    for (const [pool, list] of Object.entries(POOLS)) {
      if (pool.startsWith('tk') && !n.pools[0].startsWith('tk')) continue;
      for (const g of list) if (!s.usedGen[g.id]) cands.push({ g, w: 0.2 * generalWeight(s, g, strength) });
    }
  }
  const pick = rng.weighted(cands, (c) => c.w);
  if (!pick) return null;
  const own = nationRegions(s, nid);
  const gen = addGeneral(s, pick.g, nid, rng.chance(0.6) ? n.capital : rng.pick(own), rng);
  const kind = gen.role === 'civ' ? '문관' : '무관';
  log(s, `⭐ ${n.name}에 ${kind} ${gen.name}(무${gen.war}/통${gen.lead}/지${gen.intel}/정${gen.pol}, ${gen.traits.map(traitLabel).join('·')})이(가) 출현했습니다.`, [nid], 'general');
  return gen;
}

export function addGeneral(s, data, nid, region, rng, ruler = false) {
  if (!s.opts?.histStats) {
    const mine = Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && g.base);
    data = randomStats(data, fairTarget(mine.map((g) => g.base), rng, ruler), rng);
  }
  data = { ...data, base: Math.round(gradeScore(data)) };
  const { role, traits } = initTraits(data, rng);
  const gen = { ...data, role, traits, level: 1, exp: 0, nation: nid, origin: nid, region, status: 'active', captor: null, loyalty: rng.int(55, 90) };
  s.generals[gen.id] = gen;
  s.usedGen[gen.id] = 1;
  s.appearHistory[gen.id] = (s.appearHistory[gen.id] || 0) + 1;
  return gen;
}
