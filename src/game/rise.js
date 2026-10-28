import { G } from './rules.js';
import { CIVS, makeNamer } from './civs.js';
import { POOLS, parseGeneral } from './generals.js';
import { addGeneral, computeMaxAp, log, regionTax, commandCap, nationPower, nationRegions, gensIn, getRel, setRel, checkElimination, canAct, buildCost, DRAFT_GOLD, WALL_MAX, succession, nationGenerals, nationTrait } from './engine.js';
import { rating } from './generals.js';
import { tv } from './traits.js';
import { fmtTroops } from './format.js';
import { fmtGold } from './format.js';
import { emptyDeal, describeDeal, applyDeal } from './diplomacy.js';
import { colorFor } from './setup.js';
import { stateRng } from './rng.js';
import { PIRATES, FRONTIER, RAID_LEADERS, outlawName } from './outlaws.js';
import { getScenario } from './scenarios.js';

// 신흥국 출현: 몰락한 왕의 부흥, 빈 땅의 봉기 (영웅 봉기·계승 분쟁은 아래 장수 드라마)
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

// 변방 가중치: 살아 있는 나라 수도들의 한가운데에서 멀수록 큼 (새 나라·도적은 변방에서 일어남)
function edgeWeight(s, world) {
  const caps = s.nations.filter((n) => n.alive && n.capital !== null && n.capital !== undefined).map((n) => world.regions[n.capital]);
  if (!caps.length) return () => 1;
  const mx = caps.reduce((a, c) => a + c.cx, 0) / caps.length, my = caps.reduce((a, c) => a + c.cy, 0) / caps.length;
  const far = Math.max(1, ...world.regions.filter((r) => !r.sea).map((r) => Math.hypot(r.cx - mx, r.cy - my)));
  return (rid) => 0.03 + 6 * (Math.hypot(world.regions[rid].cx - mx, world.regions[rid].cy - my) / far) ** 3;
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
// 이민족·해적 수령: 그 무리의 역사 속 수령이 있으면 그 이름으로, 없으면 지어낸 이름
function raidLeader(s, name, civ, rng) {
  const base = name.replace(/ \d+$/, '');
  const used = new Set(Object.values(s.generals).map((g) => g.name));
  const cand = (RAID_LEADERS[base] || []).filter((x) => !used.has(x));
  if (cand.length) return { data: parseGeneral(`${rng.pick(cand)}|70|70|60|50|통솔`, `raid_${s.turn}_${s.nations.length}`) };
  // 역사 속 수령이 없으면 지어낸 이름 (다른 시대 인물이 끼지 않게)
  const nm = makeNamer(rng)(civ);
  return { data: parseGeneral(`${nm} ${/해적|왜구|수적|바이킹|코르세어/.test(base) ? '두목' : '수령'}|70|70|60|50|통솔`, `raid_${s.turn}_${s.nations.length}`) };
}
function leaderFor(s, civ, rng) {
  const wand = Object.values(s.generals).filter((g) => g.status === 'gone' && (g.pool === civ || CIVS[g.pool]?.name === CIVS[civ]?.name));
  if (wand.length) return { old: rng.pick(wand) };
  const pool = (POOLS[civ] || (civ === 'tk' ? POOLS.tk_free || [] : [])).filter((g) => !s.usedGen[g.id]);
  if (pool.length) return { data: rng.pick(pool) };
  const nm = makeNamer(rng)(civ);
  return { data: parseGeneral(`${nm} 호족|${rng.int(55, 75)}|${rng.int(55, 75)}|${rng.int(45, 70)}|${rng.int(45, 70)}|통솔`, `rise_${s.turn}_${nm}`) };
}

function newNation(s, civ, name) {
  const id = s.nations.length;
  const n = {
    id, name, color: colorFor(id), civ, pools: [civ], capital: null, gold: 60 * G, ap: 0, maxAp: 0,
    reputation: 50, alive: true, isPlayer: false, aggression: 0.7, ruler: null, risen: s.turn,
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
    return host?.alive && host.ruler !== g.id && host.capital !== g.region && s.regions[g.region].owner === g.nation;
  });
  if (!cands.length) return false;
  const king = rng.pick(cands);
  const host = king.nation;
  const base = king.region;
  const rids = [base, ...world.regions[base].neighbors.map((x) => x.id).filter((x) => !s.regions[x].sea && s.regions[x].owner === host && s.nations[host].capital !== x)].slice(0, 3);
  if (nationRegions(s, host).length - rids.length < 2) return false;
  const old = s.nations.find((n) => !n.alive && n.name === king.exKing && n.id !== s.playerId);
  // 한 나라는 한 번만 부흥 (망했다 살았다를 되풀이하지 않게)
  if (old?.restored) return false;
  let n;
  if (old) {
    n = old;
    Object.assign(n, { alive: true, gold: 60 * G, reputation: 50, goal: null, posture: null, risen: s.turn, grudge: host });
  } else {
    if (s.nations.length >= MAX_IDS) return false;
    n = newNation(s, king.pool && CIVS[king.pool] ? king.pool : civNear(s, world, base), king.exKing);
  }
  n.restored = true;
  seize(s, world, n, rids, 1);
  finish(s, n, king);
  announceRise(s, n, rids, '🔥', `${n.name} 부흥`, `옛 군주 ${king.name}이(가) ${s.nations[host].name}의 지배에 반기를 들고 옛 나라를 되살렸습니다.`, [host]);
  log(s, `🔥 옛 ${n.name}의 군주 ${king.name}이(가) ${s.nations[host].name}에 반기를 들고 ${n.name}을(를) 부흥했습니다! (${rids.length}개 지역)`, [n.id, host], 'warn');
  return true;
}

