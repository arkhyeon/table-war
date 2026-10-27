import { stateRng } from './rng.js';
import { COST, G } from './rules.js';
import {
  getRel, nationRegions, nationFleets, gensIn, nationPower, moveCost, estimateBattle, planMove, doConscript, doBuild,
  buildCost, recruitChance, moveCheck, doRecruit, doExecute, doRelease, log, conscriptMax, conscriptCost, doRelief, reliefCost,
  RELIEF_COOLDOWN, canSail, mercCap, mercPrice, bribeChance, bribeCost, doBribe, nationGenerals, income, isVassalOf, movable, governorOf, doRelocate, capitalMoveCheck, doMoveCapital,
  marchVia, genIndexOn, genIndexOff } from './engine.js';
import { evaluateDeal, applyDeal, validateDeal, emptyDeal, describeDeal, annexCheck, doAnnex, breakTreaty } from './diplomacy.js';

const inCoalition = (s, id) => s.coalition && s.coalition.members?.includes(id);

// 후반 패권국: 35턴 이후 국력 1위이면서 육지 22% 이상 → 0~1 (턴이 갈수록 공격적)
export function hegemonDrive(s, nid) {
  if (s.turn < 30) return 0;
  const alive = s.nations.filter((n) => n.alive);
  const top = alive.reduce((a, b) => (nationPower(s, b.id) > nationPower(s, a.id) ? b : a));
  if (top.id !== nid) return 0;
  const land = s.regions.filter((r) => !r.sea).length;
  // 문턱: 통일선의 37%(60%면 22%), 나라가 많은 지도에선 더 낮게
  const need = Math.min((s.winShare || 0.6) * 0.37, 2.2 / alive.length);
  if (nationRegions(s, nid).length / land < need) return 0;
  return Math.min(1, 0.5 + (s.turn - 30) / 40);
}

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
// 태세: 목표국보다 확실히 강하거나 공격받는 중이면 '전쟁', 아니면 '내실'(징병·건설 우선, 국가 공격 자제)
function updatePosture(s, world, nid) {
  const n = s.nations[nid];
  const mine = nationRegions(s, nid);
  const avgLoy = mine.reduce((a, r) => a + (s.regions[r].loyalty ?? 100), 0) / Math.max(1, mine.length);
  let underAttack = false;
  for (const r of mine) {
    let enemy = 0;
    for (const nb of world.regions[r].neighbors) {
      const t = s.regions[nb.id];
      if (t.owner !== null && t.owner !== nid && hostile(s, nid, t.owner)) enemy += t.troops;
    }
    if (enemy > s.regions[r].troops * 1.5 && enemy > 5000) underAttack = true;
  }
  const ratio = n.goal !== null && n.goal !== undefined && s.nations[n.goal]?.alive ? nationPower(s, nid) / Math.max(1, nationPower(s, n.goal)) : 0;
  const strong = ratio >= 1.25 && avgLoy >= 50 && income(s, nid).net > 0;
  n.posture = strong || (underAttack && ratio >= 0.8) || s.coalition?.target === n.goal || hegemonDrive(s, nid) > 0 ? 'war' : 'build';
}

