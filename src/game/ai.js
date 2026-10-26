import { stateRng } from './rng.js';
import { COST } from './rules.js';
import {
  getRel, nationRegions, gensIn, nationPower, moveCost, estimateBattle, doMove, doTax, doConscript, doBuild,
  buildCost, recruitChance, doRecruit, doExecute, doRelease, log,
} from './engine.js';
import { evaluateDeal, applyDeal, validateDeal, emptyDeal, describeDeal } from './diplomacy.js';

const hostile = (s, a, b) => {
  if (b === null) return true;
  if (a === b) return false;
  const t = getRel(s, a, b).type;
  return t === 'none';
};

function frontierInfo(s, world, nid) {
  const mine = nationRegions(s, nid);
  const threat = {}, dist = {};
  const queue = [];
  for (const r of mine) {
    let th = 0, front = false;
    for (const nb of world.regions[r].neighbors) {
      const o = s.regions[nb.id].owner;
      if (o === nid) continue;
      if (o !== null && getRel(s, nid, o).type === 'alliance') continue;
      front = true;
      if (o !== null) th += s.regions[nb.id].troops * (nb.type === 'sea' ? 0.5 : 1);
    }
    threat[r] = th;
    if (front) {
      dist[r] = 0;
      queue.push(r);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const r = queue[q];
    for (const nb of world.regions[r].neighbors) {
      if (nb.type === 'sea') continue;
      if (s.regions[nb.id].owner === nid && dist[nb.id] === undefined) {
        dist[nb.id] = dist[r] + 1;
        queue.push(nb.id);
      }
    }
  }
  return { mine, threat, dist };
}

function targetBonus(s, nid, owner) {
  if (owner === null) return 8;
  let b = 0;
  if (s.joint.some((j) => (j.a === nid || j.b === nid) && j.target === owner)) b += 30;
  const op = s.opinion[nid][owner];
  if (op < -20) b += Math.min(25, -op / 3);
  if (s.nations[nid].grudge === owner) b += 15;
  return b;
}

export function aiActions(s, world, nid) {
  const n = s.nations[nid];
  let guard = 0;
  while (n.alive && n.ap > 0 && guard++ < 40) {
    const { mine, threat, dist } = frontierInfo(s, world, nid);
    const opts = [];
    for (const r of mine) {
      const reg = s.regions[r];
      if (reg.troops < 3) continue;
      const gens = gensIn(s, r, nid).map((g) => g.id);
      for (const nb of world.regions[r].neighbors) {
        const t = s.regions[nb.id];
        if (t.owner === nid || !hostile(s, nid, t.owner)) continue;
        if (t.owner !== null && s.turn <= 3) continue; // 초반 3턴은 국가 간 전쟁 유예
        const cost = moveCost(world, r, nb.id);
        if (cost > n.ap) continue;
        if (nb.type === 'sea' && !reg.buildings.port && !gens.some((id) => s.generals[id].trait === '수군')) continue;
        let keep = threat[r] > 0 ? Math.min(Math.floor(reg.troops / 3), Math.ceil(threat[r] * 0.3)) : 0;
        if (n.capital === r) keep = Math.max(keep, Math.floor(reg.troops * 0.35));
        const count = reg.troops - 1 - keep;
        if (count < 2) continue;
        const est = estimateBattle(s, world, nid, r, nb.id, count, gens);
        const need = t.owner === null ? 1.25 : 1.15 + (1 - n.aggression) * 0.45;
        if (est.ratio < need) continue;
        const value = t.pop * 0.6 + (t.owner !== null && s.nations[t.owner].capital === nb.id ? 25 : 0);
        opts.push({ score: 38 + value + Math.min(est.ratio, 4) * 5 + targetBonus(s, nid, t.owner) - cost * 4 + n.aggression * 10, run: () => doMove(s, world, nid, r, nb.id, count, gens) });
      }
    }
    if (n.gold >= COST.conscriptGold) {
      const c = mine.filter((r) => !s.regions[r].conscripted).sort((a, b) => threat[b] + s.regions[b].pop * 0.5 - (threat[a] + s.regions[a].pop * 0.5))[0];
      if (c !== undefined) opts.push({ score: 24 + Math.min(threat[c], 40) * 0.6 + (n.gold > 120 ? 12 : 0) + (dist[c] === 0 ? 6 : 0), run: () => doConscript(s, world, nid, c) });
    }
    const tx = mine.filter((r) => !s.regions[r].taxed).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
    if (tx !== undefined) opts.push({ score: 16 + s.regions[tx].pop * 0.3 + (n.gold < 60 ? 15 : 0), run: () => doTax(s, world, nid, tx) });
    if (n.ap >= 2 && n.gold >= 110) {
      const wall = mine.filter((r) => !s.regions[r].buildings.walls && threat[r] > 8).sort((a, b) => threat[b] - threat[a])[0];
      if (wall !== undefined && n.gold >= buildCost(s, wall, nid, 'walls') + 30) opts.push({ score: 20 + Math.min(threat[wall], 40) * 0.4, run: () => doBuild(s, world, nid, wall, 'walls') });
      const mk = mine.filter((r) => !s.regions[r].buildings.market).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (mk !== undefined && n.gold >= buildCost(s, mk, nid, 'market') + 30) opts.push({ score: 19 + s.regions[mk].pop * 0.2, run: () => doBuild(s, world, nid, mk, 'market') });
      const br = mine.filter((r) => !s.regions[r].buildings.barracks && dist[r] <= 1).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (br !== undefined && n.gold >= 200) opts.push({ score: 15, run: () => doBuild(s, world, nid, br, 'barracks') });
      const pt = mine.find((r) => world.regions[r].coastal && !s.regions[r].buildings.port && world.regions[r].neighbors.some((x) => x.type === 'sea' && hostile(s, nid, s.regions[x.id].owner)));
      if (pt !== undefined && n.gold >= 180 && mine.every((r) => !world.regions[r].neighbors.some((x) => x.type !== 'sea' && hostile(s, nid, s.regions[x.id].owner))))
        opts.push({ score: 26, run: () => doBuild(s, world, nid, pt, 'port') });
      else if (pt !== undefined && n.gold >= 250) opts.push({ score: 12, run: () => doBuild(s, world, nid, pt, 'port') });
    }
    for (const r of mine) {
      const reg = s.regions[r];
      if (reg.troops < 5 || dist[r] === undefined || dist[r] === 0) continue;
      const nb = world.regions[r].neighbors.find((x) => x.type !== 'sea' && s.regions[x.id].owner === nid && dist[x.id] < dist[r]);
      if (!nb || moveCost(world, r, nb.id) > n.ap) continue;
      const gens = gensIn(s, r, nid).map((g) => g.id);
      opts.push({ score: 14 + reg.troops * 0.4, run: () => doMove(s, world, nid, r, nb.id, reg.troops - 1, gens) });
    }
    if (!opts.length) break;
    opts.sort((a, b) => b.score - a.score);
    const res = opts[0].run();
    if (!res || !res.ok) break;
  }
}

// AI 외교: 다른 AI와 자동 협상, 플레이어에게는 제안을 보냄
export function aiDiplomacy(s, world, nid) {
  const rng = stateRng(s);
  const n = s.nations[nid];
  if (!rng.chance(0.18)) return;
  const others = s.nations.filter((o) => o.alive && o.id !== nid);
  if (!others.length) return;
  const neighbors = new Set();
  for (const r of nationRegions(s, nid)) for (const nb of world.regions[r].neighbors) {
    const o = s.regions[nb.id].owner;
    if (o !== null && o !== nid) neighbors.add(o);
  }
  const pool = others.filter((o) => neighbors.has(o.id) || rng.chance(0.2));
  if (!pool.length) return;
  const o = rng.pick(pool);
  const rel = getRel(s, nid, o.id);
  const myP = nationPower(s, nid), theirP = nationPower(s, o.id);
  const op = s.opinion[nid][o.id];
  const deal = emptyDeal();
  if (rel.type === 'none' && op > 25) deal.treaty = 'alliance';
  else if (rel.type === 'none' && theirP > myP * 2.2 && neighbors.has(o.id) && rng.chance(0.4)) deal.treaty = 'vassal_me';
  else if (rel.type === 'none' && theirP > myP * 1.3 && neighbors.has(o.id)) {
    deal.treaty = 'nap';
    deal.give.gold = Math.min(n.gold, Math.round(theirP * 0.15));
  } else if (rel.type === 'none' && myP > theirP * 2 && neighbors.has(o.id) && o.gold > 30) {
    deal.get.gold = Math.min(o.gold, Math.round(20 + o.gold * 0.3));
  } else if (rel.type === 'alliance') {
    const enemy = others.filter((x) => x.id !== o.id && s.opinion[nid][x.id] < -25 && getRel(s, o.id, x.id).type !== 'alliance').sort((a, b) => s.opinion[nid][a.id] - s.opinion[nid][b.id])[0];
    if (!enemy || s.joint.some((j) => j.a === nid && j.target === enemy.id)) return;
    deal.treaty = 'joint';
    deal.target = enemy.id;
  } else return;
  if (validateDeal(s, world, nid, o.id, deal)) return;
  if (o.isPlayer) {
    if (s.proposals.length >= 2) return;
    s.proposals.push({ from: nid, deal, text: describeDeal(s, nid, o.id, deal) });
    return;
  }
  if (evaluateDeal(s, world, nid, o.id, deal) >= 0) applyDeal(s, world, nid, o.id, deal);
}

export function aiPrisoners(s, nid) {
  const rng = stateRng(s);
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'prisoner' || g.captor !== nid) continue;
    const r = rng();
    if (r < 0.45 && recruitChance(s, nid, g) > 0) {
      s.nations[nid].ap += 1;
      doRecruit(s, nid, g.id);
    } else if (r < 0.55) doExecute(s, nid, g.id);
    else if (r < 0.6) doRelease(s, nid, g.id);
  }
}

// 플레이어가 AI 제안을 거절했을 때
export function onProposalDeclined(s, prop) {
  const from = prop.from;
  const demand = prop.deal.get.gold > 0 || prop.deal.get.regions.length > 0;
  s.opinion[from][s.playerId] -= demand ? 15 : 5;
  if (demand) {
    s.nations[from].grudge = s.playerId;
    log(s, `😠 ${s.nations[from].name}이(가) 요구를 거절당해 분노했습니다.`, [from, s.playerId], 'diplo');
  }
}
