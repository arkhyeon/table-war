import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';
import { makeRng, makeNoise } from './rng.js';
import { neighborIndex, cellCenter, corner, mapSize, pixelToCell, hexDistance } from './hex.js';
import { T, TERRAIN } from './rules.js';
import { RANGES, ZONES, RIVERS } from './geodata.js';
import { traceChains, areaPath, chainStroke } from './borders.js';
import { PLACES } from './places.js';

export const HEX = 10; // 화면 기준 단위
const FINE = 2; // 내부 격자를 FINE배 촘촘하게 (자유곡선 경계용)

let landCache = null;
function landPolygons() {
  if (!landCache) {
    const fc = feature(land50, land50.objects.land);
    const feats = fc.type === 'FeatureCollection' ? fc.features : [fc];
    landCache = [];
    for (const f of feats) {
      const g = f.geometry;
      if (g.type === 'Polygon') landCache.push(g.coordinates);
      else if (g.type === 'MultiPolygon') landCache.push(...g.coordinates);
    }
  }
  return landCache;
}

function makeGeo(bbox, W, H) {
  const [lon0, lat0, lon1, lat1] = bbox;
  return {
    toPx: (lon, lat) => [((lon - lon0) / (lon1 - lon0)) * W, ((lat1 - lat) / (lat1 - lat0)) * H],
    toLL: (x, y) => [lon0 + (x / W) * (lon1 - lon0), lat1 - (y / H) * (lat1 - lat0)],
    pxPerDeg: W / (lon1 - lon0),
  };
}

// 날짜변경선(경도 ±180°)을 넘는 외곽선: 경도를 이어 붙여(unwrap) 지도 끝에서 끝까지 가로지르는 선이 생기지 않게 하고,
// 지도 밖으로 넘친 부분은 ±360° 옮긴 사본으로 반대편에 다시 그림
function unwrapPoly(poly) {
  let shifted = false;
  const rings = poly.map((ring) => {
    let off = 0, prev = null;
    return ring.map(([lon, lat]) => {
      if (prev !== null) {
        if (lon + off - prev > 180) off -= 360;
        else if (lon + off - prev < -180) off += 360;
      }
      const L = lon + off;
      if (L > 180 || L < -180) shifted = true;
      prev = L;
      return [L, lat];
    });
  });
  if (!shifted) return [rings];
  const sh = (d) => rings.map((r) => r.map(([lo, la]) => [lo + d, la]));
  return [rings, sh(360), sh(-360)];
}

// 실제 해안선(Natural Earth)을 캔버스에 그려 육지 판정
function rasterLand(geo, W, H) {
  const cw = Math.ceil(W), ch = Math.ceil(H);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  for (const poly0 of landPolygons()) for (const poly of unwrapPoly(poly0)) {
    ctx.beginPath();
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = geo.toPx(lon, lat);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const data = ctx.getImageData(0, 0, cw, ch).data;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= cw || yi >= ch) return false;
    return data[(yi * cw + xi) * 4 + 3] > 127;
  };
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polyDist(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return best;
}

function buildHistorical(scn, g) {
  const { N, size, W, H, terrain, river, rng, center } = g;
  const geo = makeGeo(scn.bbox, W, H);
  g.geo = geo;
  const isLand = rasterLand(geo, W, H);
  g.isLand = isLand;
  for (let i = 0; i < N; i++) {
    const [x, y] = center(i);
    let n = isLand(x, y) ? 1 : 0;
    for (let k = 0; k < 6; k++) {
      const [cx, cy] = corner(x, y, size * 0.6, k);
      if (isLand(cx, cy)) n++;
    }
    terrain[i] = n >= 4 ? T.PLAINS : T.SEA;
  }
  const n1 = makeNoise(rng), n2 = makeNoise(rng);
  const ranges = RANGES.map((r) => ({ ...r, px: r.pts.map(([lo, la]) => geo.toPx(lo, la)) }));
  for (let i = 0; i < N; i++) {
    if (terrain[i] === T.SEA) continue;
    const [x, y] = center(i);
    const [lon, lat] = geo.toLL(x, y);
    let t = T.PLAINS;
    const m = n1.fbm(x / size / 5, y / size / 5, 3);
    const h = n2.fbm(x / size / 4, y / size / 4, 3);
    if (lat > 66 || lat < -50) t = T.TUNDRA;
    else if (Math.abs(lat) > 55 && m > 0.38) t = T.FOREST;
    else if (m > 0.63) t = T.FOREST;
    if (t === T.PLAINS && h > 0.66) t = T.HILLS;
    for (const z of ZONES) {
      if (((lon - z.c[0]) / z.rx) ** 2 + ((lat - z.c[1]) / z.ry) ** 2 < 1) t = z.t;
    }
    for (const r of ranges) {
      const d = polyDist(x, y, r.px);
      const w = Math.max(r.w * geo.pxPerDeg, g.unit * 1.6);
      if (d < w) t = T.MOUNTAIN;
      if (r.peak && d < Math.max(r.w * 0.45 * geo.pxPerDeg, g.unit * 0.8)) t = T.PEAK;
    }
    terrain[i] = t;
  }
  g.rivers = [];
  for (const rv of RIVERS) {
    const px = rv.pts.map(([lo, la]) => geo.toPx(lo, la));
    let inside = false;
    for (let i = 1; i < px.length; i++) {
      const [ax, ay] = px[i - 1], [bx, by] = px[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (size * 0.4)));
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        inside = true;
        const c = pixelToCell(size, g.cols, g.rows, x, y);
        if (c >= 0 && terrain[c] !== T.SEA && terrain[c] !== T.PEAK) river[c] = 1;
      }
    }
    if (inside) g.rivers.push({ name: rv.name, pts: px });
  }
}

// 랜덤 지도 유형: 땅덩어리 배치 방식
// 랜덤 지도 유형: 대륙판(plates) 배치와 육지 비율
// plates: [개수, 최소 반지름, 최대 반지름], warp: 해안선 비틀림 세기, inland: 내해 파기
export const MAP_STYLES = {
  continents: { name: '대륙들', land: 0.44, plates: [[2, 0.2, 0.27], [1, 0.13, 0.18]], warp: 0.22, islands: [2, 3] },
  pangaea: { name: '판게아', land: 0.5, plates: [[1, 0.33, 0.4], [2, 0.14, 0.2]], warp: 0.2, inland: true, islands: [1, 3] },
  archipelago: { name: '군도', land: 0.36, plates: [[6, 0.08, 0.13]], warp: 0.28, islands: [3, 5] },
  peninsulas: { name: '반도', land: 0.47, plates: [[1, 0.28, 0.34], [3, 0.1, 0.15]], warp: 0.32, islands: [2, 3] },
};

