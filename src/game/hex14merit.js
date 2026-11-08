// ───────── 공적: 싸워서 적 병사를 쓰러뜨리거나 내정을 맡으면 쌓이고, 일정 공적마다 특성을 하나 익히거나 올림 ─────────
// 문턱마다 무작위 후보 3가지(새 특성·가진 특성 올리기 섞어서) 중 하나를 고름 — 매 판 다르게
//   · 내 장수: 할 일 목록·✨ 표시에서 직접 고름. 특성이 3개로 차 있는데 새 특성을 고르면 무엇을 잊을지도 고름 (포켓몬 기술 배우기처럼)
//   · 컴퓨터 장수: 알아서 고름 (올리기 우선, 가득 차면 가장 낮은 것과 바꿈)
// 후보는 지도에 맞게 뽑음: 사막이 거의 없는 지도에선 「사막」이, 항구가 적으면 「수군·교역」이 잘 안 나옴
import { T14 } from './hex14traits.js';
import { T } from './rules.js';
import { makeRng } from './rng.js';
import { gensOf, log } from './hex14.js';
import { ROLES, jobGen } from './hex14gov.js';

// 이만큼 공적이 쌓일 때마다 하나 (적 병사 1명 = 공적 1, 내정 담당 1순 = 1,000)
export const MERIT_STEPS = [15000, 50000, 150000, 400000, 1000000];
export const JOB_MERIT = 1000;
const ALL = Object.keys(T14);
const TIER = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];
export const traitName = ([k, t]) => `${k}${TIER[t] || ''}`;
export const nextMerit = (g) => MERIT_STEPS[g.meritLv || 0] ?? null;

// 지도에 맞는 특성 무게 (게임을 만들 때 한 번)
export function mapTraitWeights(s, grid) {
  let land = 0; const n = {};
  for (let i = 0; i < grid.N; i++) { const t = grid.terrain[i]; if (t === T.SEA || t === T.PEAK || grid.outside?.[i]) continue; land++; n[t] = (n[t] || 0) + 1; if (grid.river?.[i]) n.river = (n.river || 0) + 1; }
  const sh = (k) => (n[k] || 0) / Math.max(1, land);
  const cities = s.castles.filter((c) => c.kind !== 'pass'), ports = cities.filter((c) => c.port).length / Math.max(1, cities.length);
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  return {
    사막: cl((sh(T.DESERT) + sh(T.TUNDRA)) / 0.12, 0.1, 1.5),
    산악: cl((sh(T.HILLS) + sh(T.MOUNTAIN)) / 0.2, 0.2, 1.5),
    화공: cl((sh(T.FOREST) + sh(T.HILLS)) / 0.3, 0.3, 1.4),
    기마: cl(sh(T.PLAINS) / 0.4, 0.4, 1.4),
    도하: cl(sh('river') / 0.05, 0.2, 1.3),
    수군: cl(ports / 0.3, 0.15, 1.3),
    교역: cl(ports / 0.3, 0.15, 1.3),
    상업: 0.6, 외교: 0.6, // 나라에서 가장 높은 장수 하나만 쓰임
  };
}

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

// 순마다: 내정 담당 공적 + 문턱을 넘은 장수에게 후보
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

// 후보 3가지: 올리기(가진 특성 한 단계)와 새 특성을 섞어서
export function meritOptions(s, g, rng) {
  const W = s.traitW || {};
  const own = g.traits || [];
  const opts = [];
  const ups = own.filter(([, t]) => t < 3).map(([k, t]) => [k, t + 1, true]);
  const fresh = ALL.filter((k) => !own.some(([x]) => x === k));
  for (let i = 0; i < 3; i++) {
    const upLeft = ups.filter(([k]) => !opts.some(([x]) => x === k));
    if (upLeft.length && rng() < 0.4) { opts.push(upLeft[Math.floor(rng() * upLeft.length)]); continue; }
    const pool = fresh.filter((k) => !opts.some(([x]) => x === k));
    if (!pool.length) { if (upLeft.length) opts.push(upLeft[0]); continue; }
    let sum = pool.reduce((a, k) => a + (W[k] ?? 1), 0), r = rng() * sum, pick = pool[0];
    for (const k of pool) { r -= W[k] ?? 1; if (r <= 0) { pick = k; break; } }
    opts.push([pick, rng() < 0.25 ? 2 : 1, false]);
  }
  return opts;
}

function grant(s, g) {
  const rng = makeRng(`merit:${s.seed}:${g.id}:${g.meritLv}`);
  g.traits = g.traits || [];
  const opts = meritOptions(s, g, rng);
  if (!opts.length) return;
  if (!s.spectator && g.nation === s.playerId) {
    s.traitOffers = [...(s.traitOffers || []), { gid: g.id, opts, lv: g.meritLv, turn: s.turn }];
    log(s, `✨ ${g.name}이(가) 공적 ${Math.round(MERIT_STEPS[g.meritLv - 1] / 10000)}만을 넘어 새 특성을 고를 수 있습니다 (할 일 목록)`, 'info', [g.nation]);
    return;
  }
  // 컴퓨터: 올리기가 있으면 가장 높은 등급이 되는 것, 없으면 새 특성 (가득 차면 가장 낮은 것과 바꿈)
  const up = opts.filter((o) => o[2]).sort((a, b) => b[1] - a[1])[0];
  const pick = up || opts[0];
  applyPick(g, pick, g.traits.length >= 3 && !pick[2] ? g.traits.reduce((a, b, i) => (b[1] < g.traits[a][1] ? i : a), 0) : null);
}

function applyPick(g, [k, t, up], forget) {
  if (up) { const tr = g.traits.find(([x]) => x === k); if (tr) tr[1] = Math.max(tr[1], t); return; }
  if (g.traits.length < 3) { g.traits.push([k, t]); return; }
  if (forget === null || forget === undefined) return;
  g.traits = g.traits.map((x, i) => (i === forget ? [k, t] : x));
}

// 예전 저장의 제안({gid, trait})을 새 꼴로
export const offerOpts = (o) => o.opts || (o.trait ? [[o.trait[0], o.trait[1], false]] : []);

// 내 장수 제안 처리: pick = 고른 후보 번호, forget = 잊을 특성 번호(가득 찼을 때), pick이 null이면 이번엔 건너뜀
export function answerOffer(s, gid, pick, forget) {
  const o = (s.traitOffers || []).find((x) => x.gid === gid);
  if (!o) return { ok: false, msg: '고를 특성이 없습니다.' };
  const g = s.generals[gid];
  s.traitOffers = s.traitOffers.filter((x) => x !== o);
  if (!g || pick === null || pick === undefined) return { ok: true, msg: `${g?.name || '장수'}은(는) 이번 특성을 고르지 않았습니다` };
  const opt = offerOpts(o)[pick];
  if (!opt) return { ok: false, msg: '없는 후보입니다.' };
  const old = forget !== null && forget !== undefined ? g.traits[forget] : null;
  applyPick(g, opt, forget);
  return { ok: true, msg: opt[2] ? `${g.name}의 「${opt[0]}」이(가) ${TIER[opt[1]]}로 올랐습니다` : old ? `${g.name}이(가) 「${traitName(old)}」을(를) 잊고 「${traitName(opt)}」을(를) 익혔습니다` : `${g.name}이(가) 새 특성 「${traitName(opt)}」을(를) 익혔습니다` };
}
