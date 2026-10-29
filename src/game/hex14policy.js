// ───────── 삼국지14식 모드: 정책 — 나라 전체에 거는 제도 (도시가 많을수록 칸이 늘어남) ─────────
import { fmtGold } from './format.js';
import { log } from './hex14.js';

export const POLICIES = {
  farming: { name: '둔전', icon: '🌾', desc: '가을 수확 +30%, 금 수입 −10%' },
  commerce: { name: '상업 장려', icon: '🏪', desc: '금 수입 +25%' },
  conscript: { name: '징병령', icon: '📯', desc: '자원병 +50%, 징병 1명당 8금' },
  fortify: { name: '축성 장려', icon: '🧱', desc: '성벽 수리 2배, 성 시설 비용 −30%' },
  talent: { name: '인재 등용', icon: '🎓', desc: '등용 확률 +15%, 재야가 더 자주 나타남' },
  military: { name: '군비 확장', icon: '⚔️', desc: '출진 비용 없음, 부대 공격 +5%' },
  navy: { name: '수군 육성', icon: '⛵', desc: '모든 부대가 물 위에서 약해지지 않음' },
};
export const POLICY_COST = 20000; // 처음 펼칠 때
export const POLICY_UPKEEP = 1000; // 순마다 하나당

export const hasPolicy = (s, nid, k) => nid !== null && nid !== undefined && nid >= 0 && !!s.nations[nid]?.policies?.includes(k);
export const policySlots = (s, nid) => Math.min(4, 1 + Math.floor(s.castles.filter((c) => c.owner === nid && c.kind !== 'pass').length / 8));

export function adoptPolicy(s, nid, k) {
  const n = s.nations[nid];
  n.policies = n.policies || [];
  if (n.policies.includes(k)) return { ok: false, msg: '이미 펼친 정책입니다.' };
  if (n.policies.length >= policySlots(s, nid)) return { ok: false, msg: `정책 칸이 다 찼습니다 (${policySlots(s, nid)}칸, 도시 8곳마다 1칸 더).` };
  if (n.gold < POLICY_COST) return { ok: false, msg: `금이 모자랍니다 (${fmtGold(POLICY_COST)}).` };
  n.gold -= POLICY_COST;
  n.policies = [...n.policies, k];
  log(s, `${POLICIES[k].icon} ${n.name}이(가) 「${POLICIES[k].name}」 정책을 펼쳤습니다.`, 'info', [nid]);
  return { ok: true, msg: `「${POLICIES[k].name}」 시행!` };
}

export function dropPolicy(s, nid, k) {
  const n = s.nations[nid];
  n.policies = (n.policies || []).filter((x) => x !== k);
  return { ok: true, msg: `「${POLICIES[k].name}」을(를) 거두었습니다.` };
}

// 컴퓨터: 칸이 비고 금이 있으면 처지에 맞는 정책
export function aiPolicy(s, nid, atWar, hungry) {
  const n = s.nations[nid];
  if ((n.policies || []).length >= policySlots(s, nid) || n.gold < POLICY_COST * 2) return;
  const pref = hungry ? ['farming', 'commerce', 'conscript', 'military'] : atWar ? ['conscript', 'military', 'commerce', 'farming', 'fortify'] : ['commerce', 'farming', 'talent', 'fortify'];
  for (const k of pref) if (!hasPolicy(s, nid, k)) { adoptPolicy(s, nid, k); return; }
}