function landComponents(g, isLand) {
  const { N, cols, rows } = g;
  const comp = new Int32Array(N).fill(-1);
  const list = [];
  for (let i = 0; i < N; i++) {
    if (!isLand(i) || comp[i] >= 0) continue;
    const q = [i];
    comp[i] = list.length;
    for (let k = 0; k < q.length; k++) for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, q[k], d);
      if (nb >= 0 && isLand(nb) && comp[nb] < 0) { comp[nb] = comp[i]; q.push(nb); }
    }
    list.push(q);
  }
  return { comp, list };
}

function buildProcedural(scn, g) {
  const { N, size, W, H, terrain, river, rng, center, cols, rows } = g;
  const S = scn.regionSize;
  const nh = makeNoise(rng), nm = makeNoise(rng), nw1 = makeNoise(rng), nw2 = makeNoise(rng), nd = makeNoise(rng);
  const styleKey = rng.weighted(Object.keys(MAP_STYLES), (k) => ({ continents: 0.3, pangaea: 0.25, archipelago: 0.2, peninsulas: 0.25 })[k]);
  const style = MAP_STYLES[styleKey];
  g.style = styleKey;
  const A = H / W; // 세로/가로 비
  // 대륙판: 길쭉하고 기울어진 타원, 서로 겹치지 않게
  const plates = [];
  const place = (r) => {
    let best = null, bd = -Infinity;
    for (let k = 0; k < 60; k++) {
      const c = [rng.range(0.12 + r * 0.55, 0.88 - r * 0.55), rng.range(0.15 + r * 0.7, 0.85 - r * 0.7)];
      const d = plates.length ? Math.min(...plates.map((p) => Math.hypot(p.x - c[0], (p.y - c[1]) * A * 1.6) - p.r - r)) : rng();
      if (d > bd) { bd = d; best = c; }
    }
    plates.push({ x: best[0], y: best[1], r, rot: rng.range(0, Math.PI), stretch: rng.range(1.1, 1.9) });
  };
  for (const [n, r0, r1] of style.plates) for (let k = 0; k < n; k++) place(rng.range(r0, r1));
  const plateVal = (px, py) => {
    let v = 0;
    for (const p of plates) {
      const dx = px - p.x, dy = (py - p.y) * A * 1.6;
      const c = Math.cos(p.rot), sn = Math.sin(p.rot);
      const u = (dx * c + dy * sn) / p.stretch, w = (-dx * sn + dy * c) * p.stretch;
      v = Math.max(v, 1 - Math.hypot(u, w) / (p.r * 1.25));
    }
    return v;
  };
  // 내해(판게아): 큰 대륙 안쪽을 파서 지중해 같은 바다
  const inland = style.inland ? { x: plates[0].x + rng.range(-0.06, 0.06), y: plates[0].y + rng.range(-0.08, 0.08), r: plates[0].r * rng.range(0.32, 0.45) } : null;
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y] = center(i);
    const nx = x / W, ny = y / H;
    // 도메인 왜곡: 해안선을 비틀어 반도·만이 생기게
    const wx = (nw1.fbm(nx * 3.2, ny * 3.2 * A * 1.6, 4) - 0.5) * style.warp * 2;
    const wy = (nw2.fbm(nx * 3.2 + 7.1, ny * 3.2 * A * 1.6 + 3.3, 4) - 0.5) * style.warp * 2;
    const px = nx + wx, py = ny + wy;
    const detail = nh.fbm(px * 6, py * 6 * A * 1.6, 6);
    let e = Math.max(0, plateVal(px, py)) * 0.85 + detail * 0.45;
    if (inland) e -= Math.max(0, 1 - Math.hypot(px - inland.x, (py - inland.y) * A * 1.6) / inland.r) * 0.6;
    // 가장자리는 바다 (둥근 사각형 + 비틀림으로 직선 테두리 방지)
    const ex = Math.abs(px - 0.5) * 2, ey = Math.abs(py - 0.5) * 2;
    const edge = Math.pow(Math.pow(ex, 6) + Math.pow(ey, 6), 1 / 6);
    e -= Math.max(0, edge - 0.62) * 3.2;
    height[i] = e;
  }
  const sorted = Array.from(height).sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(N * (1 - style.land))];
  const isLandH = new Uint8Array(N);
  for (let i = 0; i < N; i++) isLandH[i] = height[i] > seaLevel ? 1 : 0;
  // 땅덩어리 정리: 지역 1곳도 안 되는 부스러기는 바다로, 지역 3곳 이하 크기의 섬은 4곳 크기까지 키움
  let { comp, list } = landComponents(g, (i) => isLandH[i]);
  const grow = (cells, target) => {
    const own = new Set(cells);
    const frontier = [];
    const pushNb = (c) => {
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && !isLandH[nb] && !own.has(nb)) frontier.push(nb);
      }
    };
    cells.forEach(pushNb);
    let n = cells.length;
    while (n < target && frontier.length) {
      const k = Math.floor(rng() * frontier.length);
      const c = frontier[k];
      frontier[k] = frontier[frontier.length - 1];
      frontier.pop();
      if (isLandH[c] || own.has(c)) continue;
      const [x, y] = center(c);
      if (x < size * 4 || y < size * 4 || x > W - size * 4 || y > H - size * 4) continue;
      // 다른 땅덩어리와 붙지 않게
      let touches = false;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && isLandH[nb] && !own.has(nb)) touches = true;
      }
      if (touches) continue;
      own.add(c);
      isLandH[c] = 1;
      height[c] = seaLevel + 0.01;
      n++;
      pushNb(c);
    }
  };
  for (const cells of list) {
    if (cells.length < S * 0.6) for (const c of cells) isLandH[c] = 0;
    else if (cells.length < S * 3.5) grow(cells, S * 4);
  }
  ({ comp, list } = landComponents(g, (i) => isLandH[i]));
  // 섬 보장: 가장 큰 땅 말고 지역 4곳 이상 섬이 하나도 없으면 먼 바다에 섬을 만든다
  list.sort((a, b) => b.length - a.length);
  const islands = list.slice(1).filter((c) => c.length >= S * 4).length;
  const want = rng.int(style.islands[0], style.islands[1]);
  for (let k = islands; k < want; k++) {
    const dist = new Int32Array(N).fill(-1);
    const q = [];
    for (let i = 0; i < N; i++) if (isLandH[i]) { dist[i] = 0; q.push(i); }
    for (let j = 0; j < q.length; j++) for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, q[j], d);
      if (nb >= 0 && dist[nb] < 0) { dist[nb] = dist[q[j]] + 1; q.push(nb); }
    }
    // 대륙에서 너무 멀지 않은 바다(5~11칸)에 섬 — 지도 구석에 처박히지 않게
    const cand = [];
    for (let i = 0; i < N; i++) {
      const [x, y] = center(i);
      if (x < W * 0.1 || x > W * 0.9 || y < H * 0.12 || y > H * 0.88) continue;
      if (dist[i] >= 5 && dist[i] <= 11) cand.push(i);
    }
    if (!cand.length) break;
    const best = rng.pick(cand);
    isLandH[best] = 1;
    height[best] = seaLevel + 0.02;
    grow([best], Math.round(S * rng.range(4.5, 7)));
  }
  const land = [];
  for (let i = 0; i < N; i++) if (isLandH[i]) land.push(i);
  // 산맥: 대륙판마다 1~2줄기의 굽은 능선을 긋고, 능선에 가까울수록 높은 산 (흩뿌린 산 대신 줄기)
  const ranges = [];
  for (const p of plates) {
    const n = p.r > 0.18 ? rng.int(1, 2) : rng.int(0, 1);
    for (let k = 0; k < n; k++) {
      let ang = p.rot + rng.range(-0.6, 0.6) + (k ? Math.PI / 2 : 0);
      let x = p.x + rng.range(-p.r, p.r) * 0.5, y = p.y + rng.range(-p.r, p.r) * 0.5 / (A * 1.6);
      const pts = [[x, y]];
      const steps = rng.int(4, 7), len = (p.r * 1.6) / steps;
      for (let t = 0; t < steps; t++) {
        ang += rng.range(-0.45, 0.45);
        x += Math.cos(ang) * len;
        y += (Math.sin(ang) * len) / (A * 1.6);
        pts.push([x, y]);
      }
      ranges.push(pts);
    }
  }
  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = (by - ay) * A * 1.6, qx = px - ax, qy = (py - ay) * A * 1.6;
    const t = Math.max(0, Math.min(1, (qx * dx + qy * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(qx - dx * t, qy - dy * t);
  };
  const ridge = new Float32Array(N);
  for (const i of land) {
    const [x, y] = center(i);
    const nx = x / W, ny = y / H;
    let d = 1;
    for (const pts of ranges) for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(nx, ny, pts[k - 1], pts[k]));
    ridge[i] = 1 - d * 9 + (nd.fbm(nx * 9, ny * 9 * A * 1.6, 3) - 0.5) * 0.7;
  }
  const rs = land.map((i) => ridge[i]).sort((a, b) => a - b);
  const mtnT = rs[Math.floor(rs.length * (1 - rng.range(0.12, 0.18)))];
  const peakT = rs[Math.floor(rs.length * 0.97)];
  const lh = land.map((i) => height[i]).sort((a, b) => a - b);
  const hillsT = lh[Math.floor(lh.length * 0.8)];
  for (let i = 0; i < N; i++) {
    if (!isLandH[i]) {
      terrain[i] = T.SEA;
      continue;
    }
    const [x, y] = center(i);
    const ny = y / H;
    const moist = nm.fbm((x / W) * 4, ny * 4, 3);
    const temp = 1 - Math.abs(ny - 0.5) * 2;
    let t = T.PLAINS;
    if (temp < 0.12) t = T.TUNDRA;
    else if (moist < 0.36 && temp > 0.45) t = T.DESERT;
    else if (moist > 0.6) t = T.FOREST;
    if (height[i] > hillsT && t !== T.DESERT) t = T.HILLS;
    if (ridge[i] >= mtnT) t = T.MOUNTAIN;
    if (ridge[i] >= peakT && height[i] > hillsT) t = T.PEAK;
    terrain[i] = t;
  }
  // 강: 산에서 시작해 낮은 곳으로 흐름
  g.rivers = [];
  const starts = rng.shuffle(land.filter((i) => terrain[i] === T.MOUNTAIN || terrain[i] === T.HILLS)).slice(0, Math.round(land.length / (120 * FINE * FINE)));
  for (const s of starts) {
    let c = s;
    const path = [c];
    const seen = new Set([c]);
    for (let k = 0; k < 40 * FINE; k++) {
      let best = -1, bh = height[c];
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb < 0 || seen.has(nb)) continue;
        if (height[nb] < bh) { bh = height[nb]; best = nb; }
      }
      if (best < 0) break;
      c = best;
      seen.add(c);
      path.push(c);
      if (terrain[c] === T.SEA) break;
    }
    if (path.length < 5 * FINE || terrain[path[path.length - 1]] !== T.SEA) continue;
    for (const p of path) if (terrain[p] !== T.SEA && terrain[p] !== T.PEAK) river[p] = 1;
    g.rivers.push({ name: '강', pts: path.map((p) => center(p)) });
  }
}

