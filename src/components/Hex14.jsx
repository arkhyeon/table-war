import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, stepDay, endTurn14, sortie, order, commandCap, gensOf, unitStats, nearestCastle, draft14, draftMax14, DAYS, dateOf, TERRAIN_NAME, castleIncome, landShare } from '../game/hex14.js';
import { aiTurn14 } from '../game/hex14ai.js';
import { TERRAIN } from '../game/rules.js';
import { corner, pixelToCell } from '../game/hex.js';
import { getScenario } from '../game/scenarios.js';
import { fmtTroops, fmtGold } from '../game/format.js';
import Slider from './Slider.jsx';

// ───────── 삼국지14식 화면: 육각 칸 지도 + 도시·관문 + 부대 깃발 + 10일 진행 ─────────
const NEUTRAL = '#b9b2a0';
const clone = (s) => structuredClone(s);
const ownerColor = (s, o) => (o !== null && o >= 0 && s.nations[o] ? s.nations[o].color : NEUTRAL);

// 땅(지형·주인·경계)은 따로 그려 두고, 땅 주인이 바뀔 때만 다시 그림
function paintLand(grid, s) {
  const sc = Math.min(3, 4096 / Math.max(grid.W, grid.H));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(grid.W * sc);
  cv.height = Math.ceil(grid.H * sc);
  const ctx = cv.getContext('2d');
  ctx.scale(sc, sc);
  const sz = grid.size;
  const hexPath = (i, k = 1) => {
    const [cx, cy] = grid.center(i);
    ctx.beginPath();
    for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * k, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  };
  for (let i = 0; i < grid.N; i++) {
    const t = grid.terrain[i];
    if (t === 0) continue;
    hexPath(i, 1.04);
    ctx.fillStyle = TERRAIN[t]?.color || '#d6dfa6';
    ctx.fill();
    if (!grid.passable(i)) { ctx.fillStyle = 'rgba(70,55,40,0.55)'; ctx.fill(); continue; }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ownerColor(s, s.owner[i]);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = sz * 0.06;
    hexPath(i, 0.97);
    ctx.stroke();
    const [cx, cy] = grid.center(i);
    if (grid.river[i]) { ctx.fillStyle = 'rgba(40,110,180,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, sz * 0.32, 0, 7); ctx.fill(); }
    if (t === 6 || t === 3) { ctx.fillStyle = 'rgba(60,40,20,0.32)'; ctx.beginPath(); ctx.moveTo(cx - sz * 0.5, cy + sz * 0.35); ctx.lineTo(cx, cy - sz * 0.45); ctx.lineTo(cx + sz * 0.5, cy + sz * 0.35); ctx.fill(); }
    if (t === 2) { ctx.fillStyle = 'rgba(20,70,20,0.3)'; ctx.beginPath(); ctx.arc(cx - sz * 0.22, cy, sz * 0.22, 0, 7); ctx.arc(cx + sz * 0.22, cy + sz * 0.1, sz * 0.2, 0, 7); ctx.fill(); }
  }
  // 관할 경계(얇게)와 나라 경계(굵게)
  const edge = (i, j) => {
    const [cx, cy] = grid.center(i), [jx, jy] = grid.center(j);
    const mx = (cx + jx) / 2, my = (cy + jy) / 2, dx = jy - cy, dy = cx - jx, L = Math.hypot(dx, dy) || 1, h = sz * 0.58;
    ctx.moveTo(mx - (dx / L) * h, my - (dy / L) * h);
    ctx.lineTo(mx + (dx / L) * h, my + (dy / L) * h);
  };
  ctx.beginPath();
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) for (const j of grid.nb[i]) if (j > i && grid.passable(j) && s.owner[j] === s.owner[i] && s.district[j] !== s.district[i]) edge(i, j);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = sz * 0.1;
  ctx.setLineDash([sz * 0.3, sz * 0.25]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < grid.N; i++) if (grid.passable(i)) for (const j of grid.nb[i]) if (j > i && grid.passable(j) && s.owner[j] !== s.owner[i]) edge(i, j);
  ctx.strokeStyle = 'rgba(15,12,10,0.8)';
  ctx.lineWidth = sz * 0.2;
  ctx.stroke();
  return { cv, sc };
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
  const [speed, setSpeed] = useState(420);
  const [toastMsg, setToast] = useState(null);
  const [sheet, setSheet] = useState(false);
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

  const toast = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };
  const unitById = (id) => game.units.find((u) => u.id === id);
  const selUnit = sel?.type === 'unit' ? unitById(sel.id) : null;
  const selCastle = sel?.type === 'castle' ? game.castles[sel.id] : null;

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
    if (land.current.ref !== s.owner) {
      const key = s.owner.join(',');
      if (land.current.key !== key) land.current = { key, img: paintLand(grid, s) };
      land.current.ref = s.owner;
    }
    const { k, x: vx, y: vy } = view.current;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#7fa9bf';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, -vx * k * dpr, -vy * k * dpr);
    ctx.imageSmoothingEnabled = true;
    const L = land.current.img;
    ctx.drawImage(L.cv, 0, 0, L.cv.width / L.sc, L.cv.height / L.sc);
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
    const fs = Math.max(sz * 0.9, 11 * px);
    for (const c of s.castles) {
      const [cx, cy] = grid.center(c.tile);
      if (!vis(cx, cy)) continue;
      const col = ownerColor(s, c.owner);
      const on = sl?.type === 'castle' && sl.id === c.id;
      if (c.kind === 'pass') {
        // 관문: 성문 모양
        const w = sz * 1.5, h = sz * 1.1;
        ctx.fillStyle = '#2a2420';
        ctx.fillRect(cx - w / 2 - sz * 0.12, cy - h / 2 - sz * 0.12, w + sz * 0.24, h + sz * 0.24);
        ctx.fillStyle = col;
        ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
        ctx.fillStyle = '#2a2420';
        ctx.beginPath(); ctx.arc(cx, cy + h / 2, sz * 0.38, Math.PI, 0); ctx.fill();
      } else {
        // 도시: 성벽(톱니) + 안쪽 색
        const r = sz * (c.capital ? 1.6 : 1.25);
        ctx.fillStyle = '#2a2420';
        ctx.fillRect(cx - r - sz * 0.15, cy - r - sz * 0.15, (r + sz * 0.15) * 2, (r + sz * 0.15) * 2);
        const n = 4, step = (r * 2) / (n * 2 - 1);
        for (let q = 0; q < n; q++) ctx.fillRect(cx - r + q * step * 2, cy - r - sz * 0.5, step, sz * 0.4);
        ctx.fillStyle = col;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(cx - r * 0.55, cy - r * 0.55, r * 1.1, r * 1.1);
        // 성벽 내구 막대
        ctx.fillStyle = '#300';
        ctx.fillRect(cx - r, cy + r + sz * 0.2, r * 2, sz * 0.25);
        ctx.fillStyle = '#e8c35a';
        ctx.fillRect(cx - r, cy + r + sz * 0.2, r * 2 * Math.max(0, c.dur / c.maxDur), sz * 0.25);
      }
      if (on) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = Math.max(sz * 0.3, 2 * px); ctx.strokeRect(cx - sz * 2, cy - sz * 2, sz * 4, sz * 4); }
      // 이름판
      if (k * sz > 2.2 || c.capital) {
        const label = `${c.capital ? '♛' : ''}${c.name}`;
        ctx.font = `bold ${fs}px sans-serif`;
        const tw = ctx.measureText(label).width + fs * 0.6;
        const ly = cy + sz * 2.5;
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
    // 부대 깃발
    for (const u of s.units) {
      const [cx, cy] = posOf(u);
      if (!vis(cx, cy)) continue;
      const n = s.nations[u.nation];
      const on = sl?.type === 'unit' && sl.id === u.id;
      const g = gensOf(s, u.gens)[0];
      const fw = sz * 1.9, fh = sz * 1.5, top = cy - sz * 2.2;
      // 그림자 받침
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx, cy + sz * 0.5, sz * 0.9, sz * 0.4, 0, 0, 7); ctx.fill();
      // 깃대
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(cx - fw / 2 - sz * 0.12, top, sz * 0.16, sz * 2.7);
      // 깃발 (펄럭임)
      const wave = Math.sin(now / 260 + u.id) * sz * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx - fw / 2, top);
      ctx.lineTo(cx + fw / 2, top + wave);
      ctx.lineTo(cx + fw / 2, top + fh + wave);
      ctx.lineTo(cx - fw / 2, top + fh);
      ctx.closePath();
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.lineWidth = Math.max(sz * (on ? 0.3 : 0.14), (on ? 2.5 : 1) * px);
      ctx.strokeStyle = on ? '#ffe066' : u.cut ? '#ff7a3c' : '#fff';
      ctx.stroke();
      ctx.font = `bold ${sz * 1.15}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = sz * 0.2;
      const ch1 = g?.name?.[0] || '?';
      ctx.strokeText(ch1, cx, top + fh * 0.78 + wave / 2);
      ctx.fillText(ch1, cx, top + fh * 0.78 + wave / 2);
      // 병력·사기 막대
      const bw = sz * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw, sz * 0.5);
      ctx.fillStyle = '#6fd37f';
      ctx.fillRect(cx - bw / 2, cy + sz * 0.75, bw * Math.min(1, u.troops / u.max), sz * 0.25);
      ctx.fillStyle = '#5fb0ff';
      ctx.fillRect(cx - bw / 2, cy + sz * 1.0, bw * Math.min(1, u.morale / 100), sz * 0.25);
      if (k * sz > 4.5) {
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
    const busy = f < 1 || fx.current.length || (s.fx || []).some((e) => e.type === 'clash') || s.units.length;
    cancelAnimationFrame(raf.current);
    if (busy) raf.current = requestAnimationFrame(draw);
  };
  useEffect(() => { draw(); });
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
      if (e.type === 'tactic') fx.current.push({ x, y: y - grid.size * 4, text: e.text, color: e.text === '협공!' ? '#ff9f43' : '#ffe066', size: 1.3, min: 15, t0: now, life: 1600, rise: 1.5, pop: true });
      if (e.type === 'capture') fx.current.push({ x, y: y - grid.size * 3, text: `🏯 ${e.text}!`, color: '#fff', size: 1.8, min: 18, t0: now, life: 2200, rise: 1, pop: true });
    }
  };

  // ── 화면 이동·확대·누르기 ──
  const toWorld = (px, py) => {
    const r = wrap.current.getBoundingClientRect(), v = view.current;
    return [v.x + (px - r.left) / v.k, v.y + (py - r.top) / v.k];
  };
  const onDown = (e) => {
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
    const r2 = (grid.size * 1.6) ** 2;
    let best = null, bd = r2;
    for (const u of game.units) { const [x, y] = grid.center(u.tile); const d = (x - wx) ** 2 + (y + grid.size * 0.8 - wy) ** 2; if (d < bd) { bd = d; best = { type: 'unit', o: u }; } }
    if (best) return best;
    bd = (grid.size * 2) ** 2;
    for (const c of game.castles) { const [x, y] = grid.center(c.tile); const d = (x - wx) ** 2 + (y - wy) ** 2; if (d < bd) { bd = d; best = { type: 'castle', o: c }; } }
    return best;
  };

  const tap = (px, py) => {
    if (playing) return;
    const [wx, wy] = toWorld(px, py);
    const t = pixelToCell(grid.size, grid.cols, grid.rows, wx, wy);
    const hit = pick(wx, wy);
    const u = hit?.type === 'unit' ? hit.o : null;
    const c = hit?.type === 'castle' ? hit.o : null;
    // 내 부대를 고른 상태: 누른 곳으로 명령
    if (selUnit && selUnit.nation === pid && !(u && u.nation === pid)) {
      const kind = u ? 'unit' : c ? 'castle' : 'tile';
      if (kind === 'tile' && (t < 0 || !grid.passable(t))) return toast('갈 수 없는 곳입니다.');
      const id = u ? u.id : c ? c.id : t;
      act((s) => {
        const su = s.units.find((x) => x.id === selUnit.id);
        const r = order(s, grid, su, kind, id);
        if (r.ok) r.msg = kind === 'unit' ? `${gensOf(s, su.gens)[0].name} → 적 부대 공격` : kind === 'castle' ? (c.owner === pid ? `${c.name}에 입성` : `${c.name} 공략`) : '이동';
        return r;
      });
      return;
    }
    if (u) { setSel({ type: 'unit', id: u.id }); setSortieOpen(false); setSheet(true); return; }
    if (c) { setSel({ type: 'castle', id: c.id }); setSortieOpen(false); setSheet(true); return; }
    setSel(null);
    setSheet(false);
  };

  // ── 턴 진행: 컴퓨터 명령 → 10일 재생 → 마무리 ──
  const runTurn = () => {
    if (playing || game.over) return;
    const s = clone(game);
    for (const n of s.nations) if (n.alive && n.id !== pid) aiTurn14(s, grid, n.id);
    if (game.spectator && s.nations[pid].alive) aiTurn14(s, grid, pid);
    setPlaying(true);
    setSheet(false);
    let d = 0;
    const tick = () => {
      anim.current = { prev: new Map(s.units.map((u) => [u.id, u.tile])), t0: performance.now(), dur: speed * 0.9 };
      stepDay(s, grid);
      d += 1;
      spawnFx(s);
      const snap = clone(s);
      if (d >= DAYS || s.over) {
        setTimeout(() => {
          snap.fx = [];
          endTurn14(snap, grid);
          setGame(snap);
          setPlaying(false);
          setSel((v) => (v?.type === 'unit' && !snap.units.some((u) => u.id === v.id) ? null : v));
        }, speed);
        setGame(snap);
        return;
      }
      setGame(snap);
      setTimeout(tick, speed);
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
    setAmt(Math.max(0, Math.min(commandCap(game, ids), selCastle.troops - 500)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortieOpen, sel?.id]);
  const cap = commandCap(game, pickG);
  const maxAmt = selCastle ? Math.max(0, Math.min(cap, selCastle.troops - 500)) : 0;

  const cities = game.castles.filter((c) => c.kind !== 'pass');
  const myCities = cities.filter((c) => c.owner === pid).length;
  const myUnits = game.units.filter((u) => u.nation === pid);
  const inc = useMemo(
    () =>
      game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + castleIncome(game, grid, c), 0) -
      [...game.castles.filter((c) => c.owner === pid), ...game.units.filter((u) => u.nation === pid)].reduce((a, x) => a + x.troops * 0.5, 0),
    [game, grid, pid],
  );
  const tacticName = (g) => {
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
            {selCastle.kind !== 'pass' && selCastle.owner !== null && <><span>관할 땅</span><span>{Math.round(landShare(game, selCastle) * 100)}% · 수입 {fmtGold(castleIncome(game, grid, selCastle))}</span></>}
            {selCastle.kind === 'pass' && <><span>관문</span><span>수입은 없지만 성벽이 두꺼워 길목을 막음</span></>}
            <span>장수</span><span>{castleGens.map((g) => g.name).join(', ') || '없음'}</span>
          </div>
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
                      }} /> {g.name} <small className="muted">무{g.war} 통{g.lead} 지{g.intel}{tacticName(g) ? ` · 「${tacticName(g)}」` : ''}{(g.traits || []).some(([t]) => t === '기마') ? ' · 기마' : ''}</small>
                    </label>
                  ))}
                  <div style={{ fontSize: 13, marginTop: 4 }}>병력 {fmtTroops(amt)} / 지휘 한도 {fmtTroops(cap)}</div>
                  <Slider min={0} max={maxAmt} step={100} value={Math.min(amt, maxAmt)} onChange={setAmt} style={{ width: '100%' }} />
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                    <button onClick={() => setSortieOpen(false)}>취소</button>
                    <button className="primary" disabled={!pickG.length || amt < 1000} onClick={() => {
                      const r = act((s) => sortie(s, grid, selCastle.id, pickG, amt));
                      if (r?.ok) { setSortieOpen(false); setSel({ type: 'unit', id: r.unit.id }); setSheet(false); toast('부대가 나왔습니다. 지도에서 목적지·공격할 곳을 누르세요.'); }
                    }}>출진</button>
                  </div>
                </div>
              )}
              {selCastle.kind !== 'pass' && (
                <div style={{ fontSize: 13 }}>
                  징병 {fmtTroops(Math.min(draftAmt, draftMax14(game, selCastle)))} (1명당 5금)
                  <Slider min={0} max={draftMax14(game, selCastle)} step={100} value={Math.min(draftAmt, draftMax14(game, selCastle))} onChange={setDraftAmt} style={{ width: '100%' }} />
                  <button disabled={draftAmt < 100} onClick={() => act((s) => draft14(s, selCastle.id, draftAmt))}>💂 징병</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {selUnit && (() => {
        const gs = gensOf(game, selUnit.gens), st = unitStats(game, selUnit);
        const tgt = selUnit.order ? (selUnit.order.kind === 'castle' ? game.castles[selUnit.order.id]?.name : selUnit.order.kind === 'unit' ? `${gensOf(game, unitById(selUnit.order.id)?.gens || [])[0]?.name || '?'} 부대` : '지정한 곳') : '없음';
        const days = selUnit.path.length ? Math.ceil(selUnit.path.length / 0.6) : 0;
        return (
          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>⚑ {gs.map((g) => g.name).join('·')} 부대 <small className="muted">{game.nations[selUnit.nation].name}</small></h3>
            <div className="kv">
              <span>병력</span><span>{fmtTroops(selUnit.troops)} / {fmtTroops(selUnit.max)}</span>
              <span>사기</span><span>{Math.round(selUnit.morale)}</span>
              <span>공·방</span><span>{Math.round(st.atk)} · {Math.round(st.def)}</span>
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
              </>
            )}
          </div>
        );
      })()}
      {!selCastle && !selUnit && (
        <div className="card muted" style={{ fontSize: 13 }}>
          내 도시를 눌러 <b>출진</b>하고, 깃발(부대)을 고른 뒤 지도를 눌러 명령하세요. <b>진행</b>을 누르면 10일 동안 모든 부대가 함께 움직입니다.
          <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
            <li>부대가 지나간 칸은 내 땅. 도시 관할(점선 안) 땅이 많을수록 수입이 늘어납니다.</li>
            <li>적 부대 옆 칸에 들어서면 그날은 더 못 갑니다(통제 구역).</li>
            <li>여러 방향에서 한 부대를 치면 <b>협공</b>(+30%씩).</li>
            <li>무력·통솔·지력 70 이상 장수는 싸울 때 <b>돌격·일제사격·화계</b> 전법을 씁니다.</li>
            <li>내 도시·땅과 끊기면 보급이 끊겨 병력·사기가 줄어듭니다(주황 테두리).</li>
            <li>성벽이 남아 있으면 수비병이 잘 안 죽습니다. 수비병이 0이 되면 함락, 관할 땅이 통째로 넘어옵니다.</li>
            <li>⛩️ 관문은 수입이 없지만 성벽이 두꺼운 길목입니다.</li>
          </ul>
        </div>
      )}
      <div className="card h14-log">
        <b>📜 기록</b>
        {game.log.slice(0, 40).map((l, i) => (
          <div key={i} style={{ fontSize: 12, color: l.nations?.includes(pid) ? undefined : 'var(--muted)' }}>[{l.turn}턴{l.day ? ` ${l.day}일` : ''}] {l.text}</div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="h14">
      <div className="topbar">
        <b><span className="chip" style={{ background: me.color }} /> {me.name}</b>
        <span>{dateOf(game, startYear)}{playing ? ` · ${game.day}일째` : ''}</span>
        <span>💰 {fmtGold(me.gold)} <small className="muted" style={{ color: inc < 0 ? 'var(--danger)' : undefined }}>({inc >= 0 ? '+' : ''}{fmtGold(inc)}/턴)</small></span>
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
          </div>
          {selUnit && selUnit.nation === pid && !playing && <div className="map-hint">⚑ {gensOf(game, selUnit.gens)[0]?.name} 부대 — 지도를 눌러 명령 <button className="sm" onClick={() => setSel(null)}>해제</button></div>}
          {playing && <div className="h14-day">{dateOf(game, startYear)} · {game.day}일</div>}
          <button className="primary end-turn" disabled={playing || !!game.over} onClick={runTurn}>
            {playing ? `⏳ ${game.day}/${DAYS}일` : '진행 ▶ (10일)'}
          </button>
          {toastMsg && <div className="toast">{toastMsg}</div>}
          {game.over && (
            <div className="h14-over">
              {game.over.winner === pid ? '🏆 천하통일!' : game.over.lost ? '💀 멸망' : `${game.nations[game.over.winner]?.name} 천하통일`}
              <div><button onClick={onExit}>메인 화면으로</button></div>
            </div>
          )}
        </div>
        <div className={'h14-panel' + (sheet ? ' open' : '')}>
          <button className="sm h14-close" onClick={() => setSheet(false)}>✕</button>
          {panel}
        </div>
      </div>
    </div>
  );
}
