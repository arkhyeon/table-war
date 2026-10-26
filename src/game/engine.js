import { stateRng } from './rng.js';
import { T, TERRAIN, EDGE, BUILDINGS, COST, TAX } from './rules.js';
import { fmtTroops } from './format.js';
import { POOLS, rating } from './generals.js';
import { fixJosa } from './josa.js';
import { weatherOf } from './weather.js';
import { simulateDuel, duelist } from './duel.js';

// ───────── 조회 헬퍼 ─────────
export const relKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const getRel = (s, a, b) => s.relations[relKey(a, b)] || { type: 'none' };
export const setRel = (s, a, b, rel) => {
  if (!rel || rel.type === 'none') delete s.relations[relKey(a, b)];
  else s.relations[relKey(a, b)] = rel;
};
export const nationRegions = (s, nid) => s.regions.reduce((acc, r, i) => (r.owner === nid ? (acc.push(i), acc) : acc), []);
export const gensIn = (s, rid, nid) => Object.values(s.generals).filter((g) => g.status === 'active' && g.region === rid && (nid === undefined || g.nation === nid));
export const nationGenerals = (s, nid) => Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === nid);
export const edgeBetween = (world, a, b) => world.regions[a].neighbors.find((n) => n.id === b) || null;
export const hasTrait = (gens, t) => gens.some((g) => g.trait === t);

export function log(s, text, nations = [], kind = 'info') {
  text = fixJosa(text);
  s.log.unshift({ turn: s.turn, text, nations, kind });
  if (s.log.length > 300) s.log.length = 300;
  if (nations.includes(s.playerId) && s.turnNews) s.turnNews.push(text);
}

export function nationPower(s, nid) {
  let p = 0;
  for (const r of s.regions) if (r.owner === nid) p += r.troops / 1000 + 6 + r.pop * 0.2;
  return p + s.nations[nid].gold / 10 + nationGenerals(s, nid).length * 8;
}

export function isVassalOf(s, a, b) {
  const r = getRel(s, a, b);
  return r.type === 'vassal' && r.overlord === b;
}

export function computeMaxAp(s, nid) {
  const n = s.nations[nid];
  const regions = nationRegions(s, nid).length;
  const fast = Math.min(2, nationGenerals(s, nid).filter((g) => g.trait === '신속').length);
  let ap = 3 + Math.min(5, Math.floor(regions / 6)) + fast;
  if (s.nations.some((o) => o.alive && o.id !== nid && isVassalOf(s, nid, o.id))) ap -= 1;
  return Math.max(2, ap);
}

// 지역별 세수: 매 턴 자동 징수 (세율·민심·시장·정치 장수 반영)
export const effTax = (s, rid) => s.regions[rid].tax || s.nations[s.regions[rid].owner]?.taxRate || 'normal';

export function regionTax(s, rid) {
  const r = s.regions[rid];
  let g = (1 + r.pop * 0.4) * TAX[effTax(s, rid)].mult * (0.4 + 0.6 * (r.loyalty ?? 100) / 100) * weatherOf(s, rid).tax;
  if (r.buildings.market) g *= 1.5;
  if (hasTrait(gensIn(s, rid, r.owner), '정치')) g *= 1.3;
  return g + (r.buildings.port ? 3 : 0);
}

export function income(s, nid) {
  let inc = 0, troops = 0;
  s.regions.forEach((r, i) => {
    if (r.owner !== nid) return;
    inc += regionTax(s, i);
    troops += r.troops;
  });
  inc = Math.round(inc);
  const army = Math.round(troops / 2500);
  const salary = nationGenerals(s, nid).length;
  const upkeep = army + salary;
  return { gross: inc, upkeep, army, salary, net: inc - upkeep, troops };
}

export function moveCost(world, from, to, s) {
  const e = edgeBetween(world, from, to);
  if (!e) return Infinity;
  let c = COST.move;
  if (e.type === 'sea') c += 1;
  if (world.regions[to].terrain === T.MOUNTAIN) c += 1;
  if (s) c += weatherOf(s, to).ap;
  return c;
}

