// ───────── 도시·관문 그림: 성벽(톱니)·모서리 망루·성문 누각·안쪽 전각·나라 깃발 ─────────
// 한 장(가로 W)에 그려 두고 지도에서는 줄여서 씀. 나라 색이 바뀌면 그 색으로 새로 그림
const cache = new Map();

// 기와지붕: 처마 끝이 살짝 들린 지붕 (가운데 x, 처마 높이 y, 너비 w, 높이 h)
function roof(ctx, x, y, w, h, col, edge = '#1e1a16') {
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.08, y - h * 0.15);
  ctx.quadraticCurveTo(x - w * 0.42, y, x - w * 0.3, y - h * 0.05);
  ctx.lineTo(x - w * 0.22, y - h);
  ctx.lineTo(x + w * 0.22, y - h);
  ctx.lineTo(x + w * 0.3, y - h * 0.05);
  ctx.quadraticCurveTo(x + w * 0.42, y, x + w / 2 + w * 0.08, y - h * 0.15);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.strokeStyle = edge;
  ctx.stroke();
  // 기와 줄
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x + k * w * 0.09, y - h * 0.95); ctx.lineTo(x + k * w * 0.13, y - h * 0.1); ctx.stroke(); }
}

// 누각: 벽 + 지붕 (층수만큼)
function hall(ctx, x, y, w, h, roofCol, floors = 1) {
  let cy = y;
  for (let f = 0; f < floors; f++) {
    const ww = w * (1 - f * 0.22), wh = h * 0.55;
    ctx.fillStyle = '#d9cbb0';
    ctx.fillRect(x - ww * 0.36, cy - wh, ww * 0.72, wh);
    ctx.fillStyle = '#8b2b20';
    for (let k = -1; k <= 1; k++) ctx.fillRect(x + k * ww * 0.22 - ww * 0.03, cy - wh, ww * 0.06, wh);
    ctx.strokeStyle = '#3b2a1c'; ctx.lineWidth = Math.max(1, w * 0.02); ctx.strokeRect(x - ww * 0.36, cy - wh, ww * 0.72, wh);
    roof(ctx, x, cy - wh, ww, h * 0.45, roofCol);
    cy -= wh + h * 0.4;
  }
}

function flag(ctx, x, y, h, col) {
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x - h * 0.02, y - h, h * 0.04, h);
  ctx.beginPath();
  ctx.moveTo(x + h * 0.02, y - h);
  ctx.lineTo(x + h * 0.42, y - h * 0.9);
  ctx.lineTo(x + h * 0.36, y - h * 0.72);
  ctx.lineTo(x + h * 0.42, y - h * 0.55);
  ctx.lineTo(x + h * 0.02, y - h * 0.6);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, h * 0.025);
  ctx.stroke();
}

