// ───────── 삼국지14식 모드: 육각형 칸 위에서 부대가 움직이며 땅을 칠하고, 성을 빼앗는 전쟁 ─────────
// 지도는 기존 세계(world)의 촘촘한 격자를 굵은 육각 칸으로 다시 뽑아 씀 (칸 = 약 2.5천 개)
// 한 턴 = 10일. 모든 부대가 하루씩 동시에 움직이고(통제 구역·칠하기), 붙어 있으면 싸우고(협공), 성을 공격함
import { SQRT3, cellCenter, pixelToCell, hexDistance, neighborIndex, neighborIndexWrap, hexDistanceWrap } from './hex.js';
import { T, DIFFICULTY } from './rules.js';
import { makeRng } from './rng.js';
import { fmtTroops, fmtGold } from './format.js';
import { fixJosa } from './josa.js';
import { getScenario } from './scenarios.js';
import { PLACES, placeExists, placeName } from './places.js';
import { initGov, govTurn, pactOf, addRel, goldOf, SORTIE_COST, ensureTraits } from './hex14gov.js';
import { buildTurn, lv, fortsDay, fortAt } from './hex14build.js';
import { hasPolicy } from './hex14policy.js';
import { outlawTurn, outlawDay, outlawSack } from './hex14outlaw.js';
import { t14, castleGens } from './hex14traits.js';

// 칸 배열(주인·관할)은 Int16Array로 둠: 일반 배열은 structuredClone을 거치면 다시 복사할 때 몇 배 느려짐 (하루마다 상태를 복사하므로)
// 저장(JSON)할 땐 보통 배열로 쓰고, 불러올 땐 다시 Int16Array로
if (!Int16Array.prototype.toJSON) Object.defineProperty(Int16Array.prototype, 'toJSON', { value() { return Array.from(this); }, configurable: true });
export function normalizeHex14(s) {
  if (s?.mode !== 'hex14') return s;
  if (s.owner && !(s.owner instanceof Int16Array)) s.owner = Int16Array.from(s.owner, (v) => (v === null || v === undefined ? -1 : v));
  if (s.district && !(s.district instanceof Int16Array)) s.district = Int16Array.from(s.district, (v) => (v === null || v === undefined ? -1 : v));
  if (s.seen && !(s.seen instanceof Uint8Array)) s.seen = Uint8Array.from(s.seen);
  return s;
}
if (!Uint8Array.prototype.toJSON) Object.defineProperty(Uint8Array.prototype, 'toJSON', { value() { return Array.from(this); }, configurable: true });

// ── 시야(안개): 「지도 전체 공개」를 끄면 내 성 둘레 5칸·내 부대 둘레 4칸만 보임. 「탐색 지역 기억」이면 한 번 본 땅은 s.seen에 남음 ──
export const fogOn = (s) => !s.spectator && s.opts?.revealMap === false;
export const troopsHidden = (s) => !s.spectator && s.opts?.revealTroops === false;
let sightMemo = null;
export function sightOf(s, grid) {
  const key = `${s.turn}:${s.day}:${s.units.length}:${s.castles.reduce((a, c) => a + (c.owner === s.playerId ? c.id + 1 : 0), 0)}`;
  if (sightMemo && sightMemo.s === s && sightMemo.key === key) return sightMemo.v;
  const pid = s.playerId, v = new Uint8Array(grid.N), dist = new Int16Array(grid.N).fill(-1), q = [];
  const allies = new Set([pid, ...(s.pacts || []).filter((p) => p.type === 'ally' && (p.a === pid || p.b === pid) && p.until > s.turn).map((p) => (p.a === pid ? p.b : p.a))]);
  const R = (base) => Math.max(2, Math.round(base * (grid.k || 1)));
  const push = (t, r) => { if (t < 0 || t >= grid.N) return; if (dist[t] < r) { dist[t] = r; q.push(t); } };
  for (const c of s.castles) if (allies.has(c.owner)) push(c.tile, R(5));
  for (const u of s.units) if (allies.has(u.nation)) push(u.tile, R(4));
  // 남은 거리가 큰 것부터 퍼뜨림 (거리 단위 BFS)
  q.sort((a, b) => dist[b] - dist[a]);
  for (let i = 0; i < q.length; i++) { const t = q[i]; v[t] = 1; const r = dist[t] - 1; if (r < 0) continue; for (const j of grid.nb[t]) if (dist[j] < r) { dist[j] = r; q.push(j); } }
  sightMemo = { s, key, v };
  return v;
}
// 포로가 갇힌 성: 잡힌 자리에서 가장 가까운 잡은 나라의 성 (그 성을 잃으면 다시 가장 가까운 성으로) — 등용하면 그 성에서 일함
export function heldAtNearest(s, grid) {
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'prisoner' || g.captor === null || g.captor === undefined) continue;
    if (g.heldAt !== null && g.heldAt !== undefined && s.castles[g.heldAt]?.owner === g.captor) continue;
    const at = g.capTile ?? (g.heldAt != null ? s.castles[g.heldAt]?.tile : null);
    const c = at !== null && at !== undefined ? nearestCastle(s, grid, at, g.captor) : s.castles.find((x) => x.owner === g.captor);
    g.heldAt = c ? c.id : null;
  }
}
export function updateSeen(s, grid) {
  if (!fogOn(s) || s.opts?.rememberExplored === false) return;
  if (!(s.seen instanceof Uint8Array) || s.seen.length !== grid.N) s.seen = new Uint8Array(grid.N);
  const v = sightOf(s, grid);
  for (let i = 0; i < grid.N; i++) if (v[i]) s.seen[i] = 1;
}
import { rollWeather, weatherCost, fireMult, tacticOf, maybeDuel, eventsTurn } from './hex14extra.js';

export const DAYS = 10;
// 지형별 이동 비용(이동력 1 = 하루에 평지 1칸)과 수비 보정
const COST = { [T.PLAINS]: 1, [T.DESERT]: 1.3, [T.TUNDRA]: 1.3, [T.FOREST]: 1.6, [T.HILLS]: 1.6, [T.MOUNTAIN]: 2.5 };
const DEF = { [T.PLAINS]: 1, [T.DESERT]: 1, [T.TUNDRA]: 1, [T.FOREST]: 1.15, [T.HILLS]: 1.25, [T.MOUNTAIN]: 1.35 };
export const TERRAIN_NAME = { [T.PLAINS]: '평지', [T.DESERT]: '사막', [T.TUNDRA]: '동토', [T.FOREST]: '숲', [T.HILLS]: '구릉', [T.MOUNTAIN]: '산지' };

// 칸 하나의 '게임 거리' (지역사는 km, 세계 지도는 기본 30을 칸이 촘촘해진 만큼 나눔) — 지명 찾는 거리·이동 빠르기에 씀
const kmOf = (scn) => scn?.kmPerHex || 30 / (scn?.worldScale || 1);
// 세계 지도 북극 얼음 경계: 이 줄보다 위는 땅이든 바다든 모두 얼음 (들쭉날쭉한 한 줄 경계 — 땅·얼음이 얼룩덜룩 섞이지 않게)
// 둥근 지도에서 이음매가 맞게, 물결 주기를 열 수(cols)로 나누어떨어지게 맞춤
export const iceRow = (c, k = 1, cols = 0) => {
  // 바다 얼음 경계: 큰 물결 + 작은 물결 여러 겹 (위도 약 81~67도 사이를 들쭉날쭉하게)
  const w = (f) => (cols ? (2 * Math.PI * Math.max(1, Math.round((f * cols) / k / (2 * Math.PI)))) / cols : f / k);
  const n = Math.sin(c * w(0.045) + 0.4) * 2.6 + Math.sin(c * w(0.13) + 1.3) * 1.8 + Math.sin(c * w(0.31) + 0.7) * 1.1 + Math.sin(c * w(0.71) + 2.1) * 0.6 + Math.sin(c * w(1.37) + 0.2) * 0.35;
  return k * (8 + n);
};
// 땅 위 얼음(만년설로 덮여 못 감): 바다 얼음보다 훨씬 위쪽만
export const landIceRow = (c, k = 1, cols = 0) => Math.max(1.5 * k, iceRow(c, k, cols) * 0.35);
// ── 칸 지도 (저장하지 않고 world에서 매번 만듦) ──
// 같은 지도로 여러 번 부르면(게임 만들 때 · 화면 띄울 때) 한 번만 만듦
const gridCache = new WeakMap();
export function buildGrid(world) {
  if (gridCache.has(world)) return gridCache.get(world);
  const g = buildGrid0(world);
  gridCache.set(world, g);
  return g;
}
function buildGrid0(world) {
  const size = world.unit * 0.6; // 칸 크기 (기존 지역 지도보다 촘촘하게)
  // 세계 지도(경도 360도)는 동서가 이어진 둥근 지도: 열을 감고, 한 바퀴 폭(period)이 지도 폭을 넘지 않게 열 수를 내림
  const bb0 = getScenario(world.scenarioId)?.bbox;
  const wrapX = !!bb0 && bb0[2] - bb0[0] >= 359;
  const cols = wrapX ? Math.floor(world.W / (size * SQRT3)) : Math.ceil(world.W / (size * SQRT3)), rows = Math.ceil((world.H - size) / (1.5 * size)) + 1;
  const N = cols * rows;
  const terrain = new Uint8Array(N), region = new Int16Array(N).fill(-1), river = new Uint8Array(N), outside = new Uint8Array(N), ice = new Uint8Array(N); // ice: 북극 얼음(배도 못 감)
  for (let i = 0; i < N; i++) {
    const [x, y] = cellCenter(size, cols, i);
    const f = pixelToCell(world.size, world.cols, world.rows, x, y);
    if (f < 0) continue;
    terrain[i] = world.terrain[f];
    river[i] = world.river[f] ? 1 : 0;
    if (world.outside?.[f]) { outside[i] = 1; continue; } // 외지: 땅이지만 지나갈 수 없음
    const r = world.region[f];
    if (r >= 0 && !world.regions[r].sea && terrain[i] !== T.SEA && terrain[i] !== T.PEAK) region[i] = r;
  }
  // 실제 해안선으로 칸마다 땅·바다를 다시 판정 (굵은 지역 격자에서 옮겨 오며 해안이 한 칸씩 어긋나지 않게)
  if (world.isLand) {
    const isL = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const [x, y] = cellCenter(size, cols, i);
      let n = world.isLand(x, y) ? 1 : 0;
      for (let d = 0; d < 6; d++) { const a = (Math.PI / 3) * d + Math.PI / 6; if (world.isLand(x + Math.cos(a) * size * 0.55, y + Math.sin(a) * size * 0.55)) n++; }
      isL[i] = n >= 4 ? 1 : 0;
    }
    const nbs = (i) => { const o = []; for (let d = 0; d < 6; d++) { const j = neighborIndex(cols, rows, i, d); if (j >= 0) o.push(j); } return o; };
    // 바다로 옮겨졌지만 실제로는 땅인 칸: 옆 땅 칸의 지형·지역을 이어받음
    for (let pass = 0; pass < 3; pass++) {
      const fix = [];
      for (let i = 0; i < N; i++) if (isL[i] && terrain[i] === T.SEA) { const j = nbs(i).find((x) => terrain[x] !== T.SEA); if (j !== undefined) fix.push([i, j]); }
      for (const [i, j] of fix) { terrain[i] = terrain[j] === T.PEAK ? T.MOUNTAIN : terrain[j]; region[i] = region[j]; outside[i] = outside[j]; }
      if (!fix.length) break;
    }
    // 땅으로 옮겨졌지만 실제로는 바다인 칸: 바다로
    for (let i = 0; i < N; i++) if (!isL[i] && terrain[i] !== T.SEA) { terrain[i] = T.SEA; region[i] = -1; outside[i] = 0; river[i] = 0; }
  }
  // 세계 지도: 북극·날짜변경선에서 땅이 일직선으로 잘려 보이지 않게 가장자리를 들쭉날쭉한 바다로
  const bb = getScenario(world.scenarioId)?.bbox;
  if (bb && bb[2] - bb[0] >= 359) {
    const ws = getScenario(world.scenarioId)?.worldScale || 1;
    for (let i = 0; i < N; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const lim = iceRow(c, ws, wrapX ? cols : 0);
      if (r < landIceRow(c, ws, wrapX ? cols : 0) || (r < lim && terrain[i] === T.SEA)) { terrain[i] = T.SEA; river[i] = 0; region[i] = -1; outside[i] = 0; ice[i] = 1; }
    }
  }
  const nb = [];
  for (let i = 0; i < N; i++) {
    const list = [];
    for (let d = 0; d < 6; d++) { const j = wrapX ? neighborIndexWrap(cols, rows, i, d) : neighborIndex(cols, rows, i, d); if (j >= 0) list.push(j); }
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
  // 바다 전체 (깊은 바다 포함): 항구에서 나온 부대만 깊은 바다를 건넘, 얕은 바다(water)는 누구나
  const sea = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (terrain[i] === T.SEA && !ice[i]) sea[i] = 1;
  for (let i = 0; i < N; i++) if (ice[i]) water[i] = 0;
  const tilesOf = world.regions.map(() => []);
  for (let i = 0; i < N; i++) if (region[i] >= 0) tilesOf[region[i]].push(i);
  // 위도: 실제 지도면 지도 좌표에서, 무작위 지도면 위(북위 60)~아래(남위 10)로 셈 — 지역 날씨용
  const latAt = world.geo ? (x, y) => world.geo.toLL(x, y)[1] : (x, y) => 60 - (y / world.H) * 70;
  // 이웃 칸을 한 줄짜리 숫자 배열로도 둠 (칸마다 6칸, 없으면 -1): 날마다 지도 전체를 훑는 계산에서 작은 배열 수십만 개를 도는 것보다 빠름
  const nbf = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < N; i++) { const l = nb[i]; for (let d = 0; d < l.length && d < 6; d++) nbf[i * 6 + d] = l[d]; }
  return { nbf, latAt, size, cols, rows, N, terrain, region, river, outside, ice, nb, center, passable, castleTile, tilesOf, water, sea, W: world.W, H: world.H, wrap: wrapX, period: cols * size * SQRT3, dist: wrapX ? (a, b) => hexDistanceWrap(cols, a, b) : (a, b) => hexDistance(cols, a, b), k: (world.unit / size) * (getScenario(world.scenarioId)?.worldScale || 1) }; // k: 거리 기준(칸) — 세계 지도는 칸이 촘촘해진 만큼 늘림
}