function updateGoal(s, world, nid) {
  const n = s.nations[nid];
  // 대동맹 회원국은 패권국과 닿아 있으면 곧바로 목표를 패권국으로
  const ct = s.coalition?.target;
  if (ct !== undefined && inCoalition(s, nid) && n.goal !== ct) {
    const touch = nationRegions(s, nid).some((r) => world.regions[r].neighbors.some((x) => s.regions[x.id].owner === ct || (s.regions[x.id].sea && world.regions[x.id].neighbors.some((y) => s.regions[y.id].owner === ct))));
    if (touch) { n.goal = ct; n.goalSince = s.turn; return; }
  }
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
  // 속국은 종주국의 적(종주국과 맞닿은 나라)을 함께 친다
  const lord = s.nations.find((x) => x.alive && isVassalOf(s, nid, x.id));
  const lordFoes = new Set();
  if (lord) for (const r of nationRegions(s, lord.id)) for (const nb of world.regions[r].neighbors) {
    const o = s.regions[nb.id].owner;
    if (o !== null && o !== lord.id && o !== nid && !s.regions[nb.id].sea && getRel(s, lord.id, o).type === 'none') lordFoes.add(o);
  }
  let best = null, bv = -Infinity;
  for (const [o, base] of cand) {
    if (!hostile(s, nid, o) || getRel(s, nid, o).type !== 'none') continue;
    const theirP = Math.max(1, nationPower(s, o));
    // 나보다 센 나라는 목표로 삼지 않음 (약한 나라부터)
    const v = base + (myP / theirP) * 30 - (theirP > myP * 1.15 ? 35 : 0) - s.opinion[nid][o] * 0.3 + (s.coalition?.target === o ? 25 : 0) + (lordFoes.has(o) ? 60 : 0);
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
  let seeds = stage.length ? [...new Set([...stage, ...queue.filter((r) => threat[r] > s.regions[r].troops / 1000)])] : queue;
  // 육지 전선이 없는 섬나라: 바다 건너편을 마주한 항구로 병력을 모음
  if (!seeds.length) {
    // 본토를 다 먹었으면 본토에 병력을 둘 이유가 없음 → 바다 건너 상대를 마주한 항구(없으면 해안)로 모두 모음
    const ports = mine.filter((r) => s.regions[r].buildings.port && overseas(s, world, nid, r).length);
    seeds = ports.length ? ports : mine.filter((r) => s.regions[r].buildings.port);
    if (!seeds.length) seeds = mine.filter((r) => world.regions[r].coastal && overseas(s, world, nid, r).length);
  }
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
  // 전선이 3개 이상이면 목표 아닌 나라와는 새로 싸우지 않음 (목표 외 침공 억제)
  else if ((s.nations[nid].fronts || 0) >= 3 && s.coalition?.target !== owner) b -= 22;
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

// 바다 건너 칠 만한 해안: 해안 r에서 바다 1~2칸 안에 닿는 남의 땅 상륙 지점 → [{zone, via, target, type}]
function overseas(s, world, nid, r) {
  const out = [];
  for (const z of world.regions[r].neighbors) {
    if (z.type !== 'coast') continue;
    const scan = (zone, via) => {
      for (const x of world.regions[zone].neighbors) {
        if (x.type !== 'landing' && x.type !== 'cliff') continue;
        const o = s.regions[x.id].owner;
        if (o !== nid && hostile(s, nid, o)) out.push({ zone: z.id, via, target: x.id, type: x.type });
      }
    };
    scan(z.id, null);
    for (const y of world.regions[z.id].neighbors) if (y.type === 'sea') scan(y.id, y.id);
  }
  return out;
}

// 땅덩어리 번호(바다로 나뉜 육지 묶음)와 본토 번호
function massInfo(world) {
  if (world._mass) return world._mass;
  const of = new Array(world.regions.length).fill(-1);
  const size = [];
  for (const r of world.regions) {
    if (r.sea || of[r.id] >= 0) continue;
    const q = [r.id];
    of[r.id] = size.length;
    for (let k = 0; k < q.length; k++) for (const nb of world.regions[q[k]].neighbors) if (!world.regions[nb.id].sea && of[nb.id] < 0) { of[nb.id] = of[r.id]; q.push(nb.id); }
    size.push(q.length);
  }
  world._mass = { of, main: size.indexOf(Math.max(...size)), size };
  return world._mass;
}

export function aiActions(s, world, nid) {
  const n = s.nations[nid];
  updateGoal(s, world, nid);
  updatePosture(s, world, nid);
  const building = n.posture === 'build';
  const drive = n.isPlayer ? 0 : hegemonDrive(s, nid);
  // 패권국 총동원: 행동력 +1~2
  if (drive) n.ap += Math.round(drive * 3);
  // 태수 배치: 놀고 있는 문관 한 명을 태수 없는 큰 고을로 (턴당 1명)
  if (n.ap > 3) {
    const civs = Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && g.role === 'civ' && n.ruler !== g.id && governorOf(s, g.region)?.id !== g.id);
    const spot = nationRegions(s, nid).filter((r) => governorOf(s, r)?.role !== 'civ').sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
    if (civs.length && spot !== undefined) doRelocate(s, nid, civs[0].id, spot);
  }
  // 천도: 수도가 적 대군과 맞닿아 위험하면, 안쪽의 큰 고을로 (드물게)
  if (n.capital !== null && n.ap >= 5 && stateRng(s)() < 0.3) {
    const cap = n.capital;
    let enemy = 0;
    for (const x of world.regions[cap].neighbors) {
      const t = s.regions[x.id];
      if (t.owner !== null && t.owner !== nid && hostile(s, nid, t.owner)) enemy += t.troops;
    }
    if (enemy > s.regions[cap].troops * 2) {
      const safe = nationRegions(s, nid).filter((r) => r !== cap && !world.regions[r].neighbors.some((x) => { const t = s.regions[x.id]; return t.owner !== null && t.owner !== nid && hostile(s, nid, t.owner); }) && !capitalMoveCheck(s, world, nid, r));
      const best = safe.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (best !== undefined) doMoveCapital(s, world, nid, best);
    }
  }
  // 오래된 속국 병합 (패권국은 항상, 나머지는 가끔)
  for (const o of s.nations) {
    if (!o.alive || o.isPlayer || o.id === nid || annexCheck(s, nid, o.id)) continue;
    if (drive || stateRng(s)() < 0.15) doAnnex(s, world, nid, o.id);
  }
  // 섬나라: 육로로 맞닿은 적이나 중립지가 없으면 해군 중심
  const island = !nationRegions(s, nid).some((r) => world.regions[r].neighbors.some((x) => !s.regions[x.id].sea && s.regions[x.id].owner !== nid && hostile(s, nid, s.regions[x.id].owner)));
  // 섬에서 시작한 나라: 섬 통일을 서두름
  const M = massInfo(world);
  const home = n.capital !== null ? M.of[n.capital] : -1;
  const insular = home >= 0 && home !== M.main && M.size[home] <= 30;
  let guard = 0;
  while (n.alive && n.ap > 0 && guard++ < 40) {
    genIndexOn(s);
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
        // 후반 패권국은 불가침 조약도 깨고 침공
        const napBreak = drive >= 0.7 && t.owner !== null && !t.sea && getRel(s, nid, t.owner).type === 'nap';
        if (t.owner === nid || (!hostile(s, nid, t.owner) && !napBreak)) continue;
        if (t.sea && !isEnemyFleet(s, nid, nb.id)) continue;
        if (t.owner !== null && s.turn <= 3) continue; // 초반 3턴은 국가 간 전쟁 유예
        const cost = moveCost(world, r, nb.id, s);
        if (cost > n.ap) continue;
        // 사방이 적이면 비운 땅을 노린 기회 공격을 막도록 수비를 더 남김
        let keep = reg.sea ? 0 : threat[r] > 0 ? Math.min(Math.floor(reg.troops * ((n.fronts || 0) >= 3 ? 0.6 : 0.33)), Math.ceil(threat[r] * ((n.fronts || 0) >= 3 ? 700 : 300))) : 0;
        if (n.capital === r) keep = Math.max(keep, Math.floor(reg.troops * 0.35));
        const count = Math.min(movable(s, r), reg.sea ? reg.troops : reg.troops - 1000 - keep);
        if (count < 2000 && !reg.sea) continue;
        if (moveCheck(s, world, nid, r, nb.id, count, gens)) continue;
        let need = t.owner === null ? 1.25 : s.coalition?.target === t.owner && inCoalition(s, nid) ? 1.05 : 1.15 + (1 - n.aggression) * 0.45;
        const sameIsle = insular && !t.sea && M.of[nb.id] === home;
        if (drive && t.owner !== null) need = Math.max(0.95, need - 0.15 - drive * 0.25);
        if (building && t.owner !== null && !sameIsle) need += 0.4; // 내실 중엔 확실한 기회만
        if (sameIsle) need -= 0.15;
        // 소모전: 나보다 훨씬 약한 나라(국력 1.8배↑)는 비슷한 손실을 주고받아도 결국 버티지 못하니 확실치 않아도 갉아먹음
        if (t.owner !== null && !t.sea && nationPower(s, nid) >= nationPower(s, t.owner) * 1.8) need = Math.max(0.9, need - 0.25);
        // 돈이 넉넉하면 용병을 붙여 공격 (장수가 있을 때)
        const mc = !t.sea && !reg.sea && gens.length && n.gold > 150 * G ? Math.max(0, Math.min(mercCap(s, gens), Math.floor((n.gold - 80 * G) / mercPrice(s, gens) / 100) * 100)) : 0;
        const { est, opts: mo0 } = attackOption(s, world, nid, r, nb.id, count + mc, gens, need);
        const mo = mc ? { ...mo0, merc: mc } : mo0;
        if (est.ratio < need) continue;
        // 점령 후 지킬 수 있나: 빼앗은 땅 둘레의 적 병력이 남을 병력보다 많으면 감점 (먹고 뺏기는 소모 방지)
        let exposure = 0;
        if (!t.sea) for (const y of world.regions[nb.id].neighbors) {
          const e = s.regions[y.id];
          if (y.id !== r && !e.sea && e.owner !== null && e.owner !== nid && hostile(s, nid, e.owner)) exposure += e.troops;
        }
        const left = (count + mc) * Math.max(0.2, 1 - 0.7 / Math.max(0.5, est.ratio));
        // 사방이 적(전선 3개↑)인 나라만 적용
        const exposed = !drive && (n.fronts || 0) >= 3 && t.owner !== null && exposure > left * 1.2 ? 10 + Math.min(10, (exposure - left) / 3000) : 0;
        const value = (t.sea ? 10 : t.pop * 0.6) + (t.owner !== null && !t.sea && s.nations[t.owner].capital === nb.id ? 25 : 0) - exposed;
        opts.push({ score: 38 + value + Math.min(est.ratio, 4) * 5 + targetBonus(s, nid, t.owner) - cost * 4 + n.aggression * 10 + (reg.sea ? (island ? 25 : 15) : 0) + (sameIsle ? 15 : 0) + (drive && t.owner !== null ? drive * 20 : 0) - (building && t.owner !== null && !sameIsle ? 20 : 0), run: () => planMove(s, world, nid, r, nb.id, count, gens, mo) });
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
          const count = Math.min(movable(s, r), reg.troops - 1000 - (threat[r] > 0 ? Math.ceil(threat[r] * 400) : 0));
          if (count < (island ? 3000 : 6000)) continue;
          // 바로 앞바다 또는 (섬나라는) 한 칸 더 건너 상륙할 곳
          // 나보다 약한 나라의 해안은 한 칸 더 건너서라도, 덜 확실해도 계속 상륙해 갉아먹음 (섬나라 압박)
          const weaker = (o) => s.regions[o.target].owner !== null && nationPower(s, nid) >= nationPower(s, s.regions[o.target].owner) * 1.5;
          const reach = overseas(s, world, nid, r).filter((o) => o.zone === z.id && (island || o.via === null || weaker(o)) && (o.via === null || !s.regions[o.via].troops || s.regions[o.via].owner === nid));
          // 가까운 곳이 아니라 가장 약해 보이는 해안을 노림
          const target = reach.filter((o) => {
            const t = s.regions[o.target];
            return !(t.owner !== null && s.turn <= 3) && t.troops * (weaker(o) ? 1.05 : 1.6) < count * (o.type === 'cliff' ? 0.45 : 0.75);
          }).sort((a, b) => s.regions[a.target].troops - s.regions[b.target].troops)[0];
          if (!target || moveCheck(s, world, nid, r, z.id, count, gens)) continue;
          opts.push({
            score: 30 + s.regions[target.target].pop * 0.4 + (island ? 25 : 0) + (s.regions[target.target].owner === n.goal ? 10 : 0) - (target.via !== null ? 5 : 0),
            run: () => {
              const res = planMove(s, world, nid, r, z.id, count, gens);
              if (res.ok && target.via !== null) n.voyage = { at: z.id, to: target.via, turn: s.turn };
              return res;
            },
          });
        }
      }
    }
    // 원정 함대: 계획한 다음 바다로 항해
    const vy = n.voyage;
    if (vy && s.turn - vy.turn <= 2 && fleets.includes(vy.at)) {
      const gens = gensIn(s, vy.at, nid).map((g) => g.id);
      const cnt = movable(s, vy.at);
      const blocked = s.regions[vy.to].owner !== null && s.regions[vy.to].owner !== nid && s.regions[vy.to].troops > 0;
      if (!blocked && moveCost(world, vy.at, vy.to, s) <= n.ap && !moveCheck(s, world, nid, vy.at, vy.to, cnt, gens))
        opts.push({ score: 45, run: () => { const res = planMove(s, world, nid, vy.at, vy.to, cnt, gens); n.voyage = null; return res; } });
    } else if (vy) n.voyage = null;
    // 바다에 남은 함대는 가까운 아군 해안으로 귀환
    for (const z of fleets) {
      if (s.regions[z].guard === nid && s.regions[z].troops >= 3000) continue;
      if (n.voyage && n.voyage.at === z) continue;
      const back = world.regions[z].neighbors.find((x) => (x.type === 'landing' || x.type === 'cliff') && s.regions[x.id].owner === nid);
      if (back && movable(s, z) > 0 && !moveCheck(s, world, nid, z, back.id, movable(s, z), [])) {
        const gens = gensIn(s, z, nid).map((g) => g.id);
        opts.push({ score: 12, run: () => planMove(s, world, nid, z, back.id, movable(s, z), gens) });
      }
    }
    // 경비 함대: 적 해안과 맞닿은 바다에 함대를 띄워 바닷길을 막음 (해전 유도)
    if (!fleets.some((z) => s.regions[z].guard === nid) && s.turn > 3) {
      for (const r of mine) {
        const reg = s.regions[r];
        if (!reg.buildings.port || reg.troops < 14000) continue;
        const z = world.regions[r].neighbors.find((x) => {
          if (x.type !== 'coast' || s.regions[x.id].owner !== null) return false;
          return world.regions[x.id].neighbors.some((y) => !s.regions[y.id].sea && s.regions[y.id].owner !== null && s.regions[y.id].owner !== nid && hostile(s, nid, s.regions[y.id].owner));
        });
        if (!z) continue;
        const cnt = Math.round(Math.min(8000, reg.troops / 4, movable(s, r)) / 100) * 100;
        if (moveCheck(s, world, nid, r, z.id, cnt, [])) continue;
        opts.push({ score: island ? 22 : 11, run: () => { const res = planMove(s, world, nid, r, z.id, cnt, []); if (res.ok) s.regions[z.id].guard = nid; return res; } });
        break;
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
        return k.loyalty > (r.loyalty ?? 100) - 45 || k.gold > n.gold - 20 * G || a > net * 0.5 + Math.max(0, n.gold - 200 * G) / 40;
      };
      while (amount > 1000 && bad(amount)) amount -= 500;
      if (amount >= 1000 && conscriptCost(s, c, amount, mode).gold <= n.gold) opts.push({ score: 24 + Math.min(threat[c], 40) * 0.6 + (n.gold > 120 * G ? 12 : 0) + (dist[c] === 0 ? 6 : 0) + (building ? 8 : 0) + drive * 10, run: () => doConscript(s, world, nid, c, amount, mode) });
    }
    // 진휼: 반란 위험 지역
    const sad = mine.filter((r) => (s.regions[r].loyalty ?? 100) < 28 && (s.regions[r].reliefTurn === undefined || s.turn - s.regions[r].reliefTurn >= RELIEF_COOLDOWN)).sort((a, b) => s.regions[a].loyalty - s.regions[b].loyalty)[0];
    if (sad !== undefined && n.gold >= reliefCost(s, sad) + 40 * G) opts.push({ score: 27, run: () => doRelief(s, nid, sad) });
    if (n.ap >= 2 && n.gold >= 110 * G) {
      const wall = mine.filter((r) => !s.regions[r].buildings.walls && threat[r] > 8).sort((a, b) => threat[b] - threat[a])[0];
      if (wall !== undefined && n.gold >= buildCost(s, wall, nid, 'walls') + 30 * G) opts.push({ score: 20 + Math.min(threat[wall], 40) * 0.4, run: () => doBuild(s, world, nid, wall, 'walls') });
      const mk = mine.filter((r) => !s.regions[r].buildings.market).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (mk !== undefined && n.gold >= buildCost(s, mk, nid, 'market') + 30 * G) opts.push({ score: 19 + s.regions[mk].pop * 0.2 + (building ? 6 : 0), run: () => doBuild(s, world, nid, mk, 'market') });
      const br = mine.filter((r) => !s.regions[r].buildings.barracks && dist[r] <= 1).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
      if (br !== undefined && n.gold >= 200 * G) opts.push({ score: 15, run: () => doBuild(s, world, nid, br, 'barracks') });
      const pt = mine.filter((r) => world.regions[r].coastal && !s.regions[r].buildings.port).map((r) => [r, s.regions[r].troops / 1000 + (overseas(s, world, nid, r).length ? 60 : 0)]).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (pt !== undefined && n.gold >= (island ? 160 : 220) * G) opts.push({ score: island ? 32 : 13, run: () => doBuild(s, world, nid, pt, 'port') });
    }
    // 공성병기: 성벽 있는 적지와 맞닿은 전선
    // 매수: 돈이 넉넉하면 장수 곁의 민심 낮은 땅·중립지를 돈으로
    if (n.gold >= 150 * G && n.ap >= 1) {
      let best = null;
      for (const g of nationGenerals(s, nid)) {
        if (g.order || g.bribed === s.turn || s.regions[g.region].owner !== nid) continue;
        for (const x of world.regions[g.region].neighbors) {
          const t = s.regions[x.id];
          if (t.sea || t.owner === nid || (t.owner !== null && (s.nations[t.owner].capital === x.id || getRel(s, nid, t.owner).type !== 'none'))) continue;
          const c = bribeChance(s, world, nid, x.id, g), cost = bribeCost(s, x.id);
          if (c < 0.4 || cost > n.gold - 60 * G) continue;
          const v = c * (10 + t.pop) - cost / G / 20;
          if (!best || v > best.v) best = { v, rid: x.id, gid: g.id, c };
        }
      }
      if (best) opts.push({ score: 18 + best.c * 12, run: () => doBribe(s, world, nid, best.rid, best.gid) });
    }
    for (const r of mine) {
      const reg = s.regions[r];
      if (reg.troops < 5000 || dist[r] === undefined || dist[r] === 0) continue;
      let nb = world.regions[r].neighbors.find((x) => !s.regions[x.id].sea && s.regions[x.id].owner === nid && dist[x.id] < dist[r]);
      if (!nb) continue;
      // 내 땅 안에서는 2칸 행군으로 더 빨리 전선에 닿음
      const far = world.regions[nb.id].neighbors.find((x) => x.id !== r && dist[x.id] < dist[nb.id] && marchVia(world, s, r, x.id) !== null);
      if (far) nb = far;
      const gens = gensIn(s, r, nid).map((g) => g.id);
      const mv = Math.min(movable(s, r), reg.troops - 1000);
      if (mv < 1000 || moveCheck(s, world, nid, r, nb.id, mv, gens, { auto: true })) continue;
      opts.push({ score: 14 + (mv / 1000) * 0.4, run: () => planMove(s, world, nid, r, nb.id, mv, gens, { engines: reg.engines || 0, auto: true }) });
    }
    // 원군: 위협받는 동맹국 땅에 여유 병력을 보냄
    for (const r of mine) {
      const reg = s.regions[r];
      if (reg.troops < 15000 || threat[r] > 0 || n.capital === r) continue;
      for (const x of world.regions[r].neighbors) {
        const t = s.regions[x.id];
        if (t.sea || t.owner === null || t.owner === nid || getRel(s, nid, t.owner).type !== 'alliance') continue;
        let enemy = 0;
        for (const y of world.regions[x.id].neighbors) {
          const e = s.regions[y.id];
          if (e.owner !== null && e.owner !== t.owner && e.owner !== nid && getRel(s, t.owner, e.owner).type === 'none') enemy += e.troops;
        }
        if (enemy < t.troops * 1.3 || enemy < 10000) continue;
        const cnt = Math.round(Math.min(reg.troops / 3, movable(s, r)) / 100) * 100;
        if (moveCheck(s, world, nid, r, x.id, cnt, [])) continue;
        opts.push({ score: 16 + Math.min(20, (enemy - t.troops) / 3000), run: () => planMove(s, world, nid, r, x.id, cnt, []) });
        break;
      }
    }
    genIndexOff();
    if (!opts.length) break;
    opts.sort((a, b) => b.score - a.score);
    const res = opts[0].run();
    if (!res || !res.ok) break;
  }
  genIndexOff();
}

