import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { answerOffer, nextMerit, traitName, offerOpts, MERIT_STEPS } from '../game/hex14merit.js';
import { uiConfirm } from '../dialog.js';
import HexTour from './HexTour.jsx';
import { BUILD, versionText } from '../version.js';
import { buildGrid, stepDay, endTurn14, sortie, order, commandCap, gensOf, unitStats, nearestCastle, draft14, draftMax14, draftCost, DAYS, dateOf, TERRAIN_NAME, castleIncome, landShare, enemy, districtTiles, queueOrder, orderNew, sendTroops, absDay, splitUnit, splitAll, buildSiege, summonGeneral, sortieAfford, SIEGE_COST, moveCost, speedOf, capOf, convoyDays, besieged, draftLeft14, planGenSpread, doGenSpread, fogOn, troopsHidden, sightOf } from '../game/hex14.js';
import { aiTurn14, STRATS, warmAI } from '../game/hex14ai.js';
import { unlockAudio, setAudio, audioOpt, sfx, setMood, holdSfx } from '../audio.js';
import { lordOf, vassalChance, protectChance, surrenderChance, demandVassal, askProtection, urgeSurrender, declareIndependence, vassalInboxText } from '../game/hex14vassal.js';
import { ROLES, jobGen, autoJobs, goldOf, popGold, harvestOf, foodUse, relOf, pactOf, PACT, acceptChance, gift, propose, renewPact, ransomValue, ransomChance, offerRansom, renewChance, RENEW_WINDOW, answerInbox, recruit, recruitChance, release, execute, powerOf, HARVEST_MONTH, trade, MARKET, isRuler, envoyOf, giftSizes, giftGain } from '../game/hex14gov.js';
import { TERRAIN } from '../game/rules.js';
import { tlabel, tdesc, TIER_NAME, T14 } from '../game/hex14traits.js';
import { corner, pixelToCell } from '../game/hex.js';
import { getScenario } from '../game/scenarios.js';
import { fmtTroops, fmtGold } from '../game/format.js';
import Slider from './Slider.jsx';
import { fixJosa } from '../game/josa.js';
import { portraitCanvas, portraitURL } from '../game/portrait.js';
import { citySprite } from '../game/citysprite.js';
import { weatherText, weatherAt, weatherShare, warmWeather, uniqueOf } from '../game/hex14extra.js';
import { BUILDINGS, canBuild, startBuild, cancelBuild, lv, slotsOf, usedSlots, foundCity, foundCheck, foundSpots, FOUND_COST, FOUND_TURNS, buildCost, FORTS, fortCheck, startFort, castleFortCheck } from '../game/hex14build.js';
import { loyalOf, rewardAll, rewardCost, SCHEMES, schemeChance, doScheme } from '../game/hex14people.js';
import { POLICIES, POLICY_COST, POLICY_UPKEEP, policySlots, adoptPolicy, dropPolicy } from '../game/hex14policy.js';
import { pref, setPref } from '../prefs.js';

// ───────── 삼국지14식 화면: 육각 칸 지도 + 도시·관문 + 부대 깃발 + 10일 진행 ─────────
const NEUTRAL = '#b9b2a0';
const clone = (s) => structuredClone(s);
const ownerColor = (s, o) => (o !== null && o >= 0 && s.nations[o] ? s.nations[o].color : NEUTRAL);

// 칸마다 같은 값이 나오는 작은 난수
const hash = (i, k = 0) => { let x = (i * 374761393 + k * 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177; x ^= x >>> 16; return ((x >>> 0) % 10000) / 10000; };
const isPhone = () => window.innerWidth <= 760; // 폰 화면 (아래 시트 배치)
// 굵은 글자 폭: 글자마다 한 번만 재고 크기에 비례해 씀 (매 장면 수백 번 재면 확대·끌기가 끊겼음 — 프로파일)
const TWC = new Map(); let twCtx = null;
const textW = (text, px) => { let w = TWC.get(text); if (w === undefined) { twCtx = twCtx || document.createElement('canvas').getContext('2d'); twCtx.font = 'bold 100px sans-serif'; w = twCtx.measureText(text).width; if (TWC.size > 4000) TWC.clear(); TWC.set(text, w); } return (w * px) / 100; };
// 폰은 그림 메모리를 아낌: 바탕 지도 2048점, 화면 배율 2까지, 확대 조각 36장까지 (폰 브라우저가 메모리가 모자라면 페이지를 꺼 버려 처음 화면으로 돌아갔음)
const mapScale = (grid) => Math.min(3, (isPhone() ? 1600 : 4096) / Math.max(grid.W, grid.H));
const newLayer = (grid, sc) => { const cv = document.createElement('canvas'); cv.width = Math.ceil(Math.max(grid.W, grid.wrap ? grid.period + grid.size * 2 : 0) * sc); cv.height = Math.ceil(grid.H * sc); const ctx = cv.getContext('2d'); ctx.scale(sc, sc); return [cv, ctx]; };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };

// 둥근 세계 지도: 홀수 줄 맨 왼쪽 반 칸 틈을, 같은 줄 맨 오른쪽 칸이 넘쳐 그려진 부분으로 채움 (이음매가 점선처럼 보이지 않게)
function seamFix(grid, cv, sc) {
  if (!grid.wrap) return;
  const ctx = cv.getContext('2d'), hw = grid.size * Math.sqrt(3), P = grid.period;
  const sx = P * sc, w = Math.ceil((hw / 2) * sc);
  if (sx + w > cv.width) return;
  // 같은 그림에 자기 자신을 줄마다 옮겨 그리면 매번 그림 전체를 복사해 몹시 느림 → 이음매 띠를 작은 그림에 한 번 떠 두고 거기서 옮김
  const strip = document.createElement('canvas'); strip.width = w; strip.height = cv.height;
  strip.getContext('2d').drawImage(cv, sx, 0, w, cv.height, 0, 0, w, cv.height);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let r = 1; r < grid.rows; r += 2) {
    const cy = grid.size * 1.5 * r + grid.size, y0 = (cy - grid.size * 0.75) * sc, h = grid.size * 1.5 * sc;
    ctx.drawImage(strip, 0, y0, w, h, 0, y0, w, h);
  }
  ctx.restore(); strip.width = 0; strip.height = 0; // 쓴 그림 바로 돌려줌 (폰 메모리)
}

// ── 지형 그림 (한 번만): 바다·해안·강·산·구릉·숲·사막을 칸마다 작은 그림으로 ──
// 메모리 절약: 강 그림을 지형 바탕에 합치고 강 전용 큰 캔버스는 버림 (영토 색은 옅어서 강이 그대로 보임)
const OWN_SC = 0.5; // 영토 색 그림은 바탕의 절반 해상도 (색 면과 굵은 경계뿐이라 차이가 거의 안 보임) — 메모리 4분의 1
function bakeRivers(B) {
  if (B.rcv && B.rcv.width) { const c = B.cv.getContext('2d'); c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(B.rcv, 0, 0); c.restore(); B.rcv.width = 0; B.rcv.height = 0; }
  B.rcv = null;
  return B;
}
// chunk가 있으면: 그 사각형(지도 좌표)만, 주어진 배율로 새로 그림 (확대했을 때 흐려지지 않게)
// 사각형(지도 좌표) 둘레 m 안의 칸들: 줄·열 범위로 바로 셈
function tilesIn(grid, r, m) {
  const out = [], hw = grid.size * Math.sqrt(3), m2 = m + grid.size * 2;
  const r0 = Math.max(0, Math.floor((r.y - m2) / (1.5 * grid.size)) - 1), r1 = Math.min(grid.rows - 1, Math.ceil((r.y + r.h + m2) / (1.5 * grid.size)) + 1);
  const c0 = Math.max(0, Math.floor((r.x - m2) / hw) - 1), c1 = Math.min(grid.cols - 1, Math.ceil((r.x + r.w + m2) / hw) + 1);
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) { const i = y * grid.cols + x; const [cx, cy] = grid.center(i); if (cx > r.x - m && cx < r.x + r.w + m && cy > r.y - m && cy < r.y + r.h + m) out.push(i); }
  return out;
}
// 해안선: 전체 경로는 한 번만 만들고, 토막(선분)은 칸 64짜리 바구니에 나눠 담아 둠
const coastCache = new WeakMap();
function coastData(world) {
  let c = coastCache.get(world);
  if (c) return c;
  const B = 64, segs = [], buckets = new Map();
  let px = 0, py = 0, sx = 0, sy = 0;
  const re = /([MLZ])\s*([-\d.]*)\s*([-\d.]*)/g; let m;
  const add = (x1, y1, x2, y2) => { const id = segs.length; segs.push(x1, y1, x2, y2); const bx0 = Math.floor(Math.min(x1, x2) / B), bx1 = Math.floor(Math.max(x1, x2) / B), by0 = Math.floor(Math.min(y1, y2) / B), by1 = Math.floor(Math.max(y1, y2) / B); for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) { const k = bx * 100000 + by; let l = buckets.get(k); if (!l) buckets.set(k, (l = [])); l.push(id); } };
  while ((m = re.exec(world.paths.land))) {
    if (m[1] === 'M') { px = sx = +m[2]; py = sy = +m[3]; }
    else if (m[1] === 'L') { const x = +m[2], y = +m[3]; add(px, py, x, y); px = x; py = y; }
    else { if (px !== sx || py !== sy) add(px, py, sx, sy); px = sx; py = sy; }
  }
  c = { B, segs, buckets, full: null };
  coastCache.set(world, c);
  return c;
}
const coastFull = (world) => { const c = coastData(world); return c.full || (c.full = new Path2D(world.paths.land)); };
function coastNear(world, r, m, period) {
  const c = coastData(world), p = new Path2D(), seen = new Set();
  for (const ox of period ? [0, -period, period] : [0]) {
    const x0 = r.x - m - ox, x1 = r.x + r.w + m - ox, y0 = r.y - m, y1 = r.y + r.h + m;
    for (let bx = Math.floor(x0 / c.B); bx <= Math.floor(x1 / c.B); bx++) for (let by = Math.floor(y0 / c.B); by <= Math.floor(y1 / c.B); by++) {
      const l = c.buckets.get(bx * 100000 + by); if (!l) continue;
      for (const id of l) { const key = id * 4 + (ox > 0 ? 1 : ox < 0 ? 2 : 0); if (seen.has(key)) continue; seen.add(key); const o = id * 4; p.moveTo(c.segs[o] + ox, c.segs[o + 1]); p.lineTo(c.segs[o + 2] + ox, c.segs[o + 3]); }
    }
  }
  return p;
}
const spriteCaches = new WeakMap();
function spriteCacheFor(grid, sc) { let m = spriteCaches.get(grid); if (!m) spriteCaches.set(grid, (m = new Map())); const k = sc.toFixed(3); if (!m.has(k)) { if (m.size > (isPhone() ? 3 : 6)) { for (const sm of m.values()) for (const sp of sm.values()) { sp.cv.width = 0; sp.cv.height = 0; } m.clear(); } m.set(k, new Map()); } return m.get(k); }
function paintTerrain(grid, world, chunk = null) {
  const sc = chunk ? chunk.sc : mapScale(grid);
  const layer = () => { if (!chunk) return newLayer(grid, sc); const c2 = document.createElement('canvas'); c2.width = Math.ceil(chunk.w * sc); c2.height = Math.ceil(chunk.h * sc); const x = c2.getContext('2d'); x.scale(sc, sc); x.translate(-chunk.x, -chunk.y); return [c2, x]; };
  const [cv, ctx0] = layer();
  let ctx = ctx0; // 나무 그림을 작은 그림(스프라이트)에 미리 그릴 때 잠깐 바꿔 씀
  const m = grid.size * 3;
  // 조각에 드는 칸: 줄·열 범위로 바로 셈 (칸 전체를 훑지 않게)
  const TILES = chunk ? (() => {
    const out = [], hw = grid.size * Math.sqrt(3), m2 = m + grid.size * 2;
    const r0 = Math.max(0, Math.floor((chunk.y - m2) / (1.5 * grid.size)) - 1), r1 = Math.min(grid.rows - 1, Math.ceil((chunk.y + chunk.h + m2) / (1.5 * grid.size)) + 1);
    const c0 = Math.max(0, Math.floor((chunk.x - m2) / hw) - 1), c1 = Math.min(grid.cols - 1, Math.ceil((chunk.x + chunk.w + m2) / hw) + 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const i = r * grid.cols + c; const [x, y] = grid.center(i); if (x > chunk.x - m && x < chunk.x + chunk.w + m && y > chunk.y - m && y < chunk.y + chunk.h + m) out.push(i); }
    return out;
  })() : null;
  const ALL = { [Symbol.iterator]: function* () { for (let i = 0; i < grid.N; i++) yield i; } };
  const each = (fn) => { if (TILES) for (const i of TILES) fn(i); else for (let i = 0; i < grid.N; i++) fn(i); };
  const sz = grid.size;
  const hexPath = (i, k = 1) => {
    const [cx, cy] = grid.center(i);
    ctx.beginPath();
    for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * k, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  };
  // 같은 색 칸끼리 모아 칠함 (색 바꾸기를 줄임). 칸들을 한 경로로 합치면 겹친 가장자리 계산이 오히려 느려서 칸마다 칠함
  const fillGroups = (groups, k) => {
    for (const [col, list] of groups) {
      ctx.fillStyle = col;
      for (const i of list) { const [cx, cy] = grid.center(i); ctx.beginPath(); for (let e = 0; e < 6; e++) { const [px, py] = corner(cx, cy, sz * k, e); if (e) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.fill(); }
    }
  };
  const add = (m, key, i) => { let l = m.get(key); if (!l) m.set(key, (l = [])); l.push(i); };
  // 아주 큰 지도(바탕에서 칸 반지름 3.5점 미만): 바다·땅 바탕색을 칸마다 육각형으로 칠하지 않고, 화면 점마다 어느 칸인지 셈해 색을 바로 씀
  // (43만 칸을 하나하나 칠하면 몇 초 걸림 — 점마다 가장 가까운 칸 중심을 고르므로 육각형 모양은 그대로)
  const raster = !chunk && sz * sc < 3.5;
  const rasterLayer = (pick) => {
    // pick(i) → [r, g, b] 또는 null(비움). 칸마다 자기 육각형이 덮는 점 줄(가로 구간)만 바로 채움 — 점마다 가장 가까운 칸을 찾는 것보다 훨씬 빠름
    const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const octx = out.getContext('2d'), Wp = cv.width, Hp = cv.height, R = sz, SQ = Math.sqrt(3);
    const img = octx.createImageData(Wp, Hp), dd = img.data;
    for (let i = 0; i < grid.N; i++) {
      const v = pick(i); if (!v) continue;
      const [cx, cy] = grid.center(i), r0 = v[0], g0 = v[1], b0 = v[2];
      const pyA = Math.max(0, Math.floor((cy - R) * sc)), pyB = Math.min(Hp - 1, Math.ceil((cy + R) * sc));
      for (let py = pyA; py <= pyB; py++) {
        const dy = Math.abs((py + 0.5) / sc - cy); if (dy > R) continue;
        const half = (dy <= R / 2 ? (R * SQ) / 2 : (R - dy) * SQ) + 0.6 / sc; // 0.6점 넉넉히 (이웃 칸 사이 틈 없게)
        const pxA = Math.max(0, Math.ceil((cx - half) * sc - 0.5)), pxB = Math.min(Wp - 1, Math.floor((cx + half) * sc - 0.5));
        for (let px = pxA, o = (py * Wp + pxA) * 4; px <= pxB; px++, o += 4) { dd[o] = r0; dd[o + 1] = g0; dd[o + 2] = b0; dd[o + 3] = 255; }
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  };
  const drawRaster = (img) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, 0, 0); ctx.restore(); img.width = 0; img.height = 0; };
  const rgbOf = (str) => { const m = str.match(/\d+/g); return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0]; };
  // 바다: 뭍에서 멀수록 짙게 (10칸까지 부드럽게 단계), 먼바다 바탕
  ctx.fillStyle = '#1a4064';
  ctx.fillRect(0, 0, grid.W, grid.H);
  // 둥근 세계 지도: 북극 얼음 띠 바탕을 먼저 깔아 칸 사이 틈(지그재그)이 바다색 점선으로 보이지 않게
  if (grid.wrap) { ctx.fillStyle = '#e6eef2'; ctx.fillRect(0, 0, grid.W, grid.size * 1.5 * 2); }
  const isLand = (i) => i !== undefined && grid.terrain[i] !== 0;
  if (!grid.seaDepth) {
    const dd = new Uint8Array(grid.N).fill(255), q = [];
    for (let i = 0; i < grid.N; i++) if (grid.terrain[i] !== 0) { dd[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) { const x = q[k]; if (dd[x] >= 10) continue; for (const j of grid.nb[x]) if (dd[j] === 255 && grid.terrain[j] === 0) { dd[j] = dd[x] + 1; q.push(j); } }
    grid.seaDepth = dd;
  }
  const SEA_NEAR = [92, 156, 182], SEA_FAR = [26, 64, 100]; // 얕은 바다 → 먼 바다 (너무 하늘색이지 않게)
  // 깊이·밝기 단계가 같은 칸끼리 모아 칠함 (색 바꾸기를 줄임)
  if (raster) drawRaster(rasterLayer((i) => { if (grid.terrain[i] !== 0) return null; const d = Math.min(10, grid.seaDepth[i]); if (d >= 10) return SEA_FAR; const f = Math.pow((d - 1) / 9, 0.7), n = 0.97 + ((Math.min(7, Math.floor(hash(i, 5) * 8))) + 0.5) / 8 * 0.06; return SEA_NEAR.map((a, k) => Math.round((a + (SEA_FAR[k] - a) * f) * n)); }));
  else {
    const groups = new Map();
    for (const i of (TILES || ALL)) {
      if (grid.terrain[i] !== 0) continue;
      const d = Math.min(10, grid.seaDepth[i]);
      if (d >= 10) continue;
      const key = d * 8 + Math.min(7, Math.floor(hash(i, 5) * 8));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const [key, list] of groups) {
      const d = key >> 3, f = Math.pow((d - 1) / 9, 0.7), n = 0.97 + ((key & 7) + 0.5) / 8 * 0.06;
      ctx.fillStyle = `rgb(${SEA_NEAR.map((a, k) => Math.round((a + (SEA_FAR[k] - a) * f) * n)).join(',')})`;
      for (const i of list) { hexPath(i, 1.06); ctx.fill(); }
    }
  }
  // 파도 거품: 실제 해안선 바깥쪽에 흰 띠 (땅 칸이 안쪽을 덮음)
  if (world.geo && world.paths?.land) {
    try {
      // 조각(타일)을 그릴 땐 그 둘레 해안선 토막만 모아 그림 (세계 해안선 전체는 116만 글자라 타일마다 통째로 그리면 몹시 느림)
      const coast = chunk ? coastNear(world, chunk, sz * 1.5, grid.wrap ? grid.period : 0) : coastFull(world);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const ox of grid.wrap && !chunk ? [0, -grid.period, grid.period] : [0]) {
        ctx.save(); ctx.translate(ox, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = sz * 1.2; ctx.stroke(coast);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = sz * 0.55; ctx.stroke(coast);
        ctx.restore();
      }
      ctx.lineCap = 'butt';
    } catch { /* 거품 없이 */ }
  }
  // 물결
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = sz * 0.07;
  for (const i of (raster ? [] : (TILES || ALL))) { // 칸이 아주 작으면 물결(1점 미만)은 안 보여 건너뜀
    if (grid.terrain[i] !== 0 || hash(i, 1) > 0.18) continue;
    const [cx, cy] = grid.center(i);
    const x = cx + (hash(i, 2) - 0.5) * sz, y = cy + (hash(i, 3) - 0.5) * sz;
    ctx.beginPath(); ctx.arc(x - sz * 0.25, y, sz * 0.25, Math.PI * 1.1, Math.PI * 1.9); ctx.arc(x + sz * 0.25, y, sz * 0.25, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  // 세계 지도 북쪽 끝: 북극 바다는 얼음(해빙)으로 — 지도가 잘린 게 아니라 얼어붙은 바다로 보이게
  const bb = getScenario(world.scenarioId)?.bbox;
  if (bb && bb[2] - bb[0] >= 359) {
    for (const i of (TILES || ALL)) {
      if (grid.terrain[i] !== 0) continue;
      const c = i % grid.cols;
      const edge = grid.ice[i] && grid.nb[i].some((j) => !grid.ice[j]);
      // 얼음 가장자리 밖 바다: 떠다니는 유빙 몇 개
      const floe = !grid.ice[i] && grid.nb[i].some((j) => grid.ice[j]) && hash(i, 83) < 0.45;
      if (!grid.ice[i] && !floe) continue;
      // 가장자리는 깨진 얼음(옅게), 안쪽은 두꺼운 얼음 — 둥근 지도는 이음매 쪽 칸을 반대편에도 한 번 더 (틈이 안 보이게)
      ctx.fillStyle = floe ? `rgba(226,238,244,${0.35 + hash(i, 84) * 0.3})` : edge ? `rgba(226,238,244,${0.75 + hash(i, 78) * 0.2})` : shade('#e6eef2', 0.95 + hash(i, 79) * 0.08);
      hexPath(i, floe ? 0.6 + hash(i, 85) * 0.3 : 1.06); ctx.fill();
      if (grid.wrap && (c === 0 || c === grid.cols - 1)) { ctx.save(); ctx.translate(c === 0 ? grid.period : -grid.period, 0); hexPath(i, 1.06); ctx.fill(); ctx.restore(); }
      if (grid.ice[i] && !edge && hash(i, 80) < 0.25) { ctx.strokeStyle = 'rgba(150,180,200,0.6)'; ctx.lineWidth = sz * 0.06; const [cx, cy] = grid.center(i); ctx.beginPath(); ctx.moveTo(cx - sz * 0.5, cy + (hash(i, 81) - 0.5) * sz); ctx.lineTo(cx + sz * 0.1, cy); ctx.lineTo(cx + sz * 0.5, cy + (hash(i, 82) - 0.5) * sz); ctx.stroke(); }
    }
  }
  // 모래톱: 바다와 맞닿은 땅
  if (!raster) { const g = new Map(); for (const i of (TILES || ALL)) { if (!isLand(i) || !grid.nb[i].some((j) => grid.terrain[j] === 0)) continue; add(g, grid.terrain[i] === 5 ? '#cfd9de' : '#e8d9a8', i); } fillGroups(g, 1.18); } // 동토 해안은 모래 대신 회색 자갈
  // 땅 바탕: 지형 색에 칸마다 살짝 다른 밝기
  if (!raster) { const g = new Map(); for (const i of (TILES || ALL)) { const t = grid.terrain[i]; if (t === 0) continue; add(g, shade(TERRAIN[t]?.color || '#d6dfa6', 0.94 + (Math.floor(hash(i, 4) * 8) + 0.5) / 8 * 0.1), i); } fillGroups(g, 1.04); }
  // 입체감: 북서쪽에서 빛이 비친다고 보고, 높은 땅(산·구릉·숲) 둘레에 빛·그림자를 칠함
  {
    const HT = [0, 0, 0.6, 1.3, 0.1, 0.2, 2.4, 3.2];
    if (!grid.relief) {
      const h0 = new Float32Array(grid.N);
      for (let i = 0; i < grid.N; i++) h0[i] = grid.terrain[i] ? HT[grid.terrain[i]] ?? 0 : -0.3;
      const h1 = new Float32Array(grid.N);
      for (let i = 0; i < grid.N; i++) { let s2 = h0[i] * 2, c = 2; for (const j of grid.nb[i]) { s2 += h0[j]; c++; } h1[i] = s2 / c; }
      const lit = new Float32Array(grid.N);
      for (let i = 0; i < grid.N; i++) {
        if (!grid.terrain[i]) continue;
        const [x0, y0] = grid.center(i);
        let gx = 0, gy = 0;
        for (const j of grid.nb[i]) { const [x1, y1] = grid.center(j); const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1; if (L > sz * 3) continue; gx += ((h1[j] - h1[i]) * dx) / L; gy += ((h1[j] - h1[i]) * dy) / L; }
        lit[i] = (gx + gy) * 0.7; // 북서쪽(-x,-y)이 낮으면 빛을 받음
      }
      grid.relief = lit;
    }
    if (raster) {
      // 땅 바탕색 + 빛·그림자를 한 번에 섞어 찍음
      drawRaster(rasterLayer((i) => {
        const t = grid.terrain[i]; if (t === 0) return null;
        let c = rgbOf(shade(TERRAIN[t]?.color || '#d6dfa6', 0.94 + (Math.floor(hash(i, 4) * 8) + 0.5) / 8 * 0.1));
        const l = grid.relief[i];
        if (Math.abs(l) >= 0.05) { const a = Math.round((l > 0 ? Math.min(0.22, l * 0.16) : Math.min(0.28, -l * 0.18)) * 50) / 50, to = l > 0 ? [255, 248, 225] : [20, 25, 40]; c = c.map((v, k) => Math.round(v * (1 - a) + to[k] * a)); }
        return c;
      }));
    }
    const g = new Map();
    for (const i of (raster ? [] : (TILES || ALL))) {
      const l = grid.relief[i];
      if (!grid.terrain[i] || Math.abs(l) < 0.05) continue;
      const a = l > 0 ? Math.min(0.22, l * 0.16) : Math.min(0.28, -l * 0.18), aq = (Math.round(a * 50) / 50).toFixed(2); // 투명도를 0.02 단위로 묶음
      add(g, l > 0 ? `rgba(255,248,225,${aq})` : `rgba(20,25,40,${aq})`, i);
    }
    fillGroups(g, 1.04);
  }
  // 풀·모래 무늬 — 전체 바탕에서 칸이 아주 작으면(반지름 3.5점 미만, 아주 잘게 세계판) 풀잎·모래결은 1점도 안 돼 안 보이므로 건너뜀 (확대 타일엔 그대로 그림)
  const tiny = raster;
  for (const i of (tiny ? [] : (TILES || ALL))) {
    const t = grid.terrain[i];
    const [cx, cy] = grid.center(i);
    if (t === 1) {
      ctx.strokeStyle = 'rgba(95,125,55,0.55)';
      ctx.lineWidth = sz * 0.06;
      for (let k = 0; k < 3; k++) {
        if (hash(i, 10 + k) > 0.6) continue;
        const x = cx + (hash(i, 20 + k) - 0.5) * sz * 1.3, y = cy + (hash(i, 30 + k) - 0.5) * sz * 1.2;
        ctx.beginPath(); ctx.moveTo(x - sz * 0.1, y); ctx.lineTo(x - sz * 0.05, y - sz * 0.18); ctx.moveTo(x, y); ctx.lineTo(x + sz * 0.02, y - sz * 0.22); ctx.moveTo(x + sz * 0.1, y); ctx.lineTo(x + sz * 0.08, y - sz * 0.16); ctx.stroke();
      }
    } else if (t === 4) {
      ctx.strokeStyle = 'rgba(170,130,60,0.6)';
      ctx.lineWidth = sz * 0.08;
      for (let k = 0; k < 2; k++) { const x = cx + (hash(i, 40 + k) - 0.5) * sz, y = cy + (hash(i, 50 + k) - 0.5) * sz; ctx.beginPath(); ctx.arc(x, y + sz * 0.3, sz * 0.4, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
    } else if (t === 5) {
      // 동토: 눈 더미 결과 마른 풀포기
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(cx + (hash(i, 60 + k) - 0.5) * sz * 1.4, cy + (hash(i, 70 + k) - 0.5) * sz * 1.4, sz * 0.08, 0, 7); ctx.fill(); }
      ctx.strokeStyle = 'rgba(140,165,180,0.55)'; ctx.lineWidth = sz * 0.07;
      for (let k = 0; k < 2; k++) { if (hash(i, 90 + k) > 0.55) continue; const x = cx + (hash(i, 92 + k) - 0.5) * sz * 1.2, y = cy + (hash(i, 94 + k) - 0.5) * sz; ctx.beginPath(); ctx.arc(x, y + sz * 0.25, sz * 0.35, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      if (hash(i, 96) < 0.3) { ctx.strokeStyle = 'rgba(120,130,90,0.6)'; ctx.lineWidth = sz * 0.05; const x = cx + (hash(i, 97) - 0.5) * sz, y = cy + (hash(i, 98) - 0.5) * sz; ctx.beginPath(); ctx.moveTo(x - sz * 0.08, y); ctx.lineTo(x - sz * 0.04, y - sz * 0.14); ctx.moveTo(x + sz * 0.06, y); ctx.lineTo(x + sz * 0.05, y - sz * 0.15); ctx.stroke(); }
    }
  }
  // 칸 테두리 (아주 옅게)
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = sz * 0.05;
  if (!tiny) for (const i of (TILES || ALL)) if (grid.passable(i)) { hexPath(i, 0.98); ctx.stroke(); }
  // 강: 실제 강줄기를 부드럽게 (짙은 테두리 + 밝은 물빛)
  const rivers = (world.rivers || []).filter((r) => r.pts?.length > 1);
  // 강은 영토 색에 덮이지 않게 따로 한 장에 그림
  const [rcv, rctx] = layer();
  {
    const ctx = rctx;
    const curveR = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length - 1; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my); } const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]); };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, col] of [[0.62, '#2b5f86'], [0.42, '#4d93c2'], [0.16, 'rgba(200,235,255,0.6)']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = sz * w;
      for (const r of rivers) { curveR(r.pts); ctx.stroke(); }
    }
  }
  // 산·구릉·숲: 위에서부터 차례로 그려야 앞의 것이 뒤를 가림
  const order = [];
  each((i) => { if ([2, 3, 6, 7].includes(grid.terrain[i])) order.push(i); });
  order.sort((a, b) => grid.center(a)[1] - grid.center(b)[1]);
  // ── 지형 그림 (수채화풍): 빛은 북서쪽에서 — 밝은 면은 따뜻하게, 그림자 면은 차갑게 ──
  const shadowBlob = (x, y, w, h, a = 0.22) => { ctx.beginPath(); ctx.ellipse(x + w * 0.12, y + h * 0.15, w, h, 0, 0, 7); ctx.fillStyle = `rgba(30,25,20,${a})`; ctx.fill(); };
  // 산: 봉우리 + 능선 + 바위 결 + (높으면) 눈
  const peak = (x, y, w, h, snow, seed) => {
    const r = (k) => hash(seed, k);
    const apx = x + (r(1) - 0.5) * w * 0.35, apy = y - h;
    const sx = x + w * (0.05 + r(2) * 0.15); // 능선이 내려오는 자리
    shadowBlob(x, y, w * 1.05, h * 0.12, 0.25);
    // 밝은 면
    let g = ctx.createLinearGradient(x - w, apy, sx, y);
    g.addColorStop(0, snow ? '#d9d2c4' : '#d8bf92'); g.addColorStop(1, snow ? '#a59a8a' : '#b29468');
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.55, y - h * 0.45, apx, apy); ctx.lineTo(sx, y); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // 그림자 면
    g = ctx.createLinearGradient(apx, apy, x + w, y);
    g.addColorStop(0, snow ? '#7d7887' : '#86694c'); g.addColorStop(1, snow ? '#575466' : '#5f4a37');
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(apx, apy); ctx.quadraticCurveTo(x + w * 0.6, y - h * 0.4, x + w, y); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // 바위 결 (그림자 면에 짧은 사선)
    ctx.strokeStyle = 'rgba(40,28,20,0.35)'; ctx.lineWidth = sz * 0.04;
    for (let k = 0; k < 3; k++) { const f = 0.3 + k * 0.2; const px = apx + (x + w - apx) * f * 0.6, py = apy + (y - apy) * f; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + w * 0.18, py + h * 0.16); ctx.stroke(); }
    // 눈 덮인 꼭대기
    if (snow || h > sz * 1.45) {
      const sh = h * (snow ? 0.42 : 0.24);
      ctx.beginPath(); ctx.moveTo(apx, apy);
      ctx.lineTo(apx - w * 0.36 * (sh / h) * 2, apy + sh); ctx.lineTo(apx - w * 0.12, apy + sh * 0.72); ctx.lineTo(apx + w * 0.05, apy + sh * 0.95); ctx.lineTo(apx + w * 0.2, apy + sh * 0.7); ctx.lineTo(apx + w * 0.36 * (sh / h) * 2, apy + sh); ctx.closePath();
      ctx.fillStyle = '#f7f9fb'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(apx, apy); ctx.lineTo(apx + w * 0.05, apy + sh * 0.95); ctx.lineTo(apx + w * 0.2, apy + sh * 0.7); ctx.lineTo(apx + w * 0.36 * (sh / h) * 2, apy + sh); ctx.closePath(); ctx.fillStyle = '#c9d3e0'; ctx.fill();
    }
    // 윤곽
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.55, y - h * 0.45, apx, apy); ctx.quadraticCurveTo(x + w * 0.6, y - h * 0.4, x + w, y);
    ctx.strokeStyle = 'rgba(45,32,22,0.7)'; ctx.lineWidth = sz * 0.06; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(apx, apy); ctx.lineTo(sx, y); ctx.strokeStyle = 'rgba(45,32,22,0.3)'; ctx.lineWidth = sz * 0.04; ctx.stroke();
  };
  // 침엽수 (북쪽·산지)
  const pine = (x, y, h, seed) => {
    shadowBlob(x, y, h * 0.32, h * 0.09, 0.22);
    ctx.fillStyle = '#5a4026'; ctx.fillRect(x - h * 0.05, y - h * 0.18, h * 0.1, h * 0.2);
    const tiers = [[0.18, 0.4], [0.45, 0.31], [0.7, 0.22]];
    for (const [yy, ww] of tiers) {
      ctx.beginPath(); ctx.moveTo(x - h * ww, y - h * yy); ctx.lineTo(x, y - h * (yy + 0.42)); ctx.lineTo(x + h * ww, y - h * yy); ctx.closePath();
      ctx.fillStyle = '#2d5e36'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - h * ww, y - h * yy); ctx.lineTo(x, y - h * (yy + 0.42)); ctx.lineTo(x - h * ww * 0.1, y - h * yy); ctx.closePath();
      ctx.fillStyle = '#4f8f4a'; ctx.fill();
    }
  };
  // 활엽수 (둥근 수관 + 빛)
  const leafy = (x, y, h, seed) => {
    const r = (k) => hash(seed, k);
    shadowBlob(x, y, h * 0.42, h * 0.11, 0.24);
    ctx.fillStyle = '#5d4128'; ctx.fillRect(x - h * 0.05, y - h * 0.3, h * 0.1, h * 0.32);
    const base = ['#3f7a3a', '#4a8540', '#56893b', '#3c7246'][Math.floor(r(1) * 4)];
    const cy0 = y - h * 0.55;
    for (const [dx, dy, rr] of [[-0.18, 0.05, 0.27], [0.18, 0.06, 0.26], [0, -0.12, 0.32]]) {
      ctx.beginPath(); ctx.arc(x + dx * h, cy0 + dy * h, rr * h, 0, 7); ctx.fillStyle = base; ctx.fill();
    }
    const g = ctx.createRadialGradient(x - h * 0.15, cy0 - h * 0.2, h * 0.02, x, cy0, h * 0.45);
    g.addColorStop(0, 'rgba(210,240,150,0.55)'); g.addColorStop(1, 'rgba(210,240,150,0)');
    ctx.beginPath(); ctx.arc(x, cy0 - h * 0.04, h * 0.38, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(x + h * 0.1, cy0 + h * 0.08, h * 0.3, 0.1, 2.2); ctx.strokeStyle = 'rgba(20,45,20,0.35)'; ctx.lineWidth = sz * 0.04; ctx.stroke();
  };
  // 나무는 크기 5단계 × 모양별로 한 번만 작은 그림에 그려 두고 찍어 냄 (세계판은 나무가 수만 그루라 하나하나 그리면 몇 초 걸림)
  const sprites = spriteCacheFor(grid, sc); // 같은 배율이면 조각끼리 나무 그림을 같이 씀
  const tree = (isPine, x, y, h, seed) => {
    const hq = Math.max(0, Math.min(4, Math.round(((h / sz - 0.7) / 0.32) * 4)));
    const v = isPine ? 0 : 1 + Math.floor(hash(seed, 1) * 4);
    const key = v * 8 + hq;
    let sp = sprites.get(key);
    if (!sp) {
      const H = sz * (0.7 + (hq / 4) * 0.32), W = H * 1.1, ox = W / 2, oy = H * 1.2, Ht = H * 1.45;
      const c2 = document.createElement('canvas'); c2.width = Math.ceil(W * sc) + 2; c2.height = Math.ceil(Ht * sc) + 2;
      const x2 = c2.getContext('2d'); x2.scale(sc, sc);
      ctx = x2;
      if (isPine) pine(ox, oy, H, seed); else leafy(ox, oy, H, seed);
      ctx = ctx0;
      sp = { cv: c2, ox, oy, w: c2.width / sc, h: c2.height / sc };
      sprites.set(key, sp);
    }
    ctx.drawImage(sp.cv, x - sp.ox, y - sp.oy, sp.w, sp.h);
  };
  // 구릉: 둥근 언덕 + 빛 + 풀 포기
  const mound = (x, y, w, h, seed) => {
    shadowBlob(x, y, w * 0.95, h * 0.18, 0.2);
    const g = ctx.createLinearGradient(x - w, y - h, x + w * 0.6, y);
    g.addColorStop(0, '#dcc591'); g.addColorStop(0.55, '#bf9f68'); g.addColorStop(1, '#94764c');
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.6, y - h * 1.05, x + w * 0.5, y - h * 1.05, x + w, y); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w * 0.6, y - h * 1.05, x + w * 0.5, y - h * 1.05, x + w, y); ctx.strokeStyle = 'rgba(70,50,28,0.5)'; ctx.lineWidth = sz * 0.05; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,120,50,0.6)'; ctx.lineWidth = sz * 0.035;
    for (let k = 0; k < 2; k++) { const gx = x - w * 0.3 + hash(seed, 40 + k) * w * 0.6, gy = y - h * (0.35 + hash(seed, 50 + k) * 0.3); ctx.beginPath(); ctx.moveTo(gx - sz * 0.05, gy); ctx.lineTo(gx - sz * 0.02, gy - sz * 0.12); ctx.moveTo(gx + sz * 0.04, gy); ctx.lineTo(gx + sz * 0.05, gy - sz * 0.13); ctx.stroke(); }
  };
  for (const i of order) {
    const t = grid.terrain[i];
    const [cx, cy] = grid.center(i);
    const j = (k) => (hash(i, k) - 0.5) * sz;
    if (t === 7) { peak(cx + j(1) * 0.3, cy + sz * 0.55, sz * 1.15, sz * (1.9 + hash(i, 2) * 0.5), true, i); }
    else if (t === 6) {
      peak(cx - sz * 0.35 + j(3) * 0.2, cy + sz * 0.3, sz * 0.75, sz * (1.1 + hash(i, 4) * 0.45), false, i * 3 + 1);
      peak(cx + sz * 0.35 + j(5) * 0.2, cy + sz * 0.6, sz * 0.8, sz * (1.2 + hash(i, 6) * 0.45), false, i * 3 + 2);
    } else if (t === 3) {
      mound(cx - sz * 0.3 + j(7) * 0.2, cy + sz * 0.2, sz * 0.55, sz * 0.45, i * 2);
      mound(cx + sz * 0.3 + j(8) * 0.2, cy + sz * 0.5, sz * 0.6, sz * 0.5, i * 2 + 1);
    } else if (t === 2) {
      // 북쪽(지도 위쪽)이나 산 옆은 침엽수, 남쪽은 활엽수 많게
      const north = cy / grid.H < 0.35 || grid.nb[i].some((n) => grid.terrain[n] === 6 || grid.terrain[n] === 7);
      const pts = [];
      for (let k = 0; k < 5; k++) pts.push([cx + (hash(i, 11 + k) - 0.5) * sz * 1.4, cy + (hash(i, 21 + k) - 0.3) * sz * 0.95, sz * (0.7 + hash(i, 31 + k) * 0.32), hash(i, 41 + k)]);
      pts.sort((a, b) => a[1] - b[1]);
      for (const [x, y, h, rr] of pts) tree(rr < (north ? 0.75 : 0.25), x, y, h, i * 7 + Math.round(rr * 100));
    }
  }
  // 외지: 무대 밖 땅은 회색으로 흐리게 (지나갈 수 없음)
  if (grid.outside) {
    ctx.fillStyle = 'rgba(110,110,120,0.55)';
    for (const i of (TILES || ALL)) if (grid.outside[i]) { hexPath(i, 1.02); ctx.fill(); }
  }
  if (!chunk) { seamFix(grid, cv, sc); seamFix(grid, rcv, sc); }
  return { cv, rcv, sc };
}

