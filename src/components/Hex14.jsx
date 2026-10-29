import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, stepDay, endTurn14, sortie, order, commandCap, gensOf, unitStats, nearestCastle, draft14, draftMax14, draftCost, DAYS, dateOf, TERRAIN_NAME, castleIncome, landShare, enemy, districtTiles, splitUnit, splitAll, buildSiege, summonGeneral, sortieCost, sortieAfford, SIEGE_COST } from '../game/hex14.js';
import { aiTurn14, STRATS } from '../game/hex14ai.js';
import { ROLES, jobGen, autoJobs, goldOf, harvestOf, foodUse, relOf, pactOf, PACT, acceptChance, gift, propose, answerInbox, recruit, recruitChance, release, execute, powerOf, HARVEST_MONTH, trade, MARKET, isRuler, sprawlOf } from '../game/hex14gov.js';
import { TERRAIN } from '../game/rules.js';
import { corner, pixelToCell } from '../game/hex.js';
import { getScenario } from '../game/scenarios.js';
import { fmtTroops, fmtGold } from '../game/format.js';
import Slider from './Slider.jsx';
import { fixJosa } from '../game/josa.js';
import { portraitCanvas, portraitURL } from '../game/portrait.js';
import { citySprite } from '../game/citysprite.js';
import { weatherText, uniqueOf } from '../game/hex14extra.js';
import { BUILDINGS, canBuild, startBuild, cancelBuild, lv, slotsOf, usedSlots, foundCity, foundCheck, foundSpots, FOUND_COST, FOUND_TURNS, FOUND_GAP, buildCost, FORTS, fortCheck, startFort } from '../game/hex14build.js';
import { loyalOf, rewardAll, rewardCost, SCHEMES, schemeChance, doScheme } from '../game/hex14people.js';
import { POLICIES, POLICY_COST, POLICY_UPKEEP, policySlots, adoptPolicy, dropPolicy } from '../game/hex14policy.js';

// ───────── 삼국지14식 화면: 육각 칸 지도 + 도시·관문 + 부대 깃발 + 10일 진행 ─────────
const NEUTRAL = '#b9b2a0';
const clone = (s) => structuredClone(s);
const ownerColor = (s, o) => (o !== null && o >= 0 && s.nations[o] ? s.nations[o].color : NEUTRAL);

// 칸마다 같은 값이 나오는 작은 난수
const hash = (i, k = 0) => { let x = (i * 374761393 + k * 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177; x ^= x >>> 16; return ((x >>> 0) % 10000) / 10000; };
const mapScale = (grid) => Math.min(3, 4096 / Math.max(grid.W, grid.H));
const newLayer = (grid, sc) => { const cv = document.createElement('canvas'); cv.width = Math.ceil(grid.W * sc); cv.height = Math.ceil(grid.H * sc); const ctx = cv.getContext('2d'); ctx.scale(sc, sc); return [cv, ctx]; };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; };

// ── 지형 그림 (한 번만): 바다·해안·강·산·구릉·숲·사막을 칸마다 작은 그림으로 ──
function paintTerrain(grid, world) {
  const sc = mapScale(grid);
  const [cv, ctx] = newLayer(grid, sc);
  const sz = grid.size;
  const hexPath = (i, k = 1) => {
    const [cx, cy] = grid.center(i);
    ctx.beginPath();
    for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * k, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  };
  // 바다: 깊은 곳은 짙게, 뭍 가까운 곳은 옅게
  ctx.fillStyle = '#3f7598';
  ctx.fillRect(0, 0, grid.W, grid.H);
  const isLand = (i) => i !== undefined && grid.terrain[i] !== 0;
  for (let i = 0; i < grid.N; i++) {
    if (grid.terrain[i] !== 0) continue;
    const near = grid.nb[i].some(isLand), near2 = near || grid.nb[i].some((j) => grid.nb[j].some(isLand));
    if (!near2) continue;
    hexPath(i, 1.05);
    ctx.fillStyle = near ? '#79b4c9' : '#5b97b6';
    ctx.fill();
  }
  // 물결
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = sz * 0.07;
  for (let i = 0; i < grid.N; i++) {
    if (grid.terrain[i] !== 0 || hash(i, 1) > 0.18) continue;
    const [cx, cy] = grid.center(i);
    const x = cx + (hash(i, 2) - 0.5) * sz, y = cy + (hash(i, 3) - 0.5) * sz;
    ctx.beginPath(); ctx.arc(x - sz * 0.25, y, sz * 0.25, Math.PI * 1.1, Math.PI * 1.9); ctx.arc(x + sz * 0.25, y, sz * 0.25, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  // 모래톱: 바다와 맞닿은 땅
  for (let i = 0; i < grid.N; i++) {
    if (!isLand(i) || !grid.nb[i].some((j) => grid.terrain[j] === 0)) continue;
    hexPath(i, 1.18);
    ctx.fillStyle = '#e8d9a8';
    ctx.fill();
  }
  // 땅 바탕: 지형 색에 칸마다 살짝 다른 밝기
  for (let i = 0; i < grid.N; i++) {
    const t = grid.terrain[i];
    if (t === 0) continue;
    hexPath(i, 1.04);
    ctx.fillStyle = shade(TERRAIN[t]?.color || '#d6dfa6', 0.94 + hash(i, 4) * 0.1);
    ctx.fill();
  }
  // 풀·모래 무늬
  for (let i = 0; i < grid.N; i++) {
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
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(cx + (hash(i, 60 + k) - 0.5) * sz * 1.4, cy + (hash(i, 70 + k) - 0.5) * sz * 1.4, sz * 0.08, 0, 7); ctx.fill(); }
    }
  }
  // 칸 테두리 (아주 옅게)
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = sz * 0.05;
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) { hexPath(i, 0.98); ctx.stroke(); }
  // 강: 실제 강줄기를 부드럽게 (짙은 테두리 + 밝은 물빛)
  const rivers = (world.rivers || []).filter((r) => r.pts?.length > 1);
  // 강은 영토 색에 덮이지 않게 따로 한 장에 그림
  const [rcv, rctx] = newLayer(grid, sc);
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
  for (let i = 0; i < grid.N; i++) if ([2, 3, 6, 7].includes(grid.terrain[i])) order.push(i);
  order.sort((a, b) => grid.center(a)[1] - grid.center(b)[1]);
  const peak = (x, y, w, h, snow) => {
    const apx = x + (hash(Math.round(x * 7), 1) - 0.5) * w * 0.3;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(apx, y - h); ctx.lineTo(x + w * 0.15, y); ctx.closePath();
    ctx.fillStyle = snow ? '#a89a8a' : '#b49a74'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w * 0.15, y); ctx.lineTo(apx, y - h); ctx.lineTo(x + w, y); ctx.closePath();
    ctx.fillStyle = snow ? '#6d6258' : '#7a6248'; ctx.fill();
    if (snow) { ctx.beginPath(); ctx.moveTo(apx, y - h); ctx.lineTo(apx - w * 0.32, y - h * 0.62); ctx.lineTo(apx - w * 0.05, y - h * 0.7); ctx.lineTo(apx + w * 0.12, y - h * 0.58); ctx.lineTo(apx + w * 0.3, y - h * 0.66); ctx.closePath(); ctx.fillStyle = '#f4f6f8'; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(apx, y - h); ctx.lineTo(x + w, y);
    ctx.strokeStyle = 'rgba(45,32,20,0.75)'; ctx.lineWidth = sz * 0.07; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(apx, y - h); ctx.lineTo(x + w * 0.15, y); ctx.strokeStyle = 'rgba(45,32,20,0.35)'; ctx.lineWidth = sz * 0.05; ctx.stroke();
  };
  const tree = (x, y, h) => {
    ctx.fillStyle = '#5a4026'; ctx.fillRect(x - h * 0.07, y - h * 0.25, h * 0.14, h * 0.28);
    for (const [yy, ww] of [[0.25, 0.42], [0.55, 0.32]]) {
      ctx.beginPath(); ctx.moveTo(x - h * ww, y - h * yy); ctx.lineTo(x, y - h * (yy + 0.55)); ctx.lineTo(x + h * ww, y - h * yy); ctx.closePath();
      ctx.fillStyle = '#2f6a35'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - h * ww, y - h * yy); ctx.lineTo(x, y - h * (yy + 0.55)); ctx.lineTo(x, y - h * yy); ctx.closePath();
      ctx.fillStyle = '#4c9149'; ctx.fill();
    }
  };
  const mound = (x, y, w, h) => {
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = '#c4a674'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, Math.PI * 1.5, 0); ctx.lineTo(x, y); ctx.closePath();
    ctx.fillStyle = '#a3845a'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, Math.PI, 0); ctx.strokeStyle = 'rgba(60,40,20,0.55)'; ctx.lineWidth = sz * 0.06; ctx.stroke();
  };
  for (const i of order) {
    const t = grid.terrain[i];
    const [cx, cy] = grid.center(i);
    const j = (k) => (hash(i, k) - 0.5) * sz;
    if (t === 7) { peak(cx + j(1) * 0.3, cy + sz * 0.55, sz * 1.15, sz * (1.9 + hash(i, 2) * 0.5), true); }
    else if (t === 6) {
      peak(cx - sz * 0.35 + j(3) * 0.2, cy + sz * 0.3, sz * 0.75, sz * (1.1 + hash(i, 4) * 0.4), false);
      peak(cx + sz * 0.35 + j(5) * 0.2, cy + sz * 0.6, sz * 0.8, sz * (1.2 + hash(i, 6) * 0.4), false);
    } else if (t === 3) {
      mound(cx - sz * 0.3 + j(7) * 0.2, cy + sz * 0.2, sz * 0.55, sz * 0.45);
      mound(cx + sz * 0.3 + j(8) * 0.2, cy + sz * 0.5, sz * 0.6, sz * 0.5);
    } else if (t === 2) {
      for (let k = 0; k < 4; k++) tree(cx + (hash(i, 11 + k) - 0.5) * sz * 1.3, cy + (hash(i, 21 + k) - 0.3) * sz * 0.9, sz * (0.75 + hash(i, 31 + k) * 0.3));
    }
  }
  return { cv, rcv, sc };
}