// 삼국지14의 도시(200년 무렵)와 관문: [이름, 경도, 위도, 종류] — 큰 도시(BIG)는 인구가 많고 변방(EDGE)은 적음
const BIG = new Set(['낙양', '장안', '업', '허창', '성도', '건업', '양양', '계', '남피', '하비', '수춘', '오', '강릉', '완', '진류', '북해', '복양', '여남']);
const EDGE = new Set(['건안', '후관', '여릉', '창오', '울림', '합포', '구진', '장가', '영창', '월수', '금성', '장액', '주천', '무도', '구원', '운중', '대', '상곡', '탄한산', '유성', '현도', '낙랑', '대방', '국내성', '부여성', '목지국', '사로', '구야', '양평', '북평', '무위', '서평', '천수', '안정', '운남', '건녕', '교지', '남해', '계양', '영릉', '무릉', '회계', '시상', '상용', '영안', '재동', '강주', '한중']);
const TK_CITIES = [
  ['양평', 123.17, 41.27], ['북평', 118.5, 40.9], ['계', 116.4, 39.9], ['남피', 116.7, 38.05], ['평원', 116.45, 37.1], ['업', 114.35, 36.33],
  ['진양', 112.55, 37.87], ['북해', 119.1, 36.7], ['복양', 115.0, 35.75], ['진류', 114.6, 34.6], ['허창', 113.85, 34.03], ['여남', 114.6, 33.0],
  ['소패', 116.9, 34.75], ['하비', 118.0, 34.1], ['수춘', 116.78, 32.57], ['초', 115.8, 33.85], ['낙양', 112.45, 34.62], ['장안', 108.94, 34.34],
  ['천수', 105.72, 34.58], ['안정', 106.7, 35.5], ['무위', 102.64, 37.93], ['완', 112.53, 33.0], ['신야', 112.35, 32.5], ['상용', 110.8, 32.3],
  ['양양', 112.14, 32.04], ['강릉', 112.19, 30.35], ['강하', 114.3, 30.6], ['장사', 112.94, 28.23], ['무릉', 111.7, 29.0], ['영릉', 111.6, 26.4],
  ['계양', 113.0, 25.8], ['여강', 117.0, 31.4], ['건업', 118.78, 32.06], ['오', 120.62, 31.3], ['회계', 120.58, 30.0], ['시상', 115.98, 29.7],
  ['한중', 107.03, 33.07], ['재동', 105.2, 31.6], ['성도', 104.06, 30.66], ['강주', 106.5, 29.55], ['영안', 109.5, 31.05], ['건녕', 103.8, 25.5],
  ['운남', 100.6, 25.5], ['교지', 105.85, 21.03], ['남해', 113.26, 23.13], ['서평', 101.78, 36.62],
  // 변방·남방·한반도 (손권 땅 남쪽, 북방 이민족, 한반도 나라들이 성 없이 비지 않게)
  ['건안', 118.32, 27.05], ['후관', 119.3, 26.08], ['예장', 115.89, 28.68], ['여릉', 114.98, 27.11], ['단양', 118.75, 30.95], ['창오', 111.28, 23.48],
  ['울림', 109.6, 23.1], ['합포', 109.2, 21.48], ['구진', 105.77, 19.8], ['장가', 106.7, 26.6], ['영창', 99.17, 25.1], ['월수', 102.27, 27.9],
  ['금성', 103.8, 36.06], ['장액', 100.45, 38.93], ['주천', 98.5, 39.73], ['무도', 105.9, 33.4], ['구원', 109.8, 40.6], ['운중', 111.6, 40.6],
  ['대', 114.6, 39.8], ['상곡', 115.5, 40.4], ['탄한산', 112.5, 41.8], ['유성', 120.45, 41.57], ['현도', 123.9, 41.9], ['낙랑', 125.75, 39.02],
  ['대방', 126.2, 38.0], ['국내성', 126.18, 41.13], ['부여성', 126.55, 43.84], ['목지국', 127.15, 36.8], ['사로', 129.22, 35.84], ['구야', 128.88, 35.23],
];

