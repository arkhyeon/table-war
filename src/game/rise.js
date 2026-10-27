import { G } from './rules.js';
import { CIVS, makeNamer } from './civs.js';
import { POOLS, parseGeneral } from './generals.js';
import { addGeneral, computeMaxAp, log, nationRegions, gensIn, getRel } from './engine.js';
import { fmtGold } from './format.js';
import { colorFor } from './setup.js';

// 신흥국 출현: 몰락한 왕의 부흥, 빈 땅의 봉기, 민심이 바닥난 지역의 독립
const MAX_IDS = 62;

function civNear(s, world, rid) {
  const w = world.regions[rid];
  let civ = 'china', bd = Infinity;
  for (const n of s.nations) {
    if (n.capital === null || n.capital === undefined) continue;
    const c = world.regions[n.capital];
    const d = Math.hypot(c.cx - w.cx, c.cy - w.cy);
    if (d < bd) { bd = d; civ = n.civ; }
  }
  return civ;
}

function freshName(s, civ, rng) {
  const used = new Set(s.nations.filter((n) => n.alive).map((n) => n.name));
  const dead = new Set(s.nations.filter((n) => !n.alive).map((n) => n.name));
  const list = rng.shuffle([...(CIVS[civ]?.nations || CIVS.china.nations)]);
  const free = list.find((x) => !used.has(x) && !dead.has(x));
  if (free) return free;
  const revived = list.find((x) => !used.has('후' + x));
  if (revived) return '후' + revived;
  for (const p of ['북', '남', '동', '서']) for (const x of list) if (!used.has(p + x)) return p + x;
  return `${list[0]}${s.nations.length}`;
}

// 장수 하나 고르기: 떠돌던 장수(멸망국 출신) → 역사 장수 풀 → 이름 없는 호족
function leaderFor(s, civ, rng) {
  const wand = Object.values(s.generals).filter((g) => g.status === 'gone' && (g.pool === civ || CIVS[g.pool]?.name === CIVS[civ]?.name));
  if (wand.length) return { old: rng.pick(wand) };
  const pool = (POOLS[civ] || []).filter((g) => !s.usedGen[g.id]);
  if (pool.length) return { data: rng.pick(pool) };
  const nm = makeNamer(rng)(civ);
  return { data: parseGeneral(`${nm} 호족|${rng.int(55, 75)}|${rng.int(55, 75)}|${rng.int(45, 70)}|${rng.int(45, 70)}|통솔`, `rise_${s.turn}_${nm}`) };
}

function newNation(s, civ, name) {
  const id = s.nations.length;
  const n = {
    id, name, color: colorFor(id), civ, pools: [civ], capital: null, gold: 60 * G, ap: 0, maxAp: 0,
    reputation: 50, taxRate: 'normal', alive: true, isPlayer: false, aggression: 0.7, ruler: null, risen: s.turn,
  };
  s.nations.push(n);
  for (const row of s.opinion) row.push(0);
  s.opinion.push(s.nations.map(() => 0));
  return n;
}

function seize(s, world, n, rids, troopsMult = 1) {
  for (const rid of rids) {
    const r = s.regions[rid];
    const old = r.owner;
    if (old !== null) {
      const home = nationRegions(s, old).filter((x) => !rids.includes(x));
      for (const g of gensIn(s, rid, old)) g.region = s.nations[old].capital !== rid && s.nations[old].capital !== null ? s.nations[old].capital : home[0];
      if (s.nations[old].capital === rid) s.nations[old].capital = home.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] ?? null;
      s.opinion[old][n.id] = -50;
      s.opinion[n.id][old] = -40;
    }
    r.owner = n.id;
    r.troops = Math.max(3000, Math.round((r.troops * troopsMult) / 100) * 100);
    r.loyalty = 70;
  }
  n.capital = rids[0];
}

// 신흥국 소식: 모든 나라에 알리고 지도에서 깜빡임
function announceRise(s, n, rids, icon, title, story, others = []) {
  (s.turnEvents = s.turnEvents || []).push({ icon, title, story, effect: `${n.name} 건국 (${rids.length}개 지역)`, nations: [n.id, ...others], global: true, rids });
}

function finish(s, n, king) {
  king.status = 'active';
  king.captor = null;
  king.nation = n.id;
  king.region = n.capital;
  king.loyalty = 100;
  n.ruler = king.id;
  n.maxAp = computeMaxAp(s, n.id);
  n.ap = 0;
}

