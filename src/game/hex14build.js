// ───────── 삼국지14식 모드: 도시 시설 건설과 새 도시 세우기(축성) ─────────
import { fmtGold } from './format.js';
import { log, enemy } from './hex14.js';
import { hasPolicy } from './hex14policy.js';

// 도시 시설: 시장·농장(돈·병량, 유지비 없음), 성벽 증축, 조선소
export const BUILDINGS = {
  market: { name: '시장', icon: '🏪', cost: 12000, turns: 4, max: 2, desc: '이 도시 금 수입 +25%/단계', eco: true },
  farmland: { name: '농장', icon: '🌾', cost: 12000, turns: 4, max: 2, desc: '이 도시 수확 +25%/단계', eco: true },
  wall: { name: '성벽 증축', icon: '🧱', cost: 25000, turns: 6, max: 2, desc: '성벽 내구 +40%/단계' },
  shipyard: { name: '조선소', icon: '⛵', cost: 25000, turns: 6, max: 1, desc: '이 도시에서 나간 부대는 물 위에서도 약해지지 않음 (항구만)', port: true },
};
export const FOUND_COST = 50000, FOUND_TURNS = 9;

export const lv = (c, k) => c.bld?.[k] || 0;
export const slotsOf = (c) => (c.kind === 'pass' ? 2 : c.founding ? 0 : 4);
export const usedSlots = (c) => Object.values(c.bld || {}).reduce((a, b) => a + b, 0) + (c.build ? 1 : 0);

// 축성 장려 정책이면 30% 싸게
export const buildCost = (s, c, k) => Math.round(BUILDINGS[k].cost * (hasPolicy(s, c.owner, 'fortify') ? 0.7 : 1));

export function canBuild(s, c, k) {
  const b = BUILDINGS[k];
  if (!b) return '없는 시설입니다.';
  if (c.founding) return '아직 공사 중인 도시입니다.';
  if (c.kind === 'pass' && k !== 'wall') return '관문에는 성벽만 쌓을 수 있습니다.';
  if (b.port && !c.port) return '항구에만 지을 수 있습니다.';
  if (c.build) return `이미 ${BUILDINGS[c.build.type].name}을(를) 짓는 중입니다.`;
  if (lv(c, k) >= b.max) return '더 올릴 수 없습니다.';
  if (usedSlots(c) >= slotsOf(c)) return `건설 칸이 다 찼습니다 (${slotsOf(c)}칸).`;
  if (s.nations[c.owner].gold < buildCost(s, c, k)) return `금이 모자랍니다 (${fmtGold(buildCost(s, c, k))}).`;
  return null;
}

export function startBuild(s, cid, k) {
  const c = s.castles[cid];
  const why = canBuild(s, c, k);
  if (why) return { ok: false, msg: why };
  s.nations[c.owner].gold -= buildCost(s, c, k);
  c.build = { type: k, left: BUILDINGS[k].turns };
  return { ok: true, msg: `${c.name}: ${BUILDINGS[k].name} 공사 시작 (${BUILDINGS[k].turns}턴)` };
}

export function cancelBuild(s, cid) {
  const c = s.castles[cid];
  if (!c.build) return { ok: false, msg: '짓는 것이 없습니다.' };
  const back = Math.round(BUILDINGS[c.build.type].cost * 0.5);
  s.nations[c.owner].gold += back;
  c.build = null;
  return { ok: true, msg: `공사를 멈췄습니다 (금 ${fmtGold(back)} 돌려받음).` };
}

// 새 도시 자리: 내 땅, 지나갈 수 있는 칸, 다른 성과 4칸 이상 떨어짐
export const FOUND_GAP = 4;
export function foundCheck(s, grid, tile, nid) {
  if (tile < 0 || !grid.passable(tile)) return '도시를 세울 수 없는 땅입니다.';
  if (s.owner[tile] !== nid) return '내 땅에만 세울 수 있습니다.';
  const near = s.castles.find((c) => grid.dist(c.tile, tile) < FOUND_GAP);
  if (near) return `${near.name}과(와) 너무 가깝습니다 (${FOUND_GAP}칸 이상 떨어져야 함).`;
  if (s.units.some((u) => u.tile === tile)) return '부대가 서 있는 곳입니다.';
  if (s.nations[nid].gold < FOUND_COST) return `금이 모자랍니다 (${fmtGold(FOUND_COST)}).`;
  return null;
}

// 세울 수 있는 칸 모두 (금은 따지지 않음)
export function foundSpots(s, grid, nid) {
  const out = [];
  for (let t = 0; t < grid.N; t++) {
    if (!grid.passable(t) || s.owner[t] !== nid) continue;
    if (s.castles.some((c) => grid.dist(c.tile, t) < FOUND_GAP)) continue;
    out.push(t);
  }
  return out;
}

