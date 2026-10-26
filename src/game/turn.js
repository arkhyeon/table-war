import { stateRng } from './rng.js';
import { TERRAIN, TAX } from './rules.js';
import { fmtTroops } from './format.js';
import { aiActions, aiDiplomacy, aiPrisoners, aiTaxPolicy } from './ai.js';
import { income, computeMaxAp, spawnGeneral, log, getRel, setRel, isVassalOf, nationRegions, gensIn, checkElimination } from './engine.js';

function revolt(s, world, rid, rng) {
  const r = s.regions[rid];
  const old = r.owner;
  const rebels = Math.max(Math.round(r.troops * 0.6), Math.round(r.pop * 150));
  const own = world.regions[rid].neighbors.map((x) => x.id).filter((x) => s.regions[x].owner === old);
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
    n.gold += net;
    if (n.gold < 0) {
      n.gold = 0;
      for (const r of s.regions) if (r.owner === n.id) r.troops = Math.max(100, Math.floor(r.troops * 0.009) * 100);
      log(s, `💸 ${n.name}의 국고가 바닥나 병사들이 탈영했습니다.`, [n.id], 'warn');
    }
  }
  for (let i = 0; i < s.regions.length; i++) {
    const r = s.regions[i];
    const tax = r.owner === null ? TAX.normal : TAX[s.nations[r.owner].taxRate || 'normal'];
    const cap = (TERRAIN[world.regions[i].terrain].pop || 10) * 1.6 + (r.buildings.market ? 8 : 0);
    if (r.pop < cap) r.pop = Math.min(cap, r.pop * (1 + 0.025 * tax.growth) + 0.3 * tax.growth);
    r.pop = Math.round(r.pop * 10) / 10;
    r.conscripted = false;
    if (r.owner === null) {
      if (s.turn % 3 === 0 && r.troops < 12000) r.troops += 1000;
      continue;
    }
    // 민심: 매 턴 회복, 세율·주둔군·수도 여부 반영
    const garrison = r.troops >= 3000 ? 2 : 0;
    const isCap = s.nations[r.owner].capital === i ? 3 : 0;
    r.loyalty = Math.max(0, Math.min(100, (r.loyalty ?? 100) + 3 + tax.loyalty + garrison + isCap));
    if (r.loyalty < 25 && rng() < (25 - r.loyalty) / 70) revolt(s, world, i, rng);
  }
  for (const n of s.nations) if (n.alive) spawnGeneral(s, n.id, rng);
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
  if (owned / s.regions.length >= 0.6) return { win: true, text: `전 지역의 60% 이상을 차지해 천하를 통일했습니다!` };
  const rivals = s.nations.filter((n) => n.alive && n.id !== s.playerId && !isVassalOf(s, n.id, s.playerId));
  if (!rivals.length) return { win: true, text: '모든 국가가 멸망하거나 당신의 속국이 되었습니다!' };
  return null;
}

export function endTurn(s, world) {
  s.turnNews = [];
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
  s.turn += 1;
  s.gameOver = s.sandbox && s.nations[s.playerId].alive ? null : checkGameOver(s);
  return s;
}
