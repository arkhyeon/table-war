import { getRel, setRel, log, nationPower, nationRegions, nationTrait, isVassalOf, gensIn, checkElimination } from './engine.js';
import { COST, G } from './rules.js';
import { fmtGold } from './format.js';

// deal: { give:{gold, regions:[]}, get:{gold, regions:[]}, treaty: null|'alliance'|'nap'|'vassal_them'|'vassal_me'|'joint', target }
// from이 to에게 제안. give = from이 주는 것, get = from이 받는 것.
export const TREATY_LABEL = {
  alliance: '동맹 (상호 공격 불가)',
  nap: '불가침 10턴',
  vassal_them: '상대가 내 속국이 됨',
  vassal_me: '내가 상대의 속국이 됨',
  joint: '공동 공격',
};

export function emptyDeal() {
  return { give: { gold: 0, regions: [] }, get: { gold: 0, regions: [] }, treaty: null, target: null };
}

export function describeDeal(s, from, to, deal) {
  const F = s.nations[from].name, To = s.nations[to].name;
  const parts = [];
  const rn = (ids) => ids.map((i) => s.regions[i].name).join(', ');
  if (deal.give.gold) parts.push(`${F} → ${To}: ${fmtGold(deal.give.gold)}금`);
  if (deal.give.regions.length) parts.push(`${F} → ${To}: 영토 ${rn(deal.give.regions)}`);
  if (deal.get.gold) parts.push(`${To} → ${F}: ${fmtGold(deal.get.gold)}금`);
  if (deal.get.regions.length) parts.push(`${To} → ${F}: 영토 ${rn(deal.get.regions)}`);
  if (deal.treaty === 'alliance') parts.push('동맹 체결');
  if (deal.treaty === 'nap') parts.push('10턴 불가침');
  if (deal.treaty === 'vassal_them') parts.push(`${To}이(가) ${F}의 속국이 됨`);
  if (deal.treaty === 'vassal_me') parts.push(`${F}이(가) ${To}의 속국이 됨`);
  if (deal.treaty === 'joint' && deal.target !== null) parts.push(`함께 ${s.nations[deal.target].name} 공격`);
  return parts.length ? parts.join(' / ') : '(내용 없음)';
}

function adjacentNations(s, world, nid) {
  const set = new Set();
  for (const rid of nationRegions(s, nid)) {
    for (const nb of world.regions[rid].neighbors) {
      const o = s.regions[nb.id].owner;
      if (o !== null && o !== nid) set.add(o);
    }
  }
  return set;
}

function regionValue(s, world, rid, forNation) {
  const r = s.regions[rid];
  let v = r.pop * 1.5 + (r.troops / 1000) * 0.8 + Object.values(r.buildings).reduce((a, b) => a + b, 0) * 30 + 20;
  const touches = world.regions[rid].neighbors.some((n) => s.regions[n.id].owner === forNation);
  if (!touches) v *= 0.5;
  if (s.nations[r.owner]?.capital === rid) v += 80;
  return v;
}

export function validateDeal(s, world, from, to, deal) {
  const F = s.nations[from], To = s.nations[to];
  if (!F.alive || !To.alive) return '멸망한 국가입니다.';
  if (deal.give.gold > F.gold) return '제안하는 금이 국고보다 많습니다.';
  if (deal.get.gold > To.gold) return `상대 국고(${fmtGold(To.gold)}금)보다 많은 금을 요구했습니다.`;
  if (deal.give.regions.some((r) => s.regions[r].owner !== from)) return '내 영토가 아닌 지역이 포함되어 있습니다.';
  if (deal.get.regions.some((r) => s.regions[r].owner !== to)) return '상대 영토가 아닌 지역이 포함되어 있습니다.';
  if (deal.give.regions.length >= nationRegions(s, from).length) return '모든 영토를 넘길 수는 없습니다.';
  if (deal.get.regions.length >= nationRegions(s, to).length) return '상대의 모든 영토를 요구할 수는 없습니다.';
  const rel = getRel(s, from, to);
  if (deal.treaty === 'alliance' && rel.type === 'alliance') return '이미 동맹입니다.';
  if ((deal.treaty === 'vassal_them' || deal.treaty === 'vassal_me') && rel.type === 'vassal') return '이미 종속 관계입니다.';
  if (deal.treaty === 'vassal_them' && s.nations.some((o) => o.alive && isVassalOf(s, from, o.id))) return '속국은 다른 나라를 속국으로 둘 수 없습니다.';
  if (deal.treaty === 'joint') {
    if (deal.target === null || deal.target === undefined) return '공동 공격 대상을 고르세요.';
    if (deal.target === from || deal.target === to || !s.nations[deal.target].alive) return '공동 공격 대상이 올바르지 않습니다.';
  }
  const empty = !deal.give.gold && !deal.get.gold && !deal.give.regions.length && !deal.get.regions.length && !deal.treaty;
  if (empty) return '제안 내용이 없습니다.';
  return null;
}

