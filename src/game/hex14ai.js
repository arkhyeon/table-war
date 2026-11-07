// ───────── 삼국지14식 모드: 컴퓨터 나라 (전략 고르기·출진·공성·요격·귀환) ─────────
import { foodUse, powerOf, trade, pactOf, propose, acceptChance, renewPact, hegemonOf, bordering } from './hex14gov.js';
import { aiBuild, aiForts } from './hex14build.js';
import { aiPolicy } from './hex14policy.js';
import { lordOf } from './hex14vassal.js';
import { aiPeople } from './hex14people.js';
import { makeRng } from './rng.js';
import { sortie, order, nearestCastle, commandCap, gensOf, draft14, draftMax14, enemy, buildSiege, SIEGE_COST, sendTroops, summonGeneral, roomOf, draftCost, mercMax14, mercCost, hireMerc14 } from './hex14.js';

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
// 성마다 다른 성들을 가까운 순으로 한 번만 정렬해 둠 (성 자리는 안 움직임, 새 도시가 생기면 다시)
const nearCache = new WeakMap();
function nearList(s, grid) {
  let L = nearCache.get(grid);
  if (L && L.n === s.castles.length) return L;
  const cs = s.castles, n = cs.length, ids = [], ds = [];
  for (let i = 0; i < n; i++) {
    const arr = [];
    for (let j = 0; j < n; j++) if (j !== i) arr.push([j, grid.dist(cs[i].tile, cs[j].tile)]);
    arr.sort((a, b) => a[1] - b[1]);
    ids.push(Int16Array.from(arr, (x) => x[0])); ds.push(Int16Array.from(arr, (x) => x[1]));
  }
  L = { n, ids, ds };
  nearCache.set(grid, L);
  return L;
}
// 미리 데워 두기: 처음 지도를 그리는 동안(로딩 화면) 성 거리 목록을 만들어 둠 (첫 순에 멈칫하지 않게)
export const warmAI = (s, grid) => { nearList(s, grid); };
// 그 성에서 r칸 안 적 성 가운데 가장 센 수비병 (가까운 순 목록을 따라가다 r을 넘으면 멈춤)
function foeCastleNear(s, grid, nid, c, r) {
  const L = nearList(s, grid), ids = L.ids[c.id], ds = L.ds[c.id];
  let m = 0;
  for (let k = 0; k < ids.length && ds[k] <= r; k++) { const x = s.castles[ids[k]]; if (x.owner !== null && x.owner >= 0 && x.owner !== nid && enemy(s, nid, x.owner)) m = Math.max(m, x.troops); }
  return m;
}
export function frontier(s, grid, nid, c) {
  // 가까운 순으로 보다가 우리 성을 만나면 끝 (예전엔 부를 때마다 모든 성을 훑었음)
  const L = nearList(s, grid), ids = L.ids[c.id], ds = L.ds[c.id], lim = 2 * grid.k;
  if (!ids) return frontierSlow(s, grid, nid, c);
  let otherD = Infinity;
  for (let k = 0; k < ids.length; k++) {
    const x = s.castles[ids[k]], d = ds[k];
    if (d > otherD + lim) return Infinity;
    if (x.owner === c.owner) continue;
    if (x.owner === nid) return d;
    if (otherD === Infinity && x.owner !== null && x.owner >= 0 && s.nations[x.owner]?.alive) otherD = d;
  }
  return Infinity;
}
export function frontierSlow(s, grid, nid, c) {
  let mineD = Infinity, otherD = Infinity;
  for (const x of s.castles) {
    if (x === c || x.owner === c.owner) continue;
    const d = grid.dist(x.tile, c.tile);
    if (x.owner === nid) mineD = Math.min(mineD, d);
    else if (x.owner !== null && x.owner >= 0 && s.nations[x.owner]?.alive) otherD = Math.min(otherD, d);
  }
  return mineD <= otherD + 2 * grid.k ? mineD : Infinity;
}
// 하루 안에서는 같은 답이라 한 번만 계산 (세계 지도는 성이 많아 무거움)
const nbCache = new WeakMap();
function neighbors(s, grid, nid) {
  const key = `${s.turn}:${s.day}`;
  let m = nbCache.get(s);
  if (!m || m.key !== key) nbCache.set(s, (m = { key, v: new Map() }));
  if (!m.v.has(nid)) m.v.set(nid, neighbors0(s, grid, nid));
  return m.v.get(nid);
}
function neighbors0(s, grid, nid) {
  const d = new Map();
  // 우리 성에서 14칸 안의 남의 성만 후보 (국경 판정은 우리 성까지 거리가 14칸 넘으면 어차피 안 됨) — 성 번호 순서는 그대로
  const L = nearList(s, grid), lim = 14 * grid.k, cand = new Set();
  for (const m of s.castles) if (m.owner === nid) { const ids = L.ids[m.id], ds = L.ds[m.id]; if (!ids) { for (const c of s.castles) cand.add(c.id); break; } for (let k = 0; k < ids.length && ds[k] <= lim; k++) cand.add(ids[k]); }
  for (const c of [...cand].sort((a, b) => a - b).map((i) => s.castles[i])) {
    if (c.owner === null || c.owner === nid || !s.nations[c.owner]?.alive) continue;
    const m = frontier(s, grid, nid, c);
    if (m <= 14 * grid.k && (!d.has(c.owner) || m < d.get(c.owner))) d.set(c.owner, m);
  }
  return [...d.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}
// 나라별 도시 수: 자주 불려서 같은 상태·같은 날이면 한 번만 셈 (성 주인이 바뀌면 다시)
let cityMemo = null;
const citiesOf = (s, nid) => {
  const key = `${s.turn}:${s.day}:${s.castles.length}`; // 컴퓨터가 생각하는 동안엔 성 주인이 안 바뀜 (함락은 하루 진행 중에만)
  if (!cityMemo || cityMemo.s !== s || cityMemo.key !== key) { const m = new Map(); for (const c of s.castles) if (c.kind !== 'pass' && c.owner !== null) m.set(c.owner, (m.get(c.owner) || 0) + 1); cityMemo = { s, key, m }; }
  return cityMemo.m.get(nid) || 0;
};

export function chooseStrategy(s, grid, nid) {
  const n = s.nations[nid];
  const rng = makeRng(`strat:${s.seed}:${nid}:${Math.floor(s.turn / 36)}:${n.stratN || 0}`);
  const alive = s.nations.filter((m) => m.alive && !m.horde);
  const total = s.castles.filter((c) => c.kind !== 'pass').length || 1;
  const cnt0 = new Map(alive.map((m) => [m.id, [citiesOf(s, m.id), powerOf(s, m.id)]])); // 정렬 비교마다 다시 세지 않게
  const ranked = alive.slice().sort((a, b) => cnt0.get(b.id)[0] - cnt0.get(a.id)[0] || cnt0.get(b.id)[1] - cnt0.get(a.id)[1]);
  const top = ranked[0], mineN = citiesOf(s, nid);
  const nb = neighbors(s, grid, nid);
  const topShare = citiesOf(s, top.id) / total;
  // 노릴 나라: 이미 둘 넘게 노리는 나라는 피함 (모두가 한 나라만 물어뜯지 않게)
  const hunted = (x) => s.nations.filter((m) => m.alive && m.id !== nid && m.focus === x).length;
  const free = nb.filter((x) => hunted(x) < 3 && !pactOf(s, nid, x) && !(x === s.playerId && !s.spectator && s.turn <= graceOf(s)));
  const pool = free.length ? free : nb.filter((x) => !pactOf(s, nid, x)).length ? nb.filter((x) => !pactOf(s, nid, x)) : nb;
  // 얻어맞고 있는 나라는 더 약해 보임: 다른 나라 부대가 그 나라 성을 치고 있으면 같이 침 (사람이라면 그 틈을 노림)
  const press = (x) => s.units.reduce((a, u) => a + (u.nation !== nid && u.nation !== x && u.order?.kind === 'castle' && s.castles[u.order.id]?.owner === x ? u.troops : 0), 0);
  const soft = (x) => powerOf(s, x) / (1 + press(x) / Math.max(1, powerOf(s, x)));
  const weakest = pool.slice().sort((a, b) => soft(a) - soft(b))[0];
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


// 싸움터에 보낼 장수: 무력·통솔 위주로 고르고, 성에는 정치 가장 높은 장수 한 명을 남겨 내정을 맡김
// 성별 장수 목록: 컴퓨터 한 나라가 생각할 때마다 한 번만 만듦 (성마다 장수 전체를 훑지 않게). 꺼낼 때 지금 상태로 다시 걸러 냄
let genIdx = null;
const indexGenerals = (s) => { if (genIdx && genIdx.s === s && genIdx.k === `${s.turn}:${s.day}`) return; const m = new Map(); for (const g of Object.values(s.generals)) if (g.castle !== null && g.castle !== undefined) { if (!m.has(g.castle)) m.set(g.castle, []); m.get(g.castle).push(g); } genIdx = { s, m, k: `${s.turn}:${s.day}` }; };
export function fighters(s, c) {
  const pool = genIdx && genIdx.s === s ? genIdx.m.get(c.id) || [] : Object.values(s.generals);
  const gs = pool.filter((g) => g.castle === c.id && g.status === 'active');
  if (gs.length <= 1) return gs;
  const keeper = gs.slice().sort((a, b) => b.pol - a.pol)[0];
  return gs.filter((g) => g !== keeper || g.war + g.lead >= 170).sort((a, b) => b.war * 1.2 + b.lead - b.pol * 0.3 - (a.war * 1.2 + a.lead - a.pol * 0.3));
}

// 성 주변 위협: 6칸 안 적 부대 병력 합
// 같은 날 같은 성은 같은 답 (컴퓨터가 생각하는 동안엔 부대가 움직이지 않음) → 기억해 둠
let threatMemo = null;
function threatNear(s, grid, c) {
  const k = `${s.turn}:${s.day}:${s.units.length}`;
  if (!threatMemo || threatMemo.s !== s || threatMemo.k !== k) threatMemo = { s, k, m: new Map() };
  const key = c.id * 64 + (c.owner + 1);
  const hit = threatMemo.m.get(key);
  if (hit !== undefined) return hit;
  const v = threatNear0(s, grid, c);
  threatMemo.m.set(key, v);
  return v;
}
function threatNear0(s, grid, c) {
  let t = 0;
  for (const u of s.units) if (enemy(s, c.owner, u.nation) && grid.dist(u.tile, c.tile) <= 6 * grid.k) t += u.troops;
  return t;
}

// 전략에 맞는 외교: 수성·사방 방어는 노리지 않는 이웃과 정전, 반패권은 다른 나라와 동맹
function strategyDiplomacy(s, grid, nid, rng) {
  const n = s.nations[nid];
  // 약조 연장: 끝나기 3순 전, 노리는 나라가 아니고 우리만큼 센 상대면 연장을 청함 (만료되자마자 대국과 전면전이 나지 않게)
  for (const p of (s.pacts || []).filter((x) => x.type !== 'vassal' && (x.a === nid || x.b === nid) && x.until - s.turn <= 3 && x.until > s.turn)) {
    const o = p.a === nid ? p.b : p.a;
    if (o === n.focus || o === s.playerId && !s.spectator || p.renewAsked === s.turn || o === hegemonOf(s)) continue;
    if (powerOf(s, o) < powerOf(s, nid) * 0.8) continue;
    // 크게 앞선 1등(도시 35% 이상)은 연장하지 않음 — 정전을 이어 가기만 하다 칠 상대가 없어지면 맞수에게 뒤집힘 (직접 플레이에서 확인)
    if (citiesOf(s, nid) >= s.castles.filter((c) => c.kind !== 'pass').length * 0.35) continue;
    p.renewAsked = s.turn;
    renewPact(s, nid, o, rng);
  }
  const alive = s.nations.filter((m) => m.alive && !m.horde);
  const avgC = alive.reduce((a, m) => a + citiesOf(s, m.id), 0) / Math.max(1, alive.length);
  const small = citiesOf(s, nid) <= 3 && citiesOf(s, nid) < avgC * 0.75;
  // 한 전선에 힘을 모음: 노리는 나라 말고도 약조 없는 이웃이 남으면, 그중 가장 센 나라와 정전 (등 뒤를 막고 반대편을 뚫음, 패권국은 빼고)
  {
    const nb0 = neighbors(s, grid, nid), heg = hegemonOf(s);
    const open = nb0.filter((x) => x !== n.focus && x !== heg && !pactOf(s, nid, x) && !s.nations[x]?.outlaw);
    if (open.length && nb0.filter((x) => !pactOf(s, nid, x)).length >= 2 && rng() < 0.35) {
      const m = open.sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
      if (m !== s.playerId || s.spectator || rng() < 0.3) propose(s, nid, m, 'truce', rng);
    }
  }
  if (rng() > (small ? 0.25 : 0.1)) return; // 외교는 가끔 — 싸워서 넓히는 게 먼저
  const nb = neighbors(s, grid, nid);
  if (n.strat === 'hold' || n.strat === 'center' || n.strat === 'build' || (small && nb.some((x) => x !== n.focus && powerOf(s, x) > powerOf(s, nid) * 1.5 && !pactOf(s, nid, x)))) {
    const m = nb.filter((x) => x !== n.focus && !pactOf(s, nid, x)).sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
    if (m !== undefined && (m !== s.playerId || s.spectator || rng() < 0.3)) propose(s, nid, m, 'truce', rng); // 플레이어에게는 덜 자주 (사신 창이 쏟아지지 않게)
  } else if (n.strat === 'ride') {
    // 가장 강한 이웃(노리는 나라 말고)에게 동맹을 청함
    const m = nb.filter((x) => x !== n.focus && !pactOf(s, nid, x)).sort((a, b) => powerOf(s, b) - powerOf(s, a))[0];
    if (m !== undefined) propose(s, nid, m, 'ally', rng);
  } else if (n.strat === 'coalition' && n.focus !== null) {
    const cand = s.nations.filter((m) => m.alive && !m.horde && m.id !== nid && m.id !== n.focus && !pactOf(s, nid, m.id) && enemy(s, m.id, n.focus) && bordering(s, grid, m.id, n.focus)); // 같은 적과 맞닿은 나라만
    if (cand.length) propose(s, nid, rng.pick(cand).id, 'ally', rng);
  }
}

// scope가 있으면 군단: 그 도시들과 그 군단 부대만 움직임 (플레이어가 맡긴 군단)
// daily=true: 하루마다 군사 판단만 (부대 명령·요격·출진). 내정·외교·집결 수송은 순 첫날에만
export function aiTurn14(s, grid, nid, scope = null, daily = false) {
  const n = s.nations[nid];
  if (!n.alive) return;
  indexGenerals(s);
  // 전략은 군단(플레이어 나라)이 아닐 때만 고름: 1년마다, 또는 도시 수가 크게 바뀌면
  if (!daily && !scope && s.turn % 6 === 0) {
    const heg = hegemonOf(s);
    // 한꺼번에 몰려오지 않게: 확인할 때마다 절반만, 이미 두 나라와 싸우는 나라는 끼지 않음
    const busyWars = new Set(s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle').map((u) => s.castles[u.order.id]?.owner).filter((o) => o !== null && o !== undefined && o >= 0 && o !== nid && o !== heg)).size;
    if (heg !== null && heg !== nid && n.focus !== heg && lordOf(s, nid) !== heg && busyWars < 2 && makeRng(`heg:${s.seed}:${s.turn}:${nid}`)() < 0.5 && neighbors(s, grid, nid).includes(heg)) { n.strat = 'coalition'; n.focus = heg; n.stratAt = s.turn; n.stratCities = citiesOf(s, nid); }
  }
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
  const ownCs = s.castles.filter((c) => c.owner === nid); // 우리 성만 (예전엔 부대마다 모든 성을 훑었음)
  for (const u of s.units) {
    if (u.nation === nid && u.order?.kind === 'castle') { const o = s.castles[u.order.id]?.owner; if (o !== null && o !== undefined && o !== nid) wars.add(o); }
    if (u.nation !== nid && !wars.has(u.nation) && enemy(s, nid, u.nation) && ownCs.some((c) => grid.dist(c.tile, u.tile) <= 5 * grid.k)) wars.add(u.nation);
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
    if (u.routed) continue; // 패주 중인 부대는 그대로 물러나게 둠
    const home = nearestCastle(s, grid, u.tile, nid);
    if ((u.troops < u.max * 0.3 || u.morale < 25) && home) { order(s, grid, u, 'castle', home.id); continue; }
    // 가망 없는 공성은 포기: 그 성으로 가는 우리 부대를 다 합쳐도 수비가 훨씬 세거나, 잔병(1.5천 미만)뿐이면 다른 목표·귀환
    if (u.order?.kind === 'castle' && enemy(s, nid, s.castles[u.order.id].owner)) {
      const c = s.castles[u.order.id];
      const ours = s.units.filter((x) => x.nation === nid && x.order?.kind === 'castle' && x.order.id === c.id).reduce((a, x) => a + x.troops, 0);
      if (u.troops < 1500) { // 한번 나섰으면 잔병이 될 때까지 밀어붙임 (수비가 늘었다고 내빼지 않음)
        const t = u.troops >= 1500 ? tgt(u.tile, u.troops) : null;
        if (t && t.id !== c.id) order(s, grid, u, 'castle', t.id);
        else if (home) order(s, grid, u, 'castle', home.id);
        continue;
      }
    }
    // 훨씬 센 적 부대가 우리 부대를 노리고 다가오면(공성 중이 아니면) 들판에서 지지 않게 가까운 우리 성으로 물러남
    const besieging = u.order?.kind === 'castle' && grid.dist(u.tile, s.castles[u.order.id].tile) <= 1;
    if (!besieging && home) {
      const hunter = s.units.find((x) => enemy(s, nid, x.nation) && x.order?.kind === 'unit' && x.order.id === u.id && x.troops > u.troops * 1.6 && grid.dist(x.tile, u.tile) <= 4 * grid.k);
      if (hunter && grid.dist(home.tile, u.tile) < grid.dist(hunter.tile, u.tile) * 2.5) { order(s, grid, u, 'castle', home.id); continue; }
    }
    // 가는 길에 목표 성 수비가 크게 불어나면(원군·수송) 무리하지 않고 다른 목표로 (성 앞에서 이미 포위 중이면 끝까지)
    if (!besieging && home && u.order?.kind === 'castle' && enemy(s, nid, s.castles[u.order.id].owner) && !u.harass) {
      const c = s.castles[u.order.id];
      const guard = c.troops + s.units.filter((x) => x.nation === c.owner && grid.dist(x.tile, c.tile) <= 3 * grid.k).reduce((a, x) => a + x.troops, 0);
      const ours = s.units.filter((x) => x.nation === nid && x.order?.kind === 'castle' && x.order.id === c.id).reduce((a, x) => a + x.troops, 0);
      if (guard * (c.dur > c.maxDur * 0.3 ? 1.5 : 1) > ours * 2.2) {
        const t = tgt(u.tile, u.troops);
        if (t && t.id !== c.id) { order(s, grid, u, 'castle', t.id); continue; }
        if (grid.dist(u.tile, c.tile) > 3 * grid.k) { order(s, grid, u, 'castle', home.id); continue; }
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
    const gs = fighters(s, c);
    if (!gs.length || c.troops < foe.troops * (foe.siege ? 0.9 : 1.3) + 2000) continue;
    const r = sortie(s, grid, c.id, [gs[0].id], Math.min(commandCap(s, [gs[0].id]), c.troops - 2000));
    if (r.ok) order(s, grid, mark(r.unit), 'unit', foe.id);
  }
  // 2.1) 증원: 적 부대가 우리 성을 노리고 오는데 수비가 모자라면, 포위되기 전에 가까운 안전한 성에서 병력을 미리 보냄
  for (const c of mine) {
    const coming = s.units.filter((u) => enemy(s, nid, u.nation) && u.order?.kind === 'castle' && u.order.id === c.id && grid.dist(u.tile, c.tile) <= 8 * grid.k).reduce((a, u) => a + u.troops, 0);
    if (!coming) continue;
    const inbound = (s.convoys || []).filter((v) => v.to === c.id).reduce((a, v) => a + v.troops, 0);
    const lack = coming * 0.7 - (c.troops + inbound) * (c.dur > c.maxDur * 0.3 ? 1.5 : 1);
    if (lack <= 0 || s.units.some((u) => enemy(s, nid, u.nation) && grid.dist(u.tile, c.tile) <= 1)) continue;
    let need = Math.ceil(lack / 1000) * 1000;
    const donors = mine.filter((d) => d !== c && threatNear(s, grid, d) === 0 && grid.dist(d.tile, c.tile) <= 10 * grid.k).sort((a, b) => grid.dist(a.tile, c.tile) - grid.dist(b.tile, c.tile));
    for (const d of donors) {
      if (need < 1000) break;
      const give = Math.floor(Math.min(need, d.troops - Math.max(4000, d.troops * 0.55)) / 1000) * 1000;
      if (give >= 1000 && sendTroops(s, grid, d.id, c.id, give).ok) need -= give;
    }
  }
  // 2.2) 구원: 포위된 성(적 부대가 바로 옆)은 수송대가 못 들어가니, 가까운 우리 성 중 병력 많은 곳에서 장수가 부대를 이끌고 포위군을 침
  for (const c of mine) {
    const sieger = s.units.filter((u) => enemy(s, nid, u.nation) && grid.dist(u.tile, c.tile) <= 1).sort((a, b) => b.troops - a.troops)[0];
    if (!sieger || s.units.some((u) => u.nation === nid && u.order?.kind === 'unit' && u.order.id === sieger.id)) continue;
    const from = mine.filter((d) => d !== c && threatNear(s, grid, d) === 0 && grid.dist(d.tile, c.tile) <= 14 * grid.k && Object.values(s.generals).some((g) => g.castle === d.id && g.status === 'active')).sort((a, b) => b.troops - a.troops)[0];
    if (!from) continue;
    const gs = fighters(s, from).slice(0, 3).map((g) => g.id);
    const amt = Math.floor(Math.min(commandCap(s, gs), from.troops - 3000) / 1000) * 1000;
    if (amt < sieger.troops * 1.2) continue;
    const r = sortie(s, grid, from.id, gs, amt);
    if (r.ok) order(s, grid, mark(r.unit), 'unit', sieger.id);
  }
  // 2.5) 집결: 노리는 나라의 성에 가장 가까운 우리 성(장수 있음)으로, 위협 없는 다른 성의 남는 병력을 보냄
  // 노릴 나라가 없는 전략(확장·내실)도 병력을 흩어 두지 않게: 가장 약한 맞닿은 이웃 쪽으로 모음
  const stageFocus = focus ?? neighbors(s, grid, nid).filter((x) => !pactOf(s, nid, x)).sort((a, b) => powerOf(s, a) - powerOf(s, b))[0] ?? null;
  if (!daily && !scope && stageFocus !== null && stageFocus !== undefined && s.nations[stageFocus]?.alive) {
    const fc = s.castles.filter((x) => x.owner === stageFocus);
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
  const maxUnits = Math.max(3, Math.ceil(mine.length * 1.6 * P.units));
  for (const c of mine.sort((a, b) => b.troops - a.troops)) {
    if (nUnits() >= maxUnits) break;
    const foeCastle = foeCastleNear(s, grid, nid, c, 8 * grid.k);
    const reserve = Math.max(2500, c.troops * P.reserve * 0.8, foeCastle * 0.3) + threatNear(s, grid, c) * 0.7;
    const spare = c.troops - reserve;
    if (spare < 4000) continue;
    const gs = fighters(s, c);
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
  // 3.5) 합동 공격: 성 하나의 병력으론 모자라도, 가까운 여러 성의 남는 병력을 합쳐 넉넉하면 같은 날 함께 출진해 한 성을 침
  //      (수비 3만 성은 부대 하나로는 못 치니, 혼자 기준을 넘어야 출발하던 방식으론 대국끼리 영영 교착됨)
  if (!scope && nUnits() < maxUnits) {
    const ready = [];
    for (const c of mine) {
      if (threatNear(s, grid, c) > 0) continue;
      const gs = fighters(s, c);
      if (!gs.length) continue;
      const foeCastle = foeCastleNear(s, grid, nid, c, 8 * grid.k);
      const spare = Math.floor((c.troops - Math.max(2500, c.troops * P.reserve * 0.8, foeCastle * 0.4)) / 1000) * 1000;
      const gids = gs.slice(0, Math.min(3, gs.length)).map((g) => g.id);
      const troops = Math.min(commandCap(s, gids), spare);
      if (troops >= 5000) ready.push({ c, gids, troops });
    }
    if (ready.length >= 2) {
      const stall = Math.max(0, Math.min(0.35, (s.turn - (n.stallSince ?? s.turn) - 12) / 60));
      const need = 1.2 * (1 - stall);
      const cands = s.castles.filter((x) => x.kind !== 'pass' && x.owner !== null && x.owner >= 0 && x.owner !== nid && enemy(s, nid, x.owner) && frontier(s, grid, nid, x) <= 12 * grid.k)
        .filter((x) => !(x.owner === s.playerId && !s.spectator && s.turn <= graceOf(s)) && (wars.size < 3 || wars.has(x.owner) || x.owner === focus))
        .sort((a, b) => (b.owner === focus) - (a.owner === focus) || a.troops - b.troops);
      for (const x of cands.slice(0, 4)) {
        const guard = (x.troops + s.units.filter((u) => u.nation === x.owner && grid.dist(u.tile, x.tile) <= 3 * grid.k).reduce((a, u) => a + u.troops, 0)) * (x.dur > x.maxDur * 0.3 ? 1.5 : 1);
        const near = ready.filter((r) => grid.dist(r.c.tile, x.tile) <= 12 * grid.k).sort((a, b) => grid.dist(a.c.tile, x.tile) - grid.dist(b.c.tile, x.tile)).slice(0, 3);
        const ours = s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === x.id).reduce((a, u) => a + u.troops, 0);
        if (near.length < 2 || near.reduce((a, r) => a + r.troops, 0) + ours < guard * need) continue;
        for (const r of near) { const o = sortie(s, grid, r.c.id, r.gids, r.troops); if (o.ok) order(s, grid, mark(o.unit), 'castle', x.id); }
        break;
      }
    }
  }
  // 3.6) 갉아먹기: 노리는 나라보다 1.8배 넘게 세면, 한 번에 못 빼앗더라도 그 나라 국경 성 두 곳을 동시에 포위해 수비병을 깎음
  //      (병력을 쌓아 두기만 하지 않고 압박 — 공성병기는 성 앞에서 만들고, 병력이 30% 아래로 떨어지면 돌아옴)
  if (!scope && focus !== null && focus !== undefined && s.nations[focus]?.alive && powerOf(s, nid) >= powerOf(s, focus) * 1.8 && nUnits() < maxUnits * 1.5) {
    const targets = s.castles.filter((x) => x.owner === focus && frontier(s, grid, nid, x) <= 12 * grid.k && !s.units.some((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === x.id)).sort((a, b) => a.troops - b.troops).slice(0, 2);
    for (const x of targets) {
      const from = mine.filter((c) => threatNear(s, grid, c) === 0 && fighters(s, c).length && grid.dist(c.tile, x.tile) <= 12 * grid.k).sort((a, b) => b.troops - a.troops)[0];
      if (!from) continue;
      const gids = fighters(s, from).slice(0, 2).map((g) => g.id);
      const amt = Math.floor(Math.min(commandCap(s, gids), from.troops - Math.max(3000, from.troops * 0.3)) / 1000) * 1000;
      if (amt < Math.max(6000, x.troops * 0.8)) continue;
      const r = sortie(s, grid, from.id, gids, amt);
      if (r.ok) { r.unit.harass = true; order(s, grid, mark(r.unit), 'castle', x.id); }
    }
  }
  if (daily) return;
  // 4) 시장: 병량이 3년 치 넘게 쌓이고 금이 모자라면 팔고, 금이 넘치는데 병량이 모자라면 삼
  if (!scope) {
    const use = Math.max(1000, foodUse(s, nid));
    if (n.food > use * 108 && n.gold < 60000) trade(s, nid, 'sell', Math.round((n.food - use * 72) / 1000) * 1000);
    else if (n.gold > 150000 && n.food < use * 40) trade(s, nid, 'buy', Math.round((n.gold - 100000) / 2 / 1000) * 1000);
  }
  // 5) 시설 먼저(시장·성벽), 남는 금은 팍팍 징병: 녹봉 몇 순 치만 남기고 장수 있는 성(위협받는 곳 먼저)에 뽑아 둠 — 출진 비용이 없으니 쌓아 둘 까닭이 없음
  //    인구가 너무 줄어든 성(20 아래)은 위협받을 때만 뽑음 (인구가 곧 자원병·금 수입)
  const gensN = Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active').length;
  const floor = scope ? 200000 : Math.max(8000, gensN * 600);
  // 남는 금의 몫: 싸우는 중이면 85%, 아니면 65%를 징병에, 나머지로 시장·성벽
  const share = wars.size || mine.some((c) => threatNear(s, grid, c) > 0) ? 0.85 : n.strat === 'build' ? 0.45 : 0.65;
  if (n.gold > floor && n.food > foodUse(s, nid) * 20) {
    const budget = (n.gold - floor) * (scope ? 1 : share);
    const hub = mine.filter((c) => c.kind !== 'pass' && Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active') && (c.pop >= 20 || threatNear(s, grid, c) > 0)).sort((a, b) => threatNear(s, grid, b) - threatNear(s, grid, a));
    const k = Math.max(1, Math.min(6, hub.length));
    for (const c of hub.slice(0, 6)) { const per = Math.floor(budget / draftCost(c, s) / k / 100) * 100; const m = Math.min(draftMax14(s, c), per); if (m >= 500) draft14(s, c.id, m); }
    // 인구를 다 뽑았는데도 금이 넉넉하면(예비의 3배 넘게) 용병으로 — 쌓아 두지 않고 병사로 바꿈
    if (n.gold > floor * 3) { const b2 = (n.gold - floor * 2) * (scope ? 1 : share); for (const c of hub.slice(0, 6)) { const m = Math.min(mercMax14(s, c), Math.floor(b2 / mercCost(c, s) / k / 1000) * 1000); if (m >= 1000) hireMerc14(s, c.id, m); } }
  }
  if (!scope && !daily) aiBuild(s, grid, nid, (c) => threatNear(s, grid, c), floor, 2);
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
    const mv = Math.min(extra, roomOf(to[0], s));
    if (mv < 1000) continue;
    c.troops -= mv;
    to[0].troops += Math.round(mv * 0.95);
  }
  // 시설·외교 (군단이 아닐 때만)
  if (!scope) {
    const threat = (c) => threatNear(s, grid, c);
    aiForts(s, grid, nid, threat);
    aiPolicy(s, nid, mine.some((c) => threat(c) > 0), n.food < foodUse(s, nid) * 12);
    aiPeople(s, grid, nid, makeRng(`aip:${s.seed}:${s.turn}:${nid}`));
    strategyDiplomacy(s, grid, nid, rng);
  }
  // 6) 장수 재배치: 장수 없는 성에 남는 장수를 보냄 (입성 명령 대신 즉시 이동: 같은 나라 성끼리)
  // 장수도 플레이어처럼 걸어서 감 (병력 1천을 데리고) — 순마다 2명까지, 국경 성부터
  const hasG = (c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active');
  const incoming = (c) => s.units.some((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === c.id);
  const empty = mine.filter((c) => c.kind !== 'pass' && !hasG(c) && !incoming(c)).sort((a, b) => threatNear(s, grid, b) - threatNear(s, grid, a));
  let sent = 0;
  for (const c of empty) {
    if (sent >= 2) break;
    const donor = mine.filter((d) => Object.values(s.generals).filter((g) => g.castle === d.id && g.status === 'active').length >= 3 && d.troops > 4000).sort((a, b) => grid.dist(a.tile, c.tile) - grid.dist(b.tile, c.tile))[0];
    if (!donor) break;
    const g = Object.values(s.generals).filter((x) => x.castle === donor.id && x.status === 'active').sort((a, b) => a.lead - b.lead)[0];
    if (summonGeneral(s, grid, g.id, c.id, 1000).ok) sent++;
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
    if (!neutral && wars && wars.size >= 3 && !wars.has(c.owner) && c.owner !== focus) continue;
    const d = grid.dist(c.tile, from);
    if (d > 20 * grid.k) continue;
    if (!neutral && frontier(s, grid, nid, c) === Infinity) continue; // 남의 나라 땅 너머 성은 노리지 않음
    const guard = c.troops + s.units.filter((u) => u.nation === c.owner && grid.dist(u.tile, c.tile) <= 3 * grid.k).reduce((a, u) => a + u.troops, 0);
    // 이미 그 성으로 가는 우리 부대와 힘을 합침
    const ours = s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === c.id).reduce((a, u) => a + u.troops, 0);
    const stall = Math.max(0, Math.min(0.35, (s.turn - (n.stallSince ?? s.turn) - 12) / 60)); // 교착이 길수록 과감해짐 (최대 35%)
    const need = (n.strat === 'blitz' ? 0.85 : n.strat === 'expand' || n.strat === 'ride' || n.strat === 'coalition' ? 0.95 : 1.05) * (1 - stall); // 적당히 이길 만하면 친다
    if (guard * (c.dur > c.maxDur * 0.3 ? 1.5 : 1) * need > (troops + ours) * P.bold) continue; // 수비보다 넉넉히 모였을 때만
    let v = d * 1.5 / grid.k + guard / 2000 + (neutral ? -6 : 0); // 빈 땅(중립 성)을 먼저
    if (!neutral && c.owner === focus) v -= 8;
    if (!neutral && c.capitalOf === c.owner) v -= 3; // 수도: 빼앗으면 그 나라가 흔들림
    if (c.kind === 'pass') v += 3; // 관문은 성보다 덜 중요
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
    if (!n?.alive || (u.nation === s.playerId && !s.spectator && !u.corps)) continue; // 플레이어 부대(군단 제외)는 건드리지 않음
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
