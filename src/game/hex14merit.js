// ───────── 공적: 싸워서 적 병사를 쓰러뜨리거나 내정을 맡으면 쌓이고, 일정 공적마다 특성을 하나 익히거나 올림 ─────────
// 어떤 특성이 붙을지는 무작위 (매 판 다르게). 특성이 3개로 가득 차 있으면:
//   · 내 장수: 「새 특성을 익힐까? 무엇을 잊을까?」를 고르게 함 (포켓몬 기술 배우기처럼) — s.traitOffers
//   · 컴퓨터 장수: 가장 낮은 등급 특성과 바꾸거나 있는 특성을 올림
import { T14 } from './hex14traits.js';
import { makeRng } from './rng.js';
import { gensOf, log } from './hex14.js';
import { ROLES, jobGen } from './hex14gov.js';

// 이만큼 공적이 쌓일 때마다 하나 (적 병사 1명 = 공적 1, 내정 담당 1순 = 600)
export const MERIT_STEPS = [15000, 50000, 150000, 400000, 1000000];
export const JOB_MERIT = 600;
const ALL = Object.keys(T14);
const TIER = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];
export const traitName = ([k, t]) => `${k}${TIER[t] || ''}`;
export const nextMerit = (g) => MERIT_STEPS[g.meritLv || 0] ?? null;

// 부대가 적 병사를 쓰러뜨림: 대장은 전부, 함께 간 장수는 절반
export function meritCredit(s, u, amt) {
  if (!u || u.outlaw || !(amt > 0)) return;
  const gs = gensOf(s, u.gens);
  gs.forEach((g, i) => { g.merit = (g.merit || 0) + Math.round(i ? amt / 2 : amt); });
}
// 성을 지킨 장수: 성 수비대가 쓰러뜨린 만큼 (성에 있는 장수 중 통솔이 가장 높은 이)
export function meritCreditCastle(cg, amt) {
  if (!cg?.length || !(amt > 0)) return;
  const g = cg.reduce((a, b) => (b.lead > a.lead ? b : a));
  g.merit = (g.merit || 0) + Math.round(amt);
}

// 순마다: 내정 담당 공적 + 문턱을 넘은 장수에게 특성
export function meritTurn(s) {
  for (const c of s.castles) {
    if (c.owner === null || c.owner < 0 || c.kind === 'pass') continue;
    for (const r of Object.keys(ROLES)) { const g = jobGen(s, c, r); if (g) g.merit = (g.merit || 0) + JOB_MERIT; }
  }
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active' || !g.merit || g.boss) continue;
    while (nextMerit(g) !== null && g.merit >= nextMerit(g)) { g.meritLv = (g.meritLv || 0) + 1; grant(s, g); }
  }
}

function grant(s, g) {
  const rng = makeRng(`merit:${s.seed}:${g.id}:${g.meritLv}`);
  g.traits = g.traits || [];
  const mine = !s.spectator && g.nation === s.playerId;
  const up = g.traits.filter(([, t]) => t < 3);
  // 40%는 가진 특성을 한 단계 올림 (올릴 게 있으면), 나머지는 새 특성 (Ⅰ, 가끔 Ⅱ)
  if (up.length && (g.traits.length >= 3 ? rng() < 0.5 : rng() < 0.4)) {
    const tr = up[Math.floor(rng() * up.length)];
    tr[1] += 1;
    if (mine) log(s, `⭐ ${g.name}이(가) 공적을 쌓아 「${tr[0]}」이(가) ${TIER[tr[1]]}로 올랐습니다`, 'info', [g.nation]);
    return;
  }
  const pool = ALL.filter((k) => !g.traits.some(([x]) => x === k));
  if (!pool.length) return;
  const nt = [pool[Math.floor(rng() * pool.length)], rng() < 0.25 ? 2 : 1];
  if (g.traits.length < 3) {
    g.traits.push(nt);
    if (mine) log(s, `⭐ ${g.name}이(가) 공적을 쌓아 새 특성 「${traitName(nt)}」을(를) 익혔습니다`, 'info', [g.nation]);
    return;
  }
  if (mine) {
    // 내 장수: 무엇을 잊을지 고르게 함 (같은 장수의 예전 제안은 새 것으로)
    s.traitOffers = [...(s.traitOffers || []).filter((o) => o.gid !== g.id), { gid: g.id, trait: nt, turn: s.turn }];
    log(s, `✨ ${g.name}이(가) 새 특성 「${traitName(nt)}」을(를) 익힐 수 있습니다 — 특성이 가득 차서 하나를 잊어야 해요 (할 일 목록)`, 'info', [g.nation]);
    return;
  }
  // 컴퓨터 장수: 가장 낮은 등급 하나와 바꿈
  const low = g.traits.reduce((a, b, i) => (b[1] < g.traits[a][1] ? i : a), 0);
  if (g.traits[low][1] <= nt[1]) g.traits[low] = nt;
}

// 내 장수 제안 처리: forget = 잊을 특성 번호(0~2), null이면 배우지 않음
export function answerOffer(s, gid, forget) {
  const o = (s.traitOffers || []).find((x) => x.gid === gid);
  if (!o) return { ok: false, msg: '익힐 특성이 없습니다.' };
  s.traitOffers = s.traitOffers.filter((x) => x !== o);
  const g = s.generals[gid];
  if (!g || forget === null || forget === undefined) return { ok: true, msg: `${g?.name || '장수'}은(는) 「${traitName(o.trait)}」을(를) 배우지 않았습니다` };
  const old = g.traits[forget];
  g.traits = g.traits.map((t, i) => (i === forget ? [...o.trait] : t));
  return { ok: true, msg: `${g.name}이(가) 「${traitName(old)}」을(를) 잊고 「${traitName(o.trait)}」을(를) 익혔습니다` };
}
