// ───────── 삼국지14식 모드: 육각형 칸 위에서 부대가 움직이며 땅을 칠하고, 성을 빼앗는 전쟁 ─────────
// 지도는 기존 세계(world)의 촘촘한 격자를 굵은 육각 칸으로 다시 뽑아 씀 (칸 = 약 2.5천 개)
// 한 턴 = 10일. 모든 부대가 하루씩 동시에 움직이고(통제 구역·칠하기), 붙어 있으면 싸우고(협공), 성을 공격함
import { SQRT3, cellCenter, pixelToCell, hexDistance, neighborIndex } from './hex.js';
import { T } from './rules.js';
import { makeRng } from './rng.js';
import { fmtTroops, fmtGold } from './format.js';
import { fixJosa } from './josa.js';
import { getScenario } from './scenarios.js';
import { initGov, govTurn, pactOf, addRel, goldOf, SORTIE_COST } from './hex14gov.js';
import { buildTurn, lv } from './hex14build.js';
import { rollWeather, weatherCost, fireMult, tacticOf, maybeDuel, eventsTurn } from './hex14extra.js';

export const DAYS = 10;
// 지형별 이동 비용(이동력 1 = 하루에 평지 1칸)과 수비 보정
const COST = { [T.PLAINS]: 1, [T.DESERT]: 1.3, [T.TUNDRA]: 1.3, [T.FOREST]: 1.6, [T.HILLS]: 1.6, [T.MOUNTAIN]: 2.5 };
const DEF = { [T.PLAINS]: 1, [T.DESERT]: 1, [T.TUNDRA]: 1, [T.FOREST]: 1.15, [T.HILLS]: 1.25, [T.MOUNTAIN]: 1.35 };
export const TERRAIN_NAME = { [T.PLAINS]: '평지', [T.DESERT]: '사막', [T.TUNDRA]: '동토', [T.FOREST]: '숲', [T.HILLS]: '구릉', [T.MOUNTAIN]: '산지' };