// AI(to)가 from의 제안을 평가 → 점수(0 이상이면 수락)
export function evaluateDeal(s, world, from, to, deal) {
  const ai = s.nations[to];
  const P = nationPower(s, from), Q = nationPower(s, to);
  const ratio = P / Math.max(1, Q);
  const op = s.opinion[to][from];
  let v = 0;
  v += (deal.give.gold - deal.get.gold * 1.2) / G;
  for (const r of deal.give.regions) v += regionValue(s, world, r, to);
  for (const r of deal.get.regions) v -= regionValue(s, world, r, to) * 1.3;
  const adj = adjacentNations(s, world, to);
  switch (deal.treaty) {
    case 'alliance': {
      v += -25 + op * 0.8 + (ratio > 1 ? 15 : 0);
      const enemies = s.nations.filter((o) => o.alive && o.id !== to && o.id !== from && s.opinion[to][o.id] < -20 && s.opinion[from][o.id] < -10);
      if (enemies.length) v += 20;
      // 둘 다 맞닿은 더 강한 나라가 있으면 손잡을 이유가 충분
      const nbTo = adjacentNations(s, world, to), nbFrom = adjacentNations(s, world, from);
      const big = s.nations.some((o) => o.alive && o.id !== to && o.id !== from && nbTo.has(o.id) && nbFrom.has(o.id) && nationPower(s, o.id) > Math.max(P, Q) * 1.3);
      if (big) v += 30;
      break;
    }
    case 'nap':
      v += -5 + (ratio > 1 ? 25 : 8) + op * 0.3 - (adj.has(from) ? 0 : 5);
      break;
    case 'vassal_them':
      v += -160 + 110 * Math.max(0, Math.min(2.5, ratio - 1)) + op * 0.4 + (adj.has(from) ? 10 : -40);
      break;
    case 'vassal_me':
      v += 70;
      break;
    case 'joint': {
      const t = deal.target;
      if (getRel(s, to, t).type === 'alliance' || isVassalOf(s, to, t) || isVassalOf(s, t, to)) v -= 999;
      v += -30 + (adj.has(t) ? 25 : -35) - s.opinion[to][t] * 0.5 + (nationPower(s, t) < Q ? 15 : -15);
      break;
    }
    default:
      break;
  }
  if (!deal.treaty && deal.get.gold > 0 && !deal.give.gold && !deal.give.regions.length) {
    // 조공 요구: 두려우면 수락
    v += ratio > 1.8 && adj.has(from) ? 40 + (ratio - 1.8) * 30 : -30;
  }
  v += op * 0.4 + (s.nations[from].reputation - 50) * 0.3;
  v += nationTrait(s, from, '외교');
  v -= nationTrait(s, to, '외교') / 3;
  return Math.round(v);
}

export function applyDeal(s, world, from, to, deal) {
  const F = s.nations[from], To = s.nations[to];
  F.gold -= deal.give.gold;
  To.gold += deal.give.gold;
  To.gold -= deal.get.gold;
  F.gold += deal.get.gold;
  const move = (rid, newOwner) => {
    const r = s.regions[rid];
    const old = r.owner;
    for (const g of gensIn(s, rid, old)) {
      const home = nationRegions(s, old).filter((x) => x !== rid);
      g.region = s.nations[old].capital !== rid ? s.nations[old].capital : home[0];
    }
    r.owner = newOwner;
    r.loyalty = Math.min(r.loyalty ?? 100, 40);
    if (s.nations[old].capital === rid) {
      const rest = nationRegions(s, old);
      s.nations[old].capital = rest.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] ?? null;
    }
  };
  deal.give.regions.forEach((r) => move(r, to));
  deal.get.regions.forEach((r) => move(r, from));
  const gift = deal.give.gold - deal.get.gold;
  if (gift > 0) s.opinion[to][from] += Math.min(40, gift / (3 * G));
  if (deal.treaty === 'alliance') {
    setRel(s, from, to, { type: 'alliance', since: s.turn });
    s.opinion[to][from] += 15;
    s.opinion[from][to] += 15;
  } else if (deal.treaty === 'nap') setRel(s, from, to, { type: 'nap', until: s.turn + 10 });
  else if (deal.treaty === 'vassal_them') setRel(s, from, to, { type: 'vassal', overlord: from, since: s.turn });
  else if (deal.treaty === 'vassal_me') setRel(s, from, to, { type: 'vassal', overlord: to, since: s.turn });
  else if (deal.treaty === 'joint') {
    s.joint.push({ a: from, b: to, target: deal.target, until: s.turn + 8 });
    s.opinion[deal.target][from] -= 10;
    s.opinion[deal.target][to] -= 10;
    s.opinion[to][deal.target] -= 20;
  }
  log(s, `📜 ${F.name} ↔ ${To.name} 합의: ${describeDeal(s, from, to, deal)}`, [from, to], 'diplo');
}