export function foundCity(s, grid, tile, nid, name) {
  const why = foundCheck(s, grid, tile, nid);
  if (why) return { ok: false, msg: why };
  s.nations[nid].gold -= FOUND_COST;
  const id = s.castles.length;
  const used = new Set(s.castles.map((c) => c.name));
  let nm = name || `${s.castles.reduce((a, c) => (grid.dist(c.tile, tile) < grid.dist(a.tile, tile) ? c : a)).name} 신성`;
  for (let k = 2; used.has(nm); k++) nm = `${name || '신성'} ${k}`;
  s.castles.push({ id, tile, region: grid.region[tile], name: nm, kind: 'city', owner: nid, troops: 500, dur: 300, maxDur: 1500, pop: 5, capital: false, bandit: null, port: grid.water.some((w, t) => w && grid.dist(t, tile) <= 3), devMax: 300, farm: 50, trade: 50, jobs: { farm: null, trade: null, draft: null }, auto: true, founding: FOUND_TURNS, bld: {} });
  log(s, `🏗️ ${s.nations[nid].name}이(가) ${nm}을(를) 세우기 시작했습니다 (${FOUND_TURNS}턴).`, 'info', [nid]);
  return { ok: true, msg: `${nm} 축성 시작! ${FOUND_TURNS}턴 뒤 완공됩니다.` };
}

// 한 턴마다: 공사 진행, 새 도시 완공 시 관할 다시 나눔
export function buildTurn(s, grid, redistrict) {
  let regrid = false;
  for (const c of s.castles) {
    if (c.owner === null) continue;
    if (c.founding) {
      c.founding -= 1;
      c.dur = Math.min(c.maxDur, c.dur + c.maxDur / FOUND_TURNS);
      if (c.founding <= 0) {
        delete c.founding;
        Object.assign(c, { pop: 20, devMax: 500, dur: c.maxDur });
        regrid = true;
        log(s, `🏯 ${c.name}이(가) 완공되었습니다!`, 'capture', [c.owner]);
      }
      continue;
    }
    if (!c.build) continue;
    c.build.left -= 1;
    if (c.build.left > 0) continue;
    const k = c.build.type;
    c.bld = { ...(c.bld || {}), [k]: lv(c, k) + 1 };
    c.build = null;
    if (k === 'wall') { const add = Math.round((c.kind === 'pass' ? 6000 : 3000) * 0.4); c.maxDur += add; c.dur += add; }
    log(s, `${BUILDINGS[k].icon} ${c.name}의 ${BUILDINGS[k].name}이(가) 완공되었습니다 (${lv(c, k)}단계).`, 'info', [c.owner]);
  }
  if (regrid) redistrict(s, grid);
}

// 컴퓨터: 금이 넉넉하면 위협받는 도시에 성벽, 아니면 시장·농장·조선소
export function aiBuild(s, grid, nid, threat, minGold = 40000) {
  const n = s.nations[nid];
  if (n.gold < minGold) return;
  const mine = s.castles.filter((c) => c.owner === nid && !c.build && !c.founding);
  for (const c of mine.sort((a, b) => threat(b) - threat(a))) {
    const order = threat(c) > 0 ? ['wall'] : ['market', 'farmland', 'shipyard'];
    for (const k of order) if (!canBuild(s, c, k)) { startBuild(s, c.id, k); return; }
  }
}

// ───────── 야전 시설: 부대가 그 칸에 멈춰 짓는 진지·망루·목책 ─────────
// 진지: 들어간 아군이 받는 피해 30% 줄고 보급 거점이 됨 · 망루: 2칸 안 적 부대를 매일 화살로 공격 · 목책: 적이 지나갈 수 없는 길막이
export const FORTS = {
  camp: { name: '진지', icon: '⛺', cost: 8000, days: 5, hp: 2500, desc: '안의 아군 피해 −30%, 보급 거점' },
  tower: { name: '망루', icon: '🗼', cost: 6000, days: 4, hp: 1800, desc: '2칸 안 적 부대를 매일 공격 (원군·출격 견제)' },
  palisade: { name: '목책', icon: '🚧', cost: 1500, days: 0, hp: 2000, desc: '바로 세움. 적이 못 지나가고, 옆에 온 적은 그날 멈춤 (여러 개로 길을 막기)' },
};
export const fortAt = (s, tile) => (s.forts || []).find((f) => f.tile === tile) || null;