// 보급: 수도에서 내 땅(육로·강, 양쪽 항구가 있는 바닷길)으로 이어진 지역
export function supplied(s, world, nid) {
  const set = new Set();
  const cap = s.nations[nid]?.capital;
  if (cap === null || cap === undefined || s.regions[cap].owner !== nid) return set;
  const q = [cap];
  set.add(cap);
  for (let i = 0; i < q.length; i++) {
    const r = q[i];
    for (const nb of world.regions[r].neighbors) {
      if (set.has(nb.id) || s.regions[nb.id].owner !== nid) continue;
      if (nb.type === 'sea' && !(s.regions[r].buildings.port && s.regions[nb.id].buildings.port)) continue;
      set.add(nb.id);
      q.push(nb.id);
    }
  }
  return set;
}

export const nationBuff = (s, nid, key) => (s.buffs || []).filter((b) => b.nid === nid && b.until >= s.turn).reduce((m, b) => m * (b[key] || 1), 1);

export const WALL_MAX = 3;

// ───────── 전투 계산 ─────────
export function battleFactors(s, world, nid, from, to, genIds) {
  const e = edgeBetween(world, from, to);
  const tr = s.regions[to];
  const terr = world.regions[to].terrain;
  const att = genIds.map((id) => s.generals[id]).filter(Boolean);
  const def = tr.owner === null ? [] : gensIn(s, to, tr.owner);
  const mods = [];
  let a = 1;
  if (att.length) {
    const best = Math.max(...att.map((g) => g.lead * 0.5 + g.war * 0.5));
    a += best / 250;
    mods.push(`장수 지휘 +${Math.round((best / 250) * 100)}%`);
    if (hasTrait(att, '명장')) { a += 0.15; mods.push('명장 +15%'); }
    if (hasTrait(att, '맹장')) { a += 0.1; mods.push('맹장 +10%'); }
    if (hasTrait(att, '책략')) { a += 0.1; mods.push('책략 +10%'); }
    if (hasTrait(att, '기마') && e.type !== 'sea' && [T.PLAINS, T.DESERT, T.TUNDRA].includes(terr)) { a += 0.15; mods.push('기마 +15%'); }
  }
  let edgeMult = EDGE[e.type].mult;
  if (e.type === 'river' && hasTrait(att, '도하')) edgeMult = 1;
  if (e.type === 'sea' && hasTrait(att, '수군')) edgeMult = 1;
  if (edgeMult < 1) mods.push(`${EDGE[e.type].name} ${Math.round((edgeMult - 1) * 100)}%`);
  if (terr === T.DESERT) { edgeMult *= 0.9; mods.push('사막 소모 -10%'); }
  const rel = tr.owner === null ? { type: 'none' } : getRel(s, nid, tr.owner);
  if (rel.type === 'nap' || rel.type === 'vassal') { a -= 0.15; mods.push('배신 사기저하 -15%'); }
  const w = weatherOf(s, to);
  let weather = w.att;
  if (e.type === 'river' && w.river) weather *= w.river;
  if (weather < 1) mods.push(`${w.icon}${w.name} ${Math.round((weather - 1) * 100)}%`);
  const attSupply = supplied(s, world, nid).has(from) ? 1 : 0.8;
  if (attSupply < 1) mods.push('보급 끊김 -20%');
  const buffA = nationBuff(s, nid, 'att');
  if (buffA !== 1) mods.push(`특수 효과 ${buffA > 1 ? '+' : ''}${Math.round((buffA - 1) * 100)}%`);

  let d = 1;
  if (def.length) {
    const best = Math.max(...def.map((g) => g.lead * 0.6 + g.intel * 0.4));
    d += best / 250;
    if (hasTrait(def, '수성')) d += 0.25;
    if (hasTrait(def, '책략')) d += 0.1;
  }
  let terrDef = TERRAIN[terr].def || 1;
  if (terr === T.MOUNTAIN && hasTrait(att, '산악')) terrDef = 1.1;
  const walls = 1 + 0.5 * Math.min(WALL_MAX, tr.buildings.walls || 0) / WALL_MAX;
  const capital = tr.owner !== null && s.nations[tr.owner].capital === to ? 1.1 : 1;
  const defSupply = tr.owner === null || supplied(s, world, tr.owner).has(to) ? 1 : 0.8;
  const buffD = tr.owner === null ? 1 : nationBuff(s, tr.owner, 'def');
  return {
    attMult: a * edgeMult * weather * attSupply * buffA,
    defMult: d * terrDef * walls * capital * defSupply * buffD,
    mods, def, att, edge: e, terrDef, walls, defSupply, weather: w,
  };
}