// ── 영토 덧칠 (주인이 바뀔 때만): 나라 색을 옅게 + 관할 경계(점선) + 나라 경계(굵게) ──
function paintOwners(grid, s, sc) {
  const [cv, ctx] = newLayer(grid, sc);
  const sz = grid.size;
  const byColor = new Map();
  for (let i = 0; i < grid.N; i++) {
    if (!grid.passable(i)) continue;
    const col = ownerColor(s, s.owner[i]);
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push(i);
  }
  ctx.globalAlpha = 0.34;
  for (const [col, list] of byColor) {
    ctx.beginPath();
    for (const i of list) { const [cx, cy] = grid.center(i); for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * 1.03, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
    ctx.fillStyle = col;
    ctx.fill();
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
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) for (const j of grid.nb[i]) if (j > i && grid.passable(j) && s.owner[j] === s.owner[i] && s.district[j] !== s.district[i]) edge(i, j);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = sz * 0.1;
  ctx.setLineDash([sz * 0.3, sz * 0.25]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 나라 경계: 바깥은 나라 색, 안쪽은 짙은 선
  const borders = new Map();
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) for (const j of grid.nb[i]) if (grid.passable(j) && s.owner[j] !== s.owner[i]) { const c = ownerColor(s, s.owner[i]); if (!borders.has(c)) borders.set(c, []); borders.get(c).push([i, j]); }
  ctx.beginPath();
  for (const list of borders.values()) for (const [i, j] of list) if (j > i) edge(i, j);
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
  return cv;
}

// 일기토 장면: 두 장수 초상이 부딪치며 합마다 체력이 깎이고 승자가 남음
function DuelView({ d, game }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((v) => Math.min(v + 1, d.rounds.length + 1)), 520);
    return () => clearInterval(t);
  }, [d]);
  const g = (name) => Object.values(game.generals).find((x) => x.name === name) || { name, war: 80, lead: 70, intel: 50, pol: 50 };
  const [ha, hb] = step === 0 ? [100, 100] : d.rounds[Math.min(step, d.rounds.length) - 1];
  const done = step > d.rounds.length;
  const side = (name, nat, hp, left) => (
    <div className={'duel-side' + (step > 0 && !done && step % 2 === (left ? 1 : 0) ? ' hit' : '') + (done && d.winner !== name ? ' lose' : '')}>
      <img src={portraitURL(g(name), game.nations[nat]?.color || '#fff')} alt="" width={96} height={96} />
      <b>{name}</b>
      <small>무력 {g(name).war}</small>
      <div className="duel-hp"><div style={{ width: `${hp}%`, background: hp > 40 ? '#6fd37f' : '#e2655a' }} /></div>
    </div>
  );
  return (
    <div className="duel">
      <div className="duel-title">⚔️ 일기토!</div>
      <div className="duel-row">
        {side(d.a, d.an, ha, true)}
        <div className="duel-vs">{done ? '🏆' : step % 2 ? '⚡' : '✦'}</div>
        {side(d.b, d.bn, hb, false)}
      </div>
      <div className="duel-msg">{done ? `${d.winner}의 승리!${d.fate || ''}` : `${Math.min(step + 1, d.rounds.length)}합째…`}</div>
    </div>
  );
}

