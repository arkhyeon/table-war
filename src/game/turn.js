import { stateRng } from './rng.js';
import { TERRAIN, TAX } from './rules.js';
import { fmtTroops } from './format.js';
import { aiActions, aiDiplomacy, aiPrisoners, aiTaxPolicy } from './ai.js';
import { income, computeMaxAp, spawnGeneral, log, getRel, setRel, isVassalOf, nationRegions, gensIn, checkElimination, effTax, supplied, WALL_MAX, nationPower, gainExp, landCount } from './engine.js';
import { tv } from './traits.js';
import { rollWeather, weatherOf } from './weather.js';
import { runEvents } from './events.js';
import { updateExplored, encodeOwners } from './fog.js';
import { hashString } from './rng.js';

function revolt(s, world, rid, rng) {
  const r = s.regions[rid];
  const old = r.owner;
  const rebels = Math.max(Math.round(r.troops * 0.6), Math.round(r.pop * 150));
  const own = world.regions[rid].neighbors.map((x) => x.id).filter((x) => s.regions[x].owner === old && !s.regions[x].sea);
  for (const g of gensIn(s, rid, old)) g.region = own[0] ?? s.nations[old].capital;
  r.owner = null;
  r.troops = Math.round(rebels / 100) * 100;
  r.loyalty = 50;
  if (s.nations[old].capital === rid) {
    const rest = nationRegions(s, old);
    s.nations[old].capital = rest.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] ?? null;
  }
  log(s, `🔥 ${r.name}에서 반란이 일어나 ${s.nations[old].name}의 지배에서 벗어났습니다! (반란군 ${fmtTroops(r.troops)})`, [old], 'warn');
  checkElimination(s, world, old);
}

// 세력 균형: 국력이 평균의 2배를 넘으면 주변국의 경계, 1위가 2.5배를 넘으면 대동맹 결성
function balanceOfPower(s, world) {
  const alive = s.nations.filter((n) => n.alive);
  if (alive.length < 3) return;
  const power = Object.fromEntries(alive.map((n) => [n.id, nationPower(s, n.id)]));
  const avg = Object.values(power).reduce((a, b) => a + b, 0) / alive.length;
  const threat = (id) => power[id] / Math.max(1, avg);
  for (const n of alive) {
    const t = threat(n.id);
    if (t <= 2) continue;
    const nbs = new Set();
    for (const r of nationRegions(s, n.id)) for (const nb of world.regions[r].neighbors) if (s.regions[nb.id].owner !== null) nbs.add(s.regions[nb.id].owner);
    for (const o of alive) {
      if (o.id === n.id || isVassalOf(s, o.id, n.id)) continue;
      s.opinion[o.id][n.id] -= Math.min(4, (t - 2) * 1.5) * (nbs.has(o.id) ? 1.5 : 1);
    }
  }
  const top = alive.reduce((a, b) => (power[b.id] > power[a.id] ? b : a));
  const prev = s.coalition?.target;
  if (threat(top.id) > 2.5) {
    if (prev !== top.id) {
      s.coalition = { target: top.id, since: s.turn };
      log(s, `⚔️ ${top.name}의 패권에 맞서 대동맹이 결성되었습니다! 각국이 ${top.name}을(를) 공동의 적으로 삼습니다.`, s.nations.map((x) => x.id), 'diplo');
    }
    const members = alive.filter((o) => o.id !== top.id && !isVassalOf(s, o.id, top.id) && getRel(s, o.id, top.id).type !== 'alliance');
    s.coalition.members = members.map((o) => o.id);
    for (const a of members) for (const b of members) if (a.id !== b.id) s.opinion[a.id][b.id] += 1;
  } else if (prev !== undefined && threat(prev) < 2) {
    log(s, `🕊️ ${s.nations[prev].name}에 대한 대동맹이 해체되었습니다.`, s.nations.map((x) => x.id), 'diplo');
    delete s.coalition;
  }
}