class Heap {
  constructor() { this.a = []; }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

// 두 육지 칸 사이에 실제로 바다(해협)가 있는지: 중심을 잇는 선 위 세 점을 실제 해안선으로 검사
function waterBetween(g, a, b) {
  if (!g.isLand) return false;
  const [ax, ay] = g.center(a), [bx, by] = g.center(b);
  for (const t of [0.35, 0.5, 0.65]) if (!g.isLand(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
  return false;
}

// 칸마다 씨앗 간격 배율 (역사 지도만): 주변 지명 밀도가 평균보다 높으면 작게
function densityScale(scn, g, cells, minD) {
  if (!g.geo) return null;
  const { cols, rows, terrain } = g;
  const B = Math.max(2, minD * 2);
  const bc = Math.ceil(cols / B) + 1, br = Math.ceil(rows / B) + 1;
  const cnt = new Float32Array(bc * br);
  for (const p of PLACES) {
    const [x, y] = g.geo.toPx(p.lon, p.lat);
    const c = pixelToCell(g.size, cols, rows, x, y);
    if (c < 0) continue;
    cnt[Math.floor(Math.floor(c / cols) / B) * bc + Math.floor((c % cols) / B)]++;
  }
  const dens = (c) => {
    const bx = Math.floor((c % cols) / B), by = Math.floor(Math.floor(c / cols) / B);
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = bx + dx, y = by + dy;
      if (x >= 0 && y >= 0 && x < bc && y < br) n += cnt[y * bc + x] * (dx || dy ? 0.5 : 1);
    }
    return n;
  };
  const d = new Float32Array(g.N);
  let sum = 0;
  for (const c of cells) { d[c] = dens(c); sum += d[c]; }
  const avg = sum / cells.length || 1;
  const sc = new Float32Array(g.N).fill(1);
  for (const c of cells) {
    let k = Math.pow(avg / (d[c] + avg * 0.15), 0.4);
    let coast = 0;
    for (let dir = 0; dir < 6; dir++) {
      const nb = neighborIndex(cols, rows, c, dir);
      if (nb < 0 || terrain[nb] === T.SEA) coast++;
    }
    if (coast) k *= 0.85;
    // 세계판 지역사: 무대가 된 지역은 훨씬 잘게
    if (scn.focus) {
      const [lon, lat] = g.geo.toLL(...g.center(c));
      const [w, s, e, n] = scn.focus;
      if (lon >= w && lon <= e && lat >= s && lat <= n) { sc[c] = 0.5; continue; }
    }
    sc[c] = Math.max(0.5, Math.min(1.35, k));
  }
  return sc;
}

function buildRegions(scn, g) {
  const { N, cols, rows, terrain, river, rng } = g;
  const passable = (i) => terrain[i] !== T.SEA && terrain[i] !== T.PEAK;
  const S = scn.regionSize;
  const region = new Int32Array(N).fill(-1);
  const cells = [];
  for (let i = 0; i < N; i++) if (passable(i)) cells.push(i);
  const K = Math.max(4, Math.round(cells.length / S));
  const minD = Math.max(2, Math.floor(Math.sqrt(S) * 0.95));
  const seeds = [];
  // 역사 지도: 나라마다 수도 자리에 씨앗을 먼저 심어 수도끼리 한 지역에 뭉치지 않게
  if (g.geo && scn.nations) {
    for (const n of scn.nations) {
      const [x, y] = g.geo.toPx(n.lon, n.lat);
      let c = pixelToCell(g.size, cols, rows, x, y);
      if (c < 0 || !passable(c)) {
        let bd = Infinity;
        for (const i of cells) {
          const [cx, cy] = g.center(i);
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bd) { bd = d; c = i; }
        }
      }
      if (c >= 0 && passable(c) && seeds.every((s) => hexDistance(cols, s, c) >= 2)) seeds.push(c);
    }
  }
  // 지명이 빽빽한 곳(일본·유럽 등)과 좁은 해안 땅은 더 잘게, 시베리아처럼 빈 곳은 크게
  const scale = densityScale(scn, g, cells, minD);
  const near = (a, b) => hexDistance(cols, a, b) < minD * Math.min(scale[a], scale[b]);
  const maxK = scale ? Math.round(K * (scn.focus ? 1.8 : 1.3)) : K;
  let order = rng.shuffle(cells.slice());
  if (scale) {
    // 빽빽한 곳부터 씨앗을 심어야 상한에 걸려도 일본·유럽이 먼저 잘게 나뉨
    const key = new Float32Array(g.N);
    for (const c of order) key[c] = scale[c] * (0.75 + rng() * 0.5);
    order.sort((a, b) => key[a] - key[b]);
  }
  for (const c of order) {
    if (seeds.length >= maxK) break;
    if (scale ? !seeds.some((s) => near(s, c)) : seeds.every((s) => hexDistance(cols, s, c) >= minD)) seeds.push(c);
  }
  const heap = new Heap();
  seeds.forEach((c, k) => heap.push([0, c, k]));
  while (heap.size) {
    const [cost, c, k] = heap.pop();
    if (region[c] !== -1) continue;
    region[c] = k;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb < 0 || !passable(nb) || region[nb] !== -1 || waterBetween(g, c, nb)) continue;
      const step = 1 + (terrain[nb] === T.MOUNTAIN ? 1.2 : 0) + (river[nb] !== river[c] ? 1.6 : 0) + rng() * 0.9;
      heap.push([cost + step, nb, k]);
    }
  }
  // 씨앗이 없는 섬
  let next = seeds.length;
  for (const c of cells) {
    if (region[c] !== -1) continue;
    const comp = [c];
    region[c] = -2;
    for (let q = 0; q < comp.length; q++) {
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, comp[q], d);
        if (nb >= 0 && passable(nb) && region[nb] === -1) {
          region[nb] = -2;
          comp.push(nb);
        }
      }
    }
    if (comp.length >= 2) {
      for (const x of comp) region[x] = next;
      next++;
    } else {
      let coastal = false;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb < 0 || terrain[nb] === T.SEA) coastal = true;
      }
      terrain[c] = coastal ? T.SEA : T.PEAK;
      region[c] = -1;
    }
  }
  // 너무 작은 지역 병합
  const lists = Array.from({ length: next }, () => []);
  for (let i = 0; i < N; i++) if (region[i] >= 0) lists[region[i]].push(i);
  const minSize = Math.max(2, Math.round(S * 0.3));
  for (let r = 0; r < next; r++) {
    if (!lists[r].length || lists[r].length >= (scale ? Math.max(2, Math.round(minSize * scale[lists[r][0]] ** 2)) : minSize)) continue;
    const adj = new Map();
    for (const c of lists[r]) {
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && region[nb] >= 0 && region[nb] !== r) adj.set(region[nb], lists[region[nb]].length);
      }
    }
    if (!adj.size) continue;
    const target = [...adj.entries()].sort((a, b) => a[1] - b[1])[0][0];
    for (const c of lists[r]) region[c] = target;
    lists[target].push(...lists[r]);
    lists[r] = [];
  }
  const remap = new Int32Array(next).fill(-1);
  let id = 0;
  for (let r = 0; r < next; r++) if (lists[r].length) remap[r] = id++;
  for (let i = 0; i < N; i++) if (region[i] >= 0) region[i] = remap[region[i]];
  g.region = region;
  g.regionCount = id;
}

