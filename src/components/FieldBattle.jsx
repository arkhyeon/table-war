import { useEffect, useRef, useState } from 'react';

// ───────── 실시간 전장: 내 장수를 직접 움직이며(자동으로 베기 + 무쌍) 병사 무리에 명령을 내림 ─────────
// 병사 한 점 = 병사 여러 명. 공격력·체력에 battleFactors(공격 배율·수비 배율: 지형·성벽·장수·날씨)를 반영
const W = 1100, H = 700;
const TYPES = {
  inf: { name: '보병', hp: 10, dmg: 2.0, range: 14, speed: 64 },
  cav: { name: '기병', hp: 12, dmg: 2.4, range: 15, speed: 100 },
  arc: { name: '궁병', hp: 8, dmg: 1.2, range: 170, speed: 58 },
};
// 지형(rules.T): 1 평원 2 숲 3 구릉 4 사막 5 동토 6 산지
const GROUND = { 1: '#9bbf6a', 2: '#6e9a52', 3: '#b5a46a', 4: '#e0c98b', 5: '#dfe7ea', 6: '#9a8f80' };
const ROUGH = new Set([2, 6]);
const ORDERS = [
  ['charge', '⚔️ 돌격', '1'],
  ['follow', '🚩 따르라', '2'],
  ['hold', '🛡️ 대기', '3'],
  ['volley', '🏹 일제사격', '4'],
  ['retreat', '🏳️ 후퇴', '5'],
];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const has = (g, t) => (g?.traits || []).some(([x]) => x === t);

function makeSide(side, troops, per, hero, mult, terrain) {
  const n = Math.max(4, Math.min(90, Math.round(troops / per)));
  const rough = ROUGH.has(terrain);
  const cav = Math.round(n * Math.max(0.05, (rough ? 0.08 : 0.2) + (has(hero, '기마') ? 0.15 : 0)));
  const arc = Math.round(n * (0.25 + (has(hero, '궁술') ? 0.1 : 0)));
  const agents = [];
  for (let i = 0; i < n; i++) {
    const type = i < cav ? 'cav' : i < cav + arc ? 'arc' : 'inf';
    const col = Math.floor(i / 12), row = i % 12;
    const back = type === 'arc' ? 2 : type === 'cav' ? 0 : 1;
    const x = side === 0 ? 170 - back * 40 - col * 8 : W - 170 + back * 40 + col * 8;
    const y = H / 2 - 250 + row * 44 + (Math.random() - 0.5) * 14;
    const hp = TYPES[type].hp * (side === 1 ? mult.def : 1);
    agents.push({ side, type, x, y, hp, max: hp, cd: Math.random(), fled: false, charged: false });
  }
  return { n, agents };
}

function makeHero(g, side) {
  if (!g) return null;
  const hp = 120 + g.war * 1.2;
  return { name: g.name, war: g.war, x: side === 0 ? 120 : W - 120, y: H / 2, hp, max: hp, cd: 0, gauge: 0, down: false, side };
}

export function initBattle({ att, def, terrain, walls }) {
  const per = Math.max(120, Math.ceil(Math.max(att.troops, def.troops) / 90));
  const mult = { att: att.mult || 1, def: def.mult || 1 };
  const A = makeSide(0, att.troops, per, att.hero, mult, terrain);
  const D = makeSide(1, def.troops, per, def.hero, mult, terrain);
  return {
    t: 0, per, mult, terrain, walls, over: null, arrows: [], fx: [],
    agents: [...A.agents, ...D.agents], n: [A.n, D.n],
    heroes: [makeHero(att.hero, 0), makeHero(def.hero, 1)],
    order: 'charge', enemyOrder: 'hold', volleyCd: 0, morale: [100, 100], input: { x: 0, y: 0 }, skill: false,
  };
}

export const alive = (b, side) => b.agents.filter((a) => a.side === side && a.hp > 0 && !a.fled);

function nearestFoe(b, a, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const o of b.agents) {
    if (o.side === a.side || o.hp <= 0 || o.fled) continue;
    const d = Math.abs(o.x - a.x) + Math.abs(o.y - a.y);
    if (d < bd) { bd = d; best = o; }
  }
  const h = b.heroes[1 - a.side];
  if (h && !h.down) {
    const d = Math.abs(h.x - a.x) + Math.abs(h.y - a.y);
    if (d < bd) best = h;
  }
  return best;
}