// ── 칸 지도 (저장하지 않고 world에서 매번 만듦) ──
export function buildGrid(world) {
  const size = world.unit * 0.6; // 칸 크기 (기존 지역 지도보다 촘촘하게)
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
  // 뱃길: 뭍에서 3칸 안의 바다 (수군이 다닐 수 있음)
  const water = new Uint8Array(N);
  {
    const dist = new Int8Array(N).fill(-1), q = [];
    for (let i = 0; i < N; i++) if (terrain[i] !== T.SEA) { dist[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const t = q[k];
      if (dist[t] >= 3) continue;
      for (const nx of nb[t]) if (dist[nx] < 0 && terrain[nx] === T.SEA) { dist[nx] = dist[t] + 1; water[nx] = 1; q.push(nx); }
    }
  }
  const tilesOf = world.regions.map(() => []);
  for (let i = 0; i < N; i++) if (region[i] >= 0) tilesOf[region[i]].push(i);
  return { size, cols, rows, N, terrain, region, river, nb, center, passable, castleTile, tilesOf, water, W: world.W, H: world.H, dist: (a, b) => hexDistance(cols, a, b), k: world.unit / size };
}

// 삼국지14의 도시(200년 무렵)와 관문: [이름, 경도, 위도, 종류] — 큰 도시(BIG)는 인구가 많고 변방(EDGE)은 적음
const BIG = new Set(['낙양', '장안', '업', '허창', '성도', '건업', '양양', '계', '남피', '하비', '수춘', '오', '강릉', '완', '진류', '북해', '복양', '여남']);
const EDGE = new Set(['양평', '북평', '무위', '서평', '천수', '안정', '운남', '건녕', '교지', '남해', '계양', '영릉', '무릉', '회계', '시상', '상용', '영안', '재동', '강주', '한중']);
const TK_CITIES = [
  ['양평', 123.17, 41.27], ['북평', 118.5, 40.9], ['계', 116.4, 39.9], ['남피', 116.7, 38.05], ['평원', 116.45, 37.1], ['업', 114.35, 36.33],
  ['진양', 112.55, 37.87], ['북해', 119.1, 36.7], ['복양', 115.0, 35.75], ['진류', 114.6, 34.6], ['허창', 113.85, 34.03], ['여남', 114.6, 33.0],
  ['소패', 116.9, 34.75], ['하비', 118.0, 34.1], ['수춘', 116.78, 32.57], ['초', 115.8, 33.85], ['낙양', 112.45, 34.62], ['장안', 108.94, 34.34],
  ['천수', 105.72, 34.58], ['안정', 106.7, 35.5], ['무위', 102.64, 37.93], ['완', 112.53, 33.0], ['신야', 112.35, 32.5], ['상용', 110.8, 32.3],
  ['양양', 112.14, 32.04], ['강릉', 112.19, 30.35], ['강하', 114.3, 30.6], ['장사', 112.94, 28.23], ['무릉', 111.7, 29.0], ['영릉', 111.6, 26.4],
  ['계양', 113.0, 25.8], ['여강', 117.0, 31.4], ['건업', 118.78, 32.06], ['오', 120.62, 31.3], ['회계', 120.58, 30.0], ['시상', 115.98, 29.7],
  ['한중', 107.03, 33.07], ['재동', 105.2, 31.6], ['성도', 104.06, 30.66], ['강주', 106.5, 29.55], ['영안', 109.5, 31.05], ['건녕', 103.8, 25.5],
  ['운남', 100.6, 25.5], ['교지', 105.85, 21.03], ['남해', 113.26, 23.13], ['서평', 101.78, 36.62],
  ['호로관', 113.25, 34.8, 'pass'], ['동관', 110.25, 34.55, 'pass'], ['무관', 110.8, 33.6, 'pass'], ['양평관', 106.3, 33.2, 'pass'], ['검각', 105.55, 32.1, 'pass'],
];

// 도시 자리 고르기: 삼국지면 위 목록, 아니면 지역 4곳당 도시 1곳(큰 지역·실제 지명·수도 우선, 서로 떨어지게)
function pickCities(world, grid, base) {
  const near = (t0) => {
    if (t0 >= 0 && grid.passable(t0)) return t0;
    let best = -1, bd = Infinity;
    const [x0, y0] = t0 >= 0 ? grid.center(t0) : [0, 0];
    for (let i = 0; i < grid.N; i++) if (grid.passable(i)) { const [x, y] = grid.center(i); const d = (x - x0) ** 2 + (y - y0) ** 2; if (d < bd) { bd = d; best = i; } }
    return bd < (grid.size * 4) ** 2 ? best : -1;
  };
  const out = [];
  const far = (t, m) => out.every((c) => grid.dist(c.tile, t) >= m);
  if (/^threekingdoms/.test(base.scenarioId) && world.geo) {
    for (const [name, lon, lat, kind] of TK_CITIES) {
      const [x, y] = world.geo.toPx(lon, lat);
      if (x < 0 || y < 0 || x > world.W || y > world.H) continue;
      const t = near(pixelToCell(grid.size, grid.cols, grid.rows, x, y));
      if (t < 0 || !far(t, 2)) continue;
      out.push({ name, tile: t, kind: kind || 'city', pop: BIG.has(name) ? 90 : EDGE.has(name) ? 35 : 55 });
    }
  }
  // 나라 수도는 꼭 도시로
  for (const n of base.nations) {
    if (!n.alive) continue;
    const t = grid.castleTile[n.capital];
    if (t < 0) continue;
    if (out.some((c) => grid.region[c.tile] === n.capital)) continue;
    if (!far(t, 3)) { const c = out.filter((c) => c.kind === 'city').sort((a, b) => grid.dist(a.tile, t) - grid.dist(b.tile, t))[0]; if (c) { c.capitalOf = n.id; continue; } }
    out.push({ name: base.regions[n.capital].name, tile: t, kind: 'city', capitalOf: n.id });
  }
  // 그 밖(삼국지가 아닌 판): 나라마다 자기 땅 지역 4곳당 1곳(최소 2곳), 남은 빈 땅도 4곳당 1곳 — 큰 지역부터, 서로 떨어지게
  if (!/^threekingdoms/.test(base.scenarioId) || !world.geo) {
    const land = world.regions.filter((r) => !r.sea && grid.castleTile[r.id] >= 0);
    const gap = Math.max(3, Math.round(Math.sqrt(grid.region.filter((r) => r >= 0).length / Math.max(1, land.length / 4)) * 0.75));
    const groups = new Map();
    for (const r of land) { const o = base.regions[r.id].owner ?? -1; if (!groups.has(o)) groups.set(o, []); groups.get(o).push(r); }
    for (const [o, regs] of groups) {
      const want = o === -1 ? Math.round(regs.length / 4) : Math.max(2, Math.round(regs.length / 4));
      let have = out.filter((c) => (base.regions[grid.region[c.tile]]?.owner ?? -1) === o).length;
      const order = regs.slice().sort((a, b) => (base.regions[b.id].pop || 0) - (base.regions[a.id].pop || 0));
      for (const g of [gap, Math.max(2, Math.round(gap / 2))]) for (const r of order) {
        if (have >= Math.min(want, regs.length)) break;
        const t = grid.castleTile[r.id];
        if (out.some((c) => c.tile === t) || !far(t, g)) continue;
        out.push({ name: base.regions[r.id].name, tile: t, kind: 'city' });
        have += 1;
      }
    }
  }
  return out;
}

// 관할 구역: 도시마다 가장 가까운(길 기준) 칸들
function districts(grid, cities) {
  const dist = new Float64Array(grid.N).fill(Infinity), own = new Array(grid.N).fill(-1);
  const q = [];
  cities.forEach((c, i) => { if (c.kind !== 'city' || c.founding) return; dist[c.tile] = 0; own[c.tile] = i; q.push(c.tile); });
  for (let k = 0; k < q.length; k++) {
    const t = q[k];
    for (const nx of grid.nb[t]) {
      if (!grid.passable(nx) || own[nx] >= 0) continue;
      own[nx] = own[t];
      q.push(nx);
    }
  }
  return own;
}

// 새 도시가 생기면 관할 구역을 다시 나눔
export function redistrict(s, grid) {
  s.district = districts(grid, s.castles);
}

// ── 새 판: 기존 게임 설정(나라·장수·지역 병력)을 칸 지도와 도시로 옮김 ──
export function createHex14(world, base) {
  const grid = buildGrid(world);
  const picks = pickCities(world, grid, base);
  const district = districts(grid, picks);
  const regOwner = (t) => { const o = base.regions[grid.region[t]]?.owner; return o === null || o === undefined ? -1 : o; };
  const castles = picks.map((p, id) => {
    const capOf = p.capitalOf ?? base.nations.findIndex((n) => n.alive && n.capital === grid.region[p.tile]);
    const owner = capOf >= 0 ? capOf : regOwner(p.tile);
    const pass = p.kind === 'pass';
    return { id, tile: p.tile, region: grid.region[p.tile], name: p.name, kind: p.kind, owner: owner === -1 ? null : owner, troops: 0, dur: pass ? 6000 : 3000, maxDur: pass ? 6000 : 3000, pop: 0, capital: capOf >= 0, bandit: null };
  });
  // 지역의 병력·인구를 그 지역 성 칸이 속한 도시로 모음
  world.regions.forEach((wr, r) => {
    const t = grid.castleTile[r];
    if (wr.sea || t < 0) return;
    const c = castles[district[t]];
    if (!c) return;
    const reg = base.regions[r];
    c.pop += reg.pop || 0;
    if ((reg.owner ?? null) === c.owner) c.troops += reg.troops || 0;
    if (reg.bandit && c.owner === null) c.bandit = reg.bandit;
  });
  for (const c of castles) {
    if (c.kind === 'pass') { c.troops = Math.max(c.troops, 3000); c.pop = 0; }
    else {
      c.pop = picks[c.id].pop ?? Math.round(Math.min(130, 25 + c.pop * 0.35));
      if (c.capital) c.pop += 15;
      if (c.owner === null) c.troops = Math.min(8000, Math.max(c.troops, 3000));
    }
  }
  // 땅: 그 칸이 속한 도시의 주인 (삼국지14처럼 시작할 때 관할 구역이 통째로 그 나라 땅)
  const owner = new Array(grid.N).fill(-1);
  for (let i = 0; i < grid.N; i++) if (grid.passable(i) && district[i] >= 0) { const o = castles[district[i]].owner; owner[i] = o === null ? -1 : o; }
  for (const c of castles) owner[c.tile] = c.owner === null ? -1 : c.owner;
  // 항구: 바닷길이 3칸 안에 닿는 도시
  for (const c of castles) c.port = c.kind !== 'pass' && grid.water.some((w, t) => w && grid.dist(t, c.tile) <= 3);
  const generals = {};
  for (const g of Object.values(base.generals)) {
    if (g.status !== 'active' || g.nation === null || g.nation === undefined) continue;
    const t = grid.castleTile[g.region] ?? -1;
    const mine = castles.filter((x) => x.owner === g.nation);
    if (!mine.length) continue;
    const c = t >= 0 ? mine.reduce((a, b) => (grid.dist(b.tile, t) < grid.dist(a.tile, t) ? b : a)) : mine[0];
    generals[g.id] = { id: g.id, name: g.name, war: g.war, lead: g.lead, intel: g.intel, pol: g.pol, traits: g.traits || [], nation: g.nation, castle: c.id, unit: null, status: 'active', ruler: base.nations[g.nation]?.ruler === g.id || undefined };
  }
  const nations = base.nations.map((n) => ({ id: n.id, name: n.name, color: n.color, alive: n.alive && castles.some((c) => c.owner === n.id), isPlayer: n.isPlayer, gold: n.gold, horde: !!n.horde, pools: n.pools || [] }));
  const st = {
    mode: 'hex14', version: 14, scenarioId: base.scenarioId, seed: base.seed, opts: base.opts, playerId: base.playerId, spectator: base.spectator,
    startYear: getScenario(base.scenarioId)?.startYear ?? 200, turn: 1, day: 0, nations, generals, castles, owner, district, units: [], nextUnit: 1, log: [], fx: [], rs: base.rs || 1, over: null,
  };
  initGov(st, makeRng(`gov0:${base.seed}`));
  rollWeather(st);
  return st;
}

// 도시 관할 칸 목록 (state.district에서 만들어 둠)
const distCache = new WeakMap();
export function districtTiles(s) {
  let m = distCache.get(s.district);
  if (!m) {
    m = s.castles.map(() => []);
    s.district.forEach((c, t) => { if (c >= 0) m[c].push(t); });
    distCache.set(s.district, m);
  }
  return m;
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
// 적인가: 다른 나라이면서 동맹·정전이 아님 (주인 없는 성은 모두의 적)
export const enemy = (s, a, b) => a !== b && (a === null || b === null || a === -1 || b === -1 || a === undefined || b === undefined || !pactOf(s, a, b));
export const log = (s, text, kind = 'info', nations = []) => {
  s.logN = (s.logN || 0) + 1;
  s.log.unshift({ n: s.logN, turn: s.turn, day: s.day, text: fixJosa(text), kind, nations });
  if (s.log.length > 200) s.log.length = 200;
};
export const gensOf = (s, ids) => ids.map((id) => s.generals[id]).filter(Boolean);
const leader = (s, u) => gensOf(s, u.gens).reduce((a, b) => (b.lead + b.war > a.lead + a.war ? b : a), { name: '?', lead: -1, war: -1 });
const has = (g, t) => (g.traits || []).some(([x]) => x === t);
export const unitStats = (s, u) => {
  const gs = gensOf(s, u.gens);
  const best = (k) => (gs.length ? Math.max(...gs.map((g) => g[k])) : 30); // 대장을 잃은 부대는 약함
  return { atk: 40 + best('war') * 0.4 + best('lead') * 0.6, def: 40 + best('lead') * 0.6 + best('intel') * 0.4, intel: best('intel') };
};
// 지휘 한도: 가장 통솔 높은 장수 8천+통솔×800, 부장은 절반씩
export const commandCap = (s, gids) => {
  const caps = gensOf(s, gids).map((g) => 8000 + g.lead * 800).sort((a, b) => b - a);
  return caps.length ? Math.round(caps[0] + caps.slice(1).reduce((a, c) => a + c * 0.5, 0)) : 0;
};
export const speedOf = (s, u) => (gensOf(s, u.gens).some((g) => has(g, '기마')) ? 0.8 : 0.6); // 하루에 평지 0.6칸 (기마 0.8칸)
export const moveCost = (grid, from, to, s, u) => {
  if (grid.water?.[to]) return 0.7; // 배는 빠름
  let c = (COST[grid.terrain[to]] || 1.2) + (grid.river[to] && !grid.river[from] ? 0.8 : 0);
  if (u && grid.river[to] && gensOf(s, u.gens).some((g) => has(g, '수군'))) c *= 0.6; // 수군 장수는 강을 따라 빠름
  return s ? weatherCost(s, grid, to, c) : c;
};
const canGo = (grid, t, navy) => grid.passable(t) || (navy && grid.water[t]);
export const dateOf = (s, startYear = 200) => {
  // 한 턴 = 10일: 상순·중순·하순
  const t = s.turn - 1, m = Math.floor(t / 3) % 12, y = startYear + Math.floor(t / 36);
  return `${y}년 ${m + 1}월 ${['상순', '중순', '하순'][t % 3]}`;
};

// 작은 우선순위 큐
function heap() {
  const k = [], v = [];
  return {
    size: () => k.length,
    push(key, val) {
      let i = k.length;
      k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
    },
    pop() {
      const top = v[0], lk = k.pop(), lv = v.pop();
      if (k.length) {
        k[0] = lk; v[0] = lv;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < k.length && k[l] < k[m]) m = l;
          if (r < k.length && k[r] < k[m]) m = r;
          if (m === i) break;
          [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
        }
      }
      return top;
    },
  };
}

// 길찾기 (A*): 지나갈 수 없는 칸·다른 부대가 있는 칸은 피함 (목표 칸은 허용)
export function findPath(s, grid, from, to, nation, navy = false) {
  if (from === to) return [];
  const occ = unitAt(s);
  const cas = castleAt(s);
  const open = heap();
  open.push(0, from);
  const g = new Map([[from, 0]]);
  const prev = new Map();
  const seen = new Set();
  let it = 0;
  while (open.size() && it++ < 40000) {
    const cur = open.pop();
    if (cur === to) break;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of grid.nb[cur]) {
      if (!canGo(grid, nx, navy)) continue;
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
        open.push(ng + grid.dist(nx, to), nx);
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
  const cost = Math.round(troops * SORTIE_COST);
  if (s.nations[c.owner].gold < cost) return { ok: false, msg: `출진 비용(군량 수송) 금 ${fmtGold(cost)}이 모자랍니다.` };
  // 성 옆 빈 칸에 나감
  const occ = unitAt(s);
  const spot = grid.nb[c.tile].find((t) => grid.passable(t) && !occ.has(t) && !s.castles.some((x) => x.tile === t));
  if (spot === undefined) return { ok: false, msg: '성 주변에 나갈 자리가 없습니다.' };
  c.troops -= troops;
  s.nations[c.owner].gold -= cost;
  const u = { id: s.nextUnit++, nation: c.owner, gens: gids, troops, max: troops, morale: 80, tile: spot, path: [], order: null, mp: 0, home: castleId, wait: 0, cd: 0, navy: !!c.port, ships: lv(c, 'shipyard') > 0 || undefined, atkB: lv(c, 'smithy') ? 1.1 : undefined };
  for (const g of gs) { g.castle = null; g.unit = u.id; }
  s.units.push(u);
  return { ok: true, unit: u, msg: `${gs[0].name} 부대 ${fmtTroops(troops)} 출진` };
}

// 명령: tile(이동) · unit(공격) · castle(공성/입성)
export function order(s, grid, u, kind, id) {
  const tgtTile = kind === 'tile' ? id : kind === 'unit' ? s.units.find((x) => x.id === id)?.tile : s.castles[id]?.tile;
  if (tgtTile === undefined || tgtTile === null) return { ok: false, msg: '목표가 없습니다.' };
  const path = findPath(s, grid, u.tile, tgtTile, u.nation, u.navy);
  if (!path) return { ok: false, msg: '갈 수 있는 길이 없습니다.' };
  u.order = { kind, id };
  u.path = path;
  u.wait = 0;
  return { ok: true };
}

// ── 하루 진행 ──
export function stepDay(s, grid) {
  s.day += 1;
  s.fx = [];
  s.duels = [];
  dropLeaderless(s, grid);
  const rng = makeRng(`hex:${s.seed}:${s.turn}:${s.day}`);
  const cas = castleAt(s);
  // 1) 이동 (느린 부대부터 섞어서): 하루 이동력만큼, 적 부대 옆 칸에 들어서면 멈춤(통제 구역)
  for (const u of rng.shuffle(s.units.slice())) {
    if (u.dead) continue;
    // 목표가 움직인 부대면 길을 다시 찾음
    if (u.order?.kind === 'unit') {
      const t = s.units.find((x) => x.id === u.order.id && !x.dead);
      if (!t) { u.order = null; u.path = []; }
      else if (!u.path.length || u.path[u.path.length - 1] !== t.tile) { const p = findPath(s, grid, u.tile, t.tile, u.nation, u.navy); u.path = p || []; }
    }
    if (u.stun > 0) { u.stun -= 1; continue; } // 일갈에 발이 묶임
    u.mp = Math.min(3, u.mp + speedOf(s, u));
    const occ = unitAt(s);
    while (u.path.length) {
      const nx = u.path[0];
      // 공격 목표(적 부대·적 성)는 옆 칸까지만 감
      const enemyU = occ.get(nx);
      const c = cas.get(nx);
      if ((enemyU && enemyU.nation !== u.nation) || (c && c.owner !== u.nation)) break;
      if (enemyU) { u.wait += 1; if (u.wait > 2) { const p = findPath(s, grid, u.tile, u.path[u.path.length - 1], u.nation, u.navy); u.path = p || []; u.wait = 0; } break; }
      const cost = moveCost(grid, u.tile, nx, s, u);
      if (u.mp < cost) break;
      u.mp -= cost;
      occ.delete(u.tile);
      u.tile = nx;
      occ.set(nx, u);
      u.path.shift();
      // 칠하기: 내 것이 아닌 칸을 지나가면 내 땅이 됨 (성 칸 제외)
      if (!c && grid.passable(nx) && s.owner[nx] !== u.nation) s.owner[nx] = u.nation;
      // 내 성에 들어가면 입성 (병력·장수가 성으로)
      if (c && c.owner === u.nation && u.order?.kind === 'castle' && u.order.id === c.id) { enter(s, u, c); break; }
      // 통제 구역: 적 부대 옆에 서면 그날은 더 못 감
      if (grid.nb[nx].some((t) => { const o = occ.get(t); return o && enemy(s, u.nation, o.nation); })) { u.mp = 0; break; }
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
    if (u.order?.kind === 'unit') { const t = s.units.find((x) => x.id === u.order.id); if (t && adj.includes(t.tile) && enemy(s, u.nation, t.nation)) tgt = t; }
    if (!tgt && u.order?.kind === 'castle') { const c = s.castles[u.order.id]; if (c && enemy(s, u.nation, c.owner) && adj.includes(c.tile)) { sieges.push([u, c]); continue; } }
    if (!tgt) for (const t of adj) { const o = occ.get(t); if (o && enemy(s, u.nation, o.nation)) { tgt = o; break; } }
    if (!tgt) continue;
    const a = unitStats(s, u), d = unitStats(s, tgt);
    // 물 위에서는 수군 장수가 없으면 약함
    const sea = (x) => (grid.water[x.tile] ? (gensOf(s, x.gens).some((g) => has(g, '수군')) ? 1.15 : x.ships ? 1 : 0.75) : 1);
    let dmg = u.troops * 0.03 * (a.atk / d.def) * (0.6 + u.morale / 250) / (DEF[grid.terrain[tgt.tile]] || 1) * rng.range(0.9, 1.1) * sea(u) / sea(tgt) * (u.atkB || 1);
    // 일기토
    maybeDuel(s, u, tgt, rng);
    // 전법: 고유 전법(이름난 장수) 또는 능력 70 이상의 돌격·일제사격·화계 (부대마다 3일에 한 번)
    const tac = u.cd > 0 ? null : tacticOf(s, u, rng);
    if (tac) {
      u.cd = tac.unique ? 4 : 3;
      const fire = tac.kind === 'fire' ? fireMult(s) : 1;
      if (tac.kind === 'guard') { u.guard = 2; }
      else dmg *= tac.mult * fire;
      tgt.morale -= tac.morale * (tac.kind === 'scare' ? 1.5 : 1);
      s.fx.push({ type: 'tactic', tile: u.tile, to: tgt.tile, text: `${tac.g.name} 「${tac.name}」`, nation: u.nation, unique: !!tac.unique });
      if (tac.kind === 'fire') for (const t of grid.nb[tgt.tile]) { const o = occ.get(t); if (o && o !== tgt && enemy(s, u.nation, o.nation)) { const x = dmg * 0.4; o.troops -= x; s.fx.push({ type: 'hit', tile: t, amt: Math.round(x) }); } }
      if (tac.kind === 'shout') for (const o of s.units) if (enemy(s, u.nation, o.nation) && grid.dist(o.tile, u.tile) <= 2) { o.morale -= tac.morale; o.stun = 1; }
      if (u.nation === s.playerId || tgt.nation === s.playerId) log(s, `🔥 ${tac.g.name}의 「${tac.name}」!${tac.kind === 'guard' ? ' 진을 굳게 쳤습니다' : ` ${leader(s, tgt).name} 부대 ${fmtTroops(Math.round(dmg))} 피해`}`, 'battle', [u.nation, tgt.nation]);
    }
    s.fx.push({ type: 'clash', a: u.tile, b: tgt.tile });
    if (!hits.has(tgt)) hits.set(tgt, []);
    hits.get(tgt).push({ u, dmg });
  }
  for (const [t, list] of hits) {
    // 협공: 다른 방향에서 함께 치면 한 부대당 +30%
    const pincer = 1 + 0.3 * (new Set(list.map((x) => x.u.tile)).size - 1);
    const total = list.reduce((a, x) => a + x.dmg, 0) * pincer * (t.guard > 0 ? 0.5 : 1);
    t.troops -= total;
    t.morale -= (total / Math.max(1, t.troops + total)) * 60 + (pincer > 1 ? 5 : 0);
    s.fx.push({ type: 'hit', tile: t.tile, amt: Math.round(total), pincer: pincer > 1 });
    // 반격: 맞은 부대가 때린 부대들에게 되갚음 (협공당하면 나눠짐)
    const dt = unitStats(s, t);
    for (const { u } of list) {
      const back = (t.troops * 0.012 * (dt.atk / unitStats(s, u).def)) / list.length;
      u.troops -= back;
      u.morale -= (back / Math.max(1, u.troops)) * 30;
      s.fx.push({ type: 'hit', tile: u.tile, amt: Math.round(back) });
    }
    if (pincer > 1) s.fx.push({ type: 'tactic', tile: t.tile, text: '협공!', nation: list[0].u.nation });
    if (pincer > 1 && rng() < 0.3) log(s, `⚔️ ${leader(s, list[0].u).name} 등 ${list.length}부대가 ${leader(s, t).name} 부대를 협공!`, 'battle', [list[0].u.nation, t.nation]);
  }
  for (const u of s.units) { if (u.cd > 0) u.cd -= 1; if (u.guard > 0) u.guard -= 1; }
  dropLeaderless(s, grid);
  // 3) 공성: 성 수비대와 내구를 깎고, 수비대가 반격
  for (const [u, c] of sieges) {
    if (!enemy(s, u.nation, c.owner) || u.dead) continue;
    const a = unitStats(s, u);
    // 성벽이 남아 있으면 수비병 피해가 크게 줄고 반격이 셈. 성벽부터 깎아야 함
    const walled = c.dur > 0;
    const wall = u.troops * 0.004 * (a.atk / 100);
    c.dur = Math.max(0, c.dur - wall);
    const kill = u.troops * 0.012 * (a.atk / 100) * (walled ? 0.35 : 1) * rng.range(0.9, 1.1);
    c.troops -= kill;
    u.troops -= Math.max(0, c.troops) * 0.012 * (walled ? 1.4 : 1);
    u.morale -= walled ? 0.5 : 0;
    s.fx.push({ type: 'clash', a: u.tile, b: c.tile }, { type: 'hit', tile: c.tile, amt: Math.round(kill), wall: walled });
    if (c.troops <= 0) capture(s, grid, c, u);
  }
  // 4) 보급: 내 성과 내 땅으로 이어져 있지 않으면 병력·사기가 줄어듦
  const supplied = {};
  for (const u of s.units) {
    if (!supplied[u.nation]) supplied[u.nation] = supplyMap(s, grid, u.nation);
    if (!grid.water[u.tile] && !supplied[u.nation].has(u.tile)) { u.troops *= 0.985; u.morale -= 3; u.cut = true; } else { u.cut = false; u.morale = Math.min(100, u.morale + 1); }
  }
  // 5) 무너진 부대: 병력이 바닥나거나 사기가 꺾이면 장수는 가까운 성으로 퇴각(일부는 사로잡힘)
  for (const u of s.units) {
    if (u.troops > 300 && u.morale > 5) continue;
    u.dead = true;
    const home = nearestCastle(s, grid, u.tile, u.nation);
    const foe = s.units.filter((x) => x !== u && !x.dead && enemy(s, u.nation, x.nation)).sort((a, b) => grid.dist(a.tile, u.tile) - grid.dist(b.tile, u.tile))[0];
    for (const g of gensOf(s, u.gens)) {
      g.unit = null;
      if (foe && (!home || rng() < 0.15)) { g.status = 'prisoner'; g.castle = null; g.captor = foe.nation; log(s, `⛓️ ${g.name}이(가) 사로잡혔습니다.`, 'battle', [u.nation]); }
      else if (home) { g.castle = home.id; } else { g.status = 'free'; g.nation = null; g.castle = nearestCastle(s, grid, u.tile, foe?.nation ?? -2)?.id ?? 0; }
    }
    if (home && u.troops > 0) home.troops += Math.max(0, u.troops * 0.5);
    log(s, `💥 ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name} 부대가 무너졌습니다.`, 'battle', [u.nation]);
  }
  s.units = s.units.filter((u) => !u.dead);
  for (const u of s.units) { u.troops = Math.round(u.troops); u.morale = Math.max(0, Math.min(100, u.morale)); }
  for (const c of s.castles) c.troops = Math.max(0, Math.round(c.troops));
}

// 대장이 없어진 부대(일기토에서 사로잡힘·죽음)는 흩어져 남은 병사가 가까운 성으로
function dropLeaderless(s, grid) {
  for (const u of s.units) {
    u.gens = u.gens.filter((id) => s.generals[id]?.status === 'active' && s.generals[id].unit === u.id);
    if (u.gens.length) continue;
    u.dead = true;
    const home = nearestCastle(s, grid, u.tile, u.nation);
    if (home) home.troops += Math.round(u.troops * 0.5);
  }
  s.units = s.units.filter((u) => !u.dead);
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
  const oldO = old === null ? -1 : old;
  const tiles = c.kind === 'pass' ? [c.tile, ...grid.nb[c.tile]] : districtTiles(s)[c.id];
  for (const t of tiles) if (s.owner[t] === oldO || s.owner[t] === -1) s.owner[t] = u.nation;
  s.owner[c.tile] = u.nation;
  s.fx.push({ type: 'capture', tile: c.tile, text: `${c.name} 함락` });
  addRel(s, u.nation, old, -15);
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

// 군주가 사로잡히거나 죽으면 통솔+정치가 가장 높은 장수가 잇고 사기가 꺾임. 이을 사람이 없으면 나라가 무너져 도시는 주인 없는 땅이 됨
export function checkRulers(s) {
  for (const n of s.nations) {
    if (!n.alive || n.horde) continue;
    const gens = Object.values(s.generals).filter((g) => g.nation === n.id);
    const ruler = gens.find((g) => g.ruler && g.status === 'active');
    if (ruler) continue;
    if (!gens.some((g) => g.ruler)) { // 처음부터 군주 표시가 없던 나라: 가장 나은 장수를 군주로
      const b = gens.filter((g) => g.status === 'active').sort((a, c) => c.lead + c.pol - (a.lead + a.pol))[0];
      if (b) b.ruler = true;
      continue;
    }
    const old = gens.find((g) => g.ruler);
    old.ruler = false;
    old.exRuler = true;
    const heir = gens.filter((g) => g.status === 'active').sort((a, c) => c.lead + c.pol - (a.lead + a.pol))[0];
    const why = old.status === 'prisoner' ? '사로잡혔' : '세상을 떠났';
    if (heir) {
      heir.ruler = true;
      for (const u of s.units) if (u.nation === n.id) u.morale = Math.max(0, u.morale - 15);
      log(s, `👑 ${n.name}의 군주 ${old.name}이(가) ${why}습니다. ${heir.name}이(가) 뒤를 이었습니다.`, 'capture', [n.id]);
      s.eventsQ = s.eventsQ || [];
      if (n.id === s.playerId || old.captor === s.playerId) s.eventsQ.push({ title: `${n.name}의 군주 교체`, text: `${old.name}이(가) ${why}습니다. ${heir.name}이(가) 뒤를 이었지만 군의 사기가 꺾였습니다.`, faces: [old.name, heir.name], nations: [n.id] });
    } else {
      // 이을 사람이 없음: 나라가 무너짐
      for (const c of s.castles) if (c.owner === n.id) { c.owner = null; c.troops = Math.round(c.troops * 0.5); c.capital = false; }
      for (let i = 0; i < s.owner.length; i++) if (s.owner[i] === n.id) s.owner[i] = -1;
      for (const u of s.units) if (u.nation === n.id) u.dead = true;
      s.units = s.units.filter((u) => !u.dead);
      n.alive = false;
      log(s, `☠️ ${n.name}의 군주 ${old.name}이(가) ${why}고 이을 사람이 없어 나라가 무너졌습니다.`, 'capture', [n.id]);
    }
  }
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

// 성 하나의 한 턴 금 수입
export const castleIncome = (s, grid, c) => goldOf(s, c);
export const landShare = (s, c) => { const tiles = districtTiles(s)[c.id]; return tiles.length ? tiles.filter((t) => s.owner[t] === c.owner).length / tiles.length : 1; };

// ── 턴 마무리: 수입·징병(자원병)·포로·승리 판정 ──
export function endTurn14(s, grid) {
  govTurn(s, grid);
  checkRulers(s);
  buildTurn(s, grid, redistrict);
  s.duelDone = null;
  s.turn += 1;
  s.day = 0;
  rollWeather(s);
  eventsTurn(s, grid);
  const alive = s.nations.filter((n) => n.alive && !n.horde);
  const cities = s.castles.filter((c) => c.kind !== 'pass');
  const top = alive.map((n) => [n, cities.filter((c) => c.owner === n.id).length]).sort((a, b) => b[1] - a[1])[0];
  if (alive.length === 1 || (top && top[1] >= cities.length * 0.8)) s.over = { winner: top[0].id };
  else if (!s.nations[s.playerId].alive && !s.spectator) s.over = { winner: null, lost: true };
}

// 징병: 성에서 금으로 병사를 뽑음 (1명당 10금, 인구의 20%까지)
export const draftCost = (c) => (lv(c, 'barracks') ? 8 : 10);
export const draftMax14 = (s, c) => Math.max(0, Math.min(Math.floor(s.nations[c.owner].gold / draftCost(c) / 100) * 100, Math.floor((c.pop * 1000 * 0.2) / 100) * 100));
export function draft14(s, castleId, amt) {
  const c = s.castles[castleId];
  const n = s.nations[c.owner];
  amt = Math.min(Math.floor(amt / 100) * 100, draftMax14(s, c));
  if (amt < 100) return { ok: false, msg: '뽑을 수 없습니다.' };
  n.gold -= amt * draftCost(c);
  c.troops += amt;
  c.pop = Math.max(1, Math.round((c.pop - amt / 1000) * 10) / 10);
  return { ok: true, msg: `${c.name}에서 ${fmtTroops(amt)} 징병 (금 -${fmtGold(amt * draftCost(c))})` };
}