// 이름을 붙일 때 가까운 후보 중 먼저 고르는 큰 고을 (작은 지명에 밀리지 않게)
const MAJOR = new Set(['삿포로', '하코다테', '센다이', '에도', '교토', '오사카', '하카타', '한양', '평양', '개성', '경주', '북경', '남경', '서안', '낙양', '성도', '광주', '항주', '심양', '상트페테르부르크', '모스크바', '런던', '파리', '로마', '이스탄불', '카이로', '바그다드', '델리']);
// 도시 자리 고르기: 삼국지면 위 목록, 아니면 지역 4곳당 도시 1곳(큰 지역·실제 지명·수도 우선, 서로 떨어지게)
function pickCities(world, grid, base, tileOwner = null) {
  const near = (t0) => {
    if (t0 >= 0 && grid.passable(t0)) return t0;
    let best = -1, bd = Infinity;
    const [x0, y0] = t0 >= 0 ? grid.center(t0) : [0, 0];
    for (let i = 0; i < grid.N; i++) if (grid.passable(i)) { const [x, y] = grid.center(i); const d = (x - x0) ** 2 + (y - y0) ** 2; if (d < bd) { bd = d; best = i; } }
    return bd < (grid.size * 4) ** 2 ? best : -1;
  };
  const out = [];
  const far = (t, m) => out.every((c) => grid.dist(c.tile, t) >= m);
  // 얼음땅: 그린란드 빙상·캐나다 북쪽(북위 63도 위)·북위 71도 위는 사람이 거의 살지 않았으므로 주인 없는 성을 두지 않음 (나라 땅이면 그대로)
  const frozen = (t) => {
    if (!world.geo || t < 0) return false;
    const [lon, lat] = world.geo.toLL(...grid.center(t));
    const glW = lat < 70 ? -57.5 : lat < 75 ? -62 : lat < 78 ? -68 : -73;
    return (lon > glW && lon < -10 && lat > 59.5) || lat > 71 || (lat > 63 && lon > -141 && lon < -60);
  };
  // 그린란드 남서쪽 노르드인 정착지: 있던 시대 판에서만 성으로
  {
    const yr = getScenario(base.scenarioId)?.startYear;
    // 브라타흘리드(동부 정착지)는 985~1450년 무렵, 서부 정착지는 1000~1350년 무렵까지
    if (world.geo) for (const [name, lon, lat, y0, y1] of [['브라타흘리드', -45.5, 61.15, 985, 1450], ['서부 정착지', -51.0, 64.3, 1000, 1350]]) {
      if (!(yr >= y0 && yr <= y1)) continue;
      const [x, y] = world.geo.toPx(lon, lat);
      if (x < 0 || y < 0 || x > world.W || y > world.H) continue;
      const t = near(pixelToCell(grid.size, grid.cols, grid.rows, x, y));
      if (t >= 0 && far(t, 2)) out.push({ name, tile: t, kind: 'city', pop: 20, norse: true });
    }
  }
  // 빈 땅 메우기: 성 사이 보통 간격보다 훨씬 먼 곳(나라 땅이든 빈 땅이든)에 성을 더 둠 — 어느 지역은 성이 빽빽하고 어느 곳은 텅 비지 않게
  let fillPts = null;
  const snapMajor = (onlyFrom = 0) => {
    // 큰 고을(삿포로·한양 등) 자리 가까이에 성이 있으면 성을 그 자리로 옮김 (섬 끝자락 같은 엉뚱한 곳에 서지 않게)
    if (world.geo) for (const p of PLACES) {
      if (!MAJOR.has(p.name)) continue;
      const [x, y] = world.geo.toPx(p.lon, p.lat);
      if (x < 0 || y < 0 || x > world.W || y > world.H) continue;
      const pt = pixelToCell(grid.size, grid.cols, grid.rows, x, y);
      if (pt < 0 || !grid.passable(pt) || out.some((c) => c.tile === pt)) continue;
      const near = out.slice(onlyFrom).filter((c) => c.capitalOf === undefined).map((c) => [c, grid.dist(c.tile, pt)]).sort((a, b) => a[1] - b[1])[0];
      if (near && near[1] <= 6 && out.every((c) => c === near[0] || grid.dist(c.tile, pt) >= 3)) near[0].tile = pt;
    }
  };
  const fillGaps = (mult, minGap = 0) => {
    if (out.length < 3) return;
    const nn = out.map((c) => { let m = Infinity; for (const d of out) if (d !== c) m = Math.min(m, grid.dist(c.tile, d.tile)); return m; }).sort((a, b) => a - b);
    const gapN = Math.max(4, minGap, nn[Math.floor(nn.length / 2)] * mult);
    // 땅 덩어리 크기 (아주 작은 섬에는 안 둠)
    const comp = new Int32Array(grid.N).fill(-1), csize = [];
    for (let i = 0; i < grid.N; i++) { if (comp[i] >= 0 || !grid.passable(i)) continue; const q = [i]; comp[i] = csize.length; for (let k = 0; k < q.length; k++) for (const j of grid.nb[q[k]]) if (comp[j] < 0 && grid.passable(j)) { comp[j] = csize.length; q.push(j); } csize.push(q.length); }
    // 실제 거리 보정: 세계 지도는 위도가 높을수록 칸이 실제보다 작음(지도가 옆으로 늘어남) → 칸 수로 같은 간격이면 북쪽에 성이 몇 배 빽빽해짐
    // 칸 하나의 실제 길이 ∝ cos(위도). 주인 없는 땅(나라 땅 아님)은 조금 더 듬성듬성
    const whole = !!world.geo?.whole;
    const kOf = new Float32Array(grid.N).fill(1);
    if (whole) for (let i = 0; i < grid.N; i++) { if (!grid.passable(i)) continue; const [x, y] = grid.center(i); const la = grid.latAt(x, y); const own = base.regions[grid.region[i]]?.owner; kOf[i] = Math.max(0.3, Math.min(1.15, Math.cos((la * Math.PI) / 180) / Math.cos((35 * Math.PI) / 180))) * (own === null || own === undefined || own < 0 ? 0.8 : 1); }
    const frozenT = new Uint8Array(grid.N); if (world.geo) for (let i = 0; i < grid.N; i++) if (grid.passable(i) && frozen(i) && (base.regions[grid.region[i]]?.owner ?? -1) < 0) frozenT[i] = 1;
    const dist = new Float32Array(grid.N).fill(Infinity);
    const spread = (src) => { const q = [src]; dist[src] = 0; for (let k = 0; k < q.length; k++) { const x = q[k], dx = dist[x] + kOf[x]; if (dx > gapN * 1.5) continue; for (const j of grid.nb[x]) if (grid.passable(j) && dx < dist[j]) { dist[j] = dx; q.push(j); } } };
    for (const c of out) spread(c.tile);
    // 지도·무대 가장자리 쏠림 막기: 가장 먼 빈 곳을 고르면 가장자리(그 너머엔 아무것도 없음)가 늘 가장 멀어 성이 테두리를 따라 한 줄로 늘어섬
    // → 지도 끝 줄·외지와 맞닿은 칸에서 가까울수록 감점(가장자리에서 간격의 절반), 칸마다 고정된 작은 흔들림을 더해 일렬로 서지 않게 (바닷가는 그대로)
    const edgeD = new Float32Array(grid.N).fill(Infinity);
    {
      const q = [];
      for (let i = 0; i < grid.N; i++) {
        if (!grid.passable(i)) continue;
        const r = (i / grid.cols) | 0, c = i % grid.cols;
        const border = r <= 1 || r >= grid.rows - 2 || (!grid.wrap && (c <= 1 || c >= grid.cols - 2)) || grid.nb[i].some((j) => grid.outside?.[j]);
        if (border) { edgeD[i] = 0; q.push(i); }
      }
      for (let k = 0; k < q.length; k++) { const x = q[k], dx = edgeD[x] + 1; if (dx > gapN) continue; for (const j of grid.nb[x]) if (grid.passable(j) && dx < edgeD[j]) { edgeD[j] = dx; q.push(j); } }
    }
    const edgePen = (i) => Math.max(0, gapN * 0.5 - edgeD[i]);
    const jit = (i) => -((((i * 2654435761) >>> 0) % 1000) / 1000) * gapN * 0.3; // 0 ~ −0.3칸: 순서만 흔들고 성 수는 늘리지 않음
    for (let it = 0; it < 400; it++) {
      let bt = -1, bd = gapN * 0.9; // 흔들림(평균 −0.15칸)만큼 기준을 낮춰 성 수는 예전과 비슷하게
      for (let i = 0; i < grid.N; i++) {
        if (!grid.passable(i) || grid.terrain[i] === T.PEAK || frozenT[i]) continue;
        // 산지도 성이 없으면 세움 (실제로도 산간 요새·고을이 있었음) — 다만 같은 거리면 평지를 먼저
        const d0 = dist[i] === Infinity ? (csize[comp[i]] >= gapN * gapN * 0.2 ? gapN * 1.5 : 0) : dist[i];
        const d = (grid.terrain[i] === T.MOUNTAIN ? d0 - 0.6 : d0) - (d0 === Infinity ? 0 : edgePen(i) - jit(i));
        if (d > bd) { bd = d; bt = i; }
      }
      if (bt < 0) break;
      // 빈 곳 가까이에 실제 고을 자리가 있으면 그 자리에 세움 (예: 홋카이도 빈 곳 → 삿포로)
      if (world.geo) {
        if (!fillPts) fillPts = PLACES.filter((p) => !p.area).map((p) => { const [x, y] = world.geo.toPx(p.lon, p.lat); return { t: x >= 0 && y >= 0 && x <= world.W && y <= world.H ? pixelToCell(grid.size, grid.cols, grid.rows, x, y) : -1, major: MAJOR.has(p.name) }; }).filter((p) => p.t >= 0 && grid.passable(p.t) && grid.terrain[p.t] !== T.PEAK);
        let st = -1, sd = Math.max(2, gapN * 0.45);
        for (const { t: pt, major } of fillPts) { const d = grid.dist(pt, bt) - (major ? 3 : 0); if (d < sd && dist[pt] >= gapN * 0.5 && !frozenT[pt] && !out.some((c) => c.tile === pt)) { sd = d; st = pt; } }
        if (st >= 0) bt = st;
      }
      out.push({ name: base.regions[grid.region[bt]]?.name || '', tile: bt, kind: 'city', fill: true });
      spread(bt);
    }
  };
  if (/^threekingdoms/.test(base.scenarioId) && world.geo) {
    for (const [name, lon, lat, kind] of TK_CITIES) {
      const [x, y] = world.geo.toPx(lon, lat);
      if (x < 0 || y < 0 || x > world.W || y > world.H) continue;
      const t = near(pixelToCell(grid.size, grid.cols, grid.rows, x, y));
      if (t < 0 || !far(t, 2)) continue;
      out.push({ name, tile: t, kind: kind || 'city', pop: BIG.has(name) ? 90 : EDGE.has(name) ? 35 : 55 });
    }
  }
  // 삼국지: 시나리오에 적힌 수도 이름의 도시가 그 나라 수도
  if (/^threekingdoms/.test(base.scenarioId)) {
    const sn = getScenario(base.scenarioId)?.nations || [];
    base.nations.forEach((n, i) => { if (!n.alive) return; const c = out.find((x) => x.name === sn[i]?.capital && x.capitalOf === undefined); if (c) c.capitalOf = n.id; });
  }
  // 나라 수도는 꼭 도시로
  for (const n of base.nations) {
    if (!n.alive || out.some((c) => c.capitalOf === n.id)) continue;
    const t = grid.castleTile[n.capital];
    if (t < 0) continue;
    if (out.some((c) => grid.region[c.tile] === n.capital)) continue;
    if (!far(t, 3)) { const c = out.filter((c) => c.kind === 'city').sort((a, b) => grid.dist(a.tile, t) - grid.dist(b.tile, t))[0]; if (c) { c.capitalOf = n.id; continue; } }
    out.push({ name: base.regions[n.capital].name, tile: t, kind: 'city', capitalOf: n.id });
  }
  // 삼국지: 정해진 도시 사이 빈 곳(한반도·북방·남방 등)을 메우고, 가까운 실제 지명 + 방위로 이름을 붙임
  if (/^threekingdoms/.test(base.scenarioId) && world.geo) {
    const before = out.length;
    // 세계판: 중원 도시 간격으로 온 세상을 메우면 성이 너무 많아짐 → 땅 넓이로 최소 간격을 정함 (다른 세계판과 비슷한 성 수)
    fillGaps(1.45, world.geo.whole ? Math.sqrt(grid.terrain.reduce((a, t, i) => a + (grid.passable(i) ? 1 : 0), 0) / 420) : 0);
    const pts = PLACES.filter((p) => !p.area).map((p) => { const [x, y] = world.geo.toPx(p.lon, p.lat); return { name: p.name, t: pixelToCell(grid.size, grid.cols, grid.rows, x, y) }; }).filter((p) => p.t >= 0);
    const used = new Set(out.map((c) => c.name));
    const D8 = ['동부', '남동부', '남부', '남서부', '서부', '북서부', '북부', '북동부'];
    for (const c of out.slice(before)) {
      let nm = null;
      for (const p of pts.slice().sort((a, b) => grid.dist(a.t, c.tile) - grid.dist(b.t, c.tile)).slice(0, 8)) {
        const d = grid.dist(p.t, c.tile);
        let cand = p.name;
        if (d > 2) { const [x0, y0] = grid.center(p.t), [x1, y1] = grid.center(c.tile); cand = `${p.name} ${D8[((Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) % 8) + 8) % 8]}`; }
        if (!used.has(cand)) { nm = cand; break; }
      }
      // 가까운 지명+방위가 다 쓰였으면: 더 먼 지명까지 보고, 그래도 없으면 '외곽·변방·벌판…'을 붙임 (번호는 붙이지 않음)
      if (!nm) for (const p of pts.slice().sort((a, b) => grid.dist(a.t, c.tile) - grid.dist(b.t, c.tile)).slice(8, 30)) { const [x0, y0] = grid.center(p.t), [x1, y1] = grid.center(c.tile); const cand = `${p.name} ${D8[((Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) % 8) + 8) % 8]}`; if (!used.has(cand)) { nm = cand; break; } }
      if (!nm) { const b0 = (c.name || '변경').replace(/ (동|남동|남|남서|서|북서|북|북동)부$/, ''); nm = ['외곽', '변방', '벌판', '오지', '나루', '고개', '들', '언덕'].map((x) => `${b0} ${x}`).find((x) => !used.has(x)) || `${b0} 변경`; }
      c.name = nm;
      c.pop = 30;
      used.add(c.name);
    }
  }
  // 그 밖(삼국지가 아닌 판): 나라마다 자기 땅 지역 4곳당 1곳(최소 2곳), 남은 빈 땅도 4곳당 1곳 — 큰 지역부터, 서로 떨어지게
  if (!/^threekingdoms/.test(base.scenarioId) || !world.geo) {
    const land = world.regions.filter((r) => !r.sea && grid.castleTile[r.id] >= 0);
    const gap = Math.max(3, Math.round(Math.sqrt(grid.region.filter((r) => r >= 0).length / Math.max(1, land.length / 4)) * 0.75));
    const groups = new Map();
    for (const r of land) { const o = base.regions[r.id].owner ?? -1; if (!groups.has(o)) groups.set(o, []); groups.get(o).push(r); }
    // 칸이 촘촘한 좁은 무대(한반도·일본 등, 한 칸 20km 이하)는 성을 더 많이 둠
    const per = kmOf(getScenario(base.scenarioId)) <= 20 ? 2.5 : 4;
    // 넓이 기준도 함께: 변방의 큰 나라(지역 하나하나가 넓음)도 땅 넓이만큼 성을 가짐 (중원만 성이 빽빽하지 않게)
    const tilesOfRegs = (regs) => regs.reduce((a, r) => a + (grid.tilesOf[r.id]?.length || 0), 0);
    const ownedGroups = [...groups].filter(([o]) => o !== -1);
    const allTiles = ownedGroups.reduce((a, [, regs]) => a + tilesOfRegs(regs), 0);
    const allWant = ownedGroups.reduce((a, [, regs]) => a + Math.max(2, Math.round(regs.length / per)), 0);
    const tpc = allTiles / Math.max(1, allWant); // 성 하나당 평균 칸 수
    for (const [o, regs] of groups) {
      const byArea = Math.round((tilesOfRegs(regs) / tpc) ** 0.8 * 1.2); // 아주 넓은 나라(시베리아 등)는 덜 늘림
      const want = o === -1 ? Math.round(regs.length / per) : Math.max(2, Math.round(regs.length / per), byArea);
      let have = out.filter((c) => (base.regions[grid.region[c.tile]]?.owner ?? -1) === o).length;
      const order = regs.slice().sort((a, b) => (base.regions[b.id].pop || 0) - (base.regions[a.id].pop || 0));
      for (const g of [gap, Math.max(2, Math.round(gap / 2)), 2]) for (const r of order) {
        if (have >= Math.min(want, regs.length)) break;
        const t = grid.castleTile[r.id];
        if (out.some((c) => c.tile === t) || !far(t, g) || (o === -1 && frozen(t))) continue;
        out.push({ name: base.regions[r.id].name, tile: t, kind: 'city' });
        have += 1;
      }
      // 지역이 넓어 성이 모자라면: 그 나라 땅에서 다른 성과 가장 먼 칸에 성을 더 둠 (넓은 땅이 텅 비지 않게)
      if (o !== -1 && have < want) {
        const cand = regs.flatMap((r) => grid.tilesOf[r.id] || []).filter((i) => grid.terrain[i] !== T.MOUNTAIN && grid.terrain[i] !== T.PEAK);
        while (have < want && cand.length) {
          let bt = -1, bd = -1;
          for (let k = 0; k < cand.length; k += 3) { const i = cand[k]; let m = Infinity; for (const c of out) { const d = grid.dist(c.tile, i); if (d < m) m = d; if (m <= bd) break; } if (m > bd) { bd = m; bt = i; } }
          if (bt < 0 || bd < Math.max(3, gap * 0.8)) break;
          out.push({ name: base.regions[grid.region[bt]].name, tile: bt, kind: 'city' });
          have += 1;
        }
      }
    }
    // 역사 강역(칸 단위) 기준으로 다시: 나라마다 그 땅 넓이만큼 성이 있게 (지역 단위로는 작게 잡히는 나라 보충)
    if (tileOwner) {
      const ownT = new Map();
      for (let i = 0; i < grid.N; i++) { if (!grid.passable(i) || grid.terrain[i] === T.MOUNTAIN || grid.terrain[i] === T.PEAK) continue; const o = tileOwner(i); if (o < 0) continue; if (!ownT.has(o)) ownT.set(o, []); ownT.get(o).push(i); }
      for (const [o, tiles] of ownT) {
        const want = Math.max(2, Math.round((tiles.length / tpc) ** 0.8 * 1.1));
        let have = out.filter((c) => tileOwner(c.tile) === o).length;
        while (have < want) {
          let bt = -1, bd = -1;
          for (let k = 0; k < tiles.length; k += 2) { const i = tiles[k]; let m = Infinity; for (const c of out) { const d = grid.dist(c.tile, i); if (d < m) m = d; if (m <= bd) break; } if (m > bd) { bd = m; bt = i; } }
          if (bt < 0 || bd < Math.max(3, Math.min(gap * 0.6, Math.sqrt(tiles.length) * 0.6))) break;
          out.push({ name: base.regions[grid.region[bt]].name, tile: bt, kind: 'city' });
          have += 1;
        }
      }
    }
    // 성 이름: 지역 이름('○○ 남서부' 같은 방위 이름 포함) 대신, 성 자리에서 가까운 그 시대의 실제 지명을 씀
    if (world.geo) {
      const year = getScenario(base.scenarioId)?.startYear ?? 1;
      const used = new Set(out.filter((c) => c.capitalOf !== undefined).map((c) => c.name));
      const pts = PLACES.filter((p) => placeExists(p, year) && !p.area).map((p) => { const [x, y] = world.geo.toPx(p.lon, p.lat); return { name: placeName(p, year), t: pixelToCell(grid.size, grid.cols, grid.rows, x, y), ok: x >= 0 && y >= 0 && x <= world.W && y <= world.H }; }).filter((p) => p.ok && p.t >= 0);
      // 찾는 거리는 km로: 가까운 곳 100km, 나라 성은 170km·빈 땅 성은 130km까지 (더 멀면 엉뚱한 고을 이름이 붙음)
      const km = kmOf(getScenario(base.scenarioId));
      const R = Math.max(2, Math.round(100 / km)), Rown = Math.max(R, Math.round(170 / km)), Rfree = Math.max(R, Math.round(130 / km));
      // 수도 자리에 있는 지명은 수도가 이미 그곳이므로 다른 성에 붙이지 않음 (완산주 옆에 '전주'가 또 생기지 않게)
      const caps = out.filter((c) => c.capitalOf !== undefined);
      const free = pts.filter((p) => !caps.some((c) => grid.dist(c.tile, p.t) <= 1));
      const pairs = [];
      for (const c of out) {
        if (c.capitalOf !== undefined || c.norse) continue;
        const own = (base.regions[grid.region[c.tile]]?.owner ?? null) !== null;
        for (const p of free) { const d = grid.dist(c.tile, p.t); if (d <= (own ? Rown : Rfree)) pairs.push([d + (d > R ? 100 : 0) - (MAJOR.has(p.name) ? 2.5 : 0), c, p.name]); }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      const done = new Set();
      for (const [, c, nm] of pairs) { if (done.has(c) || used.has(nm)) continue; c.name = nm; done.add(c); used.add(nm); }
      // 실제 지명을 못 찾은 성: 주인 없는 황무지(초원·동토 등)면 성을 두지 않고, 나라 땅이면 지역 이름 그대로
      for (let k = out.length - 1; k >= 0; k--) {
        const c = out[k];
        if (done.has(c) || c.capitalOf !== undefined || c.norse) continue; // 노르드 정착지는 이름 그대로
        if ((base.regions[grid.region[c.tile]]?.owner ?? null) === null && !c.fill && !/^threekingdoms/.test(base.scenarioId)) out.splice(k, 1);
      }
      // 이름 없는 빈 땅 성을 뺀 다음에 빈 곳 메우기 (먼저 메우면 나중에 빠진 자리가 다시 텅 빔) — 새 성은 가까운 실제 지명으로
      const nBefore = out.length;
      fillGaps(world.geo.whole ? 1.45 : 1.3);
      snapMajor(nBefore);
      for (const c of out.slice(nBefore)) {
        let best = null, bd = Infinity;
        for (const p of free) { if (used.has(p.name)) continue; const d = grid.dist(c.tile, p.t) - (MAJOR.has(p.name) ? 2.5 : 0); if (d <= Rfree * 1.5 && d < bd) { bd = d; best = p; } }
        if (best) { c.name = best.name; used.add(best.name); done.add(c); }
      }
      // 지명 사전에 없는 지어낸 지역 이름(예: '국벌')이 남은 성은 가장 가까운 실제 지명 + 방위로
      // 남겨도 되는 이름: 그 시대에 있던 실제 고을·부족 이름 (강·초원 같은 넓은 땅 이름이나 후대 이름은 바꿈)
      const known = new Set(pts.map((p) => p.name));
      const DIRS8 = ['동부', '남동부', '남부', '남서부', '서부', '북서부', '북부', '북동부'];
      for (const c of out) {
        if (done.has(c) || c.capitalOf !== undefined || c.norse) continue; // 노르드 정착지는 이름 그대로
        const baseNm = c.name.replace(/ (동|남동|남|남서|서|북서|북|북동)부$/, '');
        if (known.has(baseNm)) continue;
        let best = null, bd = Infinity;
        for (const p of pts) { const d = grid.dist(c.tile, p.t); if (d < bd) { bd = d; best = p; } }
        if (!best) continue;
        const [x0, y0] = grid.center(best.t), [x1, y1] = grid.center(c.tile);
        const k = ((Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) % 8) + 8) % 8; // 화면 좌표: y가 아래로
        c.name = `${best.name} ${DIRS8[k]}`;
      }
      // 같은 이름이 둘이면(지역 이름이 다른 성의 지명과 겹침) 뒤의 것은 '외곽'을 붙여 구별
      const seen = new Set();
      // 겹치면: 가까운 실제 지명들 + 방위('○○ 북부')로 먼저 찾아보고, 그래도 겹치면 '외곽'
      const dirName = (c, p) => { const [x0, y0] = grid.center(p.t), [x1, y1] = grid.center(c.tile); const k = ((Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) % 8) + 8) % 8; return `${p.name} ${DIRS8[k]}`; };
      for (const c of out) {
        if (seen.has(c.name)) {
          let nm = null;
          for (const p of pts.slice().sort((a, b) => grid.dist(a.t, c.tile) - grid.dist(b.t, c.tile)).slice(0, 6)) { const d = grid.dist(p.t, c.tile); const cand = d <= 1 ? p.name : dirName(c, p); if (!seen.has(cand)) { nm = cand; break; } }
          if (!nm) { let k = 2; nm = `${c.name} 외곽`; while (seen.has(nm)) nm = `${c.name} 외곽${k++}`; }
          c.name = nm;
        }
        seen.add(c.name);
      }
    }
  }
  return out;
}