function hurt(b, target, dmg, side) {
  if (target.war !== undefined) {
    // 장수: 갑옷이 있어 덜 다침
    target.hp -= dmg * 0.45;
    if (target.hp <= 0 && !target.down) {
      target.down = true;
      b.fx.push({ x: target.x, y: target.y, t: 1.6, text: `${target.name} 쓰러짐!` });
    }
    return;
  }
  target.hp -= dmg * (side === 0 ? b.mult.att : 1);
  if (target.hp <= 0) {
    const h = b.heroes[side];
    if (h && !h.down) h.gauge = Math.min(100, h.gauge + 4);
  }
}

// 한 걸음 (dt초)
export function stepBattle(b, dt) {
  if (b.over) return;
  b.t += dt;
  const ordersOf = (side) => (side === 0 ? b.order : b.enemyOrder);
  // 적: 처음엔 진을 지키다 아군이 다가오면 돌격
  const near = alive(b, 0).some((a) => a.x > W * 0.55) || (b.heroes[0] && !b.heroes[0].down && b.heroes[0].x > W * 0.55);
  if (b.enemyOrder === 'hold' && (near || b.t > 12)) b.enemyOrder = 'charge';
  // 사기: 남은 병사 비율, 장수가 쓰러지면 크게 꺾임
  for (const side of [0, 1]) {
    const left = alive(b, side).length / b.n[side];
    const h = b.heroes[side];
    b.morale[side] = Math.max(0, 100 * Math.pow(left, 0.7) - (h && h.down ? 30 : 0));
  }
  // 병사
  for (const a of b.agents) {
    if (a.hp <= 0 || a.fled) continue;
    const T = TYPES[a.type];
    a.cd -= dt;
    if (b.morale[a.side] < 18) {
      // 패주: 자기 진영 끝으로 달아남
      a.x += (a.side === 0 ? -1 : 1) * T.speed * 1.2 * dt;
      if (a.x < -20 || a.x > W + 20) a.fled = true;
      continue;
    }
    const ord = ordersOf(a.side);
    const foe = nearestFoe(b, a, ord === 'hold' && a.type !== 'arc' ? 140 : Infinity);
    let gx = a.x, gy = a.y;
    if (ord === 'follow' && a.side === 0 && b.heroes[0] && !b.heroes[0].down) {
      const h = b.heroes[0];
      const i = b.agents.indexOf(a) % 24;
      gx = h.x - 40 - (i % 4) * 16;
      gy = h.y - 90 + Math.floor(i / 4) * 32;
    }
    if (foe) {
      const d = dist(a, foe);
      if (d <= T.range) {
        if (a.cd <= 0) {
          let dmg = T.dmg;
          if (a.type === 'cav' && !a.charged) { dmg *= 2.2; a.charged = true; } // 기병 첫 돌격
          if (a.type === 'arc') b.arrows.push({ x: a.x, y: a.y, tx: foe.x, ty: foe.y, t: 0.35 });
          hurt(b, foe, dmg, a.side);
          a.cd = 1;
        }
        gx = a.x; gy = a.y;
      } else if (ord !== 'hold' && !(ord === 'follow' && a.side === 0 && d > 160)) {
        gx = foe.x; gy = foe.y;
        if (a.type === 'arc' && d < T.range * 1.3) { gx = a.x; gy = a.y; }
      }
    }
    const dx = gx - a.x, dy = gy - a.y, L = Math.hypot(dx, dy);
    if (L > 2) {
      // 맞붙기 전엔 대열을 맞춰 보병 걸음으로 (기병만 먼저 달려가 녹지 않게), 가까워지면 제 속도로 돌격
      const close = foe && dist(a, foe) < 200;
      const sp = (close ? T.speed : Math.min(T.speed, TYPES.inf.speed)) * (ROUGH.has(b.terrain) ? 0.8 : 1);
      a.x += (dx / L) * Math.min(L, sp * dt);
      a.y += (dy / L) * Math.min(L, sp * dt);
    }
  }
  // 같은 편끼리 겹치지 않게 살짝 밀어냄
  const live = b.agents.filter((a) => a.hp > 0 && !a.fled);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const p = live[i], q = live[j];
    const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 < 100) { const d = Math.sqrt(d2), k = (10 - d) / 2 / d; p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k; }
  }
  for (const a of live) a.y = Math.max(20, Math.min(H - 20, a.y));
  // 일제사격: 궁병 모두가 한 번 더 쏨 (8초에 한 번)
  b.volleyCd = Math.max(0, b.volleyCd - dt);
  if (b.order === 'volley') {
    if (b.volleyCd <= 0) {
      for (const a of alive(b, 0)) if (a.type === 'arc') { const f = nearestFoe(b, a, 260); if (f) { hurt(b, f, TYPES.arc.dmg * 2, 0); b.arrows.push({ x: a.x, y: a.y, tx: f.x, ty: f.y, t: 0.4 }); } }
      b.volleyCd = 8;
      b.fx.push({ x: W * 0.3, y: 40, t: 1, text: '🏹 일제사격!' });
    }
    b.order = b.prevOrder || 'charge';
  }
  // 장수
  for (const h of b.heroes) {
    if (!h || h.down) continue;
    h.cd -= dt;
    let mx = 0, my = 0;
    if (h.side === 0 && !b.autoHero) { mx = b.input.x; my = b.input.y; }
    else {
      // 컴퓨터 장수(적장, 자동 진행 때는 내 장수도): 상대 장수가 가까우면 맞서고, 아니면 가까운 적병을 침
      const me = b.heroes[1 - h.side];
      const tg = me && !me.down && dist(me, h) < 180 ? me : nearestFoe(b, h, 150);
      if (tg) { const d = dist(tg, h); if (d > 30) { mx = (tg.x - h.x) / d; my = (tg.y - h.y) / d; } }
      else if ((h.side === 1 ? b.enemyOrder : b.order) === 'charge') { const fr = alive(b, h.side); if (fr.length) { const cx = fr.reduce((s, a) => s + a.x, 0) / fr.length; mx = cx + (h.side === 1 ? 60 : -60) - h.x > 0 ? 0.6 : -0.6; } }
      if (h.gauge >= 100) { if (h.side === 1) b.enemySkill = true; else b.skill = true; }
    }
    const L = Math.hypot(mx, my);
    if (L > 0.05) { h.x += (mx / Math.max(1, L)) * 130 * dt; h.y += (my / Math.max(1, L)) * 130 * dt; }
    h.x = Math.max(15, Math.min(W - 15, h.x)); h.y = Math.max(20, Math.min(H - 20, h.y));
    // 자동 베기: 가까운 적 둘까지 (장수 혼자 군대를 쓸어버리지 않게)
    if (h.cd <= 0) {
      const targets = b.agents.filter((o) => o.side !== h.side && o.hp > 0 && !o.fled && dist(o, h) < 38).slice(0, 2);
      const eh = b.heroes[1 - h.side];
      if (eh && !eh.down && dist(eh, h) < 38) targets.push(eh);
      if (targets.length) {
        for (const o of targets) hurt(b, o, 4 + h.war / 20, h.side);
        b.fx.push({ x: h.x, y: h.y, t: 0.18, ring: 38 });
        h.cd = 0.55;
      }
    }
    // 무쌍: 둘레 120 안의 적을 크게 벰
    const use = h.side === 0 ? b.skill : b.enemySkill;
    if (use && h.gauge >= 100) {
      for (const o of b.agents) if (o.side !== h.side && o.hp > 0 && !o.fled && dist(o, h) < 120) hurt(b, o, 14, h.side);
      const eh = b.heroes[1 - h.side];
      if (eh && !eh.down && dist(eh, h) < 120) hurt(b, eh, 40, h.side);
      h.gauge = 0;
      b.fx.push({ x: h.x, y: h.y, t: 0.5, ring: 120, big: true }, { x: h.x, y: h.y - 30, t: 1.2, text: `${h.name} 무쌍!` });
    }
    if (h.side === 0) b.skill = false; else b.enemySkill = false;
  }
  for (const r of b.arrows) r.t -= dt;
  b.arrows = b.arrows.filter((r) => r.t > 0);
  for (const f of b.fx) f.t -= dt;
  b.fx = b.fx.filter((f) => f.t > 0);
  // 끝: 한쪽이 무너지거나(사기·병사) 시간이 다 되면
  const a0 = alive(b, 0).length, a1 = alive(b, 1).length;
  const gone0 = a0 === 0 && (!b.heroes[0] || b.heroes[0].down), gone1 = a1 === 0 && (!b.heroes[1] || b.heroes[1].down);
  if (gone1 || (b.morale[1] < 18 && a1 <= b.n[1] * 0.35)) b.over = 'win';
  else if (gone0 || (b.morale[0] < 18 && a0 <= b.n[0] * 0.35)) b.over = 'lose';
  else if (b.t > 150) b.over = a0 * b.mult.att > a1 * b.mult.def * 1.2 ? 'win' : 'lose';
}

