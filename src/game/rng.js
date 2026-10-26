// 시드 기반 난수 유틸
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function step(t) {
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function withHelpers(r) {
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.range = (a, b) => a + r() * (b - a);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  r.weighted = (items, weightFn) => {
    let total = 0;
    const ws = items.map((it) => {
      const w = Math.max(0, weightFn(it));
      total += w;
      return w;
    });
    if (total <= 0) return null;
    let x = r() * total;
    for (let i = 0; i < items.length; i++) {
      x -= ws[i];
      if (x <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  return r;
}

export function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashString(String(seed))) | 0;
  return withHelpers(() => {
    a = (a + 0x6d2b79f5) | 0;
    return step(a);
  });
}

// 게임 상태(s.rs)에 시드를 저장하는 RNG — 저장/불러오기 시 재현 가능
export function stateRng(s) {
  return withHelpers(() => {
    s.rs = (s.rs + 0x6d2b79f5) | 0;
    return step(s.rs);
  });
}

export function makeNoise(rng) {
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  const p = [];
  for (let i = 0; i < 256; i++) {
    vals[i] = rng();
    p.push(i);
  }
  rng.shuffle(p);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const h = (i, j) => vals[perm[(perm[i & 255] + j) & 255]];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  noise.fbm = (x, y, oct = 4) => {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x * f + o * 17.3, y * f + o * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
  return noise;
}