export function estimateBattle(s, world, nid, from, to, count, genIds) {
  const f = battleFactors(s, world, nid, from, to, genIds);
  const A = count * f.attMult;
  const D = s.regions[to].troops * f.defMult;
  let wins = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const a = A * (0.85 + Math.random() * 0.3), d = D * (0.85 + Math.random() * 0.3);
    if (a > d) wins++;
  }
  return { ...f, A, D, ratio: D > 0 ? A / D : 99, winChance: D <= 0 ? 1 : wins / trials };
}

// ───────── 행동 ─────────
const fail = (msg) => ({ ok: false, msg });

export function canAct(s, nid, ap) {
  const n = s.nations[nid];
  if (!n.alive) return '멸망한 국가입니다.';
  if (n.ap < ap) return `행동력이 부족합니다 (필요 ${ap}).`;
  return null;
}

export function conscriptAmount(s, rid, nid) {
  const r = s.regions[rid];
  let add = r.pop * 220 * (r.buildings.barracks ? 1.5 : 1);
  if (hasTrait(gensIn(s, rid, nid), '징병')) add *= 1.3;
  if ((r.loyalty ?? 100) < 40) add *= 0.5;
  return Math.max(1000, Math.round(add / 100) * 100);
}

export function doConscript(s, world, nid, rid) {
  const r = s.regions[rid];
  const n = s.nations[nid];
  if (r.owner !== nid) return fail('내 지역이 아닙니다.');
  if (r.conscripted) return fail('이번 턴에 이미 징병했습니다.');
  if (n.gold < COST.conscriptGold) return fail(`금이 부족합니다 (필요 ${COST.conscriptGold}).`);
  const err = canAct(s, nid, COST.conscript);
  if (err) return fail(err);
  const add = conscriptAmount(s, rid, nid);
  r.troops += add;
  r.pop = Math.max(3, r.pop - add * 0.0003);
  r.loyalty = Math.max(0, (r.loyalty ?? 100) - 6);
  r.conscripted = true;
  n.gold -= COST.conscriptGold;
  n.ap -= COST.conscript;
  return { ok: true, msg: `${r.name}에서 병사 ${fmtTroops(add)}을 징병했습니다. (민심 -6)` };
}

export function buildCost(s, rid, nid, kind) {
  const b = BUILDINGS[kind];
  const w = s.regions[rid].buildings.walls;
  const repair = kind === 'walls' && w > 0 && w < WALL_MAX ? 0.5 : 1;
  return Math.round(b.cost * repair * (hasTrait(gensIn(s, rid, nid), '건축') ? 0.7 : 1));
}

export function doBuild(s, world, nid, rid, kind) {
  const r = s.regions[rid];
  const n = s.nations[nid];
  const b = BUILDINGS[kind];
  if (r.owner !== nid) return fail('내 지역이 아닙니다.');
  const repair = kind === 'walls' && r.buildings.walls > 0 && r.buildings.walls < WALL_MAX;
  if (r.buildings[kind] && !repair) return fail(`이미 ${b.name}이(가) 있습니다.`);
  if (b.coastal && !world.regions[rid].coastal) return fail('해안 지역에만 건설할 수 있습니다.');
  const cost = buildCost(s, rid, nid, kind);
  if (n.gold < cost) return fail(`금이 부족합니다 (필요 ${cost}).`);
  const err = canAct(s, nid, b.ap);
  if (err) return fail(err);
  n.gold -= cost;
  n.ap -= b.ap;
  r.buildings[kind] = kind === 'walls' ? WALL_MAX : 1;
  return { ok: true, msg: repair ? `${r.name}의 성벽을 보수했습니다.` : `${r.name}에 ${b.name}을(를) 건설했습니다.` };
}

export function canSail(s, nid, from, genIds) {
  return !!s.regions[from].buildings.port || genIds.some((id) => s.generals[id]?.trait === '수군');
}

export function moveCheck(s, world, nid, from, to, count, genIds = []) {
  const fr = s.regions[from], tr = s.regions[to];
  if (fr.owner !== nid) return '내 지역에서만 출발할 수 있습니다.';
  const e = edgeBetween(world, from, to);
  if (!e) return '인접하지 않은 지역입니다.';
  if (e.type === 'sea' && !canSail(s, nid, from, genIds)) return '항해하려면 출발지에 항구가 있거나 수군 장수가 필요합니다.';
  if (e.type === 'sea' && (weatherOf(s, from).noSea || weatherOf(s, to).noSea)) return '폭풍으로 항해할 수 없습니다.';
  if (count < 1 || count > fr.troops - 1) return '이동 병력이 올바르지 않습니다 (최소 1명은 남겨야 함).';
  if (tr.owner !== null && tr.owner !== nid) {
    const rel = getRel(s, nid, tr.owner);
    if (rel.type === 'alliance') return '동맹국은 공격할 수 없습니다. 먼저 동맹을 파기해야 합니다.';
  }
  return canAct(s, nid, moveCost(world, from, to, s));
}

