import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TERRAIN } from '../game/rules.js';

// 시작 화면의 나라 고르기 지도 (미리보기 전용) — 예전 「지역 모드」 게임 화면의 부대·화살표·안개·이름표는 뺌
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

export default function MapView({ world, regions, nations, selected, onClick, home }) {
  const clipId = 'land' + useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [vb, setVb] = useState([0, 0, world.W, world.H]);
  const drag = useRef(null);

  // 처음 화면: 세로로 긴 화면(폰)이면 높이에 맞춰 꽉 채움
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

  // 최대 확대
  const minW = world.W / (world.focusBox ? 64 : world.cols > 100 ? 24 : 12);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setVb(([x, y, w, h]) => {
        const scale = Math.min(rect.width / w, rect.height / h);
        const ox = x - (rect.width / scale - w) / 2, oy = y - (rect.height / scale - h) / 2;
        const mx = ox + (e.clientX - rect.left) / scale, my = oy + (e.clientY - rect.top) / scale;
        const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nw = Math.max(minW, Math.min(world.W * 1.2, w * k));
        const nh = nw * (h / w);
        return [mx - (mx - x) * (nw / w), my - (my - y) * (nh / h), nw, nh];
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [world, minW]);

  const zoom = (k) =>
    setVb(([x, y, w, h]) => {
      const nw = Math.max(minW, Math.min(world.W * 1.2, w * k)), nh = nw * (h / w);
      return [x + (w - nw) / 2, y + (h - nh) / 2, nw, nh];
    });

  // 화면 좌표 → 지도 좌표 (meet 배치 여백 고려)
  const toWorld = (cx, cy, [x, y, w, h]) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / w, rect.height / h);
    const ox = x - (rect.width / scale - w) / 2, oy = y - (rect.height / scale - h) / 2;
    return [ox + (cx - rect.left) / scale, oy + (cy - rect.top) / scale];
  };
  // 끌어서 이동·두 손가락 확대
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
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
      const nw = Math.max(minW, Math.min(world.W * 1.2, (w * pc.dist) / Math.max(10, Math.hypot(ax - bx, ay - by))));
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

  const s = world.unit;
  const color = (rid) => {
    const o = regions[rid].owner;
    return o === null ? NEUTRAL : nations[o].color;
  };
  const sel = selected !== null && selected !== undefined ? selected : null;

  return (
    <div className="mapwrap" style={{ height: '100%' }}>
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
        </defs>
        <rect x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3} fill="#8fb8cc" />
        <path d={statics.seaBorders} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="3 3" pointerEvents="none" />
        <path d={statics.land} fill={NEUTRAL} />
        <g clipPath={`url(#${clipId})`}>
          {world.regions.map((r) => r.sea ? null : (
            <path key={r.id} data-rid={r.id} d={statics.regionPath[r.id]} fill={color(r.id)} fillRule="evenodd" onClick={(e) => click(r.id, e)} style={{ cursor: 'pointer' }} />
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
            {sel !== null && !world.regions[sel].sea && <path d={statics.outline[sel]} fill="#ffffff22" fillRule="evenodd" stroke="#fff" strokeWidth={3} />}
          </g>
          <path d={statics.riverD} fill="none" stroke="#3f86b4" strokeWidth={s * 0.28} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
          <path d={statics.land} fill="none" stroke="#2c5468" strokeWidth={1.1} />
          {statics.glyph.cliff && (
            <>
              <path d={statics.glyph.cliff} fill="none" stroke="#fffdf6" strokeWidth={s * 0.3} strokeLinejoin="round" opacity={0.8} />
              <path d={statics.glyph.cliff} fill="none" stroke="#5a2d14" strokeWidth={s * 0.14} strokeLinejoin="round" />
            </>
          )}
          {(world.straitLines || []).map(([ax, ay, bx, by], k) => (
            <g key={'st' + k}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#15171b" strokeWidth={s * 0.42} strokeLinecap="round" opacity={0.6} />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#fffdf6" strokeWidth={s * 0.2} strokeDasharray={`${s * 0.35} ${s * 0.25}`} strokeLinecap="round" />
            </g>
          ))}
          {/* 나라마다 도읍 점과 이름 */}
          {nations
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
        <span className="zoom-lv" title="전체 지도 대비 확대 배율">×{(world.W / vb[2]).toFixed(1)}</span>
        <button onClick={() => zoom(1 / 1.5)}>＋</button>
        <button onClick={() => zoom(1.5)}>－</button>
        <button onClick={() => setVb(fitView())}>⤢</button>
      </div>
    </div>
  );
}