// AI 외교: 다른 AI와 자동 협상, 플레이어에게는 제안을 보냄
// 강한 이웃이 생기면 그 이웃과 맞닿은 다른 나라에 동맹·공동 공격을 제안
function seekCoalition(s, world, nid, rng) {
  const myP = nationPower(s, nid);
  const nbs = new Set();
  for (const r of nationRegions(s, nid)) for (const nb of world.regions[r].neighbors) {
    const o = s.regions[nb.id].owner;
    if (o !== null && o !== nid && !s.regions[nb.id].sea) nbs.add(o);
  }
  const threat = [...nbs].filter((o) => hostile(s, nid, o) && nationPower(s, o) > myP * 1.4).sort((a, b) => nationPower(s, b) - nationPower(s, a))[0];
  if (threat === undefined || !rng.chance(0.5)) return false;
  const bordersThreat = (x) => nationRegions(s, x).some((r) => world.regions[r].neighbors.some((nb) => s.regions[nb.id].owner === threat));
  const partners = s.nations.filter((o) => o.alive && !o.fief && !o.horde && o.id !== nid && o.id !== threat && bordersThreat(o.id) && getRel(s, o.id, threat).type !== 'alliance' && !isVassalOf(s, o.id, threat));
  if (!partners.length) return false;
  const o = rng.pick(partners);
  const deal = emptyDeal();
  const rel = getRel(s, nid, o.id);
  if (rel.type === 'alliance') {
    if (s.joint.some((j) => (j.a === nid || j.b === nid) && j.target === threat)) return false;
    deal.treaty = 'joint';
    deal.target = threat;
  } else if (rel.type === 'none') deal.treaty = 'alliance';
  else return false;
  if (validateDeal(s, world, nid, o.id, deal)) return false;
  if (o.isPlayer) {
    if (s.proposals.length < 2) s.proposals.push({ from: nid, deal, text: describeDeal(s, nid, o.id, deal) + ` (공동의 위협: ${s.nations[threat].name})` });
    return true;
  }
  if (evaluateDeal(s, world, nid, o.id, deal) >= 0) applyDeal(s, world, nid, o.id, deal);
  return true;
}

