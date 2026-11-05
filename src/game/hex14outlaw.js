// ───────── 삼국지14식 모드: 도적·산적·비적·해적 — 아무 데서나 무리가 일어나 근처 성·부대를 들이받음 ─────────
// 모두 하나의 「도적」 세력(나라 목록·외교·통일 계산에서는 빠짐)으로 묶음. 약탈은 안 하고 병사만 박살냄 — 부대를 전멸시키거나 성 수비병을 0으로 만들면 다음 표적으로
import { T } from './rules.js';
import { order, log, gensOf, districtTiles, nearestCastle } from './hex14.js';
import { fmtTroops, fmtGold } from './format.js';

export const OUTLAW_KINDS = {
  도적: { mark: '도', desc: '들판의 도적 떼' },
  산적: { mark: '산', desc: '산·숲에 숨어 사는 산적' },
  비적: { mark: '비', desc: '사막·초원·변경을 떠도는 비적' },
  해적: { mark: '해', desc: '바다에서 해안을 터는 해적' },
};
// 무리 크기에 따른 우두머리 칭호
export const rankOf = (troops) => (troops >= 15000 ? '총대장' : troops >= 10000 ? '대장' : troops >= 6000 ? '단장' : '두목');
const KIND_TRAIT = { 도적: '돌격', 산적: '산악', 비적: '기마', 해적: '수군' };
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
  const boss = BOSS[Math.floor(rng() * BOSS.length)];
  const name = `${kind} ${rankOf(troops)} ${boss}`;
  const tier = troops >= 15000 ? 3 : troops >= 10000 ? 2 : 1;
  s.generals[gid] = { id: gid, name, war: 68 + Math.floor(rng() * 20), lead: 55 + Math.floor(rng() * 20), intel: 20 + Math.floor(rng() * 20), pol: 10 + Math.floor(rng() * 15), traits: [['맹장', tier], [KIND_TRAIT[kind], tier]], boss, kind, nation: oid, castle: null, unit: null, status: 'active' };
  const uid = s.nextUnit++;
  s.units.push({ id: uid, nation: oid, gens: [gid], troops, max: troops, morale: 90, tile: spot, path: [], order: null, mp: 0, home: null, wait: 0, cd: 0, navy: kind === '해적', ships: kind === '해적' || undefined, outlaw: kind, life: 5 + Math.floor(rng() * 5) });
  s.generals[gid].unit = uid;
  const victims = owned.filter((c) => grid.dist(c.tile, spot) <= 8).map((c) => c.owner);
  log(s, `🏴 ${near.name} 근처에 ${name}의 ${kind} ${fmtTroops(troops)}이(가) 일어났습니다!`, 'bad', [...new Set(victims)]);
  s.outlawStats = s.outlawStats || { rise: 0, smash: 0, kill: 0 }; s.outlawStats.rise++;
  return true;
}

// 날마다: 6칸 안의 부대를 먼저 노리고(장수 우선), 없으면 가까운 성, 그것도 없으면 떠돎
export function outlawDay(s, grid, rng) {
  const oid = s.outlawId;
  if (oid === undefined) return;
  for (const u of s.units) {
    if (u.nation !== oid || u.dead) continue;
    const boss = gensOf(s, u.gens)[0];
    if (boss?.boss) boss.name = `${boss.kind} ${rankOf(u.troops)} ${boss.boss}`; // 무리가 줄거나 늘면 칭호도 바뀜
    const o = u.order;
    const aliveUnit = o?.kind === 'unit' && s.units.some((x) => x.id === o.id && !x.dead);
    if (aliveUnit && u.path.length) continue; // 부대를 쫓는 중이면 계속
    // 가까운 부대 (성을 치러 가는 길에도 부대가 보이면 그쪽으로 돌아섬)
    let best = null, bd = Infinity;
    for (const x of s.units) { if (x.nation === oid || x.dead) continue; const d = grid.dist(x.tile, u.tile); if (d <= 6 && d < bd) { bd = d; best = ['unit', x.id]; } }
    if (best && order(s, grid, u, best[0], best[1]).ok) continue;
    const c0 = o?.kind === 'castle' ? s.castles[o.id] : null;
    if (c0 && c0.owner !== null && c0.owner >= 0 && !isOutlaw(s, c0.owner) && u.path.length) continue; // 성으로 가는 중
    if (o?.kind === 'tile' && u.path.length) continue; // 떠도는 중
    bd = Infinity; best = null;
    for (const c of s.castles) { if (c.owner === null || c.owner < 0 || isOutlaw(s, c.owner)) continue; const d = grid.dist(c.tile, u.tile); if (d <= 6 && d < bd) { bd = d; best = ['castle', c.id]; } }
    if (best && order(s, grid, u, best[0], best[1]).ok) continue;
    // 떠돎: 2칸 안 아무 칸
    for (let k = 0; k < 10; k++) { const t = grid.nb[u.tile][Math.floor(rng() * grid.nb[u.tile].length)]; const t2 = grid.nb[t]?.[Math.floor(rng() * 6)] ?? t; if (t2 !== undefined && (u.navy ? grid.water?.[t2] || grid.passable(t2) : grid.passable(t2)) && order(s, grid, u, 'tile', t2).ok) break; }
  }
}

// 도적이 성을 깨면: 차지하지 않고 그 성은 주인 없는 중립 성이 됨 (수비병도 중립 성만큼 다시 모임), 도적은 다음 먹잇감으로
export function outlawSack(s, grid, c, u) {
  const old = c.owner;
  // 성에 있던 장수는 가까운 자기 성으로 피신, 갈 데가 없으면 재야로
  c.owner = null;
  const home = old !== null && old >= 0 ? nearestCastle(s, grid, c.tile, old) : null;
  for (const g of Object.values(s.generals)) {
    if (g.castle !== c.id || g.status !== 'active') continue;
    if (home) g.castle = home.id; else if (!g.ruler) { g.status = 'free'; g.nation = null; }
  }
  c.bandit = null;
  c.capital = false;
  if (c.jobs) c.jobs = { farm: null, trade: null, draft: null };
  c.troops = c.kind === 'pass' ? 3000 : Math.round(Math.min(45000, 18000 + (c.pop || 0) * 180) / 100) * 100;
  c.dur = Math.max(c.dur, c.maxDur * 0.3);
  const tiles = c.kind === 'pass' ? [c.tile, ...grid.nb[c.tile]] : districtTiles(s)[c.id] || [];
  for (const t of tiles) if (s.owner[t] === old) s.owner[t] = -1;
  s.owner[c.tile] = -1;
  u.order = null; u.path = [];
  s.fx.push({ type: 'capture', tile: c.tile, text: `${c.name} 중립화` });
  s.outlawStats = s.outlawStats || { rise: 0, smash: 0, kill: 0 }; s.outlawStats.smash++;
  log(s, `🔥 ${gensOf(s, u.gens)[0]?.name}의 ${u.outlaw || '도적'}이(가) ${c.name}${old !== null && old >= 0 ? `(${s.nations[old]?.name})` : ''}을(를) 무너뜨렸습니다! 성은 주인 없는 땅이 되고, 도적은 다음 먹잇감을 찾아 떠납니다.`, 'bad', [old]);
  return old;
}
