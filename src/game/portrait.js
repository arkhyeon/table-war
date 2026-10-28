// ───────── 장수 초상: 이름으로 늘 같은 얼굴(얼굴색·눈썹·수염·투구/관모)을 그림 ─────────
// 무관은 투구, 문관은 관모, 유명 인물은 전해지는 모습대로
const hashStr = (s, k = 0) => { let h = 2166136261 ^ k; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

// 전해지는 모습: skin 얼굴색, beard 수염(none/stub/goatee/full/long/wild), beardCol, hat(helmet/scholar/hood/crown/band/pheasant), hatCol, age(young/old)
const FAMOUS = {
  관우: { skin: '#b5412f', beard: 'long', beardCol: '#141414', hat: 'band', hatCol: '#2e7d4f' },
  장비: { beard: 'wild', beardCol: '#111', hat: 'helmet', hatCol: '#3a3a3a', brow: 'wild', skin: '#c99a72' },
  유비: { beard: 'goatee', hat: 'crown', hatCol: '#d9b44a' },
  조조: { beard: 'stub', hat: 'crown', hatCol: '#222' },
  손권: { beard: 'full', beardCol: '#7a3b8f', hat: 'crown', hatCol: '#c0392b' },
  손책: { beard: 'none', hat: 'helmet', hatCol: '#c0392b', age: 'young' },
  원소: { beard: 'goatee', hat: 'crown', hatCol: '#d4af37' },
  제갈량: { beard: 'goatee', hat: 'hood', hatCol: '#2b2b2b' },
  방통: { beard: 'stub', hat: 'hood', hatCol: '#4a3b2a', skin: '#b98d64' },
  사마의: { beard: 'goatee', hat: 'scholar', hatCol: '#222' },
  조운: { beard: 'none', hat: 'helmet', hatCol: '#e8e8e8', age: 'young' },
  마초: { beard: 'none', hat: 'helmet', hatCol: '#d8d8e0', age: 'young' },
  황충: { beard: 'long', beardCol: '#eeeeee', hat: 'helmet', hatCol: '#8a6d1e', age: 'old' },
  여포: { beard: 'none', hat: 'pheasant', hatCol: '#a32020', age: 'young' },
  허저: { beard: 'stub', hat: 'band', hatCol: '#5a3a1a', skin: '#c08b5c' },
  전위: { beard: 'wild', beardCol: '#222', hat: 'band', hatCol: '#333', skin: '#a8754e' },
  하후돈: { beard: 'full', hat: 'helmet', hatCol: '#3d4f8a', patch: true },
  주유: { beard: 'none', hat: 'scholar', hatCol: '#c0392b', age: 'young' },
  육손: { beard: 'none', hat: 'scholar', hatCol: '#2e6b4f', age: 'young' },
  감녕: { beard: 'stub', hat: 'band', hatCol: '#b8860b' },
  태사자: { beard: 'goatee', hat: 'helmet', hatCol: '#6b8e23' },
  여몽: { beard: 'full', hat: 'helmet', hatCol: '#8b0000' },
  장료: { beard: 'goatee', hat: 'helmet', hatCol: '#6a5acd' },
  서황: { beard: 'full', hat: 'helmet', hatCol: '#556b2f' },
  위연: { beard: 'wild', beardCol: '#222', hat: 'helmet', hatCol: '#7b3f00', skin: '#b7865a' },
  곽가: { beard: 'none', hat: 'scholar', hatCol: '#333', age: 'young' },
  순욱: { beard: 'long', beardCol: '#222', hat: 'scholar', hatCol: '#222' },
  가후: { beard: 'goatee', beardCol: '#999', hat: 'scholar', hatCol: '#333', age: 'old' },
  노숙: { beard: 'full', hat: 'scholar', hatCol: '#2b4c7e' },
  맹획: { beard: 'wild', hat: 'band', hatCol: '#8b4513', skin: '#8d5a3b' },
  축융: { beard: 'none', hat: 'band', hatCol: '#c71585', female: true },
  안량: { beard: 'full', hat: 'helmet', hatCol: '#556' },
  문추: { beard: 'wild', hat: 'helmet', hatCol: '#665' },
  장합: { beard: 'goatee', hat: 'helmet', hatCol: '#4a6b8a' },
};
const SKINS = ['#f1c9a0', '#e8bb8e', '#dcae82', '#d3a274', '#c99a6c'];
const HELMS = ['#7a1f1f', '#3d4f8a', '#556b2f', '#5a5a5a', '#8a6d1e', '#4a2a5a', '#2f4f4f'];

export function lookOf(g) {
  const h = (k) => hashStr(g.name, k);
  const military = g.war >= g.intel || g.war >= 70;
  const base = {
    skin: SKINS[Math.floor(h(1) * SKINS.length)],
    beard: ['none', 'stub', 'goatee', 'full', 'long'][Math.floor(h(2) * 5)],
    beardCol: h(3) < 0.85 ? '#1d1712' : '#6b6b6b',
    hat: military ? (h(4) < 0.75 ? 'helmet' : 'band') : h(4) < 0.6 ? 'scholar' : 'hood',
    hatCol: military ? HELMS[Math.floor(h(5) * HELMS.length)] : ['#222', '#2b4c7e', '#4a3b2a', '#5a1e1e'][Math.floor(h(5) * 4)],
    brow: g.war >= 85 ? 'wild' : 'thin',
    eyes: h(6) < 0.5 ? 'sharp' : 'calm',
  };
  return { ...base, ...(FAMOUS[g.name] || {}) };
}

// 초상 한 장 그리기 (가운데 x,y, 반지름 r)
export function drawPortrait(ctx, x, y, r, g, ring = '#fff') {
  const L = lookOf(g);
  ctx.save();
  // 바탕
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#2b2620'; ctx.fill();
  ctx.clip();
  const bg = ctx.createLinearGradient(x, y - r, x, y + r); bg.addColorStop(0, '#5d5346'); bg.addColorStop(1, '#2a241d');
  ctx.fillStyle = bg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // 어깨·갑옷/도포
  ctx.beginPath(); ctx.ellipse(x, y + r * 1.05, r * 0.95, r * 0.55, 0, Math.PI, 0); ctx.fillStyle = L.hat === 'helmet' || L.hat === 'pheasant' ? '#6b6b6b' : L.hatCol; ctx.fill();
  if (L.hat === 'helmet' || L.hat === 'pheasant') { ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = r * 0.06; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x + k * r * 0.18, y + r * 0.62); ctx.lineTo(x + k * r * 0.2, y + r); ctx.stroke(); } }
  // 목·얼굴
  ctx.fillStyle = L.skin;
  ctx.fillRect(x - r * 0.16, y + r * 0.25, r * 0.32, r * 0.35);
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.02, r * 0.42, r * 0.52, 0, 0, 7); ctx.fill();
  // 귀
  ctx.beginPath(); ctx.ellipse(x - r * 0.42, y + r * 0.05, r * 0.08, r * 0.13, 0, 0, 7); ctx.ellipse(x + r * 0.42, y + r * 0.05, r * 0.08, r * 0.13, 0, 0, 7); ctx.fill();
  // 눈썹·눈
  ctx.strokeStyle = '#1a1410'; ctx.lineWidth = r * (L.brow === 'wild' ? 0.1 : 0.06); ctx.lineCap = 'round';
  const by = y - r * 0.12;
  ctx.beginPath();
  if (L.brow === 'wild') { ctx.moveTo(x - r * 0.32, by - r * 0.02); ctx.lineTo(x - r * 0.08, by + r * 0.06); ctx.moveTo(x + r * 0.32, by - r * 0.02); ctx.lineTo(x + r * 0.08, by + r * 0.06); }
  else { ctx.moveTo(x - r * 0.3, by + r * 0.02); ctx.quadraticCurveTo(x - r * 0.2, by - r * 0.04, x - r * 0.08, by + r * 0.02); ctx.moveTo(x + r * 0.3, by + r * 0.02); ctx.quadraticCurveTo(x + r * 0.2, by - r * 0.04, x + r * 0.08, by + r * 0.02); }
  ctx.stroke();
  ctx.fillStyle = '#120e0a';
  const ey = y + r * 0.0;
  if (L.eyes === 'sharp') { ctx.fillRect(x - r * 0.27, ey - r * 0.02, r * 0.16, r * 0.05); ctx.fillRect(x + r * 0.11, ey - r * 0.02, r * 0.16, r * 0.05); }
  else { ctx.beginPath(); ctx.arc(x - r * 0.19, ey, r * 0.045, 0, 7); ctx.arc(x + r * 0.19, ey, r * 0.045, 0, 7); ctx.fill(); }
  if (L.patch) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(x - r * 0.19, ey, r * 0.11, r * 0.09, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = r * 0.03; ctx.beginPath(); ctx.moveTo(x - r * 0.42, ey - r * 0.12); ctx.lineTo(x + r * 0.1, ey + r * 0.1); ctx.stroke(); }
  // 코·입
  ctx.strokeStyle = 'rgba(60,30,20,0.6)'; ctx.lineWidth = r * 0.04;
  ctx.beginPath(); ctx.moveTo(x, y + r * 0.02); ctx.lineTo(x - r * 0.04, y + r * 0.16); ctx.lineTo(x + r * 0.03, y + r * 0.17); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r * 0.1, y + r * 0.3); ctx.lineTo(x + r * 0.1, y + r * 0.3); ctx.stroke();
  // 수염
  ctx.fillStyle = L.beardCol || '#1d1712';
  const beard = L.age === 'young' ? 'none' : L.beard;
  if (beard === 'stub') { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.ellipse(x, y + r * 0.32, r * 0.32, r * 0.18, 0, 0, Math.PI); ctx.fill(); ctx.globalAlpha = 1; ctx.fillRect(x - r * 0.15, y + r * 0.23, r * 0.3, r * 0.04); }
  if (beard === 'goatee') { ctx.fillRect(x - r * 0.16, y + r * 0.23, r * 0.32, r * 0.04); ctx.beginPath(); ctx.moveTo(x - r * 0.07, y + r * 0.36); ctx.lineTo(x, y + r * 0.62); ctx.lineTo(x + r * 0.07, y + r * 0.36); ctx.fill(); }
  if (beard === 'full') { ctx.beginPath(); ctx.moveTo(x - r * 0.42, y + r * 0.05); ctx.quadraticCurveTo(x - r * 0.38, y + r * 0.62, x, y + r * 0.66); ctx.quadraticCurveTo(x + r * 0.38, y + r * 0.62, x + r * 0.42, y + r * 0.05); ctx.lineTo(x + r * 0.3, y + r * 0.22); ctx.lineTo(x - r * 0.3, y + r * 0.22); ctx.closePath(); ctx.fill(); ctx.fillStyle = L.skin; ctx.fillRect(x - r * 0.09, y + r * 0.27, r * 0.18, r * 0.05); }
  if (beard === 'long') { ctx.beginPath(); ctx.moveTo(x - r * 0.3, y + r * 0.25); ctx.quadraticCurveTo(x - r * 0.2, y + r * 1.0, x, y + r * 1.1); ctx.quadraticCurveTo(x + r * 0.2, y + r * 1.0, x + r * 0.3, y + r * 0.25); ctx.closePath(); ctx.fill(); ctx.fillRect(x - r * 0.2, y + r * 0.22, r * 0.4, r * 0.05); }
  if (beard === 'wild') { ctx.beginPath(); ctx.moveTo(x - r * 0.46, y); for (let k = 0; k <= 8; k++) { const a = Math.PI * (k / 8); ctx.lineTo(x - Math.cos(a) * r * 0.5, y + r * 0.2 + Math.sin(a) * r * (k % 2 ? 0.48 : 0.62)); } ctx.lineTo(x + r * 0.46, y); ctx.lineTo(x + r * 0.3, y + r * 0.22); ctx.lineTo(x - r * 0.3, y + r * 0.22); ctx.closePath(); ctx.fill(); }
  // 모자·투구
  const hc = L.hatCol;
  if (L.hat === 'helmet' || L.hat === 'pheasant') {
    ctx.fillStyle = hc; ctx.beginPath(); ctx.ellipse(x, y - r * 0.3, r * 0.5, r * 0.36, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - r * 0.52, y - r * 0.32, r * 1.04, r * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(x - r * 0.15, y - r * 0.48, r * 0.15, r * 0.08, -0.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#c9a43a'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.68); ctx.lineTo(x - r * 0.06, y - r * 0.32); ctx.lineTo(x + r * 0.06, y - r * 0.32); ctx.fill();
    if (L.hat === 'pheasant') { ctx.strokeStyle = '#d9a441'; ctx.lineWidth = r * 0.07; ctx.beginPath(); ctx.moveTo(x - r * 0.1, y - r * 0.6); ctx.quadraticCurveTo(x - r * 0.7, y - r * 1.1, x - r * 1.0, y - r * 0.5); ctx.moveTo(x + r * 0.1, y - r * 0.6); ctx.quadraticCurveTo(x + r * 0.7, y - r * 1.1, x + r * 1.0, y - r * 0.5); ctx.stroke(); }
    else { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.66); ctx.quadraticCurveTo(x + r * 0.35, y - r * 0.95, x + r * 0.25, y - r * 0.6); ctx.fill(); }
  } else if (L.hat === 'scholar') {
    ctx.fillStyle = hc; ctx.fillRect(x - r * 0.32, y - r * 0.72, r * 0.64, r * 0.38); ctx.fillRect(x - r * 0.44, y - r * 0.38, r * 0.88, r * 0.1);
    ctx.fillRect(x - r * 0.75, y - r * 0.6, r * 0.45, r * 0.06); ctx.fillRect(x + r * 0.3, y - r * 0.6, r * 0.45, r * 0.06);
  } else if (L.hat === 'hood') {
    ctx.fillStyle = hc; ctx.beginPath(); ctx.moveTo(x - r * 0.45, y - r * 0.25); ctx.quadraticCurveTo(x - r * 0.4, y - r * 0.85, x, y - r * 0.8); ctx.quadraticCurveTo(x + r * 0.4, y - r * 0.85, x + r * 0.45, y - r * 0.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = r * 0.04; ctx.beginPath(); ctx.moveTo(x - r * 0.3, y - r * 0.45); ctx.lineTo(x + r * 0.3, y - r * 0.45); ctx.stroke();
  } else if (L.hat === 'crown') {
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.ellipse(x, y - r * 0.38, r * 0.42, r * 0.2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = hc; ctx.fillRect(x - r * 0.5, y - r * 0.78, r * 1.0, r * 0.12);
    ctx.fillRect(x - r * 0.08, y - r * 0.7, r * 0.16, r * 0.32);
    ctx.fillStyle = '#e8d27a'; for (let k = -2; k <= 2; k++) ctx.fillRect(x + k * r * 0.2 - r * 0.02, y - r * 0.66, r * 0.04, r * 0.14);
  } else {
    // 머리띠
    ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.ellipse(x, y - r * 0.3, r * 0.45, r * 0.3, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = hc; ctx.fillRect(x - r * 0.46, y - r * 0.34, r * 0.92, r * 0.12);
    ctx.beginPath(); ctx.arc(x, y - r * 0.6, r * 0.13, 0, 7); ctx.fillStyle = '#1a1410'; ctx.fill();
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.lineWidth = Math.max(1, r * 0.12); ctx.strokeStyle = ring; ctx.stroke();
}

// 같은 장수는 한 번만 그려 두고 다시 씀
const cache = new Map();
export function portraitCanvas(g, ring = '#fff', px = 64) {
  const key = `${g.name}|${ring}|${px}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = px;
    drawPortrait(cv.getContext('2d'), px / 2, px / 2, px / 2 - Math.max(1, px * 0.04), g, ring);
    cache.set(key, cv);
  }
  return cv;
}
const urlCache = new Map();
export function portraitURL(g, ring = '#fff') {
  const key = `${g.name}|${ring}`;
  if (!urlCache.has(key)) urlCache.set(key, portraitCanvas(g, ring, 96).toDataURL());
  return urlCache.get(key);
}
