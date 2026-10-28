import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, stepDay, endTurn14, sortie, order, commandCap, gensOf, unitStats, nearestCastle, draft14, draftMax14, DAYS, dateOf, TERRAIN_NAME, castleIncome } from '../game/hex14.js';
import { aiTurn14 } from '../game/hex14ai.js';
import { TERRAIN } from '../game/rules.js';
import { corner, pixelToCell } from '../game/hex.js';
import { getScenario } from '../game/scenarios.js';
import { fmtTroops, fmtGold } from '../game/format.js';
import Slider from './Slider.jsx';

// ───────── 삼국지14식 화면: 육각 칸 지도 + 성·부대 + 10일 진행 ─────────
const NEUTRAL = '#b9b2a0';
const clone = (s) => structuredClone(s);

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
  const [speed, setSpeed] = useState(380);
  const [toastMsg, setToast] = useState(null);
  const [sheet, setSheet] = useState(false);
  const canvas = useRef(null);
  const wrap = useRef(null);
  const view = useRef(null); // {x, y, k}
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const gameRef = useRef(game);
  gameRef.current = game;

  const toast = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };
  const unitById = (id) => game.units.find((u) => u.id === id);
  const selUnit = sel?.type === 'unit' ? unitById(sel.id) : null;
  const selCastle = sel?.type === 'castle' ? game.castles[sel.id] : null;

  // ── 그리기 ──
  const draw = () => {
    const cv = canvas.current, el = wrap.current, s = gameRef.current;
    if (!cv || !el) return;
    const cw = el.clientWidth, ch = el.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    if (!view.current) {
      // 처음엔 내 나라 수도 쪽을 화면에 꽉 차게
      const k = Math.max(cw / grid.W, ch / grid.H) * 1.6;
      const cap = s.castles.find((c) => c.owner === pid && c.capital) || s.castles.find((c) => c.owner === pid);
      const [x, y] = cap ? grid.center(cap.tile) : [grid.W / 2, grid.H / 2];
      view.current = { k, x: x - cw / k / 2, y: y - ch / k / 2 };
    }
    const { k, x: vx, y: vy } = view.current;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#8fb8cc';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, -vx * k * dpr, -vy * k * dpr);
    const sz = grid.size;
    const hexPath = (i, shrink = 1) => {
      const [cx, cy] = grid.center(i);
      ctx.beginPath();
      for (let d = 0; d < 6; d++) { const [px, py] = corner(cx, cy, sz * shrink, d); if (d) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    };
    const x0 = vx - sz * 2, x1 = vx + cw / k + sz * 2, y0 = vy - sz * 2, y1 = vy + ch / k + sz * 2;
    // 칸: 지형 바탕 + 주인 색
    for (let i = 0; i < grid.N; i++) {
      const [cx, cy] = grid.center(i);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const t = grid.terrain[i];
      if (!grid.passable(i)) {
        if (t === 0) continue;
        hexPath(i, 1.02); ctx.fillStyle = TERRAIN[t]?.color || '#6e645a'; ctx.fill();
        continue;
      }
      hexPath(i, 1.02);
      ctx.fillStyle = TERRAIN[t]?.color || '#d6dfa6';
      ctx.fill();
      const o = s.owner[i];
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = o >= 0 && s.nations[o] ? s.nations[o].color : NEUTRAL;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (grid.river[i]) { ctx.fillStyle = 'rgba(40,110,170,0.45)'; hexPath(i, 0.35); ctx.fill(); }
      if (t === 6 || t === 3) { ctx.fillStyle = 'rgba(60,40,20,0.28)'; ctx.beginPath(); ctx.moveTo(cx - sz * 0.45, cy + sz * 0.3); ctx.lineTo(cx, cy - sz * 0.4); ctx.lineTo(cx + sz * 0.45, cy + sz * 0.3); ctx.fill(); }
      if (t === 2) { ctx.fillStyle = 'rgba(20,60,20,0.25)'; ctx.beginPath(); ctx.arc(cx, cy, sz * 0.3, 0, 7); ctx.fill(); }
    }
    // 나라 경계선
    ctx.strokeStyle = 'rgba(20,20,20,0.55)';
    ctx.lineWidth = sz * 0.12;
    for (let i = 0; i < grid.N; i++) {
      if (!grid.passable(i)) continue;
      const [cx, cy] = grid.center(i);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      for (let d = 0; d < 6; d++) {
        const j = grid.nb[i][d];
        if (j === undefined || j < i || !grid.passable(j) || s.owner[j] === s.owner[i]) continue;
        // 두 칸 사이 모서리: 가운데 점을 이어 짧은 선
        const [jx, jy] = grid.center(j);
        const mx = (cx + jx) / 2, my = (cy + jy) / 2, dx = jy - cy, dy = cx - jx, L = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(mx - (dx / L) * sz * 0.55, my - (dy / L) * sz * 0.55); ctx.lineTo(mx + (dx / L) * sz * 0.55, my + (dy / L) * sz * 0.55); ctx.stroke();
      }
    }
    // 선택한 부대의 길
    const drawPath = (u, col) => {
      if (!u.path.length) return;
      ctx.strokeStyle = col; ctx.lineWidth = sz * 0.22; ctx.setLineDash([sz * 0.5, sz * 0.35]);
      ctx.beginPath();
      const [sx, sy] = grid.center(u.tile); ctx.moveTo(sx, sy);
      for (const t of u.path) { const [px, py] = grid.center(t); ctx.lineTo(px, py); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    for (const u of s.units) if (u.nation === pid) drawPath(u, sel?.type === 'unit' && sel.id === u.id ? '#ffe066' : 'rgba(255,255,255,0.55)');
    // 성
    const fs = Math.max(sz * 0.7, 9 / k);
    for (const c of s.castles) {
      const [cx, cy] = grid.center(c.tile);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const col = c.owner !== null && c.owner >= 0 && s.nations[c.owner] ? s.nations[c.owner].color : NEUTRAL;
      const r = sz * (c.capital ? 1.05 : 0.8);
      ctx.fillStyle = '#2a2622'; ctx.fillRect(cx - r - sz * 0.12, cy - r - sz * 0.12, (r + sz * 0.12) * 2, (r + sz * 0.12) * 2);
      ctx.fillStyle = col; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      if (sel?.type === 'castle' && sel.id === c.id) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = sz * 0.3; ctx.strokeRect(cx - r - sz * 0.3, cy - r - sz * 0.3, (r + sz * 0.3) * 2, (r + sz * 0.3) * 2); }
      if (k * sz > 5) {
        ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = fs * 0.25; ctx.strokeStyle = '#111'; ctx.fillStyle = '#fff';
        const label = `${c.capital ? '♛' : ''}${c.name}`;
        ctx.strokeText(label, cx, cy - r - fs * 0.4); ctx.fillText(label, cx, cy - r - fs * 0.4);
        if (k * sz > 9) { ctx.font = `${fs * 0.85}px sans-serif`; ctx.fillStyle = '#ffe9a8'; ctx.strokeText(fmtTroops(c.troops), cx, cy + r + fs * 0.95); ctx.fillText(fmtTroops(c.troops), cx, cy + r + fs * 0.95); }
      }
    }
    // 부대
    for (const u of s.units) {
      const [cx, cy] = grid.center(u.tile);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const n = s.nations[u.nation];
      const on = sel?.type === 'unit' && sel.id === u.id;
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.85, 0, 7);
      ctx.fillStyle = n.color; ctx.fill();
      ctx.lineWidth = sz * (on ? 0.32 : 0.18); ctx.strokeStyle = on ? '#ffe066' : u.cut ? '#ff6b3c' : '#fff'; ctx.stroke();
      // 병력 막대
      ctx.fillStyle = '#300'; ctx.fillRect(cx - sz * 0.8, cy + sz * 0.95, sz * 1.6, sz * 0.22);
      ctx.fillStyle = '#7bd88f'; ctx.fillRect(cx - sz * 0.8, cy + sz * 0.95, sz * 1.6 * Math.min(1, u.troops / u.max), sz * 0.22);
      const g = gensOf(s, u.gens)[0];
      ctx.font = `bold ${sz * 0.95}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = sz * 0.2;
      ctx.strokeText(g?.name?.[0] || '?', cx, cy + sz * 0.33); ctx.fillText(g?.name?.[0] || '?', cx, cy + sz * 0.33);
      if (k * sz > 8) {
        ctx.font = `${fs * 0.85}px sans-serif`;
        const lab = `${g?.name || ''} ${fmtTroops(u.troops)}`;
        ctx.strokeText(lab, cx, cy - sz * 1.15); ctx.fillText(lab, cx, cy - sz * 1.15);
      }
    }
  };
  useEffect(() => { draw(); });
  useEffect(() => {
    const onR = () => draw();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  });

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
    const nk = Math.max(0.5, Math.min(12, v.k * f));
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

  const tap = (px, py) => {
    if (playing) return;
    const [wx, wy] = toWorld(px, py);
    const t = pixelToCell(grid.size, grid.cols, grid.rows, wx, wy);
    if (t < 0) return;
    const u = game.units.find((x) => x.tile === t);
    const c = game.castles.find((x) => x.tile === t);
    // 내 부대를 고른 상태: 누른 곳으로 명령
    if (selUnit && selUnit.nation === pid && !(u && u.nation === pid)) {
      if (!grid.passable(t)) return toast('갈 수 없는 곳입니다.');
      const kind = u ? 'unit' : c ? 'castle' : 'tile';
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
    setSel((v) => (v?.type === 'unit' && !s.units.some((u) => u.id === v.id) ? null : v));
    let d = 0;
    const tick = () => {
      stepDay(s, grid);
      d += 1;
      const snap = clone(s);
      if (d >= DAYS || s.over) {
        endTurn14(snap, grid);
        setGame(snap);
        setPlaying(false);
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

  const myCastles = game.castles.filter((c) => c.owner === pid).length;
  const myUnits = game.units.filter((u) => u.nation === pid);
  const inc = useMemo(() => game.castles.filter((c) => c.owner === pid).reduce((a, c) => a + castleIncome(game, grid, c), 0) - [...game.castles.filter((c) => c.owner === pid), ...game.units.filter((u) => u.nation === pid)].reduce((a, x) => a + x.troops * 0.5, 0), [game, grid, pid]);

  const panel = (
    <div className="h14-side">
      {selCastle && (
        <div className="card">
          <h3 style={{ margin: '0 0 6px' }}>
            🏯 {selCastle.capital ? '♛ ' : ''}{selCastle.name}{' '}
            <small className="muted">{selCastle.owner !== null && selCastle.owner >= 0 ? game.nations[selCastle.owner].name : selCastle.bandit || '중립'}</small>
          </h3>
          <div className="kv">
            <span>수비병</span><span>{fmtTroops(selCastle.troops)}</span>
            <span>성 내구</span><span>{Math.round(selCastle.dur)} / {selCastle.maxDur}</span>
            <span>인구</span><span>{selCastle.pop}천</span>
            <span>지형</span><span>{TERRAIN_NAME[grid.terrain[selCastle.tile]] || '-'}</span>
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
                      }} /> {g.name} <small className="muted">무{g.war} 통{g.lead} 지{g.intel}{(g.traits || []).some(([t]) => t === '기마') ? ' · 기마(빠름)' : ''}</small>
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
              <div style={{ fontSize: 13 }}>
                징병 {fmtTroops(Math.min(draftAmt, draftMax14(game, selCastle)))} (1명당 5금)
                <Slider min={0} max={draftMax14(game, selCastle)} step={100} value={Math.min(draftAmt, draftMax14(game, selCastle))} onChange={setDraftAmt} style={{ width: '100%' }} />
                <button disabled={draftAmt < 100} onClick={() => act((s) => draft14(s, selCastle.id, draftAmt))}>💂 징병</button>
              </div>
            </div>
          )}
        </div>
      )}
      {selUnit && (() => {
        const gs = gensOf(game, selUnit.gens), st = unitStats(game, selUnit);
        const tgt = selUnit.order ? (selUnit.order.kind === 'castle' ? game.castles[selUnit.order.id]?.name : selUnit.order.kind === 'unit' ? `${gensOf(game, unitById(selUnit.order.id)?.gens || [])[0]?.name || '?'} 부대` : '지정한 곳') : '없음';
        return (
          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>⚑ {gs.map((g) => g.name).join('·')} 부대 <small className="muted">{game.nations[selUnit.nation].name}</small></h3>
            <div className="kv">
              <span>병력</span><span>{fmtTroops(selUnit.troops)} / {fmtTroops(selUnit.max)}</span>
              <span>사기</span><span>{Math.round(selUnit.morale)}</span>
              <span>공·방</span><span>{Math.round(st.atk)} · {Math.round(st.def)}</span>
              <span>보급</span><span style={{ color: selUnit.cut ? 'var(--danger)' : undefined }}>{selUnit.cut ? '끊김 (병력·사기 감소)' : '이어짐'}</span>
              <span>목표</span><span>{tgt}</span>
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
          내 성(네모)을 눌러 <b>출진</b>하고, 부대를 고른 뒤 지도를 눌러 명령하세요. <b>턴 진행</b>을 누르면 10일 동안 모든 부대가 동시에 움직입니다.
          <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
            <li>지나간 칸은 내 땅이 됩니다. 성 지역의 땅이 많을수록 그 성의 수입이 늘어납니다.</li>
            <li>적 부대 옆 칸에 들어서면 그날은 더 못 갑니다(통제 구역).</li>
            <li>여러 방향에서 한 부대를 치면 협공(+30%씩).</li>
            <li>내 성·내 땅과 끊기면 보급이 끊겨 병력·사기가 줄어듭니다(주황 테두리).</li>
            <li>성 수비병이나 내구가 0이 되면 함락, 그 지역 땅이 통째로 넘어옵니다.</li>
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
        <span>{dateOf(game, startYear)} {playing ? `· ${game.day}일째` : ''}</span>
        <span>💰 {fmtGold(me.gold)} <small className="muted" style={{ color: inc < 0 ? 'var(--danger)' : undefined }}>({inc >= 0 ? '+' : ''}{fmtGold(inc)}/턴)</small></span>
        <span>🏯 {myCastles}성</span>
        <span>⚑ 부대 {myUnits.length}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="sm" onClick={() => setSpeed((v) => (v > 250 ? 150 : 380))}>{speed > 250 ? '▶ 보통' : '⏩ 빠르게'}</button>
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
          <button className="primary end-turn" disabled={playing || !!game.over} onClick={runTurn}>
            {playing ? `⏳ ${game.day}/${DAYS}일` : '턴 진행 ▶ (10일)'}
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