// 관할 구역: 도시마다 가장 가까운(길 기준) 칸들
// landOwner(칸)가 있으면: 먼저 성마다 '같은 주인의 땅'으로만 넓히고(나라 땅은 그 나라 성이 맡음), 남은 칸을 가까운 성이 맡음
function districts(grid, cities, landOwner = null) {
  const own = new Array(grid.N).fill(-1);
  const q = [];
  cities.forEach((c, i) => { if (c.kind !== 'city' || c.founding) return; own[c.tile] = i; q.push(c.tile); });
  const spread = (ok) => {
    for (let k = 0; k < q.length; k++) {
      const t = q[k];
      for (const nx of grid.nb[t]) {
        if (!grid.passable(nx) || own[nx] >= 0 || (ok && !ok(nx, own[t]))) continue;
        own[nx] = own[t];
        q.push(nx);
      }
    }
  };
  if (landOwner) {
    spread((nx, ci) => landOwner(nx) === (cities[ci].owner ?? -1));
    // 둘째 단계: 아직 아무도 안 맡은 칸을 이미 맡은 칸들에서 다시 넓힘
    q.length = 0;
    for (let i = 0; i < grid.N; i++) if (own[i] >= 0) q.push(i);
  }
  spread(null);
  return own;
}

// 새 도시가 생기면 관할 구역을 다시 나눔
export function redistrict(s, grid) {
  s.district = Int16Array.from(districts(grid, s.castles, (i) => s.owner?.[i] ?? -1));
}