// ── 영토 덧칠 (주인이 바뀔 때만): 나라 색을 옅게 + 관할 경계(점선) + 나라 경계(굵게) ──
// 나라 땅 색·경계 그리기 (tiles: 그릴 칸 목록)
function drawOwnerTiles(grid, s, ctx, tiles) {
  const sz = grid.size;
  const byColor = new Map();
  for (const i of tiles) {
    if (!grid.passable(i)) continue;
    const col = ownerColor(s, s.owner[i]);
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push(i);
  }
  ctx.globalAlpha = 0.24; // 영토 색은 옅게 (지형 그림이 비쳐 보이게)
  // 아주 큰 경로 하나(세계판은 칸 수만 개)는 그리기가 몹시 느려서 1,500칸씩 나눠 칠함
  for (const [col, list] of byColor) {
    ctx.fillStyle = col;
    for (let b = 0; b < list.length; b += 1500) {
      ctx.beginPath();
      for (let q = b; q < Math.min(list.length, b + 1500); q++) { const [cx, cy] = grid.center(list[q]); for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * 1.03, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); } } // 칠하기는 열린 도형을 저절로 닫으므로 closePath 안 함 (세계판 아주 잘게에서 그것만 1.5초)
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const edge = (i, j) => {
    const [cx, cy] = grid.center(i), [jx, jy] = grid.center(j);
    const mx = (cx + jx) / 2, my = (cy + jy) / 2, dx = jy - cy, dy = cx - jx, L = Math.hypot(dx, dy) || 1, h = sz * 0.58;
    ctx.moveTo(mx - (dx / L) * h, my - (dy / L) * h);
    ctx.lineTo(mx + (dx / L) * h, my + (dy / L) * h);
  };
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const i of tiles) if (grid.passable(i)) for (const j of grid.nb[i]) if (grid.passable(j) && s.owner[j] === s.owner[i] && s.district[j] !== s.district[i]) edge(i, j);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = sz * 0.1;
  ctx.setLineDash([sz * 0.3, sz * 0.25]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 나라 경계: 바깥은 나라 색, 안쪽은 짙은 선
  const borders = new Map();
  for (const i of tiles) if (grid.passable(i)) for (const j of grid.nb[i]) if (grid.passable(j) && s.owner[j] !== s.owner[i]) { const c = ownerColor(s, s.owner[i]); if (!borders.has(c)) borders.set(c, []); borders.get(c).push([i, j]); }
  ctx.beginPath();
  for (const list of borders.values()) for (const [i, j] of list) edge(i, j);
  ctx.strokeStyle = 'rgba(20,14,10,0.85)';
  ctx.lineWidth = sz * 0.22;
  ctx.stroke();
  // 경계 안쪽에 나라 색 띠
  for (const [col, list] of borders) {
    ctx.beginPath();
    for (const [i, j] of list) {
      const [cx, cy] = grid.center(i), [jx, jy] = grid.center(j);
      const mx = cx + (jx - cx) * 0.38, my = cy + (jy - cy) * 0.38, dx = jy - cy, dy = cx - jx, L = Math.hypot(dx, dy) || 1, h = sz * 0.5;
      ctx.moveTo(mx - (dx / L) * h, my - (dy / L) * h);
      ctx.lineTo(mx + (dx / L) * h, my + (dy / L) * h);
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = sz * 0.22;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function paintOwners(grid, s, sc) {
  const [cv, ctx] = newLayer(grid, sc);
  drawOwnerTiles(grid, s, ctx, Array.from({ length: grid.N }, (_, i) => i));
  seamFix(grid, cv, sc);
  return cv;
}
// 바뀐 칸이 있는 구역(블록)만 지우고 다시 그림 — 세계 지도처럼 칸이 많을 때 매일 전체를 다시 칠하지 않게
const BLK = 8; // 작게 잡아야 바뀐 칸 몇 개 때문에 수백 칸을 다시 칠하지 않음
// 바뀐 칸들이 든 구역(블록) 사각형들 (지도 좌표) — 영토 그림·합친 그림·확대 조각을 그 부분만 고칠 때 씀
function ownerBlocks(grid, changed) {
  const blocks = new Set();
  for (const i of changed) blocks.add(Math.floor((i % grid.cols) / BLK) + ',' + Math.floor(Math.floor(i / grid.cols) / BLK));
  const hw = grid.size * Math.sqrt(3), out = [];
  for (const key of blocks) {
    const [bc, br] = key.split(',').map(Number);
    const c0 = bc * BLK, c1 = Math.min(grid.cols - 1, c0 + BLK - 1), r0 = br * BLK, r1 = Math.min(grid.rows - 1, r0 + BLK - 1);
    const tiles = [];
    for (let r = Math.max(0, r0 - 2); r <= Math.min(grid.rows - 1, r1 + 2); r++) for (let c = Math.max(0, c0 - 2); c <= Math.min(grid.cols - 1, c1 + 2); c++) tiles.push(r * grid.cols + c);
    out.push({ x0: c0 * hw, x1: (c1 + 1.5) * hw, y0: r0 * grid.size * 1.5, y1: (r1 + 1) * grid.size * 1.5 + grid.size, tiles, edge: c0 === 0 || c1 === grid.cols - 1 });
  }
  return out;
}
// 영토 그림에서 그 사각형들만 지우고 다시 그림 (ctx는 이미 지도 좌표로 맞춰져 있음)
function repaintOwnerRects(grid, s, ctx, rects) {
  for (const r of rects) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.clip();
    ctx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    drawOwnerTiles(grid, s, ctx, r.tiles);
    ctx.restore();
  }
}
function repaintOwners(grid, s, cv, sc, changed) {
  const rects = ownerBlocks(grid, changed);
  repaintOwnerRects(grid, s, cv.getContext('2d'), rects);
  if (rects.some((r) => r.edge)) seamFix(grid, cv, sc);
  return rects;
}

// 일기토 장면: 소개 → 합마다 두 장수가 달려들어 부딪치고(피해 숫자·회심의 일격) → 승부 — 화면을 누르면 결과로 건너뜀
export const DUEL_T = { intro: 1500, round: 1250, end: 2600 };
export const duelMs = (d) => DUEL_T.intro + d.rounds.length * DUEL_T.round + DUEL_T.end;
function DuelView({ d, game, pid, onSkip }) {
  const [step, setStep] = useState(0); // 0 = 소개, 1..n = n합째, n+1 = 승부
  const n = d.rounds.length;
  useEffect(() => {
    holdSfx(duelMs(d) / 1000);
    const ts = [setTimeout(() => setStep(1), DUEL_T.intro)];
    for (let r = 2; r <= n + 1; r++) ts.push(setTimeout(() => setStep(r), DUEL_T.intro + (r - 1) * DUEL_T.round));
    return () => ts.forEach(clearTimeout);
  }, [d]);
  useEffect(() => {
    if (step >= 1 && step <= n) setTimeout(() => sfx('duelHit'), 380); // 부딪히는 순간
    else if (step === n + 1) { if (!d.winner) sfx('duelLose'); else { const mineWon = (d.winner === d.a ? d.an : d.bn) === pid; sfx(mineWon ? 'duelWin' : 'duelLose'); } }
  }, [step]);
  const g = (name) => Object.values(game.generals).find((x) => x.name === name) || { name, war: 80, lead: 70, intel: 50, pol: 50, traits: [] };
  const cur = step === 0 ? [100, 100] : d.rounds[Math.min(step, n) - 1];
  const prev = step <= 1 ? [100, 100] : d.rounds[Math.min(step, n) - 2];
  const done = step > n;
  const fighting = step >= 1 && !done;
  const dmgA = fighting ? prev[0] - cur[0] : 0, dmgB = fighting ? prev[1] - cur[1] : 0; // a가 받은 피해, b가 받은 피해
  const crit = fighting && Math.max(dmgA, dmgB) >= 30;
  const side = (name, nat, hp, left, dmg) => {
    const gg = g(name);
    const lost = done && d.winner && d.winner !== name, won = done && d.winner === name;
    return (
      <div key={`${name}-${step}`} className={`duel-side ${left ? 'L' : 'R'}${step === 0 ? ' intro' : ''}${fighting ? ' charge' : ''}${lost ? ' lose' : ''}${won ? ' win' : ''}${done && !d.winner ? ' draw' : ''}`}>
        <div className="duel-face" style={{ borderColor: game.nations[nat]?.color || '#fff' }}>
          <img src={portraitURL(gg, game.nations[nat]?.color || '#fff')} alt="" width={120} height={120} />
          {fighting && dmg > 0 && <span className={`duel-dmg${dmg >= 30 ? ' big' : ''}`}>−{dmg}</span>}
        </div>
        <b className="duel-name">{name}</b>
        <small>{game.nations[nat]?.name} · 무력 {gg.war}{(gg.traits || []).filter(([t]) => t === '맹장' || t === '무쌍').map(([t, l]) => ` · ${t}${'ⅠⅡⅢ'[l - 1] || ''}`).join('')}</small>
        <div className="duel-hp"><div style={{ width: `${Math.max(0, hp)}%`, background: hp > 50 ? '#6fd37f' : hp > 25 ? '#f0c24b' : '#e2655a' }} /><span>{Math.max(0, Math.round(hp))}</span></div>
      </div>
    );
  };
  return (
    <div className="duel" onClick={onSkip} title="누르면 건너뜀">
      {/* 흔들림은 안쪽 판에만 (바깥 판의 나타나기 효과가 다시 돌며 깜빡이지 않게) */}
      <div className={`duel-stage${crit ? ' shake' : ''}`} key={`st-${step}`}>
      <div className="duel-title">{step === 0 ? '⚔️ 일기토!' : done ? (d.winner ? '승 부' : '무 승 부') : `제 ${step}합`}</div>
      <div className="duel-row">
        {side(d.a, d.an, cur[0], true, dmgA)}
        <div className={`duel-vs${fighting ? ' clash' : ''}`} key={`vs-${step}`}>{done ? (d.winner ? '🏆' : '🤝') : fighting ? '💥' : 'VS'}</div>
        {side(d.b, d.bn, cur[1], false, dmgB)}
      </div>
      <div className="duel-msg" key={`m-${step}`}>{done ? (d.winner ? `${d.winner}의 승리!${d.fate || ''}` : `무승부!${d.fate || ''}`) : crit ? `회심의 일격! ${dmgA > dmgB ? d.b : d.a}의 큰 한 방!` : fighting ? (dmgA === dmgB ? '팽팽하게 맞섭니다!' : `${dmgA > dmgB ? d.b : d.a}이(가) 몰아붙입니다!`) : `${d.a} 대 ${d.b}`}</div>
      </div>
      <small className="duel-skip">화면을 누르면 건너뜁니다</small>
    </div>
  );
}

// ── 결과 보고서: 순 시작·정산 전·정산 후 세 번 재서 돈·병력·성 변화와 전투 내역을 보여 줌 ──
const tally = (s, pid) => ({
  turn: s.turn,
  gold: s.nations[pid].gold,
  food: s.nations[pid].food,
  troops: s.castles.reduce((a, c) => a + (c.owner === pid ? c.troops : 0), 0) + s.units.reduce((a, u) => a + (u.nation === pid ? u.troops : 0), 0),
  field: s.units.reduce((a, u) => a + (u.nation === pid ? u.troops : 0), 0),
  owned: s.castles.filter((c) => c.owner === pid && c.kind !== 'pass').map((c) => c.id),
});
const xf = (v) => `×${v.toFixed(2)}`;
// 전투 기록을 (공격 부대, 대상)마다 묶음: 며칠 싸웠는지, 서로 입힌 피해, 가장 크게 친 날의 까닭
export function battleRows(s, pid, turn) {
  const m = new Map();
  for (const r of s.btl || []) {
    if (r.turn !== turn) continue;
    const k = r.siege ? `s${r.a}:${r.c}` : `${r.a}:${r.d}`;
    const e = m.get(k) || { ...r, days: 0, dmg: 0, back: 0, wall: 0, best: r };
    e.days++; e.dmg += r.dmg; e.back += r.back; e.wall += r.wall || 0;
    if (r.dmg >= e.best.dmg) e.best = r;
    m.set(k, e);
  }
  return [...m.values()].map((e) => {
    const mine = e.an === pid, b = e.best;
    const why = [];
    if (e.siege) {
      why.push(`능력 ${xf(b.ratio)}`);
      why.push(b.walled ? '성벽이 남아 수비병 피해 ×0.35·반격 ×1.4' : '성벽 무너짐 → 수비병 피해 ×1.8');
      if (b.guard > 1.001) why.push(`수성 특성 ÷${b.guard.toFixed(2)}`);
      if (b.engine) why.push('공성병기(성벽 ×5)');
    } else {
      why.push(`능력(공/방) ${xf(b.ratio)}`);
      if (Math.abs(b.trait - 1) > 0.005) why.push(`특성 ${xf(b.trait)}`);
      why.push(`사기 ${xf(b.morale)}`);
      if (b.tdef > 1.001) why.push(`${TERRAIN_NAME[b.terr] || '지형'} 방어 ÷${b.tdef.toFixed(2)}`);
      if (b.pincer > 1) why.push(`협공 ${xf(b.pincer)}`);
      if (b.tac) why.push(`전법 「${b.tac}」`);
      if (b.extra && Math.abs(b.extra - 1) > 0.01) why.push(b.extra < 1 ? `맞는 쪽 방진·진지 ${xf(b.extra)}` : `맞는 쪽이 공성병기를 끌거나 패주 중 ${xf(b.extra)}`);
    }
    const foeN = s.nations[mine ? e.dn : e.an]?.name || '';
    const title = e.siege
      ? (mine ? `${e.al} 부대 → ${e.cn} 공성` : `${foeN} ${e.al} 부대가 ${e.cn}을(를) 공격`)
      : (mine ? `${e.al} → ${foeN} ${e.dl}` : `${foeN} ${e.al} → 아군 ${e.dl}`);
    // 내 쪽 피해 / 적 피해
    const myLoss = mine ? e.back : e.dmg, foeLoss = mine ? e.dmg : e.back;
    return { title, mine, days: e.days, myLoss, foeLoss, wall: e.wall, why, siege: !!e.siege, win: foeLoss >= myLoss };
  }).sort((a, b) => b.myLoss + b.foeLoss - (a.myLoss + a.foeLoss));
}

// 성 작업 창(출진·징병·병력 받기·내정·시설·야전 시설): 패널 밖(문서 맨 위)에 띄움 — 폰에선 아래에서 올라오는 창
function CModal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-bg cmodal-bg" onClick={onClose}>
      <div className="modal cmodal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="cmodal-head"><b>{title}</b><button className="sm cmodal-x" aria-label="닫기" onClick={onClose}>✕</button></div>
        <div className="cmodal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default function Hex14({ world, game, setGame, onExit }) {
  const grid = useMemo(() => buildGrid(world), [world]);
  const polar = useMemo(() => { const bb = getScenario(world.scenarioId)?.bbox; return !!bb && bb[2] - bb[0] >= 359; }, [world]);
  const pid = game.playerId;
  const me = game.nations[pid];
  const startYear = getScenario(game.scenarioId)?.startYear ?? 200;
  const [sel, setSel] = useState(null); // {type:'castle'|'unit', id}
  const [sortieOpen, setSortieOpen] = useState(false);
  const [genMore, setGenMore] = useState(null); // 장수 더보기를 펼친 성
  const [booted, setBooted] = useState(false); // 처음 지도 그림을 마쳤는지
  const [offerGid, setOfferGid] = useState(null); // 공적 특성 고르기 창 (내 장수)
  const [offerPick, setOfferPick] = useState(null); // 가득 찬 장수가 새 특성을 골랐을 때: 무엇을 잊을지 고르는 단계
  const [cmodal, setCmodal] = useState(null); // 성 작업 창: draft·recv·jobs·build·fort (출진은 sortieOpen)
  const [moreOpen, setMoreOpen] = useState(false); // 폰: 위 막대의 소리·속도·나가기 버튼을 ⋯ 메뉴로 접어 둠
  useEffect(() => { if (!moreOpen) return undefined; const off = (e) => { if (!e.target.closest?.('.tb-btns, .tb-more')) setMoreOpen(false); }; window.addEventListener('pointerdown', off, true); return () => window.removeEventListener('pointerdown', off, true); }, [moreOpen]);
  const [tourOn, setTourOn] = useState(false); // 가이드 투어 (첫 판에 저절로, 도움말에서 다시)
  const [sheetH, setSheetH] = useState(() => { try { return +localStorage.getItem('tw-sheetH') || 40; } catch { return 40; } }); // 폰 바텀시트 높이(vh)
  useEffect(() => { try { localStorage.setItem('tw-sheetH', String(Math.round(sheetH))); } catch { /* 무시 */ } }, [sheetH]);
  const [pickG, setPickG] = useState([]);
  const [amt, setAmt] = useState(0);
  const [draftAmt, setDraftAmt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false); playingRef.current = playing;
  // 날씨(비·눈·바람)·깃발 흔들림 효과 — 끄면 가만히 있을 때 지도를 다시 그리지 않아 배터리·발열이 줄어듦 (이 기기에 저장)
  const [motion, setMotion] = useState(() => pref('motion', true));
  const motionRef = useRef(true); motionRef.current = motion;
  // 군단(위임)은 뺌: 맡겨 두면 징병도 없이 돌진만 해서 쓸모가 없었음 — 예전 저장에 있던 군단은 풀어서 내가 다시 지휘
  useEffect(() => { if (game.corps?.length) setGame((g) => ({ ...g, corps: [], units: g.units.map((u) => (u.corps ? { ...u, corps: undefined } : u)) })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 다른 것을 고르거나 날이 흐르기 시작하면 성 작업 창은 닫음
  useEffect(() => { setCmodal(null); }, [sel?.type, sel?.id, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (playing) setSortieOpen(false); }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  const [peek, setPeek] = useState(false);
  const withSiege = false; // 공성병기는 들판에서 부대로 만듦
  const [stopIdle, setStopIdle] = useState(() => { try { return localStorage.getItem('h14.stopIdle') === '1'; } catch { return false; } }); // 순 끝까지 중 내 부대가 도착하면 멈춤 (기본 끔)
  const [callAmt, setCallAmt] = useState(1000); // 장수 부를 때 데려올 병력
  const [sendGen, setSendGen] = useState(null);
  const [chain, setChain] = useState(false); // 이어서 명령(경유지) 모드
  const [sendFrom, setSendFrom] = useState(null); // 병력 수송: 보내는 성
  const [helpQ, setHelpQ] = useState('');
  const [helpHits, setHelpHits] = useState(0);
  const helpRef = useRef(null);
  useEffect(() => {
    const el = helpRef.current;
    if (!el) return;
    const q = helpQ.trim().toLowerCase();
    let hits = 0;
    for (const li of el.querySelectorAll('li')) { const on = !q || li.textContent.toLowerCase().includes(q); li.hidden = !on; if (on && q) hits++; li.classList.toggle('help-hit', !!q && on); }
    for (const ul of el.querySelectorAll('ul')) ul.hidden = !!q && ![...ul.children].some((c) => !c.hidden);
    setHelpHits(hits);
  });
  const [ransomAsk, setRansomAsk] = useState({}); // 포로별로 부를 몸값
  const [ordersOpen, setOrdersOpen] = useState(() => { try { return localStorage.getItem('h14.orders') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('h14.orders', ordersOpen ? '1' : '0'); } catch { /* 무시 */ } }, [ordersOpen]);
  const [sendAmt, setSendAmt] = useState(5000);
  const [donorsAll, setDonorsAll] = useState(null);
  // 한 번에 진행할 날 수 (1~10일), 이 기기에만 기억
  const [nDays, setNDaysRaw] = useState(() => { try { return Math.max(1, Math.min(10, +localStorage.getItem('h14-ndays') || 1)); } catch { return 1; } });
  const setNDays = (f) => setNDaysRaw((v) => { const n = typeof f === 'function' ? f(v) : f; try { localStorage.setItem('h14-ndays', String(n)); } catch {} return n; });
  const [tip, setTip] = useState(null); // 눌러서 띄운 작은 설명창 {text, x, y, top, el}
  // 설명창: data-tip이 있는 것(특성·전법·?)을 누르면 그 아래에 뜨고, 다시 누르거나 다른 데를 누르면 닫힘 (PC도 누를 때만)
  useEffect(() => {
    const at = (el) => { const r = el.getBoundingClientRect(); return { text: el.dataset.tip, x: r.left + r.width / 2, y: r.bottom, top: r.top, el }; };
    const click = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el && el.dataset.tip) { e.preventDefault(); e.stopPropagation(); setTip((t) => (t?.el === el ? null : at(el))); return; }
      if (!e.target.closest?.('.tip-pop')) setTip(null);
    };
    const key = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.tip) { e.preventDefault(); setTip(at(e.target)); } else if (e.key === 'Escape') setTip(null); };
    const hide = () => setTip(null);
    document.addEventListener('click', click, true); document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('keydown', key); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, []);
  const [aud, setAud] = useState(audioOpt());
  // 처음 누를 때 소리를 켬 (브라우저 규칙)
  useEffect(() => { const on = () => unlockAudio(); window.addEventListener('pointerdown', on, { once: true }); return () => window.removeEventListener('pointerdown', on); }, []);
  const [speed, setSpeed] = useState(420);
  const [toastMsg, setToast] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState('home');
  const [report, setReport] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [gsort, setGsort] = useState('sum'); // 장수 줄 세우기 기준
  const [csort, setCsort] = useState('troops'); // 내 성 목록 줄 세우기
  const [logF, setLogF] = useState('all'); // 기록 거르기
  useEffect(() => { const c = sel?.type === 'castle' ? game.castles[sel.id] : null; if (c && c.owner === pid) setDraftAmt(draftMax14(game, c)); }, [sel?.type, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // PC: 오른쪽 패널 접기 (이 기기에 기억) — 성·부대를 고르면 다시 펼침
  const [panelOff, setPanelOffRaw] = useState(() => { try { return localStorage.getItem('h14-panel-off') === '1'; } catch { return false; } });
  const setPanelOff = (v) => { setPanelOffRaw(v); try { localStorage.setItem('h14-panel-off', v ? '1' : '0'); } catch {} setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };
  const kb = useRef({});
  useEffect(() => { if (sel && panelOff && window.innerWidth > 760) setPanelOff(false); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [jobRecAll, setJobRecAll] = useState(null); // 내정 추천: 펼친 담당 (성:담당)
  const [peopleAll, setPeopleAll] = useState(false), [myGensOpen, setMyGensOpen] = useState(true);
  // 장수 줄 세우기: 능력 합·무·통·지·정·충성
  const GSORT = [['sum', '합'], ['war', '무'], ['lead', '통'], ['intel', '지'], ['pol', '정'], ['loyal', '충']];
  const gsortKey = (k) => (g) => (k === 'sum' ? g.war + g.lead + g.intel + g.pol : k === 'loyal' ? -(g.ruler ? 999 : loyalOf(g)) : g[k]);
  // 할 일 목록: 순이 바뀌면 저절로 열지(이 기기에 기억)
  const [todoOpen, setTodoOpen] = useState(false);
  const [todoAuto, setTodoAutoRaw] = useState(() => { try { return localStorage.getItem('h14-todo-auto') === '1'; } catch { return false; } }); // 기본은 저절로 열지 않음 (버튼만 반짝임)
  const setTodoAuto = (v) => { setTodoAutoRaw(v); try { localStorage.setItem('h14-todo-auto', v ? '1' : '0'); } catch {} };
  const [duel, setDuel] = useState(null);
  const skipDuel = useRef(null);
  const [cutin, setCutin] = useState(null);
  const [placeFort, setPlaceFort] = useState(null); // 성 수비대가 지을 시설 {cid, kind} // 보낼 장수 (지도에서 내 성을 누르면 그리로) // 사신 창을 잠시 접고 그 나라를 지도에서 봄
  const [founding, setFounding] = useState(false); // 새 도시 자리 고르는 중
  const spots = useMemo(() => {
    if (founding) return foundSpots(game, grid, pid);
    if (placeFort) { // 시설 지을 수 있는 칸 (성에서 4칸 안 내 땅)
      const c = game.castles[placeFort.cid], out = [];
      for (let t = 0; t < grid.N; t++) if (grid.dist(t, c.tile) <= 4 && !castleFortCheck(game, grid, c, t, placeFort.kind)) out.push(t);
      return out;
    }
    return null;
  }, [founding, placeFort, game, grid, pid]);
  const spotsRef = useRef(null);
  spotsRef.current = spots;
  const canvas = useRef(null);
  const wrap = useRef(null);
  const view = useRef(null); // {x, y, k}
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const shiftRef = useRef(false);
  const pressT = useRef(null); // 꾹 누르기 타이머 (폰: 경유지 추가)
  const gameRef = useRef(game);
  gameRef.current = game;
  // 게임 화면을 나갈 때 큰 그림(캔버스) 메모리를 바로 돌려줌 (폰 브라우저는 늦게 치워서 다음 판에서 메모리가 모자라 꺼지곤 함)
  useEffect(() => () => {
    const L = land.current, free = (c) => { if (c && c.width !== undefined) { c.width = 0; c.height = 0; } };
    free(L.base?.cv); free(L.base?.rcv); free(L.over); free(L.comp); free(L.snow); free(L.fog);
    for (const t of L.tiles?.values() || []) { free(t.comp); free(t.own); }
    for (const c of Object.values(L.statC || {})) free(c?.cv);
    L.tiles?.clear();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selRef = useRef(sel);
  selRef.current = sel;
  const land = useRef({ key: null, img: null });
  const anim = useRef({ prev: new Map(), t0: 0, dur: 1 }); // 부대 이동 보간
  const fx = useRef([]); // 떠오르는 글자 {x, y, text, color, size, t0, life}
  const raf = useRef(0);
  const ambT = useRef(0); // 느린 다시 그리기 타이머

  const toast = (m) => { setToast(fixJosa(m)); setTimeout(() => setToast(null), 2200); };
  const unitById = (id) => game.units.find((u) => u.id === id);
  const selUnit = sel?.type === 'unit' ? unitById(sel.id) : null;
  const selCastle = sel?.type === 'castle' ? game.castles[sel.id] : null;
  const selFort = sel?.type === 'fort' ? (game.forts || []).find((f) => f.id === sel.id) : null;

  // ── 그리기 ──
  const draw = () => {
    const cv = canvas.current, el = wrap.current, s = gameRef.current, sl = selRef.current;
    if (!cv || !el) return;
    const now = performance.now();
    const cw = el.clientWidth, ch = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, isPhone() ? 2 : 3);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    if (!view.current) {
      // 처음엔 내 수도 쪽을 크게
      const k = Math.max(cw / grid.W, ch / grid.H) * 2;
      const cap = s.castles.find((c) => c.owner === pid && c.capital) || s.castles.find((c) => c.owner === pid);
      const [x, y] = cap ? grid.center(cap.tile) : [grid.W / 2, grid.H / 2];
      view.current = { k, x: x - cw / k / 2, y: y - ch / k / 2 };
    }
    // 땅 그림: 주인 배열이 바뀌었을 때만 새로
    // 처음 지도 그림은 큰 지도에서 몇 초 걸리므로 로딩 화면을 먼저 보여 준 뒤 그림
    if (!land.current.base) {
      if (!land.current.booting) { land.current.booting = true; setTimeout(() => { const t0 = performance.now(); land.current.base = bakeRivers(paintTerrain(grid, world)); land.current.paintMs = Math.round(performance.now() - t0); warmAI(gameRef.current, grid); warmWeather(grid); setBooted(true); }, 40); }
      return;
    }
    if (land.current.ref !== s.owner) {
      // 날마다 새 상태가 와도 실제로 바뀐 칸이 없으면 아무것도 다시 그리지 않음.
      // 조금 바뀌면 그 구역만 영토 그림·합친 그림·확대 조각에서 고침 (예전엔 날마다 큰 그림 세 장을 통째로 다시 합치고 확대 조각도 버렸음 → 날 바뀔 때 끊김)
      const L = land.current, prev = L.prev;
      const dPrev = L.dprev, dSame = dPrev && dPrev.length === s.district.length && s.district.every((v, i) => v === dPrev[i]);
      const full = () => { L.ownVer = (L.ownVer || 0) + 1; if (L.over) { L.over.width = 0; L.over.height = 0; } L.over = paintOwners(grid, s, L.base.sc * OWN_SC); for (const t of L.tiles?.values() || []) t.stale = true; };
      if (!prev || !dSame || !L.over) full();
      else {
        const changed = [];
        for (let i = 0; i < grid.N; i++) if (prev[i] !== s.owner[i]) changed.push(i);
        if (changed.length > grid.N * 0.2) full();
        else if (changed.length) {
          const sc = L.base.sc, B0 = L.base;
          const rects = repaintOwners(grid, s, L.over, sc * OWN_SC, changed);
          const v0 = L.ownVer || 0; L.ownVer = v0 + 1;
          // 확대 그림 타일: 바뀐 구역에 걸린 타일만 '다시 그릴 것'으로 표시 (새로 그릴 때까지는 옛 그림을 보여 줌)
          for (const t of L.tiles?.values() || []) if (rects.some((r) => r.x1 > t.x && r.x0 < t.x + t.w && r.y1 > t.y && r.y0 < t.y + t.h)) t.stale = true;
        }
      }
      land.current.prev = Int16Array.from(s.owner);
      land.current.dprev = Int32Array.from(s.district);
      land.current.ref = s.owner;
    }
    // 둥근 세계 지도: 화면 x를 한 바퀴 안으로 감고, 화면 오른쪽이 지도 끝을 넘으면 지도를 한 번 더 이어 그림
    if (grid.wrap) view.current.x = ((view.current.x % grid.period) + grid.period) % grid.period;
    // 세계 지도는 위·아래 끝 너머로 너무 멀리 끌려가지 않게 (북극 위 빈 하늘이 일자 띠로 보이지 않게)
    if (grid.wrap) view.current.k = Math.max(view.current.k, ch / grid.H); // 세계 지도는 위아래가 화면을 꽉 채우는 데까지만 축소
    if (grid.wrap) { const vh = ch / view.current.k; view.current.y = vh >= grid.H ? (grid.H - vh) / 2 : Math.max(0, Math.min(grid.H - vh, view.current.y)); }
    const { k, y: vy } = view.current;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch); // 바닥색은 캔버스 CSS 배경 (매 그림마다 화면 전체를 칠하지 않게)
    // 선명한 확대 그림: 지도를 작은 타일(512점)로 나눠, 보이는 타일만 쉬는 틈에 하나씩 그려 두고 다시 씀
    // (예전엔 화면 크기 조각을 한 번에 0.3~0.6초 들여 그려서, 끌다가 조각 밖으로 나가면 흐렸다가 멈칫하며 선명해졌음)
    const TL = (() => {
      const L = land.current, B0 = L.base, want = k * dpr, vx0 = view.current.x, vw = cw / k, vh = ch / k;
      const need = want > B0.sc * 1.6 && !(grid.wrap && vx0 + vw > grid.period);
      if (!need) { if (L.tileQ) L.tileQ.list = []; return null; } // 축소하면 남은 확대 조각 그리기를 멈춤 (예전엔 안 보이는 조각을 계속 그려 축소가 끊겼음)
      L.tiles = L.tiles || new Map();
      const lv = Math.round(Math.log2(want / B0.sc) * 2) / 2, sc = Math.min(B0.sc * 2 ** lv, 12), TW = 512 / sc; // 배율은 √2 단계로 (확대 중 조금씩 바뀔 때마다 새로 그리지 않게)
      const tx0 = Math.floor(vx0 / TW), tx1 = Math.floor((vx0 + vw) / TW), ty0 = Math.max(0, Math.floor(vy / TW)), ty1 = Math.floor((vy + vh) / TW);
      const vis = [], want2 = []; let needN = 0; // needN: 지금 화면+둘레에 필요한 조각 수 (이보다 적게 남기면 버렸다 다시 그리기를 끝없이 되풀이함)
      const frame = (L.frame = (L.frame || 0) + 1);
      for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        if (tx < 0 || ty < 0 || tx * TW > grid.W || ty * TW > grid.H) continue;
        needN++;
        const key = `${lv}|${tx}|${ty}`, t = L.tiles.get(key), inView = tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1;
        if (inView) vis.push(key);
        if (t) t.used = frame;
        // 날이 넘어가는 동안(진행 중)엔 땅 주인이 바뀐 타일을 매일 새로 그리지 않고 옛 그림을 씀 — 진행이 멈추면 한 번에 고침 (느린 폰에서 하루하루가 끊기지 않게)
        if (!t || t.stale) want2.push({ key, tx, ty, inView, d: Math.hypot(tx - (tx0 + tx1) / 2, ty - (ty0 + ty1) / 2) });
      }
      // 그릴 차례: 화면 안 → 가운데 가까운 순, 옛 그림이 있는 것보다 없는 것 먼저
      want2.sort((a, b) => (b.inView - a.inView) || (!!L.tiles.get(a.key) - !!L.tiles.get(b.key)) || a.d - b.d);
      L.tileQ = { list: want2, lv, sc, TW }; L.tileNeed = needN;
      if (want2.length && !L.tileT) {
        L.tileT = setTimeout(function pump() {
          L.tileT = null;
          const Q = L.tileQ; if (!Q || !Q.list.length) return;
          // 조각 하나 그릴 때마다 화면 전체를 다시 그리지 않고 다음 화면 갱신 때 한 번만
          const pumpDraw = () => { if (!L.pumpRaf) L.pumpRaf = requestAnimationFrame(() => { L.pumpRaf = 0; draw(); }); };
          // 손가락으로 끌거나 확대하는 동안엔 조각을 그리지 않음 (조각 하나 그리는 데 폰에서 0.1~0.4초 — 그동안 화면이 멈춰 뚝뚝 끊겼음)
          if (pointers.current.size || performance.now() - (L.gestureT || 0) < 220) { L.tileT = setTimeout(pump, 150); return; }
          // 타일마다 가장자리를 4점씩 더 그려 이웃 타일과 겹치게 함: 딱 맞대면 점 아래 자리에서 맞닿아 바탕색 실선이 비쳐 보임
          const pad = 4 / Q.sc;
          const job = Q.list.shift(), r = { x: job.tx * Q.TW - pad, y: job.ty * Q.TW - pad, w: Q.TW + pad * 2, h: Q.TW + pad * 2, sc: Q.sc };
          const s2 = gameRef.current;
          // 영토 그림: 타일마다 따로 둠 → 땅 주인이 바뀌면 이것만 다시 그림 (지형은 그대로 — 예전엔 지형까지 통째로 다시 그려 느렸음)
          const ownLayer = (old) => { const oc = old || document.createElement('canvas'); oc.width = Math.ceil(r.w * r.sc); oc.height = Math.ceil(r.h * r.sc); const ox = oc.getContext('2d'); ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, oc.width, oc.height); ox.scale(r.sc, r.sc); ox.translate(-r.x, -r.y); drawOwnerTiles(grid, s2, ox, tilesIn(grid, r, grid.size * 3)); return oc; };
          const oldT = L.tiles.get(job.key);
          if (oldT && oldT.comp && oldT.own) { ownLayer(oldT.own); oldT.stale = false; oldT.used = L.frame || 0; pumpDraw(); if (Q.list.length) L.tileT = setTimeout(pump, Q.list[0].slow ? 120 : 0); return; }
          const T = paintTerrain(grid, world, r);
          const cx3 = T.cv.getContext('2d'); cx3.setTransform(1, 0, 0, 1, 0, 0); cx3.drawImage(T.rcv, 0, 0); T.rcv.width = 0; T.rcv.height = 0; // 강은 지형에 합침
          if (oldT?.comp && oldT.comp !== T.cv) { oldT.comp.width = 0; oldT.comp.height = 0; } if (oldT?.own) { oldT.own.width = 0; oldT.own.height = 0; }
          L.tiles.set(job.key, { ...r, comp: T.cv, own: ownLayer(null), used: L.frame || 0, stale: false });
          // 너무 많이 쌓이면 오래 안 본 것부터 버림 (타일 하나 약 1MB)
          const MAXT = Math.max(isPhone() ? 24 : 72, (L.tileNeed || 0) + 6); if (L.tiles.size > MAXT) { const old = [...L.tiles].sort((a, b) => a[1].used - b[1].used).slice(0, L.tiles.size - MAXT); for (const [k2] of old) { const o3 = L.tiles.get(k2)?.own; if (o3) { o3.width = 0; o3.height = 0; } const c3 = L.tiles.get(k2)?.comp; if (c3) { c3.width = 0; c3.height = 0; } L.tiles.delete(k2); } }
          pumpDraw();
          if (Q.list.length) L.tileT = setTimeout(pump, 0);
        }, 0);
      }
      const all = vis.every((key) => { const t = L.tiles.get(key); return t && (!t.stale || !!t.own); });
      // 확대·축소 직후 새 배율 타일이 아직 없으면: 이웃 배율에서 그려 둔 타일을 늘이거나 줄여 먼저 보여 줌 (흐린 전체 지도 대신)
      const fallback = [];
      const gest = pointers.current.size > 0 || performance.now() - (L.gestureT || 0) < 220;
      if (!all && !gest) for (const l2 of [lv - 0.5, lv + 0.5, lv - 1, lv + 1]) {
        const TW2 = 512 / Math.min(B0.sc * 2 ** l2, 12);
        for (let ty = Math.max(0, Math.floor(vy / TW2)); ty <= Math.floor((vy + vh) / TW2); ty++) for (let tx = Math.floor(vx0 / TW2); tx <= Math.floor((vx0 + vw) / TW2); tx++) { const t = L.tiles.get(`${l2}|${tx}|${ty}`); if (t) fallback.push(t); }
      }
      L.lastFallback = all ? 1 : fallback.length;
      return { vis, all, fallback };
    })();
    const passes = [view.current.x];
    if (grid.wrap) for (let n = 1; view.current.x + cw / k > n * grid.period; n++) passes.push(view.current.x - n * grid.period);
    // 세계 지도: 지도 위쪽 바깥도 북극 얼음으로 이어 그림 (화면 폭 전체, 한 번만)
    if (polar) { ctx.fillStyle = '#e6eef2'; ctx.fillRect(0, 0, cw, Math.max(0, (grid.size * 4 - vy) * k)); }
    let f = 1;
    for (const vx of passes) f = scene(vx);
    function scene(vx) {
    ctx.setTransform(dpr * k, 0, 0, dpr * k, -vx * k * dpr, -vy * k * dpr);
    ctx.imageSmoothingEnabled = true;
    const B = land.current.base;
    // 세계 지도: 지도 위쪽 바깥도 북극 얼음으로 이어 그림 (잘린 끝처럼 안 보이게)
    // 큰 바탕 그림은 화면에 보이는 부분만 잘라서 그림 (통째로 그리면 세계판에서 매 장면 수천만 화소를 옮김)
    const vx1 = vx + cw / k, vy1 = vy + ch / k;
    const blit = (img, sc) => {
      if (!img) return;
      const x0 = Math.max(0, vx - 2), y0 = Math.max(0, vy - 2), x1 = Math.min(img.width / sc, vx1 + 2), y1 = Math.min(img.height / sc, vy1 + 2);
      if (x1 <= x0 || y1 <= y0) return;
      ctx.drawImage(img, x0 * sc, y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc, x0, y0, x1 - x0, y1 - y0);
    };
    // 선명한 타일이 화면을 다 덮으면 흐린 바탕은 그릴 필요 없음
    const chCovers = !!TL && TL.all;
    // 지형(강 포함) 바탕 위에 영토 색(절반 해상도)을 겹쳐 그림 — 합친 그림을 따로 두지 않아 메모리를 아낌
    if (!chCovers) { blit(B.cv, B.sc); blit(land.current.over, B.sc * OWN_SC); }
    // 크게 확대했을 때: 보이는 부분만 화면 배율로 다시 그린 선명한 조각을 덮어 그림 (흐릿하게 늘어나지 않게)
    if (TL) { const dt2 = (t) => { ctx.drawImage(t.comp, t.x, t.y, t.w, t.h); if (t.own) ctx.drawImage(t.own, t.x, t.y, t.w, t.h); }; for (const t of TL.fallback) dt2(t); for (const key of TL.vis) { const t = land.current.tiles.get(key); if (t) dt2(t); } }
    // 지역 지도 가장자리: 땅이 칼로 자른 듯 끊기지 않게 안개처럼 바다색으로 흐려지게
    if (!polar) {
      const m = grid.size * 5, W = grid.W, Hh = grid.H, sea = 'rgba(26,64,100,';
      // 화면에 보이는 부분만 칠함 (예전엔 매 장면 지도 전체 길이를 그러데이션으로 칠해 그림 시간의 20%를 썼음 — 프로파일)
      const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
        const ax = Math.max(rx, vx - 2), ay = Math.max(ry, vy - 2), bx = Math.min(rx + rw, vx1 + 2), by = Math.min(ry + rh, vy1 + 2);
        if (bx <= ax || by <= ay) return; // 화면 밖이면 건너뜀
        const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, sea + '1)'); g.addColorStop(1, sea + '0)'); ctx.fillStyle = g; ctx.fillRect(ax, ay, bx - ax, by - ay);
      };
      edge(0, 0, 0, m, 0, 0, W, m);
      edge(0, Hh, 0, Hh - m, 0, Hh - m, W, m);
      edge(0, 0, m, 0, 0, 0, m, Hh);
      edge(W, 0, W - m, 0, W - m, 0, m, Hh);
    }
    // 날씨 칠: 눈 오는 구역의 땅은 하얗게, 비 오는 구역은 푸르스름하게 어둡게 (순마다, 바탕 그림이 바뀌면 다시 만듦)
    if ((s.wx || [s.weather?.kind]).some((x) => x === 'snow' || x === 'rain')) {
      const key = `${s.turn}`;
      if (!land.current.snow || land.current.snowKey !== key) {
        // 칸 하나 = 작은 그림의 점 두 개(홀수 줄은 반 칸 밀림)로 날씨를 찍고, 지도 크기로 부드럽게 늘려 그림
        // (예전엔 칸 수만 개를 하나하나 칠해 순이 바뀔 때마다 0.5초쯤 멈췄음). 늘리면서 경계도 자연스럽게 번짐
        const tw = grid.cols * 2 + 1, th = grid.rows;
        const tiny = land.current.snow?.width === tw ? land.current.snow : Object.assign(document.createElement('canvas'), { width: tw, height: th });
        const tctx = tiny.getContext('2d'), img = tctx.createImageData(tw, th), d = img.data;
        for (let i = 0; i < grid.N; i++) {
          if (!grid.passable(i)) continue;
          const sn = weatherShare(s, grid, i, 'snow'), rn = sn ? 0 : weatherShare(s, grid, i, 'rain');
          if (!sn && !rn) continue;
          const c = i % grid.cols, r = (i / grid.cols) | 0, px = c * 2 + (r & 1);
          const [R, G, Bl, A] = sn ? [255, 255, 255, sn * 255] : [30, 48, 80, rn * 0.55 * 255];
          for (const x of [px, px + 1]) { const o = (r * tw + x) * 4; d[o] = R; d[o + 1] = G; d[o + 2] = Bl; d[o + 3] = A; }
        }
        tctx.putImageData(img, 0, 0);
        land.current.snow = tiny; land.current.snowKey = key;
      }
      ctx.globalAlpha = 0.42;
      { const hw = grid.size * Math.sqrt(3); ctx.drawImage(land.current.snow, 0, grid.size * 0.25, (land.current.snow.width * hw) / 2, land.current.snow.height * grid.size * 1.5); }
      ctx.globalAlpha = 1;
    }
    // 안개: 「지도 전체 공개」를 끄면 지금 보이는 곳 말고는 어둡게 (한 번 본 곳은 옅게, 처음 보는 곳은 짙게)
    if (fogOn(s)) {
      if (!land.current.fog || land.current.fogS !== s) {
        const tw = grid.cols * 2 + 1, th = grid.rows, sight = sightOf(s, grid), seen = s.seen;
        const tiny = land.current.fog?.width === tw ? land.current.fog : Object.assign(document.createElement('canvas'), { width: tw, height: th });
        const tctx = tiny.getContext('2d'), img = tctx.createImageData(tw, th), d = img.data;
        for (let i = 0; i < grid.N; i++) {
          if (sight[i]) continue;
          const c = i % grid.cols, r = (i / grid.cols) | 0, px0 = c * 2 + (r & 1), A = seen && seen[i] ? 110 : 215;
          for (const x of [px0, px0 + 1]) { const o = (r * tw + x) * 4; d[o] = 12; d[o + 1] = 16; d[o + 2] = 24; d[o + 3] = A; }
        }
        tctx.putImageData(img, 0, 0);
        land.current.fog = tiny; land.current.fogS = s;
      }
      const hw = grid.size * Math.sqrt(3), fw = (land.current.fog.width * hw) / 2, fh = land.current.fog.height * grid.size * 1.5;
      ctx.drawImage(land.current.fog, 0, grid.size * 0.25, fw, fh);
      if (grid.wrap) ctx.drawImage(land.current.fog, grid.period, grid.size * 0.25, fw, fh);
    }
    // 고른 도시의 관할 땅: 옅게 칠하고, 아직 내 것이 아닌 칸은 빗금처럼 진하게
    if (sl?.type === 'castle' && s.castles[sl.id]) {
      const c = s.castles[sl.id], tiles = districtTiles(s)[c.id] || [];
      for (const t of tiles) {
        const [hx, hy] = grid.center(t);
        ctx.beginPath();
        for (let d = 0; d < 6; d++) { const [qx, qy] = corner(hx, hy, grid.size * 0.98, d); if (d) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); }
        ctx.fillStyle = s.owner[t] === c.owner && c.owner !== null ? 'rgba(255,255,255,0.28)' : 'rgba(255,60,60,0.30)';
        ctx.fill();
      }
    }
    const sz = grid.size;
    const px = 1 / k; // 화면 1픽셀
    const x0 = vx - sz * 4, x1 = vx + cw / k + sz * 4, y0 = vy - sz * 4, y1 = vy + ch / k + sz * 4;
    const vis = (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
    // 부대 위치 (하루 사이를 미끄러지듯)
    const a = anim.current;
    const f = Math.min(1, (now - a.t0) / a.dur);
    // 둥근 지도: 이음매 건너편 점은 가까운 쪽으로 펴서 그림 (선이 지도를 가로지르지 않게)
    const ux = (x, ref) => (grid.wrap ? x + Math.round((ref - x) / grid.period) * grid.period : x);
    const ease = a.linear ? f : f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    const posOf = (u) => {
      const [tx, ty] = grid.center(u.tile);
      const p = a.prev.get(u.id);
      if (p === undefined || p === u.tile) return [tx, ty];
      const [fx1, fy0] = grid.center(p), fx0 = ux(fx1, tx);
      return [fx0 + (tx - fx0) * ease, fy0 + (ty - fy0) * ease];
    };
    // 새 도시 세울 수 있는 칸
    if (spotsRef.current) {
      ctx.fillStyle = `rgba(80,230,120,${0.35 + 0.15 * Math.sin(now / 250)})`;
      for (const t of spotsRef.current) { const [hx, hy] = grid.center(t); if (!vis(hx, hy)) continue; ctx.beginPath(); for (let d = 0; d < 6; d++) { const [qx, qy] = corner(hx, hy, sz * 0.9, d); if (d) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); } ctx.fill(); }
    }
    // 내 부대 도착 예정일 (진로 끝)
    const etaOf = (u) => Math.ceil(u.path.reduce((a, t, i) => a + Math.min(3, moveCost(grid, i ? u.path[i - 1] : u.tile, t, s, u)), 0) / Math.max(0.05, speedOf(s, u)));
    const etas = [];
    for (const u of s.units) if (u.nation === pid && u.path.length > 1) etas.push([u.path[u.path.length - 1], etaOf(u)]);
    // 내 부대 진로
    for (const u of s.units) {
      if (u.nation !== pid || !u.path.length) continue;
      const on = sl?.type === 'unit' && sl.id === u.id;
      ctx.strokeStyle = on ? '#ffe066' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = Math.max(sz * 0.18, 2 * px);
      ctx.setLineDash([sz * 0.45, sz * 0.3]);
      ctx.beginPath();
      const [sx, sy] = posOf(u);
      ctx.moveTo(sx, sy);
      let lx = sx;
      for (const t of u.path) { const [qx0, qy] = grid.center(t), qx = ux(qx0, lx); ctx.lineTo(qx, qy); lx = qx; }
      ctx.stroke();
      ctx.setLineDash([]);
      const ex = lx, ey = grid.center(u.path[u.path.length - 1])[1];
      ctx.fillStyle = on ? '#ffe066' : 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(ex, ey, sz * 0.35, 0, 7); ctx.fill();
      // 경유지: 다음 목표들을 점선과 번호로
      if (u.queue?.length) {
        const tileOf = (q) => (q.kind === 'tile' ? q.id : q.kind === 'castle' ? s.castles[q.id]?.tile : q.kind === 'fort' ? (s.forts || []).find((f) => f.id === q.id)?.tile : s.units.find((x) => x.id === q.id)?.tile);
        let [px0, py0] = [ex, ey];
        ctx.strokeStyle = on ? 'rgba(255,224,102,0.8)' : 'rgba(255,255,255,0.45)';
        ctx.setLineDash([sz * 0.2, sz * 0.3]);
        u.queue.forEach((q, i) => {
          const t = tileOf(q);
          if (t === undefined || t === null) return;
          const [qx0, qy] = grid.center(t), qx = ux(qx0, px0);
          ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(qx, qy); ctx.stroke();
          ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(qx, qy, sz * 0.55, 0, 7); ctx.fill();
          ctx.fillStyle = '#222'; ctx.font = `bold ${sz * 0.75}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), qx, qy + sz * 0.03);
          [px0, py0] = [qx, qy];
        });
        ctx.setLineDash([]); ctx.textBaseline = 'alphabetic';
      }
    }
    // 수송 중인 병력: 출발 성에서 도착 성까지 진행만큼 수레
    for (const v of s.convoys || []) {
      if (v.nation !== pid) continue;
      const [ax, ay] = grid.center(s.castles[v.from].tile), [bx0, by] = grid.center(s.castles[v.to].tile), bx = ux(bx0, ax);
      const f = Math.max(0, Math.min(1, (absDay(s) - v.start) / Math.max(1, v.arrive - v.start)));
      ctx.strokeStyle = 'rgba(180,230,140,0.5)'; ctx.lineWidth = Math.max(sz * 0.12, px); ctx.setLineDash([sz * 0.2, sz * 0.25]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `${sz * 1.2}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🚚', ax + (bx - ax) * f, ay + (by - ay) * f);
    }
    // ── 성·이름판·야전 시설: 화면이 그대로면(하루 움직임 그림 동안) 한 번 그려 둔 겹을 다시 씀 ──
    // 프로파일: 하루 진행 애니메이션 중 매 장면(초당 60번) 성 200여 개의 그림·성벽 막대·이름판을 새로 그려 그림 시간의 대부분을 차지했음
    const FOG = fogOn(s), HIDE = troopsHidden(s), SIGHT = FOG || HIDE ? sightOf(s, grid) : null, SEEN = s.seen;
    const known = (t) => !FOG || SIGHT[t] || (SEEN && SEEN[t]);
    const numOf = (owner, t, v) => (SIGHT && owner !== pid && !SIGHT[t] ? '?' : fmtTroops(v));
    const fs = Math.min(Math.max(sz * 0.9, 11 * px), 15 * px);
    const drawStatic = (ctx) => {
    // 도시·관문
    const labelJobs = [];
    if (!land.current.gap || land.current.gapN !== s.castles.length) { land.current.gap = s.castles.map((c) => Math.min(9, ...s.castles.filter((d) => d !== c).map((d) => grid.dist(c.tile, d.tile)))); land.current.gapN = s.castles.length; }
    const castleGap = land.current.gap;
    for (const c of s.castles) {
      const [cx, cy] = grid.center(c.tile);
      if (!vis(cx, cy)) continue;
      if (c.owner !== pid && !known(c.tile)) continue; // 안개 속 아직 못 본 성
      const col = ownerColor(s, c.owner);
      const on = sl?.type === 'castle' && sl.id === c.id;
      // 도시·관문 그림 (나라 색 깃발), 바닥이 칸 아래쪽에 오게
      // 성 그림 크기: 이웃 성이 가까우면(세계판 중원처럼 2~3칸) 그만큼 작게 그려 서로 겹치지 않게
      const S = sz * (c.kind === 'pass' ? 4.2 : c.capital ? 5.6 : 4.6) * Math.max(0.42, Math.min(1, ((castleGap[c.id] ?? 5) * 1.15) / 4.6));
      const baseY = cy + sz * 0.7;
      if (on) { ctx.fillStyle = 'rgba(255,224,102,0.45)'; ctx.beginPath(); ctx.ellipse(cx, baseY - sz * 0.2, S * 0.55, S * 0.2, 0, 0, 7); ctx.fill(); }
      if (c.founding) ctx.globalAlpha = 0.45;
      ctx.drawImage(citySprite(c.kind, c.capital, col), cx - S / 2, baseY - S * 0.8, S, S);
      ctx.globalAlpha = 1;
      if (c.founding || c.build) {
        // 공사 중: 비계와 망치
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = Math.max(sz * 0.12, px);
        if (c.founding) for (let q = -2; q <= 2; q++) { ctx.beginPath(); ctx.moveTo(cx + q * S * 0.15, baseY); ctx.lineTo(cx + q * S * 0.15, baseY - S * 0.45); ctx.stroke(); }
        ctx.font = `bold ${Math.max(sz * 1.2, 12 * px)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('🔨', cx + S * 0.38, baseY - S * 0.5);
      }
      if (c.kind !== 'pass' || c.dur < c.maxDur) {
        ctx.fillStyle = 'rgba(40,0,0,0.85)';
        ctx.fillRect(cx - S * 0.32, baseY + sz * 0.1, S * 0.64, sz * 0.28);
        ctx.fillStyle = '#e8c35a';
        ctx.fillRect(cx - S * 0.32, baseY + sz * 0.1, S * 0.64 * Math.max(0, c.dur / c.maxDur), sz * 0.28);
      }
      // 이름판: 바로 그리지 않고 모아 두었다가, 중요한 것부터 겹치지 않게 그림 (멀리서 볼 때 이름표가 뒤엉키지 않게)
      if (k * sz > 2.2 || c.capital) labelJobs.push({ c, cx, cy, col, S, pri: on ? 0 : c.capital ? 1 : c.owner === pid ? 2 : c.owner !== null && c.owner >= 0 ? 3 : 4 });
    }
    // 이름판 그리기: 선택 > 도읍 > 내 성 > 나라 성 > 주인 없는 성 순, 앞의 것과 겹치면 생략 (멀리서 볼 땐 주인 없는 성 이름은 숨김)
    const placed = []; // 성 이름판 자리 (부대 이름표와 함께 겹침 검사)
    {
      labelJobs.sort((a, b) => a.pri - b.pri);
      for (const { c, cx, cy, col, S, pri } of labelJobs) {
        if (pri === 4 && k * sz < 3.2) continue;
        const label = `${c.capital ? '♛' : ''}${c.port ? '⚓' : ''}${c.name}${c.founding ? ` (공사 ${c.founding}순)` : ''}`;
        // 확대했을 때만 병력을 이름 옆에 한 줄로 (예전엔 이름 아래 두 줄이라 겹침이 많았음)
        const showN = k * sz > 4.5, num = showN ? numOf(c.owner, c.tile, c.troops) : '';
        ctx.font = `bold ${fs}px sans-serif`;
        const nw = textW(label, fs);
        ctx.font = `bold ${fs * 0.82}px sans-serif`;
        const tw2 = showN ? textW(num, fs * 0.82) + fs * 0.4 : 0;
        const tw = nw + tw2 + fs * 0.6;
        const ly = cy + sz * 0.7 + sz * 0.38 + fs * 0.95; // 성벽 막대 바로 아래 (크게 확대해도 이름이 성에서 멀어지지 않게)
        const bh = fs * 1.25;
        if (pri > 0 && placed.some(([x, y, w, h]) => Math.abs(x - cx) * 2 < w + tw && y < ly - fs * 0.85 + bh && ly - fs * 0.85 < y + h)) continue;
        placed.push([cx, ly - fs * 0.85, tw, bh]);
        const x0 = cx - tw / 2;
        ctx.fillStyle = 'rgba(20,16,12,0.84)';
        ctx.beginPath(); ctx.roundRect(x0, ly - fs * 0.85, tw, fs * 1.2, fs * 0.25); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(x0, ly - fs * 0.85, fs * 0.22, fs * 1.2);
        ctx.textAlign = 'left';
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x0 + fs * 0.35, ly + fs * 0.12);
        if (showN) {
          ctx.font = `bold ${fs * 0.82}px sans-serif`;
          ctx.fillStyle = c.owner === pid ? '#bff0b0' : '#ffe9a8';
          ctx.fillText(num, x0 + fs * 0.35 + nw + fs * 0.4, ly + fs * 0.1);
        }
        ctx.textAlign = 'center';
      }
    }
    // 야전 시설 (진지·망루·목책)
    for (const f of s.forts || []) {
      const [cx, cy] = grid.center(f.tile);
      if (!vis(cx, cy)) continue;
      const col = ownerColor(s, f.owner);
      const on = sl?.type === 'fort' && sl.id === f.id;
      ctx.globalAlpha = f.left > 0 ? 0.5 : 1;
      ctx.lineWidth = Math.max(sz * 0.08, px);
      ctx.strokeStyle = '#3a2412';
      if (f.kind === 'camp') {
        ctx.fillStyle = '#8a5a2b';
        for (let q = 0; q < 10; q++) { const a = (q / 10) * Math.PI * 2; const x = cx + Math.cos(a) * sz * 0.85, y = cy + Math.sin(a) * sz * 0.55; ctx.fillRect(x - sz * 0.07, y - sz * 0.45, sz * 0.14, sz * 0.45); }
        for (const dx of [-0.35, 0.3]) { ctx.beginPath(); ctx.moveTo(cx + dx * sz - sz * 0.3, cy + sz * 0.1); ctx.lineTo(cx + dx * sz, cy - sz * 0.45); ctx.lineTo(cx + dx * sz + sz * 0.3, cy + sz * 0.1); ctx.closePath(); ctx.fillStyle = '#efe6d2'; ctx.fill(); ctx.stroke(); }
      } else if (f.kind === 'tower') {
        ctx.fillStyle = '#7a4b22';
        ctx.fillRect(cx - sz * 0.45, cy - sz * 1.3, sz * 0.12, sz * 1.5); ctx.fillRect(cx + sz * 0.33, cy - sz * 1.3, sz * 0.12, sz * 1.5);
        ctx.beginPath(); ctx.moveTo(cx - sz * 0.4, cy); ctx.lineTo(cx + sz * 0.4, cy - sz * 1.1); ctx.moveTo(cx + sz * 0.4, cy); ctx.lineTo(cx - sz * 0.4, cy - sz * 1.1); ctx.stroke();
        ctx.fillStyle = '#a06a35'; ctx.fillRect(cx - sz * 0.6, cy - sz * 1.55, sz * 1.2, sz * 0.32); ctx.strokeRect(cx - sz * 0.6, cy - sz * 1.55, sz * 1.2, sz * 0.32);
        ctx.beginPath(); ctx.moveTo(cx - sz * 0.75, cy - sz * 1.55); ctx.lineTo(cx, cy - sz * 2.1); ctx.lineTo(cx + sz * 0.75, cy - sz * 1.55); ctx.closePath(); ctx.fillStyle = '#4c5866'; ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#8a5a2b';
        for (let q = -3; q <= 3; q++) { const x = cx + q * sz * 0.26; ctx.beginPath(); ctx.moveTo(x - sz * 0.1, cy + sz * 0.3); ctx.lineTo(x - sz * 0.1, cy - sz * 0.4); ctx.lineTo(x, cy - sz * 0.65); ctx.lineTo(x + sz * 0.1, cy - sz * 0.4); ctx.lineTo(x + sz * 0.1, cy + sz * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        ctx.fillRect(cx - sz * 0.95, cy - sz * 0.1, sz * 1.9, sz * 0.1);
      }
      // 나라 깃발
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(cx + sz * 0.7, cy - sz * 1.3, sz * 0.08, sz * 1.2);
      ctx.fillStyle = col; ctx.fillRect(cx + sz * 0.78, cy - sz * 1.3, sz * 0.5, sz * 0.35);
      ctx.globalAlpha = 1;
      if (f.left > 0) { ctx.font = `${Math.max(sz * 0.9, 10 * px)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🔨', cx, cy - sz * 1.4); }
      if (f.hp < f.maxHp) { ctx.fillStyle = '#300'; ctx.fillRect(cx - sz * 0.8, cy + sz * 0.45, sz * 1.6, sz * 0.2); ctx.fillStyle = '#e8c35a'; ctx.fillRect(cx - sz * 0.8, cy + sz * 0.45, sz * 1.6 * Math.max(0, f.hp / f.maxHp), sz * 0.2); }
      if (on) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = Math.max(sz * 0.2, 2 * px); ctx.beginPath(); ctx.arc(cx, cy - sz * 0.4, sz * 1.3, 0, 7); ctx.stroke(); }
    }
    return placed;
    };
    let placed;
    {
      const L = land.current;
      const vkey = `${vx}|${vy}|${k}|${cw}|${ch}|${dpr}`;
      const skey = `${vkey}|${sl?.type}:${sl?.id}`;
      L.statLast = L.statLast || {};
      const steady = L.statLast[vx] === vkey; // 앞 장면과 화면이 같을 때만 겹을 씀 (끌거나 확대하는 중엔 바로 그림)
      L.statLast[vx] = vkey;
      L.statC = L.statC || {};
      // 화면을 옮길 때마다 위치별로 겹 그림이 하나씩 쌓이던 것(메모리 새는 곳): 이번 장면에 안 쓴 겹은 치우고, 크기가 같으면 그 그림을 다시 씀
      const nowT = performance.now(); L.statT = L.statT || {}; L.statT[vx] = nowT;
      let spare = null;
      for (const key of Object.keys(L.statC)) {
        if (key === String(vx) || L.statT[key] > nowT - 40) continue;
        const old = L.statC[key]?.cv;
        if (old && !spare && old.width === Math.round(cw * dpr) && old.height === Math.round(ch * dpr)) spare = old; else if (old) { old.width = 0; old.height = 0; }
        delete L.statC[key]; delete L.statT[key]; delete L.statLast[key];
      }
      const C = L.statC[vx];
      if (steady && C && C.key === skey && C.s === s) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(C.cv, 0, 0); ctx.restore();
        placed = C.placed;
      } else if (steady) {
        const cv2 = C?.cv && C.cv.width === Math.round(cw * dpr) && C.cv.height === Math.round(ch * dpr) ? C.cv : spare || Object.assign(document.createElement('canvas'), { width: Math.round(cw * dpr), height: Math.round(ch * dpr) });
        if (C?.cv && C.cv !== cv2) { C.cv.width = 0; C.cv.height = 0; }
        const o = cv2.getContext('2d');
        o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, cv2.width, cv2.height);
        o.setTransform(dpr * k, 0, 0, dpr * k, -vx * k * dpr, -vy * k * dpr);
        o.imageSmoothingEnabled = true;
        placed = drawStatic(o);
        L.statC[vx] = { cv: cv2, key: skey, s, placed };
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv2, 0, 0); ctx.restore();
      } else placed = drawStatic(ctx);
    }
    // 망루 화살
    for (const e of s.fx || []) {
      if (e.type !== 'arrow') continue;
      const [ax, ay] = grid.center(e.a), [bx0, by] = grid.center(e.b), bx = ux(bx0, ax);
      ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = Math.max(sz * 0.08, px); ctx.setLineDash([sz * 0.25, sz * 0.2]);
      ctx.beginPath(); ctx.moveTo(ax, ay - sz * 1.5); ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - sz * 3, bx, by); ctx.stroke(); ctx.setLineDash([]);
    }
    // 교전 표시 (칼 엇갈림)
    for (const e of s.fx || []) {
      if (e.type !== 'clash') continue;
      const [ax, ay] = grid.center(e.a), [bx, by] = grid.center(e.b);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (!vis(mx, my)) continue;
      if (FOG && !SIGHT[e.a] && !SIGHT[e.b]) continue;
      const pulse = 0.7 + 0.3 * Math.sin(now / 90);
      ctx.strokeStyle = `rgba(255,${Math.round(80 + 80 * pulse)},60,0.95)`;
      ctx.lineWidth = sz * 0.22;
      const r = sz * 0.55 * pulse;
      ctx.beginPath(); ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx + r, my - r); ctx.lineTo(mx - r, my + r); ctx.stroke();
    }
    // 부대 깃발 (이름표는 겹치면 하나만)
    const labels = [];
    const sorted = s.units.slice().sort((a, b) => (sl?.type === 'unit' && sl.id === a.id ? -1 : sl?.type === 'unit' && sl.id === b.id ? 1 : b.troops - a.troops));
    for (const u of sorted) {
      const [cx, cy] = posOf(u);
      if (!vis(cx, cy)) continue;
      if (FOG && u.nation !== pid && !SIGHT[u.tile]) continue; // 안개 속 적 부대는 안 보임
      ctx.globalAlpha = u.transfer ? 0.7 : 1; // 장수 옮기는 부대는 옅게
      const n = s.nations[u.nation];
      const on = sl?.type === 'unit' && sl.id === u.id;
      const g = gensOf(s, u.gens)[0];
      const fw = sz * 1.7, fh = sz * 1.35, top = cy - sz * 3.1;
      // 그림자 받침
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx, cy + sz * 0.5, sz * 0.95, sz * 0.4, 0, 0, 7); ctx.fill();
      // 깃대와 나라 깃발 (군주 성씨 한 글자, 펄럭임)
      const fx0 = cx - sz * 0.25;
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(fx0 - sz * 0.08, top, sz * 0.14, sz * 3.2);
      const wave = motionRef.current ? Math.sin(now / 260 + u.id) * sz * 0.12 : 0;
      ctx.beginPath();
      ctx.moveTo(fx0, top);
      ctx.lineTo(fx0 + fw, top + wave);
      ctx.lineTo(fx0 + fw, top + fh + wave);
      ctx.lineTo(fx0, top + fh);
      ctx.closePath();
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.lineWidth = Math.max(sz * 0.1, px);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.font = `bold ${sz * 1.0}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = sz * 0.16;
      const mark = u.outlaw ? ({ 도적: '도', 산적: '산', 비적: '비', 해적: '해' })[u.outlaw] || '도' : n.name[0];
      ctx.strokeText(mark, fx0 + fw / 2, top + fh * 0.75 + wave / 2);
      ctx.fillText(mark, fx0 + fw / 2, top + fh * 0.75 + wave / 2);
      // 물 위면 배
      if (grid.sea[u.tile]) {
        ctx.fillStyle = '#6b4423';
        ctx.beginPath(); ctx.moveTo(cx - sz * 1.4, cy - sz * 0.1); ctx.lineTo(cx + sz * 1.4, cy - sz * 0.1); ctx.lineTo(cx + sz * 1.0, cy + sz * 0.55); ctx.lineTo(cx - sz * 1.0, cy + sz * 0.55); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#3a2412'; ctx.lineWidth = sz * 0.1; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = sz * 0.08; ctx.beginPath(); ctx.moveTo(cx - sz * 1.6, cy + sz * 0.6); ctx.quadraticCurveTo(cx, cy + sz * 0.9, cx + sz * 1.6, cy + sz * 0.6); ctx.stroke();
      }
      // 대장 초상 (장수마다 다른 얼굴)
      const pr = sz * 1.05;
      if (g) ctx.drawImage(portraitCanvas(g, n.color), cx - pr, cy - sz * 0.55 - pr, pr * 2, pr * 2);
      if (u.transfer) { // 옮기는 중 배지: 초상 오른쪽 위 파란 동그라미에 화살표
        const r = sz * 0.55, bx = cx + pr * 0.95, by = cy - sz * 0.55 - pr * 0.8;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fillStyle = '#3d7bd9'; ctx.fill(); ctx.lineWidth = Math.max(sz * 0.08, px); ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.font = `bold ${sz * 0.8}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('➜', bx, by + sz * 0.28);
      }
      if (on || u.cut) { ctx.beginPath(); ctx.arc(cx, cy - sz * 0.55, pr + sz * 0.12, 0, 7); ctx.lineWidth = Math.max(sz * 0.22, 2 * px); ctx.strokeStyle = on ? '#ffe066' : '#ff7a3c'; ctx.stroke(); }
      // 공성병기를 끌고 다니는 부대: 초상 왼쪽 아래에 투석기
      if (u.siege) {
        // 동그란 배지 안에 투석기 (바퀴 달린 받침 + 던지는 팔 + 돌)
        const r = sz * 0.62, bx = cx - pr * 1.05, by = cy + sz * 0.2;
        ctx.save();
        ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fillStyle = '#f4e6c4'; ctx.fill();
        ctx.lineWidth = Math.max(sz * 0.12, 1.5 * px); ctx.strokeStyle = n.color; ctx.stroke();
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#5a3416'; ctx.lineWidth = Math.max(sz * 0.11, px);
        ctx.beginPath(); ctx.moveTo(bx - r * 0.6, by + r * 0.3); ctx.lineTo(bx + r * 0.6, by + r * 0.3); ctx.stroke(); // 받침
        ctx.beginPath(); ctx.moveTo(bx - r * 0.1, by + r * 0.3); ctx.lineTo(bx + r * 0.15, by - r * 0.15); ctx.stroke(); // 기둥
        ctx.beginPath(); ctx.moveTo(bx + r * 0.5, by + r * 0.15); ctx.lineTo(bx - r * 0.45, by - r * 0.55); ctx.stroke(); // 팔
        ctx.fillStyle = '#7d7d7d'; ctx.beginPath(); ctx.arc(bx - r * 0.5, by - r * 0.6, r * 0.2, 0, 7); ctx.fill(); // 돌
        ctx.fillStyle = '#3a220d'; for (const dx of [-0.38, 0.38]) { ctx.beginPath(); ctx.arc(bx + dx * r, by + r * 0.45, r * 0.17, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      // 쉬고 있는 내 부대 (명령 없음): 💤
      if (u.nation === pid && !u.path.length && !u.queue?.length && !(u.order?.kind === 'castle' && s.castles[u.order.id]?.owner !== pid && grid.dist(u.tile, s.castles[u.order.id].tile) <= 1)) { ctx.font = `${sz * 0.8}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('💤', cx + pr * 1.05, cy - sz * 0.55 - pr * 0.7); }
      if (u.gens.length > 1) { ctx.font = `bold ${sz * 0.6}px sans-serif`; ctx.fillStyle = '#ffe066'; ctx.strokeStyle = '#111'; ctx.lineWidth = sz * 0.12; const t = `+${u.gens.length - 1}`; ctx.strokeText(t, cx + pr * 0.95, cy - sz * 0.55 + pr * 0.9); ctx.fillText(t, cx + pr * 0.95, cy - sz * 0.55 + pr * 0.9); }
      // 병력·사기 막대
      const bw = sz * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw, sz * 0.5);
      ctx.fillStyle = '#6fd37f';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw * Math.min(1, u.troops / u.max), sz * 0.25);
      ctx.fillStyle = '#5fb0ff';
      if (!u.outlaw) ctx.fillRect(cx - bw / 2, cy + sz * 1.0, bw * Math.min(1, u.morale / 100), sz * 0.25); // 도적은 사기 막대 없음
      const mineU = u.nation === pid;
      const lab = mineU || on || k * sz > 7 ? `${g?.name || ''} ${numOf(u.nation, u.tile, u.troops)}` : numOf(u.nation, u.tile, u.troops);
      ctx.font = `bold ${fs * 0.78}px sans-serif`;
      const lw = textW(lab, fs * 0.78) + fs * 0.4, lh = fs, ly0 = top - fs * 1.05;
      const hitC = placed.some(([x, y, w, h]) => Math.abs(x - cx) * 2 < w + lw && y < ly0 + lh && ly0 < y + h);
      const free = on || (!labels.some(([lx, ly, w]) => Math.abs(lx - cx) * 2 < (w || lw) + lw && Math.abs(ly - top) < lh) && (mineU || !hitC));
      if (k * sz > 4.5 && free) {
        labels.push([cx, top, lw]);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = fs * 0.22;
        ctx.fillStyle = '#fff';
        ctx.strokeText(lab, cx, top - fs * 0.35);
        ctx.fillText(lab, cx, top - fs * 0.35);
      }
    }
    ctx.globalAlpha = 1;
    // 소식 고리: 함락·위협·전멸 자리에 3초 동안 퍼지는 고리
    if (pulses.current.length) {
      const nowP = performance.now();
      pulses.current = pulses.current.filter((q) => nowP - q.t0 < 3000);
      for (const q of pulses.current) {
        const [px1, py1] = grid.center(q.tile), a = (nowP - q.t0) / 3000;
        for (const ph of [0, 0.33]) { const t = (a * 2 + ph) % 1; ctx.globalAlpha = (1 - t) * (1 - a * 0.5); ctx.strokeStyle = q.col; ctx.lineWidth = Math.max(sz * 0.25, 3 * px); ctx.beginPath(); ctx.arc(px1, py1, sz * (1.2 + t * 4), 0, 7); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    // 진로 끝 도착 예정일 꼬리표
    {
      const fs = Math.max(11 * px, sz * 0.75);
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      for (const [t, d] of etas) {
        const [ex, ey] = grid.center(t);
        if (!vis(ex, ey)) continue;
        const lab = `${d}일`, w = ctx.measureText(lab).width + fs * 0.8, y = ey - sz * 1.3;
        ctx.fillStyle = 'rgba(20,24,32,0.85)';
        ctx.beginPath(); ctx.roundRect(ex - w / 2, y - fs * 0.75, w, fs * 1.3, fs * 0.4); ctx.fill();
        ctx.fillStyle = '#ffe066'; ctx.fillText(lab, ex, y + fs * 0.3);
      }
    }
    // 떠오르는 글자 (피해·전법·함락)
    fx.current = fx.current.filter((e) => now - e.t0 < e.life);
    for (const e of fx.current) {
      const p = (now - e.t0) / e.life;
      if (!vis(e.x, e.y)) continue;
      const size = Math.max(e.size * sz, e.min * px);
      ctx.globalAlpha = p < 0.75 ? 1 : (1 - p) / 0.25;
      ctx.font = `900 ${size * (e.pop ? 1 + 0.25 * Math.max(0, 1 - p * 5) : 1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = e.color;
      const y = e.y - p * sz * e.rise;
      ctx.strokeText(e.text, e.x, y);
      ctx.fillText(e.text, e.x, y);
      ctx.globalAlpha = 1;
    }
    return f;
    }
    // 화면 가장자리 어둡게: CSS 겹 그림(.map-vignette)으로 — 예전엔 매 그림마다 화면 전체에 그러데이션을 칠했음 (프로파일에서 그림 시간의 큰 몫)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 날씨 효과 (화면 기준): 비 줄기·눈송이·바람
    // 날씨 효과는 화면 가운데 구역 날씨로
    const wk = (() => { const v = view.current; if (!v || !s.wx) return s.weather?.kind; let x = v.x + cw / v.k / 2; if (grid.wrap) x = ((x % grid.period) + grid.period) % grid.period; const t = pixelToCell(grid.size, grid.cols, grid.rows, x, v.y + ch / v.k / 2); return t >= 0 ? weatherAt(s, grid, t) : s.weather?.kind; })();
    if (motionRef.current && (wk === 'rain' || wk === 'snow' || wk === 'wind')) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = wk === 'rain' ? 90 : wk === 'snow' ? 70 : 24;
      for (let q = 0; q < n; q++) {
        const sp = wk === 'rain' ? 0.9 : wk === 'snow' ? 0.06 : 0.5;
        const x0 = (q * 97.13) % cw, y0 = (q * 57.7) % ch;
        if (wk === 'rain') { const y = (y0 + now * sp) % ch, x = (x0 - (now * sp) * 0.25) % cw; ctx.strokeStyle = 'rgba(190,210,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo((x + cw) % cw, y); ctx.lineTo(((x + cw) % cw) - 4, y + 12); ctx.stroke(); }
        else if (wk === 'snow') { const y = (y0 + now * sp) % ch, x = (x0 + Math.sin(now / 900 + q) * 12 + cw) % cw; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(x, y, 1.6 + (q % 3) * 0.6, 0, 7); ctx.fill(); }
        else { const x = (x0 + now * sp) % cw; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + 20, y0 - 5, x + 40, y0); ctx.stroke(); }
      }
    }
    // 움직임이 있을 때(부대 이동·글자·충돌)는 매 프레임, 가만히 있는 부대 깃발·날씨만 있을 땐 초당 약 12번만 다시 그림 (가만히 있어도 화면을 쉼 없이 그리지 않게)
    const lively = !!spotsRef.current || f < 1 || fx.current.length || pulses.current.length || (s.fx || []).some((e) => e.type === 'clash' || e.type === 'arrow');
    const ambient = !lively && motionRef.current && (wk === 'rain' || wk === 'snow' || wk === 'wind' || s.units.length);
    const busy = lively || ambient;
    cancelAnimationFrame(raf.current); clearTimeout(ambT.current);
    // 아주 느린 폰에서만 장면 사이를 조금 쉼 (계산할 틈) — 부드러움이 먼저라 그림 시간의 절반만, 최대 0.06초
    const LC = land.current, dt = performance.now() - now;
    LC.drawAvg = LC.drawAvg ? LC.drawAvg * 0.8 + dt * 0.2 : dt;
    LC.frames = (LC.frames || 0) + 1; LC.drawSum = (LC.drawSum || 0) + dt;
    const rest = LC.drawAvg > 24 ? Math.min(60, LC.drawAvg * 0.5) : 0;
    // 군주들이 생각하는 동안엔 지도를 멈춰 둠 (끊겨 보이지 않고, 계산도 빨라짐) — 다 끝나면 다시 움직임
    if (thinkingRef.current && playingRef.current) return;
    if (lively) { if (rest) ambT.current = setTimeout(() => { raf.current = requestAnimationFrame(draw); }, rest); else raf.current = requestAnimationFrame(draw); }
    else if (busy) ambT.current = setTimeout(() => { raf.current = requestAnimationFrame(draw); }, Math.max(80, rest));
  };
  // 화면(React)이 다시 그려질 때마다 지도를 통째로 다시 그리지 않고, 다음 프레임에 한 번만 (생각 중 표시처럼 자주 바뀌는 것 때문에 큰 지도를 수십 번 그리던 것 막음)
  const drawQ = useRef(0);
  useEffect(() => { if (drawQ.current) return; drawQ.current = requestAnimationFrame(() => { drawQ.current = 0; draw(); }); });
  // Esc: 선택·새 도시 자리 고르기 취소
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSel(null); setFounding(false); setSortieOpen(false); setSendGen(null); setSendFrom(null); setChain(false); setPlaceFort(null); return; }
      // PC 단축키 (글 쓰는 칸·확인 창에서는 안 먹음)
      const tg = e.target, k = kb.current;
      if (e.ctrlKey || e.metaKey || e.altKey || (tg && /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) || document.querySelector('.modal-bg')) return;
      if (e.code === 'Space') { e.preventDefault(); k.run?.(e.shiftKey ? true : k.nDays); return; }
      if (/^[1-5]$/.test(e.key)) { const t = ['home', 'diplo', 'people', 'log', 'help'][+e.key - 1]; setSel(null); setTab(t); k.openPanel?.(); return; }
      if (e.key === 't' || e.key === 'T' || e.key === 'ㅅ') { k.todo?.(); return; }
      if (e.key === 'p' || e.key === 'P' || e.key === 'ㅔ') { k.panel?.(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 자동 시험용: 부대·도시의 화면 좌표
  useEffect(() => {
    window.__h14 = {
      perf: () => { const L = land.current; const r = { frames: L.frames || 0, drawMs: Math.round(L.drawSum || 0), avg: Math.round(L.drawAvg || 0) }; L.frames = 0; L.drawSum = 0; return r; },
      chunk: () => { const L = land.current; const Q = L.tileQ; return { ok: !!Q && Q.list.filter((x) => x.inView).length === 0, fb: (L.lastFallback || 0) > 0, tiles: L.tiles?.size || 0, queued: Q?.list.length || 0 }; },
      probe: (lon, lat) => { const [x, y] = world.geo.toPx(lon, lat); const t = pixelToCell(grid.size, grid.cols, grid.rows, x, y); return { t, terrain: grid.terrain[t], pass: grid.passable(t), N: grid.N, cols: grid.cols, W: world.W, H: world.H, wc: world.cols, wr: world.rows }; },
      screenOf: (tile, up = 0) => { const r = wrap.current.getBoundingClientRect(), v = view.current, [x0, y] = grid.center(tile), x = grid.wrap && x0 < v.x ? x0 + grid.period : x0; return [r.left + (x - v.x) * v.k, r.top + (y - grid.size * up - v.y) * v.k]; },
      spots: () => spotsRef.current || [],
      castles: () => gameRef.current.castles.map((c) => ({ id: c.id, tile: c.tile, name: c.name, owner: c.owner, troops: c.troops, kind: c.kind, dur: c.dur, building: !!c.build, founding: !!c.founding })),
      units: () => gameRef.current.units.map((u) => ({ id: u.id, tile: u.tile, nation: u.nation, name: gensOf(gameRef.current, u.gens)[0]?.name, troops: u.troops, order: u.order?.kind || null, target: u.order?.id ?? null, moving: u.path.length > 0, dest: u.path[u.path.length - 1] ?? null })),
      dist: (a, b) => grid.dist(a, b),
      nb: (t) => grid.nb[t].filter((x) => grid.passable(x)),
      focus: (tile) => { const el = wrap.current, v = view.current; if (!el || !v) return; const [x, y] = grid.center(tile); v.x = x - el.clientWidth / v.k / 2; v.y = y - el.clientHeight / v.k / 2; draw(); },
      state: () => { const g = gameRef.current; return { turn: g.turn, day: g.day, gold: g.nations[pid].gold, food: g.nations[pid].food, alive: g.nations[pid].alive, over: g.over, pid, cities: g.castles.filter((c) => c.owner === pid).length, total: g.castles.filter((c) => c.kind !== 'pass').length, pacts: (g.pacts || []).filter((p) => p.until > g.turn && (p.a === pid || p.b === pid)).map((p) => (p.a === pid ? p.b : p.a)) }; },
      game: () => gameRef.current,
      meritTest: async (gid) => { const M = await import('../game/hex14merit.js'); return act((s) => { const g = s.generals[gid]; for (let k = 0; k < 6 && !(s.traitOffers || []).some((o) => o.gid === gid); k++) { g.merit = M.nextMerit(g) ?? 1e9; M.meritTurn(s); } return { ok: true, offers: (s.traitOffers || []).length, traits: g.traits.map(M.traitName).join(','), lv: g.meritLv }; }); }, // 시험용: 공적을 채워 특성 제안 띄우기
      showDuel: (d) => setDuel(d), // 시험용: 일기토 장면 띄우기
      paintMs: () => land.current.paintMs,
      canvasParts: () => { const L = land.current, mb = (c) => Math.round(((c?.width || 0) * (c?.height || 0) * 4) / 1e5) / 10; return { base: mb(L.base?.cv), river: mb(L.base?.rcv), owners: mb(L.over), comp: mb(L.comp), screen: mb(canvas.current), tiles: Math.round([...(L.tiles?.values() || [])].reduce((a, t) => a + mb(t.comp) + mb(t.own), 0)), maxCv: Math.max(L.base?.cv?.width || 0, L.base?.cv?.height || 0), tileN: L.tiles?.size || 0, stat: Math.round(Object.values(L.statC || {}).reduce((a, c) => a + mb(c?.cv), 0)), snow: mb(L.snow), fog: mb(L.fog), baseSize: `${L.base?.cv?.width}x${L.base?.cv?.height}` }; },
      canvasMB: () => { const L = land.current, px = (c) => (c?.width || 0) * (c?.height || 0); let t = px(L.base?.cv) + px(L.base?.rcv) + px(L.over) + px(L.comp) + px(canvas.current); for (const x of L.tiles?.values() || []) t += px(x.comp) + px(x.own); for (const c of Object.values(L.statC || {})) t += px(c?.cv); return Math.round((t * 4) / 1e6); }, // 시험용: 지도 그림 메모리(MB) // 시험용: 처음 지도 그림에 걸린 시간
      sfx: (k) => sfx(k),
      mood: (m) => { setMood(m); setMood(m); },
      grid: () => grid,
      // 자동 시험용: 화면 버튼과 같은 명령을 함수로 (fn(s, grid, api))
      act: (fn) => { const s = clone(gameRef.current); const r = fn(s, grid, { sortie, order, draft14, draftMax14, sendTroops, startFort, castleFortCheck, propose, gift, renewPact, summonGeneral, adoptPolicy, buildSiege, commandCap, enemy, powerOf, relOf, pactOf, acceptChance, startBuild, canBuild, unitStats, nearestCastle, askProtection, demandVassal, urgeSurrender, surrenderChance, trade, recruit, rewardAll, autoJobs }); if (!(r && r.ok === false)) { gameRef.current = s; setGame(s); } return JSON.parse(JSON.stringify(r ?? null, (k, v) => (k === 'unit' ? v?.id : v))); },
      gensAt: (cid) => Object.values(gameRef.current.generals).filter((g) => g.castle === cid && g.status === 'active').length,
    };
  });
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(ambT.current); }, []);
  useEffect(() => {
    const onR = () => draw();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  });

  // 하루 결과의 효과를 떠오르는 글자로
  const spawnFx = (s) => {
    const now = performance.now();
    const fogS = fogOn(s) ? sightOf(s, grid) : null;
    for (const e of s.fx || []) {
      if (e.type === 'clash') continue;
      if (fogS && !fogS[e.tile] && e.nation !== pid) continue; // 안개 속 싸움은 글자도 안 띄움
      const [x, y] = grid.center(e.tile);
      const jit = (Math.random() - 0.5) * grid.size;
      if (e.type === 'hit' && e.amt >= 30) fx.current.push({ x: x + jit, y: y - grid.size * 2.6, text: `-${e.amt.toLocaleString()}`, color: e.wall ? '#ffd27a' : '#ff6b5a', size: 0.85, min: 11, t0: now, life: 1100, rise: 2 });
      if (e.type === 'tactic') fx.current.push({ x, y: y - grid.size * 4, text: e.text, color: e.text === '협공!' ? '#ff9f43' : e.unique ? '#ff7ad9' : '#ffe066', size: e.unique ? 1.6 : 1.3, min: e.unique ? 18 : 15, t0: now, life: e.unique ? 2000 : 1600, rise: 1.5, pop: true });
      if (e.type === 'capture') fx.current.push({ x, y: y - grid.size * 3, text: `🏯 ${e.text}!`, color: '#fff', size: 1.8, min: 18, t0: now, life: 2200, rise: 1, pop: true });
    }
  };

  // ── 화면 이동·확대·누르기 ──
  const toWorld = (px, py) => {
    const r = wrap.current.getBoundingClientRect(), v = view.current;
    const x = v.x + (px - r.left) / v.k;
    return [grid.wrap ? ((x % grid.period) + grid.period) % grid.period : x, v.y + (py - r.top) / v.k];
  };
  // 손가락 움직임마다 바로 그리지 않고 다음 화면 갱신 때 한 번만 그림 (두 손가락이면 움직임이 두 배로 와서 같은 장면을 두 번 그렸음)
  const gq = useRef(0);
  const drawSoon = () => { land.current.gestureT = performance.now(); if (gq.current) return; gq.current = requestAnimationFrame(() => { gq.current = 0; draw(); }); };
  const onDown = (e) => {
    if (e.target !== canvas.current) return; // 지도 위 버튼은 지도 누르기로 치지 않음
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) { const [[ax, ay], [bx, by]] = [...pointers.current.values()]; drag.current = { pinch: Math.hypot(ax - bx, ay - by), k: view.current.k, moved: true }; return; }
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
    clearTimeout(pressT.current);
    const sl = selRef.current, g0 = gameRef.current;
    if (sl?.type === 'unit' && g0.units.some((u) => u.id === sl.id && u.nation === pid)) {
      const d0 = drag.current, x0 = e.clientX, y0 = e.clientY;
      pressT.current = setTimeout(() => {
        if (drag.current !== d0 || d0.moved || pointers.current.size !== 1) return;
        d0.long = true; // 손을 떼도 보통 누르기로 치지 않음
        shiftRef.current = true;
        try { navigator.vibrate?.(30); } catch {}
        tap(x0, y0);
        shiftRef.current = false;
      }, 450);
    }
  };
  const onMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const d = drag.current;
    if (!d) return;
    if (d.pinch && pointers.current.size >= 2) {
      const [[ax, ay], [bx, by]] = [...pointers.current.values()];
      zoomAt((ax + bx) / 2, (ay + by) / 2, (d.k * Math.hypot(ax - bx, ay - by)) / d.pinch / view.current.k);
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    clearTimeout(pressT.current);
    view.current.x = d.vx - dx / view.current.k;
    view.current.y = d.vy - dy / view.current.k;
    drawSoon();
  };
  const onUp = (e) => {
    shiftRef.current = !!e.shiftKey; // PC: Shift+클릭은 경유지 추가
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    drag.current = null;
    clearTimeout(pressT.current);
    if (d && !d.moved && !d.pinch && !d.long) tap(e.clientX, e.clientY);
    else if (d && !pointers.current.size) setTimeout(() => draw(), 240); // 손을 떼면 선명한 조각 그리기를 다시 시작
  };
  const zoomAt = (px, py, f) => {
    const v = view.current;
    const [wx, wy] = toWorld(px, py);
    const nk = Math.max(0.5, grid.wrap ? wrap.current.clientHeight / grid.H : 0, Math.min(14, v.k * f));
    const r = wrap.current.getBoundingClientRect();
    v.k = nk; v.x = wx - (px - r.left) / nk; v.y = wy - (py - r.top) / nk;
    drawSoon();
  };
  const onWheel = (e) => zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);

  const act = (fn) => {
    const s = clone(game);
    const r = fn(s);
    if (r && r.ok === false) { toast(r.msg); return r; }
    setGame(s);
    sfx('click');
    if (r?.msg) toast(r.msg);
    return r;
  };

  // 누른 곳 근처의 부대·도시 (깃발과 성은 칸보다 크게 그려지므로 넉넉히)
  const pick = (wx, wy) => {
    // 깃발은 칸 위쪽에 그려지므로 칸 중심~깃발 사이를 기준으로, 멀리서 볼 때도 손가락 크기만큼은 잡히게
    const minR = 16 / (view.current?.k || 1);
    // 부대 칸이 아닌 옆 칸을 누르면 그 칸이 잡히도록, 그때는 깃발 바로 위만 부대로 봄
    const t = pixelToCell(grid.size, grid.cols, grid.rows, wx, wy);
    const wide = Math.max(grid.size * 1.8, minR) ** 2, tight = Math.max(grid.size * 0.75, minR * 0.6) ** 2;
    let bu = null, du = wide;
    for (const u of game.units) {
      if (u.transfer && u.nation === pid) continue; // 장수 옮기는 중인 내 부대는 누를 수 없음 (그 아래 땅·성이 눌림)
      const [x, y] = grid.center(u.tile);
      const d = Math.min((x - wx) ** 2 + (y - grid.size * 1.4 - wy) ** 2, (x - wx) ** 2 + (y - wy) ** 2);
      if (d < du && (u.tile === t || d < tight)) { du = d; bu = u; }
    }
    let bc = null, dc = Math.max(grid.size * 2, minR) ** 2;
    for (const c of game.castles) { const [x, y] = grid.center(c.tile); const d = (x - wx) ** 2 + (y - wy) ** 2; if (d < dc && (c.tile === t || d < Math.max(grid.size * 1.1, minR * 0.6) ** 2)) { dc = d; bc = c; } }
    // 성 그림이 크므로 성 안쪽을 누르면 근처 부대보다 성을 우선
    if (bc && (!bu || dc * 0.5 < du)) return { type: 'castle', o: bc };
    if (bu) return { type: 'unit', o: bu };
    let bf = null, df = Math.max(grid.size * 1.3, minR) ** 2;
    for (const f of game.forts || []) { const [x, y] = grid.center(f.tile); const d = (x - wx) ** 2 + (y - grid.size * 0.6 - wy) ** 2; if (d < df) { df = d; bf = f; } }
    return bf ? { type: 'fort', o: bf } : null;
  };

  const tap = (px, py) => {
    if (playing) return;
    const [wx, wy] = toWorld(px, py);
    const t = pixelToCell(grid.size, grid.cols, grid.rows, wx, wy);
    if (founding) {
      const why = foundCheck(game, grid, t, pid);
      if (why) return toast(why);
      act((s) => foundCity(s, grid, t, pid)); // 이름은 가까운 성 이름으로 자동 (샌드박스에서는 이름 입력 창이 막힘)
      setFounding(false);
      return;
    }
    const hit = pick(wx, wy);
    // 성 주변 시설 자리
    if (placeFort) {
      const why = castleFortCheck(game, grid, game.castles[placeFort.cid], t, placeFort.kind);
      if (why) return toast(why);
      const pf = placeFort;
      setPlaceFort(null);
      act((s) => { const r = startFort(s, grid, null, pf.kind, t, pid); r.msg = `${FORTS[pf.kind].icon} ${FORTS[pf.kind].name}: ${s.castles[pf.cid].name} 수비대가 짓습니다 (${FORTS[pf.kind].days}일)`; return r; });
      return;
    }
    // 병력 수송: 내 성을 누르면 그리로
    if (sendFrom !== null) {
      const to = hit?.type === 'castle' ? hit.o : null;
      if (!to || to.owner !== pid || to.id === sendFrom) return toast('받을 곳은 내 다른 성이어야 합니다. 취소하려면 ✕');
      const from = sendFrom;
      setSendFrom(null);
      act((s) => sendTroops(s, grid, from, to.id, sendAmt));
      return;
    }
    // 장수 보내기: 내 성을 누르면 그리로 행군
    if (sendGen) {
      const to = hit?.type === 'castle' ? hit.o : null;
      if (!to || to.owner !== pid) return toast('보낼 곳은 내 성이어야 합니다. 취소하려면 ✕');
      const gid = sendGen;
      setSendGen(null);
      act((s) => { const g = s.generals[gid]; if (!g || g.castle === null || g.castle === undefined) return { ok: false, msg: '보낼 수 없는 장수입니다.' }; return summonGeneral(s, grid, gid, to.id, Math.min(callAmt, s.castles[g.castle].troops - 500)); });
      return;
    }
    const u = hit?.type === 'unit' ? hit.o : null;
    const c = hit?.type === 'castle' ? hit.o : null;
    const fo = hit?.type === 'fort' ? hit.o : null;
    // 내 부대를 고른 상태에서 적 시설을 누르면 부수러 감
    if (selUnit && selUnit.nation === pid && fo && fo.owner !== pid) {
      if (!enemy(game, pid, fo.owner)) return toast('약조를 맺은 나라의 시설입니다.');
      act((s) => { const su = s.units.find((x) => x.id === selUnit.id); const r = (chain || shiftRef.current) ? queueOrder(s, grid, su, 'fort', fo.id) : orderNew(s, grid, su, 'fort', fo.id); if (r.ok && !r.msg) r.msg = `${FORTS[fo.kind].name} 부수러 감`; return r; });
      return;
    }
    // 내 부대를 고른 상태: 누른 곳으로 명령
    if (selUnit && selUnit.nation === pid && !(u && u.nation === pid)) {
      const kind = u ? 'unit' : c ? 'castle' : 'tile';
      // 얕은 바다(뭍 가까이)는 누구나, 깊은 바다는 항구에서 나온 수군만 갈 수 있음
      if (kind === 'tile' && (t < 0 || !(grid.passable(t) || grid.water[t] || (selUnit.navy && grid.sea[t])))) return toast(grid.sea?.[t] ? '깊은 바다는 항구에서 나온 수군만 갈 수 있습니다.' : '갈 수 없는 곳입니다 (외지·험산).');
      const id = u ? u.id : c ? c.id : t;
      const other = u ? u.nation : c && c.owner !== pid ? c.owner : null;
      if (other !== null && other !== undefined && !enemy(game, pid, other)) return toast(`${game.nations[other].name}과(와)는 ${PACT[pactOf(game, pid, other).type]} 중이라 칠 수 없습니다.`);
      act((s) => {
        const su = s.units.find((x) => x.id === selUnit.id);
        // 「이어서 명령」을 켜면 지금 명령 뒤에 경유지로 붙음
        const r = (chain || shiftRef.current) ? queueOrder(s, grid, su, kind, id) : orderNew(s, grid, su, kind, id);
        if (r.ok && !r.msg) r.msg = kind === 'unit' ? `${gensOf(s, su.gens)[0].name} → 적 부대 공격` : kind === 'castle' ? (c.owner === pid ? `${c.name}에 입성` : `${c.name} 공략`) : '이동';
        return r;
      });
      return;
    }
    if (u) { setSel({ type: 'unit', id: u.id }); setSortieOpen(false); setSheet(u.nation !== pid); return; }
    if (c) { setSel({ type: 'castle', id: c.id }); setSortieOpen(false); setSheet(true); return; }
    if (fo) { setSel({ type: 'fort', id: fo.id }); setSheet(true); return; }
    setSel(null);
    setSheet(false);
  };

  // ── 진행: 하루씩(기본) 또는 순(10일) 끝까지. 순의 첫날에 컴퓨터가 명령을 내리고, 순이 끝나면 정산 ──
  // 하루 계산(화면과 상관없는 부분): 컴퓨터 판단 → 하루 진행. s를 그 자리에서 바꿈.
  // 나라 하나씩 잘게 나눠 하고 그 사이 화면에 쉴 틈을 줌 (계산하는 동안에도 지도를 끌 수 있고, 「○○ 생각 중」을 보여 줌). 부르는 순서·내용은 예전과 같아 결과도 같음
  const yieldNow = () => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
  const stepComputeAsync = async (s, first, onStep, alive = () => true) => {
    const jobs = [];
    const ai = (nid, scope, daily) => jobs.push([nid, () => aiTurn14(s, grid, nid, scope, daily)]);
    if (first && s.day === 0) {
      for (const n of s.nations) if (n.alive && !n.outlaw && n.id !== pid) ai(n.id, null, false);
      if (s.spectator && s.nations[pid].alive) ai(pid, null, false);
      else for (const c of s.corps || []) ai(pid, { cities: new Set(c.cities.filter((id) => s.castles[id]?.owner === pid)), all: new Set(c.cities), corps: c.id }, false);
    }
    let t0 = performance.now(), k = 0;
    const run = async (list) => { for (const [nid, f] of list) { if (!alive()) return false; f(); k++; if (performance.now() - t0 > 10) { onStep?.(nid, k, total); await yieldNow(); t0 = performance.now(); } } return true; };
    let total = jobs.length;
    if (!(await run(jobs))) return null;
    const prevTiles = new Map(s.units.map((u) => [u.id, u.tile]));
    // 하루마다 컴퓨터도 군사 판단 (내정·외교는 순 첫날에만)
    const daily = [];
    if (s.day > 0) {
      for (const n of s.nations) if (n.alive && !n.outlaw && n.id !== pid) daily.push([n.id, () => aiTurn14(s, grid, n.id, null, true)]);
      if (s.spectator && s.nations[pid].alive) daily.push([pid, () => aiTurn14(s, grid, pid, null, true)]);
      else for (const c of s.corps || []) daily.push([pid, () => aiTurn14(s, grid, pid, { cities: new Set(c.cities.filter((id) => s.castles[id]?.owner === pid)), all: new Set(c.cities), corps: c.id }, true)]);
    }
    total += daily.length;
    if (!(await run(daily))) return null;
    const movingBefore = new Set(s.units.filter((u) => u.nation === pid && u.path.length).map((u) => u.id));
    const ownBefore = s.castles.map((c) => c.owner);
    const myBefore = s.units.filter((u) => u.nation === pid).map((u) => ({ id: u.id, tile: u.tile, name: gensOf(s, u.gens)[0]?.name, troops: u.troops }));
    const aimBefore = new Set(s.units.filter((u) => enemy(s, pid, u.nation) && u.order?.kind === 'castle' && s.castles[u.order.id]?.owner === pid).map((u) => `${u.id}:${u.order.id}`));
    const logN0 = s.logN || 0;
    if (performance.now() - t0 > 6) { await yieldNow(); if (!alive()) return null; }
    stepDay(s, grid);
    return { prevTiles, movingBefore, ownBefore, myBefore, aimBefore, logN0 };
  };
  // 생각 중 표시: 어느 나라가 다음 수를 생각하는지 (얼굴·이름), 0.15초 넘게 걸릴 때만 띄움
  const [thinking, setThinking] = useState(null);
  const thinkShow = useRef(0);
  const thinkT0 = useRef(0);
  // 군주 얼굴이 차례로 넘어가며 로딩 대신 보임 — 얼굴이 너무 빨리 바뀌지 않게 0.35초에 한 번
  const thinkHist = useRef([]);
  const thinkingRef = useRef(null); thinkingRef.current = thinking;
  useEffect(() => { if (!thinking) thinkHist.current = []; }, [thinking]);
  const onThink = (nid, k, n) => { const now = performance.now(); if (now - thinkT0.current < 150 || now - thinkShow.current < 350) return; thinkShow.current = now; const h = thinkHist.current; if (h[h.length - 1] !== nid) { h.push(nid); if (h.length > 4) h.shift(); } setThinking({ nid, k, n }); };
  // 미리 계산: 하루가 끝나고 가만히 있으면 다음 하루를 뒤에서 (잘게 나눠) 계산해 둠.
  // 「하루 진행」을 누를 때 그 사이 아무 명령도 없었으면(게임 상태가 그대로면) 그 결과를 씀 — 덜 끝났으면 이어서 끝냄. 명령을 내리면 게임 상태가 새로 바뀌므로 버리고 다시 계산
  const spec = useRef(null);
  const pendingNext = useRef(false), skipWait = useRef(null);
  const startSpec = (base) => {
    const s = clone(base), job = { base, s, D: null, startN: base.logN || 0, report: null };
    spec.current = job; // 먼저 지금 일로 등록 (계산 첫 조각이 바로 돌면서 '아직 지금 일인가'를 확인하므로)
    job.promise = stepComputeAsync(s, true, (nid, k, n) => job.report?.(nid, k, n), () => spec.current === job).then((D) => { job.D = D; return D; });
    return job;
  };
  useEffect(() => {
    if (playing || game.over || game.inbox?.length) return;
    if (pendingNext.current) { pendingNext.current = false; setTimeout(() => runTurnRef.current?.(false), 0); return; }
    if (spec.current?.base === game) return;
    spec.current = null;
    const id = setTimeout(() => { if (!spec.current) startSpec(game); }, 150);
    return () => clearTimeout(id);
  }, [game, playing]);
  const runTurnRef = useRef(null);
  const turnStart = useRef(null);
  useEffect(() => { if (game.day === 0 && turnStart.current?.turn !== game.turn) turnStart.current = tally(game, pid); }, [game]);
  // mode: false = 하루, 숫자 n = n일(순이 끝나면 정산하고 다음 순으로 이어 감), true = 이번 순 끝까지
  const multiRef = useRef(false);
  const runTurn = (mode = false) => {
    if (game.over) return;
    // 진행 중에 또 누르면: 지금 날의 남은 움직임을 건너뜀 (하루 진행이면 바로 다음 날로)
    if (playing) { if (mode !== true && skipWait.current && !duel) { if (!multiRef.current) pendingNext.current = true; skipWait.current(); } return; }
    const toEnd = mode === true || mode > 1;
    let left = mode === true ? Infinity : Math.max(1, Math.min(DAYS, +mode || 1));
    const spd = game.opts?.showArmy === false ? 0 : speed; // 게임 옵션 「이동 애니메이션」을 끄면 부대가 바로 옮겨 감
    multiRef.current = toEnd;
    if (game.inbox?.length) { setPeek(false); return; } // 사신에게 먼저 답해야 진행
    thinkT0.current = performance.now();
    const job = spec.current && spec.current.base === game ? spec.current : startSpec(game);
    let s = job.s;
    const startN = game.logN || 0;
    setPlaying(true);
    setReportOpen(false);
    const finish = (snap) => {
      // 순이 끝남: 정산 후 이번 순 소식
      snap.fx = [];
      const t0 = turnStart.current?.turn === snap.turn ? turnStart.current : null;
      const pre = tally(snap, pid);
      const rows = battleRows(snap, pid, snap.turn);
      endTurn14(snap, grid);
      const post = tally(snap, pid);
      turnStart.current = post;
      sfx('gong');
      const news = snap.log.filter((l) => (l.n || 0) > startN && l.nations?.includes(pid) && ['capture', 'battle', 'diplo', 'bad'].includes(l.kind) && !l.text.startsWith('🔥')).map((l) => l.text);
      for (const c of snap.castles.filter((x) => x.owner === pid)) {
        const foes = snap.units.filter((u) => enemy(snap, pid, u.nation) && ((u.order?.kind === 'castle' && u.order.id === c.id) || grid.dist(u.tile, c.tile) <= 3));
        if (foes.length) news.push(`⚠️ ${[...new Set(foes.map((u) => snap.nations[u.nation].name))].join('·')}군 ${foes.length}부대(${fmtTroops(foes.reduce((a, u) => a + u.troops, 0))})가 ${c.name}(수비 ${fmtTroops(c.troops)})을 노립니다`);
      }
      const start = t0 || pre;
      const had = new Set(start.owned), now = new Set(post.owned);
      const sum = snap.spectator ? null : {
        turn: pre.turn, full: !!t0,
        gold: [start.gold, pre.gold, post.gold], food: [start.food, pre.food, post.food], troops: [start.troops, pre.troops, post.troops], field: post.field,
        gained: start.owned.length ? post.owned.filter((id) => !had.has(id)).map((id) => snap.castles[id].name) : [],
        lost: start.owned.filter((id) => !now.has(id)).map((id) => snap.castles[id].name),
        cities: post.owned.length,
        rows,
      };
      setReport(news.length || sum ? { news: news.slice(0, 8), sum } : null);
      // 순 결과 창은 저절로 띄우지 않고 소식 카드 한 장으로 알림 (📊 보기로 펼침) — 매 순 창을 닫는 게 번거로웠음
      if (sum) {
        const dg = sum.gold[2] - sum.gold[0], ch = [sum.gained.length ? `+${sum.gained.length}성` : '', sum.lost.length ? `−${sum.lost.length}성` : ''].filter(Boolean).join(' ');
        pushNews([{ icon: '📊', text: `${sum.turn}순 결과 · 금 ${dg >= 0 ? '+' : '−'}${fmtGold(Math.abs(dg))} · 성 ${sum.cities}곳${ch ? ` (${ch})` : ''}`, tone: sum.lost.length > sum.gained.length ? 'bad' : sum.gained.length ? 'good' : '', report: true }]);
      }
      return snap;
    };
    const done = (snap) => {
      skipWait.current = null;
      setGame(snap);
      setPlaying(false);
      setSel((v) => (v?.type === 'unit' && !snap.units.some((u) => u.id === v.id) ? null : v));
    };
    const tick = (D) => {
      setThinking(null);
      const { prevTiles, movingBefore, ownBefore } = D;
      spawnFx(s);
      if (!s.spectator) pushNews(dayNews(s, D));
      // 순 끝까지 넘기는 중에 내 부대가 도착해 할 일이 없어지면 그날 멈춤 (모르고 며칠을 흘려보내지 않게)
      const idleNow = s.spectator ? [] : s.units.filter((u) => u.nation === pid && !u.corps && movingBefore.has(u.id) && !u.path.length && !u.queue?.length);
      // 효과음: 내 부대·성이 낀 일만
      {
        const mineT = new Set([...s.units.filter((u) => u.nation === pid).map((u) => u.tile), ...s.castles.filter((c) => c.owner === pid).map((c) => c.tile)]);
        const near = (e) => mineT.has(e.tile) || mineT.has(e.a) || mineT.has(e.b) || mineT.has(e.to);
        const fx = s.fx || [];
        const gained = s.castles.some((c, i) => c.owner === pid && ownBefore[i] !== pid);
        const lost = s.castles.some((c, i) => ownBefore[i] === pid && c.owner !== pid);
        if (lost) sfx('lose');
        else if (gained) sfx('capture');
        else if (fx.some((e) => e.type === 'clash' && near(e))) sfx('clash');
        else if (fx.some((e) => e.type === 'hit' && near(e))) sfx('hit');
        if ((s.duels || []).some((x) => x.an === pid || x.bn === pid)) sfx('duel');
        // 분위기: 내 부대가 적과 3칸 안이면 전투, 적 부대가 내 성 6칸 안에 오면 긴장, 그 밖엔 평상시
        const fighting = s.units.some((u) => u.nation === pid && s.units.some((v) => enemy(s, pid, v.nation) && grid.dist(u.tile, v.tile) <= 3));
        const tense = !fighting && s.castles.some((c) => c.owner === pid && s.units.some((v) => enemy(s, pid, v.nation) && grid.dist(c.tile, v.tile) <= 6));
        setMood(fighting ? 'battle' : tense ? 'tension' : 'calm');
      }
      // 내 장수가 낀 일기토는 장면으로 보여 주고 잠시 멈춤, 고유 전법은 컷인
      const dl = (s.duels || []).find((x) => x.an === pid || x.bn === pid);
      const ui = (s.fx || []).find((e) => e.type === 'tactic' && e.unique && (e.nation === pid || s.units.some((u) => u.nation === pid && u.tile === e.to)));
      const scenes = game.opts?.showBattles !== false; // 게임 옵션 「일기토·전법 장면」
      if (ui && scenes) { setCutin(ui); sfx('cutin'); holdSfx(1.5); setTimeout(() => setCutin(null), 1500); }
      if (dl && scenes) setDuel(dl);
      const wait = dl && scenes ? duelMs(dl) : 0;
      // 일기토 장면을 누르면 바로 다음으로 (기다리던 타이머를 당겨 실행), 하루씩 진행 중 다시 누르면 남은 움직임 건너뜀
      const later = (fn, ms) => { let fired = false; const run = () => { if (fired) return; fired = true; skipDuel.current = null; skipWait.current = null; fn(); }; const id = setTimeout(run, ms); if (dl && scenes) skipDuel.current = () => { clearTimeout(id); run(); }; skipWait.current = () => { clearTimeout(id); run(); }; };
      const snap = clone(s);
      // 움직임은 계산이 끝난 뒤부터 셈 (계산하느라 걸린 시간만큼 앞부분이 잘려 순간이동하지 않게).
      // 순 끝까지는 하루 내내 같은 빠르기로 쭉 움직이고 바로 다음 날로 이어짐 (예전엔 날마다 천천히 멈췄다 다시 출발해 뚝뚝 끊겨 보였음)
      anim.current = { prev: prevTiles, t0: performance.now(), dur: spd === 0 ? 1 : toEnd ? spd : spd * 0.9, linear: toEnd };
      setGame(snap);
      const endOfTurn = s.day >= DAYS || s.over;
      left -= 1;
      if (stopIdle && toEnd && !endOfTurn && idleNow.length) {
        later(() => { setDuel(null); done(snap); toast(`⚑ ${idleNow.map((u) => gensOf(s, u.gens)[0]?.name).join('·')} 부대가 도착해 멈췄습니다. 다음 명령을 내리세요 (${DAYS - s.day}일 남음)`); }, Math.max(spd * 0.9, wait));
        return;
      }
      // n일 진행이 순을 넘어가면: 정산(보고서)하고 새 순 첫날부터 이어서 (사신이 왔거나 게임이 끝나면 멈춤)
      if (endOfTurn && left > 0 && mode !== true && !s.over) {
        later(() => {
          setDuel(null);
          const ns = finish(clone(s));
          if (ns.over || ns.inbox?.length) { done(ns); return; }
          s = ns;
          setGame(clone(ns));
          thinkT0.current = performance.now();
          stepComputeAsync(s, true, onThink).then((D) => (D ? tick(D) : done(s)));
        }, Math.max(spd * 0.9, wait));
        return;
      }
      if (endOfTurn || left <= 0) {
        later(() => { setDuel(null); done(endOfTurn ? finish(clone(s)) : snap); }, Math.max(spd * 0.9, wait));
        return;
      }
      later(() => { setDuel(null); thinkT0.current = performance.now(); stepComputeAsync(s, false, onThink).then(tick); }, spd + wait);
    };
    // 첫날: 미리 계산이 끝났으면 바로 움직이고, 덜 끝났으면 그 계산을 이어서 기다림 (그동안 「생각 중」 표시)
    if (job.D) tick(job.D);
    else { job.report = onThink; job.promise.then((D) => { spec.current = null; if (D) tick(D); else { setThinking(null); setPlaying(false); } }); }
    if (job.D) spec.current = null;
  };
  runTurnRef.current = runTurn;
  kb.current = { nDays, run: (m) => runTurnRef.current?.(m), todo: () => setTodoOpen((v) => !v), panel: () => setPanelOff(!panelOff), openPanel: () => { if (panelOff) setPanelOff(false); setSheet(true); } };

  // 출진 창 기본값
  const castleGens = selCastle ? Object.values(game.generals).filter((g) => g.castle === selCastle.id && g.status === 'active').sort((a, b) => gsortKey(gsort)(b) - gsortKey(gsort)(a)) : [];
  const shownGens = genMore === selCastle?.id ? castleGens : castleGens.slice(0, 3);
  useEffect(() => {
    if (!sortieOpen || !selCastle) return;
    const best = castleGens.slice().sort((a, b) => b.lead + b.war - (a.lead + a.war))[0];
    const ids = best ? [best.id] : [];
    setPickG(ids);
    // 기본 출진 병력: 근처(6칸) 적 병력만큼은 성에 남김
    const foes = game.units.filter((u) => enemy(game, pid, u.nation) && grid.dist(u.tile, selCastle.tile) <= 6).reduce((a, u) => a + u.troops, 0);
    const keep = Math.max(500, Math.ceil(foes / 100) * 100);
    const safe = Math.min(commandCap(game, ids), selCastle.troops - keep);
    setAmt(Math.max(0, safe >= 1000 ? safe : Math.min(commandCap(game, ids), selCastle.troops - 500)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortieOpen, sel?.id]);
  const cap = commandCap(game, pickG);
  const afford = selCastle ? sortieAfford(game, pid, withSiege) : 0;
  const maxAmt = selCastle ? Math.max(0, Math.min(cap, selCastle.troops - 500, afford)) : 0;

  const cities = game.castles.filter((c) => c.kind !== 'pass');
  const myCities = cities.filter((c) => c.owner === pid).length;
  const myUnits = game.units.filter((u) => u.nation === pid);
  // 진행 중(하루·순 재생)에는 무거운 내정 계산(수입·할 일·장수 배치·내 성 목록)을 다시 하지 않고 진행이 끝나면 한 번에 고침 (큰 판에서 매일 다시 계산해 화면이 끊겼음)
  const calmRef = useRef(game); if (!playing) calmRef.current = game; const calmGame = calmRef.current;
  const inc = useMemo(
    () =>
      game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + castleIncome(game, grid, c), 0) -
      Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active').length * 200 - game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + Object.values(c.bld || {}).reduce((x, y) => x + y, 0) * 300, 0) - (me.policies || []).length * POLICY_UPKEEP,
    [calmGame, grid, pid], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 내 성 목록 (진행 중엔 다시 세지 않음)
  const cityRows = useMemo(() => {
    const mine = game.castles.filter((c) => c.owner === pid);
    const R10 = 8 * (grid.k || 1);
    // 성마다 한 번만 셈 (예전엔 정렬하며 비교할 때마다 모든 부대·장수를 다시 훑어 큰 판에서 화면이 멈칫했음)
    const foes = game.units.filter((u) => enemy(game, pid, u.nation));
    const thM = new Map(mine.map((c) => [c.id, foes.reduce((a, u) => (grid.dist(u.tile, c.tile) <= R10 ? a + u.troops : a), 0)]));
    const gnM = new Map(); for (const g of Object.values(game.generals)) if (g.status === 'active' && g.castle != null) gnM.set(g.castle, (gnM.get(g.castle) || 0) + 1);
    const threat = (c) => thM.get(c.id) || 0, gn = (c) => gnM.get(c.id) || 0;
    const goldM = new Map(mine.map((c) => [c.id, goldOf(game, c)])), gold = (c) => goldM.get(c.id) || 0;
    const key = { name: (c) => c.name, troops: (c) => -c.troops, gens: (c) => -gn(c), gold: (c) => -goldM.get(c.id), threat: (c) => -threat(c) }[csort] || ((c) => -c.troops);
    const kv = new Map(mine.map((c) => [c.id, key(c)]));
    const list = mine.slice().sort((a, b) => { const x = kv.get(a.id), y = kv.get(b.id); return x < y ? -1 : x > y ? 1 : 0; });
    return { list, threat, gn, gold };
  }, [calmGame, csort, pid, grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const food = me.food ?? 0, use = foodUse(game, pid);
  const turnsToHarvest = (((HARVEST_MONTH * 3 - (game.turn - 1)) % 36) + 36) % 36;
  // 내정 부르기: 빈 담당에 맞는 장수 — 다른 내 성에서 담당 없이 있는, 무력 85 이하(싸움꾼은 빼고), 군주·출진 중 제외, 그 성의 마지막 장수는 빼지 않음
  const jobCands = (gm, c, role) => {
    const held = new Set(); const cnt = new Map();
    for (const x of gm.castles) if (x.owner === pid) for (const id of Object.values(x.jobs || {})) if (id) held.add(id);
    for (const g of Object.values(gm.generals)) if (g.nation === pid && g.status === 'active' && g.unit == null && g.castle != null) cnt.set(g.castle, (cnt.get(g.castle) || 0) + 1);
    const key = role === 'draft' ? 'lead' : 'pol';
    return Object.values(gm.generals).filter((g) => g.nation === pid && g.status === 'active' && !g.ruler && g.unit == null && g.castle != null && g.castle !== c.id && !held.has(g.id) && g.war <= 85 && (cnt.get(g.castle) || 0) >= 2 && gm.castles[g.castle]?.troops >= 1500)
      .map((g) => ({ g, d: grid.dist(gm.castles[g.castle].tile, c.tile) })).sort((a, b) => b.g[key] - a.g[key] || a.d - b.d);
  };
  const callJob = (s, cid, role, gid) => {
    const c = s.castles[cid], g = s.generals[gid];
    if (!g || g.castle == null) return { ok: false, msg: '부를 수 없는 장수입니다.' };
    const r = summonGeneral(s, grid, gid, cid, Math.min(callAmt, s.castles[g.castle].troops - 500));
    if (!r.ok) return r;
    for (const rr of Object.keys(ROLES)) if (c.jobs?.[rr] === gid) c.jobs[rr] = null;
    c.jobs = c.jobs || {}; c.jobs[role] = gid;
    return { ok: true, msg: `${g.name}이(가) ${c.name}(으)로 갑니다 — 도착하면 ${ROLES[role]}을 맡습니다` };
  };
  const callForJob = (cid, role, gid) => act((s) => callJob(s, cid, role, gid));
  // 담당 빈 성 여러 곳을 추천대로 한 번에 (장수마다 한 곳씩)
  const callJobsAll = (rows) => act((s) => {
    let n = 0;
    for (const r of rows) if (callJob(s, r.c.id, r.role, r.best.g.id).ok) n++;
    return n ? { ok: true, msg: `장수 ${n}명이 담당 빈 성으로 갑니다 — 도착하면 업무를 맡습니다` } : { ok: false, msg: '부를 수 있는 장수가 없습니다.' };
  });
  // 장수 나누기: 계획을 보여 주고 확인을 받은 뒤 보냄
  const spreadPlan = useMemo(() => (game.spectator ? [] : planGenSpread(game, grid, pid)), [calmGame, grid, pid]); // eslint-disable-line react-hooks/exhaustive-deps
  const spreadGens = async () => {
    const plan = planGenSpread(gameRef.current, grid, pid);
    if (!plan.length) return toast('장수가 이미 고르게 있습니다');
    const by = new Map();
    for (const m of plan) { const k = `${game.castles[m.from].name} → ${game.castles[m.to].name}`; if (!by.has(k)) by.set(k, []); by.get(k).push(game.generals[m.g].name); }
    const lines = [...by].map(([k, v]) => `${k}: ${v.join('·')}`);
    if (!(await uiConfirm(`장수 ${plan.length}명을 보낼까요? (병사 1천씩 데리고 걸어감)\n\n${lines.slice(0, 12).join('\n')}${lines.length > 12 ? `\n… 외 ${lines.length - 12}곳` : ''}`))) return;
    act((s) => doGenSpread(s, grid, pid, planGenSpread(s, grid, pid)));
  };
  // 재야·포로 모두 등용 (인재 탭·할 일 목록에서 같이 씀)
  const recruitAll = () => act((s) => {
    let tried = 0; const got = [];
    for (const x of Object.values(s.generals)) {
      if (x.tried === s.turn || isRuler(x) || !((x.status === 'free' && s.castles[x.castle]?.owner === pid) || (x.status === 'prisoner' && x.captor === pid))) continue;
      if (recruitChance(s, x, pid, x.status === 'free' ? x.castle : undefined) < 0.01) continue;
      const r = recruit(s, x.id, pid);
      if (r.ok !== false) { tried++; if (x.status === 'active' && x.nation === pid) got.push(x.name); }
    }
    return { ok: tried > 0, msg: tried ? `${tried}명 설득 → ${got.length ? `${got.length}명 등용 (${got.slice(0, 5).join('·')}${got.length > 5 ? ' 등' : ''})` : '모두 거절'}` : '설득할 재야·포로가 없습니다' };
  });
  // ── 할 일 목록: 지금 손봐야 할 것을 모음 (대신 해 주지 않음 — 누르면 그곳으로, 버튼은 사람이 누를 때만) ──
  const focusTile = (t) => { const el = wrap.current, v = view.current; if (!el || !v) return; const [x, y] = grid.center(t); v.x = x - el.clientWidth / v.k / 2; v.y = y - el.clientHeight / v.k / 2; draw(); };
  const todos = useMemo(() => {
    const g = game;
    if (g.spectator || g.over) return [];
    const me = g.nations[pid], out = [];
    const mine = g.castles.filter((c) => c.owner === pid);
    const sight = fogOn(g) ? sightOf(g, grid) : null;
    const foes = g.units.filter((u) => enemy(g, pid, u.nation) && (!sight || sight[u.tile]));
    const gensAt = new Map();
    for (const x of Object.values(g.generals)) if (x.status === 'active' && x.nation === pid && (x.unit === null || x.unit === undefined) && x.castle != null) gensAt.set(x.castle, (gensAt.get(x.castle) || 0) + 1);
    const goC = (c) => () => { goTo(c); setSheet(true); };
    // 위급: 내 성을 노리는 적
    for (const c of mine) {
      const fs = foes.filter((u) => (u.order?.kind === 'castle' && u.order.id === c.id) || grid.dist(u.tile, c.tile) <= 3 * (grid.k || 1));
      if (!fs.length) continue;
      const tot = fs.reduce((a, u) => a + u.troops, 0), sieged = besieged(g, grid, c);
      out.push({ id: 'th' + c.id, sev: tot > c.troops * 0.6 || sieged ? 'danger' : 'todo', icon: sieged ? '🏯' : '⚠️', title: `${c.name} ${sieged ? '포위됨' : '위협'}`, sub: `${[...new Set(fs.map((u) => g.nations[u.nation]?.name))].join('·')} ${fs.length}부대 ${fmtTroops(tot)} vs 수비 ${fmtTroops(c.troops)}`, go: goC(c) });
    }
    // 병량: 다음 수확까지 버틸 수 있나
    {
      const use = foodUse(g, pid), left = (((HARVEST_MONTH * 3 - (g.turn - 1)) % 36) + 36) % 36 || 36, need = use * left;
      if (use > 0 && me.food < need) out.push({ id: 'food', sev: me.food < use * 3 ? 'danger' : 'todo', icon: '🌾', title: `병량이 수확까지 모자람`, sub: `수확까지 ${left}순 · 필요 ${fmtTroops(need)} / 있음 ${fmtTroops(me.food)} (순마다 −${fmtTroops(use)})`, act: { label: '시장 열기', fn: () => { setSel(null); setTab('home'); setSheet(true); if (isPhone()) setTodoOpen(false); } } });
    }
    // 할 일: 멈춰 선 부대
    for (const u of g.units) {
      if (u.nation !== pid || u.corps || u.routed || u.path.length || u.queue?.length) continue;
      const tc = u.order?.kind === 'castle' ? g.castles[u.order.id] : null;
      if (tc && tc.owner !== pid && grid.dist(u.tile, tc.tile) <= 1) continue; // 공성 중
      if (u.order?.kind === 'unit' || u.order?.kind === 'fort') continue;
      const ld = gensOf(g, u.gens)[0];
      out.push({ id: 'u' + u.id, sev: 'todo', icon: '⚑', title: `${ld?.name || '부대'} 부대 명령 기다림`, sub: `${fmtTroops(u.troops)} · 사기 ${Math.round(u.morale)}`, go: () => { setSel({ type: 'unit', id: u.id }); focusTile(u.tile); } });
    }
    // 할 일: 등용
    const cand = Object.values(g.generals).filter((x) => x.tried !== g.turn && !isRuler(x) && ((x.status === 'free' && g.castles[x.castle]?.owner === pid) || (x.status === 'prisoner' && x.captor === pid)) && recruitChance(g, x, pid, x.status === 'free' ? x.castle : undefined) >= 0.01);
    if (cand.length) out.push({ id: 'rec', sev: 'todo', icon: '⭐', title: `등용할 수 있는 재야·포로 ${cand.length}명`, sub: cand.slice(0, 4).map((x) => `${x.name}(${x.status === 'prisoner' ? '포로' : '재야'})`).join(' · ') + (cand.length > 4 ? ' …' : ''), act: { label: '모두 등용', primary: true, fn: recruitAll } });
    // 할 일: 약조가 곧 끝남
    for (const p of (g.pacts || []).filter((x) => x.type !== 'vassal' && (x.a === pid || x.b === pid) && x.until > g.turn && x.until - g.turn <= 3)) {
      const o = p.a === pid ? p.b : p.a;
      out.push({ id: 'pc' + o, sev: 'todo', icon: '🤝', title: `${g.nations[o]?.name}와(과) ${PACT[p.type] || p.type} ${p.until - g.turn}순 뒤 끝남`, sub: '끝나면 서로 칠 수 있습니다', act: { label: '연장 청하기', disabled: me.lastAsk?.[o] === g.turn, fn: () => act((s) => renewPact(s, pid, o)) } });
    }
    // 할 일: 업무 담당이 빈 성 — 성 안에 맡길 사람이 있으면 「알아서 맡기기」, 없으면 다른 성에서 놀고 있는 알맞은 장수 「부르기」
    const jobClaimed = new Set(), jobRows = [];
    for (const c of mine) {
      if (c.kind === 'pass') continue;
      const miss = Object.keys(ROLES).filter((r) => !jobGen(g, c, r) && !(c.jobs?.[r] && g.generals[c.jobs[r]]?.unit != null));
      if (!miss.length) continue;
      const free = Object.values(g.generals).filter((x) => x.castle === c.id && x.status === 'active' && x.nation === pid && x.unit == null && !x.ruler && !Object.values(c.jobs || {}).includes(x.id));
      if (free.length) {
        if (c.auto) continue; // 자동 맡김이면 순이 끝날 때 알아서 채움
        out.push({ id: 'job' + c.id, sev: 'todo', icon: '👔', title: `${c.name} 업무 담당 없음`, sub: miss.map((r) => ROLES[r]).join('·') + ' 담당이 비었습니다', go: goC(c), act: { label: '알아서 맡기기', tip: '머무는 장수 중 알맞은 사람에게 맡깁니다 (이 성은 앞으로도 자동)', fn: () => act((s) => { const x = s.castles[c.id]; x.auto = true; autoJobs(s, x); return { ok: true, msg: `${c.name}: 업무를 맡겼습니다` }; }) } });
        continue;
      }
      // 같은 장수를 여러 성에 추천하지 않게: 앞 성에서 추천한 장수는 빼고 고름
      const role = miss[0], best = jobCands(g, c, role).find((x) => !jobClaimed.has(x.g.id));
      if (!best) continue;
      jobClaimed.add(best.g.id);
      jobRows.push({ c, role, miss, best });
    }
    if (jobRows.length >= 3) {
      // 세 곳 이상이면 한 줄로 묶음 (목록이 같은 줄로 가득 차지 않게)
      out.push({ id: 'jobs', sev: 'todo', icon: '👔', title: `담당 빈 성 ${jobRows.length}곳 — 놀고 있는 장수로 채울 수 있음`, sub: jobRows.slice(0, 4).map((r) => `${r.c.name}←${r.best.g.name}`).join(' · ') + (jobRows.length > 4 ? ' …' : ''), act: { label: '추천대로 모두 부르기', primary: true, tip: '장수마다 한 곳씩, 걸어와 도착하면 비어 있는 업무를 맡습니다', fn: () => callJobsAll(jobRows) } });
    } else for (const { c, role, miss, best } of jobRows) {
      const kv = role === 'draft' ? `통${best.g.lead}` : `정${best.g.pol}`;
      out.push({ id: 'job' + c.id, sev: 'todo', icon: '👔', title: `${c.name} ${miss.map((r) => ROLES[r]).join('·')} 담당 없음`, sub: `추천: ${best.g.name}(${kv}) — ${g.castles[best.g.castle].name}에서 놀고 있음`, go: goC(c), act: { label: `${best.g.name} 부르기`, tip: `${g.castles[best.g.castle].name}에서 걸어와 도착하면 ${ROLES[role]}을 맡습니다`, fn: () => callForJob(c.id, role, best.g.id) } });
    }
    // 할 일: 장수가 한 성에 몰려 있음
    if (spreadPlan.length >= 2) { const from = new Map(); for (const m of spreadPlan) from.set(m.from, (from.get(m.from) || 0) + 1); const top = [...from].sort((a, b) => b[1] - a[1])[0]; out.push({ id: 'spread', sev: 'todo', icon: '👥', title: `장수가 몰려 있음 — ${spreadPlan.length}명 나눌 수 있음`, sub: `${g.castles[top[0]].name} 등에서 장수가 모자란 성으로`, act: { label: '장수 나누기', fn: spreadGens } }); }
    // 할 일: 특성이 가득 찬 장수가 새 특성을 익힐 수 있음 (무엇을 잊을지 고르기)
    for (const o of g.traitOffers || []) { const gg = g.generals[o.gid]; if (gg && gg.status === 'active' && gg.nation === pid && !out.some((x) => x.id === 'offer' + o.gid)) out.push({ id: 'offer' + o.gid, sev: 'todo', icon: '✨', title: `${gg.name} 공적 — 새 특성 고르기`, sub: offerOpts(o).map((x) => (x[2] ? `${x[0]}${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][x[1]]}↑` : traitName(x))).join(' · '), act: { label: '고르기', primary: true, fn: () => { setOfferPick(null); setOfferGid(o.gid); } } }); }
    // 할 일: 충성이 낮은 장수
    const low = Object.values(g.generals).filter((x) => x.nation === pid && x.status === 'active' && !x.ruler && loyalOf(x) < 40);
    if (low.length) out.push({ id: 'loy', sev: low.some((x) => loyalOf(x) < 30) ? 'danger' : 'todo', icon: '💔', title: `충성 낮은 장수 ${low.length}명 (떠날 수 있음)`, sub: low.slice(0, 4).map((x) => `${x.name} 충${loyalOf(x)}`).join(' · '), act: { label: `전체 포상 ${fmtGold(rewardCost(g, pid))}`, disabled: me.gold < rewardCost(g, pid), fn: () => act((s) => rewardAll(s, pid)) } });
    return out;
  }, [calmGame, pid, grid, spreadPlan]); // eslint-disable-line react-hooks/exhaustive-deps
  // 순이 바뀌면(첫날) 할 일 목록을 저절로 엶
  const todoTurn = useRef(null);
  const [todoPing, setTodoPing] = useState(false); // 저절로 열지 않은 순: 할 일 버튼을 반짝여 알림
  // 폰: 할 일 목록을 열면 아래 패널을 접어 목록이 가려지지 않게, 줄을 누르면 목록을 닫고 그곳으로
  useEffect(() => { if (todoOpen) { setTodoPing(false); if (isPhone()) setSheet(false); } }, [todoOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const todoGo = (t) => { if (!t.go) return; t.go(); if (isPhone()) setTodoOpen(false); };
  useEffect(() => { if (playing || game.spectator || game.day !== 0 || todoTurn.current === game.turn) return; todoTurn.current = game.turn; if (todoAuto && todos.length && (window.innerWidth > 760 || todos.some((t) => t.sev === 'danger'))) setTodoOpen(true); else if (todos.length) setTodoPing(true); }, [game, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── 오늘의 소식: 하루가 끝날 때 내게 중요한 일을 지도 위 카드로 (📍로 그 자리로, 지도에 고리 표시) ──
  const [news, setNews] = useState([]);
  const pulses = useRef([]);
  const newsId = useRef(0);
  const dayNews = (st, D) => {
    const out = [];
    st.castles.forEach((c, i) => {
      const b = D.ownBefore[i];
      if (b !== pid && c.owner === pid) out.push({ icon: '🏯', tone: 'good', text: `${c.name} 함락!`, tile: c.tile });
      else if (b === pid && c.owner !== pid) out.push({ icon: '💥', tone: 'bad', text: `${c.name}을(를) 잃었습니다${c.owner !== null && st.nations[c.owner] ? ` (${st.nations[c.owner].name})` : ''}`, tile: c.tile });
    });
    // 내 부대가 사라짐: 내 성에 들어간 게 아니면 전멸
    const alive = new Set(st.units.map((u) => u.id));
    for (const u of D.myBefore || []) {
      if (alive.has(u.id)) continue;
      const home = st.castles.some((c) => c.owner === pid && (c.tile === u.tile || grid.dist(c.tile, u.tile) <= 1));
      if (!home) out.push({ icon: '☠️', tone: 'bad', text: `${u.name || '?'} 부대(${fmtTroops(u.troops)})가 무너졌습니다`, tile: u.tile });
    }
    // 새로 내 성을 노리는 적 부대
    const seen = new Set();
    for (const u of st.units) {
      if (!enemy(st, pid, u.nation) || u.order?.kind !== 'castle') continue;
      const c = st.castles[u.order.id];
      if (c?.owner !== pid || D.aimBefore?.has(`${u.id}:${c.id}`) || seen.has(c.id)) continue;
      if (fogOn(st) && !sightOf(st, grid)[u.tile]) continue;
      seen.add(c.id);
      const tot = st.units.filter((v) => v.nation === u.nation && v.order?.kind === 'castle' && v.order.id === c.id).reduce((a, v) => a + v.troops, 0);
      out.push({ icon: '⚠️', tone: tot > c.troops * 0.6 ? 'bad' : 'warn', text: `${st.nations[u.nation].name}군 ${fmtTroops(tot)}이(가) ${c.name}(수비 ${fmtTroops(c.troops)})을 노립니다`, tile: c.tile });
    }
    // 장수 포로·사로잡음 (기록에서)
    for (const l of st.log) { if ((l.n || 0) <= (D.logN0 || 0)) break; if (l.nations?.includes(pid) && /사로잡/.test(l.text)) out.push({ icon: '⛓️', tone: l.text.includes(st.nations[pid].name) ? 'warn' : 'good', text: l.text.replace(/^\S+\s/, '') }); }
    return out.slice(0, 6);
  };
  const pushNews = (list) => {
    if (!list.length) return;
    const now = performance.now();
    for (const n of list) if (n.tile != null) pulses.current.push({ tile: n.tile, t0: now, col: n.tone === 'good' ? '#8fe08a' : n.tone === 'bad' ? '#ff6b5a' : '#ffd166' });
    setNews((v) => { const old = v.filter((x) => !list.some((n) => n.text === x.text)); return [...list.map((n) => ({ ...n, id: ++newsId.current, at: Date.now() })), ...old].slice(0, window.innerWidth <= 760 ? 3 : 5); }); // 같은 소식은 새 것으로 바꿈
  };
  useEffect(() => { if (!news.length) return; const id = setInterval(() => setNews((v) => v.filter((n) => Date.now() - n.at < 15000)), 1000); return () => clearInterval(id); }, [news.length]);
  // ── 가이드 투어 단계: 실제 화면을 비추며 한 판의 흐름을 설명 ──
  const capC = game.castles.find((c) => c.owner === pid && c.capital) || game.castles.find((c) => c.owner === pid);
  const mapRect = (tile, w = 150, h = 120) => () => { const r = wrap.current?.getBoundingClientRect(); if (!r || tile == null) return null; const [x, y] = window.__h14?.screenOf(tile, 1) || [0, 0]; return { left: Math.max(r.left, x - w / 2), top: Math.max(r.top, y - h / 2), width: w, height: h }; };
  const tourBase = useRef({});
  const foeC = capC ? game.castles.filter((c) => c.owner !== pid && c.owner !== null && c.owner >= 0 && c.kind !== 'pass').sort((x, y) => grid.dist(x.tile, capC.tile) - grid.dist(y.tile, capC.tile))[0] : null;
  const focusOn = (t) => { const el = wrap.current, v = view.current; if (!el || !v || t == null) return; const [x, y] = grid.center(t); v.x = x - el.clientWidth / v.k / 2; v.y = y - el.clientHeight / v.k / 2; draw(); };
  const myUnitN = game.units.filter((u) => u.nation === pid).length, nowDay = (game.turn - 1) * DAYS + game.day;
  const tourSteps = [
    { title: '🎓 Table War에 오신 걸 환영해요', body: <>성을 빼앗아 <b>전체 성의 80%</b>를 차지하면 천하통일입니다. 시간은 <b>하루씩</b> 흐르고, <b>10일 = 1순</b>마다 금·병량이 정산돼요. 직접 해 보면서 배워 볼게요.</> },
    { title: '📊 위쪽 정보 막대', target: '.tb-stats', body: <>날짜·날씨, <b>💰 금</b>(옆 초록 숫자 = 순마다 들어오는 돈), <b>🍚 병량</b>(병사가 먹음, 가을에 수확), <b>🏯 내 성 수/전체</b>, <b>⚑ 부대 수</b>입니다.</> },
    { title: '🗺️ 내 도읍', target: capC ? mapRect(capC.tile) : null, before: () => { setSel(null); setSheet(false); setSortieOpen(false); focusOn(capC?.tile); }, wait: () => sel?.type === 'castle' && game.castles[sel.id]?.owner === pid, doIt: `♛ ${capC?.name} 성을 누르세요`, body: <>내 나라 색으로 칠해진 곳이 내 땅, <b>♛</b>가 도읍 <b>{capC?.name}</b>이에요. 성 아래 숫자는 수비병입니다.</> },
    { title: '🏯 성 정보', target: '.h14-panel .stat-tiles', before: () => { if (!(sel?.type === 'castle' && game.castles[sel.id]?.owner === pid) && capC) goTo(capC); setSheet(true); }, body: <>수비병·성벽·인구·수입이 한눈에. 인구를 뽑아 징병하면 그만큼 금 수입이 줄어요(바닥나면 절반).</> },
    { title: '⚔️ 출진', target: '.h14-panel .big-act', before: () => { if (!(sel?.type === 'castle' && game.castles[sel.id]?.owner === pid) && capC) goTo(capC); setSheet(true); }, wait: () => sortieOpen, doIt: '「⚔️ 출진」을 누르세요', body: <>출진은 장수(최대 3명)가 병사를 데리고 성 밖으로 나가는 거예요. 전쟁은 결국 <b>병사 수</b> 싸움이에요.</> },
    { title: '🧑‍✈️ 장수 고르고 내보내기', target: (n) => { const go = document.querySelector('.sortie-go'); if (n < 3) go?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return (go?.parentElement || document.querySelector('.h14-panel .act-card'))?.getBoundingClientRect(); }, before: () => { tourBase.current.units = myUnitN; setSheet(true); if (!sortieOpen) setSortieOpen(true); }, wait: () => myUnitN > (tourBase.current.units ?? myUnitN), doIt: '장수를 고르고 아래 「출진」을 누르세요', body: <>무력·통솔이 높은 장수가 잘 싸워요. 장수가 많을수록(최대 3명) 더 많은 병사를 데려가고 공·방이 오릅니다. 막대로 데려갈 병사 수를 정해요.</> },
    { title: '🎯 적 성 공략', target: foeC ? mapRect(foeC.tile, 170, 130) : null, before: () => { setSheet(false); focusOn(foeC?.tile); if (sel?.type !== 'unit' || game.units.find((u) => u.id === sel.id)?.nation !== pid) { const mine = game.units.filter((u) => u.nation === pid && !u.order); if (mine.length) setSel({ type: 'unit', id: mine[mine.length - 1].id }); } }, wait: () => game.units.some((u) => u.nation === pid && u.order && (u.order.kind !== 'castle' || game.castles[u.order.id]?.owner !== pid)), doIt: foeC ? `부대가 골라진 채로 ${foeC.name} 성(${game.nations[foeC.owner]?.name})을 누르세요` : '지도에서 갈 곳을 누르세요', body: <>부대(깃발)를 고른 뒤 지도를 누르면: 빈 땅은 <b>이동</b>, 적 부대는 <b>공격</b>, 적 성은 <b>공략</b>. 진로 끝 <b>○일</b>이 도착 예정일이고, 지나간 칸은 내 땅이 됩니다.</> },
    { title: '▶ 시간 진행', target: '.end-turn-box', before: () => { tourBase.current.day = nowDay; setSheet(false); }, wait: () => nowDay > (tourBase.current.day ?? nowDay) && !playing, doIt: '「하루 진행」을 눌러 보세요', body: <>누를 때마다 모든 나라가 하루씩 동시에 움직여요. <b>－/＋</b>로 한 번에 며칠(최대 10일), <b>⏩ 순 끝까지</b>는 이번 순 끝까지. PC는 <kbd>Space</kbd>.</> },
    { title: '✅ 할 일 목록', target: '.todo-btn', body: <>위험한 성, 멈춘 부대, 등용할 인재, 끝나가는 약조, 빈 담당처럼 <b>챙길 일</b>을 모아 줘요. 줄을 누르면 그곳으로, 버튼으로 바로 처리. 새 순이 되면 이 버튼이 반짝여요.</> },
    { title: '📋 세력·외교·인재 탭', target: '.tabs-top', before: () => { setSel(null); setTab('home'); setSheet(true); }, body: <><b>세력</b>: 빠른 작업·내 성 표·정책 · <b>외교</b>: 정전·동맹·친선 · <b>인재</b>: 장수 목록·등용·포로 · <b>기록</b>: 지난 소식. PC는 <kbd>1</kbd>~<kbd>5</kbd>.</> },
    { title: '🤝 외교 요령', target: '.h14-panel .sec-h', before: () => { setSel(null); setTab('diplo'); setSheet(true); }, body: <>맞닿은 나라가 위에 나와요. 사방과 다 싸우면 버티기 어려우니, <b>센 이웃과는 정전</b>을 맺고 <b>한 곳을 집중</b>해서 치는 게 기본이에요.</> },
    { title: '🎉 준비 끝!', before: () => { setTab('home'); setSheet(false); }, body: <>보낸 부대가 도착하면 성을 공략해요. 지도 왼쪽 아래 <b>소식 카드</b>가 함락·위협과 <b>순 결과</b>(📊 보기)를 알려 줘요. 이 판은 <b>연습용</b>(자동 저장 안 됨)이에요. 🚪 나가서 원하는 나라로 시작하세요. 튜토리얼은 <b>처음 화면</b>에서 다시 할 수 있어요.</> },
  ];
  useEffect(() => { if (booted && game.tutorial && !game.spectator) setTourOn(true); }, [booted]); // eslint-disable-line react-hooks/exhaustive-deps
  // 튜토리얼 동안은 사신·사건 창을 띄우지 않음 (설명에만 집중) — 그리기 전에 비워서 깜박이지 않게
  useLayoutEffect(() => { if (game.tutorial && tourOn && (game.inbox?.length || game.eventsQ?.length)) setGame((g) => ({ ...g, inbox: [], eventsQ: [] })); }, [game, tourOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (c) => {
    const el = wrap.current, v = view.current;
    if (!el || !v) return;
    const [x, y] = grid.center(c.tile);
    v.x = x - el.clientWidth / v.k / 2;
    v.y = y - el.clientHeight / v.k / 2;
    setSel({ type: 'castle', id: c.id });
    setSortieOpen(false);
  };
  const myPrisoners = Object.values(game.generals).filter((g) => g.status === 'prisoner' && g.captor === pid);
  const freeIn = (c) => Object.values(game.generals).filter((g) => g.status === 'free' && g.castle === c.id && !isRuler(g)); // 옛 군주는 신하가 되지 않으므로 빼고
  const Help = ({ t }) => <button type="button" className="help-q" data-tip={t} aria-label="도움말">?</button>;
  const Loyal = ({ g }) => (g.ruler ? null : <small style={{ color: loyalOf(g) < 40 ? 'var(--danger)' : 'var(--muted)', marginLeft: 2 }}>충{loyalOf(g)}</small>);
  // 능력치: 85 이상 금색, 95 이상 주황 굵게
  const St = ({ k, v }) => <span className={v >= 95 ? 'stat-top' : v >= 90 ? 'stat-90' : v >= 80 ? 'stat-high' : undefined}>{k}{v}</span>;
  // 특성: 이름+등급(Ⅰ~Ⅲ), 마우스를 올리면 효과
  // 특성 꼬리표: 마우스를 올리거나(PC) 누르면(폰) 효과가 펼쳐짐 — 다시 누르면 접힘
  const Traits = ({ g }) => ((g.traits || []).length ? <span className="traits">{g.traits.map((tr) => (
    <span key={tr[0]} className={`trait t${tr[1]}`} data-tip={`${tr[0]} ${TIER_NAME[tr[1]]} — ${tdesc(tr[0], tr[1])}`} role="button" tabIndex={0}>{tlabel(tr)}</span>))}</span> : null);
  const Stats = ({ g, keys = ['war', 'lead', 'intel', 'pol'], traits = true }) => <span className="stats">{keys.map((k) => <St key={k} k={{ war: '무', lead: '통', intel: '지', pol: '정' }[k]} v={g[k]} />)}{traits && <Traits g={g} />}</span>;
  // 장수 카드: 1줄 이름(+담당), 2줄 충성·능력치, 3줄 특성·전법
  const GenCard = ({ g, loyal = true, pick = false }) => { const tn = tacticName(g); return (
    <div className="gen-main">
      <div className="gen-top"><b data-tip={pick ? undefined : `${g.name} · 공적 ${fmtTroops(g.merit || 0)}${nextMerit(g) ? ` — ${fmtTroops(nextMerit(g))}이면 특성을 하나 익히거나 올림 (적 병사를 쓰러뜨리거나 내정을 맡으면 쌓임)` : ' — 더 익힐 수 없음'}`}>{g.name}</b>{loyal && <Loyal g={g} />}<Job g={g} />{(game.traitOffers || []).some((o) => o.gid === g.id) && <button className="xs offer-badge" title="새 특성을 익힐 수 있어요" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOfferPick(null); setOfferGid(g.id); }}>✨ 새 특성</button>}</div>
      <div className="gen-line"><Stats g={g} traits={false} /><Traits g={g} />{tn && <span className="tac" data-tip={tacticTip(g)} role="button" tabIndex={0}>「{tn}」</span>}</div>
    </div>); };
  const SortBar = ({ v, set }) => <div className="gsort" role="group" aria-label="장수 줄 세우기">{GSORT.map(([k, l]) => <button key={k} className={'xs' + (v === k ? ' on' : '')} aria-pressed={v === k} onClick={() => set(k)} title={k === 'loyal' ? '충성 낮은 순' : `${l} 높은 순`}>{l}</button>)}</div>;
  // 지금 맡은 내정 (그 성 담당이면 배지)
  const jobOf = (g) => { const c = g.castle !== null && g.castle !== undefined ? game.castles[g.castle] : null; if (!c) return null; return Object.keys(ROLES).find((r) => jobGen(game, c, r)?.id === g.id) || null; };
  const JOB_ICON = { farm: '🌾', trade: '💰', draft: '💂' };
  const Job = ({ g }) => { const r = jobOf(g); return r ? <span className="job-badge" title={`${ROLES[r]} 담당`}>{JOB_ICON[r]}{ROLES[r]}</span> : null; };
  const Face = ({ g, size = 26, col = '#fff' }) => <img src={portraitURL(g, col)} alt="" width={size} height={size} style={{ verticalAlign: 'middle', marginRight: 4, borderRadius: '50%' }} />;
  const TAC_KIND = { atk: '공격', fire: '불 공격(비 오면 약함·바람 불면 셈)', shout: '호통(둘레 2칸 적 사기↓·하루 멈춤)', scare: '위협(적 사기 크게↓)' };
  const tacticTip = (g) => {
    const un = uniqueOf(g);
    if (un) return `「${un[0]}」 고유 전법 — ${TAC_KIND[un[1]] || un[1]} · 피해 ×${un[2]} · 적 사기 −${un[3]} (싸울 때 25% 확률로 먼저 씀)`;
    const tn = tacticName(g); if (!tn) return '';
    return `「${tn}」 — ${{ 돌격: '무력 70 이상: 피해 ×2.2 · 적 사기 −8', 일제사격: '통솔 70 이상: 피해 ×1.8 · 적 사기 −5', 화계: '지력 70 이상: 불 공격 피해 ×1.6 · 적 사기 −10 (비 오면 약함)' }[tn] || ''}`;
  };
  const tacticName = (g) => {
    const un = uniqueOf(g);
    if (un) return `${un[0]}★`;
    const [k, v] = [['war', g.war], ['lead', g.lead], ['intel', g.intel]].sort((a, b) => b[1] - a[1])[0];
    return v < 70 ? null : { war: '돌격', lead: '일제사격', intel: '화계' }[k];
  };

  const hasSel = !!(selCastle || selUnit || selFort);
  const TAB_LIST = [['home', '🏯 세력'], ['diplo', '🤝 외교'], ['people', '🧑 인재'], ['log', '📜 기록'], ['help', '❓']];
  const panel = (
    <div className="h14-side">
      <div className="h14-tabs seg tabs-top" role="tablist">
        {TAB_LIST.map(([k, l], i) => (
          <button key={k} role="tab" aria-selected={!hasSel && tab === k} className={!hasSel && tab === k ? 'on' : ''} title={`${l} (단축키 ${i + 1})`} onClick={() => { setSel(null); setSortieOpen(false); setTab(k); }}>{l}</button>
        ))}
      </div>
      {selCastle && (
        <div className="card">
          <div className="ci-head">
            <h3>{selCastle.kind === 'pass' ? '⛩️' : '🏯'} {selCastle.capital ? '♛ ' : ''}{selCastle.name}</h3>
            <span className="ci-owner" style={{ '--oc': ownerColor(game, selCastle.owner) }}>{selCastle.owner !== null && selCastle.owner >= 0 ? game.nations[selCastle.owner].name : selCastle.bandit || '중립'}</span>
            {selCastle.port && <span className="ci-tag" title="여기서 나간 부대는 배로 바닷길을 갈 수 있습니다">⚓ 항구</span>}
            {selCastle.kind === 'pass' && <span className="ci-tag" title="수입은 없지만 성벽이 두꺼워 길목을 막음">관문</span>}
          </div>
          {(() => {
            const hidden = selCastle.owner !== pid && (fogOn(game) || troopsHidden(game)) && !sightOf(game, grid)[selCastle.tile];
            const durP = Math.round((selCastle.dur / Math.max(1, selCastle.maxDur)) * 100);
            return (
              <div className="stat-tiles">
                <div><small>수비병</small><b>{hidden ? '?' : fmtTroops(selCastle.troops)}</b><small>수용 {fmtTroops(capOf(selCastle, game))}</small></div>
                <div className={durP < 40 ? 'warn' : ''} title={`성벽 내구 ${Math.round(selCastle.dur)} / ${selCastle.maxDur}`}><small>성벽</small><b>{durP}%</b><small>{fmtTroops(Math.round(selCastle.dur))}</small></div>
                {selCastle.kind !== 'pass' ? <>
                  <div className={popGold(selCastle) < 0.8 ? 'warn' : ''} title="징병으로 인구가 줄면 금 수입도 줄어듭니다 (바닥나면 절반). 인구는 순마다 조금씩 다시 늘어납니다"><small>인구</small><b>{Math.round(selCastle.pop)}천</b><small>금 {Math.round(popGold(selCastle) * 100)}%</small></div>
                  {selCastle.owner !== null ? <div title="관할 땅: 지도에 흰색=내 관할, 빨강=아직 남의 것 (채울수록 금·병량·자원병↑, 매 순 저절로 몇 칸씩 넓어짐)"><small>수입</small><b>{fmtGold(castleIncome(game, grid, selCastle))}</b><small>관할 {Math.round(landShare(game, selCastle) * 100)}%</small></div> : <div><small>수입</small><b>-</b><small>중립</small></div>}
                </> : <><div><small>인구</small><b>-</b><small>관문</small></div><div><small>수입</small><b>-</b><small>길목</small></div></>}
              </div>
            );
          })()}
          <div className="kv">
          </div>
          {selCastle.owner === pid && !playing && (
            <div className="col act-card">
              <button className="primary big-act" disabled={!castleGens.length || selCastle.troops < 1500} onClick={() => setSortieOpen(true)}>⚔️ 출진 <small>{castleGens.length ? `장수 ${castleGens.length}명 · 병력 ${fmtTroops(selCastle.troops)}` : '장수 없음'}</small></button>
              <CModal open={sortieOpen} title="⚔️ 출진" onClose={() => setSortieOpen(false)}>
                <div className="card" style={{ background: 'var(--panel)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 6 }}><b>⚔️ 출진할 장수</b><small className="muted" style={{ marginRight: 'auto' }}>최대 3명 · {pickG.length}명</small><button className="xs" title="이 성에서 무력이 가장 높은 장수 3명을 고르고 병력을 최대로" onClick={() => { const top = castleGens.slice().sort((a, b) => b.war - a.war || b.lead - a.lead).slice(0, 3).map((g) => g.id); setPickG(top); setAmt(Math.max(0, Math.min(commandCap(game, top), selCastle.troops - 500))); }}>⚔️ 무력 높은 3명</button></div>
                  {castleGens.map((g) => (
                    <label key={g.id} className={'pick-row' + (pickG.includes(g.id) ? ' on' : '')}>
                      <input type="checkbox" checked={pickG.includes(g.id)} onChange={(e) => {
                        const nx = e.target.checked ? [...pickG, g.id].slice(-3) : pickG.filter((x) => x !== g.id);
                        setPickG(nx);
                        setAmt(Math.max(0, Math.min(commandCap(game, nx), selCastle.troops - 500)));
                      }} /><Face g={g} size={26} col={me.color} /><GenCard g={g} pick />
                    </label>
                  ))}
                  <div style={{ fontSize: 13, marginTop: 4 }}>병력 {fmtTroops(Math.min(amt, maxAmt))} / 지휘 한도 {fmtTroops(cap)}</div>
                  
                  {(() => {
                    // 남는 수비와 6칸 안 적 병력 비교
                    const left = selCastle.troops - Math.min(amt, maxAmt);
                    const foes = game.units.filter((u) => enemy(game, pid, u.nation) && grid.dist(u.tile, selCastle.tile) <= 6).reduce((a, u) => a + u.troops, 0);
                    const danger = foes > 0 && left < foes;
                    return (
                      <div style={{ fontSize: 12, color: danger ? 'var(--danger)' : 'var(--muted)' }}>
                        남는 수비 {fmtTroops(left)} · 6칸 안 적 {fmtTroops(foes)}{danger ? ' — ⚠️ 이대로 나가면 성을 빼앗길 수 있습니다' : ''}
                      </div>
                    );
                  })()}
                  <Slider min={0} max={maxAmt} step={1000} value={Math.min(amt, maxAmt)} onChange={(v) => setAmt(Math.floor(v / 1000) * 1000)} style={{ width: '100%' }} />

                  
                  <div className="row draft-row" style={{ marginTop: 6 }}>
                    <button className="sm" disabled={maxAmt < 2000} onClick={() => setAmt(Math.floor(maxAmt / 2000) * 1000)}>절반</button>
                    <button className="sm" disabled={maxAmt < 1000} onClick={() => setAmt(maxAmt)}>최대 {fmtTroops(maxAmt)}</button>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => setSortieOpen(false)}>취소</button>
                    <button className="primary sortie-go" disabled={!pickG.length || Math.min(amt, maxAmt) < 1000} onClick={() => {
                      const r = act((s) => { const r = sortie(s, grid, selCastle.id, pickG, Math.min(amt, maxAmt)); return r; });
                      if (r?.ok) { setSortieOpen(false); setSel({ type: 'unit', id: r.unit.id }); setSheet(false); toast('부대가 나왔습니다. 지도에서 목적지·공격할 곳을 누르세요.'); }
                    }}>출진</button>
                  </div>
                </div>
              </CModal>
              {selCastle.kind !== 'pass' && (() => {
                const dm = draftMax14(game, selCastle), jobsN = Object.keys(ROLES).filter((r) => jobGen(game, selCastle, r)).length;
                const inbound = (game.convoys || []).filter((v) => v.to === selCastle.id).length;
                return (
                  <div className="act-grid">
                    <button className="act-tile" onClick={() => setCmodal('draft')}><span>💂 징병</span><small>{dm >= 1000 ? `최대 ${fmtTroops(dm)}` : '뽑을 인구 없음'}</small></button>
                    <button className="act-tile" onClick={() => setCmodal('recv')}><span>🚚 병력 받기</span><small>{inbound ? `오는 중 ${inbound}` : '다른 성에서'}</small></button>
                    <button className="act-tile" onClick={() => setCmodal('jobs')}><span>👔 내정</span><small title={selCastle.auto ? '담당관 자동 배치 중' : undefined}>{selCastle.auto ? `자동 ${jobsN}/${Object.keys(ROLES).length}` : `담당 ${jobsN}/${Object.keys(ROLES).length}`}</small></button>
                    <button className="act-tile" onClick={() => setCmodal('build')}><span>🏗️ 시설</span><small>{selCastle.build ? `공사 ${selCastle.build.left}순` : `${usedSlots(selCastle)}/${slotsOf(selCastle)}칸`}</small></button>
                    <button className="act-tile" onClick={() => setCmodal('fort')}><span>⛺ 야전 시설</span><small title="진지·망루·목책">진지·망루</small></button>
                  </div>
                );
              })()}
              <CModal open={cmodal === 'draft'} title="💂 징병" onClose={() => setCmodal(null)}>
                <div style={{ fontSize: 13 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><span>수비 <b>{fmtTroops(selCastle.troops)}</b> → <b className="hl">{fmtTroops(selCastle.troops + Math.min(draftAmt, draftMax14(game, selCastle)))}</b></span><small className="muted">보유 금 {fmtGold(me.gold)}<Help t={`1명당 ${draftCost(selCastle, game)}금. 뽑은 만큼 인구가 줄고 그 성 금 수입도 줄어요(인구가 바닥나면 절반). 이 성에서 지금 뽑을 수 있는 인구는 ${fmtTroops(draftLeft14(game, selCastle))}입니다.`} /></small></div>
                  <Slider min={0} max={draftMax14(game, selCastle)} step={1000} value={Math.min(draftAmt, draftMax14(game, selCastle))} onChange={(v) => setDraftAmt(Math.floor(v / 1000) * 1000)} style={{ width: '100%' }} />
                  <div className="row draft-row">
                    <button className="sm" disabled={draftMax14(game, selCastle) < 1000} onClick={() => setDraftAmt(Math.floor(draftMax14(game, selCastle) / 2000) * 1000)}>절반</button>
                    <button className="sm" disabled={draftMax14(game, selCastle) < 1000} onClick={() => setDraftAmt(draftMax14(game, selCastle))}>최대 {fmtTroops(draftMax14(game, selCastle))}</button>
                    <button className="primary sm" style={{ marginLeft: 'auto' }} disabled={Math.min(draftAmt, draftMax14(game, selCastle)) < 100} onClick={() => act((s) => draft14(s, selCastle.id, draftAmt))}>💂 {fmtTroops(Math.min(draftAmt, draftMax14(game, selCastle)))} 징병 <small style={{ opacity: 0.85 }}>· 금 {fmtGold(Math.min(draftAmt, draftMax14(game, selCastle)) * draftCost(selCastle, game))}</small></button>
                  </div>
                  
                </div>
              </CModal>
              <CModal open={cmodal === 'jobs'} title={<>👔 {selCastle.name} 내정<Help t="담당은 순마다 일합니다. 농업·상업은 정치, 징병은 통솔이 높을수록 효과가 큽니다. 다른 성 후보는 어느 성의 담당도 아닌 무력 85 이하 장수(그 성에 장수 2명·병력 1,500 이상이 남는 곳)이고, 부르면 병사를 조금 데리고 걸어와 도착하면 맡습니다." /></>} onClose={() => setCmodal(null)}>
                <div className="dev-lines">
                  <div><span>🌾 농업</span><span className="dev-bar"><i style={{ width: `${Math.round((selCastle.farm / Math.max(1, selCastle.devMax)) * 100)}%` }} /></span><small>{selCastle.farm}/{selCastle.devMax}</small></div>
                  <div><span>💰 상업</span><span className="dev-bar"><i style={{ width: `${Math.round((selCastle.trade / Math.max(1, selCastle.devMax)) * 100)}%` }} /></span><small>{selCastle.trade}/{selCastle.devMax}</small></div>
                </div>
                <label className="job-auto"><input type="checkbox" checked={!!selCastle.auto} disabled={playing} onChange={(e) => act((s) => { const c = s.castles[selCastle.id]; c.auto = e.target.checked; if (c.auto) autoJobs(s, c); })} /> 담당 자동 배치 <small className="muted">(머무는 장수 중 알맞은 사람으로, 순마다)</small></label>
                {Object.entries(ROLES).map(([role, label]) => {
                  const cur = jobGen(game, selCastle, role), k = role === 'draft' ? '통' : '정', kv = (g) => (role === 'draft' ? g.lead : g.pol);
                  const coming = !cur && selCastle.jobs?.[role] && game.generals[selCastle.jobs[role]]?.unit != null ? game.generals[selCastle.jobs[role]] : null;
                  const eff = cur ? (role === 'farm' ? `수확 +${Math.round(cur.pol * 0.5)}% · 인구 +${(cur.pol / 40).toFixed(1)}천 · 농업 +${Math.round(3 + cur.pol / 6)}` : role === 'trade' ? `금 +${Math.round(cur.pol * 0.5)}% · 상업 +${Math.round(3 + cur.pol / 6)}` : `자원병 +${fmtTroops(cur.lead * 3)}`) + ' /순' : role === 'draft' ? '없으면 자원병이 안 들어옴' : `없으면 ${label}이 안 늚`;
                  const here = castleGens.filter((g) => g.id !== cur?.id).map((g) => ({ g, d: 0 })).sort((a, b) => kv(b.g) - kv(a.g));
                  const far = jobCands(game, selCastle, role), key = `${selCastle.id}:${role}`, all = jobRecAll === key;
                  const rows = [...here, ...(all ? far : far.slice(0, 3))];
                  return (
                    <div key={role} className="job-sec">
                      <div className="job-sec-h"><b>{JOB_ICON[role]} {label}</b>{cur ? <span className="job-cur"><Face g={cur} size={20} col={me.color} />{cur.name} <b className="hl">{k}{kv(cur)}</b></span> : coming ? <span className="muted">🚶 {coming.name} 오는 중</span> : <span className="job-none">비어 있음</span>}</div>
                      <small className="muted job-eff1">{eff}</small>
                      {!selCastle.auto && rows.length > 0 && (
                        <div className="job-cands">
                          {rows.map(({ g, d }) => (
                            <div key={g.id} className="job-cand">
                              <Face g={g} size={22} col={me.color} />
                              <span className="jc-name">{g.name}</span>
                              <b className={'jc-stat' + (cur && kv(g) > kv(cur) ? ' up' : '')}>{k}{kv(g)}</b>
                              <small className="muted jc-where">{d ? `${game.castles[g.castle].name} ${d}칸` : '이 성'}{jobOf(g) ? ` · ${ROLES[jobOf(g)]} 담당` : ''}</small>
                              <button className="xs" disabled={playing} onClick={() => (d ? callForJob(selCastle.id, role, g.id) : act((s) => { const c = s.castles[selCastle.id]; c.jobs = c.jobs || {}; for (const r of Object.keys(ROLES)) if (c.jobs[r] === g.id) c.jobs[r] = null; c.jobs[role] = g.id; return { ok: true, msg: `${g.name}이(가) ${label}을 맡습니다` }; }))}>{d ? '부르기' : '맡기기'}</button>
                            </div>
                          ))}
                          {far.length > 3 && <button className="xs link" onClick={() => setJobRecAll(all ? null : key)}>{all ? '접기' : `다른 성 후보 모두 보기 (+${far.length - 3}명)`}</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CModal>
              <CModal open={cmodal === 'recv'} title={<>🚚 병력 받기<Help t="다른 내 성에서 장수 없이 병력만 받습니다. 수송대는 내 땅 길로 하루 1.5칸 가고, 이 성이 포위당하면 들어올 수 없어요." /></>} onClose={() => setCmodal(null)}>
                <div style={{ fontSize: 13 }}>
                    {besieged(game, grid, selCastle) ? <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>포위당해 수송대가 들어올 수 없습니다. 장수가 부대로 데리고 와야 합니다.</div> : <>
                      <div style={{ fontSize: 12, marginTop: 4 }}>받을 병력 {fmtTroops(sendAmt)} <small className="muted">(남은 자리 {fmtTroops(Math.max(0, capOf(selCastle, game) - selCastle.troops))})</small></div>
                      <Slider min={1000} max={30000} step={1000} value={sendAmt} onChange={(v) => setSendAmt(Math.floor(v / 1000) * 1000)} style={{ width: '100%' }} />
                      {(() => {
                        const donors = game.castles.filter((d) => d.owner === pid && d.id !== selCastle.id && d.troops >= 1500 && !(game.convoys || []).some((v) => v.from === d.id && v.to === selCastle.id)).map((d) => ({ d, dist: grid.dist(d.tile, selCastle.tile) })).sort((x, y) => x.dist - y.dist);
                        const allDon = donors.length, shownDon = donorsAll === selCastle.id ? donors : donors.slice(0, 5);
                        if (!donors.length) return <div className="muted" style={{ fontSize: 12 }}>보낼 수 있는 내 성이 없습니다.</div>;
                        return <>{shownDon.map(({ d, dist }) => { const amt = Math.min(sendAmt, Math.floor((d.troops - 500) / 1000) * 1000); return (
                          <div key={d.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                            <span>{d.name} <small className="muted">보유 {fmtTroops(d.troops)} · 약 {convoyDays(Math.ceil(dist * 1.15))}일</small></span>
                            <button className="sm" disabled={playing || amt < 1000} onClick={() => act((s) => sendTroops(s, grid, d.id, selCastle.id, amt))}>{fmtTroops(amt)} 받기</button>
                          </div>); })}
                          {allDon > 5 && <button className="sm" style={{ marginTop: 4 }} onClick={() => setDonorsAll(donorsAll === selCastle.id ? null : selCastle.id)}>{donorsAll === selCastle.id ? '접기' : `더보기 (+${allDon - 5}곳, 먼 순서)`}</button>}</>;
                      })()}
                    </>}
                  {(game.convoys || []).filter((v) => v.from === selCastle.id || v.to === selCastle.id).map((v, i) => <div key={i} className="muted" style={{ fontSize: 11 }}>🚚 {game.castles[v.from].name} → {game.castles[v.to].name} {fmtTroops(v.troops)} · {Math.max(0, v.arrive - absDay(game))}일 남음</div>)}
                </div>
              </CModal>
            </div>
          )}
          <div className="sec-h row" style={{ justifyContent: 'space-between' }}><span>👥 장수 {castleGens.length}명</span>{castleGens.length > 1 && <SortBar v={gsort} set={setGsort} />}</div>
          <div className="kv-free"><div className="gen-list">{castleGens.length ? shownGens.map((g) => (
              <div key={g.id} className="gen-row">
                <Face g={g} size={24} col={ownerColor(game, selCastle.owner)} />
                <GenCard g={g} loyal={selCastle.owner === pid} />
                {selCastle.owner === pid && !playing ? <button className="xs" title="다른 내 성으로 보내기 (지도에서 성을 누름)" onClick={() => { setSendGen(g.id); setSheet(false); toast(`${g.name}: 보낼 내 성을 지도에서 누르세요 (병력 ${fmtTroops(callAmt)} 데려감)`); }}>➡️</button> : <span />}
              </div>)) : <span className="muted">없음</span>}
              {castleGens.length > 3 && <button className="xs" style={{ marginTop: 4 }} onClick={() => setGenMore(genMore === selCastle.id ? null : selCastle.id)}>{genMore === selCastle.id ? '접기' : `더보기 (+${castleGens.length - 3}명)`}</button>}</div>
          </div>
          {(game.corps || []).filter((co) => co.cities.includes(selCastle.id)).map((co) => <div key={co.id} className="muted" style={{ fontSize: 12, marginTop: 4 }}>🎖️ {game.generals[co.leader]?.name} 군단이 맡은 도시입니다 (직접 출진도 가능)</div>)}
          {selCastle.kind !== 'pass' && selCastle.owner !== null && selCastle.owner !== pid && (
            <div className="sub-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><b>🏛️ 내정</b></div>
              <div className="dev-lines">
                <div><span>🌾 농업</span><span className="dev-bar"><i style={{ width: `${Math.round((selCastle.farm / Math.max(1, selCastle.devMax)) * 100)}%` }} /></span><small>{selCastle.farm}/{selCastle.devMax} · 수확 {fmtTroops(harvestOf(game, selCastle))}/년</small></div>
                <div><span>💰 상업</span><span className="dev-bar"><i style={{ width: `${Math.round((selCastle.trade / Math.max(1, selCastle.devMax)) * 100)}%` }} /></span><small>{selCastle.trade}/{selCastle.devMax} · 금 +{fmtGold(goldOf(game, selCastle))}/순</small></div>
              </div>
            </div>
          )}
          {selCastle.owner === pid && freeIn(selCastle).length > 0 && (
            <div className="sub-card">
              <b>🧑‍🎓 재야 인재</b>
              {freeIn(selCastle).filter((g) => !castleGens.length || Math.round(recruitChance(game, g, pid, selCastle.id) * 100) >= 1).map((g) => (
                <div key={g.id} className="line-row">
                  <span className="line-tx inline"><Face g={g} /><b>{g.name}</b><small className="muted"><Stats g={g} traits={false} /></small></span>
                  <button className="sm" disabled={playing || g.tried === game.turn || !castleGens.length} onClick={() => act((s) => recruit(s, g.id, pid))}>등용 {Math.round(recruitChance(game, g, pid, selCastle.id) * 100)}%</button>
                </div>
              ))}
              {!castleGens.length && <div className="muted" style={{ fontSize: 11 }}>이 도시에 내 장수가 있어야 설득할 수 있습니다.</div>}
            </div>
          )}
          {selCastle.owner !== pid && selCastle.owner !== null && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {game.nations[selCastle.owner].name} · 우호 {Math.round(relOf(game, pid, selCastle.owner))}{pactOf(game, pid, selCastle.owner) ? ` · ${PACT[pactOf(game, pid, selCastle.owner).type]} 중` : ''}
              {freeIn(selCastle).length ? ` · 재야 ${freeIn(selCastle).length}명` : ''}
            </div>
          )}
          {selCastle.owner !== pid && selCastle.owner !== null && enemy(game, pid, selCastle.owner) && !playing && (
            <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              <small className="muted" style={{ width: '100%' }}>🕵️ 계략 {selCastle.schemed === game.turn ? '(이번 순 사용함)' : ''}</small>
              {Object.entries(SCHEMES).map(([k, sc]) => (
                <button key={k} className="sm" title={sc.desc} disabled={selCastle.schemed === game.turn || me.gold < sc.cost || schemeChance(game, pid, selCastle, k) <= 0} onClick={() => act((s) => doScheme(s, pid, selCastle.id, k))}>{sc.icon} {sc.name} {Math.round(schemeChance(game, pid, selCastle, k) * 100)}% · {fmtGold(sc.cost)}</button>
              ))}
            </div>
          )}
          {selCastle.owner !== null && (selCastle.owner === pid || Object.keys(selCastle.bld || {}).length > 0) && (
            selCastle.owner === pid ? (
            <CModal open={cmodal === 'build'} title={`🏗️ ${selCastle.name} 시설 · ${usedSlots(selCastle)}/${slotsOf(selCastle)}칸`} onClose={() => setCmodal(null)}>
              {selCastle.founding && <div>🔨 새 도시 공사 중 — {selCastle.founding}순 남음</div>}
              {selCastle.build && (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🔨 {BUILDINGS[selCastle.build.type].icon} {BUILDINGS[selCastle.build.type].name} — {selCastle.build.left}순 남음</span>
                  {selCastle.owner === pid && !playing && <button className="sm" onClick={() => act((s) => cancelBuild(s, selCastle.id))}>멈춤</button>}
                </div>
              )}
              {Object.entries(BUILDINGS).filter(([k, b]) => (selCastle.kind !== 'pass' || k === 'wall') && (!b.port || selCastle.port)).map(([k, b]) => {
                const why = canBuild(game, selCastle, k);
                return (
                  <div key={k} className="line-row">
                    <span className="line-tx" title={b.desc}><b>{b.icon} {b.name} <small className="muted">{lv(selCastle, k)}/{b.max}</small></b><small className="muted">{b.desc}</small></span>
                    {selCastle.owner === pid && !playing && lv(selCastle, k) < b.max && <button className="sm" disabled={!!why} title={why || ''} onClick={() => act((s) => startBuild(s, selCastle.id, k))}>짓기 {fmtGold(buildCost(game, selCastle, k))} · {b.turns}순</button>}
                  </div>
                );
              })}
            </CModal>
            ) : (
            <details className="sub-card" open={!!selCastle.build}>
              <summary className="row" style={{ justifyContent: 'space-between' }}><b>🏗️ 시설 {selCastle.build ? '· 🔨 공사 중' : ''}</b><small className="muted">{usedSlots(selCastle)}/{slotsOf(selCastle)}칸</small></summary>
              {selCastle.founding && <div>🔨 새 도시 공사 중 — {selCastle.founding}순 남음</div>}
              {selCastle.build && (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🔨 {BUILDINGS[selCastle.build.type].icon} {BUILDINGS[selCastle.build.type].name} — {selCastle.build.left}순 남음</span>
                  {selCastle.owner === pid && !playing && <button className="sm" onClick={() => act((s) => cancelBuild(s, selCastle.id))}>멈춤</button>}
                </div>
              )}
              {Object.entries(BUILDINGS).filter(([k, b]) => (selCastle.kind !== 'pass' || k === 'wall') && (!b.port || selCastle.port)).map(([k, b]) => {
                const why = canBuild(game, selCastle, k);
                return (
                  <div key={k} className="line-row">
                    <span className="line-tx" title={b.desc}><b>{b.icon} {b.name} <small className="muted">{lv(selCastle, k)}/{b.max}</small></b><small className="muted">{b.desc}</small></span>
                    {selCastle.owner === pid && !playing && lv(selCastle, k) < b.max && <button className="sm" disabled={!!why} title={why || ''} onClick={() => act((s) => startBuild(s, selCastle.id, k))}>짓기 {fmtGold(buildCost(game, selCastle, k))} · {b.turns}순</button>}
                  </div>
                );
              })}
            </details>
            )
          )}
          {selCastle.owner === pid && !playing && selCastle.kind !== 'pass' && (
            <CModal open={cmodal === 'fort'} title={<>⛺ 야전 시설 짓기<Help t="장수 없이 성 수비대가 이 성 관할의 내 땅(초록 칸)에 짓습니다. 성마다 시설 3개·망루 2개까지, 공격받는 중엔 못 지어요. 고른 뒤 지도에서 자리를 누르세요." /></>} onClose={() => setCmodal(null)}>
                  {Object.entries(FORTS).map(([k, f]) => (
                    <div key={k} className="line-row">
                      <span className="line-tx"><b>{f.icon} {f.name} <small className="muted">금 {fmtGold(f.cost)} · {f.days ? `${f.days}일` : '바로'}</small></b><small className="muted">{f.desc}</small></span>
                      <button className="sm" disabled={me.gold < f.cost} onClick={() => { setPlaceFort({ cid: selCastle.id, kind: k }); setCmodal(null); setSheet(false); toast(`${f.name} 지을 자리를 지도에서 누르세요`); }}>짓기</button>
                    </div>
                  ))}
            </CModal>
          )}
        </div>
      )}
      {selFort && (
        <div className="card">
          <h3 style={{ margin: '0 0 6px' }}>{FORTS[selFort.kind].icon} {FORTS[selFort.kind].name} <small className="muted">{game.nations[selFort.owner]?.name}</small></h3>
          <div className="kv">
            <span>내구</span><span>{Math.max(0, Math.round(selFort.hp))} / {selFort.maxHp}</span>
            <span>효과</span><span>{FORTS[selFort.kind].desc}</span>
            {selFort.left > 0 && <><span>공사</span><span>{selFort.left}일 남음</span></>}
          </div>
          {selFort.owner !== pid && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>내 부대를 고른 뒤 이 시설을 누르면 부수러 갑니다.</div>}
        </div>
      )}
      {selUnit && (() => {
        const gs = gensOf(game, selUnit.gens), st = unitStats(game, selUnit);
        const tgt = selUnit.order ? (selUnit.order.kind === 'castle' ? game.castles[selUnit.order.id]?.name : selUnit.order.kind === 'unit' ? `${gensOf(game, unitById(selUnit.order.id)?.gens || [])[0]?.name || '?'} 부대` : '지정한 곳') : '없음';
        const days = selUnit.path.length ? Math.ceil(selUnit.path.reduce((a, t, i) => a + Math.min(3, moveCost(grid, i ? selUnit.path[i - 1] : selUnit.tile, t, game, selUnit)), 0) / speedOf(game, selUnit)) : 0;
        return (
          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>⚑ {gs.map((g) => g.name).join('·')} 부대 <small className="muted">{game.nations[selUnit.nation].name}</small></h3>
            <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              {gs.map((g) => <div key={g.id} style={{ textAlign: 'center', fontSize: 11 }}><Face g={g} size={52} col={game.nations[selUnit.nation].color} /><div>{g.name}</div><div className="muted"><Stats g={g} keys={['war', 'lead', 'intel']} /></div>
                {selUnit.nation === pid && gs.length > 1 && <button className="sm" disabled={playing} title="이 장수를 떼어 병력을 나눠 옆 칸에 세움" onClick={() => act((s) => splitUnit(s, grid, selUnit.id, g.id))}>✂️ 나누기</button>}</div>)}
            </div>
            {(() => { const hid = selUnit.nation !== pid && troopsHidden(game) && !sightOf(game, grid)[selUnit.tile]; const tp = Math.round((selUnit.troops / Math.max(1, selUnit.max)) * 100); return (
              <div className="stat-tiles">
                <div><small>병력</small><b>{hid ? '?' : fmtTroops(selUnit.troops)}</b><span className="mini-bar"><i style={{ width: `${hid ? 0 : tp}%`, background: '#6fd37f' }} /></span></div>
                {selUnit.outlaw ? <div title="도적은 사기가 없어 꺾이지 않고 끝까지 싸웁니다"><small>사기</small><b>—</b><small>도적</small></div> : <div className={selUnit.morale < 30 ? 'warn' : ''} title="5 이하면 패주 · 내 땅에서 쉬면 +3/일, 진지 안 +6/일"><small>사기</small><b>{Math.round(selUnit.morale)}</b><span className="mini-bar"><i style={{ width: `${Math.round(selUnit.morale)}%`, background: '#5a8dee' }} /></span></div>}
                <div><small>공·방</small><b>{Math.round(st.atk)}·{Math.round(st.def)}</b><small>{selUnit.siege ? '⚙️ 공성병기' : '\u00a0'}</small></div>
                <div className={selUnit.cut ? 'warn' : ''}><small>보급</small><b>{selUnit.cut ? '끊김' : '이어짐'}</b><small>{selUnit.cut ? '병력·사기 감소' : TERRAIN_NAME[grid.terrain[selUnit.tile]] || '\u00a0'}</small></div>
              </div>); })()}
            <div className="kv">
              <span>전법</span><span>{gs.map(tacticName).filter(Boolean).join(', ') || '없음'}</span>
              <span>특성</span><span>{gs.flatMap((g) => g.traits || []).length ? gs.map((g) => <Traits key={g.id} g={g} />) : '없음'}</span>
              <span>목표</span><span>{tgt}{days ? ` (약 ${days}일)` : ''}</span>
              {selUnit.queue?.length > 0 && <><span>경유지</span><span>{selUnit.queue.map((q, i) => `${i + 1}. ${q.kind === 'castle' ? (game.castles[q.id]?.owner === selUnit.nation ? `${game.castles[q.id]?.name} 입성` : `${game.castles[q.id]?.name} 공략`) : q.kind === 'unit' ? `${gensOf(game, game.units.find((x) => x.id === q.id)?.gens || [])[0]?.name || '적'} 부대 공격` : q.kind === 'fort' ? '시설 파괴' : '이동'}`).join(' → ')} <small className="muted">(최대 8개 · 목표가 사라지면 다음으로)</small></span></>}
            </div>
            {selUnit.nation === pid && !playing && (
              <>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>지도를 눌러: 이동 · 공격 · 공략 · 입성</div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <button onClick={() => act((s) => { const u = s.units.find((x) => x.id === selUnit.id); const h = nearestCastle(s, grid, u.tile, pid); return h ? order(s, grid, u, 'castle', h.id) : { ok: false, msg: '돌아갈 성이 없습니다.' }; })}>🏠 귀환</button>
                  <button onClick={() => act((s) => { const u = s.units.find((x) => x.id === selUnit.id); u.path = []; u.order = null; return { ok: true, msg: '정지' }; })}>✋ 정지</button>
                </div>
                <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                  {!selUnit.siege && <button className="sm" disabled={me.gold < SIEGE_COST} title="성벽 5배로 깎음 · 느려지고 들판 싸움에 약함 · 함락하면 부서짐" onClick={() => act((s) => buildSiege(s, selUnit.id))}>⚙️ 공성병기 만들기 {fmtGold(SIEGE_COST)}</button>}
                  {gs.length > 1 && <button className="sm" title="장수마다 한 부대씩, 병력을 똑같이 나눔" onClick={() => act((s) => splitAll(s, grid, selUnit.id))}>✂️ 모두 나누기 ({gs.length}부대)</button>}
                </div>
                {(() => {
                  const building = (game.forts || []).find((f) => f.builder === selUnit.id && f.left > 0);
                  if (building) return <div style={{ fontSize: 12, marginTop: 6 }}>🔨 {FORTS[building.kind].icon} {FORTS[building.kind].name} 짓는 중 — {building.left}일 남음 (움직이면 취소)</div>;
                  return (
                    <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {Object.entries(FORTS).map(([k, f]) => {
                        const why = fortCheck(game, grid, selUnit, k);
                        return <button key={k} className="sm" disabled={!!why} title={why || f.desc} onClick={() => act((s) => startFort(s, grid, s.units.find((x) => x.id === selUnit.id), k))}>{f.icon} {f.name} {fmtGold(f.cost)}·{f.days}일</button>;
                      })}
                    </div>
                  );
                })()}
                <details className="tip-more"><summary>⛺ 진지·망루·목책은?</summary><div className="muted">진지: 안의 아군 피해 −30%·보급 거점·사기 회복 · 망루: 2칸 안 적 부대 매일 공격 · 목책: 바로 세움, 적이 못 지나가고 옆에 온 적은 그날 멈춤(이동하며 여러 개로 길 막기). 진지·망루는 부대가 그 칸에 멈춰 지어야 합니다.</div></details>
              </>
            )}
          </div>
        );
      })()}
      {!selCastle && !selUnit && !selFort && (
        <>
          {tab === 'home' && (
            <div className="card home-card" style={{ fontSize: 13 }}>
              {(() => {
                const gs = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active');
                const ng = gs.filter((g) => !g.ruler), avg = ng.length ? Math.round(ng.reduce((a, g) => a + loyalOf(g), 0) / ng.length) : 100, low = ng.filter((g) => loyalOf(g) < 40);
                const foodTurns = use > 0 ? Math.floor(food / use) : 99;
                return (
                  <div className="stat-tiles two">
                    <div data-tip={`순마다 들어오는 금 (세금·상업 − 유지비) · 지금 ${fmtGold(me.gold)}`}><small>순마다 금</small><b>{inc >= 0 ? '+' : ''}{fmtGold(inc)}</b></div>
                    <div className={foodTurns < turnsToHarvest ? 'warn' : ''} data-tip={`병량 ${fmtTroops(food)} · 순마다 −${fmtTroops(use)} · 수확까지 ${turnsToHarvest}순`}><small>병량 버팀</small><b>{foodTurns >= 99 ? '넉넉' : `${foodTurns}순`}</b></div>
                    <div data-tip={`성 수비와 나가 있는 부대를 합친 병력 · 장수 ${gs.length}명`}><small>병력</small><b>{fmtTroops(powerOf(game, pid))}</b></div>
                    <div className={low.length ? 'warn' : ''} data-tip={low.length ? `충성 40 미만(떠날 수 있음): ${low.map((g) => g.name).join(', ')}` : `장수 ${gs.length}명 · 충성 평균 ${avg} — 40 아래면 떠날 수 있어요`}><small>장수 {gs.length}명</small><b>충성 {avg}{low.length ? <i> 불만 {low.length}</i> : null}</b></div>
                  </div>
                );
              })()}
              <div className="sec-h">⚡ 빠른 작업</div>
              <div className="qa-grid">
                <button className="qa" disabled={playing || me.gold < rewardCost(game, pid)} title="충성 35 아래면 다른 나라로 떠날 수 있습니다. 금이 바닥나면 충성이 떨어집니다." onClick={() => act((s) => rewardAll(s, pid))}>🎁 전체 포상<small>금 {fmtGold(rewardCost(game, pid))} · 충성 +12</small></button>
                <button className="qa" disabled={playing || !spreadPlan.length} title="장수가 몰린 성에서 모자란 성으로 보냅니다 (전선 성 4명·후방 3명 목표, 군주·담당관은 그대로). 무관(무력 75 이상, 또는 무력이 정치보다 10 넘게 높음)은 전선 성으로만, 후방 성에는 문관만 보냅니다. 누르면 어디서 어디로 가는지 먼저 보여 줍니다" onClick={spreadGens}>👥 장수 나누기<small>{spreadPlan.length ? `${spreadPlan.length}명 옮길 수 있음` : '고르게 있음'}</small></button>
                {(() => { const off = game.castles.filter((c) => c.owner === pid && c.kind !== 'pass' && !c.auto); return <button className="qa" disabled={playing || !off.length} title="모든 내 성의 농업·상업·징병 담당을 머무는 장수 중에서 알아서 고르게 합니다 (새로 얻는 성은 성마다 따로 켬). 상업·농업은 누구든 맡으면 상한까지 오르고, 징병은 통솔이 높을수록 자원병이 많습니다" onClick={() => act((s) => { let k = 0; for (const c of s.castles) if (c.owner === pid && c.kind !== 'pass' && !c.auto) { c.auto = true; autoJobs(s, c); k++; } return { ok: k > 0, msg: `${k}개 성: 업무를 알아서 맡깁니다` }; })}>👔 업무 알아서<small>{off.length ? `${off.length}곳 아직 수동` : '모든 성 켜짐'}</small></button>; })()}
                <button className="qa" disabled={playing || !todos.some((t) => t.id === 'rec')} onClick={recruitAll} title="내 성의 재야와 내 포로 모두에게 등용을 권합니다">⭐ 모두 등용<small>{(todos.find((t) => t.id === 'rec')?.title || '').match(/\d+명/)?.[0] || '없음'}</small></button>
              </div>
              <details className="sec" open>
                <summary className="sec-h">🏯 내 성 {game.castles.filter((c) => c.owner === pid).length}곳 <small className="muted">눌러서 그 성으로</small></summary>
                {(() => {
                  const { list, threat, gn, gold } = cityRows;
                  const H = ({ k, children }) => <th className={'sortable' + (csort === k ? ' on' : '')} onClick={() => setCsort(k)}>{children}{csort === k ? ' ▾' : ''}</th>;
                  return (
                    <table className="city-table">
                      <thead><tr><H k="name">도시</H><H k="troops">병력</H><H k="gens">장수</H><H k="gold">수입</H><H k="threat">위협</H></tr></thead>
                      <tbody>
                        {list.map((c) => { const th = threat(c); return (
                          <tr key={c.id} className="clickable" onClick={() => { goTo(c); }}>
                            <td>{c.kind === 'pass' ? '⛩️' : c.capital ? '♛' : ''}{c.port ? '⚓' : ''}{c.name}{(game.corps || []).some((co) => co.cities.includes(c.id)) ? ' 🎖️' : ''}{c.build ? ' 🔨' : ''}</td>
                            <td>{fmtTroops(c.troops)}</td>
                            <td>{gn(c)}</td>
                            <td>{c.kind === 'pass' ? '-' : fmtGold(gold(c))}</td>
                            <td className={th > c.troops * 0.6 ? 'bad' : th ? 'warn' : 'muted'}>{th ? fmtTroops(th) : '·'}</td>
                          </tr>); })}
                      </tbody>
                    </table>
                  );
                })()}
              </details>
              <div className="sec-h">🏪 시장 · 개척</div>
              <div className="qa-grid three">
                <button className="qa" disabled={playing || me.gold < 10000} onClick={() => act((s) => trade(s, pid, 'buy', 10000))}>🌾 병량 사기<small>금 1만 → {fmtTroops(10000 * MARKET.buy)}</small></button>
                <button className="qa" disabled={playing || food < 10000} onClick={() => act((s) => trade(s, pid, 'sell', 10000))}>💰 병량 팔기<small>1만 → 금 {fmtGold(10000 * MARKET.sell)}</small></button>
                <button className="qa" disabled={playing || me.gold < FOUND_COST} onClick={() => { setFounding(true); setSheet(false); toast('지도에서 새 도시 자리를 누르세요.'); }}>🏗️ 새 도시<small>금 {fmtGold(FOUND_COST)} · {FOUND_TURNS}순</small></button>
              </div>
              <div className="sec">
                <div className="row sec-h" style={{ justifyContent: 'space-between' }}><span>📜 정책</span><small className="muted">{(me.policies || []).length}/{policySlots(game, pid)}칸 · 펼칠 때 금 {fmtGold(POLICY_COST)}, 순마다 {fmtGold(POLICY_UPKEEP)}</small></div>
                {Object.entries(POLICIES).map(([k, p]) => {
                  const on = (me.policies || []).includes(k);
                  return (
                    <div key={k} className={'pol-row' + (on ? ' on' : '')}>
                      <span className="pol-tx"><b>{p.icon} {p.name}</b><small className="muted">{p.desc}</small></span>
                      {on ? <button className="sm" disabled={playing} onClick={() => act((s) => dropPolicy(s, pid, k))}>거두기</button> : <button className="sm" disabled={playing || (me.policies || []).length >= policySlots(game, pid) || me.gold < POLICY_COST} onClick={() => act((s) => adoptPolicy(s, pid, k))}>펼치기</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tab === 'diplo' && (
            <div className="card" style={{ fontSize: 13 }}>
              {(() => {
                const e = envoyOf(game, pid);
                return <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>🕊️ 사신 {e.g ? <><Face g={e.g} col={me.color} /> {e.g.name} (정치 {e.pol})</> : '없음'} — 제안 성공률 {e.bonus >= 0 ? '+' : ''}{Math.round(e.bonus * 100)}%, 친선 효과 ×{e.mult.toFixed(2)} <small>(정치 높은 장수가 성에 있으면 맡음)</small></div>;
              })()}
              {(() => {
                // 우리 나라 순위 (도시 수, 같으면 병력)
                const cityN = (id) => game.castles.filter((c) => c.owner === id && c.kind !== 'pass').length;
                const ranked = game.nations.filter((n) => n.alive && !n.horde).sort((a, b) => cityN(b.id) - cityN(a.id) || powerOf(game, b.id) - powerOf(game, a.id));
                const rk = ranked.findIndex((n) => n.id === pid) + 1;
                const pacts = (game.pacts || []).filter((x) => x.until > game.turn && (x.a === pid || x.b === pid));
                return (
                  <div className="diplo-head">
                    <div><b>🏆 우리 순위 {rk}위</b> <small className="muted">/ {ranked.length}나라 · 도시 {cityN(pid)} · 병력 {fmtTroops(powerOf(game, pid))}</small></div>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {pacts.length ? pacts.map((x) => { const o = x.a === pid ? x.b : x.a; return <span key={o} className={'pact-pill ' + x.type}>{x.type === 'ally' ? '🤝' : x.type === 'vassal' ? '👑' : '🕊️'} {game.nations[o].name} {x.type === 'vassal' ? (x.a === pid ? '(우리 속국)' : '(종주국)') : PACT[x.type]}{x.type !== 'vassal' ? ` ${x.until - game.turn}순` : ''}</span>; }) : <small className="muted">맺은 약조 없음</small>}
                    </div>
                  </div>
                );
              })()}
              {(() => {
              // 맞닿은 나라(내 성에서 12칸 안에 성이 있는 나라)를 위에, 멀리 있는 나라는 접어 둠
              const R12 = 12 * (grid.k || 1), mineC = game.castles.filter((c) => c.owner === pid);
              const others = game.nations.filter((n) => n.alive && !n.horde && n.id !== pid).sort((a, b) => powerOf(game, b.id) - powerOf(game, a.id));
              const isNear = (n) => game.castles.some((c) => c.owner === n.id && mineC.some((m) => grid.dist(m.tile, c.tile) <= R12));
              const atWar = (n) => game.units.some((u) => (u.nation === n.id && u.order?.kind === 'castle' && game.castles[u.order.id]?.owner === pid) || (u.nation === pid && u.order?.kind === 'castle' && game.castles[u.order.id]?.owner === n.id));
              const near = others.filter(isNear), far = others.filter((n) => !isNear(n));
              const row = (n) => {
                const p = pactOf(game, pid, n.id), r = Math.round(relOf(game, pid, n.id));
                return (
                  <div key={n.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b><span className="chip" style={{ background: n.color }} /> {n.name}{!p && atWar(n) && <span className="pact-pill war" style={{ marginLeft: 6 }}>⚔️ 교전 중</span>}{p && <span className={'pact-pill ' + p.type} style={{ marginLeft: 6 }}>{p.type === 'ally' ? '🤝 동맹' : p.type === 'vassal' ? (p.a === pid ? '👑 우리 속국' : '👑 우리 종주국') : '🕊️ 정전'}{p.type !== 'vassal' ? ` ${p.until - game.turn}순` : ''}</span>}</b>
                      <small className="muted">{game.castles.filter((c) => c.owner === n.id && c.kind !== 'pass').length}도시 · {fmtTroops(powerOf(game, n.id))}</small>
                    </div>
                    <div style={{ height: 5, background: '#0006', borderRadius: 3, margin: '4px 0' }}><div style={{ width: `${r}%`, height: '100%', background: r >= 60 ? '#6fd37f' : r >= 30 ? '#e8c35a' : '#e2655a', borderRadius: 3 }} /></div>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <small>우호 {r}{STRATS[n.strat] ? <span title={STRATS[n.strat].desc}> · 전략 {STRATS[n.strat].name}{n.focus !== null && n.focus !== undefined && game.nations[n.focus] ? `(${n.focus === pid ? '우리' : game.nations[n.focus].name} 노림)` : ''}</span> : null}</small>
                      <span style={{ marginLeft: 'auto' }} />
                      {giftSizes(game, pid, n.id).map((amt, i) => <button key={i} className="sm" disabled={playing || me.gold < amt} title={`우호 +${giftGain(game, pid, n.id, amt)}`} onClick={() => act((s) => gift(s, pid, n.id, amt))}>🎁 {fmtGold(amt)} (+{giftGain(game, pid, n.id, amt)})</button>)}
                      {p && p.type !== 'vassal' && p.until - game.turn <= RENEW_WINDOW && <button className="sm primary" disabled={playing || me.lastAsk?.[n.id] === game.turn} title="끝나기 전에 같은 약조를 이어 감" onClick={() => act((s) => renewPact(s, pid, n.id))}>🔁 연장 요청 {Math.round(renewChance(game, pid, n.id) * 100)}% ({p.until - game.turn}순 남음)</button>}
                      {!p && Math.round(acceptChance(game, pid, n.id, 'ally') * 100) >= 1 && <button className="sm" disabled={playing || me.lastAsk?.[n.id] === game.turn} onClick={() => act((s) => propose(s, pid, n.id, 'ally'))}>동맹 {Math.round(acceptChance(game, pid, n.id, 'ally') * 100)}%</button>}
                      {!p && Math.round(acceptChance(game, pid, n.id, 'truce') * 100) >= 1 && <button className="sm" disabled={playing || me.lastAsk?.[n.id] === game.turn} onClick={() => act((s) => propose(s, pid, n.id, 'truce'))}>정전 {Math.round(acceptChance(game, pid, n.id, 'truce') * 100)}%</button>}
                      {(() => {
                        // 속국·항복: 힘 차이가 클 때만 버튼이 나옴
                        const asked = playing || me.lastAsk?.[n.id] === game.turn;
                        const vc = vassalChance(game, pid, n.id), pc = protectChance(game, pid, n.id), sc = surrenderChance(game, pid, n.id);
                        return <>
                          {!p && vc >= 0.005 && <button className="sm" disabled={asked} title="받아들이면 서로 치지 않고, 순마다 금 수입의 15%를 바치며 우리 전쟁을 돕습니다" onClick={() => act((s) => demandVassal(s, pid, n.id))}>👑 속국 요구 {Math.round(vc * 100)}%</button>}
                          {sc >= 0.005 && <button className="sm" disabled={asked} title="받아들이면 도시·장수·부대가 모두 우리 것이 됩니다" onClick={() => act((s) => urgeSurrender(s, pid, n.id))}>🏳️ 항복 권유 {Math.round(sc * 100)}%</button>}
                          {!p && pc >= 0.005 && lordOf(game, pid) === null && <button className="sm" disabled={asked} title="그 나라가 우리를 치지 않게 되고, 순마다 금 수입의 15%를 바칩니다" onClick={async () => { if (await uiConfirm(`${n.name}의 속국이 될까요? 순마다 금 수입의 15%를 바칩니다.`)) act((s) => askProtection(s, pid, n.id)); }}>🙇 속국 되기 {Math.round(pc * 100)}%</button>}
                          {p?.type === 'vassal' && p.b === pid && <button className="sm danger" disabled={playing} onClick={async () => { if (await uiConfirm('독립을 선언할까요? 우호가 크게 떨어집니다.')) act((s) => declareIndependence(s, pid)); }}>⚔️ 독립 선언</button>}
                        </>;
                      })()}
                    </div>
                  </div>
                );
              };
              return <>
                <div className="sec-h">🗺️ 맞닿은 나라 {near.length} <small className="muted">내 성에서 12칸 안</small></div>
                {near.length ? near.map(row) : <div className="muted" style={{ fontSize: 12 }}>없음</div>}
                {far.length > 0 && <details className="sec dip-far"><summary className="sec-h">🌍 멀리 있는 나라 {far.length}</summary>{far.map(row)}</details>}
              </>;
              })()}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>동맹(1년)·정전(반년) 중에는 서로 칠 수 없습니다. 친선은 1만에 우호 +10, 3만에 +30(괄호 안이 우호 상승). 약조가 끝나기 3순 전과 끝날 때 알려 드립니다. 도시를 빼앗으면 우호가 크게 떨어집니다.</div>
            </div>
          )}
          {tab === 'people' && (
            <div className="card" style={{ fontSize: 13 }}>
              {(() => {
                const mine = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active').sort((a, b) => gsortKey(gsort)(b) - gsortKey(gsort)(a));
                const list = peopleAll ? mine : mine.slice(0, 8);
                return (
                  <details className="my-gens" open={myGensOpen} onToggle={(e) => setMyGensOpen(e.currentTarget.open)}>
                    <summary><b>👥 내 장수 {mine.length}명</b> <small className="muted">눌러서 그 장수가 있는 곳으로</small></summary>
                    <SortBar v={gsort} set={setGsort} />
                    {list.map((g) => { const c = g.castle != null ? game.castles[g.castle] : null, u = g.unit != null ? game.units.find((x) => x.id === g.unit) : null; return (
                      <div key={g.id} className="gen-row clickable" role="button" tabIndex={0} onClick={() => { if (u) { setSel({ type: 'unit', id: u.id }); focusTile(u.tile); } else if (c) goTo(c); }}>
                        <Face g={g} size={24} col={me.color} />
                        <GenCard g={g} />
                        <small className="muted gen-where">{u ? `⚑ 출진 중` : c ? c.name : ''}</small>
                      </div>); })}
                    {mine.length > 8 && <button className="xs" style={{ marginTop: 4 }} onClick={() => setPeopleAll((v) => !v)}>{peopleAll ? '접기' : `모두 보기 (+${mine.length - 8}명)`}</button>}
                  </details>
                );
              })()}
              {(() => {
                const cand = Object.values(game.generals).filter((g) => g.tried !== game.turn && !isRuler(g) && ((g.status === 'free' && game.castles[g.castle]?.owner === pid) || (g.status === 'prisoner' && g.captor === pid)) && recruitChance(game, g, pid, g.status === 'free' ? g.castle : undefined) >= 0.01);
                return (
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="muted">이번 순 설득할 수 있는 재야·포로 <b style={{ color: 'var(--text)' }}>{cand.length}명</b></span>
                    <button className="primary sm" disabled={playing || !cand.length} title="내 성에 있는 재야 장수와 내 포로 모두에게 한 번씩 등용을 권합니다 (사람마다 순에 한 번)" onClick={recruitAll}>⭐ 재야·포로 모두 등용</button>
                  </div>
                );
              })()}
              <b>⛓️ 포로</b>
              {!myPrisoners.length && <div className="muted">없음</div>}
              {myPrisoners.map((g) => (
                <div key={g.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <div><Face g={g} /> {g.name} <small className="muted">({game.nations[g.nation]?.name || '재야'}){g.heldAt != null && game.castles[g.heldAt] ? ` · ${game.castles[g.heldAt].name}에 갇힘(등용하면 그 성에서 일함)` : ''} <Stats g={g} /></small></div>
                  <div className="row" style={{ gap: 4 }}>
                    {isRuler(g) ? <small className="muted">군주라 등용 불가</small> : Math.round(recruitChance(game, g, pid) * 100) >= 1 && <button className="sm" disabled={playing || g.tried === game.turn} onClick={() => act((s) => recruit(s, g.id, pid))}>등용 {Math.round(recruitChance(game, g, pid) * 100)}%</button>}
                    <button className="sm" disabled={playing} onClick={() => act((s) => release(s, g.id))}>{isRuler(g) && !game.nations[g.nation]?.alive ? '석방 (은거)' : '그냥 석방 (우호+)'}</button>
                    <button className="sm danger" disabled={playing} onClick={() => act((s) => execute(s, g.id))}>처단</button>
                  </div>
                  {game.nations[g.nation]?.alive && (() => {
                    const val = ransomValue(g), purse = Math.floor(game.nations[g.nation].gold / 1000) * 1000;
                    if (purse < 1000) return <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>💰 {game.nations[g.nation].name}에 금이 없어(금 {fmtGold(game.nations[g.nation].gold)}) 지금은 몸값을 낼 수 없습니다.</div>;
                    // 상대가 가진 금보다 비싸게는 못 부름 (넘으면 0%) — 슬라이더도 상대 금까지만
                    const top = Math.max(1000, Math.min(Math.round(val * 2 / 1000) * 1000, purse)), price = Math.min(ransomAsk[g.id] ?? Math.min(val, purse), top);
                    const ch = ransomChance(game, g, price);
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 12 }}>💰 몸값 {fmtGold(price)} <small className="muted">· 받아들일 확률 {Math.round(ch * 100)}% · 가치 약 {fmtGold(val)} · {game.nations[g.nation].name} 금 {fmtGold(game.nations[g.nation].gold)}{purse < val ? ' (가치만큼은 못 냄)' : ''}</small></div>
                        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
                          <Slider min={1000} max={Math.max(2000, top)} step={1000} value={price} onChange={(v) => setRansomAsk((m) => ({ ...m, [g.id]: v }))} style={{ flex: 1, minWidth: 0 }} />
                          <button className="sm primary" disabled={playing || g.ransomAsked === game.turn || ch <= 0} onClick={() => act((s) => offerRansom(s, pid, g.id, price))}>몸값 제안</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
              <b style={{ display: 'block', marginTop: 10 }}>🧑‍🎓 내 도시의 재야</b>
              {game.castles.filter((c) => c.owner === pid).flatMap((c) => freeIn(c).map((g) => [c, g])).map(([c, g]) => (
                <div key={g.id} className="row clickable" style={{ justifyContent: 'space-between', padding: '3px 0' }} onClick={() => goTo(c)}>
                  <span>{g.name} <small className="muted">{c.name} · <Stats g={g} /></small></span>
                  <span>›</span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>재야는 그 도시를 눌러 등용합니다(그 도시 장수 정치가 높을수록 잘 됨). 다른 나라 도시의 재야는 그 도시를 빼앗아야 데려올 수 있습니다.</div>
            </div>
          )}
          {tab === 'help' && (
            <div className="card muted help-box" style={{ fontSize: 13 }} ref={helpRef}>
              <div className="build-info" title={`빌드: ${BUILD.built} (한국 시간)`}>🏷️ 판 {versionText}{BUILD.msg ? <><br />마지막 커밋: {BUILD.msg}</> : null}</div>
              <input type="search" id="help-q" className="help-search" placeholder="🔍 도움말 검색 (예: 망루, 정전, 보급)" value={helpQ} onChange={(e) => setHelpQ(e.target.value)} />
              {helpQ.trim() && helpHits === 0 && <div className="help-none">「{helpQ.trim()}」에 맞는 도움말이 없습니다.</div>}
              내 도시를 눌러 <b>출진</b>하고, 깃발(부대)을 고른 뒤 지도를 눌러 명령하세요. <b>하루 진행</b>을 누를 때마다 모든 부대가 하루씩 함께 움직이니 매일 명령을 바꿀 수 있습니다. 수입·수확 정산은 10일(1순)마다, 「⏩ 순 끝까지」는 한 번에 넘김.
              <div className="muted" style={{ margin: '6px 0', fontSize: 12.5 }}>🎓 튜토리얼은 처음 화면(🚪 나가기)의 「튜토리얼 시작」에서 언제든 다시 할 수 있어요.</div>
              <div className="kbd-help">⌨️ PC 단축키: <kbd>Space</kbd> 진행(고른 날 수) · <kbd>Shift</kbd>+<kbd>Space</kbd> 순 끝까지 · <kbd>1</kbd>~<kbd>5</kbd> 탭 · <kbd>T</kbd> 할 일 · <kbd>P</kbd> 패널 접기 · <kbd>Esc</kbd> 선택 해제</div>
              <details className="trait-list">
                <summary>📜 특성 {Object.keys(T14).length}가지와 효과 (Ⅰ / Ⅱ / Ⅲ)</summary>
                <div className="muted" style={{ fontSize: 12, margin: '4px 0 6px' }}>장수마다 최대 3개. 「역사 능력치 사용」을 켜면 인물의 역사 속 특기, 끄면 무작위. 싸워서 적 병사를 쓰러뜨리거나 내정을 맡아 <b>공적</b>이 1.5만·5만·15만·40만·100만에 이를 때마다 무작위로 하나를 익히거나 올립니다(3개가 차 있으면 하나를 잊고 배울지 고름). 부대에서는 함께 간 장수 중 가장 높은 등급이 적용돼요.</div>
                {[['mil', '⚔️ 무관 — 싸움'], ['civ', '🏛️ 문관 — 내정·외교']].map(([cat, label]) => (
                  <div key={cat}>
                    <div className="sec-h" style={{ marginTop: 6 }}>{label}</div>
                    {Object.keys(T14).filter((k) => T14[k].cat === cat).map((k) => (
                      <div key={k} className="trait-row"><b>{k}</b><span>{[1, 2, 3].map((t) => <span key={t} className={`tl t${t}`}><i>{['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][t]}</i> {tdesc(k, t)}</span>)}</span></div>
                    ))}
                  </div>
                ))}
              </details>
              <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
                <li>부대가 지나간 칸은 내 땅. 도시는 관할(점선 안) 땅을 매 순 조금씩 넓히고, 내 땅 비율만큼 금·병량이 들어옵니다.</li>
                <li>금은 상업에서 매 턴, 병량은 농업에서 가을(8월)에 한 해 몫이 들어옵니다. 병사는 병량을 먹고, 병량이 떨어지면 흩어집니다.</li>
                <li>적 부대 옆 칸에 들어서면 그날은 더 못 갑니다(통제 구역). 여러 방향에서 치면 <b>협공</b>(+30%씩).</li>
                <li>무력·통솔·지력 70 이상 장수는 <b>돌격·일제사격·화계</b> 전법을 씁니다.</li>
                <li>깃발 아래 초록 막대는 병력, 파란 막대는 사기. 사기가 낮으면 주는 피해가 줄지만 계속 싸웁니다. 병력이 절반 아래로 줄고 사기도 바닥(5 이하)이면 패주해 가까운 성으로 물러나고, 병력 300 이하면 무너집니다.</li>
                <li>사기는 싸우지 않고 내 땅에서 쉬면 하루 +3, 내 <b>진지</b> 안이면 +6 회복 — 성에 돌아갈 필요 없음.</li>
                <li>내 도시·땅과 끊기면 보급이 끊겨 병력·사기가 줄어듭니다(주황 테두리).</li>
                <li>장수 둘 이상이 한 부대로 나가면 능력은 가장 높은 장수 기준, 부장 하나마다 공·방 +12%(둘까지).</li>
                <li>포로 석방: 그 나라가 살아 있으면 돌아가고(우호 +), 없으면 재야로. 등용 확률은 다시 잡아도 오르지 않습니다.</li>
                <li>성벽이 남아 있으면 수비병이 잘 안 죽습니다. 수비병이 0이면 함락, 관할 땅이 통째로 넘어옵니다.</li>
                <li>⛩️ 관문은 수입이 없지만 성벽이 두꺼운 길목입니다.</li>
                <li>⚓ 항구에서 나간 부대는 배로 바닷길(뭍에서 3칸 안 바다)을 갑니다. 물 위에선 수군 장수가 없으면 약합니다.</li>
                <li>이름난 장수는 고유 전법(★)을 씁니다: 관우 「청룡언월」, 장비 「장판교 일갈」(주변 적 발 묶음), 제갈량 「팔진」(받는 피해 절반) …</li>
                <li>무력 75 이상 대장끼리 붙으면 가끔 <b>일기토</b>. 지면 사기가 크게 꺾이고 사로잡히기도 합니다.</li>
                <li>날씨 보는 법: 눈 오는 곳은 땅이 하얗게, 비 오는 곳은 푸르스름하게 어두워지고, 화면 가운데가 비·눈·바람이면 빗줄기·눈송이·바람결이 내립니다. 「불 세기」는 화계 같은 불 전법과 화공 특성의 위력이에요(바람 1.6배, 비 0.5배, 눈 0.8배).</li>
                <li>날씨: 지도를 여러 구역으로 나눠 구역마다 위도·계절에 맞게 따로 정해집니다(열대는 눈 없이 비가 잦고, 북쪽은 겨울이 길고 눈이 잦고, 남반구는 계절이 반대). 위쪽 표시줄은 내 도읍 날씨예요. ❄️ 눈 오는 곳은 이동이 느림, 🌧️ 비는 강 건너기가 힘들고 불이 약함, 🌬️ 바람은 화계가 강함.</li>
                <li>🕊️ 처음 석 달(9순, 도시 3개 이하 작은 나라면 1년)은 컴퓨터가 내 도시를 먼저 치지 않습니다. 그동안 친선·정전·동맹으로 외교를 다지세요.</li>
                <li>💰 금 지출: 장수 녹봉 1명당 200/순, 시설 유지비 단계당 300/순, 징병 1명당 10금. 출진은 공짜예요. 국고가 「10만 + 도시당 1만」을 넘으면 넘는 금의 5%가 순마다 새어 나갑니다.</li>
                <li>🎁 장수마다 충성이 있습니다. 금이 바닥나면 떨어지고, 35 아래면 가끔 다른 나라로 떠납니다. 세력 탭 「전체 포상」 한 번으로 챙기세요.</li>
                <li>🕵️ 적 도시를 누르면 계략: 유언비어(수비병↓·자원병 멈춤), 이간(장수 충성↓), 매수(충성 낮은 장수 빼 오기). 지력 높은 장수가 있으면 잘 됩니다.</li>
                <li>🕯️ 장수는 해마다 나이를 먹고 60세 무렵부터 세상을 떠날 수 있습니다.</li>
                <li>👑 군주가 사로잡히거나 죽으면 통솔+정치가 가장 높은 장수가 잇고 사기가 꺾입니다. 이을 사람이 없으면 나라가 무너집니다.</li>
                <li>🏗️ 도시 시설은 성벽 증축·조선소(항구)뿐. 수입·수확은 담당관·땅·정책으로 늘립니다.</li>
                <li>⛺🗼🚧 부대를 고르면 그 자리에 진지(아군 피해 −30%·보급 거점·사기 +6/일)·망루(2칸 안 적 부대 매일 공격)·목책(바로 세움, 1500금, 적 길막이+옆에 오면 멈춤)을 지을 수 있습니다. 적 시설은 부대로 눌러 부숩니다.</li>
                <li>⚙️ 공성병기(들판 어디서든 부대로 만들기, 금 5천)는 성벽을 5배로 깎지만 느려지고 들판 싸움에 약하며(공격 −20%·받는 피해 +35%) 함락하면 부서집니다. 장수 여럿 부대는 「✂️ 나누기」로 언제든 갈라 협공할 수 있습니다.</li>
                <li>🌊 얕은 바다(뭍에서 3칸)는 어느 부대나, 깊은 바다는 항구 도시에서 나온 부대만 건넙니다.</li>
                <li>➕ 부대를 고르고 「이어서 명령」을 켜면 누르는 곳이 차례로 경유지가 됩니다(망루 부수고 → 성 치고 → 이동). 성을 함락해도 경유지가 남으면 수비병만 남기고 계속 갑니다.</li>
                <li>🚚 도시 패널에서 장수 없이 병력만 내 다른 성으로 보낼 수 있습니다(길 길이만큼 걸림).</li>
                <li>🏗️ 도시 패널에서 성 수비대가 4칸 안에 망루·진지·목책을 지을 수 있습니다. 한 지역에 3개(망루 2개)까지, 성을 빼앗으면 그 지역 시설도 넘어옵니다. 부대는 옆에 붙은 적 망루를 먼저 부숩니다.</li>
                <li>⚔️ 일기토는 무력이 높을수록 유리하지만 운도 큽니다(무력 차 10이면 약 30% 역전). 이기면 사기 +20, 적 병사 8% 도주, 무력이 자라기도 합니다. 🧠 지력 높은 장수는 적 전법을 간파해 막습니다.</li>
                <li>👑 외교: 훨씬 약한 나라에 <b>속국 요구</b>(서로 안 싸우고 순마다 금 수입 15% 조공, 우리 전쟁을 도움), 아주 약한 나라나 1년 넘은 속국에는 <b>항복 권유</b>(통째로 흡수). 반대로 우리가 약하면 강한 나라의 <b>속국이 되어</b> 살아남을 수 있고, 나중에 독립 선언도 가능.</li>
                <li>👥 성 내정 칸의 빈 담당 아래 「💡 추천」으로 다른 성에서 놀고 있는 장수를 불러 맡기거나, 장수 카드의 ➡️로 다른 성에 보내 데려옵니다(빈 담당에 맞는 장수가 위).</li>
                <li>🗡️ 넓은 변방 도시는 수비가 얇으면 도적이 땅을 휩쓸고, 조선소 없는 항구는 해적에게 털립니다.</li>
                <li>🔥 도시 15개 넘게 커진 나라는 도읍에서 먼, 장수 없고 수비 얇은 변방 도시가 가끔 반란으로 떨어져 나가거나 이웃에 귀순합니다(장수가 있거나 수비 2만 넘으면 안전).</li>
                <li>🕊️ 외교: 정치가 가장 높은 장수가 사신이 되어 제안 성공률(최대 +20%)과 친선 효과를 높입니다. 친선은 1만에 우호 +10, 3만에 +30 (나라 크기와 상관없음).</li>
                <li>🧠 컴퓨터 나라는 확장·속공·내실·편승·반패권·수성·사방 방어 중 형편에 맞는 전략을 고릅니다(외교 탭에서 확인).</li>
                <li>⚖️ 밸런스 기준: 병사 1명 = 금 10 = 공격력 1(병사 1명이 내는 힘) = 병량 1.5. 정책·시설·특성은 모두 이 환율로 「한 순에 금 몇 어치」인지 따져 맞춥니다.</li>
                <li>🏪🌾 시장은 그 도시 금 +25%씩, 농장은 그 도시 수확 +100%씩(유지비 없음). 관할 땅은 칸 수가 아니라 <b>채운 비율</b>로 수입이 정해집니다.</li>
                <li>🎖️ 장수 특성: 장수 이름 옆 꼬리표(예: 맹장Ⅱ)가 특성이고, 마우스를 올리면 효과가 나옵니다. 등급은 브론즈(Ⅰ)·실버(Ⅱ)·골드(Ⅲ)이고, 병사 1명 = 금 10으로 쳐서 한 순에 브론즈 ≈ 금 200(장수 녹봉 하나)·실버 ≈ 400·골드 ≈ 700만큼 벌어 주도록 맞췄어요. 그래서 자주 쓰이는 특성(명장: 공격 +8~29%)은 수치가 작고, 가끔 쓰이는 특성(산악: 산·구릉 공격 +25~80%, 사막·화공 등)은 수치가 큽니다. 싸움 특성은 부대에 있을 때, 성 특성(수성·궁술·철벽·정치·교역·모병·인덕·축성·건축)은 그 성에 머물 때, 농정·징병은 그 일을 맡았을 때, 상업·외교는 나라에서 가장 높은 장수 하나가 적용돼요.</li>
                <li>🏴 도적·산적·비적·해적: 성 근처 아무 데서나 무리(5천~2.5만)가 일어나 6칸 안의 성이나 부대를 바로 들이받습니다. 들판은 도적, 산·숲은 산적, 사막·동토는 비적, 얕은 바다는 해적이에요. 무리 크기에 따라 두목(6천 아래)·단장(6천~)·대장(1만~)·총대장(1.5만~)이 이끌고, 길에서 부대를 보면 성보다 부대(장수)를 먼저 들이받습니다. 금·병량은 안 뺏지만, 성 수비병을 0으로 만들면 그 성은 주인 없는 중립 성이 되고(수비병도 중립 성만큼 다시 모임) 도적은 다음 먹잇감을 찾아 떠납니다. 두목은 사로잡거나 등용할 수 없고, 도적에게 진 장수도 사로잡히지 않습니다. 토벌하지 않으면 사라지지 않고, 병력이 1천 아래로 줄어야 흩어집니다. <b>도적은 사기가 없어</b> 끝까지 싸우고, 부대를 쳐부수거나 성을 깰수록 병사가 모여 세를 불립니다(최대 4만). 컴퓨터 나라도 자기 땅 가까이 온 무리는 토벌하러 나갑니다.</li>
                <li>🏯 성 수용 한도: 성마다 들일 수 있는 병력이 정해져 있습니다(인구×600, 최소 4만, 성벽 증축 단계마다 +1만). 넘는 병력은 순마다 15%씩 흩어지니 부대로 내보내세요.</li>
                <li>🚚 병력 받기: 받을 성을 눌러 「병력 받기」에서 보낼 성을 고릅니다. 수송대는 내 땅 길로 하루 1.5칸 가고, 포위된 성에는 못 들어갑니다(장수가 부대로 데려가야 함).</li>
                <li>🏳️ 패주: 사기가 꺾인 부대는 가까운 내 성으로 걸어서 물러납니다. 물러나는 동안은 싸우지 않고 받는 피해가 30% 늘어 쫓아가면 잡을 수 있습니다.</li>
                <li>👑 견제: 한 나라가 도시의 30~45%를 차지하면 다른 나라들이 견제합니다(정전을 잘 안 받아 주고 서로 동맹). 45%를 넘거나 300순이 지나면 견제가 풀리고 작은 나라들이 속국으로 잘 들어옵니다.</li>
                <li>🔁 약조 연장: 정전·동맹이 6순 이하로 남으면 외교 탭에서 연장을 청할 수 있습니다.</li>
                <li>➕ 경유지: 부대를 고른 뒤 지도를 꾹 누르거나(폰) Shift+클릭(PC)하면 다음 목적지가 이어서 붙습니다(최대 8개).</li>
                <li>📜 정책: 세력 탭에서 둔전·상업 장려·징병령·축성 장려·인재 등용·군비 확장·수군 육성 중 칸만큼 펼칩니다(도시 8곳마다 1칸).</li>
                <li>🏗️ 세력 탭의 「새 도시 세우기」로 내 땅 빈 곳(다른 성과 4칸 이상, 초록 칸)에 도시를 세웁니다. 완공되면 주변 땅이 그 도시 관할이 됩니다.</li>
                <li>삼국지 시나리오는 손책의 죽음, 관도대전, 삼고초려, 적벽대전 같은 역사 사건이 때가 되면 일어납니다.</li>
              </ul>
            </div>
          )}
          {tab === 'log' && (
            <div className="card h14-log" style={{ maxHeight: 'none' }}>
              <div className="log-filter seg">{[['all', '전체'], ['war', '전투·함락']].map(([k, l]) => <button key={k} className={logF === k ? 'on' : ''} onClick={() => setLogF(k)}>{l}</button>)}</div>
              {!game.log.length && <div className="todo-empty">아직 기록이 없습니다. 날을 진행하면 전투·외교·내정 소식이 쌓여요.</div>}
              {game.log.filter((l) => l.nations?.includes(pid) && (logF !== 'war' || /battle|capture/.test(l.kind || '') || /함락|전멸|패주|사로잡/.test(l.text))).slice(0, 120).map((l, i) => (
                <div key={i} className={'log-line' + (l.nations?.includes(pid) ? ' mine' : '') + (l.nations?.includes(pid) && /함락|무너|멸망|사로잡|반란|떠났|끝납|배신/.test(l.text) ? ' alert' : '')}>[{l.turn}순{l.day ? ` ${l.day}일` : ''}] {l.text}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={'h14' + (sheet ? ' sheet-open' : '')}>
      <div className={'topbar h14-top' + (moreOpen ? ' more-open' : '')}>
        <b className="tb-nation" title={me.name}><span className="chip" style={{ background: me.color }} /> <span className="tb-nname" style={{ borderBottom: `2px solid ${me.color}` }}>{me.name}</span></b>
        <div className="tb-stats">
          {(() => { const [y, ...rest] = dateOf(game, startYear).split(' '); return <span className="pill"><span className="tb-cal">📅 </span><span className="tb-year">{y} </span>{rest.join(' ')} <span className="lbl-long">{game.day + 1}일</span><span className="tb-wic" title={weatherText(game)}> {weatherText(game).split(' ')[0]}</span></span>; })()}
          {(() => { const [ic, ...rest] = weatherText(game).split(' '); return <span className="pill tb-weather" title={`${weatherText(game)} — 내 도읍 날씨예요. 날씨는 지역마다 다릅니다(위도·계절). 눈: 이동 느림 · 비: 강 건너기 힘듦, 불 약함 · 바람: 불 강함`}>{ic}<span className="tb-wtx"> {rest.join(' ')}</span></span>; })()}
          <span className="pill">💰 {fmtGold(me.gold)} <small style={{ color: inc < 0 ? 'var(--danger)' : 'var(--ok)' }}>{inc >= 0 ? '+' : ''}{fmtGold(inc)}</small></span>
          <span className={'pill' + (food < use * 6 ? ' bad' : '')}>🍚 {fmtTroops(food)}</span>
          <span className="pill" title={`내 성 ${myCities} / 전체 ${cities.length}`}>🏯 {myCities}<small className="tb-total">/{cities.length}</small></span>
          <span className="pill tb-units">⚑ {myUnits.length}</span>
        </div>
        <button className="icon tb-more" aria-label="메뉴 (소리·속도·나가기)" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>⋯</button>
        <div className="tb-btns" onClick={(e) => e.stopPropagation()}>
          <button className="icon" title="배경음악" onClick={() => { unlockAudio(); setAudio('bgm', !aud.bgm); setAud(audioOpt()); }}>{aud.bgm ? '🎵' : '🔇'}</button>
          <button className="icon" title="효과음" onClick={() => { unlockAudio(); setAudio('sfx', !aud.sfx); setAud(audioOpt()); }}>{aud.sfx ? '🔔' : '🔕'}</button>
          <button className="icon" title={stopIdle ? "순 끝까지 넘길 때 내 부대가 도착하면 멈춤 (켬)" : "순 끝까지 넘길 때 부대가 도착해도 멈추지 않음 (끔)"} style={{ opacity: stopIdle ? 1 : 0.45 }} onClick={() => setStopIdle((v) => { try { localStorage.setItem('h14.stopIdle', v ? '0' : '1'); } catch {} return !v; })}>⏸️</button>
          <button className="icon" title={motion ? '날씨·깃발 움직임 효과 (켬) — 끄면 배터리·발열이 줄어요' : '날씨·깃발 움직임 효과 (끔)'} aria-pressed={motion} style={{ opacity: motion ? 1 : 0.45 }} onClick={() => { const v = !motion; setPref('motion', v); setMotion(v); }}>🌦️</button>
          <button className="icon" title="진행 속도" onClick={() => setSpeed((v) => (v > 250 ? 170 : 420))}>{speed > 250 ? '▶' : '⏩'}</button>
          <button className="icon" title="나가기" onClick={onExit}>🚪</button>
        </div>
      </div>
      <div className={'h14-body' + (panelOff ? ' panel-off' : '')}>
        <div className="h14-map" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
          <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', background: '#1a4064' }} />
          <div className="map-vignette" aria-hidden />
          <div className="map-ctrl">
            <button className="zoom-btn" title="확대 (폰은 두 손가락으로)" onClick={() => { const r = wrap.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.4); }}>＋</button>
            <button className="zoom-btn" title="축소" onClick={() => { const r = wrap.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.4); }}>－</button>
            <button className="h14-menu" title="세력·외교·인재" onClick={() => { setSel(null); setSheet(true); }}>📋</button>
            {report && <button title="지난 순 결과 다시 보기" disabled={playing} onClick={() => setReportOpen((v) => !v)}>📊</button>}
            <button className="panel-toggle" title={`${panelOff ? '오른쪽 패널 펴기' : '오른쪽 패널 접기 (지도 넓게)'} — 단축키 P`} onClick={() => setPanelOff(!panelOff)}>{panelOff ? '⇤' : '⇥'}</button>
            {!game.spectator && <button className={'todo-btn' + (todoOpen ? ' on' : '') + (todoPing && !todoOpen ? ' ping' : '')} title="할 일 목록" aria-label={`할 일 ${todos.length}개`} onClick={() => setTodoOpen((v) => !v)}>✅{todos.length ? <span className={'todo-badge' + (todos.some((t) => t.sev === 'danger') ? ' danger' : '')}>{todos.length > 99 ? '99+' : todos.length}</span> : null}</button>}
          </div>
          {placeFort && <div className="map-hint">{FORTS[placeFort.kind].icon} {game.castles[placeFort.cid]?.name}에서 4칸 안, 내 땅을 누르면 {FORTS[placeFort.kind].name}을(를) 짓습니다 <button className="hint-clear" onClick={() => setPlaceFort(null)}>✕ 취소</button></div>}
          {sendFrom !== null && <div className="map-hint">🚚 {game.castles[sendFrom]?.name}의 병력 {fmtTroops(sendAmt)}을(를) 받을 내 성을 누르세요 <button className="hint-clear" onClick={() => setSendFrom(null)}>✕ 취소</button></div>}
          {sendGen && <div className="map-hint">➡️ {game.generals[sendGen]?.name}을(를) 보낼 내 성을 누르세요 (병력 {fmtTroops(callAmt)}) <button className="hint-clear" onClick={() => setSendGen(null)}>✕ 취소</button></div>}
          {founding && <div className="map-hint">🏗️ 초록 칸 중 새 도시 자리를 누르세요 ({spots?.length || 0}곳) <button className="sm" onClick={() => setFounding(false)}>취소</button></div>}
          {selUnit && selUnit.nation === pid && !playing && (
            <div className="map-hint unit-hint">
              <span className="uh-tx"><b>⚑ {gensOf(game, selUnit.gens)[0]?.name} {fmtTroops(selUnit.troops)}</b> <span className="muted">{chain ? '누르는 곳이 차례로 경유지' : '지도를 눌러 이동·공격'}{selUnit.queue?.length ? ` · 경유 ${selUnit.queue.length}` : ''}</span></span>
              <span className="uh-btns">
                <button className={'xs' + (chain ? ' primary' : '')} title="켜면 누른 곳들을 차례대로 이어서 감 (망루 부수고 → 성 치고 → 이동). PC는 Shift+클릭, 폰은 꾹 누르기로도 경유지 추가" onClick={() => setChain((v) => !v)}>➕ 이어서{chain ? ' 켬' : ''}</button>
                {selUnit.queue?.length ? <button className="xs" title="마지막 경유지 하나 취소 (모두 지우려면 길게)" onClick={() => act((s) => { const su = s.units.find((x) => x.id === selUnit.id); su.queue = su.queue.slice(0, -1); return { ok: true, msg: `경유지 하나 취소 (${su.queue.length}개 남음)` }; })}>↩️</button> : null}
                <button className="xs h14-menu" title="부대 정보·명령" onClick={() => setSheet(true)}>ℹ️</button>
                <button className="xs hint-clear" title="선택 해제 (Esc)" onClick={() => { setSel(null); setChain(false); }}>✕</button>
              </span>
            </div>
          )}
          
          <div className="end-turn-box">
            <button className="sm" disabled={playing || !!game.over} onClick={() => runTurn(true)} title="이번 순(10일)이 끝날 때까지 한 번에">⏩ 순 끝까지 <span className="lbl-long">({DAYS - game.day}일)</span></button>
            <div className="days-step">
              <button className="sm" disabled={playing || nDays <= 1} title="진행할 날 수 줄이기" onClick={() => setNDays((v) => Math.max(1, v - 1))}>－</button>
              <button className="primary end-turn" title="단축키 Space (순 끝까지는 Shift+Space)" disabled={(playing && (!skipWait.current || !!duel || !!thinking)) || !!game.over} onClick={() => runTurn(nDays)}>
                {playing ? '⏳ 진행 중' : (() => {
                  const endD = game.day + nDays, over = endD > DAYS;
                  return <><span>{nDays === 1 ? '하루' : `${nDays}일`} 진행 ▶ <span className="lbl-day">{over ? `다음 순 ${endD - DAYS}일까지` : `${endD}일까지`}</span></span>
                    <span className="day-strip" aria-hidden>{Array.from({ length: DAYS }, (_, i) => <i key={i} className={i < game.day ? 'past' : i < Math.min(DAYS, endD) ? 'go' : ''} />)}{over && <b className="go-next">+{endD - DAYS}</b>}</span></>;
                })()}
              </button>
              <button className="sm" disabled={playing || nDays >= DAYS} title="진행할 날 수 늘리기 (최대 10일)" onClick={() => setNDays((v) => Math.min(DAYS, v + 1))}>＋</button>
            </div>
          </div>
          {toastMsg && <div className="toast">{toastMsg}</div>}
          {thinking && playing && (() => {
            const n = game.nations[thinking.nid], g = Object.values(game.generals).find((x) => x.nation === thinking.nid && x.ruler);
            // 얼굴 하나: 군주가 없으면 나라 색 동그라미에 나라 이름 첫 글자
            const face = (nid, cls) => { const n2 = game.nations[nid]; if (!n2) return null; const g2 = Object.values(game.generals).find((x) => x.nation === nid && x.ruler); return g2 ? <img key={`${nid}`} className={cls} src={portraitURL(g2, n2.color)} alt="" style={{ borderColor: n2.color }} /> : <span key={`${nid}`} className={cls + ' think-flag'} style={{ background: n2.color }}>{n2.name[0]}</span>; };
            const prev = thinkHist.current.filter((x) => x !== thinking.nid).slice(-3);
            return n ? (
              <div className="h14-think">
                <div className="think-faces">{prev.map((x) => face(x, 'think-prev'))}{face(thinking.nid, 'think-cur')}</div>
                <div className="think-txt" key={thinking.nid}><b style={{ color: n.color }}>{n.name}</b>{g ? ` ${g.name}` : ''}<small>생각하는 중… ({thinking.k}/{thinking.n})</small></div>
                <div className="h14-think-bar"><div style={{ width: `${Math.round((thinking.k / Math.max(1, thinking.n)) * 100)}%` }} /></div>
              </div>
            ) : null;
          })()}
          {duel && <DuelView d={duel} game={game} pid={pid} onSkip={() => { setDuel(null); skipDuel.current?.(); }} />}
          {cutin && (() => {
            const [gname, tname] = cutin.text.split(' 「');
            const gg = Object.values(game.generals).find((x) => x.name === gname);
            return (
              <div className="cutin" style={{ borderColor: game.nations[cutin.nation]?.color }}>
                {gg && <img src={portraitURL(gg, game.nations[cutin.nation]?.color)} alt="" width={64} height={64} />}
                <div><small>{gname}</small><b>「{tname}</b></div>
              </div>
            );
          })()}
          {!playing && !game.over && !game.inbox?.length && game.eventsQ?.length > 0 && (() => {
            const ev = game.eventsQ[0];
            return (
              <div className="h14-over" style={{ fontSize: 15, fontWeight: 'normal' }}>
                <div className="card event-card">
                  <h3 style={{ margin: '0 0 8px' }}>📜 {ev.title}</h3>
                  {ev.faces?.length > 0 && (
                    <div className="row" style={{ justifyContent: 'center', gap: 10, marginBottom: 8 }}>
                      {ev.faces.map((nm) => { const gg = Object.values(game.generals).find((x) => x.name === nm) || { name: nm, war: 60, lead: 60, intel: 60, pol: 60 }; return <div key={nm} style={{ textAlign: 'center', fontSize: 12 }}><img src={portraitURL(gg, gg.nation !== null && gg.nation !== undefined ? game.nations[gg.nation]?.color : '#fff')} alt="" width={64} height={64} /><div>{nm}</div></div>; })}
                    </div>
                  )}
                  <div style={{ lineHeight: 1.6 }}>{ev.text}</div>
                  <div style={{ marginTop: 10 }}><button className="primary" onClick={() => act((s) => { s.eventsQ.shift(); })}>확인</button></div>
                </div>
              </div>
            );
          })()}
          <div className={'h14-left' + (placeFort || sendFrom !== null || sendGen || founding || (selUnit && selUnit.nation === pid && !playing) ? ' below-hint' : '')}>
          {(() => {
            // 내 명령: 부대 목적지·남은 날, 수송, 공사, 포로
            const etaOf = (u) => (u.path.length ? Math.ceil(u.path.reduce((a, t, i) => a + Math.min(3, moveCost(grid, i ? u.path[i - 1] : u.tile, t, game, u)), 0) / Math.max(0.05, speedOf(game, u))) : 0);
            const what = (u) => { const o = u.order; if (!o) return '대기'; if (o.kind === 'castle') { const c = game.castles[o.id]; return c?.owner === pid ? `${c.name} 입성` : `${c?.name} 공략`; } if (o.kind === 'unit') { const t = game.units.find((x) => x.id === o.id); return `${gensOf(game, t?.gens || [])[0]?.name || '적'} 부대 공격`; } if (o.kind === 'fort') return '시설 파괴'; return '이동'; };
            const units = game.units.filter((u) => u.nation === pid);
            const convoys = (game.convoys || []).filter((v) => v.nation === pid);
            const builds = game.castles.filter((c) => c.owner === pid && (c.build || c.founding));
            const forts = (game.forts || []).filter((f) => f.owner === pid && f.left > 0);
            const n = units.length + convoys.length + builds.length + forts.length;
            // 사신·확인 창이 떠 있으면 겹치지 않게 숨김
            if (!n || (!playing && !game.over && game.inbox?.length > 0 && !peek)) return null;
            return (
              <details className="h14-orders" open={ordersOpen} onToggle={(e) => setOrdersOpen(e.currentTarget.open)}>
                <summary><b>📋 내 명령</b> <small className="muted">부대 {units.length}{convoys.length ? ` · 수송 ${convoys.length}` : ''}{builds.length + forts.length ? ` · 공사 ${builds.length + forts.length}` : ''}</small></summary>
                {units.map((u) => { const d = etaOf(u); return (
                  <button key={'u' + u.id} className="ord-row" onClick={() => { setSel({ type: 'unit', id: u.id }); window.__h14?.focus(u.tile); }}>
                    <span>{u.routed ? '🏳️' : u.transfer ? '🚶' : '⚑'} {gensOf(game, u.gens)[0]?.name} <small className="muted">{fmtTroops(u.troops)}</small></span>
                    <span className="muted">{u.routed ? '패주 중' : what(u)}{u.queue?.length ? ` +${u.queue.length}` : ''}</span>
                    <span className="ord-eta">{u.path.length ? `${d}일` : '도착'}</span>
                  </button>); })}
                {convoys.map((v, i) => <div key={'v' + i} className="ord-row"><span>🚚 {fmtTroops(v.troops)}</span><span className="muted">{game.castles[v.from]?.name} → {game.castles[v.to]?.name}</span><span className="ord-eta">{Math.max(0, v.arrive - absDay(game))}일</span></div>)}
                {builds.map((c) => <button key={'b' + c.id} className="ord-row" onClick={() => goTo(c)}><span>🔨 {c.name}</span><span className="muted">{c.founding ? '새 도시' : BUILDINGS[c.build.type]?.name}</span><span className="ord-eta">{c.founding || c.build.left}순</span></button>)}
                {forts.map((f) => <div key={'f' + f.id} className="ord-row"><span>{FORTS[f.kind].icon} {FORTS[f.kind].name}</span><span className="muted">공사 중</span><span className="ord-eta">{f.left}일</span></div>)}
              </details>
            );
          })()}

          </div>
          {!playing && !game.over && game.inbox?.length > 0 && peek && (() => {
            const n = game.nations[game.inbox[0].from];
            return (
              <div className="h14-peek">
                <span className="chip" style={{ background: n.color }} /> {n.name} (선택한 성)
                <button className="primary sm" onClick={() => setPeek(false)}>✉️ 답하기</button>
              </div>
            );
          })()}
          {!playing && !game.over && game.inbox?.length > 0 && !peek && (() => {
            const p = game.inbox[0], n = game.nations[p.from];
            const cap = game.castles.find((c) => c.owner === p.from && c.capital) || game.castles.find((c) => c.owner === p.from);
            return (
              <div className="h14-over" style={{ fontSize: 16, fontWeight: 'normal' }}>
                <div className="card" style={{ maxWidth: 340, textAlign: 'center' }}>
                  <h3 style={{ margin: '0 0 8px' }}>✉️ <span className="chip" style={{ background: n.color }} /> {n.name}의 사신</h3>
                  <div>{vassalInboxText(game, p) || `${PACT[p.type]}을 맺자고 합니다 (${p.type === 'ally' ? '1년' : '반년'}).`}</div>
                  <div className="muted" style={{ fontSize: 12, margin: '6px 0' }}>우호 {Math.round(relOf(game, pid, p.from))} · {n.name} 병력 {fmtTroops(powerOf(game, p.from))}</div>
                  <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
                    {cap && <button onClick={() => { goTo(cap); setPeek(true); }}>📍 지도에서 보기</button>}
                    <button onClick={() => act((s) => answerInbox(s, 0, false))}>거절</button>
                    <button className="primary" onClick={() => act((s) => answerInbox(s, 0, true))}>수락</button>
                  </div>
                </div>
              </div>
            );
          })()}
          {!playing && !game.spectator && !game.over && todoOpen && !tourOn && !(report && reportOpen) && !game.inbox?.length && !game.eventsQ?.length && (() => {
            const T = todos;
            const groups = [['danger', '🚨 위급'], ['todo', '📝 할 일']];
            return (
              <div className="h14-todo" role="dialog" aria-label="할 일 목록">
                <div className="todo-head">
                  <b>✅ 할 일 {T.length ? <span className="todo-n">{T.length}</span> : null}</b>
                  <small className="muted">{game.turn}순 {game.day + 1}일</small>
                  <label className="todo-auto" title="순이 바뀔 때마다 이 목록을 저절로 엽니다"><input type="checkbox" checked={todoAuto} onChange={(e) => setTodoAuto(e.target.checked)} /> 순마다 열기</label>
                  <button className="sm todo-x" aria-label="닫기" onClick={() => setTodoOpen(false)}>✕</button>
                </div>
                {!T.length && <div className="todo-empty">🎉 지금 챙길 일이 없습니다. 진행해도 좋아요.</div>}
                {groups.map(([sev, label]) => {
                  const list = T.filter((t) => t.sev === sev);
                  if (!list.length) return null;
                  return (
                    <div key={sev} className={`todo-group ${sev}`}>
                      <div className="todo-gl">{label} <small>{list.length}</small></div>
                      {list.map((t) => (
                        <div key={t.id} className={'todo-row' + (t.go ? ' clickable' : '')} onClick={() => todoGo(t)} role={t.go ? 'button' : undefined} tabIndex={t.go ? 0 : undefined} onKeyDown={(e) => { if (t.go && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); todoGo(t); } }}>
                          <span className="todo-ic" aria-hidden>{t.icon}</span>
                          <span className="todo-tx"><b>{t.title}</b>{t.sub ? <small>{t.sub}</small> : null}</span>
                          {t.act && <button className={'sm' + (t.act.primary ? ' primary' : '')} disabled={t.act.disabled} title={t.act.tip} onClick={(e) => { e.stopPropagation(); t.act.fn(); }}>{t.act.label}</button>}
                          {t.go && !t.act && <span className="todo-go" aria-hidden>›</span>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {report && reportOpen && !playing && !game.over && !game.inbox?.length && !game.eventsQ?.length && (() => {
            const S = report.sum, sg = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
            const dv = (a, b, f) => <b className={b - a > 0 ? 'up' : b - a < 0 ? 'down' : ''}>{sg(b - a)}{f(Math.abs(b - a))}</b>;
            return (
              <div className="h14-turnrep" onClick={(e) => e.target === e.currentTarget && setReportOpen(false)}><div className="h14-report">
                <div className="row" style={{ justifyContent: 'space-between' }}><b>📊 {S ? `${S.turn}순 결과` : '이번 순 소식'}</b><button className="sm" onClick={() => setReportOpen(false)}>✕</button></div>
                {S && (
                  <div className="rep-grid">
                    <span>💰 금</span><span>{fmtGold(S.gold[2])} {dv(S.gold[0], S.gold[2], fmtGold)}</span>
                    <small>{S.full ? <>명령에 씀 {sg(S.gold[1] - S.gold[0])}{fmtGold(Math.abs(S.gold[1] - S.gold[0]))} · </> : null}정산 {sg(S.gold[2] - S.gold[1])}{fmtGold(Math.abs(S.gold[2] - S.gold[1]))}</small>
                    <span>🌾 병량</span><span>{fmtGold(S.food[2])} {dv(S.food[0], S.food[2], fmtGold)}</span>
                    <small>{S.full ? <>순 동안 {sg(S.food[1] - S.food[0])}{fmtGold(Math.abs(S.food[1] - S.food[0]))} · </> : null}정산 {sg(S.food[2] - S.food[1])}{fmtGold(Math.abs(S.food[2] - S.food[1]))}</small>
                    <span>⚔️ 병력</span><span>{fmtTroops(S.troops[2])} {dv(S.troops[0], S.troops[2], fmtTroops)}</span>
                    <small>출진 {fmtTroops(S.field)} · 전투 손실 −{fmtTroops(S.rows.reduce((a, r) => a + r.myLoss, 0))} · 적에게 −{fmtTroops(S.rows.reduce((a, r) => a + r.foeLoss, 0))}</small>
                    <span>🏯 성</span><span>{S.cities}곳</span>
                    <small>{S.gained.length ? <span className="up">얻음 {S.gained.join('·')}</span> : null}{S.gained.length && S.lost.length ? ' · ' : null}{S.lost.length ? <span className="down">잃음 {S.lost.join('·')}</span> : null}{!S.gained.length && !S.lost.length ? '변화 없음' : null}</small>
                  </div>
                )}
                {S?.rows.length ? (
                  <details className="rep-battles" open={S.rows.length <= 3}>
                    <summary>⚔️ 전투 {S.rows.length}건 (아군 −{fmtTroops(S.rows.reduce((a, r) => a + r.myLoss, 0))} / 적 −{fmtTroops(S.rows.reduce((a, r) => a + r.foeLoss, 0))})</summary>
                    {S.rows.slice(0, 12).map((r, i) => (
                      <div key={i} className={`rep-b ${r.win ? 'win' : 'lose'}`}>
                        <div><b>{r.title}</b> <small>{r.days}일</small></div>
                        <div>적 −{fmtTroops(r.foeLoss)} / 아군 −{fmtTroops(r.myLoss)}{r.siege && r.wall ? ` · 성벽 −${Math.round(r.wall)}` : ''}</div>
                        <small>{r.mine ? '우리가 친 힘' : '적이 친 힘'}: {r.why.join(' · ')}</small>
                      </div>
                    ))}
                  </details>
                ) : null}
                {report.news.map((t, i) => <div key={i} style={{ color: /잃|무너|사로|⚠️|병량/.test(t) ? '#ffb4a8' : undefined }}>{t}</div>)}
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}><button className="primary sm" onClick={() => setReportOpen(false)}>확인</button></div>
              </div></div>
            );
          })()}
          {news.length > 0 && !tourOn && !game.eventsQ?.length && !game.inbox?.length && !(report && reportOpen) && (
            <div className="news-stack" aria-live="polite">
              {news.map((n) => (
                <div key={n.id} className={`news-card ${n.tone || ''}`}>
                  <span className="news-ic">{n.icon}</span>
                  <span className="news-tx">{n.text}</span>
                  {n.report && <button className="xs" title="지난 순 결과 자세히" onClick={() => { setReportOpen(true); setNews((v) => v.filter((x) => x.id !== n.id)); }}>보기</button>}
                  {n.tile != null && <button className="xs" title="그 자리로" onClick={() => { focusTile(n.tile); pulses.current.push({ tile: n.tile, t0: performance.now(), col: '#ffd166' }); draw(); }}>📍</button>}
                  <button className="xs news-x" aria-label="닫기" onClick={() => setNews((v) => v.filter((x) => x.id !== n.id))}>✕</button>
                </div>
              ))}
            </div>
          )}
          {(() => {
            const o = offerGid && (game.traitOffers || []).find((x) => x.gid === offerGid); const gg = o && game.generals[o.gid];
            if (!o || !gg) return null;
            const opts = offerOpts(o), full = (gg.traits || []).length >= 3;
            const tiers = (k) => [1, 2, 3].map((t) => `${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][t]} ${tdesc(k, t)}`).join('\n');
            const close = () => { setOfferGid(null); setOfferPick(null); };
            const done = (pick, forget) => { act((s) => answerOffer(s, o.gid, pick, forget)); close(); };
            const choose = (i) => { const x = opts[i]; if (x[2] || !full) done(i, null); else setOfferPick(i); };
            const more = (game.traitOffers || []).filter((x) => x.gid === o.gid).length - 1;
            const step = MERIT_STEPS[(o.lv || 1) - 1];
            return (
              <CModal open title={<>✨ {gg.name} — 새 특성 고르기<Help t={`공적(쓰러뜨린 적 병사 수·내정 담당 기간)이 ${MERIT_STEPS.map((v) => fmtTroops(v)).join('·')}에 이를 때마다 무작위 후보 3가지 중 하나를 고릅니다. 새 특성이나 가진 특성 한 단계 올리기가 섞여 나와요. 특성은 3개까지라, 가득 찼을 때 새 특성을 고르면 하나를 잊어야 합니다. 등급 Ⅰ→Ⅱ→Ⅲ으로 갈수록 효과가 커지고, 부대에서는 함께 간 장수 중 가장 높은 등급 하나가 적용돼요.`} /></>} onClose={close}>
                <div className="offer-head"><Face g={gg} size={36} col={me.color} /><div><b>{gg.name}</b><small className="muted"> 공적 {fmtTroops(gg.merit || 0)}{step ? ` · ${fmtTroops(step)} 달성` : ''}{more > 0 ? ` · 남은 고르기 ${more}번` : ''}</small><div className="gen-line" style={{ marginTop: 2 }}><Traits g={gg} /></div></div></div>
                {offerPick === null ? (
                  <>
                    <div className="muted" style={{ fontSize: 12.5, margin: '10px 0 6px' }}>하나를 고르세요{full ? ' (특성이 3개라 새 특성을 고르면 하나를 잊어야 해요)' : ''}</div>
                    <div className="offer-opts">
                      {opts.map((x, i) => (
                        <button key={i} className={'offer-opt' + (x[2] ? ' up' : '')} onClick={() => choose(i)}>
                          <span className="oo-top"><span className={`trait t${x[1]}`}>{traitName(x)}</span><span className="oo-kind">{x[2] ? `올리기 ${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][x[1] - 1]}→${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][x[1]]}` : T14[x[0]]?.cat === 'civ' ? '새 · 문관' : '새 · 무관'}</span><span className="help-q" role="button" tabIndex={0} data-tip={`${x[0]} 등급별 효과\n${tiers(x[0])}`} onClick={(e) => e.stopPropagation()}>?</span></span>
                          <span className="oo-desc">{x[2] ? `${tdesc(x[0], x[1] - 1)} → ${tdesc(x[0], x[1])}` : tdesc(x[0], x[1])}</span>
                        </button>
                      ))}
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}><button className="sm" onClick={close}>나중에</button><button className="sm" onClick={() => done(null)}>이번엔 고르지 않기</button></div>
                  </>
                ) : (
                  <>
                    <div className="offer-new" style={{ marginTop: 10 }}><div><div className="muted" style={{ fontSize: 12 }}>새로 익힐 특성</div><b className={`trait t${opts[offerPick][1]}`} style={{ fontSize: 13 }}>{traitName(opts[offerPick])}</b><div style={{ fontSize: 12.5, marginTop: 2 }}>{tdesc(opts[offerPick][0], opts[offerPick][1])}</div></div></div>
                    <div className="muted" style={{ fontSize: 12.5, margin: '10px 0 4px' }}>무엇을 잊을까요?</div>
                    {(gg.traits || []).map((t, i) => (
                      <div key={i} className="line-row"><span className="line-tx"><b><span className={`trait t${t[1]}`}>{traitName(t)}</span></b><small className="muted">{tdesc(t[0], t[1])}</small></span><button className="sm" onClick={() => done(offerPick, i)}>잊고 배우기</button></div>
                    ))}
                    <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8 }}><button className="sm" onClick={() => setOfferPick(null)}>← 다른 후보 보기</button></div>
                  </>
                )}
              </CModal>
            );
          })()}
          {tip && createPortal((() => {
            const W = Math.min(270, window.innerWidth - 16), left = Math.max(8, Math.min(window.innerWidth - W - 8, tip.x - W / 2));
            const below = tip.y + 8 + 90 < window.innerHeight;
            return <div className="tip-pop" role="tooltip" style={{ left, width: W, ...(below ? { top: tip.y + 6 } : { bottom: window.innerHeight - tip.top + 6 }) }}>{tip.text}</div>;
          })(), document.body)}
          {tourOn && <HexTour steps={tourSteps} paused={!playing && !game.over && !!(game.inbox?.length || game.eventsQ?.length || (report && reportOpen))} onClose={() => { setTourOn(false); setSel(null); setTab('home'); if (game.tutorial) { setGame((g) => ({ ...g, tutorial: false })); toast('튜토리얼 끝! 이 판은 연습용이라 자동 저장되지 않아요. 🚪 나가서 원하는 나라로 새로 시작하세요.'); } }} />}
          {game.over && (
            <div className="h14-over">
              {game.over.winner === pid ? '🏆 천하통일!' : game.over.lost ? '💀 멸망' : `${game.nations[game.over.winner]?.name} 천하통일`}
              {!game.over.lost && !game.over.final && <div className="muted" style={{ fontSize: 13, fontWeight: 'normal' }}>성의 80%를 차지했습니다. 남은 나라까지 계속 싸울 수도 있습니다.</div>}
              <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
                {!game.over.lost && !game.over.final && <button className="primary" onClick={() => act((s) => { s.keepPlaying = { ...s.over, turn: s.turn }; s.over = null; return { ok: true, msg: '계속 진행합니다 — 남은 나라를 모두 꺾으면 끝납니다' }; })}>▶ 계속 진행</button>}
                <button onClick={onExit}>메인 화면으로</button>
              </div>
            </div>
          )}
        </div>
        {!booted && <div className="boot-loading"><div className="spinner" /><b>지도를 그리는 중…</b><small className="muted">바다·지형·영토를 그리고 있어요 (큰 지도는 몇 초 걸려요)</small></div>}
        <div className={'h14-panel' + (sheet ? ' open' : '') + (sel ? ' has-sel' : '')} style={{ '--sheet-h': `${sheetH}vh` }}>
          {/* 폰: 손잡이를 위아래로 끌어 높이 조절 (짧게 누르면 작게↔크게), 아주 내리면 닫힘 */}
          <div className="h14-sheethead">
          <div
            className="h14-grip"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              const y0 = e.clientY, h0 = sheetH;
              let moved = false;
              const mv = (ev) => { const dy = ev.clientY - y0; if (Math.abs(dy) > 4) moved = true; setSheetH(Math.max(15, Math.min(88, h0 - (dy / window.innerHeight) * 100))); };
              const up = (ev) => {
                window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
                const h = h0 - ((ev.clientY - y0) / window.innerHeight) * 100;
                if (!moved) setSheetH(h0 > 40 ? 28 : 60);
                else if (h < 12) { setSheet(false); setSheetH(h0); }
              };
              window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
            }}
          />
            <button className="sm h14-close" title="닫고 선택 해제" onClick={() => { setSheet(false); setSel(null); setSortieOpen(false); }}>✕</button>
          </div>
          {panel}
        </div>
      </div>
    </div>
  );
}