// 2) 신흥: 주인 없는 땅에서 새 나라가 일어남
function tryRise(s, world, rng) {
  if (s.nations.length >= MAX_IDS) return false;
  const opts = [];
  for (let rid = 0; rid < s.regions.length; rid++) {
    const r = s.regions[rid];
    if (r.sea) continue;
    if (r.owner === null) {
      const nb = world.regions[rid].neighbors.filter((x) => !s.regions[x.id].sea && s.regions[x.id].owner === null).map((x) => x.id);
      if (nb.length) opts.push({ rids: [rid, ...nb.slice(0, 2)], w: 1 + nb.length, mult: 1.3 });
    }
  }
  if (!opts.length) return false;
  const ew = edgeWeight(s, world);
  const o = rng.weighted(opts, (x) => x.w * ew(x.rids[0]));
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
// 앞설수록 잦아짐(25%부터, 최대 턴당 10%), 한 번 일어나면 8턴은 조용
export function fortune(s, world, rng) {
  // 한 판에 두 번까지만, 한 번 일어나면 10턴은 조용
  if (s.turn < 15 || s.opts?.noRise || topShare(s).share >= ENDGAME || (s.fortuneCount || 0) >= 2) return;
  if (s.fortuneTurn !== undefined && s.turn - s.fortuneTurn < 10) return;
  const land = s.regions.filter((r) => !r.sea).length;
  const alive = s.nations.filter((n) => n.alive);
  if (alive.length < 2) return;
  const sizeOf = (id) => nationRegions(s, id).length;
  const leader = alive.reduce((a, b) => (sizeOf(b.id) > sizeOf(a.id) ? b : a));
  const share = sizeOf(leader.id) / land;
  if (share < 0.25 || rng() >= Math.min(0.1, (share - 0.25) * 0.3)) return;
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
  // ① 대반란: 수도에서 가장 먼 변경 몇 곳이 한꺼번에 들고일어남
  const lc = world.regions[leader.capital ?? nationRegions(s, L)[0]];
  const farOf = (r) => Math.hypot(world.regions[r].cx - lc.cx, world.regions[r].cy - lc.cy);
  const sore = nationRegions(s, L).filter((r) => r !== leader.capital && !s.regions[r].sea).sort((a, b) => farOf(b) - farOf(a));
  if (sore.length && s.nations.length < MAX_IDS) kinds.push(['revolt', 1]);
  // ② 명장 망명: 패권국의 이름난 장수가 맞수에게 귀순
  const star = Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === L && g.id !== leader.ruler).sort((a, b) => b.war + b.lead - (a.war + a.lead))[0];
  if (star) kinds.push(['defect', 1]);
  // ③ 반패권 원조: 천하가 패권국을 경계해 맞닿은 나라들에 군자금·의병이 모임
  kinds.push(['aid', 1.2]);
  const kind = rng.weighted(kinds, (k) => k[1])[0];
  s.fortuneTurn = s.turn;
  s.fortuneCount = (s.fortuneCount || 0) + 1;
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

// 통일 막바지: 한 나라(속국 포함)가 육지 80% 이상이면 새 나라·도적·천운이 더는 생기지 않고, 작은 나라들이 스스로 속국을 청함
export function topShare(s) {
  const land = s.regions.filter((r) => !r.sea).length;
  let best = null, bs = 0;
  for (const n of s.nations) {
    if (!n.alive) continue;
    const lord = s.nations.find((o) => o.alive && getRel(s, n.id, o.id).type === 'vassal' && getRel(s, n.id, o.id).overlord === o.id);
    if (lord) continue;
    const mine = s.nations.filter((m) => m.alive && (m.id === n.id || (getRel(s, m.id, n.id).type === 'vassal' && getRel(s, m.id, n.id).overlord === n.id)));
    const sz = mine.reduce((a, m) => a + nationRegions(s, m.id).length, 0);
    if (sz > bs) { bs = sz; best = n; }
  }
  return { leader: best, share: bs / land };
}
export const ENDGAME = 0.8;
export function endgame(s, world, rng) {
  const { leader, share } = topShare(s);
  if (!leader || share < ENDGAME) return;
  const land = s.regions.filter((r) => !r.sea).length;
  // 최후의 동맹: 남은 나라들이 한 번 뭉침 (속국이 되기 싫은 나라들끼리)
  if (!s.lastStand) {
    s.lastStand = true;
    const rest = s.nations.filter((n) => n.alive && n.id !== leader.id && !n.horde && !n.fief && getRel(s, n.id, leader.id).type !== 'vassal');
    if (rest.length >= 2) {
      for (const a of rest) for (const b of rest) if (a.id < b.id) setRel(s, a.id, b.id, { type: 'alliance', since: s.turn });
      (s.turnEvents = s.turnEvents || []).push({ icon: '🛡️', title: '최후의 동맹', story: `${leader.name}이(가) 천하의 8할을 차지하자 ${rest.map((n) => n.name).join('·')}이(가) 끝까지 맞서기로 손을 잡았습니다.`, effect: '남은 나라들이 서로 동맹', nations: [leader.id, ...rest.map((n) => n.id)], global: true });
      log(s, `🛡️ 최후의 동맹: ${rest.map((n) => n.name).join('·')}`, [leader.id, ...rest.map((n) => n.id)], 'diplo');
    }
  }
  for (const n of s.nations) {
    if (!n.alive || n.id === leader.id || n.horde || n.fief || getRel(s, n.id, leader.id).type === 'vassal') continue;
    if (nationRegions(s, n.id).length > Math.max(4, Math.round(share * land * 0.1)) || rng() >= 0.15) continue;
    const deal = emptyDeal();
    deal.treaty = 'vassal_me';
    if (leader.isPlayer) {
      if ((s.proposals || []).some((p) => p.from === n.id) || (s.proposals || []).length >= 2) continue;
      (s.proposals = s.proposals || []).push({ from: n.id, deal, text: `천하의 대세가 기울었습니다. ${describeDeal(s, n.id, leader.id, deal)}` });
    } else {
      applyDeal(s, world, n.id, leader.id, deal);
      log(s, `🙇 ${n.name}이(가) 대세를 받아들여 ${leader.name}의 속국이 되었습니다.`, [n.id, leader.id], 'diplo');
    }
  }
}

export function riseNations(s, world, rng) {
  if (s.turn < 10 || s.opts?.noRise || topShare(s).share >= ENDGAME) return;
  if (rng() < 0.015 && tryRestore(s, world, rng)) return;
  if (rng() < 0.015) tryRise(s, world, rng);
}

// ───────── 분봉: 장수에게 땅을 맡겨 스스로 다스리게 함 (내 나라의 일부, 언제든 회수) ─────────
const lighten = (hsl) => hsl.replace(/hsl\((\d+), (\d+)%, (\d+)%\)/, (_, h, sat, l) => `hsl(${h}, ${Math.max(30, sat - 15)}%, ${Math.min(78, +l + 18)}%)`);
export const FIEF_TRIBUTE = 0; // 상납 없음: 군단은 수입을 스스로 쓰고, 큰일이 있으면 지원을 청함

// 맡길 땅: 고른 지역에서 이어진 내 땅(수도 제외) n곳
export function fiefRegions(s, world, pid, start, n) {
  const ok = (r) => s.regions[r].owner === pid && !s.regions[r].sea && s.nations[pid].capital !== r;
  if (!ok(start)) return [];
  const out = [start];
  for (let i = 0; i < out.length && out.length < n; i++) {
    for (const nb of world.regions[out[i]].neighbors) {
      if (out.length >= n) break;
      if ((nb.type === 'land' || nb.type === 'river') && ok(nb.id) && !out.includes(nb.id)) out.push(nb.id);
    }
  }
  return out;
}

export function grantFiefCheck(s, pid, gid, rids) {
  const g = s.generals[gid];
  if (!g || g.status !== 'active' || g.nation !== pid || g.order) return '맡길 장수를 고르세요.';
  if (s.nations[pid].ruler === gid) return '군주는 맡길 수 없습니다.';
  if (!rids.length) return '맡길 땅이 없습니다.';
  if (nationRegions(s, pid).length - rids.length < 2) return '내 나라에 땅이 너무 적게 남습니다.';
  if (s.nations.length >= MAX_IDS) return '더 이상 나라를 만들 수 없습니다.';
  return canAct(s, pid, 1);
}

export function grantFief(s, world, pid, gid, rids) {
  const err = grantFiefCheck(s, pid, gid, rids);
  if (err) return { ok: false, msg: err };
  const me = s.nations[pid], g = s.generals[gid];
  me.ap -= 1;
  const n = newNation(s, me.civ, `${g.name} 군단`);
  Object.assign(n, { fief: true, lord: pid, color: lighten(me.color), pools: me.pools || [me.civ], gold: 40 * G, aggression: 0.8 });
  for (const rid of rids) {
    for (const x of gensIn(s, rid, pid)) if (x.id !== gid) x.region = me.capital;
    s.regions[rid].owner = n.id;
  }
  n.capital = rids.includes(g.region) ? g.region : rids[0];
  Object.assign(g, { nation: n.id, region: n.capital });
  delete g.governor;
  n.ruler = g.id;
  n.maxAp = computeMaxAp(s, n.id);
  n.ap = 0;
  setRel(s, n.id, pid, { type: 'vassal', overlord: pid, since: s.turn });
  syncFiefs(s);
  s.opinion[n.id][pid] = 60;
  log(s, `🏯 ${g.name}에게 ${rids.length}개 지역을 맡겼습니다. ${n.name}이(가) 스스로 다스리며 상납 없이 스스로 다스리며, 큰일이 있으면 지원을 청합니다.`, [pid, n.id], 'diplo');
  return { ok: true, msg: `${n.name}을(를) 세웠습니다.` };
}

export function revokeFief(s, world, pid, fid) {
  const f = s.nations[fid];
  if (!f?.alive || !f.fief || f.lord !== pid) return { ok: false, msg: '내 군단이 아닙니다.' };
  for (const rid of nationRegions(s, fid)) s.regions[rid].owner = pid;
  for (const r of s.regions) if (r.sea && r.owner === fid) r.owner = pid;
  for (const g of Object.values(s.generals)) if (g.nation === fid && g.status === 'active') { g.nation = pid; if (g.id === f.ruler) g.loyalty = Math.max(0, (g.loyalty ?? 60) - 10); }
  s.nations[pid].gold += Math.max(0, f.gold);
  f.gold = 0;
  s.orders = (s.orders || []).filter((o) => o.n !== fid);
  log(s, `🏯 ${f.name}의 땅을 거두어들였습니다.`, [pid], 'diplo');
  checkElimination(s, world, fid);
  return { ok: true, msg: `${f.name}을(를) 회수했습니다.` };
}

// 군단은 종주국과 같은 외교 관계를 따름
export function syncFiefs(s) {
  for (const f of s.nations) {
    if (!f.alive || !f.fief) continue;
    for (const o of s.nations) {
      if (o.id === f.id || o.id === f.lord) continue;
      const r = getRel(s, f.lord, o.id);
      setRel(s, f.id, o.id, r.type === 'vassal' ? null : r);
      s.opinion[f.id][o.id] = s.opinion[f.lord][o.id];
    }
  }
}

// 군단 명령: 자유(스스로 판단) · 수비(나라는 치지 않음) · 공략(정한 나라만 침)
export function setFiefOrder(s, pid, fid, order) {
  const f = s.nations[fid];
  if (!f?.alive || !f.fief || f.lord !== pid) return { ok: false, msg: '내 군단이 아닙니다.' };
  f.order = order || null;
  f.goal = order?.kind === 'attack' ? order.target : null;
  const g = s.generals[f.ruler];
  const what = !order ? '스스로 판단해 싸우라' : order.kind === 'defend' ? '맡은 땅을 지키라' : `${s.nations[order.target].name}을(를) 공략하라`;
  return { ok: true, msg: `${g?.name || f.name}에게 「${what}」고 명했습니다.` };
}
// 군단과 맞닿은 적국 (공략 대상 후보)
export function fiefFoes(s, world, fid) {
  const f = s.nations[fid];
  const out = new Set();
  for (const r of nationRegions(s, fid)) for (const x of world.regions[r].neighbors) {
    const o = s.regions[x.id].owner;
    if (o !== null && o !== fid && o !== f.lord && !s.regions[x.id].sea && s.nations[o].alive && !s.nations[o].horde && !(s.nations[o].fief && s.nations[o].lord === f.lord) && getRel(s, f.lord, o).type !== 'alliance') out.add(o);
  }
  return [...out];
}

// 충성이 낮은 군단장은 역모를 꾀함
export function fiefLoyalty(s, world, rng) {
  for (const f of s.nations) {
    if (!f.alive || !f.fief) continue;
    const g = s.generals[f.ruler];
    const loy = g?.loyalty ?? 60;
    if (loy >= 40 || rng() >= (40 - loy) / 300) continue;
    f.fief = false;
    setRel(s, f.id, f.lord, null);
    s.opinion[f.lord][f.id] = -60;
    s.opinion[f.id][f.lord] = -40;
    f.name = `${g.name}의 나라`;
    (s.turnEvents = s.turnEvents || []).push({ icon: '🗡️', title: `역모 — ${g.name}`, story: `충성심이 바닥난 ${g.name}이(가) 맡겨진 땅을 들고 ${s.nations[f.lord].name}에 반기를 들었습니다.`, effect: `${f.name} 독립 (${nationRegions(s, f.id).length}개 지역)`, nations: [f.lord, f.id], global: true });
    log(s, `🗡️ ${g.name}이(가) 역모를 일으켜 독립했습니다!`, [f.lord, f.id], 'warn');
  }
}

// ───────── 도적 무리: 나라가 아닌 무리 (협상 불가), 빈 땅에서 일어나거나 변방에 쳐들어옴 ─────────
const HORDE = {
  china: ['황건적', '적미군', '녹림군', '홍건적', '백련교도'], tk: ['황건적', '흑산적', '백파적'], korea: ['초적', '명화적', '도적떼'],
  japan: ['잇키 무리', '왜구', '산적단'], steppe: ['마적단', '유목 도적'], arab: ['베두인 약탈자', '하와리지'], persia: ['아사신', '산적단'],
  turk: ['젤랄리 반도'], rome: ['노예 반란군', '해적단'], byzantine: ['해적단', '산적단'], frank: ['자크리 농민군', '용병 약탈단'],
  english: ['농민 반란군', '무법자 무리'], german: ['농민군', '약탈 기사단'], iberian: ['산적단', '해적단'], italian: ['용병 약탈단'],
  slavic: ['카자크 무리', '농민 반란군'], nordic: ['해적단'], india: ['다코이트'], southeast_asian: ['해적단'],
};
export function hordeName(s, civ, rng) {
  const used = new Set(s.nations.filter((n) => n.alive).map((n) => n.name));
  const list = HORDE[civ] || ['도적단', '산적단'];
  return rng.shuffle(list.slice()).find((x) => !used.has(x)) || `${rng.pick(list)} ${s.turn}`;
}
// 변방 침입: 지도 가장자리(나라들 한가운데에서 먼 곳)의 빈 땅이나 남의 변경 땅에 이민족·해적이 쳐들어옴
function frontierName(s, civ, rng) {
  const used = new Set(s.nations.filter((n) => n.alive).map((n) => n.name));
  for (let k = 0; k < 6; k++) { const nm = outlawName(FRONTIER, civ, yearNow(s), rng); if (!used.has(nm)) return nm; }
  return `${outlawName(FRONTIER, civ, yearNow(s), rng)} ${s.turn}`;
}
// 침입군 기준: 지금 병력을 가장 많이 이끄는 장수 10명의 병력·능력치 중간값 (판이 커질수록 침입도 커짐)
function medianOf(a) {
  const b = a.slice().sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : 0;
}
export function topTen(s) {
  const gens = Object.values(s.generals).filter((g) => g.status === 'active' && s.nations[g.nation]?.alive && !s.nations[g.nation].horde);
  const lead = gens.map((g) => {
    const a = g.army !== undefined && s.armies?.[g.army];
    const r = s.regions[g.region];
    return { g, t: a ? a.troops : Math.min(r?.troops || 0, commandCap(s, [g.id])) };
  }).sort((a, b) => b.t - a.t).slice(0, 10);
  const stat = (k) => Math.round(medianOf(lead.map((x) => x.g[k])));
  return { troops: Math.max(10000 * (s.df || 1), medianOf(lead.map((x) => x.t))), war: stat('war') || 70, lead: stat('lead') || 70, intel: stat('intel') || 60, pol: stat('pol') || 55 };
}
// 등급: 약함 25% · 보통 40% · 강함 25% · 엄청 강함 10%
export const RAID_TIERS = [['약한', 0.6, 0.25], ['보통', 1, 0.4], ['강한', 1.4, 0.25], ['엄청 강한', 2, 0.1]];
function rollTier(rng) {
  const x = rng();
  let acc = 0;
  for (const t of RAID_TIERS) { acc += t[2]; if (x < acc) return t; }
  return RAID_TIERS[1];
}
// 침입군 대장: 능력치를 상위 10명 중간값으로 (등급이 높으면 조금 더)
function hardenLeader(king, base, tier) {
  const plus = tier[1] >= 2 ? 8 : tier[1] >= 1.4 ? 4 : tier[1] < 1 ? -5 : 0;
  for (const k of ['war', 'lead', 'intel', 'pol']) king[k] = Math.max(30, Math.min(100, base[k] + plus));
}

export function spawnHorde(s, world, rng) {
  if (s.turn < 8 || s.opts?.noRise || s.nations.length >= MAX_IDS || topShare(s).share >= ENDGAME) return;
  // 변방 침입: 턴당 8% (해적 4%와 합쳐 8턴에 한 번꼴)
  if (s.nations.filter((n) => n.alive && n.horde && !n.pirate).length >= 4 || rng() >= 0.08) return;
  const ew = edgeWeight(s, world);
  const df = s.df || 1;
  const opts = [];
  // 변방 침입은 변방의 큰 나라일수록 잘 당함 (변방국도 후방을 신경 쓰게)
  const size = {};
  for (const r of s.regions) if (!r.sea && r.owner !== null) size[r.owner] = (size[r.owner] || 0) + 1;
  for (let rid = 0; rid < s.regions.length; rid++) {
    const r = s.regions[rid];
    if (r.sea) continue;
    const w = world.regions[rid];
    // 도적은 처음부터 빈 땅의 소굴로만 (봉기 없음) — 게임 중엔 변방 이민족만 쳐들어옴
    if (r.owner !== null && !s.nations[r.owner].horde && s.nations[r.owner].capital !== rid && nationRegions(s, r.owner).length >= 4) {
      // 남의 변경: 빈 땅에 닿았거나 지도 바깥쪽 국경이면 그 시대의 변방 이민족 (해안 약탈은 해적단이 따로)
      const wild = w.neighbors.some((x) => !s.regions[x.id].sea && s.regions[x.id].owner === null);
      if (wild || ew(rid) > 3) {
        // 처음 들이닥칠 때 국경 땅과 맞닿은 같은 나라 땅까지 2~3곳을 휩쓺 (수도 제외)
        const more = w.neighbors.map((x) => x.id).filter((x) => !s.regions[x].sea && s.regions[x].owner === r.owner && s.nations[r.owner].capital !== x).slice(0, 2);
        opts.push({ rids: [rid, ...more], w: 1.2 * (1 + (size[r.owner] || 0) / 15), mult: 1, sea: false, from: r.owner });
      }
    }
  }
  if (!opts.length) return;
  const o = rng.weighted(opts, (x) => x.w * ew(x.rids[0]));
  const civ = civNear(s, world, o.rids[0]);
  const n = newNation(s, civ, o.from !== undefined ? frontierName(s, civ, rng) : hordeName(s, civ, rng));
  const lead = o.from !== undefined ? raidLeader(s, n.name, civ, rng) : leaderFor(s, civ, rng);
  Object.assign(n, { horde: true, aggression: 1, color: 'hsl(25, 12%, 30%)', gold: 0 });
  seize(s, world, n, o.rids, o.mult);
  // 변방 이민족: 상위 장수 10명의 병력 중간값 × 등급, 대장도 그 중간값 능력치
  const base = topTen(s);
  const tier = o.from !== undefined ? rollTier(rng) : null;
  if (tier) {
    n.tier = tier[0];
    // 본대는 처음 땅에, 휩쓴 땅마다 20%씩 남김
    const total = Math.round((base.troops * tier[1]) / 100) * 100;
    o.rids.forEach((rid, k) => { s.regions[rid].troops = Math.round((k === 0 ? total * (1 - 0.2 * (o.rids.length - 1)) : total * 0.2) / 100) * 100; });
  }
  const king = lead.old || addGeneral(s, lead.data, n.id, n.capital, rng, true);
  if (tier) hardenLeader(king, base, tier);
  finish(s, n, king);
  const where = s.regions[o.rids[0]].name;
  const story = o.from === undefined ? `${where} 일대에서 ${king.name}이(가) 이끄는 ${n.name}이(가) 일어나 약탈을 시작했습니다.` : o.sea ? `${n.name}의 배들이 ${where} 해안에 들이닥쳐 ${s.nations[o.from].name}의 땅을 빼앗았습니다.` : `변방 너머에서 ${king.name}이(가) 이끄는 ${n.name}이(가) 쳐들어와 ${s.nations[o.from].name}의 ${where}을(를) 휩쓸었습니다.`;
  (s.turnEvents = s.turnEvents || []).push({ icon: o.from === undefined ? '🏴' : o.sea ? '🏴‍☠️' : '🐎', title: o.from === undefined ? `${n.name} 봉기` : `변방 침입 — ${n.tier} ${n.name}`, story: story + ' 이들과는 협상할 수 없습니다.', effect: tier ? `${tier[0]} 무리 ${fmtTroops(o.rids.reduce((a, x) => a + s.regions[x].troops, 0))} · ${o.rids.length}곳 장악 · 대장 ${king.name}(무${king.war}/통${king.lead})` : `${o.rids.length}개 지역 장악`, nations: o.from !== undefined ? [n.id, o.from] : [n.id], global: true, rids: o.rids });
  log(s, `${o.from === undefined ? '🏴' : '🐎'} ${n.name}이(가) ${where}에 나타났습니다!`, o.from !== undefined ? [n.id, o.from] : [n.id], 'warn');
  if (o.from !== undefined) checkElimination(s, world, o.from);
}

// ───────── 해적단: 바다에 머물며 해안 땅을 약탈하고 함대를 덮침. 땅은 빼앗지 않고 피해만 줌. 격퇴(해전)할 때까지 머묾 ─────────
const yearNow = (s) => (getScenario(s.scenarioId)?.startYear ?? 1) + Math.floor((s.turn - 1) / 4);
const coastsOf = (s, world, z) => world.regions[z].neighbors.filter((x) => !s.regions[x.id].sea && s.regions[x.id].owner !== null && !s.nations[s.regions[x.id].owner].horde).map((x) => x.id);
// 해안 주인 중 가장 센 나라의 국력 (해적은 강한 나라를 노림)
const prey = (s, world, z) => Math.max(0, ...coastsOf(s, world, z).map((c) => nationPower(s, s.regions[c].owner)));
// 해적선 이동: 지금 바다에서 바닷길 4칸 안의 빈 바다 중, 센 나라의 해안을 낀 곳으로 (같은 곳에 머물지 않음)
function sail(s, world, n, z, rng) {
  const dist = new Map([[z, 0]]);
  const q = [z];
  for (let k = 0; k < q.length; k++) {
    if (dist.get(q[k]) >= 4) continue;
    for (const x of world.regions[q[k]].neighbors) if (s.regions[x.id].sea && !dist.has(x.id)) { dist.set(x.id, dist.get(q[k]) + 1); q.push(x.id); }
  }
  const cand = [...dist.keys()].filter((i) => i !== z && (s.regions[i].owner === null || s.regions[i].troops <= 0) && coastsOf(s, world, i).length);
  if (!cand.length) return z;
  const to = rng.weighted(cand, (i) => prey(s, world, i) ** 2 + 1);
  const me = s.regions[z];
  s.regions[to].owner = n.id;
  s.regions[to].troops = me.troops;
  for (const g of Object.values(s.generals)) if (g.nation === n.id && g.region === z) g.region = to;
  me.owner = null;
  me.troops = 0;
  n.capital = to;
  return to;
}
export function spawnPirates(s, world, rng) {
  if (s.turn < 10 || s.opts?.noRise || s.nations.length >= MAX_IDS) return;
  if (s.nations.filter((n) => n.alive && n.pirate).length >= 2 || rng() >= 0.04) return;
  const zones = s.regions.map((r, i) => i).filter((i) => s.regions[i].sea && (s.regions[i].owner === null || s.regions[i].troops <= 0) && coastsOf(s, world, i).length);
  if (!zones.length) return;
  // 센 나라 앞바다에 잘 나타남
  const z = rng.weighted(zones, (i) => prey(s, world, i) ** 2 + 1);
  const civ = civNear(s, world, z);
  const n = newNation(s, civ, outlawName(PIRATES, civ, yearNow(s), rng));
  const df = s.df || 1;
  Object.assign(n, { horde: true, pirate: true, aggression: 1, color: 'hsl(0, 0%, 12%)', gold: 0, capital: z, pirateBase: 0 });
  const r = s.regions[z];
  r.owner = n.id;
  // 해적도 상위 장수 10명의 병력 중간값 × 등급
  const base = topTen(s);
  const tier = rollTier(rng);
  n.tier = tier[0];
  r.troops = Math.round((base.troops * tier[1]) / 100) * 100;
  n.pirateMax = r.troops * 2;
  const lead = raidLeader(s, n.name, civ, rng);
  const king = lead.old || addGeneral(s, lead.data, n.id, z, rng, true);
  hardenLeader(king, base, tier);
  finish(s, n, king);
  const hit = [...new Set(coastsOf(s, world, z).map((c) => s.regions[c].owner))];
  (s.turnEvents = s.turnEvents || []).push({ icon: '🏴‍☠️', title: `해적 출몰 — ${n.tier} ${n.name}`, story: `${r.name}에 ${n.name}의 배 떼가 나타났습니다. 격퇴하지 않으면 바다에 머물며 해안을 약탈하고 배를 덮칩니다. 장수가 이끄는 함대로 해전을 벌여 몰아내세요.`, effect: `${n.tier} 무리 ${fmtTroops(r.troops)} · 대장 ${king.name}(무${king.war}/통${king.lead}) · 해안 ${coastsOf(s, world, z).length}곳 위협`, nations: [n.id, ...hit], global: true, rids: [z] });
  log(s, `🏴‍☠️ ${n.name}이(가) ${r.name}에 출몰했습니다!`, [n.id, ...hit], 'warn');
}

export function pirateTurn(s, world, rng) {
  const df = s.df || 1;
  for (const n of s.nations) {
    if (!n.alive || !n.pirate) continue;
    const z = s.regions.findIndex((r) => r.sea && r.owner === n.id);
    if (z < 0) { n.alive = false; continue; }
    const me = s.regions[z];
    n.capital = z;
    const P = me.troops;
    // 1) 옆 바다의 함대를 덮침
    const fleet = world.regions[z].neighbors.map((x) => x.id).find((i) => s.regions[i].sea && s.regions[i].owner !== null && s.regions[i].owner !== n.id && s.regions[i].troops > 0 && s.regions[i].troops < P * 0.9);
    if (fleet !== undefined && rng() < 0.6) {
      const f = s.regions[fleet];
      const victim = f.owner;
      const lost = Math.min(f.troops, Math.round((P * rng.range(0.2, 0.4)) / 100) * 100);
      f.troops -= lost;
      me.troops = Math.max(1000, me.troops - Math.round((lost * 0.3) / 100) * 100);
      if (f.troops <= 0) { f.troops = 0; f.owner = null; }
      log(s, `🏴‍☠️ ${n.name}이(가) ${f.name}의 ${s.nations[victim].name} 함대를 덮쳐 ${fmtTroops(lost)}을(를) 수장시켰습니다!`, [n.id, victim], 'warn');
      continue;
    }
    // 2) 해안 약탈: 그 바다에 닿은 해안 중 가장 센 나라 땅을 침 (같으면 가까운 곳). 해적 1명 = 병사 1명으로 맞바꿔 죽음
    const coasts = coastsOf(s, world, z);
    if (!coasts.length) { sail(s, world, n, z, rng); continue; }
    const zc = world.regions[z];
    const d = (a) => Math.hypot(world.regions[a].cx - zc.cx, world.regions[a].cy - zc.cy);
    const t = coasts.slice().sort((a, b) => nationPower(s, s.regions[b].owner) - nationPower(s, s.regions[a].owner) || d(a) - d(b))[0];
    const r = s.regions[t];
    const owner = s.nations[r.owner];
    const D = r.troops;
    const dead = Math.min(P, D);
    r.troops = Math.max(0, D - dead);
    me.troops = P - dead;
    if (me.troops <= 0) {
      // 수비대가 같거나 많음: 해적 전멸 (수비대도 해적 수만큼 잃음)
      me.owner = null; me.troops = 0; n.alive = false;
      for (const g of Object.values(s.generals)) if (g.nation === n.id && g.status === 'active') g.status = 'gone';
      log(s, `⚓ ${r.name}(${owner.name}) 수비대가 ${n.name}을(를) 물리쳤습니다! 해적 ${fmtTroops(P)} 전멸, 수비대 -${fmtTroops(dead)}.`, [n.id, r.owner], 'info');
      continue;
    }
    // 해적이 더 많음: 수비대를 쓸어버리고 살아남은 해적 수만큼 털어감
    //  금 = 살아남은 해적 1명당 3금(그 땅 세금 10턴치까지), 백성 = 해적 2명이 1명씩 끌고 감(그 땅 인구의 30%까지), 항구 불탐, 끌려간 백성의 20%가 해적이 됨
    const left = me.troops;
    // 털어갈 몫: 살아남은 해적 1명당 10금 (그 땅 세금 10턴치까지)
    const want = Math.min(regionTax(s, t) * 10, Math.round((left * 10) / 1000) * 1000);
    const gold = Math.min(owner.gold, want);
    // 금이 모자라면 그만큼 백성을 더 끌고 감 (모자란 20금당 1명, 합쳐 인구의 절반까지)
    const short = want - gold;
    const taken = Math.min(r.pop * 0.5, left / 2000 + short / 20 / 1000);
    owner.gold -= gold;
    n.gold += gold;
    r.pop = Math.max(1, Math.round((r.pop - taken) * 10) / 10);
    const burn = !!r.buildings.port;
    if (burn) r.buildings.port = 0;
    // 금이 절반도 안 나오면 분풀이로 시장까지 불태움
    const burnMk = short > want / 2 && !!r.buildings.market;
    if (burnMk) r.buildings.market = 0;
    me.troops = Math.min(n.pirateMax || left * 2, left + Math.round((taken * 1000 * 0.2) / 100) * 100);
    // 털고 나면 배를 몰아 다른 바다로 (센 나라 해안 쪽)
    sail(s, world, n, z, rng);
    log(s, `🏴‍☠️ ${n.name}(${fmtTroops(P)})이(가) ${r.name}(${owner.name})을(를) 덮쳤습니다! 수비대 ${fmtTroops(D)} 전멸(해적 -${fmtTroops(dead)}), 금 -${fmtGold(gold)}, 백성 ${Math.round(taken * 10) / 10}천 납치${short > 0 ? '(금이 모자라 더 끌고 감)' : ''}${burn ? ', 항구 불탐' : ''}${burnMk ? ', 시장 불탐' : ''}.`, [n.id, r.owner], 'warn');
  }
}

// 도적 무리가 6곳 이상을 차지하면 나라로 자리 잡음
export function promoteHordes(s, world, rng) {
  for (const n of s.nations) {
    if (!n.alive || !n.horde || nationRegions(s, n.id).length < 6) continue;
    const old = n.name;
    n.horde = false;
    n.name = freshName(s, n.civ, rng);
    n.color = colorFor(n.id);
    n.aggression = 0.8;
    (s.turnEvents = s.turnEvents || []).push({ icon: '👑', title: `${old} → ${n.name}`, story: `세력을 불린 ${old}이(가) 나라를 세우고 ${n.name}(이)라 칭했습니다. 이제 외교가 가능합니다.`, effect: `${n.name} 건국 (${nationRegions(s, n.id).length}개 지역)`, nations: [n.id], global: true });
    log(s, `👑 ${old}이(가) ${n.name}(으)로 나라를 세웠습니다!`, [n.id], 'warn');
  }
}

// 도적 회유: 돈을 주고 화친(8턴 불가침)하거나 통째로 거둬들임. 돈만 받고 응하지 않을 수도 있음
export function pacifyCost(s, hid, mode) {
  const troops = s.regions.reduce((a, r) => a + (r.owner === hid ? r.troops : 0), 0);
  return Math.round(((mode === 'absorb' ? 60 * G + troops * 10 : 20 * G + troops * 3)) / 1000) * 1000;
}
export function pacifyChance(s, nid, hid, mode) {
  const best = Math.max(0, ...Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === nid).map((g) => g.pol));
  const size = nationRegions(s, hid).length;
  return Math.max(0.1, Math.min(0.9, (mode === 'absorb' ? 0.35 - size * 0.04 : 0.6) + best / 500));
}
export function doPacify(s, world, nid, hid, mode) {
  const h = s.nations[hid], n = s.nations[nid];
  if (!h?.alive || !h.horde) return { ok: false, msg: '도적 무리가 아닙니다.' };
  const cost = pacifyCost(s, hid, mode);
  if (n.gold < cost) return { ok: false, msg: '금이 부족합니다.' };
  const err = canAct(s, nid, 1);
  if (err) return { ok: false, msg: err };
  n.gold -= cost;
  n.ap -= 1;
  if (stateRng(s)() >= pacifyChance(s, nid, hid, mode)) {
    h.gold += cost;
    log(s, `💸 ${h.name}이(가) 금 ${fmtGold(cost)}만 챙기고 응하지 않았습니다.`, [nid, hid], 'warn');
    return { ok: true, accepted: false, msg: `${h.name}이(가) 돈만 받고 응하지 않았습니다.` };
  }
  if (mode === 'peace') {
    setRel(s, nid, hid, { type: 'nap', until: s.turn + 8, since: s.turn });
    log(s, `🤝 ${h.name}에 금 ${fmtGold(cost)}을 주고 8턴 동안 화친했습니다.`, [nid, hid], 'diplo');
    return { ok: true, msg: `${h.name}과(와) 8턴 화친.` };
  }
  const me = s.nations[nid];
  for (const rid of nationRegions(s, hid)) {
    const r = s.regions[rid];
    r.owner = nid;
    r.troops = Math.max(100, Math.round((r.troops * 0.6) / 100) * 100);
  }
  for (const g of Object.values(s.generals)) if (g.nation === hid && g.status === 'active') { g.nation = nid; g.loyalty = 45; }
  log(s, `🏳️ ${h.name}이(가) 금 ${fmtGold(cost)}을 받고 ${me.name}에 귀순했습니다!`, [nid, hid], 'diplo');
  checkElimination(s, world, hid);
  return { ok: true, msg: `${h.name}을(를) 거둬들였습니다.` };
}