// ── 새 판: 기존 게임 설정(나라·장수·지역 병력)을 칸 지도와 도시로 옮김 ──
export function createHex14(world, base) {
  const grid = buildGrid(world);
  const regOwner0 = (t) => { const o = base.regions[grid.region[t]]?.owner; return o === null || o === undefined ? -1 : o; };
  // 역사 강역(상자)이 있는 판: 칸 하나하나를 그 칸 경위도가 든 가장 작은 상자의 나라로 — 지역(큰 덩어리) 단위보다 국경이 실제에 가깝게
  const scnN = getScenario(base.scenarioId)?.nations || [];
  const boxes = [];
  // 세계 지도만 (지역사는 지역 단위 경계가 더 자연스러움 — 칸 단위로 하면 상자 모양 국경이 됨)
  if (world.geo?.whole) base.nations.forEach((n, i) => { if (n.alive) for (const b of scnN[i]?.area || []) boxes.push([b, (b[2] - b[0]) * (b[3] - b[1]), i]); });
  const tileOwn = new Int16Array(grid.N).fill(-2);
  // 강역 상자를 경위도 10도 칸에 나눠 담음 (칸마다 상자 전체를 훑지 않게, 순서는 그대로라 결과 같음)
  const boxBins = new Map();
  boxes.forEach(([[w, s0, e, nn]], bi) => { for (let x = Math.floor(w / 10); x <= Math.floor(e / 10); x++) for (let y = Math.floor(s0 / 10); y <= Math.floor(nn / 10); y++) { const k = x * 1000 + y; if (!boxBins.has(k)) boxBins.set(k, []); boxBins.get(k).push(bi); } });
  const regOwner = (t) => {
    if (!boxes.length || !world.geo) return regOwner0(t);
    if (tileOwn[t] !== -2) return tileOwn[t];
    const [lon0, lat0] = world.geo.toLL(...grid.center(t));
    // 국경이 상자 모서리처럼 일직선이 되지 않게 살짝 흔들어서 판정
    const jw = world.geo.whole ? 1 : 0.25; // 지역사(칸이 잘음)는 조금만
    const lon = lon0 + (Math.sin(lat0 * 1.3 + lon0 * 0.4) * 0.7 + Math.sin(lat0 * 3.1 - lon0 * 2.2) * 0.35) * jw;
    const lat = lat0 + (Math.sin(lon0 * 1.1 - lat0 * 0.7) * 0.5 + Math.sin(lon0 * 2.9 + lat0 * 1.9) * 0.25) * jw;
    let best = -1, ba = Infinity;
    for (const bi of boxBins.get(Math.floor(lon / 10) * 1000 + Math.floor(lat / 10)) || []) { const [[w, s0, e, nn], a, i] = boxes[bi]; if (a < ba && lon >= w && lon <= e && lat >= s0 && lat <= nn) { ba = a; best = i; } }
    // 상자 밖이면 지역 주인 (단, 그 지역 주인이 강역 상자를 가진 나라면 상자 밖 땅은 중립)
    if (best < 0) { const r = regOwner0(t); best = r >= 0 && (scnN[r]?.area?.length) ? -1 : r; }
    return (tileOwn[t] = best);
  };
  const picks = pickCities(world, grid, base, boxes.length && world.geo ? regOwner : null);
  const capTaken = new Set(picks.filter((x) => x.capitalOf !== undefined).map((x) => x.capitalOf));
  const castles = picks.map((p, id) => {
    // 수도는 나라마다 하나만 (같은 지역에 성이 여럿이어도 ♛가 여러 개 붙지 않게)
    let capOf = p.capitalOf ?? -1;
    if (capOf < 0 && !picks.some((x) => x.capitalOf !== undefined && base.nations[x.capitalOf]?.capital === grid.region[p.tile])) capOf = base.nations.findIndex((n) => n.alive && n.capital === grid.region[p.tile] && !capTaken.has(n.id));
    if (capOf >= 0) capTaken.add(capOf);
    const owner = capOf >= 0 ? capOf : regOwner(p.tile);
    const pass = p.kind === 'pass';
    return { id, tile: p.tile, region: grid.region[p.tile], name: p.name, kind: p.kind, owner: owner === -1 ? null : owner, troops: 0, dur: pass ? 6000 : 3000, maxDur: pass ? 6000 : 3000, pop: 0, capital: capOf >= 0, bandit: null };
  });
  // 관할 구역: 나라 땅(역사 강역)은 그 나라 성이 먼저 맡음
  const hasCastle = new Set(castles.map((c) => c.owner).filter((o) => o !== null));
  const landOwner = (i) => { const o = regOwner(i); return hasCastle.has(o) ? o : -1; };
  const district = districts(grid, castles, landOwner);
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
      if (c.owner === null) c.troops = Math.round(Math.min(45000, Math.max(c.troops, 18000 + c.pop * 180)) / 100) * 100; // 빈 성(중립): 인구에 따라 1.8만~4.5만
      else c.troops = Math.max(c.troops, c.capital ? 8000 : 3000); // 지역 병력이 다른 성으로 모여 빈 성이 되지 않게
    }
  }
  // 땅: 그 칸이 속한 도시의 주인 (삼국지14처럼 시작할 때 관할 구역이 통째로 그 나라 땅)
  const owner = new Int16Array(grid.N).fill(-1); // 칸 주인(-1 = 없음). 숫자 배열이라 날마다 상태를 복사할 때 빠름
  // 단, 그 칸의 지역이 실제로 그 나라 땅(역사 강역)일 때만 — 성이 드문 빈 땅(사막·초원)까지 통째로 칠해지지 않게. 나머지는 시간이 지나며 넓어짐
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) owner[i] = landOwner(i);
  for (const c of castles) owner[c.tile] = c.owner === null ? -1 : c.owner;
  // 항구: 바닷길이 3칸 안에 닿는 도시
  // 둘레 n칸 안에 조건에 맞는 칸이 있나 (지도 전체를 훑지 않고 이웃을 따라 n겹만 봄)
  const within = (t0, n, ok) => { let ring = [t0]; const seen = new Set(ring); if (ok(t0)) return 0; for (let d = 1; d <= n; d++) { const nx = []; for (const t of ring) for (const j of grid.nb[t]) if (!seen.has(j)) { seen.add(j); if (ok(j)) return d; nx.push(j); } ring = nx; } return Infinity; };
  for (const c of castles) c.port = c.kind !== 'pass' && within(c.tile, 3, (t) => grid.water[t]) <= 3;
  // 항구가 하나도 없는 땅덩어리(큰 섬 등)는 바다에 가장 가까운 성을 항구로 — 배로 오갈 수 없는 고립된 성이 생기지 않게
  {
    const comp = new Int32Array(grid.N).fill(-1); let nc = 0;
    for (const c of castles) { if (comp[c.tile] >= 0) continue; const q = [c.tile]; comp[c.tile] = nc; for (let k = 0; k < q.length; k++) for (const j of grid.nb[q[k]]) if (comp[j] < 0 && grid.passable(j)) { comp[j] = nc; q.push(j); } nc++; }
    for (let k = 0; k < nc; k++) {
      const cs = castles.filter((c) => comp[c.tile] === k && c.kind !== 'pass');
      if (!cs.length || cs.some((c) => c.port)) continue;
      const coast = (c) => within(c.tile, 12, (t) => grid.water[t]); // 12칸 안에 바다가 있어야 항구로 쓰므로 그만큼만
      const best = cs.map((c) => [c, coast(c)]).sort((a, b) => a[1] - b[1])[0];
      if (best && best[1] < 12) best[0].port = true;
    }
  }
  // 난이도: 컴퓨터 나라 성의 처음 병력 보정 (쉬움 ×0.85, 어려움 ×1.2) — 중립 성은 그대로
  const dTroops = DIFFICULTY[base.opts?.difficulty]?.troops || 1;
  if (dTroops !== 1) for (const c of castles) if (c.owner !== null && (c.owner !== base.playerId || base.spectator)) c.troops = Math.round((c.troops * dTroops) / 100) * 100;
  const generals = {};
  for (const g of Object.values(base.generals)) {
    if (g.status !== 'active' || g.nation === null || g.nation === undefined) continue;
    const t = grid.castleTile[g.region] ?? -1;
    const mine = castles.filter((x) => x.owner === g.nation);
    if (!mine.length) continue;
    const c = t >= 0 ? mine.reduce((a, b) => (grid.dist(b.tile, t) < grid.dist(a.tile, t) ? b : a)) : mine[0];
    generals[g.id] = { id: g.id, pool: !g.pool || g.pool === 'ruler' || g.pool.startsWith('tk') ? base.nations[g.nation]?.pools?.[0] || g.pool : g.pool, name: g.name, war: g.war, lead: g.lead, intel: g.intel, pol: g.pol, traits: g.traits || [], nation: g.nation, castle: c.id, unit: null, status: 'active', ruler: base.nations[g.nation]?.ruler === g.id || undefined };
  }
  const nations = base.nations.map((n) => ({ id: n.id, name: n.name, color: n.color, alive: n.alive && castles.some((c) => c.owner === n.id), isPlayer: n.isPlayer, gold: n.gold, horde: !!n.horde, pools: n.pools || [] }));
  const st = {
    mode: 'hex14', version: 14, scenarioId: base.scenarioId, seed: base.seed, opts: base.opts, playerId: base.playerId, spectator: base.spectator,
    startYear: getScenario(base.scenarioId)?.startYear ?? 200, turn: 1, day: 0, nations, generals, castles, owner, district: Int16Array.from(district), units: [], nextUnit: 1, log: [], fx: [], rs: base.rs || 1, over: null,
  };
  initGov(st, makeRng(`gov0:${base.seed}`)); ensureTraits(st);
  rollWeather(st, grid);
  // 촘촘한 지역 지도(칸이 30km보다 작음)는 부대가 칸 단위로 더 빨리 움직여 실제 하루 거리를 맞춤
  st.kmScale = Math.min(2, 30 / kmOf(getScenario(base.scenarioId)));
  st.playerStart = castles.filter((c) => c.owner === base.playerId && c.kind !== 'pass').length; // 작은 나라로 시작하면 숨 돌릴 틈이 김
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
const has14 = (s, u, t) => gensOf(s, u.gens).some((g) => has(g, t));
export const unitStats = (s, u) => {
  const gs = gensOf(s, u.gens);
  const best = (k) => (gs.length ? Math.max(...gs.map((g) => g[k])) : 30); // 대장을 잃은 부대는 약함
  // 부장 보좌: 부장 하나마다 공격·방어 +12% (둘까지) — 둘이 따로 나가 협공하는 것과 비슷하게
  const aid = 1 + 0.12 * Math.min(2, Math.max(0, gs.length - 1));
  // 특성: 명장·맹장 공격↑, 책략 공격·방어↑
  const ta = 1 + t14(gs, '명장') + t14(gs, '맹장') + t14(gs, '책략'), td = 1 + t14(gs, '책략');
  return { atk: (40 + best('war') * 0.4 + best('lead') * 0.6) * aid * ta, def: (40 + best('lead') * 0.6 + best('intel') * 0.4) * aid * td, intel: best('intel') };
};
// 장수 나누기: 장수가 몰린 성에서 모자란 성으로 (사람이 버튼을 누를 때만). 성마다 목표 인원 — 적과 맞닿은 성 4명, 후방 3명(내정 담당 셋)
// 군주·담당관은 그대로 두고 남는 장수만, 받는 쪽이 전선이면 무력+통솔 높은 장수를, 후방이면 정치 높은 장수를 보냄. 가장 가까운 성부터
export function planGenSpread(s, grid, pid) {
  const mine = s.castles.filter((c) => c.owner === pid && c.kind !== 'pass');
  const at = new Map(mine.map((c) => [c.id, []]));
  for (const g of Object.values(s.generals)) if (g.nation === pid && g.status === 'active' && (g.unit === null || g.unit === undefined) && at.has(g.castle)) at.get(g.castle).push(g);
  const R = 8 * (grid.k || 1);
  const front = new Map(mine.map((c) => [c.id, s.castles.some((x) => x.owner !== null && x.owner !== pid && x.owner >= 0 && enemy(s, pid, x.owner) && grid.dist(x.tile, c.tile) <= R)]));
  const want = (c) => (front.get(c.id) ? 4 : 3);
  const isJob = (c, g) => Object.values(c.jobs || {}).includes(g.id);
  const moves = [];
  const needs = mine.filter((c) => at.get(c.id).length < want(c)).sort((a, b) => (front.get(b.id) - front.get(a.id)) || (at.get(a.id).length - want(a)) - (at.get(b.id).length - want(b)));
  for (const c of needs) {
    let need = want(c) - at.get(c.id).length, guard = 0;
    while (need > 0 && guard++ < 12) {
      const donors = mine.filter((d) => d !== c && at.get(d.id).length > want(d) && d.troops >= 1500 && at.get(d.id).some((g) => !g.ruler && !isJob(d, g))).sort((a, b) => grid.dist(a.tile, c.tile) - grid.dist(b.tile, c.tile));
      const d = donors[0];
      if (!d) break;
      const pool = at.get(d.id).filter((g) => !g.ruler && !isJob(d, g));
      const g = pool.sort((a, b) => (front.get(c.id) ? b.war + b.lead - (a.war + a.lead) : b.pol - a.pol))[0];
      moves.push({ g: g.id, from: d.id, to: c.id });
      at.set(d.id, at.get(d.id).filter((x) => x !== g)); at.get(c.id).push(g);
      need--;
    }
  }
  return moves;
}
export function doGenSpread(s, grid, pid, moves) {
  let ok = 0;
  for (const m of moves) { const g = s.generals[m.g]; if (!g || g.castle !== m.from || g.unit != null) continue; const r = summonGeneral(s, grid, m.g, m.to, 1000); if (r.ok) ok++; }
  return { ok: ok > 0, msg: ok ? `장수 ${ok}명이 모자란 성으로 떠났습니다 (병사 1천씩 호위)` : '보낼 수 있는 장수가 없습니다 (보내는 성 병력이 1,500 넘어야 함)' };
}
// 장수 부르기: 다른 내 성의 장수가 병력을 이끌고 이 성으로 행군해 옴
export function summonGeneral(s, grid, gid, toCid, troops) {
  const g = s.generals[gid], to = s.castles[toCid];
  if (!g || g.status !== 'active' || g.castle === null || g.castle === undefined || g.castle === toCid) return { ok: false, msg: '부를 수 없는 장수입니다.' };
  if (to.owner !== g.nation) return { ok: false, msg: '내 성으로만 부를 수 있습니다.' };
  const r = sortie(s, grid, g.castle, [gid], Math.max(1000, troops));
  if (!r.ok) return r;
  const o = order(s, grid, r.unit, 'castle', toCid);
  if (!o.ok) { s.castles[r.unit.home].troops += r.unit.troops; s.units = s.units.filter((x) => x !== r.unit); g.castle = r.unit.home; g.unit = null; return { ok: false, msg: '그 성까지 갈 길이 없습니다.' }; }
  return { ok: true, unit: r.unit, msg: `${g.name}이(가) ${fmtTroops(r.unit.troops)}을(를) 이끌고 ${to.name}(으)로 출발` };
}
// 부대 나누기: 장수 하나를 떼어 병력을 머릿수만큼 나눠 옆 칸에 세움
// 들판 어디서든 공성병기를 만듦 (금 5천, 바로) — 성을 함락하면 부서짐
export function buildSiege(s, uid) {
  const u = s.units.find((x) => x.id === uid);
  if (!u) return { ok: false, msg: '부대가 없습니다.' };
  if (u.siege) return { ok: false, msg: '이미 공성병기가 있습니다.' };
  if (s.nations[u.nation].gold < SIEGE_COST) return { ok: false, msg: `금이 모자랍니다 (${fmtGold(SIEGE_COST)}).` };
  s.nations[u.nation].gold -= SIEGE_COST;
  u.siege = true;
  return { ok: true, msg: '⚙️ 공성병기를 만들었습니다 (성벽 5배로 깎음 · 느려지고 들판 싸움에 약함 · 함락하면 부서짐)' };
}
// 모두 나누기: 장수마다 한 부대씩, 병력은 똑같이
export function splitAll(s, grid, uid) {
  const u = s.units.find((x) => x.id === uid);
  if (!u || u.gens.length < 2) return { ok: false, msg: '장수가 둘 이상인 부대만 나눌 수 있습니다.' };
  const n0 = u.gens.length;
  let made = 0;
  // 남은 장수 수로 나누면 매번 똑같은 몫이 떨어져 나감
  for (const gid of u.gens.slice(1)) {
    if (!splitUnit(s, grid, uid, gid).ok) break;
    made++;
  }
  return made ? { ok: true, msg: `부대를 ${made + 1}개로 나눴습니다${made + 1 < n0 ? ' (옆 빈칸이 모자라 일부만)' : ''}` } : { ok: false, msg: '옆에 빈 칸이 없습니다.' };
}
export function splitUnit(s, grid, uid, gid) {
  const u = s.units.find((x) => x.id === uid);
  if (!u || u.gens.length < 2 || !u.gens.includes(gid)) return { ok: false, msg: '장수가 둘 이상인 부대만 나눌 수 있습니다.' };
  const occ = unitAt(s);
  const spot = grid.nb[u.tile].find((t) => (grid.passable(t) || (grid.sea[t] && grid.sea[u.tile])) && !occ.has(t) && !s.castles.some((c) => c.tile === t) && !fortAt(s, t));
  if (spot === undefined) return { ok: false, msg: '옆에 빈 칸이 없습니다.' };
  const part = Math.round(u.troops / u.gens.length);
  u.troops -= part;
  u.max = Math.max(u.troops, Math.round(u.max * (1 - 1 / u.gens.length)));
  u.gens = u.gens.filter((x) => x !== gid);
  const v = { ...u, id: s.nextUnit++, gens: [gid], troops: part, max: part, tile: spot, path: [], order: null, mp: 0, wait: 0, cd: 0, siege: undefined, guard: 0 };
  s.generals[gid].unit = v.id;
  s.units.push(v);
  return { ok: true, unit: v, msg: `${s.generals[gid].name} 부대 ${fmtTroops(part)} 갈라짐` };
}
// 지휘 한도: 가장 통솔 높은 장수 8천+통솔×800, 부장은 절반씩
export const commandCap = (s, gids) => {
  const gs = gensOf(s, gids);
  const caps = gs.map((g) => 8000 + g.lead * 800).sort((a, b) => b - a);
  const mil = gs[0] && hasPolicy(s, gs[0].nation, 'military') ? 1.2 : 1; // 군비 확장: 지휘 한도 +20%
  return caps.length ? Math.round((caps[0] + caps.slice(1).reduce((a, c) => a + c * 0.5, 0)) * mil) : 0;
};
export const speedOf = (s, u) => (gensOf(s, u.gens).some((g) => has(g, '기마')) ? 1.0 : 0.75) * (1 + t14(gensOf(s, u.gens), '신속')) * (u.siege ? 0.75 : 1) * (u.routed ? 1.2 : 1) * (s.kmScale || 1); // 하루에 평지 0.75칸 (기마 1칸), 공성병기를 끌면 느림
export const moveCost = (grid, from, to, s, u) => {
  if (grid.sea?.[to]) return 1; // 바다는 평지만큼
  let c = (COST[grid.terrain[to]] || 1.2) + (grid.river[to] && !grid.river[from] ? 0.8 : 0);
  if (u && grid.river[to] && gensOf(s, u.gens).some((g) => has(g, '수군'))) c *= 0.6; // 수군 장수는 강을 따라 빠름
  if (u) {
    const gs = gensOf(s, u.gens), tr = grid.terrain[to];
    if (grid.river[to] && !grid.river[from]) c -= 0.8 * Math.min(1, t14(gs, '도하'));
    if (tr === T.MOUNTAIN || tr === T.HILLS) c *= 1 - t14(gs, '산악') / 2;
    if (tr === T.DESERT || tr === T.TUNDRA) c *= 1 - t14(gs, '사막') / 2.5;
  }
  return s ? weatherCost(s, grid, to, c) : c;
};
// 땅, 얕은 바다(뭍에서 3칸)는 누구나 · 깊은 바다는 항구에서 나온 부대만
const canGo = (grid, t, navy) => grid.passable(t) || grid.water[t] || (navy && grid.sea[t]);
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
// 길찾기용 작업 공간: 칸 수만큼의 숫자 배열을 지도마다 한 번 만들어 두고 다시 씀 (부를 때마다 Map을 만들지 않게)
const pathWork = new WeakMap();
export function findPath(s, grid, from, to, nation, navy = false) {
  if (from === to) return [];
  let W = pathWork.get(grid);
  if (!W) { W = { g: new Float64Array(grid.N), prev: new Int32Array(grid.N), mark: new Int32Array(grid.N), shut: new Int32Array(grid.N), gen: 0 }; pathWork.set(grid, W); }
  const gen = ++W.gen, gS = W.g, prev = W.prev, mark = W.mark, shut = W.shut;
  const occ = unitAt(s);
  // 성 자리 → 성 (성 자리는 안 움직임, 주인은 그때그때 봄)
  const cas = castleTiles(s, grid);
  const forts = s.forts?.length ? new Map(s.forts.map((f) => [f.tile, f])) : null;
  const open = heap();
  open.push(0, from);
  gS[from] = 0; mark[from] = gen; prev[from] = -1;
  let it = 0, found = false;
  while (open.size() && it++ < 40000) {
    const cur = open.pop();
    if (cur === to) { found = true; break; }
    if (shut[cur] === gen) continue;
    shut[cur] = gen;
    const gc = gS[cur];
    for (const nx of grid.nb[cur]) {
      if (!canGo(grid, nx, navy)) continue;
      const u = occ.get(nx);
      if (nx !== to) {
        if (u && u.nation !== nation) continue;
        const ci = cas[nx];
        if (ci >= 0 && s.castles[ci].owner !== nation) continue; // 남의 성은 지나갈 수 없음 (공격 목표일 때만 들어감)
      }
      // 남의 진지·망루·목책: 부숴야 지나가므로 아주 비싼 길 (돌아갈 길이 멀면 부수고 감)
      const ef = forts && forts.get(nx);
      // 빠른 길로 가되, 목표 바로 옆(싸울 자리)은 땅을 고름 — 물 위에서 싸우면 약하므로 상륙해서 침
      const board = grid.sea[nx] && nx !== to && grid.dist(nx, to) === 1 ? 4 : grid.sea[nx] !== grid.sea[cur] ? 0.5 : 0;
      const ng = gc + moveCost(grid, cur, nx) + board + (u ? 2 : 0) + (ef && ef.owner !== nation && nx !== to ? 12 : 0);
      if (mark[nx] !== gen || ng < gS[nx]) {
        mark[nx] = gen; gS[nx] = ng; prev[nx] = cur;
        open.push(ng + grid.dist(nx, to), nx);
      }
    }
  }
  if (!found && mark[to] !== gen) return null;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]]);
  path.pop();
  return path.reverse();
}
const castleTileCache = new WeakMap();
function castleTiles(s, grid) {
  let c = castleTileCache.get(grid);
  if (!c || c.n !== s.castles.length) { const a = new Int32Array(grid.N).fill(-1); s.castles.forEach((x, i) => { a[x.tile] = i; }); c = { n: s.castles.length, a }; castleTileCache.set(grid, c); }
  return c.a;
}

