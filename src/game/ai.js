import { stateRng } from './rng.js';
import { COST, G } from './rules.js';
import {
  getRel, nationRegions, nationFleets, gensIn, nationPower, moveCost, estimateBattle, doMove, doConscript, doBuild,
  buildCost, recruitChance, moveCheck, doRecruit, doExecute, doRelease, log, conscriptMax, conscriptCost, doRelief, reliefCost,
  RELIEF_COOLDOWN, doBuildEngine, engineCost, ENGINE_MAX, canSail, income,
} from './engine.js';
import { evaluateDeal, applyDeal, validateDeal, emptyDeal, describeDeal } from './diplomacy.js';

const inCoalition = (s, id) => s.coalition && s.coalition.members?.includes(id);

const hostile = (s, a, b) => {
  if (b === null) return true;
  if (a === b) return false;
  // 대동맹 결성 중에는 AI 회원국끼리 싸우지 않는다
  if (inCoalition(s, a) && inCoalition(s, b) && !s.nations[a].isPlayer && !s.nations[b].isPlayer) return false;
  const t = getRel(s, a, b).type;
  return t === 'none';
};

// 바다 구역은 적 함대가 있을 때만 위협/전선으로 본다
const isEnemyFleet = (s, nid, rid) => s.regions[rid].sea && s.regions[rid].owner !== null && s.regions[rid].owner !== nid && s.regions[rid].troops > 0;

// 전략 목표: 6턴마다 가장 만만하거나 미운 이웃 국가를 정하고 병력을 그쪽 국경으로 모은다
function updateGoal(s, world, nid) {
  const n = s.nations[nid];
  if (n.goal !== undefined && n.goal !== null && s.nations[n.goal]?.alive && s.turn - (n.goalSince || 0) < 6) return;
  const myP = nationPower(s, nid);
  const cand = new Map();
  for (const r of nationRegions(s, nid)) {
    for (const nb of world.regions[r].neighbors) {
      let o = s.regions[nb.id].owner;
      if (s.regions[nb.id].sea) {
        // 바다 건너 해안국도 후보 (승선 가능할 때)
        for (const x of world.regions[nb.id].neighbors) {
          const oo = s.regions[x.id].owner;
          if (!s.regions[x.id].sea && oo !== null && oo !== nid) cand.set(oo, (cand.get(oo) || 0) - 10);
        }
        continue;
      }
      if (o === null || o === nid) continue;
      cand.set(o, cand.get(o) || 0);
    }
  }
  let best = null, bv = -Infinity;
  for (const [o, base] of cand) {
    if (!hostile(s, nid, o) || getRel(s, nid, o).type !== 'none') continue;
    const v = base + (myP / Math.max(1, nationPower(s, o))) * 30 - s.opinion[nid][o] * 0.3 + (s.coalition?.target === o ? 25 : 0);
    if (v > bv) { bv = v; best = o; }
  }
  n.goal = best;
  n.goalSince = s.turn;
}

