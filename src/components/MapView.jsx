import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TERRAIN } from '../game/rules.js';
import { WEATHER } from '../game/weather.js';

const NEUTRAL = '#b9b2a0';

export default function MapView({ world, regions, nations, selected, targets, onClick, onContext, genCount, compact, battles, fmt = (n) => n, view, showTroops, weather, cutSet, focus }) {
  const clipId = 'land' + useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [vb, setVb] = useState([0, 0, world.W, world.H]);
  const drag = useRef(null);

  useEffect(() => setVb([0, 0, world.W, world.H]), [world]);
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
  const zoomed = vb[2] < world.W * 0.55;
  const viewOf = (rid) => (view ? view(rid) : 'visible');
  const fogKey = view ? world.regions.map((r) => viewOf(r.id)[0]).join('') : '';
  const fog = useMemo(() => {
    let hidden = '', dim = '';
    if (!view) return { hidden, dim };
    world.regions.forEach((r, i) => {
      const v = fogKey[i];
      if (v === 'h') hidden += world.paths.regionPath[i];
      else if (v === 'k') dim += world.paths.regionPath[i];
    });
    return { hidden, dim };
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
            <path d={statics.glyph.hills} fill="none" stroke="#5b4422" strokeWidth={s * 0.12} opacity={0.5} />
            <path d={statics.glyph.desert} fill="none" stroke="#8a6a2a" strokeWidth={s * 0.18} strokeLinecap="round" opacity={0.6} />
            <path d={statics.glyph.mountain} fill="#5b4632" opacity={0.55} />
            <path d={statics.peaks} fill={TERRAIN[7].color} fillRule="evenodd" />
            <path d={statics.glyph.peakCap} fill="#ece8df" opacity={0.85} />
            <path d={statics.borders} fill="none" stroke="#00000045" strokeWidth={0.7} />
            <path d={nationBorder} fill="none" stroke="#1b1b1b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={fog.dim} fill="#1b1d22" opacity={0.22} fillRule="evenodd" />
            <path d={fog.hidden} fill="#3a3c40" fillRule="evenodd" />
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
          {arrows}
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
              const col = own === null ? '#666' : nations[own].color;
              const t = !showTroops || showTroops(r.id) ? fmt(reg.troops) : '?';
              const fs = s * 0.8;
              const bw = Math.max(s * 1.9, String(t).length * fs * 0.62 + s * 0.6);
              const rebel = visible && reg.loyalty !== undefined && reg.owner !== null && reg.loyalty < 30;
              const wx = weather ? WEATHER[weather[r.id]] : null;
              const cut = cutSet?.has(r.id);
              const gc = visible ? genCount?.[r.id] || 0 : 0;
              const b = reg.buildings;
              const icons = (b.walls ? `🏰${b.walls < 3 ? b.walls : ''}` : '') + (b.market ? '💰' : '') + (b.port ? '⚓' : '') + (b.barracks ? '⚔️' : '');
              return (
                <g key={r.id} transform={`translate(${r.cx},${r.cy})`}>
                  <rect x={-bw / 2} y={-s * 0.8} width={bw} height={s * 1.6} rx={s * 0.8} fill="#fffdf6" stroke={col} strokeWidth={s * 0.22} />
                  {wx && wx.icon && (
                    <text x={-bw / 2 - s * 0.1} dy={-s * 0.75} fontSize={s * 0.75} textAnchor="middle">
                      {wx.icon}
                    </text>
                  )}
                  {cut && (
                    <text x={bw / 2 + s * 0.2} dy={s * 1.3} fontSize={s * 0.75} textAnchor="middle" fill="#ff9a3c" stroke="#000" strokeWidth={0.3} fontWeight="700">
                      ✂
                    </text>
                  )}
                  {rebel && <circle cx={bw / 2} cy={-s * 0.7} r={s * 0.35} fill="#e2655a" stroke="#000" strokeWidth={0.4} />}
                  <text textAnchor="middle" dy={fs * 0.36} fontSize={fs} fontWeight="700" fill="#222">
                    {t}
                  </text>
                  {capitals.has(r.id) && (
                    <text x={-bw / 2 - s * 0.6} dy={s * 0.35} fontSize={s * 1.05} textAnchor="middle" fill="#ffd34d" stroke="#000" strokeWidth={0.4}>
                      ♛
                    </text>
                  )}
                  {gc > 0 && (
                    <text x={bw / 2 + s * 0.55} dy={s * 0.3} fontSize={s * 0.8} textAnchor="middle" fill="#ffe066" stroke="#000" strokeWidth={0.35} fontWeight="700">
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