function finalizeRegions(scn, g) {
  const { N, cols, rows, terrain, river, region, rng, center, regionCount } = g;
  const regs = Array.from({ length: regionCount }, (_, id) => ({ id, cells: [], neighbors: [] }));
  for (let i = 0; i < N; i++) if (region[i] >= 0) regs[region[i]].cells.push(i);
  const pairs = new Map();
  for (const r of regs) {
    const counts = {};
    let sx = 0, sy = 0, rivers = 0, coastal = false;
    for (const c of r.cells) {
      counts[terrain[c]] = (counts[terrain[c]] || 0) + 1;
      const [x, y] = center(c);
      sx += x;
      sy += y;
      if (river[c]) rivers++;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && terrain[nb] === T.SEA) coastal = true;
        if (nb < 0 || region[nb] < 0 || region[nb] === r.id) continue;
        if (region[nb] < r.id) continue;
        const key = r.id * 100000 + region[nb];
        const p = pairs.get(key) || { n: 0, riv: 0, water: 0 };
        if (waterBetween(g, c, nb)) p.water++;
        p.n++;
        if (river[c] || river[nb]) p.riv++;
        pairs.set(key, p);
      }
    }
    const n = r.cells.length;
    const mx = sx / n, my = sy / n;
    let best = r.cells[0], bd = Infinity;
    for (const c of r.cells) {
      const [x, y] = center(c);
      let inner = 0;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && region[nb] === r.id) inner++;
      }
      const dd = Math.hypot(x - mx, y - my) - inner * g.size * 0.35;
      if (dd < bd) { bd = dd; best = c; }
    }
    [r.cx, r.cy] = center(best);
    r.labelCell = best;
    r.coastal = coastal;
    r.river = rivers > 0;
    const mtn = counts[T.MOUNTAIN] || 0;
    r.terrain = mtn / n >= 0.35 ? T.MOUNTAIN : +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    let pop = 0;
    for (const c of r.cells) pop += TERRAIN[terrain[c]].pop || 10;
    pop = (pop / n) * Math.sqrt(n / scn.regionSize) * (0.75 + rng() * 0.5);
    if (r.river) pop += 6;
    if (coastal) pop += 3;
    r.pop = Math.max(4, Math.round(pop));
  }
  for (const [key, p] of pairs) {
    const a = Math.floor(key / 100000), b = key % 100000;
    const type = p.water / p.n > 0.5 ? 'strait' : p.riv / p.n >= 0.4 ? 'river' : 'land';
    regs[a].neighbors.push({ id: b, type });
    regs[b].neighbors.push({ id: a, type });
  }
  g.regions = regs;
}


