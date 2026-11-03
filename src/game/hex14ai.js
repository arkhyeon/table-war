// ───────── 삼국지14식 모드: 컴퓨터 나라 (전략 고르기·출진·공성·요격·귀환) ─────────
import { foodUse, powerOf, trade, pactOf, propose } from './hex14gov.js';
import { aiBuild, aiForts } from './hex14build.js';
import { aiPolicy } from './hex14policy.js';
import { lordOf } from './hex14vassal.js';
import { aiPeople } from './hex14people.js';
import { makeRng } from './rng.js';
import { sortie, order, nearestCastle, commandCap, gensOf, draft14, draftMax14, enemy, buildSiege, SIEGE_COST, sendTroops } from './hex14.js';

export const GRACE = 9;
// 플레이어 숨 돌릴 틈: 보통 9순, 도시 3개 이하 작은 나라로 시작하면 1년(36순)
export const graceOf = (s) => (s.playerStart ?? 99) <= 3 ? 36 : GRACE;

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
// 맞닿은 성: 그 성에서 가장 가까운 남의 성(그 나라 것 말고)이 우리 성이거나 거의 같은 거리 — 다른 나라 땅 너머가 아님
export function frontier(s, grid, nid, c) {
  let mineD = Infinity, otherD = Infinity;
  for (const x of s.castles) {
    if (x === c || x.owner === c.owner) continue;
    const d = grid.dist(x.tile, c.tile);
    if (x.owner === nid) mineD = Math.min(mineD, d);
    else if (x.owner !== null && x.owner >= 0 && s.nations[x.owner]?.alive) otherD = Math.min(otherD, d);
  }
  return mineD <= otherD + 2 * grid.k ? mineD : Infinity;
}
function neighbors(s, grid, nid) {
  const d = new Map();
  for (const c of s.castles) {
    if (c.owner === null || c.owner === nid || !s.nations[c.owner]?.alive) continue;
    const m = frontier(s, grid, nid, c);
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
  const free = nb.filter((x) => hunted(x) < 2 && !pactOf(s, nid, x) && !(x === s.playerId && !s.spectator && s.turn <= graceOf(s)));
  const pool = free.length ? free : nb.filter((x) => !pactOf(s, nid, x)).length ? nb.filter((x) => !pactOf(s, nid, x)) : nb;
  const weakest = pool.slice().sort((a, b) => powerOf(s, a) - powerOf(s, b))[0];
  // 맞수: 힘이 비슷한 이웃 (먹잇감 대신 고르기도 함)
  const mp = powerOf(s, nid);
  const rival = pool.slice().sort((a, b) => Math.abs(Math.log(powerOf(s, a) / mp)) - Math.abs(Math.log(powerOf(s, b) / mp)))[0];
  const prey = () => (rng() < 0.55 ? weakest : rival) ?? null;
  let k, focus = null;
  // 후반 결전: 1등이 넓게 앞서면 남은 이웃 중 가장 센 맞수(속국 아닌 나라)를 정면으로 노림 — 잔존 세력만 두드리며 교착되지 않게
  const bigRival = pool.filter((x) => lordOf(s, x) === null).sort((a, b) => citiesOf(s, b) - citiesOf(s, a))[0];
  if (top.id === nid && topShare >= 0.35 && bigRival !== undefined && citiesOf(s, bigRival) >= 3) {
    k = 'blitz';
    focus = bigRival;
  } else if (top.id === nid && topShare >= 0.22) {
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
  const alive = s.nations.filter((m) => m.alive && !m.horde);
  const avgC = alive.reduce((a, m) => a + citiesOf(s, m.id), 0) / Math.max(1, alive.length);
  const small = citiesOf(s, nid) <= 3 && citiesOf(s, nid) < avgC * 0.75;
  if (rng() > (small ? 0.5 : 0.15)) return; // 작은 나라는 외교로 버팀: 훨씬 자주 사신을 보냄
  const nb = neighbors(s, grid, nid);
  if (n.strat === 'hold' || n.strat === 'center' || n.strat === 'build' || (small && nb.some((x) => x !== n.focus && powerOf(s, x) > powerOf(s, nid) * 1.5 && !pactOf(s, nid, x)))) {
    const m = nb.filter((x) => x !== n.focus && !pactOf(s, nid, x)).sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
    if (m !== undefined && (m !== s.playerId || s.spectator || rng() < 0.3)) propose(s, nid, m, 'truce', rng); // 플레이어에게는 덜 자주 (사신 창이 쏟아지지 않게)
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
// daily=true: 하루마다 군사 판단만 (부대 명령·요격·출진). 내정·외교·집결 수송은 순 첫날에만
export function aiTurn14(s, grid, nid, scope = null, daily = false) {
  const n = s.nations[nid];
  if (!n.alive) return;
  // 전략은 군단(플레이어 나라)이 아닐 때만 고름: 1년마다, 또는 도시 수가 크게 바뀌면
  if (!scope && (!n.strat || s.turn - (n.stratAt || 0) >= 36 || Math.abs(citiesOf(s, nid) - (n.stratCities ?? 0)) >= 3)) {
    chooseStrategy(s, grid, nid);
    n.stratCities = citiesOf(s, nid);
  }
  const P = STRATS[(!scope && n.strat) || 'expand'];
  // 교착: 도시 수가 늘지 않은 지 오래되면 조금씩 과감해짐 (12순 뒤부터, 최대 20%)
  if (!scope) { const cc = citiesOf(s, nid); if (n.lastCities === undefined || cc > n.lastCities) n.stallSince = s.turn; n.lastCities = cc; }
  const rng = makeRng(`ai:${s.seed}:${s.turn}:${nid}`);
  const inScope = (c) => !scope || scope.cities.has(c.id);
  const mine = s.castles.filter((c) => c.owner === nid && inScope(c));
  const myUnits = s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : !u.corps || n.id !== s.playerId || s.spectator));
  const mark = (u) => { if (scope) u.corps = scope.corps; return u; };
  const nUnits = () => s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : true)).length;
  const focus = scope ? null : n.focus;
  // 지금 싸우는 나라: 우리가 치러 가는 나라 + 우리 성을 노리고 다가온 나라 — 두 나라 넘게 전쟁을 벌이지 않음
  const wars = new Set();
  for (const u of s.units) {
    if (u.nation === nid && u.order?.kind === 'castle') { const o = s.castles[u.order.id]?.owner; if (o !== null && o !== undefined && o !== nid) wars.add(o); }
    if (u.nation !== nid && enemy(s, nid, u.nation) && s.castles.some((c) => c.owner === nid && grid.dist(c.tile, u.tile) <= 5 * grid.k)) wars.add(u.nation);
  }
  // 군단: 남의 나라를 먹으러 가지 않고, 맡은 성을 지키고 빼앗긴 맡은 성만 되찾음
  const lost = scope ? new Set([...(scope.all || [])].filter((id) => s.castles[id] && s.castles[id].owner !== nid && enemy(s, nid, s.castles[id].owner))) : null;
  const tgt = (from, troops) => pickTarget(s, grid, nid, from, troops, P, focus, wars, lost);
  // 군단 탈환 준비: 빼앗긴 성에서 가장 가까운 맡은 성으로, 다른 맡은 성의 남는 병력을 모음
  if (scope && lost.size && mine.length > 1) {
    const L = s.castles[[...lost][0]];
    const stage = mine.slice().sort((a, b) => grid.dist(a.tile, L.tile) - grid.dist(b.tile, L.tile))[0];
    for (const c of mine) {
      if (c === stage || threatNear(s, grid, c) > 0 || (s.convoys || []).some((v) => v.from === c.id)) continue;
      const extra = Math.floor((c.troops - Math.max(3000, c.troops * 0.4)) / 1000) * 1000;
      if (extra >= 2000) sendTroops(s, grid, c.id, stage.id, extra);
    }
  }
  // 1) 이미 나간 부대: 약해지면 귀환, 목표가 없어지면 새 목표, 성벽 두꺼운 성 앞이면 공성병기
  for (const u of myUnits) {
    const home = nearestCastle(s, grid, u.tile, nid);
    if ((u.troops < u.max * 0.3 || u.morale < 25) && home) { order(s, grid, u, 'castle', home.id); continue; }
    // 가망 없는 공성은 포기: 그 성으로 가는 우리 부대를 다 합쳐도 수비가 훨씬 세거나, 잔병(1.5천 미만)뿐이면 다른 목표·귀환
    if (u.order?.kind === 'castle' && enemy(s, nid, s.castles[u.order.id].owner)) {
      const c = s.castles[u.order.id];
      const ours = s.units.filter((x) => x.nation === nid && x.order?.kind === 'castle' && x.order.id === c.id).reduce((a, x) => a + x.troops, 0);
      if (u.troops < 1500 || c.troops * (c.dur > 0 ? 1.4 : 1) > ours * 1.6) {
        const t = u.troops >= 1500 ? tgt(u.tile, u.troops) : null;
        if (t && t.id !== c.id) order(s, grid, u, 'castle', t.id);
        else if (home) order(s, grid, u, 'castle', home.id);
        continue;
      }
    }
    // 2칸 안 적 망루(완공)에 맞고 있으면 성 바로 앞에서 공성 중이 아닌 한 먼저 부숨
    const tw = (s.forts || []).find((f) => f.kind === 'tower' && !f.left && enemy(s, nid, f.owner) && grid.dist(f.tile, u.tile) <= 2);
    if (tw && u.order?.kind !== 'fort' && !(u.order?.kind === 'castle' && grid.dist(u.tile, s.castles[u.order.id].tile) <= 1)) { order(s, grid, u, 'fort', tw.id); continue; }
    if (u.order?.kind === 'fort') continue;
    const o = u.order;
    const bad = !o || (o.kind === 'castle' && !enemy(s, nid, s.castles[o.id].owner) && o.id !== home?.id) || (o.kind === 'unit' && !s.units.some((x) => x.id === o.id)) || (o.kind === 'tile' && !u.path.length);
    if (bad || !u.path.length) {
      const t = tgt(u.tile, u.troops);
      if (t) order(s, grid, u, 'castle', t.id);
      else if (home) order(s, grid, u, 'castle', home.id);
    }
    if (u.order?.kind === 'castle' && !u.siege) {
      const c = s.castles[u.order.id];
      if (c && enemy(s, nid, c.owner) && c.dur > 800 && grid.dist(u.tile, c.tile) <= 1 && n.gold > SIEGE_COST * 1.5) buildSiege(s, u.id);
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
  // 2.5) 집결: 노리는 나라의 성에 가장 가까운 우리 성(장수 있음)으로, 위협 없는 다른 성의 남는 병력을 보냄
  if (!daily && !scope && focus !== null && focus !== undefined && s.nations[focus]?.alive) {
    const fc = s.castles.filter((x) => x.owner === focus);
    const hasGen = (c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active');
    const stage = mine.filter(hasGen).map((c) => [c, Math.min(...fc.map((x) => grid.dist(x.tile, c.tile)))]).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (stage && fc.length) for (const c of mine) {
      if (c === stage || threatNear(s, grid, c) > 0 || (s.convoys || []).some((v) => v.from === c.id)) continue;
      const foeNear = s.castles.filter((x) => x.owner !== null && x.owner >= 0 && x.owner !== nid && enemy(s, nid, x.owner) && grid.dist(x.tile, c.tile) <= 8 * grid.k).reduce((a, x) => Math.max(a, x.troops), 0);
      const extra = Math.floor((c.troops - Math.max(4000, c.troops * P.reserve, foeNear * 0.6)) / 1000) * 1000;
      if (extra >= 3000 && grid.dist(c.tile, stage.tile) <= 18 * grid.k) sendTroops(s, grid, c.id, stage.id, extra);
    }
  }
  // 3) 출진: 남는 병력이 있는 성에서 노릴 성으로 (전략에 따라 남길 몫·대담함이 다름)
  const maxUnits = Math.max(2, Math.ceil(mine.length * 1.2 * P.units));
  for (const c of mine.sort((a, b) => b.troops - a.troops)) {
    if (nUnits() >= maxUnits) break;
    const foeCastle = s.castles.filter((x) => x.owner !== null && x.owner >= 0 && x.owner !== nid && enemy(s, nid, x.owner) && grid.dist(x.tile, c.tile) <= 8 * grid.k).reduce((a, x) => Math.max(a, x.troops), 0);
    const reserve = Math.max(2500, c.troops * P.reserve, foeCastle * 0.5) + threatNear(s, grid, c) * 0.8;
    const spare = c.troops - reserve;
    if (spare < 4000) continue;
    const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').sort((a, b) => b.lead + b.war - (a.lead + a.war));
    if (!gs.length) continue;
    // 속공은 장수를 셋까지 몰아 넣고, 나머지는 둘 (군단은 무력 높은 장수부터)
    if (scope) gs.sort((a, b) => b.war - a.war);
    const gids = gs.slice(0, Math.min(n.strat === 'blitz' ? 3 : 2, gs.length)).map((g) => g.id);
    const troops = Math.min(commandCap(s, gids), spare);
    const t = tgt(c.tile, troops);
    if (!t) continue;
    // 성벽이 두꺼운 성을 칠 때는 금이 넉넉하면 공성병기를 끌고 감 (속공은 더 쉽게)
    const r = sortie(s, grid, c.id, gids, troops); // 공성병기는 끌고 가지 않고 성 앞에서 만듦 (느려지지 않게)
    if (r.ok) order(s, grid, mark(r.unit), 'castle', t.id);
  }
  if (daily) return;
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
  // 포위된 성(적 부대가 바로 옆)에는 순간 이동으로 병력을 넣지 않음 — 원군은 부대·수송으로만
  const besieged = (c) => s.units.some((u) => enemy(s, nid, u.nation) && grid.dist(u.tile, c.tile) <= 1);
  const hubs = mine.filter((c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active') && !besieged(c));
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
function pickTarget(s, grid, nid, from, troops, P = STRATS.expand, focus = null, wars = null, only = null) {
  const n = s.nations[nid];
  let best = null, bv = Infinity;
  const busy = new Map(); // 나라 → 밖에 나가 있는 병력
  for (const u of s.units) busy.set(u.nation, (busy.get(u.nation) || 0) + u.troops);
  for (const c of s.castles) {
    if (!enemy(s, nid, c.owner)) continue;
    if (only && !only.has(c.id)) continue; // 군단은 맡은 성 되찾기만
    // 처음 석 달(9순)은 플레이어 도시를 먼저 노리지 않음 (작은 나라도 숨 돌릴 틈)
    if (c.owner === s.playerId && !s.spectator && s.turn <= graceOf(s)) continue;
    const neutral = c.owner === null || c.owner === -1;
    if (!neutral && focus !== null && focus !== undefined && c.owner !== focus && (n.strat === 'hold' || n.strat === 'center')) continue;
    // 이미 두 나라와 싸우는 중이면 새 나라에는 싸움을 걸지 않음 (빈 땅·싸우던 상대만)
    if (!neutral && wars && wars.size >= 2 && !wars.has(c.owner) && c.owner !== focus) continue;
    const d = grid.dist(c.tile, from);
    if (d > 20 * grid.k) continue;
    if (!neutral && frontier(s, grid, nid, c) === Infinity) continue; // 남의 나라 땅 너머 성은 노리지 않음
    const guard = c.troops + s.units.filter((u) => u.nation === c.owner && grid.dist(u.tile, c.tile) <= 3 * grid.k).reduce((a, u) => a + u.troops, 0);
    // 이미 그 성으로 가는 우리 부대와 힘을 합침
    const ours = s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === c.id).reduce((a, u) => a + u.troops, 0);
    const stall = Math.max(0, Math.min(0.35, (s.turn - (n.stallSince ?? s.turn) - 12) / 60)); // 교착이 길수록 과감해짐 (최대 35%)
    const need = (n.strat === 'blitz' ? 1.0 : n.strat === 'expand' || n.strat === 'ride' || n.strat === 'coalition' ? 1.1 : 1.25) * (1 - stall);
    if (guard * (c.dur > c.maxDur * 0.3 ? 1.5 : 1) * need > (troops + ours) * P.bold) continue; // 수비보다 넉넉히 모였을 때만
    let v = d * 1.5 / grid.k + guard / 2000 + (neutral ? -6 : 0); // 빈 땅(중립 성)을 먼저
    if (!neutral && c.owner === focus) v -= 8;
    if (!neutral && (busy.get(c.owner) || 0) > powerOf(s, c.owner) * 0.4) v -= 3;
    if (v < bv) { bv = v; best = c; }
  }
  return best;
}

// 매일: 컴퓨터 나라의 쉬는 부대에게 바로 다음 명령 (순 첫날까지 멍하니 기다리지 않게)
export function aiIdle(s, grid) {
  for (const u of s.units) {
    if (u.dead || u.path.length || u.order?.kind === 'fort') continue;
    const n = s.nations[u.nation];
    if (!n?.alive || (u.nation === s.playerId && !s.spectator)) continue; // 플레이어 부대(군단 제외)는 건드리지 않음
    if (u.order?.kind === 'castle' && enemy(s, u.nation, s.castles[u.order.id]?.owner) && grid.dist(u.tile, s.castles[u.order.id].tile) <= 1) continue; // 공성 중
    const home = nearestCastle(s, grid, u.tile, u.nation);
    if ((u.troops < u.max * 0.3 || u.morale < 25) && home) { order(s, grid, u, 'castle', home.id); continue; }
    const wars = new Set();
    for (const x of s.units) if (x.nation === u.nation && x.order?.kind === 'castle') { const o = s.castles[x.order.id]?.owner; if (o !== null && o !== undefined && o >= 0 && o !== u.nation) wars.add(o); }
    const t = pickTarget(s, grid, u.nation, u.tile, u.troops, STRATS[n.strat || 'expand'], n.focus ?? null, wars, null);
    if (t) order(s, grid, u, 'castle', t.id);
    else if (home) order(s, grid, u, 'castle', home.id);
  }
}

export { gensOf };
