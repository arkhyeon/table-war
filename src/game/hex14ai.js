// ───────── 삼국지14식 모드: 컴퓨터 나라 (출진·공성·요격·귀환) ─────────
import { foodUse } from './hex14gov.js';
import { aiBuild, aiForts } from './hex14build.js';
import { aiPolicy } from './hex14policy.js';
import { aiPeople } from './hex14people.js';
import { makeRng } from './rng.js';
import { sortie, order, nearestCastle, commandCap, gensOf, draft14, draftMax14, enemy } from './hex14.js';

export const GRACE = 9;

// 성 주변 위협: 6칸 안 적 부대 병력 합
function threatNear(s, grid, c) {
  let t = 0;
  for (const u of s.units) if (enemy(s, c.owner, u.nation) && grid.dist(u.tile, c.tile) <= 6 * grid.k) t += u.troops;
  return t;
}

// scope가 있으면 군단: 그 도시들과 그 군단 부대만 움직임 (플레이어가 맡긴 군단)
export function aiTurn14(s, grid, nid, scope = null) {
  const n = s.nations[nid];
  if (!n.alive) return;
  const inScope = (c) => !scope || scope.cities.has(c.id);
  const mine = s.castles.filter((c) => c.owner === nid && inScope(c));
  const myUnits = s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : !u.corps || n.id !== s.playerId || s.spectator));
  const mark = (u) => { if (scope) u.corps = scope.corps; return u; };
  const nUnits = () => s.units.filter((u) => u.nation === nid && (scope ? u.corps === scope.corps : true)).length;
  // 1) 이미 나간 부대: 약해지면 귀환, 목표가 없어지면 새 목표
  for (const u of myUnits) {
    const home = nearestCastle(s, grid, u.tile, nid);
    if ((u.troops < u.max * 0.3 || u.morale < 25) && home) { order(s, grid, u, 'castle', home.id); continue; }
    const o = u.order;
    const bad = !o || (o.kind === 'castle' && !enemy(s, nid, s.castles[o.id].owner) && o.id !== home?.id) || (o.kind === 'unit' && !s.units.some((x) => x.id === o.id)) || (o.kind === 'tile' && !u.path.length);
    if (bad || !u.path.length) {
      const t = pickTarget(s, grid, nid, u.tile, u.troops);
      if (t) order(s, grid, u, 'castle', t.id);
      else if (home) order(s, grid, u, 'castle', home.id);
    }
  }
  // 2) 성에 다가온 적 부대를 요격
  for (const c of mine) {
    const foe = s.units.filter((u) => enemy(s, nid, u.nation) && grid.dist(u.tile, c.tile) <= 4 * grid.k).sort((a, b) => a.troops - b.troops)[0];
    if (!foe) continue;
    const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').sort((a, b) => b.lead + b.war - (a.lead + a.war));
    if (!gs.length || c.troops < foe.troops * 1.3 + 2000) continue;
    const r = sortie(s, grid, c.id, [gs[0].id], Math.min(commandCap(s, [gs[0].id]), c.troops - 2000));
    if (r.ok) order(s, grid, mark(r.unit), 'unit', foe.id);
  }
  // 3) 출진: 남는 병력이 있는 성에서 가까운 약한 성을 노림
  const maxUnits = Math.max(2, Math.ceil(mine.length * 1.2));
  for (const c of mine.sort((a, b) => b.troops - a.troops)) {
    if (nUnits() >= maxUnits) break;
    const reserve = Math.max(2500, c.troops * 0.35) + threatNear(s, grid, c) * 0.8;
    const spare = c.troops - reserve;
    if (spare < 4000) continue;
    const gs = Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active').sort((a, b) => b.lead + b.war - (a.lead + a.war));
    if (!gs.length) continue;
    const gids = gs.slice(0, Math.min(2, gs.length)).map((g) => g.id);
    const troops = Math.min(commandCap(s, gids), spare);
    const t = pickTarget(s, grid, nid, c.tile, troops);
    if (!t) continue;
    // 성벽이 두꺼운 성을 칠 때는 금이 넉넉하면 공성병기를 끌고 감
    const r = sortie(s, grid, c.id, gids, troops, t.dur > 1500 && n.gold > 25000);
    if (r.ok) order(s, grid, mark(r.unit), 'castle', t.id);
  }
  // 4) 징병: 금이 남으면 장수 있는 성부터 (유지비 1명당 0.5금/턴을 감당할 만큼)
  // 병량이 1년 넘게 버틸 때만 (더 뽑으면 굶음)
  if (n.gold > (scope ? 200000 : 50000) && n.food > foodUse(s, nid) * 30) {
    const hub = mine.filter((c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active')).sort((a, b) => threatNear(s, grid, b) - threatNear(s, grid, a));
    const per = Math.floor((n.gold - 30000) / 10 / Math.max(1, Math.min(6, hub.length)) / 100) * 100;
    for (const c of hub.slice(0, 6)) { const m = Math.min(draftMax14(s, c), per); if (m >= 500) draft14(s, c.id, m); }
  }
  // 수송: 장수 없는 후방 성의 남는 병력을 가까운 장수 있는 성으로 보냄 (12칸 이내)
  const hubs = mine.filter((c) => Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active'));
  for (const c of mine) {
    if (hubs.includes(c) || threatNear(s, grid, c) > 0) continue;
    const extra = c.troops - 1500;
    if (extra < 1000) continue;
    const to = hubs.map((h) => [h, grid.dist(h.tile, c.tile)]).filter(([, d]) => d <= 12 * grid.k).sort((a, b) => a[1] - b[1])[0];
    if (!to) continue;
    c.troops -= extra;
    to[0].troops += Math.round(extra * 0.95);
  }
  // 시설 건설 (군단이 아닐 때만)
  if (!scope) {
    const threat = (c) => threatNear(s, grid, c);
    aiBuild(s, grid, nid, threat);
    aiForts(s, grid, nid, threat);
    aiPolicy(s, nid, mine.some((c) => threat(c) > 0), n.food < foodUse(s, nid) * 12);
    aiPeople(s, grid, nid, makeRng(`aip:${s.seed}:${s.turn}:${nid}`));
  }
  // 5) 장수 재배치: 장수 없는 성에 남는 장수를 보냄 (입성 명령 대신 즉시 이동: 같은 나라 성끼리)
  const empty = mine.filter((c) => !Object.values(s.generals).some((g) => g.castle === c.id && g.status === 'active'));
  for (const c of empty) {
    const donor = mine.find((d) => Object.values(s.generals).filter((g) => g.castle === d.id && g.status === 'active').length >= 3);
    if (!donor) break;
    const g = Object.values(s.generals).filter((x) => x.castle === donor.id && x.status === 'active').sort((a, b) => a.lead - b.lead)[0];
    g.castle = c.id;
  }
}

// 노릴 성: 가까우면서(25칸 이내) 수비가 내 병력보다 약한 남의 성
function pickTarget(s, grid, nid, from, troops) {
  let best = null, bv = Infinity;
  for (const c of s.castles) {
    if (!enemy(s, nid, c.owner)) continue;
    // 처음 석 달(9순)은 플레이어 도시를 먼저 노리지 않음 (작은 나라도 숨 돌릴 틈)
    if (c.owner === s.playerId && !s.spectator && s.turn <= GRACE) continue;
    const d = grid.dist(c.tile, from);
    if (d > 25 * grid.k) continue;
    const guard = c.troops + s.units.filter((u) => u.nation === c.owner && grid.dist(u.tile, c.tile) <= 3 * grid.k).reduce((a, u) => a + u.troops, 0);
    // 이미 그 성으로 가는 우리 부대와 힘을 합침
    const ours = s.units.filter((u) => u.nation === nid && u.order?.kind === 'castle' && u.order.id === c.id).reduce((a, u) => a + u.troops, 0);
    if (guard * (c.dur > c.maxDur * 0.3 ? 1.8 : 1) > (troops + ours) * 1.1) continue;
    const v = d * 1.5 / grid.k + guard / 2000 + (c.owner === null || c.owner === -1 ? -3 : 0);
    if (v < bv) { bv = v; best = c; }
  }
  return best;
}

export { gensOf };