function frontierInfo(s, world, nid) {
  const mine = nationRegions(s, nid);
  const goal = s.nations[nid].goal;
  const threat = {}, dist = {};
  const queue = [];
  const stage = [];
  for (const r of mine) {
    let th = 0, front = false;
    for (const nb of world.regions[r].neighbors) {
      const t = s.regions[nb.id];
      const o = t.owner;
      if (o === nid) continue;
      if (t.sea && !isEnemyFleet(s, nid, nb.id)) continue;
      if (o !== null && getRel(s, nid, o).type === 'alliance') continue;
      front = true;
      if (o !== null) th += (t.troops / 1000) * (t.sea ? 0.6 : 1); // 단위: 천 명
    }
    threat[r] = th;
    if (front) queue.push(r);
    if (goal !== null && goal !== undefined && world.regions[r].neighbors.some((x) => s.regions[x.id].owner === goal && !s.regions[x.id].sea)) stage.push(r);
  }
  // 목표국 국경이 있으면 그쪽으로, 없으면 모든 전선으로 병력을 보냄
  const seeds = stage.length ? [...new Set([...stage, ...queue.filter((r) => threat[r] > s.regions[r].troops / 1000)])] : queue;
  queue.length = 0;
  for (const r of seeds) {
    dist[r] = 0;
    queue.push(r);
  }
  for (let q = 0; q < queue.length; q++) {
    const r = queue[q];
    for (const nb of world.regions[r].neighbors) {
      if (s.regions[nb.id].sea) continue;
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
  if (s.coalition?.target === owner) b += 20;
  if (s.nations[nid].goal === owner) b += 20;
  const op = s.opinion[nid][owner];
  if (op < -20) b += Math.min(25, -op / 3);
  if (s.nations[nid].grudge === owner) b += 15;
  return b;
}

// 공격 후보 평가 (육지·상륙·해전, 성벽이면 포위/강습 중 유리한 쪽)
function attackOption(s, world, nid, from, to, count, gens, need) {
  const t = s.regions[to];
  const opts = {};
  const engines = Math.min(2, s.regions[from].engines || 0);
  if (!t.sea && (t.buildings.walls || 0) > 0) {
    const assault = estimateBattle(s, world, nid, from, to, count, gens, { mode: 'assault', engines });
    if (assault.ratio > Math.max(need, 1.6)) return { est: assault, opts: { mode: 'assault', engines } };
    opts.mode = 'siege';
    opts.engines = engines;
  }
  return { est: estimateBattle(s, world, nid, from, to, count, gens, opts), opts };
}

export function aiActions(s, world, nid) {
  const n = s.nations[nid];
  updateGoal(s, world, nid);
  // 섬나라: 육로로 맞닿은 적이나 중립지가 없으면 해군 중심
  const island = !nationRegions(s, nid).some((r) => world.regions[r].neighbors.some((x) => !s.regions[x.id].sea && s.regions[x.id].owner !== nid && hostile(s, nid, s.regions[x.id].owner)));
  let guard = 0;
  while (n.alive && n.ap > 0 && guard++ < 40) {
    const { mine, threat, dist } = frontierInfo(s, world, nid);
    const fleets = nationFleets(s, nid);
    const opts = [];
    // 공격·상륙·해전
    for (const r of [...mine, ...fleets]) {
      const reg = s.regions[r];
      if (reg.troops < 3000 && !(reg.sea && reg.troops >= 1000)) continue;
      const gens = gensIn(s, r, nid).map((g) => g.id);
      for (const nb of world.regions[r].neighbors) {
        const t = s.regions[nb.id];
        if (t.owner === nid || !hostile(s, nid, t.owner)) continue;
        if (t.sea && !isEnemyFleet(s, nid, nb.id)) continue;
        if (t.owner !== null && s.turn <= 3) continue; // 초반 3턴은 국가 간 전쟁 유예
        const cost = moveCost(world, r, nb.id, s);
        if (cost > n.ap) continue;
        let keep = reg.sea ? 0 : threat[r] > 0 ? Math.min(Math.floor(reg.troops / 3), Math.ceil(threat[r] * 300)) : 0;
        if (n.capital === r) keep = Math.max(keep, Math.floor(reg.troops * 0.35));
        const count = reg.sea ? reg.troops : reg.troops - 1000 - keep;
        if (count < 2000 && !reg.sea) continue;
        if (moveCheck(s, world, nid, r, nb.id, count, gens)) continue;
        const need = t.owner === null ? 1.25 : s.coalition?.target === t.owner && inCoalition(s, nid) ? 1.05 : 1.15 + (1 - n.aggression) * 0.45;
        const { est, opts: mo } = attackOption(s, world, nid, r, nb.id, count, gens, need);
        if (est.ratio < need) continue;
        const value = (t.sea ? 10 : t.pop * 0.6) + (t.owner !== null && !t.sea && s.nations[t.owner].capital === nb.id ? 25 : 0);
        opts.push({ score: 38 + value + Math.min(est.ratio, 4) * 5 + targetBonus(s, nid, t.owner) - cost * 4 + n.aggression * 10 + (reg.sea ? 15 : 0), run: () => doMove(s, world, nid, r, nb.id, count, gens, mo) });
      }
    }
    // 승선: 바다 건너 약한 해안이 있으면 함대를 띄움
    if (n.ap >= 2 && s.turn > 3) {
      for (const r of mine) {
        const reg = s.regions[r];
        if (reg.troops < (island ? 4000 : 8000)) continue;
        const gens = gensIn(s, r, nid).map((g) => g.id);
        if (!canSail(s, nid, r, gens)) continue;
        for (const z of world.regions[r].neighbors) {
          if (z.type !== 'coast') continue;
          const zr = s.regions[z.id];
          if (zr.owner !== null && zr.owner !== nid && zr.troops > 0) continue;
          const count = reg.troops - 1000 - (threat[r] > 0 ? Math.ceil(threat[r] * 400) : 0);
          if (count < (island ? 3000 : 6000)) continue;
          const target = world.regions[z.id].neighbors.find((x) => {
            if (x.type !== 'landing' && x.type !== 'cliff') return false;
            const t = s.regions[x.id];
            return t.owner !== nid && hostile(s, nid, t.owner) && !(t.owner !== null && s.turn <= 3) && t.troops * 1.6 < count * (x.type === 'cliff' ? 0.45 : 0.75);
          });
          if (!target || moveCheck(s, world, nid, r, z.id, count, gens)) continue;
          opts.push({ score: 30 + s.regions[target.id].pop * 0.4 + (island ? 15 : 0) + (s.regions[target.id].owner === n.goal ? 10 : 0), run: () => doMove(s, world, nid, r, z.id, count, gens) });
        }
      }
    }
    // 바다에 남은 함대는 가까운 아군 해안으로 귀환
    for (const z of fleets) {
      const back = world.regions[z].neighbors.find((x) => (x.type === 'landing' || x.type === 'cliff') && s.regions[x.id].owner === nid);
      if (back && !moveCheck(s, world, nid, z, back.id, s.regions[z].troops, [])) {
        const gens = gensIn(s, z, nid).map((g) => g.id);
        opts.push({ score: 12, run: () => doMove(s, world, nid, z, back.id, s.regions[z].troops, gens) });
      }
    }
    // 징병: 민심이 45 아래로 떨어지지 않을 만큼, 금이 허락하는 만큼
    const c = mine.filter((r) => !s.regions[r].conscripted && (s.regions[r].loyalty ?? 100) >= 50).sort((a, b) => threat[b] + s.regions[b].pop * 0.5 - (threat[a] + s.regions[a].pop * 0.5))[0];
    const net = income(s, nid).net;
    if (c !== undefined && net > 8) {
      const r = s.regions[c];
      // 돈이 넘치면 민심을 해치지 않는 모병, 아니면 징집
      const mode = n.gold > 300 * G ? 'hire' : 'draft';
      let amount = conscriptMax(s, c, nid, mode);
      const bad = (a) => {
        const k = conscriptCost(s, c, a, mode);
        return k.loyalty > (r.loyalty ?? 100) - 45 || k.gold > n.gold - 20 * G || a > net * 0.5;
      };
      while (amount > 1000 && bad(amount)) amount -= 500;
      if (amount >= 1000 && conscriptCost(s, c, amount, mode).gold <= n.gold) opts.push({ score: 24 + Math.min(threat[c], 40) * 0.6 + (n.gold > 120 * G ? 12 : 0) + (dist[c] === 0 ? 6 : 0), run: () => doConscript(s, world, nid, c, amount, mode) });
    }
    // 진휼: 반란 위험 지역
    const sad = mine.filter((r) => (s.regions[r].loyalty ?? 100) < 28 && (s.regions[r].reliefTurn === undefined || s.turn - s.regions[r].reliefTurn >= RELIEF_COOLDOWN)).sort((a, b) => s.regions[a].loyalty - s.regions[b].loyalty)[0];
    if (sad !== undefined && n.gold >= reliefCost(s, sad) + 40 * G) opts.push({ score: 27, run: () => doRelief(s, nid, sad) });
    if (n.ap >= 2 && n.gold >= 110 * G) {
      const wall = mine.filter((r) => !s.regions[r].buildings.walls && threat[r] > 8).sort((a, b) => threat[b] - threat[a])[0];
      if (wall !== undefined && n.gold >= buildCost(s, wall, nid, 'walls') + 30 * G) opts.push({ score: 20 + Math.min(threat[wall], 40) * 0.4, run: () => doBuild(s, world, nid, wall, 'walls') });
      const mk = mine.filter((r) => !s.regions[r].buildings.market).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (mk !== undefined && n.gold >= buildCost(s, mk, nid, 'market') + 30 * G) opts.push({ score: 19 + s.regions[mk].pop * 0.2, run: () => doBuild(s, world, nid, mk, 'market') });
      const br = mine.filter((r) => !s.regions[r].buildings.barracks && dist[r] <= 1).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (br !== undefined && n.gold >= 200 * G) opts.push({ score: 15, run: () => doBuild(s, world, nid, br, 'barracks') });
      const pt = mine.filter((r) => world.regions[r].coastal && !s.regions[r].buildings.port).sort((a, b) => s.regions[b].troops - s.regions[a].troops)[0];
      if (pt !== undefined && n.gold >= (island ? 160 : 220) * G) opts.push({ score: island ? 32 : 13, run: () => doBuild(s, world, nid, pt, 'port') });
    }
    // 공성병기: 성벽 있는 적지와 맞닿은 전선
    if (n.gold >= 130 * G) {
      const eg = mine.find((r) => (s.regions[r].engines || 0) < ENGINE_MAX && s.regions[r].troops >= 8000 && world.regions[r].neighbors.some((x) => {
        const t = s.regions[x.id];
        return !t.sea && t.owner !== null && t.owner !== nid && hostile(s, nid, t.owner) && (t.buildings.walls || 0) >= 2;
      }));
      if (eg !== undefined && n.gold >= engineCost(s, eg) + 60 * G) opts.push({ score: 21, run: () => doBuildEngine(s, nid, eg) });
    }
    for (const r of mine) {
      const reg = s.regions[r];
      if (reg.troops < 5000 || dist[r] === undefined || dist[r] === 0) continue;
      const nb = world.regions[r].neighbors.find((x) => !s.regions[x.id].sea && s.regions[x.id].owner === nid && dist[x.id] < dist[r]);
      if (!nb || moveCost(world, r, nb.id, s) > n.ap) continue;
      const gens = gensIn(s, r, nid).map((g) => g.id);
      if (moveCheck(s, world, nid, r, nb.id, reg.troops - 1000, gens)) continue;
      opts.push({ score: 14 + (reg.troops / 1000) * 0.4, run: () => doMove(s, world, nid, r, nb.id, reg.troops - 1000, gens, { engines: reg.engines || 0 }) });
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
    deal.give.gold = Math.min(n.gold, Math.round(theirP * 0.15) * G);
  } else if (rel.type === 'none' && myP > theirP * 2 && neighbors.has(o.id) && o.gold > 30 * G) {
    deal.get.gold = Math.min(o.gold, Math.round(20 * G + o.gold * 0.3));
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

// AI 세율: 국고 사정과 민심에 따라 조정
export function aiTaxPolicy(s, nid) {
  const n = s.nations[nid];
  const mine = nationRegions(s, nid);
  const avgLoy = mine.reduce((a, r) => a + (s.regions[r].loyalty ?? 100), 0) / Math.max(1, mine.length);
  if (avgLoy < 45) n.taxRate = 'low';
  else if (n.gold < 60 * G && avgLoy > 60) n.taxRate = 'high';
  else if (n.gold > 350 * G) n.taxRate = 'low';
  else n.taxRate = 'normal';
}
