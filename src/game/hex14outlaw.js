// ───────── 삼국지14식 모드: 도적·산적·비적·해적 — 아무 데서나 무리가 일어나 근처 성·부대를 들이받음 ─────────
// 모두 하나의 「도적」 세력(나라 목록·외교·통일 계산에서는 빠짐)으로 묶음. 성을 깨면 차지하지 않고 약탈하고 떠남
import { T } from './rules.js';
import { order, log, gensOf } from './hex14.js';
import { fmtTroops, fmtGold } from './format.js';

export const OUTLAW_KINDS = {
  도적: { mark: '도', desc: '들판의 도적 떼' },
  산적: { mark: '산', desc: '산·숲에 숨어 사는 산적' },
  비적: { mark: '비', desc: '사막·초원·변경을 떠도는 비적' },
  해적: { mark: '해', desc: '바다에서 해안을 터는 해적' },
};
const BOSS = ['흑풍', '적미', '황건', '청룡', '독안', '철퇴', '야차', '귀면', '비호', '흑룡', '백랑', '혈수', '광풍', '철갑', '살귀', '흑호'];

// 도적 세력 (없으면 만듦)
export function outlawId(s) {
  if (s.outlawId !== undefined && s.nations[s.outlawId]) return s.outlawId;
  const id = s.nations.length;
  s.nations.push({ id, name: '도적', color: '#4a4a4a', alive: true, horde: true, outlaw: true, gold: 0, food: 1e12, policies: [], isPlayer: false });
  s.outlawId = id;
  return id;
}
export const isOutlaw = (s, nid) => nid !== null && nid !== undefined && !!s.nations[nid]?.outlaw;

const kindOf = (grid, t) => {
  if (grid.sea?.[t]) return '해적';
  const tr = grid.terrain[t];
  if (tr === T.MOUNTAIN || tr === T.HILLS || tr === T.FOREST) return '산적';
  if (tr === T.DESERT || tr === T.TUNDRA) return '비적';
  return '도적';
};

// 순마다: 새 무리가 일어나고, 오래된 무리·잔당은 흩어짐
export function outlawTurn(s, grid, rng) {
  const oid = outlawId(s);
  for (const u of s.units) {
    if (u.nation !== oid) continue;
    u.life = (u.life ?? 6) - 1;
    if (u.life <= 0 || u.troops < 1000) {
      u.dead = true;
      for (const g of gensOf(s, u.gens)) { g.status = 'gone'; g.unit = null; }
    }
  }
  s.units = s.units.filter((u) => !u.dead);
  const cities = s.castles.filter((c) => c.kind !== 'pass');
  const cap = Math.max(3, Math.round(cities.length / 8));
  const tries = Math.max(1, Math.ceil(cities.length / 40));
  for (let i = 0; i < tries; i++) if (!spawnOne(s, grid, rng, oid, cities, cap)) break;
}

function spawnOne(s, grid, rng, oid, cities, cap) {
  const have = s.units.filter((u) => u.nation === oid).length;
  if (have >= cap || rng() > 0.6) return false;
  // 일어날 곳: 성에서 3~8칸 떨어진 빈 칸 (해적은 얕은 바다)
  const owned = cities.filter((c) => c.owner !== null && c.owner >= 0 && !isOutlaw(s, c.owner));
  if (!owned.length) return false;
  const near = owned[Math.floor(rng() * owned.length)];
  const sea = rng() < 0.22;
  // 그 성 둘레 3~8칸에서 고름
  const ring = [];
  { const seen = new Set([near.tile]); let q = [near.tile];
    for (let d = 1; d <= 8 && q.length; d++) { const nx = []; for (const t of q) for (const n of grid.nb[t]) if (!seen.has(n)) { seen.add(n); nx.push(n); if (d >= 3) ring.push(n); } q = nx; } }
  let spot = -1;
  for (let k = 0; k < 40 && spot < 0 && ring.length; k++) {
    const t = ring[Math.floor(rng() * ring.length)];
    if (sea ? !grid.water?.[t] : !grid.passable(t)) continue;
    if (s.units.some((u) => u.tile === t) || s.castles.some((c) => grid.dist(c.tile, t) < 3)) continue;
    spot = t;
  }
  if (spot < 0) return false;
  const kind = kindOf(grid, spot);
  const avg = owned.reduce((a, c) => a + c.troops, 0) / owned.length;
  const troops = Math.round(Math.max(4000, Math.min(20000, avg * (0.6 + rng() * 0.6))) / 1000) * 1000; // 꽤 아프게
  const gid = `out_${s.turn}_${spot}`;
  const name = `${kind} 두목 ${BOSS[Math.floor(rng() * BOSS.length)]}`;
  s.generals[gid] = { id: gid, name, war: 68 + Math.floor(rng() * 20), lead: 55 + Math.floor(rng() * 20), intel: 20 + Math.floor(rng() * 20), pol: 10 + Math.floor(rng() * 15), traits: [['맹장', 1]], nation: oid, castle: null, unit: null, status: 'active' };
  const uid = s.nextUnit++;
  s.units.push({ id: uid, nation: oid, gens: [gid], troops, max: troops, morale: 90, tile: spot, path: [], order: null, mp: 0, home: null, wait: 0, cd: 0, navy: kind === '해적', ships: kind === '해적' || undefined, outlaw: kind, life: 5 + Math.floor(rng() * 5) });
  s.generals[gid].unit = uid;
  const victims = owned.filter((c) => grid.dist(c.tile, spot) <= 8).map((c) => c.owner);
  log(s, `🏴 ${near.name} 근처에 ${name}의 ${kind} ${fmtTroops(troops)}이(가) 일어났습니다!`, 'bad', [...new Set(victims)]);
  s.outlawStats = s.outlawStats || { rise: 0, raid: 0, sack: 0 }; s.outlawStats.rise++;
  return true;
}