// 바다 구역: 해안에서 일정 거리 이내의 바다를 구역으로 나눠 함대가 한 칸씩 이동
function buildSeaZones(scn, g) {
  const { N, cols, rows, terrain, region, rng, center, size } = g;
  const reach = scn.seaReach;
  const dist = new Int32Array(N).fill(-1);
  const q = [];
  for (let i = 0; i < N; i++) {
    if (terrain[i] !== T.SEA) continue;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, i, d);
      if (nb >= 0 && terrain[nb] !== T.SEA && terrain[nb] !== T.PEAK) {
        dist[i] = 1;
        q.push(i);
        break;
      }
    }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (dist[c] >= reach) continue;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb >= 0 && terrain[nb] === T.SEA && dist[nb] === -1) {
        dist[nb] = dist[c] + 1;
        q.push(nb);
      }
    }
  }
  const cells = q;
  const S = Math.round(scn.regionSize * 2.2);
  const K = Math.max(1, Math.round(cells.length / S));
  const minD = Math.max(2, Math.floor(Math.sqrt(S) * 0.95));
  const seeds = [];
  for (const c of rng.shuffle(cells.slice())) {
    if (seeds.length >= K) break;
    if (seeds.every((x) => hexDistance(cols, x, c) >= minD)) seeds.push(c);
  }
  const zone = new Int32Array(N).fill(-1);
  const heap = new Heap();
  seeds.forEach((c, k) => heap.push([0, c, k]));
  while (heap.size) {
    const [cost, c, k] = heap.pop();
    if (zone[c] !== -1) continue;
    zone[c] = k;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb < 0 || dist[nb] === -1 || zone[nb] !== -1) continue;
      heap.push([cost + 1 + rng() * 0.8, nb, k]);
    }
  }
  // 씨앗 없는 바다 조각
  let next = seeds.length;
  for (const c of cells) {
    if (zone[c] !== -1) continue;
    const comp = [c];
    zone[c] = next;
    for (let i = 0; i < comp.length; i++) {
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, comp[i], d);
        if (nb >= 0 && dist[nb] !== -1 && zone[nb] === -1) {
          zone[nb] = next;
          comp.push(nb);
        }
      }
    }
    next++;
  }
  const lists = Array.from({ length: next }, () => []);
  for (const c of cells) lists[zone[c]].push(c);
  const minSize = Math.max(3, Math.round(S * 0.25));
  for (let z = 0; z < next; z++) {
    if (!lists[z].length || lists[z].length >= minSize) continue;
    const adj = new Map();
    for (const c of lists[z]) for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb >= 0 && zone[nb] >= 0 && zone[nb] !== z) adj.set(zone[nb], lists[zone[nb]].length);
    }
    if (!adj.size) continue;
    const t = [...adj.entries()].sort((a, b) => a[1] - b[1])[0][0];
    for (const c of lists[z]) zone[c] = t;
    lists[t].push(...lists[z]);
    lists[z] = [];
  }
  const L = g.regions.length;
  const remap = new Int32Array(next).fill(-1);
  let id = 0;
  for (let z = 0; z < next; z++) if (lists[z].length) remap[z] = id++;
  const seas = [];
  for (let z = 0; z < next; z++) {
    if (remap[z] < 0) continue;
    const zc = lists[z];
    let sx = 0, sy = 0;
    for (const c of zc) {
      const [x, y] = center(c);
      sx += x;
      sy += y;
    }
    const mx = sx / zc.length, my = sy / zc.length;
    let best = zc[0], bd = Infinity;
    for (const c of zc) {
      const [x, y] = center(c);
      let inner = 0;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && zone[nb] === z) inner++;
      }
      const dd = Math.hypot(x - mx, y - my) - inner * size * 0.35;
      if (dd < bd) { bd = dd; best = c; }
    }
    const [cx, cy] = center(best);
    seas.push({ id: L + remap[z], cells: zc, cx, cy, terrain: T.SEA, coastal: true, sea: true, pop: 0, neighbors: [] });
  }
  const seaOf = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (zone[i] >= 0 && remap[zone[i]] >= 0) seaOf[i] = L + remap[zone[i]];
  const all = [...g.regions, ...seas];
  const link = (a, b, type) => {
    if (!all[a].neighbors.some((x) => x.id === b)) all[a].neighbors.push({ id: b, type });
  };
  // 해안 접촉 칸 중 험산·구릉·고산이 많으면 절벽 해안(상륙 페널티 큼)
  const contact = new Map();
  for (const zr of seas) {
    for (const c of zr.cells) for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb < 0) continue;
      if (seaOf[nb] >= 0 && seaOf[nb] !== zr.id) link(zr.id, seaOf[nb], 'sea');
      else if (region[nb] >= 0) {
        const key = zr.id * 100000 + region[nb];
        const v = contact.get(key) || { n: 0, rough: 0 };
        v.n++;
        if (terrain[nb] === T.MOUNTAIN || terrain[nb] === T.HILLS) v.rough++;
        contact.set(key, v);
      }
    }
  }
  // 절벽은 해안 접점의 18%까지만, 해안 지역마다 상륙 가능한 바다는 하나 이상 남김
  const cands = [...contact].map(([key, v]) => ({ z: Math.floor(key / 100000), r: key % 100000, score: v.rough / v.n + rng() * 0.35 }));
  cands.sort((a, b) => b.score - a.score);
  const coastsOf = new Map();
  for (const c of cands) coastsOf.set(c.r, (coastsOf.get(c.r) || 0) + 1);
  const maxCliff = Math.floor(cands.length * 0.18);
  let cliffs = 0;
  for (const c of cands) {
    const left = coastsOf.get(c.r);
    c.cliff = cliffs < maxCliff && c.score > 0.55 && left > 1;
    if (c.cliff) { cliffs++; coastsOf.set(c.r, left - 1); }
  }
  for (const c of cands) {
    link(c.z, c.r, c.cliff ? 'cliff' : 'landing');
    link(c.r, c.z, 'coast');
  }
  g.landCount = L;
  g.regions = all;
  g.seaOf = seaOf;
}