// 도적의 협박: 돈을 내면 한동안 안 치고, 거절하면 노림
export function hordeDemands(s, world, rng) {
  const pid = s.playerId;
  if (s.spectator || !s.nations[pid]?.alive) return;
  for (const h of s.nations) {
    if (!h.alive || !h.horde || getRel(s, pid, h.id).type !== 'none') continue;
    const touch = nationRegions(s, h.id).some((r) => world.regions[r].neighbors.some((x) => s.regions[x.id].owner === pid));
    if (!touch || rng() >= 0.15 || (s.proposals || []).length >= 2) continue;
    const ask = Math.round((pacifyCost(s, h.id, 'peace') * 0.8) / 1000) * 1000;
    if (s.nations[pid].gold < ask) continue;
    (s.proposals = s.proposals || []).push({ from: h.id, kind: 'horde', gold: ask, text: `${h.name}: "금 ${fmtGold(ask)}을 내놓으면 8턴 동안 건드리지 않겠다. 거절하면 쳐들어간다!"` });
  }
}

// 군단의 지원 요청: 군단이 실제로 하려는 일(성 쌓기·징병·시장·진휼)에 드는 금을 청함. 주면 그 일을 바로 하고 충성↑, 안 주면 충성↓
export function fiefRequests(s, world, rng) {
  if (s.spectator) return;
  for (const f of s.nations) {
    if (!f.alive || !f.fief || f.lord !== s.playerId) continue;
    if (f.askTurn !== undefined && s.turn - f.askTurn < 5) continue;
    if (rng() >= 0.25 || (s.proposals || []).length >= 2) continue;
    const mine = nationRegions(s, f.id);
    const border = mine.filter((r) => world.regions[r].neighbors.some((x) => !s.regions[x.id].sea && s.regions[x.id].owner !== f.id && s.regions[x.id].owner !== f.lord));
    const plans = [];
    const wall = border.filter((r) => !s.regions[r].buildings.walls).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
    if (wall !== undefined) plans.push({ act: 'walls', rid: wall, gold: buildCost(s, wall, f.id, 'walls'), say: `${s.regions[wall].name}에 성을 쌓으려 합니다`, done: `${s.regions[wall].name}에 성을 쌓았습니다` });
    const cr = mine.slice().sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
    if (cr !== undefined) {
      const amt = Math.floor((s.regions[cr].pop * 1000 * 0.08) / 100) * 100;
      if (amt >= 1000) plans.push({ act: 'draft', rid: cr, amt, gold: amt * DRAFT_GOLD, say: `${s.regions[cr].name}에서 병사 ${fmtTroops(amt)}을 모으려 합니다`, done: `${s.regions[cr].name}에서 병사 ${fmtTroops(amt)}을 모았습니다` });
    }
    const mk = mine.filter((r) => !s.regions[r].buildings.market).sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0];
    if (mk !== undefined) plans.push({ act: 'market', rid: mk, gold: buildCost(s, mk, f.id, 'market'), say: `${s.regions[mk].name}에 시장을 열려 합니다`, done: `${s.regions[mk].name}에 시장을 열었습니다` });
    if (!plans.length) continue;
    const pl = plans[Math.floor(rng() * plans.length)];
    f.askTurn = s.turn;
    const g = s.generals[f.ruler];
    (s.proposals = s.proposals || []).push({ from: f.id, kind: 'fief', gold: pl.gold, plan: pl, text: `${g?.name || f.name}: "${pl.say}. 금 ${fmtGold(pl.gold)}을 내려 주십시오." (주면 바로 시행·충성 +6, 거절하면 충성 -4)` });
  }
}
function fiefDo(s, f, pl) {
  const r = s.regions[pl.rid];
  if (r.owner !== f.id) return '그 땅을 이미 잃었습니다';
  if (pl.act === 'walls') r.buildings.walls = WALL_MAX;
  else if (pl.act === 'market') r.buildings.market = 1;
  else if (pl.act === 'draft') { r.troops += pl.amt; r.pop = Math.max(1, r.pop - pl.amt / 1000); }
  return null;
}
export function answerRequest(s, prop, yes) {
  const f = s.nations[prop.from];
  const me = s.nations[s.playerId];
  if (prop.kind === 'fief') {
    const g = s.generals[f.ruler];
    if (yes) {
      if (me.gold < prop.gold) return { ok: false, msg: '금이 부족합니다.' };
      const why = prop.plan ? fiefDo(s, f, prop.plan) : null;
      if (why) return { ok: true, msg: `${f.name}: ${why}.` };
      me.gold -= prop.gold;
      if (g) g.loyalty = Math.min(100, (g.loyalty ?? 60) + 6);
      log(s, `🏯 ${f.name}: 금 ${fmtGold(prop.gold)}을 받아 ${prop.plan?.done || '요청한 일을 했습니다'}.`, [s.playerId, f.id], 'info');
      return { ok: true, msg: `${f.name}: ${prop.plan?.done || '요청한 일을 했습니다'}. (금 -${fmtGold(prop.gold)}, 충성 +6)` };
    }
    if (g) g.loyalty = Math.max(0, (g.loyalty ?? 60) - 4);
    return { ok: true, msg: `${f.name}의 요청을 거절했습니다. (충성 -4)` };
  }
  if (prop.kind === 'horde') {
    if (yes) {
      if (me.gold < prop.gold) return { ok: false, msg: '금이 부족합니다.' };
      me.gold -= prop.gold;
      f.gold += prop.gold;
      setRel(s, s.playerId, f.id, { type: 'nap', until: s.turn + 8, since: s.turn });
      return { ok: true, msg: `${f.name}에 금을 주고 8턴 동안 화친했습니다.` };
    }
    f.goal = s.playerId;
    f.goalSince = s.turn;
    s.opinion[f.id][s.playerId] = -80;
    return { ok: true, msg: `${f.name}의 협박을 거절했습니다. 쳐들어올 수 있습니다.` };
  }
  if (prop.kind === 'ally') {
    if (yes) {
      if (me.gold < prop.gold) return { ok: false, msg: '금이 부족합니다.' };
      me.gold -= prop.gold;
      f.gold += prop.gold;
      s.opinion[f.id][s.playerId] += 20;
      log(s, `🤝 동맹국 ${f.name}에 군자금 ${fmtGold(prop.gold)}을 보냈습니다.`, [s.playerId, f.id], 'diplo');
      return { ok: true, msg: `${f.name}에 원조했습니다. (호감 +20)` };
    }
    s.opinion[f.id][s.playerId] -= 25;
    if (s.opinion[f.id][s.playerId] < -15 && getRel(s, f.id, s.playerId).type === 'alliance') {
      setRel(s, f.id, s.playerId, null);
      log(s, `💔 위기에 외면당한 ${f.name}이(가) 동맹을 끊었습니다.`, [s.playerId, f.id], 'diplo');
      return { ok: true, accepted: false, msg: `${f.name}이(가) 실망해 동맹을 끊었습니다.` };
    }
    return { ok: true, accepted: false, msg: `${f.name}의 원군 요청을 거절했습니다. (호감 -25)` };
  }
  return { ok: false, msg: '알 수 없는 요청' };
}

