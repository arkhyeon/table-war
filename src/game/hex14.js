// ───────── 삼국지14식 모드: 육각형 칸 위에서 부대가 움직이며 땅을 칠하고, 성을 빼앗는 전쟁 ─────────
// 지도는 기존 세계(world)의 촘촘한 격자를 굵은 육각 칸으로 다시 뽑아 씀 (칸 = 약 2.5천 개)
// 한 턴 = 10일. 모든 부대가 하루씩 동시에 움직이고(통제 구역·칠하기), 붙어 있으면 싸우고(협공), 성을 공격함
import { SQRT3, cellCenter, pixelToCell, hexDistance, neighborIndex } from './hex.js';
import { T } from './rules.js';
import { makeRng } from './rng.js';
import { fmtTroops, fmtGold } from './format.js';
import { POOLS } from './generals.js';

export const DAYS = 10;
const G = 2500;
// 지형별 이동 비용(이동력 1 = 하루에 평지 1칸)과 수비 보정
const COST = { [T.PLAINS]: 1, [T.DESERT]: 1.3, [T.TUNDRA]: 1.3, [T.FOREST]: 1.6, [T.HILLS]: 1.6, [T.MOUNTAIN]: 2.5 };
const DEF = { [T.PLAINS]: 1, [T.DESERT]: 1, [T.TUNDRA]: 1, [T.FOREST]: 1.15, [T.HILLS]: 1.25, [T.MOUNTAIN]: 1.35 };
export const TERRAIN_NAME = { [T.PLAINS]: '평지', [T.DESERT]: '사막', [T.TUNDRA]: '동토', [T.FOREST]: '숲', [T.HILLS]: '구릉', [T.MOUNTAIN]: '산지' };

// ── 칸 지도 (저장하지 않고 world에서 매번 만듦) ──
export function buildGrid(world) {
  const size = world.unit; // 굵은 칸 크기
  const cols = Math.ceil(world.W / (size * SQRT3)), rows = Math.ceil((world.H - size) / (1.5 * size)) + 1;
  const N = cols * rows;
  const terrain = new Uint8Array(N), region = new Int16Array(N).fill(-1), river = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y] = cellCenter(size, cols, i);
    const f = pixelToCell(world.size, world.cols, world.rows, x, y);
    if (f < 0) continue;
    terrain[i] = world.terrain[f];
    river[i] = world.river[f] ? 1 : 0;
    const r = world.region[f];
    if (r >= 0 && !world.regions[r].sea && terrain[i] !== T.SEA && terrain[i] !== T.PEAK) region[i] = r;
  }
  const nb = [];
  for (let i = 0; i < N; i++) {
    const list = [];
    for (let d = 0; d < 6; d++) { const j = neighborIndex(cols, rows, i, d); if (j >= 0) list.push(j); }
    nb.push(list);
  }
  const center = (i) => cellCenter(size, cols, i);
  const passable = (i) => region[i] >= 0;
  // 지역마다 성 칸: 지역 중심에 가장 가까운 그 지역의 칸
  const castleTile = new Int32Array(world.regions.length).fill(-1);
  const best = new Float64Array(world.regions.length).fill(Infinity);
  for (let i = 0; i < N; i++) {
    const r = region[i];
    if (r < 0) continue;
    const [x, y] = center(i);
    const d = (x - world.regions[r].cx) ** 2 + (y - world.regions[r].cy) ** 2;
    if (d < best[r]) { best[r] = d; castleTile[r] = i; }
  }
  const tilesOf = world.regions.map(() => []);
  for (let i = 0; i < N; i++) if (region[i] >= 0) tilesOf[region[i]].push(i);
  return { size, cols, rows, N, terrain, region, river, nb, center, passable, castleTile, tilesOf, W: world.W, H: world.H, dist: (a, b) => hexDistance(cols, a, b) };
}

