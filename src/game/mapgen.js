import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';
import { makeRng, makeNoise } from './rng.js';
import { neighborIndex, cellCenter, corner, mapSize, pixelToCell, hexDistance } from './hex.js';
import { T, TERRAIN } from './rules.js';
import { RANGES, ZONES, RIVERS } from './geodata.js';
import { traceChains, areaPath, chainStroke } from './borders.js';

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

// 실제 해안선(Natural Earth)을 캔버스에 그려 육지 판정
function rasterLand(geo, W, H) {
  const cw = Math.ceil(W), ch = Math.ceil(H);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  for (const poly of landPolygons()) {
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

function buildProcedural(scn, g) {
  const { N, size, W, H, terrain, river, rng, center, cols, rows } = g;
  const nh = makeNoise(rng), nr = makeNoise(rng), nm = makeNoise(rng);
  const height = new Float32Array(N);
  const blobs = Array.from({ length: rng.int(3, 5) }, () => [rng.range(0.15, 0.85), rng.range(0.2, 0.8), rng.range(0.18, 0.32)]);
  for (let i = 0; i < N; i++) {
    const [x, y] = center(i);
    const nx = x / W, ny = y / H;
    let e = nh.fbm(nx * 5, ny * 5 * (H / W) * 1.6, 5);
    let blob = 0;
    for (const [bx, by, br] of blobs) blob = Math.max(blob, 1 - Math.hypot((nx - bx) * 1.2, ny - by) / (br * 1.8));
    e = e * 0.65 + Math.max(0, blob) * 0.55;
    const edge = Math.max(Math.abs(nx - 0.5) * 2, Math.abs(ny - 0.5) * 2);
    e -= Math.pow(edge, 4) * 0.5;
    height[i] = e;
  }
  const sorted = Array.from(height).sort((a, b) => a - b);
  const sea = sorted[Math.floor(N * 0.55)];
  const land = [];
  for (let i = 0; i < N; i++) if (height[i] > sea) land.push(i);
  const lh = land.map((i) => height[i]).sort((a, b) => a - b);
  const hillsT = lh[Math.floor(lh.length * 0.72)];
  for (let i = 0; i < N; i++) {
    if (height[i] <= sea) {
      terrain[i] = T.SEA;
      continue;
    }
    const [x, y] = center(i);
    const ny = y / H;
    const ridge = 1 - Math.abs(nr.fbm((x / W) * 6, ny * 6 * (H / W) * 1.6, 4) * 2 - 1);
    const moist = nm.fbm((x / W) * 4, ny * 4, 3);
    const temp = 1 - Math.abs(ny - 0.5) * 2;
    let t = T.PLAINS;
    if (temp < 0.12) t = T.TUNDRA;
    else if (moist < 0.36 && temp > 0.45) t = T.DESERT;
    else if (moist > 0.6) t = T.FOREST;
    if (height[i] > hillsT && t !== T.DESERT) t = T.HILLS;
    if (ridge > 0.9 && height[i] > sea + 0.03) t = T.MOUNTAIN;
    if (ridge > 0.965 && height[i] > hillsT) t = T.PEAK;
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
  for (const c of rng.shuffle(cells.slice())) {
    if (seeds.length >= K) break;
    if (seeds.every((s) => hexDistance(cols, s, c) >= minD)) seeds.push(c);
  }
  const heap = new Heap();
  seeds.forEach((c, k) => heap.push([0, c, k]));
  while (heap.size) {
    const [cost, c, k] = heap.pop();
    if (region[c] !== -1) continue;
    region[c] = k;
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, c, d);
      if (nb < 0 || !passable(nb) || region[nb] !== -1) continue;
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
    if (!lists[r].length || lists[r].length >= minSize) continue;
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
        const p = pairs.get(key) || { n: 0, riv: 0 };
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
    const type = p.riv / p.n >= 0.4 ? 'river' : 'land';
    regs[a].neighbors.push({ id: b, type });
    regs[b].neighbors.push({ id: a, type });
  }
  // 바닷길: 해안 지역끼리 바다 칸을 통해 연결
  const reach = scn.seaReach || 4;
  for (const r of regs) {
    if (!r.coastal) continue;
    const dist = new Map();
    const queue = [];
    for (const c of r.cells) {
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, c, d);
        if (nb >= 0 && terrain[nb] === T.SEA && !dist.has(nb)) {
          dist.set(nb, 1);
          queue.push(nb);
        }
      }
    }
    const found = new Set();
    for (let q = 0; q < queue.length; q++) {
      const s = queue[q];
      const ds = dist.get(s);
      for (let d = 0; d < 6; d++) {
        const nb = neighborIndex(cols, rows, s, d);
        if (nb < 0) continue;
        if (terrain[nb] === T.SEA) {
          if (!dist.has(nb) && ds < reach) {
            dist.set(nb, ds + 1);
            queue.push(nb);
          }
        } else if (region[nb] >= 0 && region[nb] !== r.id) found.add(region[nb]);
      }
    }
    for (const o of found) {
      if (r.neighbors.some((x) => x.id === o)) continue;
      r.neighbors.push({ id: o, type: 'sea' });
      if (!regs[o].neighbors.some((x) => x.id === r.id)) regs[o].neighbors.push({ id: r.id, type: 'sea' });
    }
  }
  g.regions = regs;
}