// ───────── 장수 드라마: 군주의 죽음·계승 분쟁·충성 변화·영웅 봉기 (민심 대신 판을 흔드는 것) ─────────
export const PERSONA = {
  야심: { icon: '🔥', desc: '야심가 — 충성이 쉽게 떨어지고, 낮으면 땅을 들고 봉기하거나 왕위를 다툼' },
  충신: { icon: '🛡️', desc: '충신 — 충성이 점점 오르고 배신하지 않음' },
};
const ownLand = (s, nid) => nationRegions(s, nid).filter((r) => !s.regions[r].sea);

// 장수가 땅을 들고 갈라져 나감 (봉기·계승 분쟁 공통)
function breakAway(s, world, host, g, rids, rng) {
  const H = s.nations[host];
  const n = newNation(s, H.civ, freshName(s, H.civ, rng));
  // 그 땅의 다른 장수: 절반은 따라가고 절반은 옛 주군에게 돌아감
  for (const rid of rids) for (const x of gensIn(s, rid, host)) {
    if (x.id === g.id) continue;
    if ((g.bonds || []).includes(x.id) || (x.persona !== '충신' && rng() < 0.5)) Object.assign(x, { nation: n.id, loyalty: 60 });
    else x.region = H.capital ?? x.region;
  }
  delete g.order;
  seize(s, world, n, rids, 1);
  finish(s, n, g);
  n.gold = Math.round(H.gold * (rids.length / Math.max(1, ownLand(s, host).length + rids.length)));
  H.gold -= n.gold;
  s.opinion[host][n.id] = -60;
  s.opinion[n.id][host] = -50;
  n.grudge = host;
  return n;
}

