// 일기토: 공격·강타·방어·반격 4가지 수
// 원안(공격·카운터·방어)은 방어가 지는 경우가 없어 방어만 고르게 되므로,
// 방어를 깨는 '강타'를 넣고 반격은 방어 상대에게 빈틈을 보이도록 해 순환 구조를 만들었다.
export const MOVES = {
  attack: { name: '공격', icon: '🗡️', desc: '빠른 일격. 강타를 끊고, 반격에 당하고, 방어에 막힘(약한 피해)' },
  smash: { name: '강타', icon: '🪓', desc: '방어를 부숨(큰 피해). 공격·반격에 짐' },
  defend: { name: '방어', icon: '🛡️', desc: '공격을 막고 반격을 무력화. 강타에 뚫림' },
  counter: { name: '반격', icon: '🔄', desc: '공격·강타를 받아침(큰 피해). 방어 상대에겐 빈틈' },
};

// OUT[a][b] = [a가 받는 피해, b가 받는 피해] (상대 위력 배수)
const OUT = {
  attack: { attack: [1, 1], smash: [0, 1], defend: [0, 0.3], counter: [1.5, 0] },
  smash: { attack: [1, 0], smash: [1.6, 1.6], defend: [0, 2], counter: [1.5, 0] },
  defend: { attack: [0.3, 0], smash: [2, 0], defend: [0, 0], counter: [0, 0.5] },
  counter: { attack: [0, 1.5], smash: [0, 1.5], defend: [0.5, 0], counter: [0, 0] },
};

export const duelHp = (g) => Math.round(60 + g.war * 0.7 + g.lead * 0.2);
export const duelPow = (g) => 8 + g.war * 0.2;

const BASE_MIX = { attack: 0.3, smash: 0.2, defend: 0.25, counter: 0.25 };

function bestResponse(opp) {
  let best = null, bv = -Infinity;
  for (const m of Object.keys(MOVES)) {
    const [mine, theirs] = OUT[m][opp];
    const v = theirs - mine;
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

// AI의 수 선택: 지력이 높을수록 상대 수를 간파할 확률↑
export const readChance = (me, opp) => Math.max(0, Math.min(0.45, (me.intel - opp.intel) / 150 + 0.1));

export function aiMove(rng, me, opp, oppMove) {
  if (oppMove && rng() < readChance(me, opp)) return bestResponse(oppMove);
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