export function battleResult(b, att, def, retreat = false) {
  const left = (side) => {
    const ag = b.agents.filter((a) => a.side === side);
    const ok = ag.filter((a) => a.hp > 0 && !a.fled).length + ag.filter((a) => a.fled).length * 0.7;
    return ok / Math.max(1, b.n[side]);
  };
  return {
    win: !retreat && b.over === 'win',
    retreat,
    attLeft: Math.round((att.troops * left(0) * (retreat ? 0.9 : 1)) / 100) * 100,
    defLeft: Math.round((def.troops * left(1)) / 100) * 100,
    heroDown: !!b.heroes[0]?.down,
    enemyHeroDown: !!b.heroes[1]?.down,
  };
}

export default function FieldBattle({ att, def, terrain, walls, onFinish }) {
  const canvas = useRef(null);
  const wrap = useRef(null);
  const sim = useRef(null);
  const [hud, setHud] = useState(null);
  const [order, setOrder] = useState('charge');
  const keys = useRef({});
  const joy = useRef(null);
  if (!sim.current) sim.current = initBattle({ att, def, terrain, walls });

  const command = (o) => {
    const b = sim.current;
    if (b.over) return;
    if (o === 'retreat') { b.over = 'retreat'; return; }
    if (o === 'volley') { if (b.volleyCd > 0) return; b.prevOrder = b.order; }
    b.order = o;
    if (o !== 'volley') setOrder(o);
  };
  const skill = () => { sim.current.skill = true; };
  const autoFinish = () => {
    const b = sim.current;
    b.autoHero = true; // 남은 전투는 내 장수도 알아서 싸움
    for (let i = 0; i < 6000 && !b.over; i++) stepBattle(b, 0.05);
  };

  useEffect(() => {
    const down = (e) => {
      keys.current[e.key.toLowerCase()] = true;
      const o = ORDERS.find((x) => x[2] === e.key);
      if (o) command(o[0]);
      if (e.key === ' ') { e.preventDefault(); skill(); }
    };
    const up = (e) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let raf, last = performance.now(), hudT = 0, ended = false;
    const loop = (now) => {
      const b = sim.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // 입력: 키보드(WASD·방향키) 또는 조이스틱
      const k = keys.current;
      let ix = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0), iy = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0);
      if (joy.current?.v) { ix = joy.current.v[0]; iy = joy.current.v[1]; }
      b.input = { x: ix, y: iy };
      stepBattle(b, dt);
      draw(b);
      hudT -= dt;
      if (hudT <= 0 || b.over) {
        hudT = 0.2;
        const h = b.heroes[0], e = b.heroes[1];
        setHud({ a0: alive(b, 0).length, a1: alive(b, 1).length, m: b.morale.map(Math.round), hp: h ? Math.max(0, h.hp / h.max) : 0, gauge: h ? h.gauge : 0, down: h?.down, ehp: e ? Math.max(0, e.hp / e.max) : null, t: Math.max(0, 150 - b.t), over: b.over, volley: b.volleyCd });
      }
      if (b.over && !ended) {
        ended = true;
        setTimeout(() => onFinish(battleResult(b, att, def, b.over === 'retreat')), 1400);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = (b) => {
    const cv = canvas.current, el = wrap.current;
    if (!cv || !el) return;
    const cw = el.clientWidth, ch = el.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== cw * dpr || cv.height !== ch * dpr) { cv.width = cw * dpr; cv.height = ch * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 화면을 꽉 채우고(빈 곳 없이) 내 장수를 따라감
    const sc = Math.max(cw / W, ch / H);
    const h0 = b.heroes[0];
    const fx = h0 && !h0.down ? h0.x : (alive(b, 0)[0]?.x ?? W / 2);
    const camX = Math.max(0, Math.min(Math.max(0, W - cw / sc), fx - cw / sc / 2));
    const camY = Math.max(0, Math.min(Math.max(0, H - ch / sc), (h0?.y ?? H / 2) - ch / sc / 2));
    ctx.fillStyle = '#20232a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(sc, sc);
    ctx.translate(-camX, -camY);
    ctx.fillStyle = GROUND[b.terrain] || GROUND[1];
    ctx.fillRect(0, 0, W, H);
    // 지형 무늬
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 70; i++) { const x = (i * 197) % W, y = (i * 113) % H; if (b.terrain === 2) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); } else ctx.fillRect(x, y, 14, 3); }
    if (b.walls) { ctx.fillStyle = '#7a6a55'; ctx.fillRect(W - 250, 0, 14, H); ctx.fillStyle = '#5a4a38'; for (let y = 0; y < H; y += 40) ctx.fillRect(W - 254, y, 22, 16); }
    // 화살
    ctx.strokeStyle = 'rgba(40,30,20,0.8)';
    ctx.lineWidth = 1.5;
    for (const r of b.arrows) { const k = 1 - r.t / 0.4; ctx.beginPath(); ctx.moveTo(r.x + (r.tx - r.x) * k, r.y + (r.ty - r.y) * k); ctx.lineTo(r.x + (r.tx - r.x) * Math.min(1, k + 0.15), r.y + (r.ty - r.y) * Math.min(1, k + 0.15)); ctx.stroke(); }
    // 병사: 보병 ●, 기병 ▶, 궁병 ■
    for (const a of b.agents) {
      if (a.hp <= 0) { ctx.fillStyle = 'rgba(80,20,20,0.25)'; ctx.fillRect(a.x - 2, a.y - 1, 4, 2); continue; }
      if (a.fled) continue;
      ctx.fillStyle = a.side === 0 ? att.color : def.color;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const f = a.side === 0 ? 1 : -1;
      if (a.type === 'cav') { ctx.moveTo(a.x + 8 * f, a.y); ctx.lineTo(a.x - 6 * f, a.y - 6); ctx.lineTo(a.x - 6 * f, a.y + 6); ctx.closePath(); }
      else if (a.type === 'arc') ctx.rect(a.x - 4, a.y - 4, 8, 8);
      else ctx.arc(a.x, a.y, 5.5, 0, 7);
      ctx.fill();
      ctx.stroke();
      if (a.hp < a.max) { ctx.fillStyle = '#c33'; ctx.fillRect(a.x - 5, a.y - 9, 10 * (a.hp / a.max), 2); }
    }
    // 장수
    for (const h of b.heroes) {
      if (!h) continue;
      ctx.globalAlpha = h.down ? 0.35 : 1;
      ctx.fillStyle = h.side === 0 ? att.color : def.color;
      ctx.strokeStyle = h.side === 0 ? '#ffe066' : '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, h.y, 13, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeText(h.name, h.x, h.y - 20); ctx.fillText(h.name, h.x, h.y - 20);
      ctx.fillStyle = '#300'; ctx.fillRect(h.x - 18, h.y + 17, 36, 4); ctx.fillStyle = '#f44'; ctx.fillRect(h.x - 18, h.y + 17, 36 * Math.max(0, h.hp / h.max), 4);
      ctx.globalAlpha = 1;
    }
    for (const f of b.fx) {
      if (f.ring) { ctx.strokeStyle = f.big ? 'rgba(255,200,60,0.8)' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = f.big ? 5 : 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.ring * (f.big ? 1.2 - f.t : 1), 0, 7); ctx.stroke(); }
      if (f.text) { ctx.fillStyle = '#ffe066'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.strokeText(f.text, f.x, f.y - (1.6 - f.t) * 20); ctx.fillText(f.text, f.x, f.y - (1.6 - f.t) * 20); }
    }
    ctx.restore();
  };

  // 폰: 화면 왼쪽을 누르고 끄는 가상 조이스틱
  const onTouch = (e) => {
    const el = wrap.current.getBoundingClientRect();
    if (e.type === 'pointerdown') {
      if (e.clientX - el.left > el.width * 0.55) return;
      joy.current = { id: e.pointerId, o: [e.clientX, e.clientY], v: [0, 0] };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else if (e.type === 'pointermove' && joy.current?.id === e.pointerId) {
      const dx = e.clientX - joy.current.o[0], dy = e.clientY - joy.current.o[1], L = Math.hypot(dx, dy);
      joy.current.v = L < 6 ? [0, 0] : [(dx / L) * Math.min(1, L / 50), (dy / L) * Math.min(1, L / 50)];
      joy.current.p = [e.clientX, e.clientY];
    } else if ((e.type === 'pointerup' || e.type === 'pointercancel') && joy.current?.id === e.pointerId) joy.current = null;
  };

  const bar = (v, col) => (
    <span style={{ display: 'inline-block', width: 70, height: 7, background: '#0006', borderRadius: 4, verticalAlign: 'middle', marginLeft: 4 }}>
      <span style={{ display: 'block', width: `${Math.max(0, Math.min(100, v))}%`, height: '100%', background: col, borderRadius: 4 }} />
    </span>
  );
  const men = (side, n) => `${Math.round((n * (side === 0 ? att.troops : def.troops)) / Math.max(1, sim.current.n[side]) / 100) / 10}천`;
  const j = joy.current;
  const rect = wrap.current?.getBoundingClientRect();
  return (
    <div className="field-bg">
      <div className="field-top">
        <span><span className="chip" style={{ background: att.color }} /> <b>{att.name}</b> {hud ? men(0, hud.a0) : ''} 사기{bar(hud?.m[0] ?? 100, '#7bd88f')}</span>
        <span className="muted">⏱ {hud ? Math.ceil(hud.t) : 150}</span>
        <span>사기{bar(hud?.m[1] ?? 100, '#ff8a7a')} {hud ? men(1, hud.a1) : ''} <b>{def.name}</b> <span className="chip" style={{ background: def.color }} /></span>
      </div>
      <div className="field-map" ref={wrap} onPointerDown={onTouch} onPointerMove={onTouch} onPointerUp={onTouch} onPointerCancel={onTouch}>
        <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
        {j && j.p && rect && (
          <div className="joy" style={{ left: j.o[0] - rect.left - 45, top: j.o[1] - rect.top - 45 }}>
            <div className="joy-k" style={{ transform: `translate(${j.v[0] * 30}px, ${j.v[1] * 30}px)` }} />
          </div>
        )}
        {hud?.over && <div className="field-over">{hud.over === 'win' ? '🏆 승리!' : hud.over === 'retreat' ? '🏳️ 후퇴' : '💀 패배'}</div>}
        <div className="field-hint muted">PC: WASD·방향키 이동, 가까운 적은 자동으로 벰 · Space 무쌍 · 1~5 명령 &nbsp;|&nbsp; 폰: 화면 왼쪽을 끌어 이동</div>
      </div>
      <div className="field-bottom">
        <div className="field-hero">
          <b>{att.hero?.name}</b> {hud?.down ? <span style={{ color: 'var(--danger)' }}>쓰러짐</span> : <>체력{bar((hud?.hp ?? 1) * 100, '#f55')}</>}
          {def.hero && <small className="muted"> · 적장 {def.hero.name} {hud?.ehp != null ? `${Math.round(hud.ehp * 100)}%` : ''}</small>}
        </div>
        <div className="field-btns">
          {ORDERS.map(([k, label, key]) => (
            <button key={k} className={'sm' + (order === k ? ' primary' : '')} disabled={k === 'volley' && hud?.volley > 0} onClick={() => command(k)} title={`단축키 ${key}`}>
              {label}{k === 'volley' && hud?.volley > 0 ? ` ${Math.ceil(hud.volley)}` : ''}
            </button>
          ))}
          <button className={'musou' + ((hud?.gauge ?? 0) >= 100 ? ' ready' : '')} disabled={(hud?.gauge ?? 0) < 100 || hud?.down} onClick={skill}>
            무쌍 {Math.round(hud?.gauge ?? 0)}%
          </button>
          <button className="sm" onClick={autoFinish} title="남은 전투를 바로 계산">⏩ 자동으로 끝내기</button>
        </div>
      </div>
    </div>
  );
}