function successionCrisis(s, world, n, rng) {
  const land = ownLand(s, n.id);
  // 큰 나라(10곳↑)만, 천하에 한 번 일어나면 30턴은 잠잠
  if (land.length < 10 || n.horde || n.fief || s.turn - (s.lastSplit ?? -99) < 30) return;
  const king = s.generals[n.ruler];
  const claimant = nationGenerals(s, n.id).filter((g) => g.id !== n.ruler && g.persona !== '충신' && (g.persona === '야심' || (g.loyalty ?? 60) < 55)).sort((a, b) => rating(b) - rating(a))[0];
  if (!king || !claimant || rng() >= (claimant.persona === '야심' ? 0.35 : 0.12)) return;
  const C = world.regions[n.capital ?? land[0]];
  // 왕위를 노리는 자의 근거지: 그가 있는 곳 (수도면 수도에서 가장 먼 땅)
  const far = (r) => Math.hypot(world.regions[r].cx - C.cx, world.regions[r].cy - C.cy);
  const base = claimant.region !== n.capital && s.regions[claimant.region]?.owner === n.id ? claimant.region : land.reduce((a, b) => (far(b) > far(a) ? b : a));
  const P = world.regions[base];
  const toP = (r) => Math.hypot(world.regions[r].cx - P.cx, world.regions[r].cy - P.cy);
  const rids = land.filter((r) => r !== n.capital && toP(r) < far(r)).sort((a, b) => toP(a) - toP(b)).slice(0, Math.floor(land.length * 0.45));
  if (!rids.includes(base)) rids.unshift(base);
  if (rids.length < 2) return;
  claimant.region = base;
  s.lastSplit = s.turn;
  const m = breakAway(s, world, n.id, claimant, [base, ...rids.filter((r) => r !== base)], rng);
  (s.turnEvents = s.turnEvents || []).push({ icon: '👑', title: `계승 분쟁 — ${m.name}`, story: `${n.name}의 새 군주 ${king.name}을(를) 인정하지 않는 ${claimant.name}이(가) 스스로 왕을 칭하고 ${m.name}을(를) 세웠습니다.`, effect: `${n.name}이(가) 둘로 갈라짐 (${rids.length}개 지역 이탈)`, nations: [n.id, m.id], global: true, rids });
  log(s, `👑 계승 분쟁! ${claimant.name}이(가) ${n.name}에서 갈라져 나와 ${m.name}을(를) 세웠습니다.`, [n.id, m.id], 'warn');
}

