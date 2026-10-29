// ───────── 삼국지14식 모드: 컴퓨터 나라 (전략 고르기·출진·공성·요격·귀환) ─────────
import { foodUse, powerOf, trade, pactOf, propose } from './hex14gov.js';
import { aiBuild, aiForts } from './hex14build.js';
import { aiPolicy } from './hex14policy.js';
import { aiPeople } from './hex14people.js';
import { makeRng } from './rng.js';
import { sortie, order, nearestCastle, commandCap, gensOf, draft14, draftMax14, enemy, buildSiege, SIEGE_COST } from './hex14.js';

export const GRACE = 9;

// ── 전략: 나라마다 형편에 맞게 고르고 1년(36순)·큰 변화마다 다시 고름 ──
// reserve: 성에 남길 몫 · bold: 얼마나 센 성까지 노리나 · units: 동시에 내보낼 부대 수 배율
export const STRATS = {
  expand: { name: '확장', reserve: 0.35, bold: 1.1, units: 1.2, desc: '가까운 약한 성부터 넓혀 감' },
  blitz: { name: '속공', reserve: 0.2, bold: 1.35, units: 1.6, desc: '한 나라를 정해 병력을 몰아 빠르게 침' },
  build: { name: '내실', reserve: 0.5, bold: 0.85, units: 0.7, desc: '시장·농장·징병으로 힘을 키운 뒤 확실한 곳만 침' },
  coalition: { name: '반패권', reserve: 0.3, bold: 1.2, units: 1.3, desc: '가장 큰 나라를 다른 나라들과 함께 침' },
  hold: { name: '수성', reserve: 0.45, bold: 1.0, units: 1.0, desc: '1등을 지킴: 한쪽만 치고 나머지와는 정전' },
  ride: { name: '편승', reserve: 0.3, bold: 1.15, units: 1.3, desc: '강한 이웃과 동맹을 맺고 약한 이웃을 침' },
  center: { name: '사방 방어', reserve: 0.5, bold: 0.95, units: 0.9, desc: '사방이 적: 이웃과 정전하고 가장 약한 하나만 침' },
};