function betray(s, nid, victim) {
  const rel = getRel(s, nid, victim);
  const n = s.nations[nid];
  const what = rel.type === 'vassal' ? '종속 관계' : '불가침 조약';
  setRel(s, nid, victim, null);
  n.reputation = Math.max(0, n.reputation - 25);
  n.apPenalty = (n.apPenalty || 0) + 2;
  for (const o of s.nations) if (o.alive && o.id !== nid) s.opinion[o.id][nid] -= 15;
  s.opinion[victim][nid] -= 40;
  log(s, `⚠️ ${n.name}이(가) ${s.nations[victim].name}과(와)의 ${what}을 깨고 공격했습니다! (평판 -25, 다음 턴 행동력 -2)`, [nid, victim], 'betray');
}

function relocateRefugees(s, world, gens, nation, around) {
  const own = world.regions[around].neighbors.map((n) => n.id).filter((id) => s.regions[id].owner === nation);
  for (const g of gens) {
    if (own.length) g.region = own[0];
    else {
      const any = nationRegions(s, nation);
      if (any.length) g.region = s.nations[nation].capital ?? any[0];
    }
  }
}

function transferRegion(s, world, rid, newOwner) {
  const r = s.regions[rid];
  const old = r.owner;
  r.owner = newOwner;
  if (old !== null) {
    const gens = gensIn(s, rid, old);
    if (gens.length) relocateRefugees(s, world, gens, old, rid);
    const n = s.nations[old];
    if (n.capital === rid) {
      const rest = nationRegions(s, old);
      n.capital = rest.length ? rest.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] : null;
    }
    checkElimination(s, world, old);
  }
}

export function checkElimination(s, world, nid) {
  const n = s.nations[nid];
  if (!n.alive) return;
  if (nationRegions(s, nid).length > 0) return;
  n.alive = false;
  n.capital = null;
  for (const g of Object.values(s.generals)) {
    if (g.nation === nid && g.status === 'active') g.status = 'gone';
    if (g.status === 'prisoner' && g.captor === nid) {
      g.status = 'active';
      g.captor = null;
      const home = s.nations[g.nation];
      if (!home.alive || home.capital === null) g.status = 'gone';
      else g.region = home.capital;
    }
  }
  for (const k of Object.keys(s.relations)) if (k.split('-').map(Number).includes(nid)) delete s.relations[k];
  s.joint = s.joint.filter((j) => j.a !== nid && j.b !== nid && j.target !== nid);
  log(s, `☠️ ${n.name}이(가) 멸망했습니다.`, [nid], 'dead');
}

const TITLES = [[3, '역전의 장수'], [5, '백전노장'], [7, '만인적'], [9, '군신']];
const STAT_NAME = { war: '무력', lead: '통솔', intel: '지력', pol: '정치' };

// 장수 성장: 레벨마다 100×레벨 경험치, 레벨업 시 능력치 2개 상승
export function gainExp(s, g, amt) {
  if (!g || g.status === 'dead') return;
  g.exp = (g.exp || 0) + amt;
  g.level = g.level || 1;
  const rng = stateRng(s);
  while (g.exp >= g.level * 100) {
    g.exp -= g.level * 100;
    g.level++;
    const keys = rng.shuffle(['war', 'lead', 'intel', 'pol']).slice(0, 2);
    const ups = keys.map((k) => {
      const inc = rng.int(2, 4);
      g[k] = Math.min(100, g[k] + inc);
      return `${STAT_NAME[k]}+${inc}`;
    });
    const t = TITLES.filter(([lv]) => g.level >= lv).pop();
    const newTitle = t && t[1] !== g.title ? t[1] : null;
    if (newTitle) g.title = newTitle;
    log(s, `🎖️ ${g.name} Lv${g.level} 달성 (${ups.join(', ')})${newTitle ? ` — 칭호 「${newTitle}」` : ''}`, [g.nation], 'general');
  }
}