const f1 = (v) => Math.round(v * 10) / 10;

// 실제 해안선 SVG 경로 (역사 지도)
function realLandPath(geo, W, H) {
  let d = '';
  for (const poly0 of landPolygons()) for (const poly of unwrapPoly(poly0)) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    const rings = poly.map((ring) => ring.map(([lo, la]) => {
      const [x, y] = geo.toPx(lo, la);
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      return [x, y];
    }));
    if (maxx < -20 || minx > W + 20 || maxy < -20 || miny > H + 20) continue;
    if (maxx - minx < 1.2 && maxy - miny < 1.2) continue;
    for (const ring of rings) {
      let last = null;
      let part = '';
      for (const [x, y] of ring) {
        if (last && Math.abs(x - last[0]) + Math.abs(y - last[1]) < 0.8) continue;
        part += (part ? 'L' : 'M') + f1(x) + ' ' + f1(y);
        last = [x, y];
      }
      d += part + 'Z';
    }
  }
  return d;
}

function buildGeometry(g) {
  const { N, cols, rows, size, unit, terrain, region, center, regions } = g;
  // 바다 쪽으로 지역 색을 확장한 라벨 (실제 해안선으로 잘라낼 여백)
  const ext = new Int32Array(N);
  const queue = [];
  const depth = new Uint8Array(N);
  // 고산(통행 불가) 칸도 가장 가까운 지역 색으로 칠해 국가 색에 빈틈이 없게
  const pq = [];
  for (let i = 0; i < N; i++) {
    ext[i] = terrain[i] === T.PEAK ? -3 : terrain[i] === T.SEA ? -1 : region[i];
    if (ext[i] >= 0) pq.push(i);
  }
  for (let q = 0; q < pq.length; q++) for (let d = 0; d < 6; d++) {
    const nb = neighborIndex(cols, rows, pq[q], d);
    if (nb >= 0 && ext[nb] === -3) {
      ext[nb] = ext[pq[q]];
      pq.push(nb);
    }
  }
  for (let i = 0; i < N; i++) {
    if (ext[i] === -3) ext[i] = -2;
    if (ext[i] !== -1) queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    if (depth[c] >= 3) continue;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb < 0 || ext[nb] !== -1) continue;
      ext[nb] = ext[c];
      depth[nb] = depth[c] + 1;
      queue.push(nb);
    }
  }
  const chains = traceChains(g, ext);
  const regionPath = regions.filter((r) => !r.sea).map((r) => areaPath(chains, r.id));
  const peakLab = new Int32Array(N);
  for (let i = 0; i < N; i++) peakLab[i] = terrain[i] === T.PEAK ? 1 : 0;
  const peaks = areaPath(traceChains(g, peakLab, 0.3), 1);
  const pairSegs = new Map();
  let borders = '';
  for (const c of chains) {
    if (c.a < -1 && c.b >= 0) borders += chainStroke(c);
    if (c.a < 0) continue;
    const sd = chainStroke(c);
    borders += sd;
    const key = c.a * 100000 + c.b;
    pairSegs.set(key, (pairSegs.get(key) || '') + sd);
  }
  let land;
  if (g.geo) land = realLandPath(g.geo, g.W, g.H);
  else {
    const lab = new Int32Array(N);
    for (let i = 0; i < N; i++) lab[i] = terrain[i] === T.SEA ? 0 : 1;
    land = areaPath(traceChains(g, lab, 0.3), 1);
  }
  // 지형 기호: 듬성듬성 배치
  const s = unit;
  const glyph = { forest: '', hills: '', mountain: '', mountainShade: '', desert: '', tundra: '', peakCap: '', cliff: '' };
  for (let i = 0; i < N; i++) {
    const t = terrain[i];
    if (t === T.SEA || t === T.PLAINS) continue;
    const c = i % cols, r = (i / cols) | 0;
    const dense = t === T.PEAK || t === T.MOUNTAIN;
    if (dense ? r % 2 || (c + (r >> 1)) % 2 : r % 3 || (c + (r / 3) | 0) % 3) continue;
    const [x, y] = center(i);
    if (t === T.PEAK) glyph.peakCap += `M${f1(x - 0.6 * s)} ${f1(y + 0.45 * s)}L${f1(x)} ${f1(y - 0.6 * s)}L${f1(x + 0.6 * s)} ${f1(y + 0.45 * s)}Z`;
    else if (t === T.MOUNTAIN) continue; // 험산은 아래에서 경계선을 따라 그림
    else if (t === T.FOREST) glyph.forest += `M${f1(x - 0.25 * s)} ${f1(y)}a${f1(0.25 * s)} ${f1(0.25 * s)} 0 1 0 ${f1(0.5 * s)} 0a${f1(0.25 * s)} ${f1(0.25 * s)} 0 1 0 ${f1(-0.5 * s)} 0`;
    else if (t === T.HILLS) glyph.hills += `M${f1(x - 0.4 * s)} ${f1(y + 0.2 * s)}Q${f1(x)} ${f1(y - 0.4 * s)} ${f1(x + 0.4 * s)} ${f1(y + 0.2 * s)}`;
    else if (t === T.DESERT) glyph.desert += `M${f1(x - 0.3 * s)} ${f1(y)}h0.1M${f1(x + 0.25 * s)} ${f1(y + 0.25 * s)}h0.1M${f1(x + 0.05 * s)} ${f1(y - 0.3 * s)}h0.1`;
    else if (t === T.TUNDRA) glyph.tundra += `M${f1(x - 0.4 * s)} ${f1(y)}h${f1(0.8 * s)}M${f1(x - 0.2 * s)} ${f1(y + 0.25 * s)}h${f1(0.4 * s)}`;
  }
  // 험산 경계: 경계선을 따라 작은 봉우리 (두 칸의 가운데에)
  (g.mtnPairs || []).forEach(([a, b], k) => {
    if (k % 2) return;
    const [ax, ay] = center(a), [bx, by] = center(b);
    const x = (ax + bx) / 2, y = (ay + by) / 2, m = 0.42;
    glyph.mountain += `M${f1(x - m * s)} ${f1(y + 0.3 * s)}L${f1(x)} ${f1(y - 0.42 * s)}L${f1(x + m * s)} ${f1(y + 0.3 * s)}Z`;
    glyph.mountainShade += `M${f1(x)} ${f1(y - 0.42 * s)}L${f1(x + m * s)} ${f1(y + 0.3 * s)}L${f1(x + 0.08 * s)} ${f1(y + 0.3 * s)}Z`;
  });
  // 절벽 해안: 절벽으로 이어진 (바다 구역, 육지 지역) 접촉 칸에 톱니 표시
  const cliffPair = new Set();
  for (const r of regions) if (r.sea) for (const nb of r.neighbors) if (nb.type === 'cliff') cliffPair.add(r.id * 100000 + nb.id);
  if (cliffPair.size) {
    for (let i = 0; i < N; i++) {
      const rr = region[i];
      if (rr < 0 || (i + ((i / cols) | 0)) % 2) continue;
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, i, d);
        if (nb < 0 || g.seaOf[nb] < 0 || !cliffPair.has(g.seaOf[nb] * 100000 + rr)) continue;
        const [x, y] = center(i);
        glyph.cliff += `M${f1(x - 0.42 * s)} ${f1(y + 0.18 * s)}L${f1(x - 0.21 * s)} ${f1(y - 0.22 * s)}L${f1(x)} ${f1(y + 0.18 * s)}L${f1(x + 0.21 * s)} ${f1(y - 0.22 * s)}L${f1(x + 0.42 * s)} ${f1(y + 0.18 * s)}`;
        break;
      }
    }
  }
  // 바다 구역 경계
  const seaLab = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (g.seaOf[i] >= 0) seaLab[i] = g.seaOf[i];
  const seaChains = traceChains(g, seaLab, 0.3);
  const seaPath = regions.filter((r) => r.sea).map((r) => areaPath(seaChains, r.id));
  let seaBorders = '';
  for (const c of seaChains) if (c.a >= 0 && c.b >= 0) seaBorders += chainStroke(c);
  const outline = [...regionPath, ...seaPath];
  g.paths = { regionPath: outline, outline, pairSegs, borders, peaks, land, glyph, seaBorders };
}