// 플레이어 → AI 제안
export function proposeDeal(s, world, from, to, deal) {
  const err = validateDeal(s, world, from, to, deal);
  if (err) return { ok: false, msg: err };
  const n = s.nations[from];
  if (n.ap < COST.diplomacy) return { ok: false, msg: '행동력이 부족합니다.' };
  n.ap -= COST.diplomacy;
  const score = evaluateDeal(s, world, from, to, deal);
  if (score >= 0) {
    applyDeal(s, world, from, to, deal);
    return { ok: true, accepted: true, msg: `${s.nations[to].name}이(가) 제안을 수락했습니다!` };
  }
  s.opinion[to][from] -= deal.get.gold > 0 || deal.get.regions.length ? 5 : 1;
  const hint = score > -25 ? '조금만 더 양보하면 받아들일 것 같습니다.' : score > -80 ? '상당히 부족합니다.' : '전혀 받아들일 생각이 없습니다.';
  return { ok: true, accepted: false, msg: `${s.nations[to].name}이(가) 거절했습니다. ${hint}` };
}

export function breakTreaty(s, a, b) {
  const rel = getRel(s, a, b);
  const A = s.nations[a], B = s.nations[b];
  if (rel.type === 'none') return { ok: false, msg: '조약이 없습니다.' };
  if (rel.type === 'alliance') {
    A.reputation = Math.max(0, A.reputation - 10);
    s.opinion[b][a] -= 30;
    log(s, `💔 ${A.name}이(가) ${B.name}과(와)의 동맹을 파기했습니다. (평판 -10)`, [a, b], 'diplo');
  } else if (rel.type === 'nap') {
    A.reputation = Math.max(0, A.reputation - 8);
    s.opinion[b][a] -= 25;
    log(s, `💔 ${A.name}이(가) ${B.name}과(와)의 불가침 조약을 파기했습니다. (평판 -8)`, [a, b], 'diplo');
  } else if (rel.type === 'vassal') {
    if (rel.overlord === a) {
      s.opinion[b][a] += 20;
      log(s, `🕊️ ${A.name}이(가) 속국 ${B.name}을(를) 독립시켰습니다.`, [a, b], 'diplo');
    } else {
      A.reputation = Math.max(0, A.reputation - 5);
      s.opinion[b][a] -= 40;
      log(s, `🔥 ${A.name}이(가) ${B.name}(으)로부터 독립을 선언했습니다!`, [a, b], 'diplo');
    }
  }
  setRel(s, a, b, null);
  return { ok: true, msg: '조약을 파기했습니다.' };
}

// 속국 병합: 10턴 이상 거느린 속국을 흡수 (종주국 국력이 속국의 2배 이상)
export const ANNEX_TURNS = 10;
export function annexCheck(s, lord, vassal) {
  const rel = getRel(s, lord, vassal);
  if (rel.type !== 'vassal' || rel.overlord !== lord) return '내 속국이 아닙니다.';
  const left = (rel.since ?? s.turn) + ANNEX_TURNS - s.turn;
  if (left > 0) return `속국이 된 지 ${ANNEX_TURNS}턴이 지나야 합니다. (${left}턴 남음)`;
  if (nationPower(s, lord) < nationPower(s, vassal) * 2) return '국력이 속국의 2배 이상이어야 합니다.';
  if (s.nations[lord].ap < COST.diplomacy * 2) return '행동력이 부족합니다.';
  return null;
}

export function doAnnex(s, world, lord, vassal) {
  const err = annexCheck(s, lord, vassal);
  if (err) return { ok: false, msg: err };
  const L = s.nations[lord], V = s.nations[vassal];
  L.ap -= COST.diplomacy * 2;
  for (const rid of nationRegions(s, vassal)) {
    const r = s.regions[rid];
    r.owner = lord;
    r.loyalty = Math.min(r.loyalty ?? 100, 45);
  }
  const king = s.generals[V.ruler];
  if (king) Object.assign(king, { exKing: V.name, joined: s.turn });
  // 속국 장수는 종주국에 귀순(충성 낮음)
  for (const g of Object.values(s.generals)) {
    if (g.nation !== vassal || g.status !== 'active') continue;
    g.nation = lord;
    g.loyalty = Math.min(g.loyalty ?? 60, 55);
  }
  L.gold += Math.max(0, V.gold);
  V.gold = 0;
  L.reputation = Math.max(0, L.reputation - 5);
  for (const o of s.nations) if (o.alive && o.id !== lord && o.id !== vassal) s.opinion[o.id][lord] -= 10;
  log(s, `👑 ${L.name}이(가) 속국 ${V.name}을(를) 병합했습니다! (평판 -5, 주변국 경계)`, [lord, vassal], 'diplo');
  checkElimination(s, world, vassal);
  return { ok: true, msg: `${V.name}을(를) 병합했습니다.` };
}
