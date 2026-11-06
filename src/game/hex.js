// 뾰족한 위쪽(pointy-top) 육각 격자, odd-r 오프셋 좌표
export const SQRT3 = Math.sqrt(3);
// 방향 순서: E, SE, SW, W, NW, NE (모서리 d는 꼭짓점 d와 d+1 사이)
const DIRS_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const DIRS_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

export function neighborIndex(cols, rows, idx, d) {
  const c = idx % cols, r = (idx / cols) | 0;
  const dd = (r & 1 ? DIRS_ODD : DIRS_EVEN)[d];
  const nc = c + dd[0], nr = r + dd[1];
  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return -1;
  return nr * cols + nc;
}

export function cellCenter(size, cols, idx) {
  const c = idx % cols, r = (idx / cols) | 0;
  return [size * SQRT3 * (c + 0.5 * (r & 1)) + (size * SQRT3) / 2, size * 1.5 * r + size];
}

export function corner(cx, cy, size, i) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [cx + size * Math.cos(a), cy + size * Math.sin(a)];
}

export function mapSize(size, cols, rows) {
  return [size * SQRT3 * (cols + 0.5), size * 1.5 * (rows - 1) + size * 2];
}

export function pixelToCell(size, cols, rows, x, y) {
  let r0 = Math.round((y - size) / (1.5 * size));
  let best = -1, bd = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= rows) continue;
    const c0 = Math.round((x - (size * SQRT3) / 2) / (size * SQRT3) - 0.5 * (r & 1));
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= cols) continue;
      const [cx, cy] = cellCenter(size, cols, r * cols + c);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = r * cols + c; }
    }
  }
  return best;
}

export function hexDistance(cols, a, b) {
  const ac = a % cols, ar = (a / cols) | 0, bc = b % cols, br = (b / cols) | 0;
  const ax = ac - (ar - (ar & 1)) / 2, bx = bc - (br - (br & 1)) / 2;
  const dx = ax - bx, dz = ar - br, dy = -dx - dz;
  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

// 동서로 이어진(둥근) 세계 지도: 열을 감아서 이웃·거리 계산
export function neighborIndexWrap(cols, rows, idx, d) {
  const c = idx % cols, r = (idx / cols) | 0;
  const dd = (r & 1 ? DIRS_ODD : DIRS_EVEN)[d];
  const nc = (c + dd[0] + cols) % cols, nr = r + dd[1];
  if (nr < 0 || nr >= rows) return -1;
  return nr * cols + nc;
}
export function hexDistanceWrap(cols, a, b) {
  const ac = a % cols, ar = (a / cols) | 0, bc = b % cols, br = (b / cols) | 0;
  const ax = ac - (ar - (ar & 1)) / 2, bx0 = bc - (br - (br & 1)) / 2, dz = ar - br;
  // 왼쪽·제자리·오른쪽으로 한 바퀴 옮긴 셋 중 가까운 것 (자주 불려서 배열을 만들지 않고 바로 셈)
  const adz = dz < 0 ? -dz : dz;
  let dx = ax - bx0 + cols, dy = -dx - dz, best = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy, adz);
  dx -= cols; dy = -dx - dz; let d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy, adz); if (d < best) best = d;
  dx -= cols; dy = -dx - dz; d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy, adz); if (d < best) best = d;
  return best;
}
