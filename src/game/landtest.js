// 경위도 한 점이 뭍인지 (실제 해안선 Natural Earth 1:50m) — 지역사 무대 크기·칸 크기를 정할 때 씀
import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';

let polys = null;
function load() {
  if (polys) return polys;
  const fc = feature(land50, land50.objects.land);
  const feats = fc.type === 'FeatureCollection' ? fc.features : [fc];
  polys = [];
  for (const f of feats) {
    const g = f.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of list) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      polys.push({ p, b: [x0, y0, x1, y1] });
    }
  }
  return polys;
}
function inRing(ring, x, y) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export function isLand(lon, lat) {
  for (const { p, b } of load()) {
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inRing(p[0], lon, lat) && !p.slice(1).some((h) => inRing(h, lon, lat))) return true;
  }
  return false;
}