export function doMove(s, world, nid, from, to, count, genIds = [], opts = {}) {
  const err = moveCheck(s, world, nid, from, to, count, genIds);
  if (err) return fail(err);
  const rng = stateRng(s);
  const n = s.nations[nid];
  const fr = s.regions[from], tr = s.regions[to];
  const cost = moveCost(world, from, to, s);
  const gens = genIds.map((id) => s.generals[id]).filter((g) => g && g.status === 'active' && g.nation === nid && g.region === from);
  n.ap -= cost;
  if (tr.owner === nid) {
    fr.troops -= count;
    tr.troops += count;
    for (const g of gens) g.region = to;
    return { ok: true, msg: `${fr.name} → ${tr.name}: 병사 ${fmtTroops(count)} 이동.` };
  }
  const defender = tr.owner;
  if (defender !== null) {
    const rel = getRel(s, nid, defender);
    if (rel.type === 'nap' || rel.type === 'vassal') betray(s, nid, defender);
  }
  const f = battleFactors(s, world, nid, from, to, gens.map((g) => g.id));
  const defName = defender === null ? '중립 세력' : s.nations[defender].name;
  const battle = { from, to, attacker: nid, defender, count, defTroops: tr.troops, turn: s.turn };
  const lines = [];

  // 일기토: 플레이어가 직접 치른 결과(opts.duel) 또는 자동 진행
  let duel = opts.duel || null;
  if (!duel && opts.duel !== false && tr.troops > 0) {
    const ag = duelist(gens), dg = duelist(f.def);
    if (ag && dg && rng() < 0.7 && (dg.war >= ag.war - 15 || rng() < 0.3)) duel = simulateDuel(rng, ag, dg);
  }
  let duelMult = 1;
  if (duel) {
    const ag = s.generals[duel.a], dg = s.generals[duel.b];
    battle.duel = { a: ag.name, b: dg.name, winner: duel.winner, ko: duel.ko, rounds: duel.rounds.length };
    if (duel.winner === 1) { duelMult = 1.15; gainExp(s, ag, 40); }
    else if (duel.winner === 2) { duelMult = 1 / 1.15; gainExp(s, dg, 40); }
    const loser = duel.winner === 1 ? dg : duel.winner === 2 ? ag : null;
    if (duel.ko && loser && rng() < 0.4) {
      loser.status = 'dead';
      battle.duel.killed = loser.name;
    }
    const res = duel.winner === 0 ? '무승부' : `${duel.winner === 1 ? ag.name : dg.name} 승리`;
    lines.push(`일기토 ${ag.name} vs ${dg.name}: ${res}${battle.duel.killed ? ` (${battle.duel.killed} 전사)` : ''}`);
  }
  const defGens = f.def.filter((g) => g.status === 'active');
  const atkGens = gens.filter((g) => g.status === 'active');
  const A = count * f.attMult * duelMult * rng.range(0.85, 1.15);
  const D = tr.troops * f.defMult * rng.range(0.85, 1.15);
  fr.troops -= count;
  (s.battles = s.battles || []).push(battle);
  const report = { from, to, attacker: nid, defender, count, defTroops: tr.troops, A, D, captured: [], killed: [], fled: [] };
  if (battle.duel?.killed) report.killed.push(battle.duel.killed);
  const finish = (kind, msg) => {
    if (lines.length) msg += ` [${lines.join(' / ')}]`;
    report.msg = msg;
    battle.result = kind;
    battle.attLoss = report.attLoss;
    battle.defLoss = report.defLoss;
    battle.win = kind === 'win';
    battle.msg = fixJosa(msg);
    log(s, msg, defender === null ? [nid] : [nid, defender], 'battle');
    if (defender !== null) {
      s.opinion[defender][nid] -= 15;
      for (const o of s.nations) if (o.alive && isVassalOf(s, defender, o.id) && o.id !== nid) s.opinion[o.id][nid] -= 10;
    }
    return { ok: true, msg, report };
  };

  // 공성: 성벽이 남아 있으면 이겨도 성벽만 깎이고 함락되지 않음
  if (A > D && (tr.buildings.walls || 0) > 0) {
    const before = tr.buildings.walls;
    tr.buildings.walls = Math.max(0, before - (A > D * 2 ? 2 : 1));
    tr.siegedTurn = s.turn;
    battle.siege = { before, after: tr.buildings.walls };
    if (tr.buildings.walls > 0) {
      report.defLoss = Math.min(Math.max(0, tr.troops - 100), Math.round(tr.troops * Math.min(0.5, (0.3 * A) / Math.max(1, D))));
      report.attLoss = Math.round(count * Math.min(0.6, (0.45 * D) / A + 0.1));
      tr.troops -= report.defLoss;
      fr.troops += count - report.attLoss;
      for (const g of atkGens) gainExp(s, g, 10);
      return finish('siege', `🏰 ${n.name}이(가) ${tr.name}(${defName})을(를) 포위 공격! 성벽 ${before}→${tr.buildings.walls}. 아군 손실 ${fmtTroops(report.attLoss)}, 적 손실 ${fmtTroops(report.defLoss)}.`);
    }
    lines.push('성벽 붕괴');
  }

  if (A > D) {
    const ratio = D / A;
    const loss = Math.min(count - 1, Math.round(count * ratio * 0.7));
    const survivors = Math.max(1, count - loss);
    report.win = true;
    report.attLoss = count - survivors;
    report.defLoss = tr.troops;
    const wasCapital = defender !== null && s.nations[defender].capital === to;
    const plunder = wasCapital ? Math.floor(s.nations[defender].gold * 0.2) : 0;
    const fierce = hasTrait(atkGens, '맹장') ? 0.12 : 0;
    for (const g of defGens) {
      if (rng() < 0.45) {
        if (rng() < 0.1 + fierce) {
          g.status = 'dead';
          report.killed.push(g.name);
        } else {
          g.status = 'prisoner';
          g.captor = nid;
          report.captured.push(g.name);
        }
      } else report.fled.push(g.name);
    }
    tr.troops = 0;
    if (defender !== null && plunder) {
      s.nations[defender].gold -= plunder;
      n.gold += plunder;
      report.plunder = plunder;
    }
    transferRegion(s, world, to, nid);
    tr.troops = survivors;
    tr.loyalty = defender === null ? 35 : 15;
    tr.conscripted = true;
    for (const g of atkGens) {
      g.region = to;
      gainExp(s, g, 25);
    }
    let msg = `⚔️ ${n.name}이(가) ${tr.name}(${defName})을(를) 점령! 아군 손실 ${fmtTroops(report.attLoss)}, 적 ${fmtTroops(report.defLoss)} 격파.`;
    if (wasCapital) msg += ` 수도 함락, ${plunder}금 약탈.`;
    if (report.captured.length) msg += ` 포로: ${report.captured.join(', ')}.`;
    if (report.killed.length) msg += ` 전사: ${report.killed.join(', ')}.`;
    return finish('win', msg);
  }
  const ratio = D > 0 ? A / D : 1;
  const back = Math.round(count * 0.25 * rng());
  report.win = false;
  report.attLoss = count - back;
  report.defLoss = Math.max(0, Math.min(tr.troops - 1, Math.round(tr.troops * ratio * 0.6)));
  tr.troops -= report.defLoss;
  fr.troops += back;
  for (const g of atkGens) {
    const r = rng();
    if (r < 0.05) {
      g.status = 'dead';
      report.killed.push(g.name);
    } else if (r < 0.3 && defender !== null) {
      g.status = 'prisoner';
      g.captor = defender;
      report.captured.push(g.name);
    }
  }
  for (const g of defGens) gainExp(s, g, 25);
  let msg = `🛡️ ${n.name}의 ${tr.name}(${defName}) 공격 실패. 아군 손실 ${fmtTroops(report.attLoss)}, 적 손실 ${fmtTroops(report.defLoss)}.`;
  if (report.captured.length) msg += ` 포로로 잡힘: ${report.captured.join(', ')}.`;
  if (report.killed.length) msg += ` 전사: ${report.killed.join(', ')}.`;
  return finish('lose', msg);
}