export function generalDrama(s, world, rng) {
  if (s.opts?.noRise) return;
  const late = topShare(s).share >= ENDGAME;
  // 1) 군주의 죽음: 늙거나 병들어 (턴마다 0.5%), 전사·처형으로 빈 왕좌 → 새 군주 즉위, 큰 나라는 계승 분쟁 위험
  for (const n of s.nations.slice()) {
    if (!n.alive || n.horde) continue;
    const k = s.generals[n.ruler];
    if (k && k.status === 'active' && s.turn > 12 && !(n.healthy > s.turn) && rng() < 0.003) {
      k.status = 'dead';
      (s.turnEvents = s.turnEvents || []).push({ icon: '⚰️', title: `${k.name} 붕어`, story: `${n.name}의 군주 ${k.name}이(가) 세상을 떠났습니다.`, effect: '새 군주가 즉위합니다', nations: [n.id], global: n.isPlayer || ownLand(s, n.id).length >= 8 });
      log(s, `⚰️ ${n.name}의 군주 ${k.name}이(가) 세상을 떠났습니다.`, [n.id], 'general');
    }
    const k2 = s.generals[n.ruler];
    if (!k2 || (k2.status !== 'active' && k2.status !== 'prisoner')) {
      succession(s, n.id);
      if (n.ruler !== null && !late) successionCrisis(s, world, n, rng);
    }
  }
  // 2) 충성 변화: 충신은 오르고 야심가는 떨어짐, 평판·인덕 군주·땅을 잃는 중이면 반영
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active') continue;
    const n = s.nations[g.nation];
    if (!n?.alive || n.horde || n.ruler === g.id) continue;
    // 의형제가 같은 나라에 있으면 떠나지 않음 (+10)
    const bro = (g.bonds || []).some((b) => s.generals[b]?.status === 'active' && s.generals[b].nation === g.nation) ? 10 : 0;
    const rep = (n.reputation - 50) / 3 + nationTrait(s, n.id, '인덕') * 5 + bro;
    const target = g.persona === '충신' ? 100 : g.persona === '야심' ? 30 + rep : 65 + rep;
    const step = g.persona === '충신' ? 1 : 0.5;
    let loy = (g.loyalty ?? 60) + Math.max(-step, Math.min(step, target - (g.loyalty ?? 60)));
    if ((n.lost || 0) > 0 && g.persona !== '충신') loy -= 0.5;
    g.loyalty = Math.round(Math.max(0, Math.min(100, loy)) * 10) / 10;
  }
  // 컴퓨터는 충성이 위태로운 장수에게 포상
  for (const n of s.nations) {
    if (!n.alive || n.isPlayer || n.horde) continue;
    // 늘 제때 챙기지는 못함 (봉기할 틈이 생김)
    const g = nationGenerals(s, n.id).filter((x) => x.id !== n.ruler && (x.loyalty ?? 60) < 38).sort((a, b) => a.loyalty - b.loyalty)[0];
    if (g && n.gold > 120 * G && rng() < 0.35 && (g.rewardTurn === undefined || s.turn - g.rewardTurn >= 6)) {
      n.gold -= Math.round(((15 + (g.base || 60) * 0.2) * G) / 1000) * 1000;
      g.rewardTurn = s.turn;
      g.loyalty = Math.min(100, g.loyalty + (g.persona === '야심' ? 10 : 15));
    }
  }
  // 3) 영웅 봉기: 충성 40 아래의 장수가 지키던 땅을 들고 일어섬 (턴에 한 번까지, 큰 나라일수록 위험)
  // 영웅 봉기는 천하에 25턴에 한 번까지
  if (late || s.nations.length >= MAX_IDS || s.turn - (s.lastUprising ?? -99) < 40) return;
  const total = s.regions.filter((r) => !r.sea).length;
  for (const g of rng.shuffle(Object.values(s.generals).filter((x) => x.status === 'active' && x.persona !== '충신' && (x.loyalty ?? 60) < 40))) {
    const n = s.nations[g.nation];
    if (!n?.alive || n.horde || n.fief || n.ruler === g.id || n.capital === g.region || s.regions[g.region]?.owner !== n.id) continue;
    const land = ownLand(s, n.id);
    if (land.length < 8) continue;
    const p = ((40 - g.loyalty) / 900) * (g.persona === '야심' ? 2 : 1) * (0.6 + (land.length / total) * 4) * (1 - tv(gensIn(s, g.region, n.id).filter((x) => x.id !== g.id), '치안'));
    if (rng() >= p) continue;
    const k = Math.max(2, Math.min(5, Math.round(land.length * 0.08) + 1));
    const rids = [g.region];
    for (let i = 0; i < rids.length && rids.length < k; i++) {
      for (const nb of world.regions[rids[i]].neighbors) {
        if (rids.length >= k) break;
        if (!s.regions[nb.id].sea && s.regions[nb.id].owner === n.id && nb.id !== n.capital && !rids.includes(nb.id)) rids.push(nb.id);
      }
    }
    if (land.length - rids.length < 3) continue;
    const m = breakAway(s, world, n.id, g, rids, rng);
    s.lastUprising = s.turn;
    (s.turnEvents = s.turnEvents || []).push({ icon: '⚔️', title: `영웅 봉기 — ${g.name}`, story: `${n.name}에 불만을 품은 ${g.name}이(가) 지키던 ${s.regions[rids[0]].name} 일대를 들고 일어나 ${m.name}을(를) 세웠습니다.`, effect: `${n.name}의 ${rids.length}개 지역 이탈`, nations: [n.id, m.id], global: true, rids });
    log(s, `⚔️ ${g.name}이(가) ${n.name}에 반기를 들고 ${m.name}을(를) 세웠습니다!`, [n.id, m.id], 'warn');
    if (n.isPlayer) for (const x of nationGenerals(s, n.id)) if ((x.loyalty ?? 60) < 40) log(s, `⚠️ ${x.name}의 충성도 위태롭습니다 (${Math.round(x.loyalty)}). 포상을 고려하세요.`, [n.id], 'warn');
    break;
  }
}

// 동맹국의 원군 요청: 이번 턴 땅을 빼앗긴 동맹국이 플레이어에게 군자금을 청함 (거절하면 동맹이 식고, 심하면 끊김)
export function allyRequests(s, rng) {
  if (s.spectator) return;
  const pid = s.playerId;
  const lost = new Set((s.battles || []).filter((b) => b.win && b.defender !== null && b.attacker !== pid).map((b) => b.defender));
  for (const n of s.nations) {
    if (!n.alive || n.isPlayer || !lost.has(n.id) || getRel(s, n.id, pid).type !== 'alliance') continue;
    if ((n.allyAsk ?? -99) > s.turn - 6 || rng() >= 0.5 || (s.proposals || []).length >= 2) continue;
    n.allyAsk = s.turn;
    const gold = Math.round(Math.max(20 * G, s.nations[pid].gold * 0.08) / 1000) * 1000;
    (s.proposals = s.proposals || []).push({ from: n.id, kind: 'ally', gold, text: `동맹국 ${n.name}이(가) 적에게 땅을 빼앗기고 원군을 청합니다: "군자금 ${fmtGold(gold)}을 보내 주십시오!" (보내면 호감 +20, 거절하면 호감 -25·동맹이 깨질 수 있음)` });
  }
}