// 험산 경계: 두 지역이 맞닿은 칸 쌍 중 험산(또는 고산 옆) 비율이 높으면 그 경계선 자체가 험산
function markMountainBorders(g) {
  const { N, cols, rows, terrain, region, regions } = g;
  const rough = (c) => {
    if (terrain[c] === T.MOUNTAIN) return true;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb >= 0 && terrain[nb] === T.PEAK) return true;
    }
    return false;
  };
  const tot = new Map(), mtn = new Map();
  g.mtnPairs = [];
  for (let i = 0; i < N; i++) {
    const a = region[i];
    if (a < 0) continue;
    for (let d = 0; d < 3; d++) {
      const nb = neighborIndex(cols, rows, i, d);
      if (nb < 0) continue;
      const b = region[nb];
      if (b < 0 || b === a) continue;
      const key = Math.min(a, b) * 100000 + Math.max(a, b);
      tot.set(key, (tot.get(key) || 0) + 1);
      if (rough(i) || rough(nb)) {
        mtn.set(key, (mtn.get(key) || 0) + 1);
        g.mtnPairs.push([i, nb, key]);
      }
    }
  }
  const isMtn = new Set();
  for (const [key, t] of tot) if ((mtn.get(key) || 0) / t >= 0.4) isMtn.add(key);
  for (const r of regions) for (const e of r.neighbors) {
    const key = Math.min(r.id, e.id) * 100000 + Math.max(r.id, e.id);
    if ((e.type === 'land' || e.type === 'river') && isMtn.has(key)) e.mtn = true;
  }
  g.mtnPairs = g.mtnPairs.filter(([, , key]) => isMtn.has(key));
}