// 이웃 나라: 내 성에서 가까운 성을 가진 나라들 (가까운 순)
function neighbors(s, grid, nid) {
  const mine = s.castles.filter((c) => c.owner === nid);
  const d = new Map();
  for (const c of s.castles) {
    if (c.owner === null || c.owner === nid || !s.nations[c.owner]?.alive) continue;
    const m = Math.min(...mine.map((x) => grid.dist(x.tile, c.tile)));
    if (m <= 14 * grid.k && (!d.has(c.owner) || m < d.get(c.owner))) d.set(c.owner, m);
  }
  return [...d.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
const citiesOf = (s, nid) => s.castles.filter((c) => c.owner === nid && c.kind !== 'pass').length;

export function chooseStrategy(s, grid, nid) {
  const n = s.nations[nid];
  const rng = makeRng(`strat:${s.seed}:${nid}:${Math.floor(s.turn / 36)}:${n.stratN || 0}`);
  const alive = s.nations.filter((m) => m.alive && !m.horde);
  const total = s.castles.filter((c) => c.kind !== 'pass').length || 1;
  const ranked = alive.slice().sort((a, b) => citiesOf(s, b.id) - citiesOf(s, a.id) || powerOf(s, b.id) - powerOf(s, a.id));
  const top = ranked[0], mineN = citiesOf(s, nid);
  const nb = neighbors(s, grid, nid);
  const topShare = citiesOf(s, top.id) / total;
  // 노릴 나라: 이미 둘 넘게 노리는 나라는 피함 (모두가 한 나라만 물어뜯지 않게)
  const hunted = (x) => s.nations.filter((m) => m.alive && m.id !== nid && m.focus === x).length;
  const free = nb.filter((x) => hunted(x) < 2);
  const pool = free.length ? free : nb;
  const weakest = pool.slice().sort((a, b) => powerOf(s, a) - powerOf(s, b))[0];
  // 맞수: 힘이 비슷한 이웃 (먹잇감 대신 고르기도 함)
  const mp = powerOf(s, nid);
  const rival = pool.slice().sort((a, b) => Math.abs(Math.log(powerOf(s, a) / mp)) - Math.abs(Math.log(powerOf(s, b) / mp)))[0];
  const prey = () => (rng() < 0.55 ? weakest : rival) ?? null;
  let k, focus = null;
  if (top.id === nid && topShare >= 0.22) {
    k = 'hold';
    // 수성: 이웃 하나만 침
    focus = prey();
  } else if ((topShare >= 0.28 || (topShare >= 0.2 && ranked[1] && powerOf(s, top.id) > powerOf(s, ranked[1].id) * 1.5)) && nb.includes(top.id) && rng() < 0.75) {
    k = 'coalition'; focus = top.id;
  } else if (nb.length >= 3 && rng() < 0.6) {
    k = 'center'; focus = prey();
  } else if (mineN <= 3) {
    // 작은 나라: 힘을 키우거나(내실), 큰 이웃에 붙어 약한 이웃을 먹거나(편승), 빈틈을 노려 몰아침(속공)
    const r = rng();
    k = r < 0.35 ? 'build' : r < 0.7 ? 'ride' : 'blitz';
    focus = k === 'build' ? null : prey();
  } else {
    const r = rng();
    k = r < 0.4 ? 'expand' : r < 0.7 ? 'blitz' : 'build';
    focus = k === 'blitz' ? prey() : null;
  }
  n.strat = k;
  n.focus = focus;
  n.stratAt = s.turn;
  n.stratN = (n.stratN || 0) + 1;
  return k;
}

// 성 주변 위협: 6칸 안 적 부대 병력 합
function threatNear(s, grid, c) {
  let t = 0;
  for (const u of s.units) if (enemy(s, c.owner, u.nation) && grid.dist(u.tile, c.tile) <= 6 * grid.k) t += u.troops;
  return t;
}

// 전략에 맞는 외교: 수성·사방 방어는 노리지 않는 이웃과 정전, 반패권은 다른 나라와 동맹
function strategyDiplomacy(s, grid, nid, rng) {
  const n = s.nations[nid];
  if (rng() > 0.15) return;
  const nb = neighbors(s, grid, nid);
  if (n.strat === 'hold' || n.strat === 'center' || n.strat === 'build') {
    const m = nb.filter((x) => x !== n.focus && !pactOf(s, nid, x)).sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
    if (m !== undefined) propose(s, nid, m, 'truce', rng);
  } else if (n.strat === 'ride') {
    // 가장 강한 이웃(노리는 나라 말고)에게 동맹을 청함
    const m = nb.filter((x) => x !== n.focus && !pactOf(s, nid, x)).sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
    if (m !== undefined) propose(s, nid, m, 'ally', rng);
  } else if (n.strat === 'coalition' && n.focus !== null) {
    const cand = s.nations.filter((m) => m.alive && !m.horde && m.id !== nid && m.id !== n.focus && !pactOf(s, nid, m.id) && enemy(s, m.id, n.focus));
    if (cand.length) propose(s, nid, rng.pick(cand).id, 'ally', rng);
  }
}

// scope가 있으면 군단: 그 도시들과 그 군단 부대만 움직임 (플레이어가 맡긴 군단)
export function aiTurn14(s, grid, nid, scope = null) {
  const n = s.nations[nid];
  if (!n.alive) return;
  // 전략은 군단(플레이어 나라)이 아닐 때만 고름: 1년마다, 또는 도시 수가 크게 바뀌면
  if (!scope && (!n.strat || s.turn - (n.stratAt || 0) >= 36 || Math.abs(citiesOf(s, nid) - (n.stratCities ?? 0)) >= 3)) {
    chooseStrategy(s, grid, nid);
    n.stratCities = citiesOf(s, nid);
  }
  const P = STRATS[(!scope && n.strat) || 'expand'];
  const rng = makeRng(`ai:${s.seed}:${s.turn}:${nid}`);
  const inScope = (c) => !scope || scope.cities.has(c.id);
  const mine = s.castles.filter((c) => c.owner === nid && inScope(c));
  const myUnits = s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : !u.corps || n.id !== s.playerId || s.spectator));
  const mark = (u) => { if (scope) u.corps = scope.corps; return u; };
  const nUnits = () => s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : true)).length;
  const focus = scope ? null : n.focus;
  const tgt = (from, troops) => pickTarget(s, grid, nid, from, troops, P, focus);
  // 1) 이미 나간 부대: 약해지면 귀환, 목표가 없어지면 새 목표, 성벽 두꺼운 성 앞이면 공성병기
  for (const u of myUnits) {
    const home = nearestCastle(s, grid, u.tile, nid);
    if ((u.troops < u.max * 0.3 || u.morale < 25) && home) { order(s, grid, u, 'castle', home.id); continue; }
    const o = u.order;
    const bad = !o || (o.kind === 'castle' && !enemy(s, nid, s.castles[o.id].owner) && o.id !== home?.id) || (o.kind === 'unit' && !s.units.some((x) => x.id === o.id)) || (o.kind === 'tile' && !u.path.length);
    if (bad || !u.path.length) {
      const t = tgt(u.tile, u.troops);
      if (t) order(s, grid, u, 'castle', t.id);
      else if (home) order(s, grid, u, 'castle', home.id);
    }
    if (u.order?.kind === 'castle' && !u.siege) {
      const c = s.castles[u.order.id];
      if (c && enemy(s, nid, c.owner) && c.dur > 1200 && grid.dist(u.tile, c.tile) <= 3 && n.gold > SIEGE_COST * 3) buildSiege(s, u.id);
    }
  }
  // 2) 성에 다가온 적 부대를 요격 (공성병기 낀 부대는 들판에서 약하니 더 적극적으로)
  for (const c of mine) {
    const foe = s.units.filter((u) => enemy(s, nid, u.nation) && grid.dist(u.tile, c.tile) <= 4 * grid.k).sort((a, b) => a.troops * (a.siege ? 0.7 : 1) - b.troops * (b.siege ? 0.7 : 1))[0];
    if (!foe) continue;
    const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').sort((a, b) => b.lead + b.war - (a.lead + a.war));
    if (!gs.length || c.troops < foe.troops * (foe.siege ? 0.9 : 1.3) + 2000) continue;
    const r = sortie(s, grid, c.id, [gs[0].id], Math.min(commandCap(s, [gs[0].id]), c.troops - 2000));
    if (r.ok) order(s, grid, mark(r.unit), 'unit', foe.id);
  }
  // 3) 출진: 남는 병력이 있는 성에서 노릴 성으로 (전략에 따라 남길 몫·대담함이 다름)
  const maxUnits = Math.max(2, Math.ceil(mine.length * 1.2 * P.units));
  for (const c of mine.sort((a, b) => b.troops - a.troops)) {
    if (nUnits() >= maxUnits) break;
    const reserve = Math.max(2500, c.troops * P.reserve) + threatNear(s, grid, c) * 0.8;
    const spare = c.troops - reserve;
    if (spare < 4000) continue;
    const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').sort((a, b) => b.lead + b.war - (a.lead + a.war));
    if (!gs.length) continue;
    // 속공은 장수를 셋까지 몰아 넣고, 나머지는 둘
    const gids = gs.slice(0, Math.min(n.strat === 'blitz' ? 3 : 2, gs.length)).map((g) => g.id);
    const troops = Math.min(commandCap(s, gids), spare);
    const t = tgt(c.tile, troops);
    if (!t) continue;
    // 성벽이 두꺼운 성을 칠 때는 금이 넉넉하면 공성병기를 끌고 감 (속공은 더 쉽게)
    const r = sortie(s, grid, c.id, gids, troops, t.dur > (n.strat === 'blitz' ? 1000 : 1500) && n.gold > 25000);
    if (r.ok) order(s, grid, mark(r.unit), 'castle', t.id);
  }
  // 4) 시장: 병량이 3년 치 넘게 쌓이고 금이 모자라면 팔고, 금이 넘치는데 병량이 모자라면 삼
  if (!scope) {
    const use = Math.max(1000, foodUse(s, nid));
    if (n.food > use * 108 && n.gold < 60000) trade(s, nid, 'sell', Math.round((n.food - use * 72) / 1000) * 1000);
    else if (n.gold > 150000 && n.food < use * 40) trade(s, nid, 'buy', Math.round((n.gold - 100000) / 2 / 1000) * 1000);
  }
  // 5) 징병: 금이 남으면 장수 있는 성부터 (내실·속공은 더 일찍 뽑음)
  const floor = scope ? 200000 : n.strat === 'build' || n.strat === 'blitz' ? 30000 : 50000;
  if (n.gold > floor && n.food > foodUse(s, nid) * 30) {
    const hub = mine.filter((c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active')).sort((a, b) => threatNear(s, grid, b) - threatNear(s, grid, a));
    const per = Math.floor((n.gold - floor * 0.6) / 10 / Math.max(1, Math.min(6, hub.length)) / 100) * 100;
    for (const c of hub.slice(0, 6)) { const m = Math.min(draftMax14(s, c), per); if (m >= 500) draft14(s, c.id, m); }
  }
  // 수송: 장수 없는 후방 성의 남는 병력을 가까운 장수 있는 성으로 보냄 (12칸 이내)
  const hubs = mine.filter((c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active'));
  for (const c of mine) {
    if (hubs.includes(c) || threatNear(s, grid, c) > 0) continue;
    const extra = c.troops - 1500;
    if (extra < 1000) continue;
    const to = hubs.map((h) => [h, grid.dist(h.tile, c.tile)]).filter(([, d]) => d <= 12 * grid.k).sort((a, b) => a[1] - b[1])[0];
    if (!to) continue;
    c.troops -= extra;
    to[0].troops += Math.round(extra * 0.95);
  }
  // 시설·외교 (군단이 아닐 때만)
  if (!scope) {
    const threat = (c) => threatNear(s, grid, c);
    aiBuild(s, grid, nid, threat, n.strat === 'build' ? 20000 : 40000);
    aiForts(s, grid, nid, threat);
    aiPolicy(s, nid, mine.some((c) => threat(c) > 0), n.food < foodUse(s, nid) * 12);
    aiPeople(s, grid, nid, makeRng(`aip:${s.seed}:${s.turn}:${nid}`));
    strategyDiplomacy(s, grid, nid, rng);
  }
  // 6) 장수 재배치: 장수 없는 성에 남는 장수를 보냄 (입성 명령 대신 즉시 이동: 같은 나라 성끼리)
  const empty = mine.filter((c) => !Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active'));
  for (const c of empty) {
    const donor = mine.find((d) => Object.values(s.generals).filter((g) => g.castle === d.id && g.status === 'active').length >= 3);
    if (!donor) break;
    const g = Object.values(s.generals).filter((x) => x.castle === donor.id && x.status === 'active').sort((a, b) => a.lead - b.lead)[0];
    g.castle = c.id;
  }
}

// 노릴 성: 가까우면서(25칸 이내) 수비가 내 병력보다 약한 남의 성
// 전략: 노리는 나라(focus)의 성은 우선, 수성·사방 방어는 노리지 않는 나라는 건드리지 않음,
// 다른 나라와 싸우느라 부대가 밖에 나가 있는 나라는 빈틈으로 봄
function pickTarget(s, grid, nid, from, troops, P = STRATS.expand, focus = null) {
  const n = s.nations[nid];
  let best = null, bv = Infinity;
  const busy = new Map(); // 나라 → 밖에 나가 있는 병력
  for (const u of s.units) busy.set(u.nation, (busy.get(u.nation) || 0) + u.troops);
  for (const c of s.castles) {
    if (!enemy(s, nid, c.owner)) continue;
    // 처음 석 달(9순)은 플레이어 도시를 먼저 노리지 않음 (작은 나라도 숨 돌릴 틈)
    if (c.owner === s.playerId && !s.spectator && s.turn <= GRACE) continue;
    const neutral = c.owner === null || c.owner === -1;
    if (!neutral && focus !== null && focus !== undefined && c.owner !== focus && (n.strat === 'hold' || n.strat === 'center')) continue;
    const d = grid.dist(c.tile, from);
    if (d > 25 * grid.k) continue;
    const guard = c.troops + s.units.filter((u) => u.nation === c.owner && grid.dist(u.tile, c.tile) <= 3 * grid.k).reduce((a, u) => a + u.troops, 0);
    // 이미 그 성으로 가는 우리 부대와 힘을 합침
    const ours = s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === c.id).reduce((a, u) => a + u.troops, 0);
    if (guard * (c.dur > c.maxDur * 0.3 ? 1.5 : 1) > (troops + ours) * P.bold) continue;
    let v = d * 1.5 / grid.k + guard / 2000 + (neutral ? -3 : 0);
    if (!neutral && c.owner === focus) v -= 8;
    if (!neutral && (busy.get(c.owner) || 0) > powerOf(s, c.owner) * 0.4) v -= 3;
    if (v < bv) { bv = v; best = c; }
  }
  return best;
}

export { gensOf };