export default function Hex14({ world, game, setGame, onExit }) {
  const grid = useMemo(() => buildGrid(world), [world]);
  const pid = game.playerId;
  const me = game.nations[pid];
  const startYear = getScenario(game.scenarioId)?.startYear ?? 200;
  const [sel, setSel] = useState(null); // {type:'castle'|'unit', id}
  const [sortieOpen, setSortieOpen] = useState(false);
  const [pickG, setPickG] = useState([]);
  const [amt, setAmt] = useState(0);
  const [draftAmt, setDraftAmt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [peek, setPeek] = useState(false);
  const [withSiege, setWithSiege] = useState(false);
  const [callAmt, setCallAmt] = useState(1000); // 장수 부를 때 데려올 병력 // 사신 창을 잠시 접고 그 나라를 지도에서 봄
  const [speed, setSpeed] = useState(420);
  const [toastMsg, setToast] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState('home');
  const [report, setReport] = useState(null);
  const [duel, setDuel] = useState(null);
  const [cutin, setCutin] = useState(null);
  const [corpsForm, setCorpsForm] = useState(null); // {cities: [], leader}
  const [founding, setFounding] = useState(false); // 새 도시 자리 고르는 중
  const spots = useMemo(() => (founding ? foundSpots(game, grid, pid) : null), [founding, game, grid, pid]);
  const spotsRef = useRef(null);
  spotsRef.current = spots;
  const canvas = useRef(null);
  const wrap = useRef(null);
  const view = useRef(null); // {x, y, k}
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const gameRef = useRef(game);
  gameRef.current = game;
  const selRef = useRef(sel);
  selRef.current = sel;
  const land = useRef({ key: null, img: null });
  const anim = useRef({ prev: new Map(), t0: 0, dur: 1 }); // 부대 이동 보간
  const fx = useRef([]); // 떠오르는 글자 {x, y, text, color, size, t0, life}
  const raf = useRef(0);

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
    const cw = el.clientWidth, ch = el.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    if (!view.current) {
      // 처음엔 내 수도 쪽을 크게
      const k = Math.max(cw / grid.W, ch / grid.H) * 2;
      const cap = s.castles.find((c) => c.owner === pid && c.capital) || s.castles.find((c) => c.owner === pid);
      const [x, y] = cap ? grid.center(cap.tile) : [grid.W / 2, grid.H / 2];
      view.current = { k, x: x - cw / k / 2, y: y - ch / k / 2 };
    }
    // 땅 그림: 주인 배열이 바뀌었을 때만 새로
    if (!land.current.base) land.current.base = paintTerrain(grid, world);
    if (land.current.ref !== s.owner) {
      const key = s.owner.join(',');
      if (land.current.key !== key) { land.current.key = key; land.current.over = paintOwners(grid, s, land.current.base.sc); }
      land.current.ref = s.owner;
    }
    const { k, x: vx, y: vy } = view.current;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#3f7598';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, -vx * k * dpr, -vy * k * dpr);
    ctx.imageSmoothingEnabled = true;
    const B = land.current.base;
    ctx.drawImage(B.cv, 0, 0, B.cv.width / B.sc, B.cv.height / B.sc);
    ctx.drawImage(land.current.over, 0, 0, B.cv.width / B.sc, B.cv.height / B.sc);
    ctx.drawImage(B.rcv, 0, 0, B.cv.width / B.sc, B.cv.height / B.sc);
    // 눈 덮인 북쪽
    if (s.weather?.kind === 'snow') {
      if (!land.current.snow) {
        const [scv, sctx] = (() => { const c2 = document.createElement('canvas'); c2.width = B.cv.width; c2.height = B.cv.height; const x = c2.getContext('2d'); x.scale(B.sc, B.sc); return [c2, x]; })();
        sctx.fillStyle = '#ffffff';
        for (let i = 0; i < grid.N; i++) { if (!grid.passable(i)) continue; const [hx, hy] = grid.center(i); if (hy > grid.H * 0.55) continue; sctx.globalAlpha = Math.min(1, (grid.H * 0.55 - hy) / (grid.H * 0.12)); sctx.beginPath(); for (let d = 0; d < 6; d++) { const [qx, qy] = corner(hx, hy, grid.size * 1.03, d); if (d) sctx.lineTo(qx, qy); else sctx.moveTo(qx, qy); } sctx.fill(); }
        land.current.snow = scv;
      }
      ctx.globalAlpha = 0.42;
      ctx.drawImage(land.current.snow, 0, 0, B.cv.width / B.sc, B.cv.height / B.sc);
      ctx.globalAlpha = 1;
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
    const ease = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    const posOf = (u) => {
      const [tx, ty] = grid.center(u.tile);
      const p = a.prev.get(u.id);
      if (p === undefined || p === u.tile) return [tx, ty];
      const [fx0, fy0] = grid.center(p);
      return [fx0 + (tx - fx0) * ease, fy0 + (ty - fy0) * ease];
    };
    // 새 도시 세울 수 있는 칸
    if (spotsRef.current) {
      ctx.fillStyle = `rgba(80,230,120,${0.35 + 0.15 * Math.sin(now / 250)})`;
      for (const t of spotsRef.current) { const [hx, hy] = grid.center(t); if (!vis(hx, hy)) continue; ctx.beginPath(); for (let d = 0; d < 6; d++) { const [qx, qy] = corner(hx, hy, sz * 0.9, d); if (d) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); } ctx.fill(); }
    }
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
      for (const t of u.path) { const [qx, qy] = grid.center(t); ctx.lineTo(qx, qy); }
      ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = grid.center(u.path[u.path.length - 1]);
      ctx.fillStyle = on ? '#ffe066' : 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(ex, ey, sz * 0.35, 0, 7); ctx.fill();
    }
    // 도시·관문
    const fs = Math.min(Math.max(sz * 0.9, 11 * px), 15 * px);
    for (const c of s.castles) {
      const [cx, cy] = grid.center(c.tile);
      if (!vis(cx, cy)) continue;
      const col = ownerColor(s, c.owner);
      const on = sl?.type === 'castle' && sl.id === c.id;
      // 도시·관문 그림 (나라 색 깃발), 바닥이 칸 아래쪽에 오게
      const S = sz * (c.kind === 'pass' ? 4.2 : c.capital ? 5.6 : 4.6);
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
      // 이름판
      if (k * sz > 2.2 || c.capital) {
        const label = `${c.capital ? '♛' : ''}${c.port ? '⚓' : ''}${c.name}${c.founding ? ` (공사 ${c.founding}턴)` : ''}`;
        ctx.font = `bold ${fs}px sans-serif`;
        const tw = ctx.measureText(label).width + fs * 0.6;
        const ly = cy + sz * 2.6;
        ctx.fillStyle = 'rgba(20,16,12,0.82)';
        ctx.fillRect(cx - tw / 2, ly - fs * 0.85, tw, fs * 1.2);
        ctx.fillStyle = col;
        ctx.fillRect(cx - tw / 2, ly - fs * 0.85, fs * 0.22, fs * 1.2);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, ly + fs * 0.12);
        if (k * sz > 4.5) {
          ctx.font = `${fs * 0.8}px sans-serif`;
          ctx.fillStyle = '#ffe9a8';
          ctx.strokeStyle = '#111';
          ctx.lineWidth = fs * 0.22;
          ctx.strokeText(fmtTroops(c.troops), cx, ly + fs * 1.1);
          ctx.fillText(fmtTroops(c.troops), cx, ly + fs * 1.1);
        }
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
    // 망루 화살
    for (const e of s.fx || []) {
      if (e.type !== 'arrow') continue;
      const [ax, ay] = grid.center(e.a), [bx, by] = grid.center(e.b);
      ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = Math.max(sz * 0.08, px); ctx.setLineDash([sz * 0.25, sz * 0.2]);
      ctx.beginPath(); ctx.moveTo(ax, ay - sz * 1.5); ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - sz * 3, bx, by); ctx.stroke(); ctx.setLineDash([]);
    }
    // 교전 표시 (칼 엇갈림)
    for (const e of s.fx || []) {
      if (e.type !== 'clash') continue;
      const [ax, ay] = grid.center(e.a), [bx, by] = grid.center(e.b);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (!vis(mx, my)) continue;
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
      const wave = Math.sin(now / 260 + u.id) * sz * 0.12;
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
      const mark = n.name[0];
      ctx.strokeText(mark, fx0 + fw / 2, top + fh * 0.75 + wave / 2);
      ctx.fillText(mark, fx0 + fw / 2, top + fh * 0.75 + wave / 2);
      // 물 위면 배
      if (grid.water[u.tile]) {
        ctx.fillStyle = '#6b4423';
        ctx.beginPath(); ctx.moveTo(cx - sz * 1.4, cy - sz * 0.1); ctx.lineTo(cx + sz * 1.4, cy - sz * 0.1); ctx.lineTo(cx + sz * 1.0, cy + sz * 0.55); ctx.lineTo(cx - sz * 1.0, cy + sz * 0.55); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#3a2412'; ctx.lineWidth = sz * 0.1; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = sz * 0.08; ctx.beginPath(); ctx.moveTo(cx - sz * 1.6, cy + sz * 0.6); ctx.quadraticCurveTo(cx, cy + sz * 0.9, cx + sz * 1.6, cy + sz * 0.6); ctx.stroke();
      }
      // 대장 초상 (장수마다 다른 얼굴)
      const pr = sz * 1.05;
      if (g) ctx.drawImage(portraitCanvas(g, n.color), cx - pr, cy - sz * 0.55 - pr, pr * 2, pr * 2);
      if (on || u.cut) { ctx.beginPath(); ctx.arc(cx, cy - sz * 0.55, pr + sz * 0.12, 0, 7); ctx.lineWidth = Math.max(sz * 0.22, 2 * px); ctx.strokeStyle = on ? '#ffe066' : '#ff7a3c'; ctx.stroke(); }
      if (u.gens.length > 1) { ctx.font = `bold ${sz * 0.6}px sans-serif`; ctx.fillStyle = '#ffe066'; ctx.strokeStyle = '#111'; ctx.lineWidth = sz * 0.12; const t = `+${u.gens.length - 1}`; ctx.strokeText(t, cx + pr * 0.95, cy - sz * 0.55 + pr * 0.9); ctx.fillText(t, cx + pr * 0.95, cy - sz * 0.55 + pr * 0.9); }
      // 병력·사기 막대
      const bw = sz * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw, sz * 0.5);
      ctx.fillStyle = '#6fd37f';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw * Math.min(1, u.troops / u.max), sz * 0.25);
      ctx.fillStyle = '#5fb0ff';
      ctx.fillRect(cx - bw / 2, cy + sz * 1.0, bw * Math.min(1, u.morale / 100), sz * 0.25);
      const lw = fs * 5.5, lh = fs;
      const free = on || !labels.some(([lx, ly]) => Math.abs(lx - cx) < lw && Math.abs(ly - top) < lh);
      if (k * sz > 4.5 && free) {
        labels.push([cx, top]);
        ctx.font = `bold ${fs * 0.78}px sans-serif`;
        const lab = `${g?.name || ''} ${fmtTroops(u.troops)}`;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = fs * 0.22;
        ctx.fillStyle = '#fff';
        ctx.strokeText(lab, cx, top - fs * 0.35);
        ctx.fillText(lab, cx, top - fs * 0.35);
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
    // 날씨 효과 (화면 기준): 비 줄기·눈송이·바람
    const wk = s.weather?.kind;
    if (wk === 'rain' || wk === 'snow' || wk === 'wind') {
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
    const busy = !!spotsRef.current || wk === 'rain' || wk === 'snow' || wk === 'wind' || f < 1 || fx.current.length || (s.fx || []).some((e) => e.type === 'clash' || e.type === 'arrow') || s.units.length;
    cancelAnimationFrame(raf.current);
    if (busy) raf.current = requestAnimationFrame(draw);
  };
  useEffect(() => { draw(); });
  // Esc: 선택·새 도시 자리 고르기 취소
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSel(null); setFounding(false); setSortieOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 자동 시험용: 부대·도시의 화면 좌표
  useEffect(() => {
    window.__h14 = {
      screenOf: (tile, up = 0) => { const r = wrap.current.getBoundingClientRect(), v = view.current, [x, y] = grid.center(tile); return [r.left + (x - v.x) * v.k, r.top + (y - grid.size * up - v.y) * v.k]; },
      spots: () => spotsRef.current || [],
      castles: () => gameRef.current.castles.map((c) => ({ id: c.id, tile: c.tile, name: c.name, owner: c.owner, troops: c.troops, kind: c.kind, dur: c.dur, building: !!c.build, founding: !!c.founding })),
      units: () => gameRef.current.units.map((u) => ({ id: u.id, tile: u.tile, nation: u.nation, name: gensOf(gameRef.current, u.gens)[0]?.name, troops: u.troops, order: u.order?.kind || null, target: u.order?.id ?? null, moving: u.path.length > 0, dest: u.path[u.path.length - 1] ?? null })),
      dist: (a, b) => grid.dist(a, b),
      nb: (t) => grid.nb[t].filter((x) => grid.passable(x)),
      focus: (tile) => { const el = wrap.current, v = view.current; if (!el || !v) return; const [x, y] = grid.center(tile); v.x = x - el.clientWidth / v.k / 2; v.y = y - el.clientHeight / v.k / 2; draw(); },
      state: () => { const g = gameRef.current; return { turn: g.turn, day: g.day, gold: g.nations[pid].gold, food: g.nations[pid].food, alive: g.nations[pid].alive, over: g.over, pid, cities: g.castles.filter((c) => c.owner === pid).length, total: g.castles.filter((c) => c.kind !== 'pass').length, pacts: (g.pacts || []).filter((p) => p.until > g.turn && (p.a === pid || p.b === pid)).map((p) => (p.a === pid ? p.b : p.a)) }; },
      gensAt: (cid) => Object.values(gameRef.current.generals).filter((g) => g.castle === cid && g.status === 'active').length,
    };
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    const onR = () => draw();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  });

  // 하루 결과의 효과를 떠오르는 글자로
  const spawnFx = (s) => {
    const now = performance.now();
    for (const e of s.fx || []) {
      if (e.type === 'clash') continue;
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
    return [v.x + (px - r.left) / v.k, v.y + (py - r.top) / v.k];
  };
  const onDown = (e) => {
    if (e.target !== canvas.current) return; // 지도 위 버튼은 지도 누르기로 치지 않음
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) { const [[ax, ay], [bx, by]] = [...pointers.current.values()]; drag.current = { pinch: Math.hypot(ax - bx, ay - by), k: view.current.k, moved: true }; return; }
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
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
    view.current.x = d.vx - dx / view.current.k;
    view.current.y = d.vy - dy / view.current.k;
    draw();
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && !d.pinch) tap(e.clientX, e.clientY);
  };
  const zoomAt = (px, py, f) => {
    const v = view.current;
    const [wx, wy] = toWorld(px, py);
    const nk = Math.max(0.5, Math.min(14, v.k * f));
    const r = wrap.current.getBoundingClientRect();
    v.k = nk; v.x = wx - (px - r.left) / nk; v.y = wy - (py - r.top) / nk;
    draw();
  };
  const onWheel = (e) => zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);

  const act = (fn) => {
    const s = clone(game);
    const r = fn(s);
    if (r && r.ok === false) { toast(r.msg); return r; }
    setGame(s);
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
      const nm = window.prompt(`새 도시 이름 (금 ${fmtGold(FOUND_COST)}, ${FOUND_TURNS}턴)`, '');
      if (nm === null) return;
      act((s) => foundCity(s, grid, t, pid, nm.trim() || undefined));
      setFounding(false);
      return;
    }
    const hit = pick(wx, wy);
    const u = hit?.type === 'unit' ? hit.o : null;
    const c = hit?.type === 'castle' ? hit.o : null;
    const fo = hit?.type === 'fort' ? hit.o : null;
    // 내 부대를 고른 상태에서 적 시설을 누르면 부수러 감
    if (selUnit && selUnit.nation === pid && fo && fo.owner !== pid) {
      if (!enemy(game, pid, fo.owner)) return toast('약조를 맺은 나라의 시설입니다.');
      act((s) => { const su = s.units.find((x) => x.id === selUnit.id); const r = order(s, grid, su, 'fort', fo.id); if (r.ok) r.msg = `${FORTS[fo.kind].name} 부수러 감`; return r; });
      return;
    }
    // 내 부대를 고른 상태: 누른 곳으로 명령
    if (selUnit && selUnit.nation === pid && !(u && u.nation === pid)) {
      const kind = u ? 'unit' : c ? 'castle' : 'tile';
      if (kind === 'tile' && (t < 0 || !grid.passable(t))) return toast('갈 수 없는 곳입니다.');
      const id = u ? u.id : c ? c.id : t;
      const other = u ? u.nation : c && c.owner !== pid ? c.owner : null;
      if (other !== null && other !== undefined && !enemy(game, pid, other)) return toast(`${game.nations[other].name}과(와)는 ${PACT[pactOf(game, pid, other).type]} 중이라 칠 수 없습니다.`);
      act((s) => {
        const su = s.units.find((x) => x.id === selUnit.id);
        const r = order(s, grid, su, kind, id);
        if (r.ok) r.msg = kind === 'unit' ? `${gensOf(s, su.gens)[0].name} → 적 부대 공격` : kind === 'castle' ? (c.owner === pid ? `${c.name}에 입성` : `${c.name} 공략`) : '이동';
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
  const runTurn = (toEnd = false) => {
    if (playing || game.over) return;
    if (game.inbox?.length) { setPeek(false); return; } // 사신에게 먼저 답해야 진행
    const s = clone(game);
    const startN = s.logN || 0;
    if (s.day === 0) {
      for (const n of s.nations) if (n.alive && n.id !== pid) aiTurn14(s, grid, n.id);
      if (game.spectator && s.nations[pid].alive) aiTurn14(s, grid, pid);
      else for (const c of s.corps || []) aiTurn14(s, grid, pid, { cities: new Set(c.cities.filter((id) => s.castles[id]?.owner === pid)), corps: c.id });
    }
    setPlaying(true);
    setReport(null);
    const finish = (snap) => {
      // 순이 끝남: 정산 후 이번 순 소식
      snap.fx = [];
      endTurn14(snap, grid);
      const news = snap.log.filter((l) => (l.n || 0) > startN && l.nations?.includes(pid) && ['capture', 'battle', 'diplo', 'bad'].includes(l.kind) && !l.text.startsWith('🔥')).map((l) => l.text);
      for (const c of snap.castles.filter((x) => x.owner === pid)) {
        const foes = snap.units.filter((u) => enemy(snap, pid, u.nation) && ((u.order?.kind === 'castle' && u.order.id === c.id) || grid.dist(u.tile, c.tile) <= 3));
        if (foes.length) news.push(`⚠️ ${[...new Set(foes.map((u) => snap.nations[u.nation].name))].join('·')}군 ${foes.length}부대(${fmtTroops(foes.reduce((a, u) => a + u.troops, 0))})가 ${c.name}(수비 ${fmtTroops(c.troops)})을 노립니다`);
      }
      setReport(news.length ? news.slice(0, 8) : null);
      return snap;
    };
    const done = (snap) => {
      setGame(snap);
      setPlaying(false);
      setSel((v) => (v?.type === 'unit' && !snap.units.some((u) => u.id === v.id) ? null : v));
    };
    const tick = () => {
      anim.current = { prev: new Map(s.units.map((u) => [u.id, u.tile])), t0: performance.now(), dur: speed * 0.9 };
      stepDay(s, grid);
      spawnFx(s);
      // 내 장수가 낀 일기토는 장면으로 보여 주고 잠시 멈춤, 고유 전법은 컷인
      const dl = (s.duels || []).find((x) => x.an === pid || x.bn === pid);
      const ui = (s.fx || []).find((e) => e.type === 'tactic' && e.unique && (e.nation === pid || s.units.some((u) => u.nation === pid && u.tile === e.to)));
      if (ui) { setCutin(ui); setTimeout(() => setCutin(null), 1500); }
      if (dl) setDuel(dl);
      const wait = dl ? 3600 : 0;
      const snap = clone(s);
      setGame(snap);
      const endOfTurn = s.day >= DAYS || s.over;
      if (endOfTurn || !toEnd) {
        setTimeout(() => { setDuel(null); done(endOfTurn ? finish(clone(s)) : snap); }, Math.max(speed * 0.9, wait));
        return;
      }
      setTimeout(() => { setDuel(null); tick(); }, speed + wait);
    };
    setTimeout(tick, 60);
  };

  // 출진 창 기본값
  const castleGens = selCastle ? Object.values(game.generals).filter((g) => g.castle === selCastle.id && g.status === 'active') : [];
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
  const inc = useMemo(
    () =>
      game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + castleIncome(game, grid, c), 0) -
      Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active').length * 200 - game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + Object.values(c.bld || {}).reduce((x, y) => x + y, 0) * 300, 0) - (me.policies || []).length * POLICY_UPKEEP,
    [game, grid, pid],
  );
  const food = me.food ?? 0, use = foodUse(game, pid);
  const turnsToHarvest = (((HARVEST_MONTH * 3 - (game.turn - 1)) % 36) + 36) % 36;
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
  const freeIn = (c) => Object.values(game.generals).filter((g) => g.status === 'free' && g.castle === c.id);
  const Loyal = ({ g }) => (g.ruler ? null : <small style={{ color: loyalOf(g) < 40 ? 'var(--danger)' : 'var(--muted)', marginLeft: 2 }}>충{loyalOf(g)}</small>);
  const Face = ({ g, size = 26, col = '#fff' }) => <img src={portraitURL(g, col)} alt="" width={size} height={size} style={{ verticalAlign: 'middle', marginRight: 4, borderRadius: '50%' }} />;
  const tacticName = (g) => {
    const un = uniqueOf(g);
    if (un) return `${un[0]}★`;
    const [k, v] = [['war', g.war], ['lead', g.lead], ['intel', g.intel]].sort((a, b) => b[1] - a[1])[0];
    return v < 70 ? null : { war: '돌격', lead: '일제사격', intel: '화계' }[k];
  };

  const panel = (
    <div className="h14-side">
      {selCastle && (
        <div className="card">
          <h3 style={{ margin: '0 0 6px' }}>
            {selCastle.kind === 'pass' ? '⛩️' : '🏯'} {selCastle.capital ? '♛ ' : ''}{selCastle.name}{' '}
            <small className="muted">{selCastle.owner !== null && selCastle.owner >= 0 ? game.nations[selCastle.owner].name : selCastle.bandit || '중립'}</small>
          </h3>
          <div className="kv">
            <span>수비병</span><span>{fmtTroops(selCastle.troops)}</span>
            <span>성벽</span><span>{Math.round(selCastle.dur)} / {selCastle.maxDur}</span>
            {selCastle.kind !== 'pass' && <><span>인구</span><span>{Math.round(selCastle.pop)}천</span></>}
            {selCastle.kind !== 'pass' && selCastle.owner !== null && <><span>관할 땅</span><span>{Math.round(landShare(game, selCastle) * 100)}% · 수입 {fmtGold(castleIncome(game, grid, selCastle))} <small className="muted">지도에 흰색=내 관할, 빨강=아직 남의 것(채울수록 금·병량·자원병↑, 매 순 저절로 몇 칸씩 넓어짐)</small></span></>}
            {selCastle.kind === 'pass' && <><span>관문</span><span>수입은 없지만 성벽이 두꺼워 길목을 막음</span></>}
            <span>장수</span><span>{castleGens.length ? castleGens.map((g) => <span key={g.id} style={{ display: 'inline-block', marginRight: 6 }}><Face g={g} size={22} col={ownerColor(game, selCastle.owner)} />{g.name}{selCastle.owner === pid && <Loyal g={g} />}</span>) : '없음'}</span>
          </div>
          {(game.corps || []).filter((co) => co.cities.includes(selCastle.id)).map((co) => <div key={co.id} className="muted" style={{ fontSize: 12, marginTop: 4 }}>🎖️ {game.generals[co.leader]?.name} 군단이 맡은 도시입니다 (직접 출진도 가능)</div>)}
          {selCastle.port && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>⚓ 항구: 여기서 나간 부대는 배로 바닷길을 갈 수 있습니다.</div>}
          {selCastle.kind !== 'pass' && selCastle.owner !== null && (
            <div className="card" style={{ background: 'var(--panel)', marginTop: 8, fontSize: 13 }}>
              <b>🏛️ 내정</b>
              <div className="kv" style={{ marginTop: 4 }}>
                <span>농업</span><span>{selCastle.farm} / {selCastle.devMax} · 가을 수확 약 {fmtTroops(harvestOf(game, selCastle))}</span>
                <span>상업</span><span>{selCastle.trade} / {selCastle.devMax} · 금 +{fmtGold(goldOf(game, selCastle))}/순</span>
              </div>
              {selCastle.owner === pid ? (
                <>
                  {Object.entries(ROLES).map(([role, label]) => (
                    <div key={role} className="row" style={{ gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <span style={{ width: 34 }}>{label}</span>
                      <select disabled={selCastle.auto || playing} value={jobGen(game, selCastle, role)?.id || ''} onChange={(e) => act((s) => { const c = s.castles[selCastle.id]; for (const r of Object.keys(ROLES)) if (c.jobs[r] === e.target.value) c.jobs[r] = null; c.jobs[role] = e.target.value || null; })} style={{ flex: 1 }}>
                        <option value="">(없음)</option>
                        {castleGens.map((g) => <option key={g.id} value={g.id}>{g.name} ({role === 'draft' ? `통${g.lead}` : `정${g.pol}`})</option>)}
                      </select>
                    </div>
                  ))}
                  <label style={{ display: 'block', marginTop: 4 }}>
                    <input type="checkbox" checked={!!selCastle.auto} disabled={playing} onChange={(e) => act((s) => { const c = s.castles[selCastle.id]; c.auto = e.target.checked; if (c.auto) autoJobs(s, c); })} /> 담당관 자동 배치 (위임)
                  </label>
                  <div className="muted" style={{ fontSize: 11 }}>농업·상업 담당은 정치가 높을수록 빨리 오르고, 징병 담당은 통솔만큼 자원병을 더 모읍니다.</div>
                </>
              ) : null}
            </div>
          )}
          {selCastle.owner === pid && selCastle.kind !== 'pass' && !playing && (() => {
            // 장수 부르기: 비어 있는 담당에 맞는 장수를 위로 (다른 성에 장수가 둘 이상 있을 때만 빼 옴)
            const need = Object.keys(ROLES).filter((r) => !jobGen(game, selCastle, r));
            const cands = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active' && g.castle !== null && g.castle !== undefined && g.castle !== selCastle.id && !g.ruler && Object.values(game.generals).filter((x) => x.castle === g.castle && x.status === 'active').length >= 2)
              .map((g) => ({ g, fit: Math.max(0, ...need.map((r) => (r === 'draft' ? g.lead : g.pol))), d: grid.dist(game.castles[g.castle].tile, selCastle.tile) }))
              .sort((a, b) => b.fit - a.fit || a.d - b.d).slice(0, 6);
            if (!cands.length) return null;
            return (
              <details className="card" style={{ background: 'var(--panel)', marginTop: 8, fontSize: 13 }}>
                <summary><b>👥 장수 부르기</b> <small className="muted">{need.length ? `빈 담당: ${need.map((r) => ROLES[r]).join('·')} — 맞는 장수가 위` : '다른 성 장수를 병력과 함께 데려옴'}</small></summary>
                <div style={{ fontSize: 12, marginTop: 4 }}>데려올 병력 {fmtTroops(callAmt)} <small className="muted">(최소 1천, 출진 비용 {fmtGold(sortieCost(game, pid, callAmt))})</small></div>
                <Slider min={1000} max={20000} step={500} value={callAmt} onChange={setCallAmt} style={{ width: '100%' }} />
                {cands.map(({ g, d }) => (
                  <div key={g.id} className="row" style={{ justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
                    <span><Face g={g} col={me.color} /> {g.name} <small className="muted">정{g.pol} 통{g.lead} · {game.castles[g.castle].name} {d}칸</small></span>
                    <button className="sm" onClick={() => act((s) => summonGeneral(s, grid, g.id, selCastle.id, Math.min(callAmt, s.castles[g.castle].troops - 500)))}>부르기</button>
                  </div>
                ))}
              </details>
            );
          })()}
          {selCastle.owner === pid && freeIn(selCastle).length > 0 && (
            <div className="card" style={{ background: 'var(--panel)', marginTop: 8, fontSize: 13 }}>
              <b>🧑‍🎓 재야 인재</b>
              {freeIn(selCastle).map((g) => (
                <div key={g.id} className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <span><Face g={g} /> {g.name} <small className="muted">무{g.war} 통{g.lead} 지{g.intel} 정{g.pol}</small></span>
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
            <div className="card" style={{ background: 'var(--panel)', marginTop: 8, fontSize: 13 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>🏗️ 시설</b><small className="muted">{usedSlots(selCastle)}/{slotsOf(selCastle)}칸</small></div>
              {selCastle.founding && <div>🔨 새 도시 공사 중 — {selCastle.founding}턴 남음</div>}
              {selCastle.build && (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🔨 {BUILDINGS[selCastle.build.type].icon} {BUILDINGS[selCastle.build.type].name} — {selCastle.build.left}턴 남음</span>
                  {selCastle.owner === pid && !playing && <button className="sm" onClick={() => act((s) => cancelBuild(s, selCastle.id))}>멈춤</button>}
                </div>
              )}
              {Object.entries(BUILDINGS).filter(([k, b]) => (selCastle.kind !== 'pass' || k === 'wall') && (!b.port || selCastle.port)).map(([k, b]) => {
                const why = canBuild(game, selCastle, k);
                return (
                  <div key={k} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                    <span title={b.desc}>{b.icon} {b.name} <small className="muted">{lv(selCastle, k)}/{b.max} · {b.desc}</small></span>
                    {selCastle.owner === pid && !playing && lv(selCastle, k) < b.max && <button className="sm" disabled={!!why} title={why || ''} onClick={() => act((s) => startBuild(s, selCastle.id, k))}>{fmtGold(buildCost(game, selCastle, k))} · {b.turns}턴</button>}
                  </div>
                );
              })}
            </div>
          )}
          {selCastle.owner === pid && !playing && (
            <div className="col" style={{ marginTop: 8 }}>
              {!sortieOpen ? (
                <button className="primary" disabled={!castleGens.length || selCastle.troops < 1500} onClick={() => setSortieOpen(true)}>⚔️ 출진 {castleGens.length ? '' : '(장수 없음)'}</button>
              ) : (
                <div className="card" style={{ background: 'var(--panel)' }}>
                  <b>출진할 장수 (최대 3명)</b>
                  {castleGens.map((g) => (
                    <label key={g.id} style={{ display: 'block', fontSize: 13 }}>
                      <input type="checkbox" checked={pickG.includes(g.id)} onChange={(e) => {
                        const nx = e.target.checked ? [...pickG, g.id].slice(-3) : pickG.filter((x) => x !== g.id);
                        setPickG(nx);
                        setAmt(Math.max(0, Math.min(commandCap(game, nx), selCastle.troops - 500)));
                      }} /> <Face g={g} col={me.color} /> {g.name}<Loyal g={g} /> <small className="muted">무{g.war} 통{g.lead} 지{g.intel}{tacticName(g) ? ` · 「${tacticName(g)}」` : ''}{(g.traits || []).some(([t]) => t === '기마') ? ' · 기마' : ''}</small>
                    </label>
                  ))}
                  <div style={{ fontSize: 13, marginTop: 4 }}>병력 {fmtTroops(Math.min(amt, maxAmt))} / 지휘 한도 {fmtTroops(cap)} · 출진 비용 금 {fmtGold(sortieCost(game, pid, Math.min(amt, maxAmt), withSiege))} (가진 금 {fmtGold(me.gold)})</div>
                  {afford < Math.min(cap, selCastle.troops - 500) && <div style={{ fontSize: 12, color: 'var(--danger)' }}>💰 금이 모자라 {fmtTroops(afford)}까지만 데리고 나갈 수 있습니다 (1명당 0.5금 · 「군비 확장」 정책이면 무료)</div>}
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
                  <Slider min={0} max={maxAmt} step={100} value={Math.min(amt, maxAmt)} onChange={setAmt} style={{ width: '100%' }} />
                  <label style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    <input type="checkbox" checked={withSiege} onChange={(e) => setWithSiege(e.target.checked)} /> 🪨 공성병기 끌고 감 (금 {fmtGold(SIEGE_COST)}) <span className="muted">성벽 5배로 깎음 · 이동 −30% · 들판 싸움 공격 −20%·받는 피해 +35% · 함락하면 부서짐 (들판에서 부대로도 만들 수 있음)</span>
                  </label>
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                    <button onClick={() => setSortieOpen(false)}>취소</button>
                    <button className="primary" disabled={!pickG.length || Math.min(amt, maxAmt) < 1000} onClick={() => {
                      const r = act((s) => sortie(s, grid, selCastle.id, pickG, Math.min(amt, maxAmt), withSiege));
                      if (r?.ok) { setSortieOpen(false); setSel({ type: 'unit', id: r.unit.id }); setSheet(false); toast('부대가 나왔습니다. 지도에서 목적지·공격할 곳을 누르세요.'); }
                    }}>출진</button>
                  </div>
                </div>
              )}
              {selCastle.kind !== 'pass' && (
                <div style={{ fontSize: 13 }}>
                  징병 {fmtTroops(Math.min(draftAmt, draftMax14(game, selCastle)))} (1명당 {draftCost(selCastle, game)}금)
                  <Slider min={0} max={draftMax14(game, selCastle)} step={100} value={Math.min(draftAmt, draftMax14(game, selCastle))} onChange={setDraftAmt} style={{ width: '100%' }} />
                  <button disabled={draftAmt < 100} onClick={() => act((s) => draft14(s, selCastle.id, draftAmt))}>💂 징병</button>
                  {(() => {
                    const after = selCastle.troops + Math.min(draftAmt, draftMax14(game, selCastle));
                    const out = Math.max(0, Math.min(after - 500, castleGens.length ? commandCap(game, castleGens.slice(0, 3).map((g) => g.id)) : 0));
                    const cost = sortieCost(game, pid, out) + Math.min(draftAmt, draftMax14(game, selCastle)) * draftCost(selCastle, game);
                    return <div className="muted" style={{ fontSize: 11 }}>징병 후 수비 {fmtTroops(after)} · 장수 셋이 최대로 데리고 나가면 출진 {fmtTroops(out)}, 징병+출진에 금 약 {fmtGold(cost)} 필요 (지금 {fmtGold(me.gold)})</div>;
                  })()}
                </div>
              )}
            </div>
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
        const days = selUnit.path.length ? Math.ceil(selUnit.path.length / 0.6) : 0;
        return (
          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>⚑ {gs.map((g) => g.name).join('·')} 부대 <small className="muted">{game.nations[selUnit.nation].name}</small></h3>
            <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              {gs.map((g) => <div key={g.id} style={{ textAlign: 'center', fontSize: 11 }}><Face g={g} size={52} col={game.nations[selUnit.nation].color} /><div>{g.name}</div><div className="muted">무{g.war} 통{g.lead} 지{g.intel}</div>
                {selUnit.nation === pid && gs.length > 1 && <button className="sm" disabled={playing} title="이 장수를 떼어 병력을 나눠 옆 칸에 세움" onClick={() => act((s) => splitUnit(s, grid, selUnit.id, g.id))}>✂️ 나누기</button>}</div>)}
            </div>
            <div className="kv">
              <span>병력</span><span>{fmtTroops(selUnit.troops)} / {fmtTroops(selUnit.max)}</span>
              <span>사기 (파란 막대)</span><span>{Math.round(selUnit.morale)} <small className="muted">5 이하면 패주 · 내 땅에서 쉬면 +3/일, 진지 안 +6/일</small></span>
              <span>공·방</span><span>{Math.round(st.atk)} · {Math.round(st.def)}{selUnit.siege ? ' · 🪨 공성병기' : ''}</span>
              <span>전법</span><span>{gs.map(tacticName).filter(Boolean).join(', ') || '없음'}</span>
              <span>보급</span><span style={{ color: selUnit.cut ? 'var(--danger)' : undefined }}>{selUnit.cut ? '끊김 (병력·사기 감소)' : '이어짐'}</span>
              <span>목표</span><span>{tgt}{days ? ` (약 ${days}일)` : ''}</span>
              <span>지형</span><span>{TERRAIN_NAME[grid.terrain[selUnit.tile]] || '-'}</span>
            </div>
            {selUnit.nation === pid && !playing && (
              <>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>지도를 누르면 이동, 적 부대를 누르면 공격, 적 성을 누르면 공략, 내 성을 누르면 입성.</div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <button onClick={() => act((s) => { const u = s.units.find((x) => x.id === selUnit.id); const h = nearestCastle(s, grid, u.tile, pid); return h ? order(s, grid, u, 'castle', h.id) : { ok: false, msg: '돌아갈 성이 없습니다.' }; })}>🏠 귀환</button>
                  <button onClick={() => act((s) => { const u = s.units.find((x) => x.id === selUnit.id); u.path = []; u.order = null; return { ok: true, msg: '정지' }; })}>✋ 정지</button>
                </div>
                <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                  {!selUnit.siege && <button className="sm" disabled={me.gold < SIEGE_COST} title="성벽 5배로 깎음 · 느려지고 들판 싸움에 약함 · 함락하면 부서짐" onClick={() => act((s) => buildSiege(s, selUnit.id))}>🪨 공성병기 만들기 {fmtGold(SIEGE_COST)}</button>}
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
                <div className="muted" style={{ fontSize: 11 }}>진지: 안의 아군 피해 −30%·보급 거점·사기 회복 · 망루: 2칸 안 적 부대 매일 공격 · 목책: 바로 세움, 적이 못 지나가고 옆에 온 적은 그날 멈춤(이동하며 여러 개로 길 막기). 진지·망루는 부대가 그 칸에 멈춰 지어야 합니다.</div>
              </>
            )}
          </div>
        );
      })()}
      {!selCastle && !selUnit && !selFort && (
        <>
          <div className="row h14-tabs">
            {[['home', '🏯 세력'], ['diplo', '🤝 외교'], ['people', '🧑 인재'], ['log', '📜 기록'], ['help', '❓']].map(([k, l]) => (
              <button key={k} className={'sm' + (tab === k ? ' primary' : '')} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'home' && (
            <div className="card" style={{ fontSize: 13 }}>
              <div className="kv">
                <span>금</span><span>{fmtGold(me.gold)} ({inc >= 0 ? '+' : ''}{fmtGold(inc)}/순)</span>
                <span>병량</span><span style={{ color: food < use * 6 ? 'var(--danger)' : undefined }}>{fmtTroops(food)} (−{fmtTroops(use)}/순 · 수확까지 {turnsToHarvest}순)</span>
                <span>병력</span><span>{fmtTroops(powerOf(game, pid))}</span>
                <span>장수</span><span>{Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active').length}명</span>
                {(() => {
                  const gs = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active' && !g.ruler);
                  const avg = gs.length ? Math.round(gs.reduce((a, g) => a + loyalOf(g), 0) / gs.length) : 100;
                  const low = gs.filter((g) => loyalOf(g) < 40);
                  return <><span>충성</span><span style={{ color: low.length ? 'var(--danger)' : undefined }}>평균 {avg}{low.length ? ` · 불만 ${low.length}명 (${low.slice(0, 3).map((g) => g.name).join(', ')}${low.length > 3 ? '…' : ''})` : ''}</span></>;
                })()}
                {sprawlOf(game, pid) < 1 && <><span>영토 관리</span><span className="muted">도시가 15개를 넘어 수입·수확·자원병 −{Math.round((1 - sprawlOf(game, pid)) * 100)}%</span></>}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6 }}>
                <button className="sm" disabled={playing || me.gold < rewardCost(game, pid)} title="충성 35 아래면 다른 나라로 떠날 수 있습니다. 금이 바닥나면 충성이 떨어집니다." onClick={() => act((s) => rewardAll(s, pid))}>🎁 전체 포상 (금 {fmtGold(rewardCost(game, pid))}, 충성 +12)</button>
              </div>
              <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <small>🏪 시장</small>
                <button className="sm" disabled={playing || me.gold < 10000} onClick={() => act((s) => trade(s, pid, 'buy', 10000))}>병량 사기 (금 1만→{fmtTroops(10000 * MARKET.buy)})</button>
                <button className="sm" disabled={playing || food < 10000} onClick={() => act((s) => trade(s, pid, 'sell', 10000))}>병량 팔기 (1만→금 {fmtGold(10000 * MARKET.sell)})</button>
              </div>
              <div className="row" style={{ gap: 4, marginTop: 6, alignItems: 'center' }}>
                <button className="sm" disabled={playing || me.gold < FOUND_COST} onClick={() => { setFounding(true); setSheet(false); toast('지도에서 새 도시 자리를 누르세요.'); }}>🏗️ 새 도시 세우기 (금 {fmtGold(FOUND_COST)} · {FOUND_TURNS}턴)</button>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><b>📜 정책</b><small className="muted">{(me.policies || []).length}/{policySlots(game, pid)}칸 · 펼칠 때 금 {fmtGold(POLICY_COST)}, 순마다 {fmtGold(POLICY_UPKEEP)}</small></div>
                {Object.entries(POLICIES).map(([k, p]) => {
                  const on = (me.policies || []).includes(k);
                  return (
                    <div key={k} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
                      <span style={{ color: on ? '#ffe066' : undefined }}>{p.icon} {p.name} <small className="muted">{p.desc}</small></span>
                      {on ? <button className="sm" disabled={playing} onClick={() => act((s) => dropPolicy(s, pid, k))}>거두기</button> : <button className="sm" disabled={playing || (me.policies || []).length >= policySlots(game, pid) || me.gold < POLICY_COST} onClick={() => act((s) => adoptPolicy(s, pid, k))}>펼치기</button>}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><b>🎖️ 군단 (도시를 맡겨 컴퓨터가 운영)</b>{!corpsForm && <button className="sm" disabled={playing} onClick={() => setCorpsForm({ cities: [], leader: '' })}>＋ 만들기</button>}</div>
                {(game.corps || []).map((co) => (
                  <div key={co.id} className="row" style={{ justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                    <span>{game.generals[co.leader] && <Face g={game.generals[co.leader]} size={20} col={me.color} />}{game.generals[co.leader]?.name || '?'} 군단 · {co.cities.filter((id) => game.castles[id].owner === pid).map((id) => game.castles[id].name).join(', ')} · 부대 {game.units.filter((u) => u.corps === co.id).length}</span>
                    <button className="sm" disabled={playing} onClick={() => act((s) => { s.corps = s.corps.filter((x) => x.id !== co.id); for (const u of s.units) if (u.corps === co.id) delete u.corps; return { ok: true, msg: '군단을 해산했습니다.' }; })}>해산</button>
                  </div>
                ))}
                {corpsForm && (() => {
                  const taken = new Set((game.corps || []).flatMap((c) => c.cities));
                  const avail = game.castles.filter((c) => c.owner === pid && !taken.has(c.id));
                  const gens = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active' && corpsForm.cities.includes(g.castle));
                  return (
                    <div className="card" style={{ background: 'var(--panel)', marginTop: 6, fontSize: 12 }}>
                      <div>맡길 도시</div>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {avail.map((c) => (
                          <label key={c.id}><input type="checkbox" checked={corpsForm.cities.includes(c.id)} onChange={(e) => setCorpsForm((f) => ({ ...f, cities: e.target.checked ? [...f.cities, c.id] : f.cities.filter((x) => x !== c.id) }))} /> {c.name}</label>
                        ))}
                      </div>
                      <div style={{ marginTop: 4 }}>도독 <select value={corpsForm.leader} onChange={(e) => setCorpsForm((f) => ({ ...f, leader: e.target.value }))}><option value="">(고르세요)</option>{gens.map((g) => <option key={g.id} value={g.id}>{g.name} (통{g.lead})</option>)}</select></div>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
                        <button className="sm" onClick={() => setCorpsForm(null)}>취소</button>
                        <button className="sm primary" disabled={!corpsForm.cities.length || !corpsForm.leader} onClick={() => { act((s) => { s.corpsN = (s.corpsN || 0) + 1; s.corps = [...(s.corps || []), { id: `k${s.corpsN}`, leader: corpsForm.leader, cities: corpsForm.cities }]; for (const id of corpsForm.cities) s.castles[id].auto = true; return { ok: true, msg: '군단을 만들었습니다. 다음 진행부터 도독이 알아서 싸웁니다.' }; }); setCorpsForm(null); }}>만들기</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
                <thead><tr><th align="left">도시</th><th>병력</th><th>장수</th><th>농·상</th></tr></thead>
                <tbody>
                  {game.castles.filter((c) => c.owner === pid).map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => { goTo(c); setSheet(false); }}>
                      <td>{c.kind === 'pass' ? '⛩️' : c.capital ? '♛' : ''}{c.port ? '⚓' : ''}{c.name}{(game.corps || []).some((co) => co.cities.includes(c.id)) ? ' 🎖️' : ''}</td>
                      <td align="center">{fmtTroops(c.troops)}</td>
                      <td align="center">{Object.values(game.generals).filter((g) => g.castle === c.id && g.status === 'active').length}</td>
                      <td align="center">{c.kind === 'pass' ? '-' : `${c.farm}·${c.trade}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'diplo' && (
            <div className="card" style={{ fontSize: 13 }}>
              {game.nations.filter((n) => n.alive && n.id !== pid).sort((a, b) => powerOf(game, b.id) - powerOf(game, a.id)).map((n) => {
                const p = pactOf(game, pid, n.id), r = Math.round(relOf(game, pid, n.id));
                return (
                  <div key={n.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <b><span className="chip" style={{ background: n.color }} /> {n.name}</b>
                      <small className="muted">{game.castles.filter((c) => c.owner === n.id && c.kind !== 'pass').length}도시 · {fmtTroops(powerOf(game, n.id))}</small>
                    </div>
                    <div style={{ height: 5, background: '#0006', borderRadius: 3, margin: '4px 0' }}><div style={{ width: `${r}%`, height: '100%', background: r >= 60 ? '#6fd37f' : r >= 30 ? '#e8c35a' : '#e2655a', borderRadius: 3 }} /></div>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <small>우호 {r}{p ? ` · ${PACT[p.type]} (${p.until - game.turn}턴 남음)` : ''}{STRATS[n.strat] ? <span title={STRATS[n.strat].desc}> · 전략 {STRATS[n.strat].name}{n.focus !== null && n.focus !== undefined && game.nations[n.focus] ? `(${n.focus === pid ? '우리' : game.nations[n.focus].name} 노림)` : ''}</span> : null}</small>
                      <span style={{ marginLeft: 'auto' }} />
                      <button className="sm" disabled={playing || me.gold < 10000} onClick={() => act((s) => gift(s, pid, n.id, 10000))}>🎁 친선 1만</button>
                      {!p && <button className="sm" disabled={playing || me.lastAsk?.[n.id] === game.turn} onClick={() => act((s) => propose(s, pid, n.id, 'ally'))}>동맹 {Math.round(acceptChance(game, pid, n.id, 'ally') * 100)}%</button>}
                      {!p && <button className="sm" disabled={playing || me.lastAsk?.[n.id] === game.turn} onClick={() => act((s) => propose(s, pid, n.id, 'truce'))}>정전 {Math.round(acceptChance(game, pid, n.id, 'truce') * 100)}%</button>}
                    </div>
                  </div>
                );
              })}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>동맹(1년)·정전(반년) 중에는 서로 칠 수 없습니다. 친선으로 우호를 올리면 잘 받아 줍니다. 도시를 빼앗으면 우호가 크게 떨어집니다.</div>
            </div>
          )}
          {tab === 'people' && (
            <div className="card" style={{ fontSize: 13 }}>
              <b>⛓️ 포로</b>
              {!myPrisoners.length && <div className="muted">없음</div>}
              {myPrisoners.map((g) => (
                <div key={g.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <div><Face g={g} /> {g.name} <small className="muted">({game.nations[g.nation]?.name || '재야'}) 무{g.war} 통{g.lead} 지{g.intel} 정{g.pol}</small></div>
                  <div className="row" style={{ gap: 4 }}>
                    {isRuler(g) ? <small className="muted">군주라 등용 불가</small> : <button className="sm" disabled={playing || g.tried === game.turn} onClick={() => act((s) => recruit(s, g.id, pid))}>등용 {Math.round(recruitChance(game, g, pid) * 100)}%</button>}
                    <button className="sm" disabled={playing} onClick={() => act((s) => release(s, g.id))}>석방 (우호+)</button>
                    <button className="sm danger" disabled={playing} onClick={() => act((s) => execute(s, g.id))}>처단</button>
                  </div>
                </div>
              ))}
              <b style={{ display: 'block', marginTop: 10 }}>🧑‍🎓 내 도시의 재야</b>
              {game.castles.filter((c) => c.owner === pid).flatMap((c) => freeIn(c).map((g) => [c, g])).map(([c, g]) => (
                <div key={g.id} className="row clickable" style={{ justifyContent: 'space-between', padding: '3px 0' }} onClick={() => goTo(c)}>
                  <span>{g.name} <small className="muted">{c.name} · 무{g.war} 통{g.lead} 지{g.intel} 정{g.pol}</small></span>
                  <span>›</span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>재야는 그 도시를 눌러 등용합니다(그 도시 장수 정치가 높을수록 잘 됨). 다른 나라 도시의 재야는 그 도시를 빼앗아야 데려올 수 있습니다.</div>
            </div>
          )}
          {tab === 'help' && (
            <div className="card muted" style={{ fontSize: 13 }}>
              내 도시를 눌러 <b>출진</b>하고, 깃발(부대)을 고른 뒤 지도를 눌러 명령하세요. <b>하루 진행</b>을 누를 때마다 모든 부대가 하루씩 함께 움직이니 매일 명령을 바꿀 수 있습니다. 수입·수확 정산은 10일(1순)마다, 「⏩ 순 끝까지」는 한 번에 넘김.
              <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
                <li>부대가 지나간 칸은 내 땅. 도시는 관할(점선 안) 땅을 매 턴 조금씩 넓히고, 내 땅 비율만큼 금·병량이 들어옵니다.</li>
                <li>금은 상업에서 매 턴, 병량은 농업에서 가을(8월)에 한 해 몫이 들어옵니다. 병사는 병량을 먹고, 병량이 떨어지면 흩어집니다.</li>
                <li>적 부대 옆 칸에 들어서면 그날은 더 못 갑니다(통제 구역). 여러 방향에서 치면 <b>협공</b>(+30%씩).</li>
                <li>무력·통솔·지력 70 이상 장수는 <b>돌격·일제사격·화계</b> 전법을 씁니다.</li>
                <li>깃발 아래 초록 막대는 병력, 파란 막대는 사기. 병력 300 이하나 사기 5 이하면 부대가 무너지고 장수는 가까운 성으로 도망칩니다.</li>
                <li>사기는 싸우지 않고 내 땅에서 쉬면 하루 +3, 내 <b>진지</b> 안이면 +6 회복 — 성에 돌아갈 필요 없음.</li>
                <li>내 도시·땅과 끊기면 보급이 끊겨 병력·사기가 줄어듭니다(주황 테두리).</li>
                <li>장수 둘 이상이 한 부대로 나가면 능력은 가장 높은 장수 기준, 부장 하나마다 공·방 +12%(둘까지).</li>
                <li>포로 석방: 그 나라가 살아 있으면 돌아가고(우호 +), 없으면 재야로. 등용 확률은 다시 잡아도 오르지 않습니다.</li>
                <li>성벽이 남아 있으면 수비병이 잘 안 죽습니다. 수비병이 0이면 함락, 관할 땅이 통째로 넘어옵니다.</li>
                <li>⛩️ 관문은 수입이 없지만 성벽이 두꺼운 길목입니다.</li>
                <li>⚓ 항구에서 나간 부대는 배로 바닷길(뭍에서 3칸 안 바다)을 갑니다. 물 위에선 수군 장수가 없으면 약합니다.</li>
                <li>이름난 장수는 고유 전법(★)을 씁니다: 관우 「청룡언월」, 장비 「장판교 일갈」(주변 적 발 묶음), 제갈량 「팔진」(받는 피해 절반) …</li>
                <li>무력 75 이상 대장끼리 붙으면 가끔 <b>일기토</b>. 지면 사기가 크게 꺾이고 사로잡히기도 합니다.</li>
                <li>날씨: ❄️ 겨울 눈은 북쪽 이동이 느림, 🌧️ 비는 강 건너기가 힘들고 불이 약함, 🌬️ 바람은 화계가 강함.</li>
                <li>🕊️ 처음 석 달(9순, 도시 3개 이하 작은 나라면 1년)은 컴퓨터가 내 도시를 먼저 치지 않습니다. 그동안 친선·정전·동맹으로 외교를 다지세요.</li>
                <li>💰 금 지출: 장수 녹봉 1명당 200/순, 시설 유지비 단계당 300/순, 출진 비용 병사 2명당 1금, 징병 1명당 10금(병영 8금).</li>
                <li>🎁 장수마다 충성이 있습니다. 금이 바닥나면 떨어지고, 35 아래면 가끔 다른 나라로 떠납니다. 세력 탭 「전체 포상」 한 번으로 챙기세요.</li>
                <li>🕵️ 적 도시를 누르면 계략: 유언비어(수비병↓·자원병 멈춤), 이간(장수 충성↓), 매수(충성 낮은 장수 빼 오기). 지력 높은 장수가 있으면 잘 됩니다.</li>
                <li>🕯️ 장수는 해마다 나이를 먹고 60세 무렵부터 세상을 떠날 수 있습니다.</li>
                <li>👑 군주가 사로잡히거나 죽으면 통솔+정치가 가장 높은 장수가 잇고 사기가 꺾입니다. 이을 사람이 없으면 나라가 무너집니다.</li>
                <li>🏗️ 도시 시설은 성벽 증축·조선소(항구)뿐. 수입·수확은 담당관·땅·정책으로 늘립니다.</li>
                <li>⛺🗼🚧 부대를 고르면 그 자리에 진지(아군 피해 −30%·보급 거점·사기 +6/일)·망루(2칸 안 적 부대 매일 공격)·목책(바로 세움, 1500금, 적 길막이+옆에 오면 멈춤)을 지을 수 있습니다. 적 시설은 부대로 눌러 부숩니다.</li>
                <li>🪨 공성병기(출진 때 체크하거나 들판에서 부대로 만들기, 금 5천)는 성벽을 5배로 깎지만 느려지고 들판 싸움에 약하며(공격 −20%·받는 피해 +35%) 함락하면 부서집니다. 장수 여럿 부대는 「✂️ 나누기」로 언제든 갈라 협공할 수 있습니다.</li>
                <li>👥 도시 패널 「장수 부르기」로 다른 성 장수를 병력과 함께 행군시켜 데려옵니다(빈 담당에 맞는 장수가 위).</li>
                <li>🗡️ 넓은 변방 도시는 수비가 얇으면 도적이 땅을 휩쓸고, 조선소 없는 항구는 해적에게 털립니다.</li>
                <li>🔥 도시 15개 넘게 커진 나라는 도읍에서 먼, 수비 얇은 변방 도시가 가끔 반란으로 떨어져 나가거나 이웃에 귀순합니다(수비 2만 넘으면 안전).</li>
                <li>🧠 컴퓨터 나라는 확장·속공·내실·편승·반패권·수성·사방 방어 중 형편에 맞는 전략을 고릅니다(외교 탭에서 확인).</li>
                <li>🏪🌾 시장·농장은 그 도시 금·수확 +25%씩(유지비 없음). 관할 땅은 칸 수가 아니라 <b>채운 비율</b>로 수입이 정해집니다.</li>
                <li>📜 정책: 세력 탭에서 둔전·상업 장려·징병령·축성 장려·인재 등용·군비 확장·수군 육성 중 칸만큼 펼칩니다(도시 8곳마다 1칸).</li>
                <li>🏗️ 세력 탭의 「새 도시 세우기」로 내 땅 빈 곳(다른 성과 4칸 이상, 초록 칸)에 도시를 세웁니다. 완공되면 주변 땅이 그 도시 관할이 됩니다.</li>
                <li>🎖️ 군단: 도시 몇 곳과 도독을 정해 맡기면 컴퓨터가 그 도시들로 알아서 싸웁니다.</li>
                <li>삼국지 시나리오는 손책의 죽음, 관도대전, 삼고초려, 적벽대전 같은 역사 사건이 때가 되면 일어납니다.</li>
              </ul>
            </div>
          )}
          {tab === 'log' && (
            <div className="card h14-log" style={{ maxHeight: 'none' }}>
              {game.log.slice(0, 80).map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: l.nations?.includes(pid) ? undefined : 'var(--muted)' }}>[{l.turn}턴{l.day ? ` ${l.day}일` : ''}] {l.text}</div>
              ))}
            </div>
          )}
        </>
      )}
      {(selCastle || selUnit || selFort) && (
        <div className="card h14-log">
          <b>📜 기록</b>
          {game.log.slice(0, 30).map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: l.nations?.includes(pid) ? undefined : 'var(--muted)' }}>[{l.turn}턴{l.day ? ` ${l.day}일` : ''}] {l.text}</div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="h14">
      <div className="topbar">
        <b><span className="chip" style={{ background: me.color }} /> {me.name}</b>
        <span>{dateOf(game, startYear)} {game.day + 1}일</span>
        <span title="눈: 북쪽 이동 느림 · 비: 강 건너기 힘듦, 불 약함 · 바람: 불 강함">{weatherText(game)}</span>
        <span>💰 {fmtGold(me.gold)} <small className="muted" style={{ color: inc < 0 ? 'var(--danger)' : undefined }}>({inc >= 0 ? '+' : ''}{fmtGold(inc)}/순)</small></span>
        <span style={{ color: food < use * 6 ? 'var(--danger)' : undefined }}>🍚 {fmtTroops(food)}</span>
        <span>🏯 {myCities}/{cities.length}도시</span>
        <span>⚑ 부대 {myUnits.length}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="sm" onClick={() => setSpeed((v) => (v > 250 ? 170 : 420))}>{speed > 250 ? '▶ 보통' : '⏩ 빠르게'}</button>
        <button className="sm" onClick={onExit}>🚪 나가기</button>
      </div>
      <div className="h14-body">
        <div className="h14-map" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
          <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
          <div className="map-ctrl">
            <button onClick={() => { const r = wrap.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.4); }}>＋</button>
            <button onClick={() => { const r = wrap.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.4); }}>－</button>
            <button className="h14-menu" title="세력·외교·인재" onClick={() => { setSel(null); setSheet(true); }}>📋</button>
          </div>
          {founding && <div className="map-hint">🏗️ 초록 칸 중 새 도시 자리를 누르세요 ({spots?.length || 0}곳) <button className="sm" onClick={() => setFounding(false)}>취소</button></div>}
          {selUnit && selUnit.nation === pid && !playing && <div className="map-hint">⚑ {gensOf(game, selUnit.gens)[0]?.name} 부대 {fmtTroops(selUnit.troops)} — 지도를 눌러 명령 <button className="sm h14-menu" onClick={() => setSheet(true)}>ℹ️</button> <button className="hint-clear" onClick={() => setSel(null)}>✕ 선택 해제</button></div>}
          
          <div className="end-turn-box">
            <button className="sm" disabled={playing || !!game.over} onClick={() => runTurn(true)} title="이번 순(10일)이 끝날 때까지 한 번에">⏩ 순 끝까지 ({DAYS - game.day}일)</button>
            <button className="primary end-turn" disabled={playing || !!game.over} onClick={() => runTurn(false)}>
              {playing ? '⏳ 진행 중' : `하루 진행 ▶ (${game.day + 1}/${DAYS}일)`}
            </button>
          </div>
          {toastMsg && <div className="toast">{toastMsg}</div>}
          {duel && <DuelView d={duel} game={game} />}
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
          {report && !playing && (
            <div className="h14-report">
              <div className="row" style={{ justifyContent: 'space-between' }}><b>📰 이번 순 소식</b><button className="sm" onClick={() => setReport(null)}>✕</button></div>
              {report.map((t, i) => <div key={i} style={{ color: /잃|무너|사로|⚠️|병량/.test(t) ? '#ffb4a8' : undefined }}>{t}</div>)}
            </div>
          )}
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
                  <div>{PACT[p.type]}을 맺자고 합니다 ({p.type === 'ally' ? '1년' : '반년'}).</div>
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
          {game.over && (
            <div className="h14-over">
              {game.over.winner === pid ? '🏆 천하통일!' : game.over.lost ? '💀 멸망' : `${game.nations[game.over.winner]?.name} 천하통일`}
              <div><button onClick={onExit}>메인 화면으로</button></div>
            </div>
          )}
        </div>
        <div className={'h14-panel' + (sheet ? ' open' : '')}>
          <button className="sm h14-close" title="닫고 선택 해제" onClick={() => { setSheet(false); setSel(null); setSortieOpen(false); }}>✕</button>
          {panel}
        </div>
      </div>
    </div>
  );
}