export function doRelocate(s, nid, gid, to) {
  const g = s.generals[gid];
  if (!g || g.nation !== nid || g.status !== 'active') return fail('이동할 수 없는 장수입니다.');
  if (s.regions[to].owner !== nid) return fail('내 지역으로만 배치할 수 있습니다.');
  const err = canAct(s, nid, COST.relocate);
  if (err) return fail(err);
  s.nations[nid].ap -= COST.relocate;
  g.region = to;
  return { ok: true, msg: `${g.name}을(를) ${s.regions[to].name}에 배치했습니다.` };
}

// ───────── 장수: 등용·처형·석방·회유 ─────────
export function isRuler(s, g) {
  return s.nations.some((n) => n.alive && n.ruler === g.id);
}

export function recruitChance(s, nid, g) {
  const n = s.nations[nid];
  let c = 30 + (n.reputation - 50) * 0.5 + (100 - g.loyalty) * 0.3;
  if (hasTrait(nationGenerals(s, nid), '인덕')) c += 15;
  if (isRuler(s, g)) c = 0;
  return Math.max(0, Math.min(90, Math.round(c)));
}

export function doRecruit(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('등용할 수 없습니다.');
  if (isRuler(s, g)) return fail('적국의 군주는 등용할 수 없습니다.');
  if (s.tried[gid] === s.turn) return fail('이번 턴에 이미 설득했습니다.');
  const err = canAct(s, nid, COST.recruit);
  if (err) return fail(err);
  const rng = stateRng(s);
  s.nations[nid].ap -= COST.recruit;
  s.tried[gid] = s.turn;
  if (rng() * 100 < recruitChance(s, nid, g)) {
    const old = g.nation;
    g.status = 'active';
    g.nation = nid;
    g.captor = null;
    g.loyalty = 60;
    g.region = s.nations[nid].capital;
    const msg = `🤝 ${g.name}이(가) ${s.nations[nid].name}에 투항했습니다!`;
    log(s, msg, [nid, old], 'general');
    return { ok: true, msg };
  }
  g.loyalty = Math.max(0, g.loyalty - 10);
  return { ok: true, msg: `${g.name}이(가) 등용을 거절했습니다. (다음 턴 재시도 가능, 충성 하락)` };
}