const f1 = (v) => Math.round(v * 10) / 10;

// 실제 해안선 SVG 경로 (역사 지도)
function realLandPath(geo, W, H) {
  let d = '';
  for (const poly of landPolygons()) {
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
  for (let i = 0; i < N; i++) {
    ext[i] = terrain[i] === T.PEAK ? -2 : terrain[i] === T.SEA ? -1 : region[i];
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
  const regionPath = regions.map((r) => areaPath(chains, r.id));
  const peaks = areaPath(chains, -2);
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
  const glyph = { forest: '', hills: '', mountain: '', desert: '', tundra: '', peakCap: '' };
  for (let i = 0; i < N; i++) {
    const t = terrain[i];
    if (t === T.SEA || t === T.PLAINS) continue;
    const c = i % cols, r = (i / cols) | 0;
    const dense = t === T.PEAK || t === T.MOUNTAIN;
    if (dense ? r % 2 || (c + (r >> 1)) % 2 : r % 3 || (c + (r / 3) | 0) % 3) continue;
    const [x, y] = center(i);
    if (t === T.PEAK) glyph.peakCap += `M${f1(x - 0.55 * s)} ${f1(y + 0.4 * s)}L${f1(x)} ${f1(y - 0.5 * s)}L${f1(x + 0.55 * s)} ${f1(y + 0.4 * s)}Z`;
    else if (t === T.MOUNTAIN) glyph.mountain += `M${f1(x - 0.45 * s)} ${f1(y + 0.3 * s)}L${f1(x)} ${f1(y - 0.4 * s)}L${f1(x + 0.45 * s)} ${f1(y + 0.3 * s)}Z`;
    else if (t === T.FOREST) glyph.forest += `M${f1(x - 0.25 * s)} ${f1(y)}a${f1(0.25 * s)} ${f1(0.25 * s)} 0 1 0 ${f1(0.5 * s)} 0a${f1(0.25 * s)} ${f1(0.25 * s)} 0 1 0 ${f1(-0.5 * s)} 0`;
    else if (t === T.HILLS) glyph.hills += `M${f1(x - 0.4 * s)} ${f1(y + 0.2 * s)}Q${f1(x)} ${f1(y - 0.4 * s)} ${f1(x + 0.4 * s)} ${f1(y + 0.2 * s)}`;
    else if (t === T.DESERT) glyph.desert += `M${f1(x - 0.3 * s)} ${f1(y)}h0.1M${f1(x + 0.25 * s)} ${f1(y + 0.25 * s)}h0.1M${f1(x + 0.05 * s)} ${f1(y - 0.3 * s)}h0.1`;
    else if (t === T.TUNDRA) glyph.tundra += `M${f1(x - 0.4 * s)} ${f1(y)}h${f1(0.8 * s)}M${f1(x - 0.2 * s)} ${f1(y + 0.25 * s)}h${f1(0.4 * s)}`;
  }
  g.paths = { regionPath, outline: regionPath, pairSegs, borders, peaks, land, glyph };
}

export function generateWorld(scn0, seed) {
  const rng = makeRng(`${scn0.id}:${seed}`);
  const scn = { ...scn0, cols: scn0.cols * FINE, rows: scn0.rows * FINE, regionSize: scn0.regionSize * FINE * FINE, seaReach: (scn0.seaReach || 4) * FINE };
  const size = HEX / FINE;
  const cols = scn.cols, rows = scn.rows, N = cols * rows;
  const [W, H] = mapSize(size, cols, rows);
  const centers = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const [x, y] = cellCenter(size, cols, i);
    centers[i * 2] = x;
    centers[i * 2 + 1] = y;
  }
  const g = {
    scenarioId: scn.id, seed, cols, rows, N, size, unit: HEX, W, H, rng,
    terrain: new Uint8Array(N),
    river: new Uint8Array(N),
    center: (i) => [centers[i * 2], centers[i * 2 + 1]],
  };
  if (scn.procedural) buildProcedural(scn, g);
  else buildHistorical(scn, g);
  buildRegions(scn, g);
  finalizeRegions(scn, g);
  buildGeometry(g);
  g.toPx = g.geo ? g.geo.toPx : null;
  g.nearestRegion = (x, y, filter) => {
    let best = -1, bd = Infinity;
    const c = pixelToCell(size, cols, rows, x, y);
    if (c >= 0 && g.region[c] >= 0 && (!filter || filter(g.region[c]))) return g.region[c];
    for (const r of g.regions) {
      if (filter && !filter(r.id)) continue;
      const d = Math.hypot(r.cx - x, r.cy - y);
      if (d < bd) { bd = d; best = r.id; }
    }
    return best;
  };
  delete g.rng;
  return g;
}