function upkeep(s, world) {
  const rng = stateRng(s);
  for (const n of s.nations) {
    if (!n.alive) continue;
    const inc = income(s, n.id);
    let net = inc.net;
    const lord = s.nations.find((o) => o.alive && isVassalOf(s, n.id, o.id));
    if (lord && inc.gross > 0) {
      const tribute = Math.round(inc.gross * 0.25);
      net -= tribute;
      lord.gold += tribute;
    }
    n.gold = Math.round((n.gold + net) * 10) / 10;
    if (n.gold < 0) {
      n.gold = 0;
      for (const r of s.regions) if (r.owner === n.id) r.troops = Math.max(100, Math.floor(r.troops * 0.009) * 100);
      log(s, `💸 ${n.name}의 국고가 바닥나 병사들이 탈영했습니다.`, [n.id], 'warn');
    }
  }
  const supply = {};
  const sizes = {};
  for (const r of s.regions) if (r.owner !== null && !r.sea) sizes[r.owner] = (sizes[r.owner] || 0) + 1;
  for (const n of s.nations) if (n.alive) supply[n.id] = supplied(s, world, n.id);
  for (let i = 0; i < s.regions.length; i++) {
    const r = s.regions[i];
    const w = weatherOf(s, i);
    if (r.sea) {
      // 바다의 함대: 보급 손실과 폭풍 피해
      if (r.owner !== null && r.troops > 0) {
        const loss = w.noSea ? 0.1 : 0.02;
        r.troops = Math.round((r.troops * (1 - loss)) / 100) * 100;
        if (r.troops <= 0) {
          r.troops = 0;
          r.owner = null;
        }
      }
      continue;
    }
    const tax = r.owner === null ? TAX.normal : TAX[effTax(s, i)];
    const gens = r.owner === null ? [] : gensIn(s, i, r.owner);
    const cap = (TERRAIN[world.regions[i].terrain].pop || 10) * 1.6 + (r.buildings.market ? 8 : 0);
    if (r.pop < cap && !w.noGrowth) r.pop = Math.min(cap, r.pop * (1 + 0.025 * tax.growth * (1 + tv(gens, '농정'))) + 0.3 * tax.growth);
    if (r.buildings.walls > 0 && r.buildings.walls < WALL_MAX && r.siegedTurn !== s.turn) r.buildings.walls = Math.min(WALL_MAX, r.buildings.walls + 1 + (tv(gens, '축성') ? 1 : 0));
    r.pop = Math.round(r.pop * 10) / 10;
    r.conscripted = false;
    if (r.owner === null) {
      if (s.turn % 3 === 0 && r.troops < 12000) r.troops += 1000;
      continue;
    }
    // 민심: 매 턴 회복, 세율·주둔군·수도·인덕 장수 반영
    const garrison = r.troops >= 3000 ? 2 : 0;
    const isCap = s.nations[r.owner].capital === i ? 3 : 0;
    // 보급이 끊긴 지역: 병력 1~10% 감소, 민심 하락
    const cut = !supply[r.owner]?.has(i);
    if (cut) r.troops = Math.max(100, Math.round((r.troops * (1 - rng.int(1, 10) / 100 * (1 - tv(gens, '보급')))) / 100) * 100);
    const sprawl = Math.floor((sizes[r.owner] || 0) / 10); // 대제국일수록 통치 부담
    // 계엄: 인구 대비 대군이 주둔하면 반란은 막지만 민심 회복이 더디다
    const martial = r.troops >= r.pop * 250;
    r.loyalty = Math.max(0, Math.min(100, (r.loyalty ?? 100) + 3 + tax.loyalty + garrison + isCap + w.loyalty + tv(gens, '인덕') - (cut ? 3 : 0) - sprawl - (martial ? 1 : 0)));
    if (!martial && r.loyalty < 25 && rng() < ((25 - r.loyalty) / 70) * (1 - tv(gens, '치안'))) revolt(s, world, i, rng);
    // 문관은 다스리며 성장, 무관은 병영에서 훈련
    for (const g of gens) {
      const govern = Math.max(0, (g.pol - 40) / 6) * (g.role === 'civ' ? 1.5 : 1);
      const drill = r.buildings.barracks && g.role !== 'civ' ? 3 : 0;
      if (govern + drill >= 1) gainExp(s, g, govern + drill);
    }
  }
  for (const n of s.nations) if (n.alive) spawnGeneral(s, n.id, rng);
  balanceOfPower(s, world);
  for (const [k, rel] of Object.entries(s.relations)) {
    if (rel.type === 'nap' && rel.until <= s.turn) {
      const [a, b] = k.split('-').map(Number);
      setRel(s, a, b, null);
      log(s, `📜 ${s.nations[a].name}과(와) ${s.nations[b].name}의 불가침 조약이 만료되었습니다.`, [a, b], 'diplo');
    }
  }
  s.joint = s.joint.filter((j) => j.until > s.turn);
  for (const a of s.nations) {
    if (!a.alive) continue;
    for (const b of s.nations) {
      if (a.id === b.id || !b.alive) continue;
      let o = s.opinion[a.id][b.id];
      o += o > 0 ? -0.5 : 0.5;
      if (getRel(s, a.id, b.id).type === 'alliance') o += 1;
      s.opinion[a.id][b.id] = Math.max(-100, Math.min(100, o));
    }
    if (a.reputation < 60) a.reputation += 1;
    a.maxAp = computeMaxAp(s, a.id);
    a.ap = Math.max(1, a.maxAp - (a.apPenalty || 0));
    a.apPenalty = 0;
    if (a.grudge !== undefined && rng.chance(0.15)) delete a.grudge;
  }
}

export function checkGameOver(s) {
  const p = s.nations[s.playerId];
  if (!p.alive) return { win: false, text: `${p.name}이(가) 멸망했습니다.` };
  const owned = nationRegions(s, s.playerId).length;
  if (owned / landCount(s) >= 0.6) return { win: true, text: `전 지역의 60% 이상을 차지해 천하를 통일했습니다!` };
  const rivals = s.nations.filter((n) => n.alive && n.id !== s.playerId && !isVassalOf(s, n.id, s.playerId));
  if (!rivals.length) return { win: true, text: '모든 국가가 멸망하거나 당신의 속국이 되었습니다!' };
  return null;
}

export function endTurn(s, world) {
  s.turnNews = [];
  s.turnEvents = [];
  s.battles = [];
  const rng = stateRng(s);
  const order = rng.shuffle(s.nations.filter((n) => n.alive && !n.isPlayer).map((n) => n.id));
  for (const id of order) {
    if (!s.nations[id].alive) continue;
    aiTaxPolicy(s, id);
    aiDiplomacy(s, world, id);
    aiPrisoners(s, id);
    aiActions(s, world, id);
  }
  upkeep(s, world);
  (s.history = s.history || []).push(encodeOwners(s));
  s.turn += 1;
  s.weather = rollWeather(world, s.turn, hashString(String(s.seed)) & 0xffff);
  runEvents(s, world, stateRng(s));
  updateExplored(s, world);
  s.gameOver = s.sandbox && s.nations[s.playerId].alive ? null : checkGameOver(s);
  return s;
}