// 사방이 동맹·조약으로 막혀 칠 곳이 없으면, 가장 만만한 조약 이웃과 관계를 끊고 확장
function breakOut(s, world, nid, rng) {
  const n = s.nations[nid];
  if (s.turn < 15 || n.isPlayer) return false;
  const nbs = new Map();
  let open = 0;
  for (const r of nationRegions(s, nid)) for (const x of world.regions[r].neighbors) {
    const t = s.regions[x.id];
    if (t.sea || t.owner === nid) continue;
    if (t.owner === null || hostile(s, nid, t.owner)) open++;
    else nbs.set(t.owner, (nbs.get(t.owner) || 0) + 1);
  }
  if (open > 0 || !nbs.size || !rng.chance(0.35)) return false;
  // 속국은 병합 대상이므로 제외, 국력이 가장 약한 조약국을 고름
  const cands = [...nbs.keys()].filter((o) => !s.nations[o].isPlayer && getRel(s, nid, o).type !== 'vassal' && !(inCoalition(s, nid) && inCoalition(s, o)));
  if (!cands.length) return false;
  const o = cands.reduce((a, b) => (nationPower(s, b) < nationPower(s, a) ? b : a));
  if (nationPower(s, o) > nationPower(s, nid) * 1.1) return false;
  breakTreaty(s, nid, o);
  s.opinion[nid][o] = Math.min(s.opinion[nid][o], -30);
  n.goal = o;
  n.goalSince = s.turn;
  return true;
}

