import { useEffect, useMemo, useRef, useState } from 'react';
import { TERRAIN } from '../game/rules.js';

const NEUTRAL = '#b9b2a0';

export default function MapView({ world, regions, nations, selected, targets, onClick, onContext, genCount, compact }) {
  const svgRef = useRef(null);
  const [vb, setVb] = useState([0, 0, world.W, world.H]);
  const drag = useRef(null);

  useEffect(() => setVb([0, 0, world.W, world.H]), [world]);

  // 정적 레이어
  const statics = useMemo(() => {
    const { paths, rivers } = world;
    const riverD = rivers.map((r) => 'M' + r.pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')).join('');
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

  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
  };
  const onPointerMove = (e) => {
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
  const onPointerUp = () => {
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

  const s = world.size;
  const zoomed = vb[2] < world.W * 0.55;
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
    <div className="mapwrap" style={{ height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={vb.join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={-world.W} y={-world.H} width={world.W * 3} height={world.H * 3} fill="#8fb8cc" />
        <g>
          {world.regions.map((r) => (
            <path
              key={r.id}
              d={statics.regionPath[r.id]}
              fill={color(r.id)}
              stroke={color(r.id)}
              strokeWidth={0.8}
              onClick={(e) => click(r.id, e)}
              onContextMenu={(e) => context(r.id, e)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </g>
        <g pointerEvents="none">
          <path d={statics.glyph.tundra} fill="#ffffff" opacity={0.35} />
          <path d={statics.glyph.forest} fill="#1f5a2a" opacity={0.35} />
          <path d={statics.glyph.hills} fill="none" stroke="#5b4422" strokeWidth={s * 0.12} opacity={0.5} />
          <path d={statics.glyph.desert} fill="none" stroke="#8a6a2a" strokeWidth={s * 0.18} strokeLinecap="round" opacity={0.6} />
          <path d={statics.glyph.mountain} fill="#5b4632" opacity={0.55} />
          <path d={statics.peaks} fill={TERRAIN[7].color} />
          <path d={statics.glyph.peakCap} fill="#ece8df" opacity={0.85} />
          <path d={statics.riverD} fill="none" stroke="#3f86b4" strokeWidth={s * 0.28} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
          <path d={statics.borders} fill="none" stroke="#00000055" strokeWidth={0.7} />
          <path d={nationBorder} fill="none" stroke="#1b1b1b" strokeWidth={2.2} strokeLinecap="round" />
          <path d={statics.coast} fill="none" stroke="#2c5468" strokeWidth={1.2} />
          {seaLines}
          {targets &&
            [...targets.entries()].map(([rid, kind]) => (
              <path
                key={rid}
                d={statics.outline[rid]}
                fill="none"
                stroke={kind === 'attack' ? '#ff5544' : kind === 'blocked' ? '#888' : '#ffe066'}
                strokeWidth={2.4}
                strokeDasharray={kind === 'blocked' ? '3 3' : undefined}
              />
            ))}
          {selected !== null && selected !== undefined && <path d={statics.outline[selected]} fill="none" stroke="#fff" strokeWidth={3} />}
          {!compact &&
            world.regions.map((r) => {
              const reg = regions[r.id];
              const own = reg.owner;
              const col = own === null ? '#666' : nations[own].color;
              const t = reg.troops;
              const fs = t >= 100 ? s * 0.75 : s * 0.9;
              const gc = genCount?.[r.id] || 0;
              const b = reg.buildings;
              const icons = (b.walls ? '🏰' : '') + (b.market ? '💰' : '') + (b.port ? '⚓' : '') + (b.barracks ? '⚔️' : '');
              return (
                <g key={r.id} transform={`translate(${r.cx},${r.cy})`}>
                  <circle r={s * 0.95} fill="#fffdf6" stroke={col} strokeWidth={s * 0.22} />
                  <text textAnchor="middle" dy={fs * 0.36} fontSize={fs} fontWeight="700" fill="#222">
                    {t}
                  </text>
                  {capitals.has(r.id) && (
                    <text x={-s * 1.55} dy={s * 0.35} fontSize={s * 1.05} textAnchor="middle" fill="#ffd34d" stroke="#000" strokeWidth={0.4}>
                      ♛
                    </text>
                  )}
                  {gc > 0 && (
                    <text x={s * 1.5} dy={s * 0.3} fontSize={s * 0.8} textAnchor="middle" fill="#ffe066" stroke="#000" strokeWidth={0.35} fontWeight="700">
                      ★{gc > 1 ? gc : ''}
                    </text>
                  )}
                  {icons && (
                    <text dy={s * 1.85} fontSize={s * 0.6} textAnchor="middle">
                      {icons}
                    </text>
                  )}
                  {zoomed && (
                    <text dy={-s * 1.25} fontSize={s * 0.62} textAnchor="middle" fill="#111" stroke="#fffdf6" strokeWidth={s * 0.18} paintOrder="stroke">
                      {reg.name}
                    </text>
                  )}
                </g>
              );
            })}
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
        <button onClick={() => setVb([0, 0, world.W, world.H])}>⤢</button>
      </div>
    </div>
  );
}