// 날마다: 6칸 안에서 가장 가까운 성이나 부대를 들이받음, 없으면 떠돎
export function outlawDay(s, grid, rng) {
  const oid = s.outlawId;
  if (oid === undefined) return;
  for (const u of s.units) {
    if (u.nation !== oid || u.dead) continue;
    const o = u.order;
    const alive = o && (o.kind === 'unit' ? s.units.some((x) => x.id === o.id && !x.dead) : o.kind === 'castle' ? !isOutlaw(s, s.castles[o.id]?.owner) : u.path.length > 0);
    if (alive && u.path.length) continue;
    let best = null, bd = Infinity;
    for (const x of s.units) { if (x.nation === oid || x.dead) continue; const d = grid.dist(x.tile, u.tile); if (d <= 6 && d < bd) { bd = d; best = ['unit', x.id]; } }
    for (const c of s.castles) { if (c.owner === null || c.owner < 0 || isOutlaw(s, c.owner)) continue; const d = grid.dist(c.tile, u.tile); if (d <= 6 && d < bd) { bd = d; best = ['castle', c.id]; } }
    if (best && order(s, grid, u, best[0], best[1]).ok) continue;
    // 떠돎: 4칸 안 아무 칸
    for (let k = 0; k < 10; k++) { const t = grid.nb[u.tile][Math.floor(rng() * grid.nb[u.tile].length)]; const t2 = grid.nb[t]?.[Math.floor(rng() * 6)] ?? t; if (t2 !== undefined && (u.navy ? grid.water?.[t2] || grid.passable(t2) : grid.passable(t2)) && order(s, grid, u, 'tile', t2).ok) break; }
  }
}

// 성 앞 약탈: 성에 붙어 있는 동안 매일 털어 감 (성을 못 깨도 타격)
export function outlawRaid(s, grid) {
  const oid = s.outlawId;
  if (oid === undefined) return;
  for (const u of s.units) {
    if (u.nation !== oid || u.order?.kind !== 'castle') continue;
    const c = s.castles[u.order.id];
    if (!c || c.owner === null || c.owner < 0 || grid.dist(u.tile, c.tile) > 1) continue;
    const n = s.nations[c.owner];
    const g = Math.round(n.gold * 0.01), f = Math.round((n.food || 0) * 0.005), k = Math.round(c.troops * 0.015);
    n.gold -= g; n.food -= f; c.troops = Math.max(0, c.troops - k);
    let wiped = 0;
    const own = [];
    s.district?.forEach((d, t) => { if (d === c.id && t !== c.tile && s.owner[t] === c.owner) own.push(t); });
    for (let i = 0; i < 1 && own.length; i++) { const t = own.splice(Math.floor(Math.random() * own.length), 1)[0]; s.owner[t] = -1; wiped++; }
    s.fx.push({ type: 'hit', tile: c.tile, amt: k });
    s.outlawStats = s.outlawStats || { rise: 0, raid: 0, sack: 0 }; s.outlawStats.raid++;
    if (!u.raidLogged || u.raidLogged !== c.id) { u.raidLogged = c.id; log(s, `🔥 ${gensOf(s, u.gens)[0]?.name}의 ${u.outlaw || '도적'}이(가) ${c.name}을(를) 털고 있습니다! (매일 금·병량을 빼앗고 땅을 휩쓺)`, 'bad', [c.owner]); }
  }
}

// 도적이 성을 깨면: 차지하지 않고 약탈 — 금·병량을 털고 관할 땅 일부를 휩쓸고 떠남
export function outlawSack(s, grid, c, u) {
  const n = s.nations[c.owner];
  const gold = n ? Math.round(n.gold * 0.12) : 0;
  const food = n ? Math.round((n.food || 0) * 0.08) : 0;
  if (n) { n.gold -= gold; n.food -= food; }
  c.troops = 300;
  c.dur = Math.max(c.dur, c.maxDur * 0.3);
  let wiped = 0;
  const tiles = (s.district ? [...s.district.keys()].filter((t) => s.district[t] === c.id) : []);
  for (const t of tiles) if (s.owner[t] === c.owner && t !== c.tile && Math.random() < 0.3) { s.owner[t] = -1; wiped++; }
  u.order = null; u.path = [];
  u.life = Math.max(1, (u.life ?? 3) - 1);
  s.outlawStats = s.outlawStats || { rise: 0, raid: 0, sack: 0 }; s.outlawStats.sack++;
  log(s, `🔥 ${gensOf(s, u.gens)[0]?.name}의 ${u.outlaw || '도적'}이(가) ${c.name}을(를) 약탈했습니다! 금 ${fmtGold(gold)}·병량 ${fmtTroops(food)}을 빼앗기고 땅 ${wiped}칸이 휩쓸렸습니다.`, 'bad', [c.owner]);
}
