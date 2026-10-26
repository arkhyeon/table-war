// 육각 격자 라벨 → 자유곡선 경계선
// 경계 모서리를 "체인"(분기점~분기점)으로 묶고, 각 체인을 부드러운 곡선으로 만든 뒤
// 같은 체인을 양쪽 지역이 공유하므로 이웃 지역 경계가 정확히 맞물린다.
import { neighborIndex, corner } from './hex.js';

const f1 = (v) => Math.round(v * 10) / 10;

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function traceChains(g, labels, jitter = 0.38) {
  const { N, cols, rows, size, center, W, H } = g;
  const vx = new Map(); // key → [x, y]
  const keyOf = (x, y) => Math.round(x * 4) * 100000 + Math.round(y * 4);
  const edges = []; // [u, v, la, lb]
  const adj = new Map(); // key → edge indices
  const vertex = (x, y) => {
    const k = keyOf(x, y);
    if (!vx.has(k)) {
      const border = x < 1 || y < 1 || x > W - 1 || y > H - 1;
      const j = border ? 0 : size * jitter;
      vx.set(k, [x + (hash(k) - 0.5) * 2 * j, y + (hash(k ^ 0x9e3779b9) - 0.5) * 2 * j]);
    }
    return k;
  };
  const addAdj = (k, e) => {
    const a = adj.get(k);
    if (a) a.push(e);
    else adj.set(k, [e]);
  };
  for (let i = 0; i < N; i++) {
    const la = labels[i];
    for (let d = 0; d < 6; d++) {
      const nb = neighborIndex(cols, rows, i, d);
      if (nb >= 0 && nb < i) continue;
      const lb = nb < 0 ? -1 : labels[nb];
      if (la === lb) continue;
      const [x, y] = center(i);
      const [ax, ay] = corner(x, y, size, d);
      const [bx, by] = corner(x, y, size, (d + 1) % 6);
      const u = vertex(ax, ay), v = vertex(bx, by);
      const e = edges.length;
      edges.push([u, v, Math.min(la, lb), Math.max(la, lb)]);
      addAdj(u, e);
      addAdj(v, e);
    }
  }
  const used = new Uint8Array(edges.length);
  const isJunction = (k) => {
    const a = adj.get(k);
    if (a.length !== 2) return true;
    const [e1, e2] = a;
    return edges[e1][2] !== edges[e2][2] || edges[e1][3] !== edges[e2][3];
  };
  const chains = [];
  const walk = (startKey, e0) => {
    const keys = [startKey];
    let cur = startKey, e = e0;
    for (;;) {
      used[e] = 1;
      const [u, v] = edges[e];
      const nxt = u === cur ? v : u;
      keys.push(nxt);
      cur = nxt;
      if (cur === startKey || isJunction(cur)) break;
      const cand = adj.get(cur).find((x) => !used[x]);
      if (cand === undefined) break;
      e = cand;
    }
    return keys;
  };
  for (const [k, list] of adj) {
    if (!isJunction(k)) continue;
    for (const e of list) {
      if (used[e]) continue;
      const keys = walk(k, e);
      chains.push({ a: edges[e][2], b: edges[e][3], keys, closed: false });
    }
  }
  for (let e = 0; e < edges.length; e++) {
    if (used[e]) continue;
    const keys = walk(edges[e][0], e);
    chains.push({ a: edges[e][2], b: edges[e][3], keys, closed: true });
  }
  for (const c of chains) {
    const pts = c.keys.map((k) => vx.get(k));
    c.start = c.keys[0];
    c.end = c.keys[c.keys.length - 1];
    c.fwd = curve(pts, c.closed);
    c.rev = c.closed ? c.fwd : curve(pts.slice().reverse(), false);
    delete c.keys;
  }
  return chains;
}

// 2칸마다 한 점을 남겨 계단을 없애고, 중점-2차곡선으로 매끄럽게
function curve(pts, closed) {
  let p = pts;
  if (closed) {
    p = p.slice(0, -1).filter((_, i) => i % 2 === 0);
    if (p.length < 3) p = pts.slice(0, -1);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const n = p.length;
    let d = `M${f1(mid(p[n - 1], p[0])[0])} ${f1(mid(p[n - 1], p[0])[1])}`;
    for (let i = 0; i < n; i++) {
      const m = mid(p[i], p[(i + 1) % n]);
      d += `Q${f1(p[i][0])} ${f1(p[i][1])} ${f1(m[0])} ${f1(m[1])}`;
    }
    return { d: d + 'Z', head: null };
  }
  if (p.length > 4) p = p.filter((_, i) => i === 0 || i === p.length - 1 || i % 2 === 0);
  let d = '';
  if (p.length <= 2) d = `L${f1(p[p.length - 1][0])} ${f1(p[p.length - 1][1])}`;
  else {
    for (let i = 1; i < p.length - 1; i++) {
      const m = i === p.length - 2 ? p[i + 1] : [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
      d += `Q${f1(p[i][0])} ${f1(p[i][1])} ${f1(m[0])} ${f1(m[1])}`;
    }
  }
  return { d, head: `M${f1(p[0][0])} ${f1(p[0][1])}` };
}

export const chainStroke = (c) => (c.closed ? c.fwd.d : c.fwd.head + c.fwd.d);

// 특정 라벨의 영역을 감싸는 닫힌 경로 (evenodd)
export function areaPath(chains, label) {
  const mine = chains.filter((c) => c.a === label || c.b === label);
  let d = '';
  const open = [];
  for (const c of mine) {
    if (c.closed) d += c.fwd.d;
    else open.push(c);
  }
  const byKey = new Map();
  const put = (k, c) => {
    const a = byKey.get(k);
    if (a) a.push(c);
    else byKey.set(k, [c]);
  };
  for (const c of open) {
    put(c.start, c);
    put(c.end, c);
  }
  const done = new Set();
  for (const c0 of open) {
    if (done.has(c0)) continue;
    done.add(c0);
    d += c0.fwd.head + c0.fwd.d;
    const first = c0.start;
    let at = c0.end;
    for (let guard = 0; guard < 10000 && at !== first; guard++) {
      const nx = (byKey.get(at) || []).find((c) => !done.has(c));
      if (!nx) break;
      done.add(nx);
      if (nx.start === at) {
        d += nx.fwd.d;
        at = nx.end;
      } else {
        d += nx.rev.d;
        at = nx.start;
      }
    }
    d += 'Z';
  }
  return d;
}