// ── 출진: 성에서 장수와 병력을 뽑아 부대를 만듦 ──
export const SIEGE_COST = 5000; // 공성병기(충차·투석기) 동반 비용
// 출진 비용: 병사 1명당 0.5금(군비 확장 정책이면 절반) + 공성병기
export const sortieCost = () => 0; // 출진 비용 없음
// 금으로 감당할 수 있는 출진 병력
export const sortieAfford = () => 1e9;
export function sortie(s, grid, castleId, gids, troops, siege = false) {
  const c = s.castles[castleId];
  const gs = gids.map((id) => s.generals[id]);
  if (!gs.length || gs.some((g) => !g || g.castle !== castleId || g.nation !== c.owner)) return { ok: false, msg: '성에 있는 장수를 골라야 합니다.' };
  const cap = commandCap(s, gids);
  troops = Math.floor(Math.min(troops, cap, c.troops - 500) / 1000) * 1000; // 병력은 천 단위
  if (troops < 1000) return { ok: false, msg: '병력이 모자랍니다 (성에 500은 남겨야 함).' };

  // 성 옆 빈 칸에 나감
  const occ = unitAt(s);
  const spot = grid.nb[c.tile].find((t) => grid.passable(t) && !occ.has(t) && !s.castles.some((x) => x.tile === t));
  if (spot === undefined) return { ok: false, msg: '성 주변에 나갈 자리가 없습니다.' };
  c.troops -= troops;
  const u = { id: s.nextUnit++, nation: c.owner, gens: gids, troops, max: troops, morale: 80, tile: spot, path: [], order: null, mp: 0, home: castleId, wait: 0, cd: 0, navy: !!c.port, ships: lv(c, 'shipyard') > 0 || undefined, atkB: hasPolicy(s, c.owner, 'military') ? 1.08 : undefined, siege: siege || undefined };
  for (const g of gs) { g.castle = null; g.unit = u.id; }
  s.units.push(u);
  return { ok: true, unit: u, msg: `${gs[0].name} 부대 ${fmtTroops(troops)} 출진` };
}

// 명령: tile(이동) · unit(공격) · castle(공성/입성)
export function order(s, grid, u, kind, id) {
  const tgtTile = kind === 'tile' ? id : kind === 'unit' ? s.units.find((x) => x.id === id)?.tile : kind === 'fort' ? s.forts?.find((f) => f.id === id)?.tile : s.castles[id]?.tile;
  if (tgtTile === undefined || tgtTile === null) return { ok: false, msg: '목표가 없습니다.' };
  const path = findPath(s, grid, u.tile, tgtTile, u.nation, u.navy);
  if (!path) return { ok: false, msg: '갈 수 있는 길이 없습니다.' };
  u.order = { kind, id };
  u.path = path;
  u.wait = 0;
  return { ok: true };
}
// 새 명령은 대기 중인 경유지를 지움
export function orderNew(s, grid, u, kind, id) {
  u.queue = [];
  return order(s, grid, u, kind, id);
}