export function doExecute(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('처형할 수 없습니다.');
  g.status = 'dead';
  const n = s.nations[nid];
  n.reputation = Math.max(0, n.reputation - 4);
  if (s.nations[g.nation].alive) s.opinion[g.nation][nid] -= 30;
  const ruler = isRulerId(s, g.id);
  if (ruler !== null) succession(s, ruler);
  const msg = `🗡️ ${n.name}이(가) ${g.name}을(를) 처형했습니다. (평판 -4)`;
  log(s, msg, [nid, g.nation], 'general');
  return { ok: true, msg };
}

function isRulerId(s, gid) {
  const n = s.nations.find((x) => x.alive && x.ruler === gid);
  return n ? n.id : null;
}

export function succession(s, nid) {
  const gens = nationGenerals(s, nid).sort((a, b) => rating(b) - rating(a));
  const n = s.nations[nid];
  n.ruler = gens.length ? gens[0].id : null;
  if (gens.length) log(s, `👑 ${n.name}의 새 군주로 ${gens[0].name}이(가) 즉위했습니다.`, [nid], 'general');
}

export function doRelease(s, nid, gid) {
  const g = s.generals[gid];
  if (!g || g.status !== 'prisoner' || g.captor !== nid) return fail('석방할 수 없습니다.');
  const home = s.nations[g.nation];
  g.captor = null;
  if (home.alive && home.capital !== null) {
    g.status = 'active';
    g.region = home.capital;
    s.opinion[g.nation][nid] += 25;
  } else g.status = 'gone';
  const n = s.nations[nid];
  n.reputation = Math.min(100, n.reputation + 3);
  const msg = `🕊️ ${n.name}이(가) ${g.name}을(를) 석방했습니다. (평판 +3)`;
  log(s, msg, [nid, g.nation], 'general');
  return { ok: true, msg };
}

export function poachChance(s, nid, g) {
  if (isRuler(s, g)) return 0;
  const mine = nationGenerals(s, nid);
  const intel = mine.length ? Math.max(...mine.map((x) => x.intel)) : 40;
  const c = 12 + (intel - g.intel) / 2 + (s.nations[nid].reputation - 50) / 4 + (70 - g.loyalty) / 3;
  return Math.max(0, Math.min(60, Math.round(c)));
}

