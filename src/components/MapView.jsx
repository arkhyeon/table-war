import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TERRAIN } from '../game/rules.js';
import { WEATHER } from '../game/weather.js';

const NEUTRAL = '#b9b2a0';

// 강 다듬기: 구간을 잘게 나누고 옆으로 살짝 굽이치게 한 뒤 차이킨 곡선화 → 직선 느낌 제거
function riverCurve(pts, amp, seed) {
  if (pts.length < 2) return pts;
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const w = i === 0 && k === 0 ? 0 : Math.sin((i * 3 + k) * 1.3 + seed) * amp * (0.6 + 0.4 * Math.sin((i + k) * 0.7 + seed * 2));
      dense.push([ax + dx * t + nx * w, ay + dy * t + ny * w]);
    }
  }
  dense.push(pts[pts.length - 1]);
  let cur = dense;
  for (let it = 0; it < 2; it++) {
    const nxt = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i], [bx, by] = cur[i + 1];
      nxt.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    nxt.push(cur[cur.length - 1]);
    cur = nxt;
  }
  return cur;
}

// 병력 규모 단계: 0(없음)~5(대군, 깃발)
export const armyTier = (t) => (t <= 0 ? 0 : t < 3000 ? 1 : t < 10000 ? 2 : t < 30000 ? 3 : t < 80000 ? 4 : 5);

// 병사 한 명 (발끝이 원점, 위로 그려짐)
function Soldier({ u, color, x = 0, delay = 0 }) {
  return (
    <g transform={`translate(${x},0)`}>
      <g className="soldier" style={{ animationDelay: `${delay}s` }}>
        <line x1={u * 0.62} y1={u * 0.1} x2={u * 0.62} y2={-u * 2.35} stroke="#5a4630" strokeWidth={u * 0.13} />
        <path d={`M${u * 0.47} ${-u * 2.2}L${u * 0.62} ${-u * 2.6}L${u * 0.77} ${-u * 2.2}Z`} fill="#cfd3d6" stroke="#222" strokeWidth={u * 0.05} />
        <path d={`M${-u * 0.42} ${-u * 1.2}L${u * 0.42} ${-u * 1.2}L${u * 0.55} 0L${-u * 0.55} 0Z`} fill={color} stroke="#fffdf6" strokeWidth={u * 0.3} paintOrder="stroke" />
        <path d={`M${-u * 0.42} ${-u * 1.2}L${u * 0.42} ${-u * 1.2}L${u * 0.55} 0L${-u * 0.55} 0Z`} fill="none" stroke="#1a1a1a" strokeWidth={u * 0.08} />
        <circle cy={-u * 1.55} r={u * 0.33} fill="#f1d3a5" stroke="#1a1a1a" strokeWidth={u * 0.08} />
        <path d={`M${-u * 0.36} ${-u * 1.6}A${u * 0.36} ${u * 0.36} 0 0 1 ${u * 0.36} ${-u * 1.6}Z`} fill="#555" />
      </g>
    </g>
  );
}

// 병력 규모 그림: 1~4명, 5단계는 군기까지
export function Army({ tier, color, u, y = 0 }) {
  if (!tier) return null;
  const n = Math.min(4, tier);
  const gap = u * 1.05;
  const x0 = -((n - 1) * gap) / 2;
  return (
    <g transform={`translate(0,${y})`} className="army">
      <ellipse cy={-u * 0.05} rx={((n - 1) * gap) / 2 + u * (tier >= 5 ? 1.9 : 0.95)} cx={tier >= 5 ? -gap * 0.45 : 0} ry={u * 0.42} fill="#fffdf6" opacity={0.9} stroke={color} strokeWidth={u * 0.12} />
      {tier >= 5 && (
        <g transform={`translate(${x0 - gap * 0.9},0)`}>
          <line y1={u * 0.1} y2={-u * 3.1} stroke="#3b2b1a" strokeWidth={u * 0.15} />
          <path className="banner" d={`M0 ${-u * 3.1}L${u * 1.3} ${-u * 2.8}L0 ${-u * 2.3}Z`} fill={color} stroke="#1a1a1a" strokeWidth={u * 0.07} />
        </g>
      )}
      {Array.from({ length: n }, (_, i) => (
        <Soldier key={i} u={u} color={color} x={x0 + i * gap} delay={(i * 0.37) % 1.2} />
      ))}
    </g>
  );
}