// 1) 부흥: 망국의 왕이었던 장수가 불만을 품고 옛 땅에서 거병
function tryRestore(s, world, rng) {
  const cands = Object.values(s.generals).filter((g) => {
    if (!g.exKing || g.status !== 'active' || (g.loyalty ?? 100) >= 50 || s.turn - (g.joined ?? 0) < 8) return false;
    const host = s.nations[g.nation];
    if (!host?.alive || host.isPlayer || host.ruler === g.id || host.capital === g.region) return false;
    return (s.regions[g.region].loyalty ?? 100) < 70;
  });
  if (!cands.length) return false;
  const king = rng.pick(cands);
  const host = king.nation;
  const base = king.region;
  const rids = [base, ...world.regions[base].neighbors.map((x) => x.id).filter((x) => !s.regions[x].sea && s.regions[x].owner === host && (s.regions[x].loyalty ?? 100) < 60 && s.nations[host].capital !== x)].slice(0, 3);
  if (nationRegions(s, host).length - rids.length < 2) return false;
  const old = s.nations.find((n) => !n.alive && n.name === king.exKing && n.id !== s.playerId);
  let n;
  if (old) {
    n = old;
    Object.assign(n, { alive: true, gold: 60 * G, reputation: 50, goal: null, posture: null, risen: s.turn, grudge: host });
  } else {
    if (s.nations.length >= MAX_IDS) return false;
    n = newNation(s, king.pool && CIVS[king.pool] ? king.pool : civNear(s, world, base), king.exKing);
  }
  seize(s, world, n, rids, 1);
  finish(s, n, king);
  announceRise(s, n, rids, '🔥', `${n.name} 부흥`, `옛 군주 ${king.name}이(가) ${s.nations[host].name}의 지배에 반기를 들고 옛 나라를 되살렸습니다.`, [host]);
  log(s, `🔥 옛 ${n.name}의 군주 ${king.name}이(가) ${s.nations[host].name}에 반기를 들고 ${n.name}을(를) 부흥했습니다! (${rids.length}개 지역)`, [n.id, host], 'warn');
  return true;
}

// 2) 신흥: 주인 없는 땅이나 민심이 무너진 변방에서 새 나라가 일어남
function tryRise(s, world, rng) {
  if (s.nations.length >= MAX_IDS) return false;
  const opts = [];
  for (let rid = 0; rid < s.regions.length; rid++) {
    const r = s.regions[rid];
    if (r.sea) continue;
    if (r.owner === null) {
      const nb = world.regions[rid].neighbors.filter((x) => !s.regions[x.id].sea && s.regions[x.id].owner === null).map((x) => x.id);
      if (nb.length) opts.push({ rids: [rid, ...nb.slice(0, 2)], w: 1 + nb.length, mult: 1.3 });
    } else {
      const own = s.nations[r.owner];
      if (own.isPlayer || own.capital === rid || (r.loyalty ?? 100) >= 30 || nationRegions(s, r.owner).length < 8) continue;
      opts.push({ rids: [rid], w: 2, mult: 0.8, from: r.owner });
    }
  }
  if (!opts.length) return false;
  const o = rng.weighted(opts, (x) => x.w);
  const civ = civNear(s, world, o.rids[0]);
  const lead = leaderFor(s, civ, rng);
  const n = newNation(s, civ, freshName(s, civ, rng));
  seize(s, world, n, o.rids, o.mult);
  const king = lead.old || addGeneral(s, lead.data, n.id, n.capital, rng, true);
  finish(s, n, king);
  const how = o.from !== undefined ? `${s.nations[o.from].name}의 학정에 맞서 ${s.regions[o.rids[0]].name}에서 독립` : `${s.regions[o.rids[0]].name} 일대의 빈 땅에서 거병`;
  announceRise(s, n, o.rids, '🌱', `신흥국 ${n.name} 출현`, `${king.name}이(가) ${how}했습니다.`, o.from !== undefined ? [o.from] : []);
  log(s, `🌱 ${king.name}이(가) ${how}해 신흥국 ${n.name}을(를) 세웠습니다!`, o.from !== undefined ? [n.id, o.from] : [n.id], 'warn');
  return true;
}