// 지도 세분화: grid = 격자 해상도 배율, region = 지역 하나의 칸 수 배율 → 지역 수 ≈ grid² / region 배
export const MAP_DETAIL = {
  coarse: { name: '큼직하게', grid: 1, region: 1.7 },
  normal: { name: '보통', grid: 1, region: 1 },
  fine: { name: '잘게', grid: 1.35, region: 0.8 },
  ultra: { name: '아주 잘게', grid: 1.7, region: 0.7 },
};
export const detailFactor = (d) => {
  const m = MAP_DETAIL[d] || MAP_DETAIL.normal;
  return (m.grid * m.grid) / m.region;
};

// 좁은 해협: 지도 해상도로는 바다에 막히지만 실제로는 건너다닌 곳 → 해협 경로로 직접 연결
const STRAITS = [
  [130.93, 33.88, 130.98, 34.02], // 간몬 (규슈-혼슈)
  [140.75, 41.25, 140.7, 41.75], // 쓰가루 (혼슈-홋카이도)
  [134.98, 34.65, 134.65, 34.22], // 아카시·나루토 (혼슈-아와지-시코쿠)
  [133.0, 34.3, 132.8, 33.95], // 시마나미 (혼슈-시코쿠 서쪽)
  [1.6, 51.05, 1.75, 50.85], // 도버
  [15.62, 38.25, 15.66, 38.05], // 메시나
  [12.62, 56.05, 12.68, 55.9], // 외레순
  [36.45, 45.38, 36.6, 45.2], // 케르치
  [29.0, 41.15, 29.1, 41.0], // 보스포루스
  [26.4, 40.2, 26.5, 40.05], // 다르다넬스
  [-5.6, 36.05, -5.4, 35.85], // 지브롤터
  [9.25, 41.35, 9.2, 41.2], // 보니파시오 (코르시카-사르데냐)
  [79.85, 9.25, 79.75, 9.05], // 팔크 (인도-스리랑카)
  [43.35, 12.65, 43.2, 12.5], // 바브엘만데브
  [-6.0, 54.9, -5.1, 55.25], // 노스 해협 (아일랜드-스코틀랜드)
];

function linkStraits(g) {
  g.straitLines = [];
  if (!g.geo) return;
  for (const [a0, a1, b0, b1] of STRAITS) {
    const [ax, ay] = g.geo.toPx(a0, a1), [bx, by] = g.geo.toPx(b0, b1);
    if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax > g.W || bx > g.W || ay > g.H || by > g.H) continue;
    const ra = g.nearestRegion(ax, ay), rb = g.nearestRegion(bx, by);
    if (ra < 0 || rb < 0 || ra === rb) continue;
    const A = g.regions[ra], B = g.regions[rb];
    if (A.sea || B.sea || Math.hypot(A.cx - B.cx, A.cy - B.cy) > g.W * 0.08) continue;
    if (!A.neighbors.some((x) => x.id === rb)) A.neighbors.push({ id: rb, type: 'strait' });
    if (!B.neighbors.some((x) => x.id === ra)) B.neighbors.push({ id: ra, type: 'strait' });
    g.straitLines.push([ax, ay, bx, by]);
  }
}

export function generateWorld(scn0, seed, detail = 'normal') {
  const dm = MAP_DETAIL[detail] || MAP_DETAIL.normal;
  // 보통은 예전 시드와 같은 지도가 나오도록 rng 키를 유지
  // 역사 지도는 시드와 상관없이 늘 같은 지도(그 시대의 고정된 지역 구획)
  const mapSeed = scn0.procedural ? seed : 'fixed';
  const rng = makeRng(detail === 'normal' || !MAP_DETAIL[detail] ? `${scn0.id}:${mapSeed}` : `${scn0.id}:${mapSeed}:${detail}`);
  const gc = Math.round(scn0.cols * dm.grid), gr = Math.round(scn0.rows * dm.grid);
  const scn = { ...scn0, cols: gc * FINE, rows: gr * FINE, regionSize: Math.max(2, Math.round(scn0.regionSize * dm.region)) * FINE * FINE, seaReach: Math.max(2, Math.round((scn0.seaReach || 4) * dm.grid)) * FINE };
  const size = HEX / FINE / dm.grid;
  const cols = scn.cols, rows = scn.rows, N = cols * rows;
  const [W, H] = mapSize(size, cols, rows);
  const centers = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const [x, y] = cellCenter(size, cols, i);
    centers[i * 2] = x;
    centers[i * 2 + 1] = y;
  }
  const g = {
    scenarioId: scn.id, seed, detail, cols, rows, N, size, unit: HEX / dm.grid, W, H, rng,
    terrain: new Uint8Array(N),
    river: new Uint8Array(N),
    center: (i) => [centers[i * 2], centers[i * 2 + 1]],
  };
  if (scn.procedural) buildProcedural(scn, g);
  else buildHistorical(scn, g);
  buildRegions(scn, g);
  finalizeRegions(scn, g);
  markMountainBorders(g);
  buildSeaZones(scn, g);
  buildGeometry(g);
  g.toPx = g.geo ? g.geo.toPx : null;
  // 세계판 지역사: 처음 화면을 무대 쪽으로
  if (scn.focus && g.geo) {
    const [x0, y0] = g.geo.toPx(scn.focus[0], scn.focus[3]), [x1, y1] = g.geo.toPx(scn.focus[2], scn.focus[1]);
    g.focusBox = [x0, y0, x1 - x0, y1 - y0];
  }
  // 기후 판정용 위도
  for (const r of g.regions) r.lat = g.geo ? g.geo.toLL(r.cx, r.cy)[1] : 62 - (r.cy / H) * 124;
  // 좌표가 들어 있는 육지 지역 (바다·고산이면 -1)
  g.regionAt = (x, y) => {
    const c = pixelToCell(size, cols, rows, x, y);
    return c >= 0 && g.region[c] >= 0 ? g.region[c] : -1;
  };
  // 좌표에서 가장 가까운 육지 칸이 속한 지역 (필터를 통과하는 지역만)
  g.nearestRegion = (x, y, filter) => {
    const c = pixelToCell(size, cols, rows, x, y);
    if (c >= 0 && g.region[c] >= 0 && (!filter || filter(g.region[c]))) return g.region[c];
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const r = g.region[i];
      if (r < 0 || (filter && !filter(r))) continue;
      const [cx, cy] = g.center(i);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  };
  linkStraits(g);

  delete g.rng;
  return g;
}