// 수송: 장수 없이 병력만 내 다른 성으로 (길 길이만큼 걸려 도착, 도착지를 잃으면 가까운 내 성으로)
export const absDay = (s) => s.turn * DAYS + s.day;
// 성 수용 한도: 한 성에 무한정 쌓이지 않게 (넘는 병력은 순마다 15%씩 흩어짐 — 남는 병력은 부대로 내보내야 함)
// 수용 병력 = 성 자체 수용 + 그 성 장수 중 출진 병력을 가장 많이 데리고 나갈 수 있는 3명의 출진 병력
export const genRoom = (s, c) => (s ? Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').map((g) => 8000 + g.lead * 800).sort((a, b) => b - a).slice(0, 3).reduce((a, x) => a + x, 0) : 0);
export const capOf = (c, s) => (c.kind === 'pass' ? 30000 : Math.max(40000, Math.round((c.pop || 0) * 600)) + lv(c, 'wall') * 10000) + genRoom(s, c);
export const roomOf = (c, s) => Math.max(0, capOf(c, s) - c.troops);
// 포위: 적 부대가 성 바로 옆에 있음
export const besieged = (s, grid, c) => s.units.some((u) => enemy(s, c.owner, u.nation) && grid.dist(u.tile, c.tile) <= 1);
export const convoyDays = (len) => Math.max(1, Math.ceil(len / 1.5));
export function sendTroops(s, grid, fromId, toId, troops) {
  const a = s.castles[fromId], b = s.castles[toId];
  if (!a || !b || a.owner !== b.owner || a === b) return { ok: false, msg: '내 다른 성으로만 보낼 수 있습니다.' };
  if (besieged(s, grid, b)) return { ok: false, msg: `${b.name}은(는) 포위당해 수송대가 들어갈 수 없습니다. 장수가 부대로 데리고 가야 합니다.` };
  const inbound = (s.convoys || []).filter((v) => v.to === b.id).reduce((x, v) => x + v.troops, 0);
  troops = Math.floor(Math.min(troops, a.troops - 500, roomOf(b, s) - inbound) / 1000) * 1000;
  if (troops < 1000) return { ok: false, msg: roomOf(b, s) - inbound < 1000 ? `${b.name}은(는) 수용 한도(${fmtTroops(capOf(b, s))})가 찼습니다.` : '보낼 병력이 모자랍니다 (성에 500은 남겨야 함).' };
  const path = findPath(s, grid, a.tile, b.tile, a.owner, !!a.port);
  if (!path) return { ok: false, msg: '그 성까지 갈 길이 없습니다.' };
  const days = convoyDays(path.length); // 수송대: 내 땅 길로 하루 1.5칸 (부대 0.75칸보다 빠름)
  a.troops -= troops;
  s.convoys = [...(s.convoys || []), { from: a.id, to: b.id, nation: a.owner, troops, start: absDay(s), arrive: absDay(s) + days }];
  return { ok: true, msg: `🚚 ${a.name} → ${b.name} 병력 ${fmtTroops(troops)} 수송 (${days}일 뒤 도착)` };
}
function convoysDay(s, grid) {
  if (!s.convoys?.length) return;
  const now = absDay(s);
  s.convoys = s.convoys.filter((v) => {
    if (v.arrive > now) return true;
    let to = s.castles[v.to];
    if (to.owner !== v.nation) to = nearestCastle(s, grid, to.tile, v.nation);
    // 도착할 성이 포위당했으면 들어가지 못하고 가까운 다른 내 성으로
    if (to && besieged(s, grid, to)) { const alt = s.castles.filter((c) => c.owner === v.nation && c !== to && !besieged(s, grid, c)).sort((a, b) => grid.dist(a.tile, to.tile) - grid.dist(b.tile, to.tile))[0]; if (v.nation === s.playerId) log(s, `🚚 ${to.name}이(가) 포위당해 수송대가 ${alt ? alt.name + '(으)로 돌아갔습니다' : '흩어졌습니다'}.`, 'bad', [v.nation]); to = alt || null; }
    if (to) { to.troops += v.troops; if (v.nation === s.playerId) log(s, `🚚 병력 ${fmtTroops(v.troops)}이(가) ${to.name}에 도착했습니다.`, 'info', [v.nation]); }
    return false;
  });
}

// 연속 명령: 지금 명령을 마치면(도착·함락·격파) 다음 경유지로
export function orderDone(s, u) {
  const o = u.order;
  if (!o) return true;
  if (o.kind === 'tile') return u.tile === o.id || !u.path.length;
  if (o.kind === 'unit') return !s.units.some((x) => x.id === o.id && !x.dead);
  if (o.kind === 'fort') return !(s.forts || []).some((f) => f.id === o.id);
  if (o.kind === 'castle') { const c = s.castles[o.id]; return !c || (c.owner === u.nation && !u.path.length) || (c.owner !== u.nation && !enemy(s, u.nation, c.owner)); } // 남이 먼저 빼앗아 동맹국 성이 되면 다음으로
  return false;
}
function advanceQueues(s, grid) {
  for (const u of s.units) {
    if (u.dead || !u.queue?.length || !orderDone(s, u)) continue;
    while (u.queue.length) {
      const next = u.queue.shift();
      if (order(s, grid, u, next.kind, next.id).ok) break;
    }
  }
}
// 명령 더하기: 지금 명령 뒤에 이어서 할 일
export function queueOrder(s, grid, u, kind, id) {
  if (!u.order || orderDone(s, u)) return order(s, grid, u, kind, id);
  u.queue = [...(u.queue || []), { kind, id }].slice(0, 8);
  return { ok: true, msg: `경유지 추가 (${u.queue.length}개 대기)` };
}

// ── 하루 진행 ──
// 땅따먹기 마무리: 어떤 나라 땅이 그 나라 성·부대와 이어지지 않고 떨어져 나가 3순(30일) 지나면, 둘러싼 나라 땅이 됨
export function encloseLand(s, grid) {
  const N = grid.N, own = s.owner;
  const reach = new Uint8Array(N), q = new Int32Array(N);
  let n = 0;
  for (const c of s.castles) if (c.owner !== null && c.owner >= 0 && own[c.tile] === c.owner && !reach[c.tile]) { reach[c.tile] = 1; q[n++] = c.tile; }
  const F = grid.nbf;
  for (let k = 0; k < n; k++) { const t = q[k], o = own[t]; for (let e = t * 6, e1 = e + 6; e < e1; e++) { const j = F[e]; if (j >= 0 && !reach[j] && own[j] === o) { reach[j] = 1; q[n++] = j; } } }
  const seen = new Uint8Array(N), next = {};
  for (let i = 0; i < N; i++) {
    const o = own[i];
    if (o < 0 || reach[i] || seen[i] || !grid.passable(i)) continue;
    // 떨어져 나간 한 덩어리
    const comp = [i]; seen[i] = 1;
    const around = new Map();
    for (let k = 0; k < comp.length; k++) for (const j of grid.nb[comp[k]]) {
      if (own[j] === o && !reach[j] && !seen[j] && grid.passable(j)) { seen[j] = 1; comp.push(j); }
      else if (own[j] !== o && own[j] >= 0) around.set(own[j], (around.get(own[j]) || 0) + 1);
    }
    let best = -1, bc = 0;
    for (const [x, v] of around) if (v > bc && s.nations[x]?.alive) { bc = v; best = x; }
    if (best < 0) continue;
    // 그 나라 부대(장수)가 그 땅 안이나 바로 옆에 있으면 아직 이어진 것으로 봄
    const set = new Set(comp);
    if (s.units.some((u) => u.nation === o && (set.has(u.tile) || grid.nb[u.tile].some((j) => set.has(j))))) continue;
    // 3순(30일) 동안 계속 떨어져 있으면 둘러싼 나라 땅이 됨
    const age = Math.max(0, ...comp.map((x) => s.orphan?.[x] || 0)) + 1;
    if (age >= ORPHAN_DAYS) { for (const x of comp) if (!s.castles.some((c) => c.tile === x)) own[x] = best; }
    else for (const x of comp) next[x] = age;
  }
  s.orphan = next;
}
export const ORPHAN_DAYS = 30;

export function stepDay(s, grid) {
  outlawDay(s, grid, makeRng(`outlawd:${s.seed}:${s.turn}:${s.day}`));
  s.day += 1;
  encloseLand(s, grid);
  s.fx = [];
  s.duels = [];
  dropLeaderless(s, grid);
  // 컴퓨터 부대(플레이어 군단 포함): 2칸 안 적 망루에 맞고 있으면 먼저 부수고 원래 명령으로 돌아감
  for (const u of s.units) {
    if (u.dead || u.routed || (u.nation === s.playerId && !s.spectator && !u.corps) || u.order?.kind === 'fort') continue;
    if (u.order?.kind === 'castle' && grid.dist(u.tile, s.castles[u.order.id]?.tile) <= 1) continue; // 성 바로 앞 공성 중이면 계속
    const tw = (s.forts || []).find((f) => f.kind === 'tower' && !f.left && enemy(s, u.nation, f.owner) && grid.dist(f.tile, u.tile) <= 2);
    if (!tw) continue;
    const prev = u.order ? { ...u.order } : null, q = u.queue || [];
    if (order(s, grid, u, 'fort', tw.id).ok) u.queue = prev ? [prev, ...q] : q;
  }
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
      const ef = fortAt(s, nx);
      if ((enemyU && enemyU.nation !== u.nation) || (c && c.owner !== u.nation) || (ef && ef.owner !== u.nation)) break;
      if (enemyU) { u.wait += 1; if (u.wait > 2) { const p = findPath(s, grid, u.tile, u.path[u.path.length - 1], u.nation, u.navy); u.path = p || []; u.wait = 0; } break; }
      const cost = moveCost(grid, u.tile, nx, s, u);
      // 이동력이 가득(3) 찼으면 아무리 험한 칸(눈 덮인 산 등)도 한 칸은 감
      if (u.mp < cost && u.mp < 3) break;
      u.mp = Math.max(0, u.mp - cost);
      occ.delete(u.tile);
      u.tile = nx;
      occ.set(nx, u);
      u.path.shift();
      // 칠하기: 적·빈 땅을 지나가면 내 땅이 됨 (성 칸·동맹/정전국 땅 제외)
      if (!c && !u.outlaw && grid.passable(nx) && s.owner[nx] !== u.nation && enemy(s, u.nation, s.owner[nx])) s.owner[nx] = u.nation; // 도적은 땅을 칠하지 않음
      // 내 성에 들어가면 입성 (병력·장수가 성으로) — 경유지면 지나가기만 함
      if (c && c.owner === u.nation && u.order?.kind === 'castle' && u.order.id === c.id) { if (u.queue?.length) { u.order = null; u.path = []; break; } enter(s, u, c); break; }
      // 통제 구역: 적 부대 옆에 서면 그날은 더 못 감
      if (grid.nb[nx].some((t) => { const o = occ.get(t); if (o && enemy(s, u.nation, o.nation)) return true; const f = fortAt(s, t); return f && f.kind === 'palisade' && !f.left && enemy(s, u.nation, f.owner); })) { u.mp = 0; break; }
    }
  }
  s.units = s.units.filter((u) => !u.dead);
  // 2) 전투: 옆에 붙은 적을 침 (명령한 목표 우선), 여러 부대가 한 부대를 치면 협공
  const occ = unitAt(s);
  const hits = new Map(); // 대상 → [{공격자, 피해}]
  const sieges = [];
  for (const u of s.units) {
    if (u.routed || u.troops <= 0) continue; // 패주 중인 부대는 싸우지 않고 물러남 (병력이 바닥난 부대도)
    const adj = grid.nb[u.tile];
    let tgt = null;
    if (u.order?.kind === 'unit') { const t = s.units.find((x) => x.id === u.order.id); if (t && adj.includes(t.tile) && enemy(s, u.nation, t.nation)) tgt = t; }
    if (!tgt && u.order?.kind === 'castle') { const c = s.castles[u.order.id]; if (c && enemy(s, u.nation, c.owner) && adj.includes(c.tile)) { sieges.push([u, c]); continue; } }
    if (!tgt) for (const t of adj) { const o = occ.get(t); if (o && enemy(s, u.nation, o.nation)) { tgt = o; break; } }
    if (!tgt) continue;
    const a = unitStats(s, u), d = unitStats(s, tgt);
    // 물 위에서는 수군 장수가 없으면 약함
    const sea = (x) => (grid.sea[x.tile] ? (has14(s, x, '수군') ? 1 + t14(gensOf(s, x.gens), '수군') : x.ships || hasPolicy(s, x.nation, 'navy') ? 1 : 0.75) : 1);
    const ug = gensOf(s, u.gens), tr = grid.terrain[tgt.tile];
    // 지형·상황 특성: 기마(평원·사막·동토), 산악(산·구릉), 돌격(병력 열세), 위압(적 방어↓), 화공(맑은 날 숲·구릉)
    const tg = gensOf(s, tgt.gens);
    const tb = (1 + (tr === T.PLAINS || tr === T.DESERT || tr === T.TUNDRA ? t14(ug, '기마') : 0) + (tr === T.MOUNTAIN || tr === T.HILLS ? t14(ug, '산악') : 0)
      + (u.troops < tgt.troops ? t14(ug, '돌격') : 0) + (tr === T.DESERT || tr === T.TUNDRA ? t14(ug, '사막') : 0) + (tr === T.FOREST || tr === T.HILLS ? t14(ug, '화공') : 0)
      + (grid.river[tgt.tile] ? t14(ug, '도하') / 2 : 0)) / (1 - t14(ug, '위압')) / (1 + t14(tg, '매복'));
    let dmg = tb * (u.siege ? 0.8 : 1) * u.troops * 0.03 * (a.atk / d.def) * (0.6 + u.morale / 250) / (DEF[grid.terrain[tgt.tile]] || 1) * rng.range(0.9, 1.1) * sea(u) / sea(tgt) * (u.atkB || 1);
    // 일기토
    maybeDuel(s, u, tgt, rng);
    // 전법: 고유 전법(이름난 장수) 또는 능력 70 이상의 돌격·일제사격·화계 (부대마다 3일에 한 번)
    let tac = u.cd > 0 ? null : tacticOf(s, u, rng);
    // 간파: 받는 쪽에 지력 높은 장수가 있으면 전법을 꿰뚫어 막기도 함 (지력 차이만큼)
    if (tac) {
      const sage = gensOf(s, tgt.gens).reduce((m, g) => (g.intel > (m?.intel ?? 0) ? g : m), null);
      if (sage && sage.intel >= 75 && rng() < Math.max(0, (sage.intel - (tac.g.intel || 50)) / 100 + 0.1)) {
        u.cd = 2;
        s.fx.push({ type: 'tactic', tile: tgt.tile, to: u.tile, text: `${sage.name} 간파!`, nation: tgt.nation });
        if (u.nation === s.playerId || tgt.nation === s.playerId) log(s, `🧠 ${sage.name}이(가) ${tac.g.name}의 「${tac.name}」을(를) 간파했습니다!`, 'battle', [u.nation, tgt.nation]);
        tac = null;
      }
    }
    if (tac) {
      u.cd = tac.unique ? 4 : 3;
      const fire = tac.kind === 'fire' ? fireMult(s, grid, tgt.tile) * (1 + t14([tac.g], '화공') / 2) : 1;
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
    // 전투 기록 (내 부대가 낀 싸움만): 결과 보고서에서 피해와 그 까닭(능력·특성·사기·지형·협공·전법)을 보여 줌
    const rec = !s.spectator && (u.nation === s.playerId || tgt.nation === s.playerId) ? { turn: s.turn, day: s.day, a: u.id, an: u.nation, al: leader(s, u)?.name, d: tgt.id, dn: tgt.nation, dl: leader(s, tgt)?.name, terr: tr, ratio: a.atk / d.def, trait: tb, morale: 0.6 + u.morale / 250, tdef: DEF[tr] || 1, tac: tac && tac.kind !== 'guard' ? tac.name : null, dmg: 0, back: 0, pincer: 1 } : null;
    if (rec) { (s.btl ||= []).push(rec); if (s.btl.length > 120) s.btl.splice(0, s.btl.length - 120); }
    hits.get(tgt).push({ u, dmg, rec });
  }
  for (const [t, list] of hits) {
    // 협공: 다른 방향에서 함께 치면 한 부대당 +30%
    const pincer = 1 + 0.3 * (new Set(list.map((x) => x.u.tile)).size - 1);
    const inCamp = (s.forts || []).some((f) => f.tile === t.tile && f.kind === 'camp' && f.owner === t.nation && !f.left);
    // 공성병기를 끼고 있는 부대는 들판 싸움에 취약 (기습당하면 +35% 피해)
    const total = list.reduce((a, x) => a + x.dmg, 0) * pincer * (t.guard > 0 ? 0.5 : 1) * (inCamp ? 0.7 : 1) * (t.siege ? 1.35 : 1) * (t.routed ? 1.3 : 1);
    t.troops -= total;
    t.morale -= (total / Math.max(1, t.troops + total)) * 60 + (pincer > 1 ? 5 : 0);
    s.fx.push({ type: 'hit', tile: t.tile, amt: Math.round(total), pincer: pincer > 1 });
    // 반격: 맞은 부대가 때린 부대들에게 되갚음 (협공당하면 나눠짐)
    const dt = unitStats(s, t);
    const mul = total / Math.max(1e-9, list.reduce((a, x) => a + x.dmg, 0));
    for (const { u, dmg, rec } of list) {
      const back = (Math.max(0, t.troops) * 0.012 * (dt.atk / unitStats(s, u).def)) / list.length * (1 - t14(gensOf(s, u.gens), '노련')) / (1 + t14(gensOf(s, u.gens), '매복'));
      if (rec) { rec.dmg = Math.round(dmg * mul); rec.back = Math.round(back); rec.pincer = pincer; rec.extra = mul / pincer; }
      u.troops -= back;
      u.morale -= (back / Math.max(1, u.troops)) * 30;
      s.fx.push({ type: 'hit', tile: u.tile, amt: Math.round(back) });
    }
    if (pincer > 1) s.fx.push({ type: 'tactic', tile: t.tile, text: '협공!', nation: list[0].u.nation });
    if (pincer > 1 && rng() < 0.3) log(s, `⚔️ ${leader(s, list[0].u).name} 등 ${list.length}부대가 ${leader(s, t).name} 부대를 협공!`, 'battle', [list[0].u.nation, t.nation]);
  }
  for (const u of s.units) { if (u.cd > 0) u.cd -= 1; if (u.guard > 0) u.guard -= 1; }
  dropLeaderless(s, grid);
  // 야전 시설 공격: 목표로 정했거나, 옆에 적 부대가 없는데 적 시설이 붙어 있으면 부숨
  for (const u of s.units) {
    if (u.dead) continue;
    const adj = grid.nb[u.tile];
    if (adj.some((t) => { const o = occ.get(t); return o && enemy(s, u.nation, o.nation); })) continue;
    let f = u.order?.kind === 'fort' ? s.forts?.find((x) => x.id === u.order.id && adj.includes(x.tile)) : null;
    if (!f) f = (s.forts || []).find((x) => adj.includes(x.tile) && enemy(s, u.nation, x.owner) && (u.path[0] === x.tile || u.order?.kind === 'fort'));
    // 옆에 적 망루가 있으면 (공성 중이 아니면) 먼저 부숨: 화살 맞으며 지나가지 않게
    if (!f && !(u.order?.kind === 'castle' && adj.includes(s.castles[u.order.id]?.tile))) f = (s.forts || []).find((x) => adj.includes(x.tile) && x.kind === 'tower' && enemy(s, u.nation, x.owner));
    if (!f || !enemy(s, u.nation, f.owner)) continue;
    const dmg = Math.round(u.troops * 0.012 * (unitStats(s, u).atk / 100));
    f.hp -= dmg;
    s.fx.push({ type: 'clash', a: u.tile, b: f.tile }, { type: 'hit', tile: f.tile, amt: dmg, wall: true });
    if (f.hp <= 0 && u.order?.kind === 'fort') { u.order = null; u.path = []; }
  }
  // 3) 공성: 성 수비대와 내구를 깎고, 수비대가 반격
  // 여러 부대가 한 성을 치면 성의 반격(화살)은 나눠 맞음 (들판 싸움의 반격처럼) — 병력 비율대로
  const siegeSum = new Map();
  for (const [u, c] of sieges) if (u.troops > 0) siegeSum.set(c, (siegeSum.get(c) || 0) + u.troops);
  for (const [u, c] of sieges) {
    if (!enemy(s, u.nation, c.owner) || u.dead || u.troops <= 0) continue; // 그날 들판 싸움에서 병력이 바닥난 부대는 공성 못 함 (음수 병력이 성을 되살리던 문제)
    const a = unitStats(s, u);
    // 성벽이 남아 있으면 수비병 피해가 크게 줄고 반격이 셈. 성벽부터 깎아야 함
    const walled = c.dur > 0;
    // 물 위에서 치면 약함 (수군 장수·조선소·수군 육성이 있으면 괜찮음)
    const sea = grid.sea[u.tile] ? (has14(s, u, '수군') ? 1 + t14(gensOf(s, u.gens), '수군') : u.ships || hasPolicy(s, u.nation, 'navy') ? 1 : 0.75) : 1;
    a.atk *= sea;
    // 공성병기: 성벽을 5배로 깎음 (평원 싸움에선 짐이라 −10%)
    const ug = gensOf(s, u.gens);
    // 성을 지키는 장수의 특성: 수성·궁술 방어↑, 철벽 피해↓, 축성 성벽↑ / 공격 쪽 공성은 성벽을 더 깎음
    const cg = castleGens(s, c);
    const guardT = 1 + t14(cg, '수성');
    const wall = u.troops * 0.004 * (a.atk / 100) * (u.siege ? 5 : 1) * (1 + t14(ug, '공성')) / (1 + t14(cg, '철벽'));
    c.dur = Math.max(0, c.dur - wall);
    const kill = u.troops * 0.012 * (a.atk / 100) * (walled ? 0.35 : 1.8) * rng.range(0.9, 1.1) / guardT;
    c.troops -= kill;
    const sback = Math.max(0, c.troops) * 0.012 * (walled ? 1.4 : 1) * (1 + t14(cg, '궁술')) * (1 - t14(ug, '노련')) * (u.troops / Math.max(1, siegeSum.get(c) || u.troops));
    u.troops -= sback;
    if (!s.spectator && (u.nation === s.playerId || c.owner === s.playerId)) { (s.btl ||= []).push({ turn: s.turn, day: s.day, siege: true, a: u.id, an: u.nation, al: leader(s, u)?.name, c: c.id, dn: c.owner, cn: c.name, walled, wall: Math.round(wall), dmg: Math.round(kill), back: Math.round(sback), ratio: a.atk / 100, guard: guardT, engine: !!u.siege }); if (s.btl.length > 120) s.btl.splice(0, s.btl.length - 120); }
    u.morale -= walled ? 0.5 : 0;
    s.fx.push({ type: 'clash', a: u.tile, b: c.tile }, { type: 'hit', tile: c.tile, amt: Math.round(kill), wall: walled });
    if (c.troops <= 0) capture(s, grid, c, u);
  }
  fortsDay(s, grid);
  // 4) 보급: 내 성과 내 땅으로 이어져 있지 않으면 병력·사기가 줄어듦
  const supplied = {};
  const SC = supplyComps(s, grid); // 땅 덩어리 나누기는 하루 한 번만 (나라마다 지도 전체를 훑지 않게)
  for (const u of s.units) {
    if (u.outlaw) { u.cut = false; continue; } // 도적은 보급이 없어도 버팀
    if (!supplied[u.nation]) supplied[u.nation] = supplyMap(s, grid, u.nation, SC);
    if (!grid.sea[u.tile] && !supplied[u.nation].has(u.tile)) { u.troops *= 0.995; u.morale -= 1; u.cut = true; continue; } // 보급이 끊기면 병력·사기가 천천히 줄어듦
    u.cut = false;
    // 사기 회복: 보급되면 +1, 싸우지 않고 내 땅에서 쉬면 +3, 내 진지 안이면 +6
    const rest = !hits.has(u) && ![...hits.values()].some((l) => l.some((x) => x.u === u)) && !sieges.some(([x]) => x === u);
    const camp = (s.forts || []).some((f) => f.tile === u.tile && f.kind === 'camp' && f.owner === u.nation && !f.left);
    u.morale = Math.min(100, u.morale + (!rest ? 1 : camp ? 6 : s.owner[u.tile] === u.nation ? 3 : 1));
  }
  // 5) 무너진 부대: 병력이 바닥나거나 사기가 꺾이면 장수는 가까운 성으로 퇴각(일부는 사로잡힘)
  for (const u of s.units) {
    if (u.troops > 300 && u.morale > 5) continue;
    const home = nearestCastle(s, grid, u.tile, u.nation);
    // 병력이 남았으면 패주: 그 자리에서 가까운 내 성으로 걸어서 물러남 (싸우지 않고, 쫓기면 잡힘)
    if (u.troops > 1000 && home && !u.routed) {
      u.routed = true; u.morale = 15; u.autoRet = false; u.queue = [];
      if (order(s, grid, u, 'castle', home.id).ok) { log(s, `🏳️ ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name} 부대가 패주해 ${home.name}(으)로 물러납니다.`, 'battle', [u.nation]); continue; }
    }
    if (u.routed && u.troops > 300) continue; // 패주 중에는 사기가 낮아도 계속 물러남
    u.dead = true;
    const foe = s.units.filter((x) => x !== u && !x.dead && enemy(s, u.nation, x.nation)).sort((a, b) => grid.dist(a.tile, u.tile) - grid.dist(b.tile, u.tile))[0];
    const near = foe && grid.dist(foe.tile, u.tile) <= 2;
    for (const g of gensOf(s, u.gens)) {
      g.unit = null;
      if (s.nations[u.nation]?.outlaw) { g.status = 'gone'; continue; } // 도적 두목은 사로잡지 않음 (그냥 죽음)
      if (near && !s.nations[foe.nation]?.outlaw && (!home || rng() < 0.4 + t14(gensOf(s, foe.gens), '추격'))) { g.status = 'prisoner'; g.castle = null; g.captor = foe.nation; g.capTile = u.tile; g.heldAt = null; log(s, `⛓️ ${g.name}이(가) ${s.nations[foe.nation]?.name}에 사로잡혔습니다.`, 'battle', [u.nation, foe.nation]); }
      else if (home) { g.castle = home.id; } else { g.status = 'free'; g.nation = null; g.castle = nearestCastle(s, grid, u.tile, foe?.nation ?? -2)?.id ?? 0; }
    }
    if (near && s.nations[foe.nation]?.outlaw) { s.outlawStats = s.outlawStats || { rise: 0, smash: 0, kill: 0 }; s.outlawStats.kill = (s.outlawStats.kill || 0) + 1; }
    log(s, `💥 ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name} 부대가 전멸했습니다.`, 'battle', [u.nation]);
  }
  s.units = s.units.filter((u) => !u.dead);
  advanceQueues(s, grid);
  convoysDay(s, grid);
  for (const u of s.units) { u.troops = Math.round(u.troops); u.morale = Math.max(0, Math.min(100, u.morale)); }
  heldAtNearest(s, grid);
  updateSeen(s, grid);
  for (const c of s.castles) c.troops = Math.max(0, Math.round(c.troops));
}