export function fortCheck(s, grid, u, kind) {
  const f = FORTS[kind];
  if (!f) return '없는 시설입니다.';
  if (u.path?.length && kind !== 'palisade') return '멈춰 있는 부대만 지을 수 있습니다.';
  if (grid.water?.[u.tile] && kind !== 'palisade') return '물 위에는 목책만 세울 수 있습니다.';
  if (s.castles.some((c) => c.tile === u.tile)) return '성 칸에는 지을 수 없습니다.';
  if (fortAt(s, u.tile)) return '이미 시설이 있는 칸입니다.';
  if (s.castles.some((c) => grid.dist(c.tile, u.tile) <= 1)) return '성 바로 옆에는 지을 수 없습니다.';
  if (s.nations[u.nation].gold < f.cost) return `금이 모자랍니다 (${fmtGold(f.cost)}).`;
  return null;
}

// 부대(u)가 지금 선 칸에 공사 시작. 부대가 그 칸을 떠나면 공사가 멈춤 (builder가 null이면 성 수비대가 지음)
export function startFort(s, grid, u, kind, tile = u?.tile, nid = u?.nation) {
  if (u) { const why = fortCheck(s, grid, u, kind); if (why) return { ok: false, msg: why }; }
  const f = FORTS[kind];
  s.nations[nid].gold -= f.cost;
  s.nextFort = (s.nextFort || 0) + 1;
  s.forts = [...(s.forts || []), { id: s.nextFort, kind, tile, owner: nid, hp: f.hp, maxHp: f.hp, left: f.days, builder: u && f.days ? u.id : null }];
  return { ok: true, msg: f.days ? `${f.icon} ${f.name} 공사 시작 (${f.days}일, 부대가 그 자리에 있어야 함)` : `${f.icon} ${f.name}을(를) 세웠습니다` };
}

// 하루마다: 공사 진행, 망루 화살, 부서진 시설 정리
export function fortsDay(s, grid) {
  if (!s.forts?.length) return;
  for (const f of s.forts) {
    if (f.left > 0) {
      if (f.builder !== null) {
        const u = s.units.find((x) => x.id === f.builder);
        if (!u || u.tile !== f.tile) { f.dead = true; continue; } // 부대가 떠나면 공사 취소
        if (u.path.length) continue;
      }
      f.left -= 1;
      if (f.left <= 0) { f.left = 0; f.builder = null; log(s, `${FORTS[f.kind].icon} ${s.nations[f.owner]?.name}의 ${FORTS[f.kind].name}이(가) 완공되었습니다.`, 'info', [f.owner]); }
      continue;
    }
    if (f.kind === 'tower') {
      for (const u of s.units) {
        if (!enemy(s, f.owner, u.nation) || grid.dist(u.tile, f.tile) > 2) continue;
        const dmg = Math.round(250 + u.troops * 0.01);
        u.troops -= dmg;
        u.morale -= 2;
        s.fx.push({ type: 'hit', tile: u.tile, amt: dmg }, { type: 'arrow', a: f.tile, b: u.tile });
      }
    }
  }
  for (const f of s.forts) if (f.hp <= 0 && !f.dead) { f.dead = true; log(s, `💥 ${s.nations[f.owner]?.name}의 ${FORTS[f.kind].name}이(가) 부서졌습니다.`, 'battle', [f.owner]); }
  s.forts = s.forts.filter((f) => !f.dead);
}

// 컴퓨터: 위협받는 국경 도시 앞(적 쪽 2~3칸)에 망루나 진지를 성 수비대가 지음
export function aiForts(s, grid, nid, threat) {
  const n = s.nations[nid];
  if (n.gold < 30000 || (s.forts || []).filter((f) => f.owner === nid).length >= s.castles.filter((c) => c.owner === nid).length) return;
  const c = s.castles.filter((x) => x.owner === nid && threat(x) > 0).sort((a, b) => threat(b) - threat(a))[0];
  if (!c) return;
  const foe = s.units.filter((u) => enemy(s, nid, u.nation)).sort((a, b) => grid.dist(a.tile, c.tile) - grid.dist(b.tile, c.tile))[0];
  if (!foe) return;
  let best = null, bd = Infinity;
  // 성에서 2~3칸, 적에게 가장 가까운 내 땅 칸
  const seen = new Set([c.tile]);
  let ring = [c.tile];
  for (let r = 1; r <= 3; r++) {
    const next = [];
    for (const t of ring) for (const nx of grid.nb[t]) if (!seen.has(nx) && grid.passable(nx)) { seen.add(nx); next.push(nx); if (r >= 2 && s.owner[nx] === nid && !fortAt(s, nx) && !s.units.some((u) => u.tile === nx)) { const d = grid.dist(nx, foe.tile); if (d < bd) { bd = d; best = nx; } } }
    ring = next;
  }
  if (best === null) return;
  startFort(s, grid, null, threat(c) > c.troops ? 'tower' : 'camp', best, nid);
}
