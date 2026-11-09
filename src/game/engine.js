// 게임 시작 준비(setup.js)에서 쓰는 나라·장수 도우미 — 예전 「지역 모드」 진행 규칙은 뺌
import { localName } from './localnames.js';
import { G } from './rules.js';

import { POOLS, rating, randomStats, fairTarget, gradeScore } from './generals.js';
import { fixJosa } from './josa.js';

import { tv, initTraits, traitLabel } from './traits.js';

// ───────── 조회 헬퍼 ─────────
export const relKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const getRel = (s, a, b) => s.relations[relKey(a, b)] || { type: 'none' };
// 육지 영토만 (바다 구역의 함대는 제외)
export const nationRegions = (s, nid) => s.regions.reduce((acc, r, i) => (r.owner === nid && !r.sea ? (acc.push(i), acc) : acc), []);
export const nationGenerals = (s, nid) => {
  const out = [];
  for (const k in s.generals) {
    const g = s.generals[k];
    if (g.nation === nid && g.status === 'active') out.push(g);
  }
  return out;
};
export const nationTrait = (s, nid, id) => tv(nationGenerals(s, nid), id);
export const landCount = (s) => s.regions.filter((r) => !r.sea).length;

export function log(s, text, nations = [], kind = 'info') {
  text = fixJosa(text);
  s.log.unshift({ turn: s.turn, text, nations, kind });
  if (s.log.length > 300) s.log.length = 300;
  if (nations.includes(s.playerId) && s.turnNews) s.turnNews.push(text);
}

export function nationPower(s, nid) {
  let p = 0;
  for (const r of s.regions) if (r.owner === nid) p += r.troops / 1000 + (r.sea ? 0 : 6 + r.pop * 0.2);
  return p + s.nations[nid].gold / (10 * G) + nationGenerals(s, nid).length * 8;
}

export function isVassalOf(s, a, b) {
  const r = getRel(s, a, b);
  return r.type === 'vassal' && r.overlord === b;
}

export function computeMaxAp(s, nid) {
  const regions = nationRegions(s, nid).length;
  const fast = Math.min(2, nationTrait(s, nid, '신속'));
  // 큰 지도(지역이 잘게 나뉨)는 행동력 상한도 비례해서 늘림
  const cap = Math.round(7 * Math.max(1, landCount(s) / 150));
  // 행동력 1.3배 (손이 덜 모자라게)
  let ap = Math.round((3 + Math.min(cap, Math.floor(regions / 6))) * 1.3) + fast;
  if (s.nations.some((o) => o.alive && o.id !== nid && isVassalOf(s, nid, o.id))) ap -= 1;
  return Math.max(2, ap);
}

export function makeBond(s, a, b) {
  if (!a || !b || a.id === b.id) return;
  a.bonds = [...new Set([...(a.bonds || []), b.id])];
  b.bonds = [...new Set([...(b.bonds || []), a.id])];
}

// ───────── 장수 출현 (공평 규칙) ─────────
// 낮은 기본값 × 공평 보정 × 국고 × 평판 × 인사 특성
export function appearChance(s, nid) {
  const n = s.nations[nid];
  const alive = s.nations.filter((x) => x.alive);
  const counts = alive.map((x) => nationGenerals(s, x.id).length);
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const mine = nationGenerals(s, nid).length;
  const regs = nationRegions(s, nid);
  let p = 0.06 * Math.max(0.25, Math.min(2.5, 1 + (avg - mine) * 0.4));
  p *= n.gold >= 200 * G ? 1.2 : n.gold < 30 * G ? 0.7 : 1;
  p *= Math.max(0.5, Math.min(1.4, n.reputation / 60));
  p *= 1 + nationTrait(s, nid, '인사');
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
  const names = new Set(Object.values(s.generals).map((g) => g.name)); // 같은 인물이 두 명 나오지 않게 (군주·다른 명단)
  n.pools.forEach((pool, i) => {
    for (const g of POOLS[pool] || []) if (!s.usedGen[g.id] && !names.has(g.name)) cands.push({ g, w: (i === 0 ? 1 : 0.45) * generalWeight(s, g, strength) });
  });
  // 명단이 바닥나면 다른 나라 인물을 빌리지 않고, 그 나라 말로 된 이름의 장수를 지어 냄 (국적이 섞이지 않게)
  if (!cands.length) {
    const civ = n.pools[0];
    const taken = new Set(Object.values(s.generals).map((g) => g.name));
    const name = localName(civ, rng, taken, n.civ);
    const base = 55 + rng.int(0, 20);
    cands.push({ g: { id: `local:${nid}:${name}`, name, war: base + rng.int(-10, 10), lead: base + rng.int(-10, 10), intel: base + rng.int(-10, 10), pol: base + rng.int(-10, 10), pool: civ }, w: 1 });
  }
  const pick = rng.weighted(cands, (c) => c.w);
  if (!pick) return null;
  const own = nationRegions(s, nid);
  const gen = addGeneral(s, pick.g, nid, rng.chance(0.6) ? n.capital : rng.pick(own), rng);
  const kind = gen.role === 'civ' ? '문관' : '무관';
  log(s, `⭐ ${n.name}에 ${kind} ${gen.name}(무${gen.war}/통${gen.lead}/지${gen.intel}/정${gen.pol}, ${gen.traits.map(traitLabel).join('·')})이(가) 출현했습니다.`, [nid], 'general');
  return gen;
}

// 역사 속 의형제·벗
const BONDS = [['유비', '관우', '장비'], ['손책', '주유'], ['하후돈', '하후연'], ['관평', '관우'], ['김유신', '김춘추'], ['오다 노부나가', '도쿠가와 이에야스'], ['도요토미 히데요시', '마에다 도시이에'], ['칭기즈 칸', '자무카'], ['리처드 1세', '로뱅 드 로크'], ['이순신', '유성룡']];

export function addGeneral(s, data, nid, region, rng, ruler = false) {
  if (!s.opts?.histStats) {
    const mine = Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && g.base);
    data = randomStats(data, fairTarget(mine.map((g) => g.base), rng, ruler), rng);
  }
  data = { ...data, base: Math.round(gradeScore(data)) };
  const { role, traits } = initTraits(data, rng, { random: !s.opts?.histStats });
  // 성격: 야심가(20%)는 충성이 잘 떨어져 봉기·계승 다툼을 일으키고, 충신(20%)은 배신하지 않음
  const pr = rng();
  const persona = ruler ? null : pr < 0.2 ? '야심' : pr < 0.4 ? '충신' : null;
  const gen = { ...data, role, traits, level: 1, exp: 0, nation: nid, origin: nid, region, status: 'active', captor: null, loyalty: rng.int(55, 90), persona };
  s.generals[gen.id] = gen;
  s.usedGen[gen.id] = 1;
  // 인연: 역사 속 의형제는 같은 나라에 있으면 맺어지고, 그 밖엔 가끔(15%) 같은 나라 장수와 의형제를 맺음
  const mates = Object.values(s.generals).filter((x) => x.id !== gen.id && x.nation === nid && x.status === 'active');
  const hist = BONDS.find((set) => set.includes(gen.name));
  if (hist) for (const x of mates) if (hist.includes(x.name)) makeBond(s, gen, x);
  if (!gen.bonds && mates.length && rng() < 0.15) makeBond(s, gen, rng.pick(mates));
  s.appearHistory[gen.id] = (s.appearHistory[gen.id] || 0) + 1;
  return gen;
}
