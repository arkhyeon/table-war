import { stateRng } from './rng.js';
import { TERRAIN } from './rules.js';
import { aiActions, aiDiplomacy, aiPrisoners } from './ai.js';
import { income, computeMaxAp, spawnGeneral, log, getRel, setRel, isVassalOf, nationRegions } from './engine.js';

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
      for (const r of s.regions) if (r.owner === n.id) r.troops = Math.max(1, Math.floor(r.troops * 0.9));
      log(s, `💸 ${n.name}의 국고가 바닥나 병사들이 탈영했습니다.`, [n.id], 'warn');
    }
  }
  for (let i = 0; i < s.regions.length; i++) {
    const r = s.regions[i];
    const cap = (TERRAIN[world.regions[i].terrain].pop || 10) * 1.6 + (r.buildings.market ? 8 : 0);
    if (!r.unrest && r.pop < cap) r.pop = Math.min(cap, r.pop * 1.03 + 0.5);
    r.pop = Math.round(r.pop * 10) / 10;
    r.unrest = Math.max(0, (r.unrest || 0) - 1);
    r.taxed = false;
    r.conscripted = false;
    if (r.owner === null && s.turn % 3 === 0 && r.troops < 12) r.troops += 1;
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
  const rng = stateRng(s);
  const order = rng.shuffle(s.nations.filter((n) => n.alive && !n.isPlayer).map((n) => n.id));
  for (const id of order) {
    if (!s.nations[id].alive) continue;
    aiDiplomacy(s, world, id);
    aiPrisoners(s, id);
    aiActions(s, world, id);
  }
  upkeep(s, world);
  s.turn += 1;
  s.gameOver = s.sandbox && s.nations[s.playerId].alive ? null : checkGameOver(s);
  return s;
}