export function aiDiplomacy(s, world, nid) {
  const rng = stateRng(s);
  const n = s.nations[nid];
  // 군단(분봉)과 도적 무리는 외교를 하지 않음
  if (n.fief || n.horde) return;
  if (breakOut(s, world, nid, rng)) return;
  if (seekCoalition(s, world, nid, rng)) return;
  const others = s.nations.filter((o) => o.alive && o.id !== nid);
  if (!others.length) return;
  const neighbors = new Set();
  for (const r of nationRegions(s, nid)) for (const nb of world.regions[r].neighbors) {
    const o = s.regions[nb.id].owner;
    if (o !== null && o !== nid && !s.regions[nb.id].sea) neighbors.add(o);
  }
  // 전선 정리: 3개국 이상과 싸우는 중이면 목표 하나만 남기고 나머지와 불가침을 청함 (금을 얹어서)
  // 다 거절하면 → 새 전선을 열지 않고 목표만 치며 수비(n.fronts로 공격 판단에 반영)
  const foes = [...neighbors].filter((o) => !s.nations[o].horde && getRel(s, nid, o).type === 'none');
  n.fronts = foes.length;
  // 중원 나라는 처음부터(15턴 안) 넉넉한 금(+50%)으로 이웃과 화친을 청함
  if ((foes.length >= 3 && (s.turn < 40 || (n.lost || 0) > 0) && rng.chance(0.5)) || (n.heartland && s.turn <= 15 && foes.length >= 2)) {
    n.napTried = n.napTried || {};
    const cand = foes.filter((o) => o !== n.goal && (n.napTried[o] ?? -99) < s.turn - 5).sort((a, b) => nationPower(s, b) - nationPower(s, a))[0];
    if (cand !== undefined) {
      n.napTried[cand] = s.turn;
      const deal = emptyDeal();
      deal.treaty = 'nap';
      deal.give.gold = Math.min(Math.round(n.gold * (n.heartland ? 0.35 : 0.25)), Math.round(nationPower(s, cand) * (n.heartland ? 0.2 : 0.1)) * G);
      if (!validateDeal(s, world, nid, cand, deal)) {
        if (s.nations[cand].isPlayer) {
          if (s.proposals.length < 2) s.proposals.push({ from: nid, deal, text: describeDeal(s, nid, cand, deal) + ' (사방이 적이라 화친을 청함)' });
        } else if (evaluateDeal(s, world, nid, cand, deal) >= 0) applyDeal(s, world, nid, cand, deal);
        return;
      }
    }
  }
  if (!rng.chance(0.18)) return;
  const pool = others.filter((o) => neighbors.has(o.id) || rng.chance(0.2));
  if (!pool.length) return;
  const o = rng.pick(pool);
  const rel = getRel(s, nid, o.id);
  const myP = nationPower(s, nid), theirP = nationPower(s, o.id);
  const op = s.opinion[nid][o.id];
  const deal = emptyDeal();
  if (rel.type === 'none' && (n.lost || 0) >= 2.5 && neighbors.has(o.id) && theirP > myP * 0.9) {
    // 땅을 연달아 잃는 중: 금을 주고 정전 요청
    deal.treaty = 'truce';
    deal.give.gold = Math.min(n.gold, Math.round(n.gold * 0.2));
  } else if (rel.type === 'none' && op > 25) deal.treaty = 'alliance';
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