// 도시 (W×W 캔버스, 바닥 중심이 아래쪽 72% 지점)
function drawCity(ctx, W, col, capital) {
  const cx = W / 2, base = W * 0.8;
  const ww = W * (capital ? 0.86 : 0.74), depth = W * (capital ? 0.34 : 0.3), wallH = W * 0.12;
  const L = cx - ww / 2, R = cx + ww / 2, back = base - depth;
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, base + W * 0.03, ww * 0.56, W * 0.07, 0, 0, 7); ctx.fill();
  // 안뜰
  ctx.fillStyle = '#b8a27c';
  ctx.beginPath(); ctx.moveTo(L + ww * 0.06, back); ctx.lineTo(R - ww * 0.06, back); ctx.lineTo(R, base); ctx.lineTo(L, base); ctx.closePath(); ctx.fill();
  // 뒷벽
  ctx.fillStyle = '#9d8f78'; ctx.fillRect(L + ww * 0.06, back - wallH * 0.75, ww * 0.88, wallH * 0.75);
  ctx.fillStyle = '#7e7262'; for (let k = 0; k < 9; k++) ctx.fillRect(L + ww * 0.06 + k * (ww * 0.88 / 9), back - wallH * 0.95, ww * 0.05, wallH * 0.22);
  // 안쪽 집들과 본전
  const rc = capital ? '#c9a227' : '#4c5866';
  for (const [dx, dy, s] of [[-0.28, 0.25, 0.16], [0.28, 0.25, 0.16], [-0.18, 0.55, 0.13], [0.2, 0.55, 0.13]]) hall(ctx, cx + dx * ww, back + depth * dy + W * 0.06, W * s, W * s * 0.9, '#5b636b');
  hall(ctx, cx, back + depth * 0.45, W * (capital ? 0.3 : 0.24), W * (capital ? 0.24 : 0.2), rc, capital ? 2 : 1);
  // 옆벽
  ctx.fillStyle = '#a99a80';
  ctx.beginPath(); ctx.moveTo(L, base); ctx.lineTo(L + ww * 0.06, back); ctx.lineTo(L + ww * 0.06, back - wallH * 0.75); ctx.lineTo(L, base - wallH); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(R, base); ctx.lineTo(R - ww * 0.06, back); ctx.lineTo(R - ww * 0.06, back - wallH * 0.75); ctx.lineTo(R, base - wallH); ctx.closePath(); ctx.fill();
  // 앞벽 (돌 무늬 + 톱니)
  const fg = ctx.createLinearGradient(0, base - wallH, 0, base);
  fg.addColorStop(0, '#d8ccb4'); fg.addColorStop(1, '#a59479');
  ctx.fillStyle = fg; ctx.fillRect(L, base - wallH, ww, wallH);
  ctx.strokeStyle = 'rgba(70,55,40,0.35)'; ctx.lineWidth = Math.max(1, W * 0.006);
  for (let r = 1; r < 3; r++) { ctx.beginPath(); ctx.moveTo(L, base - wallH + (wallH / 3) * r); ctx.lineTo(R, base - wallH + (wallH / 3) * r); ctx.stroke(); }
  for (let k = 0; k < 14; k++) { const x = L + (ww / 14) * k + (k % 2 ? ww / 28 : 0); ctx.beginPath(); ctx.moveTo(x, base - wallH); ctx.lineTo(x, base); ctx.stroke(); }
  ctx.fillStyle = '#b8aa90'; for (let k = 0; k < 13; k++) ctx.fillRect(L + k * (ww / 13), base - wallH - W * 0.035, ww / 26, W * 0.035);
  ctx.strokeStyle = '#4a3b2a'; ctx.lineWidth = Math.max(1, W * 0.012); ctx.strokeRect(L, base - wallH, ww, wallH);
  // 모서리 망루
  for (const x of [L, R]) {
    ctx.fillStyle = '#cfc2a8'; ctx.fillRect(x - W * 0.05, base - wallH * 1.5, W * 0.1, wallH * 1.5);
    ctx.strokeStyle = '#4a3b2a'; ctx.strokeRect(x - W * 0.05, base - wallH * 1.5, W * 0.1, wallH * 1.5);
    roof(ctx, x, base - wallH * 1.5, W * 0.15, W * 0.07, '#4c5866');
  }
  // 성문 + 문루
  ctx.fillStyle = '#2a1d12';
  ctx.beginPath(); ctx.moveTo(cx - W * 0.06, base); ctx.lineTo(cx - W * 0.06, base - wallH * 0.55); ctx.arc(cx, base - wallH * 0.55, W * 0.06, Math.PI, 0); ctx.lineTo(cx + W * 0.06, base); ctx.closePath(); ctx.fill();
  hall(ctx, cx, base - wallH, W * 0.24, W * 0.17, capital ? '#c9a227' : '#4c5866', capital ? 2 : 1);
  // 나라 깃발 (문루 양옆 + 망루)
  flag(ctx, cx - W * 0.14, base - wallH, W * 0.2, col);
  flag(ctx, cx + W * 0.1, base - wallH, W * 0.2, col);
  flag(ctx, L, base - wallH * 1.5 - W * 0.06, W * 0.15, col);
  flag(ctx, R, base - wallH * 1.5 - W * 0.06, W * 0.15, col);
}

// 관문: 산 사이 길목을 가로막는 성벽 + 두 층 문루
function drawPass(ctx, W, col) {
  const cx = W / 2, base = W * 0.78, wallH = W * 0.16;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, base + W * 0.03, W * 0.46, W * 0.06, 0, 0, 7); ctx.fill();
  const L = W * 0.08, R = W * 0.92;
  const fg = ctx.createLinearGradient(0, base - wallH, 0, base);
  fg.addColorStop(0, '#cdbfa3'); fg.addColorStop(1, '#93836a');
  ctx.fillStyle = fg; ctx.fillRect(L, base - wallH, R - L, wallH);
  ctx.fillStyle = '#a99a80'; for (let k = 0; k < 12; k++) ctx.fillRect(L + k * ((R - L) / 12), base - wallH - W * 0.04, (R - L) / 24, W * 0.04);
  ctx.strokeStyle = '#4a3b2a'; ctx.lineWidth = Math.max(1, W * 0.012); ctx.strokeRect(L, base - wallH, R - L, wallH);
  ctx.fillStyle = '#2a1d12';
  ctx.beginPath(); ctx.moveTo(cx - W * 0.08, base); ctx.lineTo(cx - W * 0.08, base - wallH * 0.5); ctx.arc(cx, base - wallH * 0.5, W * 0.08, Math.PI, 0); ctx.lineTo(cx + W * 0.08, base); ctx.closePath(); ctx.fill();
  hall(ctx, cx, base - wallH, W * 0.36, W * 0.2, '#4c5866', 2);
  flag(ctx, L + W * 0.04, base - wallH, W * 0.22, col);
  flag(ctx, R - W * 0.04, base - wallH, W * 0.22, col);
}

export function citySprite(kind, capital, col, px = 160) {
  const key = `${kind}|${capital ? 1 : 0}|${col}|${px}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d');
    ctx.lineJoin = 'round';
    if (kind === 'pass') drawPass(ctx, px, col);
    else drawCity(ctx, px, col, capital);
    cache.set(key, cv);
  }
  return cv;
}