// 대장이 없어진 부대(일기토에서 사로잡힘·죽음)는 흩어져 남은 병사가 가까운 성으로
function dropLeaderless(s, grid) {
  for (const u of s.units) {
    u.gens = u.gens.filter((id) => s.generals[id]?.status === 'active' && s.generals[id].unit === u.id);
    if (u.gens.length) continue;
    u.dead = true; // 장수를 잃은 병사들은 흩어짐
  }
  s.units = s.units.filter((u) => !u.dead);
}

function enter(s, u, c) {
  u.routed = false;
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
// 보급용 땅 덩어리: 같은 주인끼리 이어진 땅을 한 덩어리로, 얕은 바다(부대가 없는 칸)도 덩어리로 묶고, 덩어리끼리 맞닿은 관계를 셈
export function supplyComps(s, grid) {
  const N = grid.N, comp = new Int32Array(N).fill(-1), cls = [], F = grid.nbf;
  const unitOn = new Map(); for (const u of s.units) { if (!unitOn.has(u.tile)) unitOn.set(u.tile, []); unitOn.get(u.tile).push(u.nation); }
  // -2 = 바다, -3 = 부대가 선 바다 칸(그 칸 하나만, 적 부대가 있으면 그 나라는 못 지나감), -9 = 못 지나감
  const clsOf = (i) => (grid.water[i] ? (unitOn.has(i) ? -3 : -2) : s.owner[i] >= 0 ? s.owner[i] : -9);
  const q = new Int32Array(N), onTile = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0) continue;
    const c = clsOf(i); if (c === -9) continue;
    const id = cls.length; cls.push(c);
    if (c === -3) { comp[i] = id; onTile[id] = unitOn.get(i); continue; }
    let n = 0; q[n++] = i; comp[i] = id;
    for (let k = 0; k < n; k++) for (let e = q[k] * 6, e1 = e + 6; e < e1; e++) { const j = F[e]; if (j >= 0 && comp[j] < 0 && clsOf(j) === c) { comp[j] = id; q[n++] = j; } }
  }
  const adj = cls.map(() => new Set());
  for (let i = 0; i < N; i++) { const a = comp[i]; if (a < 0) continue; for (let e = i * 6, e1 = e + 6; e < e1; e++) { const j = F[e]; if (j < 0) continue; const b = comp[j]; if (b >= 0 && b !== a) adj[a].add(b); } }
  return { comp, cls, onTile, adj: adj.map((x) => [...x]) };
}
export function supplyMap(s, grid, nation, SC = null) {
  if (SC) {
    // 덩어리 단위로 훑음: 내 성·진지가 있는 덩어리에서 시작해 내 땅·동맹/정전국 땅·(항구가 있으면) 바다로 이어진 덩어리
    const { comp, cls, adj, onTile } = SC;
    const port = s.castles.some((c) => c.owner === nation && c.port);
    const okOwner = s.nations.map((m) => m.id === nation || !enemy(s, nation, m.id));
    const ok = (k) => (cls[k] === -2 ? port : cls[k] === -3 ? port && !onTile[k].some((x) => enemy(s, nation, x)) : cls[k] === nation || (cls[k] >= 0 && okOwner[cls[k]]));
    const reach = new Uint8Array(cls.length), q = [];
    const seed = (t) => { const k = comp[t]; if (k >= 0 && !reach[k]) { reach[k] = 1; q.push(k); } };
    for (const c of s.castles) if (c.owner === nation) seed(c.tile);
    // 진지가 적 땅에 있으면 그 칸만 보급 거점 (적 땅 덩어리 전체가 보급되지 않게): 진지 칸과 맞닿은 지나갈 수 있는 덩어리부터 이어짐
    const extra = new Set();
    for (const f of s.forts || []) if (f.kind === 'camp' && f.owner === nation && !f.left) {
      if (comp[f.tile] >= 0 && ok(comp[f.tile])) seed(f.tile);
      else { extra.add(f.tile); for (const j of grid.nb[f.tile]) if (comp[j] >= 0 && ok(comp[j])) seed(j); }
    }
    for (let i = 0; i < q.length; i++) for (const b of adj[q[i]]) if (!reach[b] && ok(b)) { reach[b] = 1; q.push(b); }
    const on = (t) => (comp[t] >= 0 && reach[comp[t]] === 1) || extra.has(t);
    return { has: (t) => on(t) || grid.nb[t].some(on) };
  }
  return supplyMapExact(s, grid, nation);
}
export function supplyMapExact(s, grid, nation) {
  // 칸이 많은 세계 지도에서도 빠르게: 방문 표시는 숫자 배열, 나라끼리 적대 여부는 미리 한 번만
  const seen = new Uint8Array(grid.N), q = new Int32Array(grid.N);
  let n = 0;
  const push = (t) => { if (!seen[t]) { seen[t] = 1; q[n++] = t; } };
  for (const c of s.castles) if (c.owner === nation) push(c.tile);
  for (const f of s.forts || []) if (f.kind === 'camp' && f.owner === nation && !f.left) push(f.tile);
  // 항구가 있으면 얕은 바다(뭍에서 3칸)로도 보급선이 이어짐 (바다 건너 섬 공략)
  const port = s.castles.some((c) => c.owner === nation && c.port);
  const foeAt = new Set(s.units.filter((u) => enemy(s, nation, u.nation)).map((u) => u.tile)); // 적 부대가 선 칸 (한 번만 모음)
  // 내 땅과 동맹·정전국 땅으로 이어지면 보급됨
  const okOwner = s.nations.map((m) => m.id === nation || !enemy(s, nation, m.id));
  for (let k = 0; k < n; k++) for (const nx of grid.nb[q[k]]) {
    if (seen[nx]) continue;
    if (port && grid.water[nx] && !foeAt.has(nx)) { seen[nx] = 1; q[n++] = nx; continue; }
    const o = s.owner[nx];
    if (o !== nation && (o < 0 || !okOwner[o])) continue;
    seen[nx] = 1; q[n++] = nx;
  }
  // 보급선 바로 옆 한 칸까지는 보급됨
  return { has: (t) => !!seen[t] || grid.nb[t].some((x) => seen[x]) };
}

// 성 함락: 그 지역 땅이 통째로 넘어감, 공격 부대는 성에 들어감
function capture(s, grid, c, u) {
  if (s.nations[u.nation]?.outlaw) { checkFall(s, outlawSack(s, grid, c, u)); return; } // 도적은 성을 차지하지 않음 — 중립 성이 됨
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
  for (const x of s.units) if (x.siege && x.nation === u.nation && grid.dist(x.tile, c.tile) <= 1) x.siege = undefined; // 공성병기는 함락하면 부서짐
  // 그 성 관할 안의 옛 주인 시설(망루·진지·목책)은 새 주인 것이 됨
  for (const f of s.forts || []) if (f.owner === old && s.district?.[f.tile] === c.id) { f.owner = u.nation; f.builder = null; }
  addRel(s, u.nation, old, -15);
  // 성에 있던 장수: 절반은 가까운 자기 성으로, 절반은 포로
  const rng = makeRng(`cap:${s.seed}:${s.turn}:${s.day}:${c.id}`);
  for (const g of Object.values(s.generals)) {
    if (g.castle !== c.id || g.nation !== old) continue;
    const home = old === null || old === -1 ? null : nearestCastle(s, grid, c.tile, old);
    if (home && rng() < 0.5) g.castle = home.id;
    else { g.status = 'prisoner'; g.castle = null; g.captor = u.nation; g.heldAt = c.id; }
  }
  log(s, `🏯 ${s.nations[u.nation].name}의 ${gensOf(s, u.gens)[0]?.name}이(가) ${c.name}${old !== null && old !== -1 ? `(${s.nations[old].name})` : ''}을(를) 함락했습니다!`, 'capture', [u.nation, old]);
  // 이어서 갈 곳(경유지)이 남은 부대는 수비병만 조금 남기고 계속 진군
  if (u.queue?.length && u.troops > 3000) {
    const keep = Math.max(1000, Math.round(u.troops * 0.2 / 1000) * 1000);
    u.troops -= keep;
    c.troops += keep;
    u.order = null;
    u.path = [];
  } else enter(s, u, c);
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
  if (!n.alive || n.outlaw || s.castles.some((c) => c.owner === nid)) return;
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
  outlawTurn(s, grid, makeRng(`outlaw:${s.seed}:${s.turn}`));
  for (const c of s.castles) { const over = c.troops - capOf(c, s); if (over > 0) { c.troops -= Math.round(over * 0.15); if (c.owner === s.playerId && over > 5000) log(s, `🏚️ ${c.name}에 병력이 넘쳐(수용 ${fmtTroops(capOf(c, s))}) ${fmtTroops(Math.round(over * 0.15))}이 흩어졌습니다. 남는 병력은 부대로 내보내세요.`, 'info', [c.owner]); } }
  checkRulers(s);
  buildTurn(s, grid, redistrict);
  s.duelDone = null;
  s.turn += 1;
  s.day = 0;
  rollWeather(s, grid);
  eventsTurn(s, grid);
  const alive = s.nations.filter((n) => n.alive && !n.horde);
  const cities = s.castles.filter((c) => c.kind !== 'pass');
  // 속국의 도시는 종주국 몫으로 셈 (속국만 남으면 천하통일)
  const lordOfN = (id) => (s.pacts || []).find((p) => p.type === 'vassal' && p.b === id)?.a ?? id;
  const top = alive.filter((n) => lordOfN(n.id) === n.id).map((n) => [n, cities.filter((c) => c.owner !== null && lordOfN(c.owner) === n.id).length]).sort((a, b) => b[1] - a[1])[0];
  // 80%를 차지하면 통일 — 「계속 진행」을 고르면 남은 나라가 하나만 남을 때까지 이어 감
  if (alive.length === 1) s.over = { winner: alive[0].id, final: true };
  else if (!s.keepPlaying && top && top[1] >= cities.length * 0.8) s.over = { winner: top[0].id };
  else if (!s.nations[s.playerId].alive && !s.spectator) s.over = { winner: null, lost: true };
}

// 징병: 성에서 금으로 병사를 뽑음 (1명당 10금). 인구가 바닥날 때까지(1천은 남김) 얼마든지 — 뽑은 만큼 인구가 줄고, 인구가 줄면 금 수입도 줄어 듦(바닥나면 절반)
export const draftCost = (c, s) => (s && hasPolicy(s, c.owner, 'conscript') ? 9 : 10);
export const draftLeft14 = (s, c) => Math.max(0, Math.floor(((c.pop || 0) - 1) * 1000 / 1000) * 1000);
export const draftMax14 = (s, c) => Math.max(0, Math.min(Math.floor(s.nations[c.owner].gold / draftCost(c, s) / 1000) * 1000, draftLeft14(s, c)));
export function draft14(s, castleId, amt) {
  const c = s.castles[castleId];
  const n = s.nations[c.owner];
  amt = Math.min(Math.floor(amt / 100) * 100, draftMax14(s, c));
  if (amt < 100) return { ok: false, msg: '뽑을 수 없습니다.' };
  n.gold -= amt * draftCost(c, s);
  c.troops += amt;
  c.pop = Math.max(1, Math.round((c.pop - amt / 1000) * 10) / 10);
  return { ok: true, msg: `${c.name}에서 ${fmtTroops(amt)} 징병 (금 -${fmtGold(amt * draftCost(c, s))})` };
}