// ── 새 판: 기존 게임 설정(나라·장수·지역 병력)을 칸 지도로 옮김 ──
export function createHex14(world, base) {
  const grid = buildGrid(world);
  const castles = [];
  const castleOfRegion = {};
  world.regions.forEach((wr, r) => {
    const t = grid.castleTile[r];
    if (wr.sea || t < 0) return;
    const reg = base.regions[r];
    const walls = reg.buildings?.walls ? 1 : 0;
    castleOfRegion[r] = castles.length;
    castles.push({
      id: castles.length, tile: t, region: r, name: reg.name, owner: reg.owner, troops: reg.troops,
      dur: walls ? 3000 : 1200, maxDur: walls ? 3000 : 1200, pop: reg.pop, capital: base.nations.some((n) => n.capital === r),
      bandit: reg.bandit || null,
    });
  });
  const owner = new Array(grid.N).fill(-1);
  for (let i = 0; i < grid.N; i++) if (grid.region[i] >= 0) { const o = base.regions[grid.region[i]].owner; owner[i] = o === null ? -1 : o; }
  const generals = {};
  for (const g of Object.values(base.generals)) {
    if (g.status !== 'active' || g.nation === null || g.nation === undefined) continue;
    let c = castleOfRegion[g.region];
    if (c === undefined || castles[c].owner !== g.nation) c = castles.find((x) => x.owner === g.nation)?.id;
    if (c === undefined) continue;
    generals[g.id] = { id: g.id, name: g.name, war: g.war, lead: g.lead, intel: g.intel, pol: g.pol, traits: g.traits || [], nation: g.nation, castle: c, unit: null, status: 'active', ruler: base.nations[g.nation]?.ruler === g.id };
  }
  const nations = base.nations.map((n) => ({ id: n.id, name: n.name, color: n.color, alive: n.alive, isPlayer: n.isPlayer, gold: n.gold, horde: !!n.horde, pools: n.pools || [] }));
  return {
    mode: 'hex14', version: 14, scenarioId: base.scenarioId, seed: base.seed, opts: base.opts, playerId: base.playerId, spectator: base.spectator,
    turn: 1, day: 0, nations, generals, castles, owner, units: [], nextUnit: 1, log: [], rs: base.rs || 1, over: null,
  };
}

// ── 도우미 ──
export const unitAt = (s) => {
  const m = new Map();
  for (const u of s.units) m.set(u.tile, u);
  return m;
};
const castleAt = (s) => {
  const m = new Map();
  for (const c of s.castles) m.set(c.tile, c);
  return m;
};
export const hostile = (s, a, b) => a !== b && b !== -1 && b !== null && b !== undefined;
export const log = (s, text, kind = 'info', nations = []) => {
  s.log.unshift({ turn: s.turn, day: s.day, text, kind, nations });
  if (s.log.length > 200) s.log.length = 200;
};
export const gensOf = (s, ids) => ids.map((id) => s.generals[id]).filter(Boolean);
const leader = (s, u) => gensOf(s, u.gens).reduce((a, b) => (b.lead + b.war > a.lead + a.war ? b : a));
const has = (g, t) => (g.traits || []).some(([x]) => x === t);
export const unitStats = (s, u) => {
  const gs = gensOf(s, u.gens);
  const best = (k) => Math.max(...gs.map((g) => g[k]));
  return { atk: 40 + best('war') * 0.4 + best('lead') * 0.6, def: 40 + best('lead') * 0.6 + best('intel') * 0.4, intel: best('intel') };
};
// 지휘 한도: 가장 통솔 높은 장수 8천+통솔×800, 부장은 절반씩
export const commandCap = (s, gids) => {
  const caps = gensOf(s, gids).map((g) => 8000 + g.lead * 800).sort((a, b) => b - a);
  return caps.length ? Math.round(caps[0] + caps.slice(1).reduce((a, c) => a + c * 0.5, 0)) : 0;
};
export const speedOf = (s, u) => (gensOf(s, u.gens).some((g) => has(g, '기마')) ? 1.4 : 1.1);
export const moveCost = (grid, from, to) => (COST[grid.terrain[to]] || 1.2) + (grid.river[to] && !grid.river[from] ? 0.8 : 0);
export const dateOf = (s, startYear = 200) => {
  // 한 턴 = 10일: 상순·중순·하순
  const t = s.turn - 1, m = Math.floor(t / 3) % 12, y = startYear + Math.floor(t / 36);
  return `${y}년 ${m + 1}월 ${['상순', '중순', '하순'][t % 3]}`;
};