export function doPoach(s, nid, gid) {
  const g = s.generals[gid];
  const n = s.nations[nid];
  if (!g || g.status !== 'active' || g.nation === nid) return fail('회유할 수 없습니다.');
  if (isRuler(s, g)) return fail('군주는 회유할 수 없습니다.');
  if (s.tried[gid] === s.turn) return fail('이번 턴에 이미 시도했습니다.');
  if (n.gold < COST.poachGold) return fail(`금이 부족합니다 (필요 ${COST.poachGold}).`);
  const err = canAct(s, nid, COST.poach);
  if (err) return fail(err);
  const rng = stateRng(s);
  n.gold -= COST.poachGold;
  n.ap -= COST.poach;
  s.tried[gid] = s.turn;
  const old = g.nation;
  if (rng() * 100 < poachChance(s, nid, g)) {
    g.nation = nid;
    g.region = n.capital;
    g.loyalty = 50;
    s.opinion[old][nid] -= 20;
    const msg = `💰 ${g.name}이(가) 회유되어 ${n.name}로 넘어왔습니다!`;
    log(s, msg, [nid, old], 'general');
    return { ok: true, msg };
  }
  s.opinion[old][nid] -= 10;
  return { ok: true, msg: `${g.name} 회유에 실패했습니다.` };
}

// ───────── 장수 출현 (공평 규칙) ─────────
// 장수 출현 확률: 낮은 기본값에 공평 보정 × 민심 × 국고 × 평판
export function appearChance(s, nid) {
  const n = s.nations[nid];
  const alive = s.nations.filter((x) => x.alive);
  const counts = alive.map((x) => nationGenerals(s, x.id).length);
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const mine = nationGenerals(s, nid).length;
  const regs = nationRegions(s, nid);
  const loy = regs.reduce((a, r) => a + (s.regions[r].loyalty ?? 100), 0) / Math.max(1, regs.length);
  let p = 0.06 * Math.max(0.25, Math.min(2.5, 1 + (avg - mine) * 0.4));
  p *= Math.max(0.5, Math.min(1.3, loy / 75));
  p *= n.gold >= 200 ? 1.2 : n.gold < 30 ? 0.7 : 1;
  p *= Math.max(0.5, Math.min(1.4, n.reputation / 60));
  if (regs.length <= 3) p += 0.02;
  return Math.min(0.3, p);
}

function generalWeight(s, g, strength) {
  const hist = s.appearHistory[g.id] || 0;
  let w = 1 / (1 + hist * 0.5);
  const dev = (rating(g) - 65) / 12;
  w *= Math.exp(-dev * (strength - 1) * 1.2);
  return Math.max(0.02, Math.min(20, w));
}

export function spawnGeneral(s, nid, rng, forced = false) {
  const n = s.nations[nid];
  if (!n.alive || n.capital === null) return null;
  if (!forced && !rng.chance(appearChance(s, nid))) return null;
  const alive = s.nations.filter((x) => x.alive);
  const totals = alive.map((x) => nationGenerals(s, x.id).reduce((a, g) => a + rating(g), 0));
  const avgT = totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length);
  const myT = nationGenerals(s, nid).reduce((a, g) => a + rating(g), 0);
  const strength = avgT > 0 ? Math.max(0.5, Math.min(2, myT / avgT)) : 1;
  const cands = [];
  n.pools.forEach((pool, i) => {
    for (const g of POOLS[pool] || []) if (!s.usedGen[g.id]) cands.push({ g, w: (i === 0 ? 1 : 0.45) * generalWeight(s, g, strength) });
  });
  if (!cands.length) {
    for (const [pool, list] of Object.entries(POOLS)) {
      if (pool.startsWith('tk') && !n.pools[0].startsWith('tk')) continue;
      for (const g of list) if (!s.usedGen[g.id]) cands.push({ g, w: 0.2 * generalWeight(s, g, strength) });
    }
  }
  const pick = rng.weighted(cands, (c) => c.w);
  if (!pick) return null;
  const own = nationRegions(s, nid);
  const gen = addGeneral(s, pick.g, nid, rng.chance(0.6) ? n.capital : rng.pick(own), rng);
  log(s, `⭐ ${n.name}에 ${gen.name}(무${gen.war}/통${gen.lead}/지${gen.intel}/정${gen.pol}, ${gen.trait})이(가) 출현했습니다.`, [nid], 'general');
  return gen;
}

export function addGeneral(s, data, nid, region, rng) {
  const gen = { ...data, nation: nid, origin: nid, region, status: 'active', captor: null, loyalty: rng.int(55, 90) };
  s.generals[gen.id] = gen;
  s.usedGen[gen.id] = 1;
  s.appearHistory[gen.id] = (s.appearHistory[gen.id] || 0) + 1;
  return gen;
}
