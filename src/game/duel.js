import { tv } from './traits.js';

// 일기토: 공격·강타·방어·반격
// 원안(공격·카운터·방어)만으로는 방어가 지는 경우가 없어, 방어를 깨는 '강타'를 넣고
// 각 수가 이기는 상대·지는 상대를 갖도록 피해 배수를 조정했다(균형점: 공격28%·강타27%·방어22%·반격22%).
export const MOVES = {
  attack: { name: '공격', icon: '🗡️', desc: '빠른 찌르기. 강타를 끊음(큰 피해). 방어·반격에 당함' },
  smash: { name: '강타', icon: '🪓', desc: '내려찍기. 방어를 부수고 반격 자세를 무너뜨림. 공격에 끊김' },
  defend: { name: '방어', icon: '🛡️', desc: '막고 밀쳐냄. 공격을 받아치고 반격을 무력화. 강타에 뚫림' },
  counter: { name: '반격', icon: '🔄', desc: '받아치기. 공격을 크게 되받아침. 강타·방어엔 빈틈' },
};

// OUT[a][b] = [a가 받는 피해, b가 받는 피해] (상대 위력 배수)
const OUT = {
  attack: { attack: [1, 1], smash: [0, 1.6], defend: [0.8, 0], counter: [1.2, 0] },
  smash: { attack: [1.6, 0], smash: [1.5, 1.5], defend: [0, 1.2], counter: [0, 0.8] },
  defend: { attack: [0, 0.8], smash: [1.2, 0], defend: [0, 0], counter: [0, 0.5] },
  counter: { attack: [0, 1.2], smash: [0.8, 0], defend: [0.5, 0], counter: [0, 0] },
};

export const duelHp = (g) => Math.round((60 + g.war * 0.7 + g.lead * 0.2) * (1 + tv([g], '무쌍')));
export const duelPow = (g) => (8 + g.war * 0.2) * (1 + tv([g], '맹장') * 3);

const BASE_MIX = { attack: 0.28, smash: 0.27, defend: 0.225, counter: 0.225 };

export function bestResponse(opp) {
  let best = null, bv = -Infinity;
  for (const m of Object.keys(MOVES)) {
    const [mine, theirs] = OUT[m][opp];
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
  const [toA, toB] = OUT[m1][m2];
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