// 길찾기 (A*): 지나갈 수 없는 칸·다른 부대가 있는 칸은 피함 (목표 칸은 허용)
export function findPath(s, grid, from, to, nation) {
  if (from === to) return [];
  const occ = unitAt(s);
  const cas = castleAt(s);
  const open = [[0, from]];
  const g = new Map([[from, 0]]);
  const prev = new Map();
  const seen = new Set();
  let it = 0;
  while (open.length && it++ < 20000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === to) break;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of grid.nb[cur]) {
      if (!grid.passable(nx)) continue;
      if (nx !== to) {
        const u = occ.get(nx);
        if (u && u.nation !== nation) continue;
        const c = cas.get(nx);
        if (c && c.owner !== nation) continue; // 남의 성은 지나갈 수 없음 (공격 목표일 때만 들어감)
      }
      const ng = g.get(cur) + moveCost(grid, cur, nx) + (occ.get(nx) ? 2 : 0);
      if (ng < (g.get(nx) ?? Infinity)) {
        g.set(nx, ng);
        prev.set(nx, cur);
        open.push([ng + grid.dist(nx, to), nx]);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
  path.pop();
  return path.reverse();
}

// ── 출진: 성에서 장수와 병력을 뽑아 부대를 만듦 ──
export function sortie(s, grid, castleId, gids, troops) {
  const c = s.castles[castleId];
  const gs = gids.map((id) => s.generals[id]);
  if (!gs.length || gs.some((g) => !g || g.castle !== castleId || g.nation !== c.owner)) return { ok: false, msg: '성에 있는 장수를 골라야 합니다.' };
  const cap = commandCap(s, gids);
  troops = Math.min(Math.floor(troops / 100) * 100, cap, c.troops - 500);
  if (troops < 1000) return { ok: false, msg: '병력이 모자랍니다 (성에 500은 남겨야 함).' };
  // 성 옆 빈 칸에 나감
  const occ = unitAt(s);
  const spot = grid.nb[c.tile].find((t) => grid.passable(t) && !occ.has(t) && !s.castles.some((x) => x.tile === t));
  if (spot === undefined) return { ok: false, msg: '성 주변에 나갈 자리가 없습니다.' };
  c.troops -= troops;
  const u = { id: s.nextUnit++, nation: c.owner, gens: gids, troops, max: troops, morale: 80, tile: spot, path: [], order: null, mp: 0, home: castleId, wait: 0 };
  for (const g of gs) { g.castle = null; g.unit = u.id; }
  s.units.push(u);
  return { ok: true, unit: u, msg: `${gs[0].name} 부대 ${fmtTroops(troops)} 출진` };
}

// 명령: tile(이동) · unit(공격) · castle(공성/입성)
export function order(s, grid, u, kind, id) {
  const tgtTile = kind === 'tile' ? id : kind === 'unit' ? s.units.find((x) => x.id === id)?.tile : s.castles[id]?.tile;
  if (tgtTile === undefined || tgtTile === null) return { ok: false, msg: '목표가 없습니다.' };
  const path = findPath(s, grid, u.tile, tgtTile, u.nation);
  if (!path) return { ok: false, msg: '갈 수 있는 길이 없습니다.' };
  u.order = { kind, id };
  u.path = path;
  u.wait = 0;
  return { ok: true };
}

// ── 하루 진행 ──
export function stepDay(s, grid) {
  s.day += 1;
  const rng = makeRng(`hex:${s.seed}:${s.turn}:${s.day}`);
  const cas = castleAt(s);
  // 1) 이동 (느린 부대부터 섞어서): 하루 이동력만큼, 적 부대 옆 칸에 들어서면 멈춤(통제 구역)
  for (const u of rng.shuffle(s.units.slice())) {
    if (u.dead) continue;
    // 목표가 움직인 부대면 길을 다시 찾음
    if (u.order?.kind === 'unit') {
      const t = s.units.find((x) => x.id === u.order.id && !x.dead);
      if (!t) { u.order = null; u.path = []; }
      else if (!u.path.length || u.path[u.path.length - 1] !== t.tile) { const p = findPath(s, grid, u.tile, t.tile, u.nation); u.path = p || []; }
    }
    u.mp = Math.min(3, u.mp + speedOf(s, u));
    const occ = unitAt(s);
    while (u.path.length) {
      const nx = u.path[0];
      // 공격 목표(적 부대·적 성)는 옆 칸까지만 감
      const enemyU = occ.get(nx);
      const c = cas.get(nx);
      if ((enemyU && enemyU.nation !== u.nation) || (c && c.owner !== u.nation)) break;
      if (enemyU) { u.wait += 1; if (u.wait > 2) { const p = findPath(s, grid, u.tile, u.path[u.path.length - 1], u.nation); u.path = p || []; u.wait = 0; } break; }
      const cost = moveCost(grid, u.tile, nx);
      if (u.mp < cost) break;
      u.mp -= cost;
      occ.delete(u.tile);
      u.tile = nx;
      occ.set(nx, u);
      u.path.shift();
      // 칠하기: 내 것이 아닌 칸을 지나가면 내 땅이 됨 (성 칸 제외)
      if (!c && s.owner[nx] !== u.nation) s.owner[nx] = u.nation;
      // 내 성에 들어가면 입성 (병력·장수가 성으로)
      if (c && c.owner === u.nation && u.order?.kind === 'castle' && u.order.id === c.id) { enter(s, u, c); break; }
      // 통제 구역: 적 부대 옆에 서면 그날은 더 못 감
      if (grid.nb[nx].some((t) => { const o = occ.get(t); return o && o.nation !== u.nation; })) { u.mp = 0; break; }
    }
  }
  s.units = s.units.filter((u) => !u.dead);
  // 2) 전투: 옆에 붙은 적을 침 (명령한 목표 우선), 여러 부대가 한 부대를 치면 협공
  const occ = unitAt(s);
  const hits = new Map(); // 대상 → [{공격자, 피해}]
  const sieges = [];
  for (const u of s.units) {
    const adj = grid.nb[u.tile];
    let tgt = null;
    if (u.order?.kind === 'unit') { const t = s.units.find((x) => x.id === u.order.id); if (t && adj.includes(t.tile)) tgt = t; }
    if (!tgt && u.order?.kind === 'castle') { const c = s.castles[u.order.id]; if (c && c.owner !== u.nation && adj.includes(c.tile)) { sieges.push([u, c]); continue; } }
    if (!tgt) for (const t of adj) { const o = occ.get(t); if (o && o.nation !== u.nation) { tgt = o; break; } }
    if (!tgt) continue;
    const a = unitStats(s, u), d = unitStats(s, tgt);
    const dmg = u.troops * 0.03 * (a.atk / d.def) * (0.6 + u.morale / 250) / (DEF[grid.terrain[tgt.tile]] || 1) * rng.range(0.9, 1.1);
    if (!hits.has(tgt)) hits.set(tgt, []);
    hits.get(tgt).push({ u, dmg });
  }
  for (const [t, list] of hits) {
    // 협공: 다른 방향에서 함께 치면 한 부대당 +30%
    const pincer = 1 + 0.3 * (new Set(list.map((x) => x.u.tile)).size - 1);
    const total = list.reduce((a, x) => a + x.dmg, 0) * pincer;
    t.troops -= total;
    t.morale -= (total / Math.max(1, t.troops + total)) * 60 + (pincer > 1 ? 5 : 0);
    // 반격: 맞은 부대가 때린 부대들에게 되갚음 (협공당하면 나눠짐)
    const dt = unitStats(s, t);
    for (const { u } of list) {
      const back = (t.troops * 0.012 * (dt.atk / unitStats(s, u).def)) / list.length;
      u.troops -= back;
      u.morale -= (back / Math.max(1, u.troops)) * 30;
    }
    if (pincer > 1 && rng() < 0.3) log(s, `⚔️ ${leader(s, list[0].u).name} 등 ${list.length}부대가 ${leader(s, t).name} 부대를 협공!`, 'battle', [list[0].u.nation, t.nation]);
  }
  // 3) 공성: 성 수비대와 내구를 깎고, 수비대가 반격
  for (const [u, c] of sieges) {
    const a = unitStats(s, u);
    c.troops -= u.troops * 0.02 * (a.atk / 100) * rng.range(0.9, 1.1);
    c.dur -= u.troops * 0.006 * (a.atk / 100);
    u.troops -= c.troops * 0.01 * (c.dur > 0 ? 1.5 : 1);
    if (c.troops <= 0 || c.dur <= 0) capture(s, grid, c, u);
  }
  // 4) 보급: 내 성과 내 땅으로 이어져 있지 않으면 병력·사기가 줄어듦
  const supplied = {};
  for (const u of s.units) {
    if (!supplied[u.nation]) supplied[u.nation] = supplyMap(s, grid, u.nation);
    if (!supplied[u.nation].has(u.tile)) { u.troops *= 0.985; u.morale -= 3; u.cut = true; } else { u.cut = false; u.morale = Math.min(100, u.morale + 1); }
  }
  // 5) 무너진 부대: 병력이 바닥나거나 사기가 꺾이면 장수는 가까운 성으로 퇴각(일부는 사로잡힘)
  for (const u of s.units) {
    if (u.troops > 300 && u.morale > 5) continue;
    u.dead = true;
    const home = nearestCastle(s, grid, u.tile, u.nation);
    for (const g of gensOf(s, u.gens)) {
      g.unit = null;
      if (!home || rng() < 0.15) { g.status = 'prisoner'; g.castle = null; log(s, `⛓️ ${g.name}이(가) 사로잡혔습니다.`, 'battle', [u.nation]); }
      else { g.castle = home.id; }
    }
    if (home && u.troops > 0) home.troops += Math.max(0, u.troops * 0.5);
    log(s, `💥 ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name} 부대가 무너졌습니다.`, 'battle', [u.nation]);
  }
  s.units = s.units.filter((u) => !u.dead);
  for (const u of s.units) { u.troops = Math.round(u.troops); u.morale = Math.max(0, Math.min(100, u.morale)); }
  for (const c of s.castles) c.troops = Math.max(0, Math.round(c.troops));
}

function enter(s, u, c) {
  c.troops += u.troops;
  for (const g of gensOf(s, u.gens)) { g.unit = null; g.castle = c.id; }
  u.dead = true;
}

export function nearestCastle(s, grid, tile, nation) {
  let best = null, bd = Infinity;
  for (const c of s.castles) if (c.owner === nation) { const d = grid.dist(c.tile, tile); if (d < bd) { bd = d; best = c; } }
  return best;
}

// 보급망: 내 성에서 내 땅(칸)으로 이어진 칸들 (+그 옆 한 칸)
export function supplyMap(s, grid, nation) {
  const seen = new Set();
  const q = s.castles.filter((c) => c.owner === nation).map((c) => c.tile);
  for (const t of q) seen.add(t);
  for (let k = 0; k < q.length; k++) for (const nx of grid.nb[q[k]]) {
    if (seen.has(nx) || s.owner[nx] !== nation) continue;
    seen.add(nx);
    q.push(nx);
  }
  for (const t of [...seen]) for (const nx of grid.nb[t]) seen.add(nx);
  return seen;
}

// 성 함락: 그 지역 땅이 통째로 넘어감, 공격 부대는 성에 들어감
function capture(s, grid, c, u) {
  const old = c.owner;
  c.owner = u.nation;
  c.dur = Math.max(c.dur, c.maxDur * 0.3);
  c.troops = 0;
  c.bandit = null;
  for (const t of grid.tilesOf[c.region]) if (s.owner[t] === old || s.owner[t] === -1) s.owner[t] = u.nation;
  // 성에 있던 장수: 절반은 가까운 자기 성으로, 절반은 포로
  const rng = makeRng(`cap:${s.seed}:${s.turn}:${s.day}:${c.id}`);
  for (const g of Object.values(s.generals)) {
    if (g.castle !== c.id || g.nation !== old) continue;
    const home = old === null || old === -1 ? null : nearestCastle(s, grid, c.tile, old);
    if (home && rng() < 0.5) g.castle = home.id;
    else { g.status = 'prisoner'; g.castle = null; g.captor = u.nation; }
  }
  log(s, `🏯 ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name}이(가) ${c.name}${old !== null && old !== -1 ? `(${s.nations[old].name})` : ''}을(를) 함락했습니다!`, 'capture', [u.nation, old]);
  enter(s, u, c);
  checkFall(s, old);
}

function checkFall(s, nid) {
  if (nid === null || nid === -1 || nid === undefined) return;
  const n = s.nations[nid];
  if (!n.alive || s.castles.some((c) => c.owner === nid)) return;
  n.alive = false;
  for (const u of s.units) if (u.nation === nid) u.dead = true;
  for (const g of Object.values(s.generals)) if (g.nation === nid && g.status === 'active') { g.status = 'gone'; g.castle = null; }
  log(s, `☠️ ${n.name}이(가) 멸망했습니다.`, 'capture', [nid]);
}

// 성 하나의 한 턴 수입 (성 지역의 칸 중 내 칸 비율만큼)
export function castleIncome(s, grid, c) {
  const tiles = grid.tilesOf[c.region];
  const mine = tiles.filter((t) => s.owner[t] === c.owner).length / Math.max(1, tiles.length);
  return (1 + c.pop * 0.4) * 0.5 * G * (0.4 + 0.6 * mine);
}

// ── 턴 마무리: 수입·징병(자원병)·포로·승리 판정 ──
export function endTurn14(s, grid) {
  // 땅이 많을수록 그 지역 성의 수입이 늘어남 (성 지역의 칸 중 내 칸 비율)
  for (const n of s.nations) {
    if (!n.alive || n.horde) continue;
    let inc = 0, troops = 0;
    for (const c of s.castles) {
      if (c.owner !== n.id) continue;
      const tiles = grid.tilesOf[c.region];
      const mine = tiles.filter((t) => s.owner[t] === n.id).length / Math.max(1, tiles.length);
      inc += (1 + c.pop * 0.4) * 0.5 * G * (0.4 + 0.6 * mine);
      troops += c.troops;
      // 자원병: 인구에 비례해 조금씩 (성에 인구의 25%가 차면 더 오지 않음)
      if (c.troops < c.pop * 250) c.troops += Math.round(c.pop * 40 * (0.5 + 0.5 * mine));
      // 성벽 보수, 인구 회복(처음의 1.2배까지)
      c.dur = Math.min(c.maxDur, c.dur + c.maxDur * 0.05);
      c.popMax = c.popMax || c.pop * 1.2;
      if (c.pop < c.popMax) c.pop = Math.round(Math.min(c.popMax, c.pop * 1.02 + 0.2) * 10) / 10;
    }
    for (const u of s.units) if (u.nation === n.id) troops += u.troops;
    n.gold = Math.round(n.gold + inc - troops * 0.5);
    if (n.gold < 0) {
      // 녹봉을 못 주면 병사가 흩어짐
      for (const c of s.castles) if (c.owner === n.id) c.troops = Math.round(c.troops * 0.95);
      n.gold = 0;
    }
  }
  people(s, grid);
  s.turn += 1;
  s.day = 0;
  const alive = s.nations.filter((n) => n.alive && !n.horde);
  const top = alive.map((n) => [n, s.castles.filter((c) => c.owner === n.id).length]).sort((a, b) => b[1] - a[1])[0];
  if (alive.length === 1 || (top && top[1] >= s.castles.length * 0.8)) s.over = { winner: top[0].id };
  else if (!s.nations[s.playerId].alive && !s.spectator) s.over = { winner: null, lost: true };
}

// 징병: 성에서 금으로 병사를 뽑음 (1명당 5금, 인구의 20%까지)
export const draftMax14 = (s, c) => Math.max(0, Math.min(Math.floor(s.nations[c.owner].gold / 5 / 100) * 100, Math.floor((c.pop * 1000 * 0.2) / 100) * 100));
export function draft14(s, castleId, amt) {
  const c = s.castles[castleId];
  const n = s.nations[c.owner];
  amt = Math.min(Math.floor(amt / 100) * 100, draftMax14(s, c));
  if (amt < 100) return { ok: false, msg: '뽑을 수 없습니다.' };
  n.gold -= amt * 5;
  c.troops += amt;
  c.pop = Math.max(1, Math.round((c.pop - amt / 1000) * 10) / 10);
  return { ok: true, msg: `${c.name}에서 ${fmtTroops(amt)} 징병 (금 -${fmtGold(amt * 5)})` };
}

// ── 인재: 성 3곳당 장수 1명은 되도록 등용, 포로는 등용하거나 몇 턴 뒤 돌려보냄 ──
function people(s, grid) {
  const rng = makeRng(`ppl:${s.seed}:${s.turn}`);
  const used = new Set(Object.values(s.generals).map((g) => g.name));
  for (const n of s.nations) {
    if (!n.alive || n.horde) continue;
    const mine = s.castles.filter((c) => c.owner === n.id);
    const gens = Object.values(s.generals).filter((g) => g.nation === n.id && g.status === 'active');
    if (gens.length >= Math.ceil(mine.length / 3) + 1 || rng() > 0.35) continue;
    const pool = (n.pools || []).flatMap((k) => POOLS[k] || []).concat(POOLS.tk_free || []).filter((x) => !used.has(x.name));
    const d = pool.length ? rng.pick(pool) : null;
    const at = rng.pick(mine);
    if (!at) continue;
    const id = `h${s.turn}_${n.id}_${Math.floor(rng() * 1e6)}`;
    const g = d
      ? { id, name: d.name, war: d.war, lead: d.lead, intel: d.intel, pol: d.pol, traits: d.trait ? [[d.trait, 1]] : [] }
      : { id, name: `${at.name} 교위`, war: rng.int(45, 70), lead: rng.int(45, 70), intel: rng.int(35, 65), pol: rng.int(35, 65), traits: [] };
    s.generals[id] = { ...g, nation: n.id, castle: at.id, unit: null, status: 'active' };
    used.add(g.name);
    if (n.id === s.playerId) log(s, `⭐ ${g.name}(무${g.war}/통${g.lead}/지${g.intel})이(가) ${at.name}에서 벼슬길에 나섰습니다.`, 'info', [n.id]);
  }
  // 포로: 붙잡은 나라가 30% 확률로 등용, 아니면 6턴 뒤 풀려나 자기 나라로
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'prisoner') continue;
    g.held = (g.held || 0) + 1;
    const cap = s.nations[g.captor];
    if (cap?.alive && rng() < 0.3) {
      const at = s.castles.find((c) => c.owner === cap.id);
      if (at) { log(s, `🤝 ${g.name}이(가) ${cap.name}에 귀순했습니다.`, 'info', [cap.id, g.nation]); Object.assign(g, { nation: cap.id, status: 'active', castle: at.id, held: 0 }); continue; }
    }
    if (g.held >= 6) {
      const home = s.nations[g.nation]?.alive ? s.castles.find((c) => c.owner === g.nation) : null;
      if (home) Object.assign(g, { status: 'active', castle: home.id, held: 0 });
      else g.status = 'gone';
    }
  }
}