// 이동·공격 애니메이션 층: 지도 전체를 다시 그리지 않도록 자체 상태로 프레임 갱신
function MoveLayer({ world, nations, moves, visible, outline, s }) {
  const [tokens, setTokens] = useState([]);
  const [now, setNow] = useState(0);
  const last = useRef(null);
  useEffect(() => {
    if (!moves) return;
    const maxId = moves.length ? moves[moves.length - 1].id : 0;
    if (last.current === null || maxId < last.current) {
      last.current = maxId; // 처음 열거나 새 게임: 지난 이동은 재생하지 않음
      return;
    }
    const fresh = moves.filter((m) => m.id > last.current && (visible(m.from) || visible(m.to))).slice(-40);
    last.current = maxId;
    if (!fresh.length) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    setTokens((ts) => [...ts, ...fresh.map((m, i) => ({ ...m, start: t0 + i * 160 }))]);
  }, [moves]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tokens.length > 0;
  useEffect(() => {
    if (!active) return;
    let raf;
    const loop = (t) => {
      setNow(t);
      setTokens((ts) => {
        const keep = ts.filter((x) => t - x.start < 2600);
        return keep.length === ts.length ? ts : keep;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const u = s * 0.5;
  return (
    <g pointerEvents="none">
      {tokens.map((m) => {
        const t = (now - m.start) / 1000;
        if (t < 0) return null;
        const a = world.regions[m.from], b = world.regions[m.to];
        const col = nations[m.n]?.color || '#c00';
        const TRAVEL = 1.5; // 행군 시간(초)
        const p = Math.min(1, t / TRAVEL);
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const x = a.cx + (b.cx - a.cx) * e, y = a.cy + (b.cy - a.cy) * e;
        const hop = Math.abs(Math.sin(p * Math.PI * 9)) * u * 0.4; // 발맞춰 걷는 들썩임
        const sway = Math.sin(p * Math.PI * 9) * 4; // 좌우 흔들림(도)
        const fight = m.k === 'win' || m.k === 'lose' || m.k === 'siege';
        const after = t - TRAVEL;
        return (
          <g key={m.id}>
            {p < 1 && (
              <>
                <line x1={a.cx} y1={a.cy} x2={x} y2={y} stroke={col} strokeWidth={s * 0.18} strokeDasharray={`${s * 0.3} ${s * 0.3}`} opacity={0.7} />
                {[0.12, 0.24, 0.36].map((k, j) => {
                  const q = Math.max(0, p - k * 0.5);
                  const ex = a.cx + (b.cx - a.cx) * q, ey = a.cy + (b.cy - a.cy) * q;
                  return <circle key={j} cx={ex} cy={ey + u * 0.2} r={u * (0.5 + j * 0.25)} fill="#d8c8a0" opacity={0.35 - j * 0.1} />;
                })}
                <g transform={`translate(${x},${y - hop}) rotate(${sway})`}>
                  <ellipse rx={u * 1.6} ry={u * 0.45} fill="#000" opacity={0.25} transform={`translate(0,${hop})`} />
                  <Army tier={Math.min(3, armyTier(m.c))} color={col} u={u} />
                  {m.k === 'aid' && <text y={-u * 3} fontSize={s * 0.8} textAnchor="middle">🤝</text>}
                </g>
              </>
            )}
            {p >= 1 && fight && after < 0.8 && (
              <g transform={`translate(${b.cx},${b.cy}) scale(${0.6 + after * 1.4})`} opacity={1 - after / 0.8}>
                <text fontSize={s * 1.8} textAnchor="middle" dy={s * 0.6}>
                  {m.k === 'lose' ? '🛡️' : '💥'}
                </text>
              </g>
            )}
            {p >= 1 && m.k === 'win' && outline[m.to] && after < 0.85 && (
              <path d={outline[m.to]} fill={col} fillOpacity={0.45 * (1 - after / 0.85)} fillRule="evenodd" stroke={col} strokeWidth={3} opacity={1 - after / 0.85} />
            )}
          </g>
        );
      })}
    </g>
  );
}

export default function MapView({ world, regions, nations, selected, targets, onClick, onContext, genCount, compact, battles, fmt = (n) => n, view, showTroops, weather, cutSet, focus, flash, moves, showArmy = true, home, orders }) {
  const clipId = 'land' + useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [vb, setVb] = useState([0, 0, world.W, world.H]);
  const drag = useRef(null);

  // 처음 화면: 세로로 긴 화면(폰)이면 높이에 맞춰 꽉 채우고 내 수도 쪽을 보여줌
  const fitView = () => {
    const el = svgRef.current;
    const rect = el?.getBoundingClientRect();
    if (world.focusBox && rect?.width) {
      const [fx, fy, fw, fh] = world.focusBox;
      const ar = rect.height / rect.width;
      const w = Math.min(world.W, Math.max(fw * 1.4, (fh * 1.4) / ar)), h = w * ar;
      return [Math.max(0, Math.min(world.W - w, fx + fw / 2 - w / 2)), Math.max(0, Math.min(Math.max(0, world.H - h), fy + fh / 2 - h / 2)), w, h];
    }
    if (!rect || !rect.width || rect.height / rect.width <= (world.H / world.W) * 1.15) return [0, 0, world.W, world.H];
    const w = world.H * (rect.width / rect.height);
    const cx = home !== null && home !== undefined && world.regions[home] ? world.regions[home].cx : world.W / 2;
    return [Math.max(0, Math.min(world.W - w, cx - w / 2)), 0, w, world.H];
  };
  useEffect(() => setVb(fitView()), [world]); // eslint-disable-line react-hooks/exhaustive-deps
  // 전투 다시보기: 해당 지역으로 화면 이동
  useEffect(() => {
    if (focus === null || focus === undefined) return;
    const r = world.regions[focus];
    setVb(([, , w, h]) => {
      const nw = Math.min(w, world.W * 0.45), nh = nw * (h / w);
      return [r.cx - nw / 2, r.cy - nh / 2, nw, nh];
    });
  }, [focus, world]);

  // 정적 레이어
  const statics = useMemo(() => {
    const { paths, rivers } = world;
    const riverD = rivers.map((r, k) => 'M' + riverCurve(r.pts, world.unit * 0.22, k * 2.17).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')).join('');
    return { ...paths, riverD };
  }, [world]);

  const ownerKey = regions.map((r) => r.owner ?? '-').join(',');
  const nationBorder = useMemo(() => {
    let d = '';
    for (const [key, seg] of world.paths.pairSegs) {
      const a = Math.floor(key / 100000), b = key % 100000;
      if (regions[a].owner !== regions[b].owner) d += seg;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, ownerKey]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setVb(([x, y, w, h]) => {
        const scale = Math.min(rect.width / w, rect.height / h);
        const ox = x - (rect.width / scale - w) / 2, oy = y - (rect.height / scale - h) / 2;
        const mx = ox + (e.clientX - rect.left) / scale, my = oy + (e.clientY - rect.top) / scale;
        const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nw = Math.max(world.W / 12, Math.min(world.W * 1.2, w * k));
        const nh = nw * (h / w);
        return [mx - (mx - x) * (nw / w), my - (my - y) * (nh / h), nw, nh];
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [world]);

  const zoom = (k) =>
    setVb(([x, y, w, h]) => {
      const nw = Math.max(world.W / 12, Math.min(world.W * 1.2, w * k)), nh = nw * (h / w);
      return [x + (w - nw) / 2, y + (h - nh) / 2, nw, nh];
    });

  // 화면 좌표 → 지도 좌표 (meet 배치 여백 고려)
  const toWorld = (cx, cy, [x, y, w, h]) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / w, rect.height / h);
    const ox = x - (rect.width / scale - w) / 2, oy = y - (rect.height / scale - h) / 2;
    return [ox + (cx - rect.left) / scale, oy + (cy - rect.top) / scale];
  };
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      // 두 손가락: 핀치 줌 시작
      const [[ax, ay], [bx, by]] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(ax - bx, ay - by), vb, mid: toWorld((ax + bx) / 2, (ay + by) / 2, vb) };
      if (drag.current) drag.current.moved = true;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
  };
  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size >= 2) {
      const [[ax, ay], [bx, by]] = [...pointers.current.values()];
      const pc = pinch.current;
      const [x, y, w, h] = pc.vb;
      const nw = Math.max(world.W / 12, Math.min(world.W * 1.2, (w * pc.dist) / Math.max(10, Math.hypot(ax - bx, ay - by))));
      const nh = nw * (h / w);
      const [mx, my] = pc.mid;
      setVb([mx - (mx - x) * (nw / w), my - (my - y) * (nh / h), nw, nh]);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const rect = svgRef.current.getBoundingClientRect();
    const [x, y, w, h] = d.vb;
    const scale = Math.min(rect.width / w, rect.height / h);
    setVb([x - dx / scale, y - dy / scale, w, h]);
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e?.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setTimeout(() => (drag.current = null), 0);
  };
  const click = (rid, e) => {
    if (drag.current?.moved) return;
    onClick?.(rid, e);
  };
  const context = (rid, e) => {
    e.preventDefault();
    onContext?.(rid);
  };

  const s = world.unit;
  const arrows = (battles || []).map((b, i) => {
    const a = world.regions[b.from], t = world.regions[b.to];
    const dx = t.cx - a.cx, dy = t.cy - a.cy, L = Math.hypot(dx, dy) || 1;
    const x1 = a.cx + (dx / L) * s * 1.2, y1 = a.cy + (dy / L) * s * 1.2, x2 = t.cx - (dx / L) * s * 1.3, y2 = t.cy - (dy / L) * s * 1.3;
    const mx = (x1 + x2) / 2 - (dy / L) * L * 0.15, my = (y1 + y2) / 2 + (dx / L) * L * 0.15;
    const col = nations[b.attacker]?.color || '#c00';
    const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    return (
      <g key={i}>
        <path d={d} fill="none" stroke="#111" strokeWidth={s * 0.62} strokeLinecap="round" opacity={0.75} />
        <path d={d} fill="none" stroke={col} strokeWidth={s * 0.36} strokeLinecap="round" strokeDasharray={b.win ? undefined : `${s * 0.6} ${s * 0.4}`} markerEnd={`url(#${clipId}-ah)`} />
      </g>
    );
  });
  // 이번 턴 이동 계획 화살표 (점선 + 병력 수)
  const planArrows = (orders || []).map((o) => {
    const a = world.regions[o.from], t = world.regions[o.to];
    const dx = t.cx - a.cx, dy = t.cy - a.cy, L = Math.hypot(dx, dy) || 1;
    const x1 = a.cx + (dx / L) * s * 0.9, y1 = a.cy + (dy / L) * s * 0.9, x2 = t.cx - (dx / L) * s * 1.1, y2 = t.cy - (dy / L) * s * 1.1;
    const mx = (x1 + x2) / 2 - (dy / L) * L * 0.12, my = (y1 + y2) / 2 + (dx / L) * L * 0.12;
    const col = nations[o.n]?.color || '#fff';
    const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const lx = (x1 + 2 * mx + x2) / 4, ly = (y1 + 2 * my + y2) / 4;
    const lab = fmt(o.count);
    const w = String(lab).length * s * 0.5 + s * 0.8;
    return (
      <g key={'o' + o.id} className="plan-arrow">
        <path d={d} fill="none" stroke="#15171b" strokeWidth={s * 0.5} strokeLinecap="round" opacity={0.7} />
        <path className="march-dash" d={d} fill="none" stroke={col} strokeWidth={s * 0.28} strokeLinecap="round" strokeDasharray={`${s * 0.55} ${s * 0.3}`} markerEnd={`url(#${clipId}-ah)`} style={{ '--dash': `${s * 0.85}px` }} />
        <rect x={lx - w / 2} y={ly - s * 0.55} width={w} height={s * 1.1} rx={s * 0.5} fill="#15171b" stroke={col} strokeWidth={s * 0.12} />
        <text x={lx} y={ly + s * 0.28} fontSize={s * 0.7} textAnchor="middle" fill="#fffdf6" fontWeight="700">
          {lab}
        </text>
      </g>
    );
  });
  const zoomed = vb[2] < world.W * 0.55;
  const viewOf = (rid) => (view ? view(rid) : 'visible');
  const fogKey = view ? world.regions.map((r) => viewOf(r.id)[0]).join('') : '';
  const fog = useMemo(() => {
    let seen = '', dim = '', any = false;
    if (!view) return { seen, dim, any };
    world.regions.forEach((r, i) => {
      const v = fogKey[i];
      if (v === 'h') any = true;
      else seen += world.paths.regionPath[i];
      if (v === 'k') dim += world.paths.regionPath[i];
    });
    return { seen, dim, any };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, fogKey]);
  const color = (rid) => {
    const o = regions[rid].owner;
    return o === null ? NEUTRAL : nations[o].color;
  };
  const capitals = new Set(nations.filter((n) => n.alive && n.capital !== null).map((n) => n.capital));

  const seaLines = [];
  if (selected !== null && selected !== undefined) {
    const a = world.regions[selected];
    for (const nb of a.neighbors) {
      if (nb.type !== 'sea') continue;
      const b = world.regions[nb.id];
      seaLines.push(<line key={nb.id} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} className="sea-route" stroke="#1d4f6b" strokeWidth={s * 0.18} strokeDasharray={`${s * 0.6} ${s * 0.4}`} />);
    }
  }

  return (
    <div className={'mapwrap' + (zoomed || world.landCount < 170 ? ' live' : '')} style={{ height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={vb.join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={statics.land} />
          </clipPath>
          <marker id={`${clipId}-ah`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="context-stroke" />
          </marker>
        </defs>
        <rect x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3} fill="#8fb8cc" />
        {/* 바다 구역 (함대가 있으면 국가 색) */}
        <g>
          {world.regions.map((r) =>
            r.sea ? (
              <path
                key={r.id}
                data-rid={r.id}
                d={statics.regionPath[r.id]}
                fill={regions[r.id].owner !== null && regions[r.id].troops > 0 ? nations[regions[r.id].owner].color : '#ffffff'}
                fillOpacity={regions[r.id].owner !== null && regions[r.id].troops > 0 ? 0.35 : 0.04}
                fillRule="evenodd"
                onClick={(e) => click(r.id, e)}
                onContextMenu={(e) => context(r.id, e)}
                style={{ cursor: 'pointer' }}
              />
            ) : null,
          )}
          <path d={statics.seaBorders} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="3 3" pointerEvents="none" />
        </g>
        <path d={statics.land} fill={NEUTRAL} />
        <g clipPath={`url(#${clipId})`}>
          {world.regions.map((r) => r.sea ? null : (
            <path
              key={r.id}
              data-rid={r.id}
              d={statics.regionPath[r.id]}
              fill={color(r.id)}
              fillRule="evenodd"
              onClick={(e) => click(r.id, e)}
              onContextMenu={(e) => context(r.id, e)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </g>
        <g pointerEvents="none">
          <g clipPath={`url(#${clipId})`}>
            <path d={statics.glyph.tundra} fill="none" stroke="#ffffff" strokeWidth={s * 0.15} opacity={0.6} />
            <path d={statics.glyph.forest} fill="#1f5a2a" opacity={0.35} />
            <path d={statics.glyph.hills} fill="none" stroke="#4a3518" strokeWidth={s * 0.16} strokeLinecap="round" opacity={0.7} />
            <path d={statics.glyph.desert} fill="none" stroke="#8a6a2a" strokeWidth={s * 0.18} strokeLinecap="round" opacity={0.6} />
            <path d={statics.glyph.mountain} fill="#7a634b" stroke="#2b1f14" strokeWidth={s * 0.08} strokeLinejoin="round" opacity={0.9} />
            {statics.glyph.mountainShade && <path d={statics.glyph.mountainShade} fill="#2b1f14" opacity={0.45} />}
            <path d={statics.peaks} fill={TERRAIN[7].color} fillRule="evenodd" opacity={0.55} />
            <path d={statics.glyph.peakCap} fill="#f4f1ea" stroke="#3a3a3a" strokeWidth={s * 0.08} strokeLinejoin="round" />
            <path d={statics.borders} fill="none" stroke="#00000045" strokeWidth={0.7} />
            <path d={nationBorder} fill="none" stroke="#1b1b1b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={fog.dim} fill="#1b1d22" opacity={0.22} fillRule="evenodd" />
            {flash && [...flash].map((rid) => <path key={'f' + rid} className="flash" d={statics.outline[rid]} fill="#ffd34a33" fillRule="evenodd" stroke="#ffd34a" strokeWidth={3} />)}
            {focus !== null && focus !== undefined && <path d={statics.outline[focus]} fill="#ff334422" fillRule="evenodd" stroke="#ff3344" strokeWidth={3.2} />}
          {targets &&
            [...targets.entries()].filter(([rid]) => !world.regions[rid].sea).map(([rid, kind]) => (
              <path
                key={rid}
                d={statics.outline[rid]}
                fill={kind === 'attack' ? '#ff554433' : kind === 'move' ? '#ffe06622' : 'none'}
                fillRule="evenodd"
                stroke={kind === 'attack' ? '#ff5544' : kind === 'blocked' ? '#888' : '#ffe066'}
                strokeWidth={2.4}
                strokeDasharray={kind === 'blocked' ? '3 3' : undefined}
              />
            ))}
          {selected !== null && selected !== undefined && !world.regions[selected].sea && <path d={statics.outline[selected]} fill="#ffffff22" fillRule="evenodd" stroke="#fff" strokeWidth={3} />}
          </g>
          <path d={statics.riverD} fill="none" stroke="#3f86b4" strokeWidth={s * 0.28} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
          <path d={statics.land} fill="none" stroke="#2c5468" strokeWidth={1.1} />
          {statics.glyph.cliff && (
            <>
              <path d={statics.glyph.cliff} fill="none" stroke="#fffdf6" strokeWidth={s * 0.3} strokeLinejoin="round" opacity={0.8} />
              <path d={statics.glyph.cliff} fill="none" stroke="#5a2d14" strokeWidth={s * 0.14} strokeLinejoin="round" />
            </>
          )}
          {targets &&
            [...targets.entries()].filter(([rid]) => world.regions[rid].sea).map(([rid, kind]) => (
              <path
                key={rid}
                d={statics.outline[rid]}
                fill={kind === 'attack' ? '#ff554433' : kind === 'move' ? '#ffe06622' : 'none'}
                fillRule="evenodd"
                stroke={kind === 'attack' ? '#ff5544' : kind === 'blocked' ? '#888' : '#ffe066'}
                strokeWidth={2.4}
                strokeDasharray={kind === 'blocked' ? '3 3' : undefined}
              />
            ))}
          {selected !== null && selected !== undefined && world.regions[selected].sea && <path d={statics.outline[selected]} fill="#ffffff22" fillRule="evenodd" stroke="#fff" strokeWidth={3} />}
          {seaLines}
          {(world.straitLines || []).map(([ax, ay, bx, by], k) => (
            <g key={'st' + k}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#15171b" strokeWidth={s * 0.42} strokeLinecap="round" opacity={0.6} />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#fffdf6" strokeWidth={s * 0.2} strokeDasharray={`${s * 0.35} ${s * 0.25}`} strokeLinecap="round" />
            </g>
          ))}
          {arrows}
          {planArrows}
          {!compact && moves && showArmy && <MoveLayer world={world} nations={nations} moves={moves} visible={(rid) => viewOf(rid) === 'visible'} outline={statics.outline} s={s} />}
          {/* 안개: 지도 전체(바다 포함)를 덮고 내가 아는 지역만 뚫음 */}
          {fog.any && (
            <>
              <mask id={`${clipId}-fog`} maskUnits="userSpaceOnUse" x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3}>
                <rect x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3} fill="#fff" />
                <path d={fog.seen} fill="#000" fillRule="nonzero" />
              </mask>
              <rect x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3} fill="#2b2d32" mask={`url(#${clipId}-fog)`} pointerEvents="none" />
            </>
          )}
          {/* 라벨은 클릭을 가로채지 않음 → 작은 지역도 그 위를 눌러 선택 가능 */}
          <g pointerEvents="none">
          {!compact &&
            world.regions.map((r) => {
              const reg = regions[r.id];
              const v = viewOf(r.id);
              if (v === 'hidden') return null;
              if (r.sea) {
                const wxs = weather ? WEATHER[weather[r.id]] : null;
                if (!(reg.troops > 0 && reg.owner !== null)) return wxs?.noSea && v === 'visible' ? (
                  <text key={r.id} x={r.cx} y={r.cy} fontSize={s * 0.9} textAnchor="middle" opacity={0.8}>
                    🌀
                  </text>
                ) : null;
                const ft = !showTroops || showTroops(r.id) ? fmt(reg.troops) : '?';
                const fw = Math.max(s * 2.4, String(ft).length * s * 0.5 + s * 1.6);
                return (
                  <g key={r.id} transform={`translate(${r.cx},${r.cy})`}>
                    <rect x={-fw / 2} y={-s * 0.8} width={fw} height={s * 1.6} rx={s * 0.3} fill="#1d3b4d" stroke={nations[reg.owner].color} strokeWidth={s * 0.25} />
                    <text textAnchor="middle" dy={s * 0.3} fontSize={s * 0.8} fontWeight="700" fill="#fff">
                      ⛵{ft}
                    </text>
                  </g>
                );
              }
              const visible = v === 'visible';
              const own = reg.owner;
              const col = own === null ? '#777' : nations[own].color;
              const known = !showTroops || showTroops(r.id);
              // 병력을 모르는 지역은 '?' 대신 지역 이름만
              const t = known ? fmt(reg.troops) : reg.name;
              const fs = known ? s * 0.8 : s * 0.62;
              const bw = Math.max(s * 1.9, String(t).length * fs * (known ? 0.62 : 0.95) + s * 0.6);
              const rebel = visible && reg.loyalty !== undefined && reg.owner !== null && reg.loyalty < 30;
              const wx = weather ? WEATHER[weather[r.id]] : null;
              const cut = cutSet?.has(r.id);
              const gc = visible ? genCount?.[r.id] || 0 : 0;
              const b = reg.buildings;
              const icons = [b.walls && `🏰${b.walls < 3 ? b.walls : ''}`, b.market && '💰', b.port && '⚓', b.barracks && '⚔️'].filter(Boolean);
              // 멀리서 볼 때 병력 모르는 지역은 이름표 대신 작은 점 (큰 지도에서 지도가 이름표로 덮이지 않게)
              if (!known && !zoomed) return <circle key={r.id} cx={r.cx} cy={r.cy} r={s * 0.28} fill={own === null ? '#9b9584' : col} stroke="#fffdf6" strokeWidth={s * 0.08} opacity={0.85} />;
              const army = showArmy && own !== null && known && reg.troops > 0;
              const ib = s * 0.95; // 아이콘 배지 크기
              return (
                <g key={r.id} transform={`translate(${r.cx},${r.cy})`}>
                  {army && <Army tier={armyTier(reg.troops)} color={col} u={s * 0.5} y={-s * 0.78} />}
                  <rect x={-bw / 2} y={-s * 0.8} width={bw} height={s * 1.6} rx={s * 0.8} fill={known ? '#fffdf6' : '#e9e4d6'} stroke={col} strokeWidth={s * 0.22} />
                  <text textAnchor="middle" dy={fs * 0.36} fontSize={fs} fontWeight="700" fill={known ? '#1d1d1d' : '#55524a'}>
                    {t}
                  </text>
                  {wx && wx.icon && (
                    <g transform={`translate(${-bw / 2 - s * 0.15},${-s * 0.85})`}>
                      <circle r={ib * 0.62} fill="#1d2a36" stroke="#fffdf6" strokeWidth={s * 0.08} opacity={0.92} />
                      <text dy={ib * 0.3} fontSize={ib * 0.85} textAnchor="middle">
                        {wx.icon}
                      </text>
                    </g>
                  )}
                  {cut && (
                    <g transform={`translate(${bw / 2 + s * 0.1},${s * 0.95})`}>
                      <circle r={ib * 0.55} fill="#ff9a3c" stroke="#1d1d1d" strokeWidth={s * 0.08} />
                      <text dy={ib * 0.28} fontSize={ib * 0.75} textAnchor="middle" fill="#1d1d1d" fontWeight="700">
                        ✂
                      </text>
                    </g>
                  )}
                  {rebel && <circle cx={bw / 2} cy={-s * 0.7} r={s * 0.38} fill="#e2655a" stroke="#fffdf6" strokeWidth={s * 0.1} />}
                  {capitals.has(r.id) && (
                    <g transform={`translate(${-bw / 2 - s * 0.55},0)`}>
                      <circle r={ib * 0.62} fill="#2a2210" stroke="#ffd34d" strokeWidth={s * 0.1} />
                      <text dy={ib * 0.33} fontSize={ib * 0.95} textAnchor="middle" fill="#ffd34d">
                        ♛
                      </text>
                    </g>
                  )}
                  {gc > 0 && (
                    <g transform={`translate(${bw / 2 + s * 0.6},0)`}>
                      <circle r={ib * 0.62} fill="#2a2210" stroke="#ffe066" strokeWidth={s * 0.1} />
                      <text dy={ib * 0.32} fontSize={ib * (gc > 1 ? 0.7 : 0.9)} textAnchor="middle" fill="#ffe066" fontWeight="700">
                        {gc > 1 ? `★${gc}` : '★'}
                      </text>
                    </g>
                  )}
                  {icons.length > 0 && (
                    <g transform={`translate(0,${s * 1.55})`}>
                      <rect x={(-icons.length * ib) / 2 - s * 0.15} y={-ib * 0.55} width={icons.length * ib + s * 0.3} height={ib * 1.1} rx={ib * 0.45} fill="#fffdf6" stroke={col} strokeWidth={s * 0.1} opacity={0.95} />
                      {icons.map((ic, k) => (
                        <text key={k} x={(k - (icons.length - 1) / 2) * ib} dy={ib * 0.3} fontSize={ib * 0.78} textAnchor="middle" fill="#1d1d1d" fontWeight="700">
                          {ic}
                        </text>
                      ))}
                    </g>
                  )}
                  {zoomed && known && (
                    <text dy={army ? -s * 2.4 : -s * 1.25} fontSize={s * 0.66} textAnchor="middle" fill="#fffdf6" stroke="#15171b" strokeWidth={s * 0.22} paintOrder="stroke" fontWeight="600">
                      {reg.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          {compact &&
            nations
              .filter((n) => n.alive && n.capital !== null)
              .map((n) => {
                const r = world.regions[n.capital];
                return (
                  <g key={n.id} transform={`translate(${r.cx},${r.cy})`}>
                    <circle r={s * 0.5} fill="#ffd34d" stroke="#000" strokeWidth={0.6} />
                    <text dy={-s * 0.8} fontSize={s * 1.1} textAnchor="middle" fontWeight="700" fill="#111" stroke="#fffdf6" strokeWidth={s * 0.25} paintOrder="stroke">
                      {n.name}
                    </text>
                  </g>
                );
              })}
        </g>
      </svg>
      <div className="map-ctrl">
        <button onClick={() => zoom(1 / 1.3)}>＋</button>
        <button onClick={() => zoom(1.3)}>－</button>
        <button onClick={() => setVb(fitView())}>⤢</button>
      </div>
    </div>
  );
}