// 천운: 한 나라가 크게 앞서면 가끔(언제일지 모름) 판을 흔드는 일이 생김
// 앞설수록 잦아짐(30%부터, 최대 턴당 8%), 한 번 일어나면 8턴은 조용
export function fortune(s, world, rng) {
  if (s.turn < 15 || s.opts?.noRise) return;
  if (s.fortuneTurn !== undefined && s.turn - s.fortuneTurn < 8) return;
  const land = s.regions.filter((r) => !r.sea).length;
  const alive = s.nations.filter((n) => n.alive);
  if (alive.length < 2) return;
  const sizeOf = (id) => nationRegions(s, id).length;
  const leader = alive.reduce((a, b) => (sizeOf(b.id) > sizeOf(a.id) ? b : a));
  const share = sizeOf(leader.id) / land;
  if (share < 0.3 || rng() >= Math.min(0.08, (share - 0.3) * 0.25)) return;
  const L = leader.id;
  const rivals = alive.filter((n) => n.id !== L && getRel(s, n.id, L).type !== 'vassal');
  if (!rivals.length) return;
  const touch = new Set();
  for (const r of nationRegions(s, L)) for (const nb of world.regions[r].neighbors) {
    const o = s.regions[nb.id].owner;
    if (o !== null && o !== L && rivals.some((x) => x.id === o)) touch.add(o);
  }
  const front = rivals.filter((n) => touch.has(n.id));
  const kinds = [];
  // ① 대반란: 민심이 낮은 땅 몇 곳이 한꺼번에 들고일어남
  const sore = nationRegions(s, L).filter((r) => r !== leader.capital && (s.regions[r].loyalty ?? 100) < 70).sort((a, b) => (s.regions[a].loyalty ?? 100) - (s.regions[b].loyalty ?? 100));
  if (sore.length && s.nations.length < MAX_IDS) kinds.push(['revolt', 1]);
  // ② 명장 망명: 패권국의 이름난 장수가 맞수에게 귀순
  const star = Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === L && g.id !== leader.ruler).sort((a, b) => b.war + b.lead - (a.war + a.lead))[0];
  if (star) kinds.push(['defect', 1]);
  // ③ 반패권 원조: 천하가 패권국을 경계해 맞닿은 나라들에 군자금·의병이 모임
  kinds.push(['aid', 1.2]);
  const kind = rng.weighted(kinds, (k) => k[1])[0];
  s.fortuneTurn = s.turn;
  const ev = (icon, title, story, effect, nations, rids) => {
    (s.turnEvents = s.turnEvents || []).push({ icon, title, story, effect, nations, global: true, rids });
    log(s, `${icon} ${title} — ${effect}`, nations, 'warn');
  };
  if (kind === 'revolt') {
    const k = Math.max(2, Math.min(5, Math.round(sizeOf(L) * 0.04)));
    const base = sore[0];
    const rids = [base];
    for (let i = 0; i < rids.length && rids.length < k; i++) {
      for (const nb of world.regions[rids[i]].neighbors) {
        if (rids.length >= k) break;
        if (!s.regions[nb.id].sea && s.regions[nb.id].owner === L && nb.id !== leader.capital && !rids.includes(nb.id)) rids.push(nb.id);
      }
    }
    if (sizeOf(L) - rids.length < 3) return;
    const civ = civNear(s, world, base);
    const lead = leaderFor(s, civ, rng);
    const n = newNation(s, civ, freshName(s, civ, rng));
    seize(s, world, n, rids, 1.2);
    const king = lead.old || addGeneral(s, lead.data, n.id, n.capital, rng, true);
    finish(s, n, king);
    for (const x of rivals) { s.opinion[n.id][x.id] = 30; s.opinion[x.id][n.id] = 20; }
    ev('🔥', `대반란 — ${n.name} 봉기`, `${leader.name}의 천하가 굳어 가자 ${s.regions[base].name} 일대의 백성이 ${king.name}을(를) 받들고 일어섰습니다.`, `${leader.name}의 ${rids.length}개 지역이 ${n.name}(으)로 독립`, [L, n.id], rids);
  } else if (kind === 'defect') {
    const to = rng.weighted(front.length ? front : rivals, (n) => 1 + nationRegions(s, n.id).length);
    const dest = to.capital ?? nationRegions(s, to.id)[0];
    if (dest === undefined) return;
    Object.assign(star, { nation: to.id, region: dest, loyalty: 70 });
    delete star.order;
    ev('🏃', `명장 망명 — ${star.name}`, `${leader.name}의 견제와 시기를 견디지 못한 ${star.name}이(가) 밤을 틈타 ${to.name}(으)로 달아났습니다.`, `${star.name}(무${star.war}/통${star.lead})이(가) ${to.name}에 귀순`, [L, to.id]);
  } else {
    const got = (front.length ? front : rivals).slice().sort((a, b) => nationRegions(s, b.id).length - nationRegions(s, a.id).length).slice(0, 4);
    const df = s.df || 1;
    const gold = Math.round((40 + share * 120) * G / got.length / 1000) * 1000;
    const men = Math.round(((4000 + share * 16000) * df) / got.length / 100) * 100;
    for (const n of got) {
      n.gold += gold;
      const at = n.capital ?? nationRegions(s, n.id)[0];
      if (at !== undefined) s.regions[at].troops += men;
    }
    ev('🤝', '반(反)패권의 기운', `천하가 ${leader.name}의 독주를 두려워해 상인과 호족들이 ${got.map((n) => n.name).join('·')}에 군자금과 의병을 보냈습니다.`, `${got.map((n) => n.name).join('·')}: 각각 금 +${fmtGold(gold)}, 병력 +${men.toLocaleString('ko-KR')}`, [L, ...got.map((n) => n.id)]);
  }
}

export function riseNations(s, world, rng) {
  if (s.turn < 10 || s.opts?.noRise) return;
  if (rng() < 0.08 && tryRestore(s, world, rng)) return;
  if (rng() < 0.03) tryRise(s, world, rng);
}
