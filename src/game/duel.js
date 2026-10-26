import { tv } from './traits.js';

// 일기토: 반격 > 공격 > 방어 > 반격 의 가위바위보
// 이긴 쪽만 피해를 주고, 같은 수끼리 맞붙으면 서로 절반씩 피해(마창 맞부딪침)
export const MOVES = {
  attack: { name: '공격', icon: '🗡️', desc: '내리베기. 방어를 뚫지만 반격에 걸림' },
  defend: { name: '방어', icon: '🛡️', desc: '창대로 막기. 반격을 무력화하지만 공격에 뚫림' },
  counter: { name: '반격', icon: '🔄', desc: '흘리고 찌르기. 공격을 받아치지만 방어에 막힘' },
};

const BEATS = { counter: 'attack', attack: 'defend', defend: 'counter' };

// [a가 받는 피해, b가 받는 피해] (상대 위력 배수)
function outcome(a, b) {
  if (a === b) return [0.5, 0.5];
  return BEATS[a] === b ? [0, 1] : [1, 0];
}

export const duelHp = (g) => Math.round((60 + g.war * 0.7 + g.lead * 0.2) * (1 + tv([g], '무쌍')));
export const duelPow = (g) => (8 + g.war * 0.2) * (1 + tv([g], '맹장') * 3);

const BASE_MIX = { attack: 1 / 3, defend: 1 / 3, counter: 1 / 3 };

export function bestResponse(opp) {
  let best = null, bv = -Infinity;
  for (const m of Object.keys(MOVES)) {
    const [mine, theirs] = outcome(m, opp);
    const v = theirs - mine;
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

export const readChance = (me, opp) => Math.max(0, Math.min(0.45, (me.intel - opp.intel) / 150 + 0.1));

// AI의 수: 지력으로 상대 수를 간파하거나, 상대가 같은 수를 반복하면 그 버릇을 노린다
export function aiMove(rng, me, opp, oppMove, history) {
  if (oppMove && rng() < readChance(me, opp)) return bestResponse(oppMove);
  if (history && history.length >= 2) {
    const freq = {};
    for (const m of history) freq[m] = (freq[m] || 0) + 1;
    const [top, c] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const bias = c / history.length - 0.25;
    if (bias > 0 && rng() < bias * 1.6) return bestResponse(top);
  }
  return rng.weighted(Object.keys(BASE_MIX), (k) => BASE_MIX[k]);
}

export function newDuel(g1, g2) {
  return { a: g1.id, b: g2.id, hpA: duelHp(g1), hpB: duelHp(g2), maxA: duelHp(g1), maxB: duelHp(g2), rounds: [], done: false, winner: null };
}

export function duelRound(d, g1, g2, m1, m2, rng) {
  const [toA, toB] = outcome(m1, m2);
  const dA = Math.round(toA * duelPow(g2) * rng.range(0.85, 1.15));
  const dB = Math.round(toB * duelPow(g1) * rng.range(0.85, 1.15));
  d.hpA = Math.max(0, d.hpA - dA);
  d.hpB = Math.max(0, d.hpB - dB);
  d.rounds.push({ m1, m2, dA, dB });
  if (d.hpA <= 0 || d.hpB <= 0 || d.rounds.length >= 6) finishDuel(d);
  return d;
}

function finishDuel(d) {
  d.done = true;
  const ra = d.hpA / d.maxA, rb = d.hpB / d.maxB;
  if (d.hpA <= 0 && d.hpB <= 0) d.winner = 0;
  else if (d.hpB <= 0) d.winner = 1;
  else if (d.hpA <= 0) d.winner = 2;
  else d.winner = Math.abs(ra - rb) < 0.1 ? 0 : ra > rb ? 1 : 2;
  d.ko = d.hpA <= 0 || d.hpB <= 0;
}

export function simulateDuel(rng, g1, g2) {
  const d = newDuel(g1, g2);
  while (!d.done) {
    // 양쪽이 동시에 고르고, 각자 지력으로 상대 의도를 간파할 수 있음
    const b1 = aiMove(rng, g1, g2, null), b2 = aiMove(rng, g2, g1, null);
    const m1 = rng() < readChance(g1, g2) ? bestResponse(b2) : b1;
    const m2 = rng() < readChance(g2, g1) ? bestResponse(b1) : b2;
    duelRound(d, g1, g2, m1, m2, rng);
  }
  return d;
}

export const duelist = (gens) => (gens.length ? gens.reduce((a, b) => (b.war > a.war ? b : a)) : null);
