// 장수 특성: 무관(mil)·문관(civ), 등급 Ⅰ~Ⅲ마다 효과 차등
// scope: army=동행 부대, region=주둔 지역, nation=국가 전체(가장 높은 장수 기준)
const pct = (v) => `${Math.round(v * 100)}%`;

export const TIER = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];

export const TRAITS = {
  // ── 무관 ──
  명장: { cat: 'mil', scope: 'army', val: [0.06, 0.1, 0.15], desc: (v) => `공격 +${pct(v)}` },
  맹장: { cat: 'mil', scope: 'army', val: [0.04, 0.07, 0.1], desc: (v) => `공격 +${pct(v)}, 일기토 위력 +${pct(v * 3)}, 적장 처치↑` },
  수성: { cat: 'mil', scope: 'region', val: [0.1, 0.18, 0.25], desc: (v) => `주둔지 방어 +${pct(v)}` },
  기마: { cat: 'mil', scope: 'army', val: [0.06, 0.1, 0.15], desc: (v) => `평원·사막·동토 공격 +${pct(v)}` },
  수군: { cat: 'mil', scope: 'army', val: [0.1, 0.2, 0.3], desc: (v) => `해전·상륙 +${pct(v)}, 상륙 페널티 무시, 항구 없이 승선` },
  산악: { cat: 'mil', scope: 'army', val: [0.05, 0.1, 0.15], desc: (v) => `험산 방어 보정 무시, 산지 공격 +${pct(v)}` },
  도하: { cat: 'mil', scope: 'army', val: [0.05, 0.1, 0.15], desc: (v) => `도강 페널티 무시, 강 건너 공격 +${pct(v)}` },
  책략: { cat: 'mil', scope: 'army', val: [0.04, 0.07, 0.1], desc: (v) => `공격·방어 +${pct(v)}` },
  공성: { cat: 'mil', scope: 'army', val: [1, 1, 2], desc: (v, t) => `성벽 피해 +${v}${t >= 2 ? ', 강습 손실 -30%' : ''}` },
  궁술: { cat: 'mil', scope: 'region', val: [0.06, 0.1, 0.15], desc: (v) => `주둔지 방어 +${pct(v)}, 격퇴 시 적 손실 +${pct(v * 2)}` },
  매복: { cat: 'mil', scope: 'region', val: [0.1, 0.15, 0.22], desc: (v) => `숲·구릉·험산 주둔지 방어 +${pct(v)}` },
  돌격: { cat: 'mil', scope: 'army', val: [0.1, 0.15, 0.2], desc: (v) => `적보다 병력이 적을 때 공격 +${pct(v)}` },
  무쌍: { cat: 'mil', scope: 'army', val: [0.15, 0.3, 0.45], desc: (v) => `일기토 체력 +${pct(v)}` },
  신속: { cat: 'mil', scope: 'nation', val: [1, 1, 2], desc: (v) => `국가 행동력 +${v}` },
  징병: { cat: 'mil', scope: 'region', val: [0.1, 0.2, 0.3], desc: (v) => `주둔지 징병 +${pct(v)}` },
  보급: { cat: 'mil', scope: 'army', val: [0.4, 0.7, 1], desc: (v) => `보급 끊김 페널티 -${pct(v)}` },
  설중: { cat: 'mil', scope: 'army', val: [0.05, 0.1, 0.15], desc: (v) => `눈 페널티 무시, 눈 속 공격 +${pct(v)}` },
  우전: { cat: 'mil', scope: 'army', val: [0.05, 0.1, 0.15], desc: (v) => `비 페널티 무시, 빗속 공격 +${pct(v)}` },
  사막: { cat: 'mil', scope: 'army', val: [0.05, 0.1, 0.15], desc: (v) => `사막 소모 무시, 사막 공격 +${pct(v)}` },
  화공: { cat: 'mil', scope: 'army', val: [0.08, 0.14, 0.2], desc: (v) => `맑거나 가문 날 숲·구릉 공격 +${pct(v)}` },
  위압: { cat: 'mil', scope: 'army', val: [0.05, 0.08, 0.12], desc: (v) => `적 방어력 -${pct(v)}` },
  추격: { cat: 'mil', scope: 'army', val: [0.15, 0.25, 0.35], desc: (v) => `승리 시 적장 포로율 +${pct(v)}` },
  노련: { cat: 'mil', scope: 'army', val: [0.15, 0.25, 0.35], desc: (v) => `공격 실패 시 생환 병력 +${pct(v)}` },
  상륙: { cat: 'mil', scope: 'army', val: [0.4, 0.7, 1], desc: (v) => `상륙·절벽 상륙 페널티 -${pct(v)}` },
  항해: { cat: 'mil', scope: 'army', val: [0.3, 0.6, 1], desc: (v, t) => `바다 병력 손실 -${pct(v)}${t >= 3 ? ', 폭풍·용오름 속 항해 가능' : ''}` },
  해안방어: { cat: 'mil', scope: 'region', val: [0.1, 0.18, 0.25], desc: (v) => `주둔지가 바다에서 공격받을 때 방어 +${pct(v)}` },
  철벽: { cat: 'mil', scope: 'region', val: [0.2, 0.35, 0.5], desc: (v) => `주둔지 방어 시 아군 손실 -${pct(v / (1 + v))}` },
  // ── 문관 ──
  정치: { cat: 'civ', scope: 'region', val: [0.1, 0.2, 0.3], desc: (v) => `주둔지 세수 +${pct(v)}` },
  인덕: { cat: 'civ', scope: 'region', val: [1, 2, 3], desc: (v) => `주둔지 자원병 +${v * 20}%, 포로 등용 +${v * 5}%, 나라 장수 충성 목표 +${v * 5}` },
  외교: { cat: 'civ', scope: 'nation', val: [6, 11, 16], desc: (v) => `외교 수락 점수 +${v}` },
  건축: { cat: 'civ', scope: 'region', val: [0.1, 0.2, 0.3], desc: (v) => `주둔지 건설비 -${pct(v)}` },
  축성: { cat: 'civ', scope: 'region', val: [0.1, 0.2, 0.3], desc: (v) => `성벽 방어 +${pct(v)}, 성벽 복구 +1/턴` },
  농정: { cat: 'civ', scope: 'region', val: [0.3, 0.6, 1], desc: (v) => `주둔지 인구 증가 +${pct(v)}, 가뭄 피해 -${pct(v / 2)}` },
  상업: { cat: 'civ', scope: 'nation', val: [0.03, 0.05, 0.08], desc: (v) => `국가 전체 세수 +${pct(v)}` },
  치안: { cat: 'civ', scope: 'region', val: [0.3, 0.6, 0.9], desc: (v) => `함께 주둔한 장수의 봉기 확률 -${pct(v)}` },
  인사: { cat: 'civ', scope: 'nation', val: [0.15, 0.3, 0.45], desc: (v) => `장수 출현 확률 +${pct(v)}` },
  첩보: { cat: 'civ', scope: 'nation', val: [10, 15, 20], desc: (v) => `회유 확률 +${v}%p` },
  의술: { cat: 'civ', scope: 'nation', val: [0.3, 0.6, 0.9], desc: (v) => `역병 피해 -${pct(v)}` },
  학문: { cat: 'civ', scope: 'nation', val: [0.1, 0.2, 0.3], desc: (v) => `장수 경험치 +${pct(v)}` },
  병참: { cat: 'civ', scope: 'nation', val: [0.08, 0.14, 0.2], desc: (v) => `병력 유지비 -${pct(v)}` },
  치수: { cat: 'civ', scope: 'region', val: [0.1, 0.2, 0.3], desc: (v) => `강 유역 주둔지 세수 +${pct(v)}, 홍수 피해 없음` },
  교역: { cat: 'civ', scope: 'region', val: [0.15, 0.3, 0.45], desc: (v) => `항구 있는 주둔지 세수 +${pct(v)}` },
  설득: { cat: 'civ', scope: 'nation', val: [10, 15, 20], desc: (v) => `포로 등용 +${v}%p` },
  모병: { cat: 'civ', scope: 'region', val: [0.5, 1, 1.5], desc: (v) => `주둔지 자원병 +${pct(v)}` },
  명망: { cat: 'civ', scope: 'nation', val: [1, 1, 2], desc: (v) => `평판 +${v}/턴(최대 80)` },
};

export const MIL = Object.keys(TRAITS).filter((k) => TRAITS[k].cat === 'mil');
export const CIV = Object.keys(TRAITS).filter((k) => TRAITS[k].cat === 'civ');

export const traitVal = (id, tier) => TRAITS[id].val[Math.max(1, Math.min(3, tier)) - 1];
export const traitDesc = (id, tier) => TRAITS[id].desc(traitVal(id, tier), tier);
export const traitLabel = ([id, tier]) => `${id}${TIER[tier]}`;

// 장수 무리에서 해당 특성의 최고 효과값 (없으면 0)
export function tv(gens, id) {
  let best = 0, bt = 0;
  for (const g of gens) for (const [t, tier] of g.traits || []) if (t === id && tier > bt) { bt = tier; best = traitVal(id, tier); }
  return best;
}

export function roleOf(g) {
  return g.pol + g.intel > g.war + g.lead ? 'civ' : 'mil';
}

const tierFor = (v) => (v >= 93 ? 3 : v >= 82 ? 2 : 1);

// 원본 데이터의 단일 특성 → 등급 있는 특성 목록
export function initTraits(g, rng) {
  const role = roleOf(g);
  const base = g.trait && TRAITS[g.trait] ? g.trait : role === 'civ' ? '정치' : '명장';
  const key = TRAITS[base].cat === 'civ' ? Math.max(g.pol, g.intel) : Math.max(g.war, g.lead);
  const traits = [[base, tierFor(key)]];
  const rating = (g.war + g.lead + g.intel + g.pol) / 4;
  if (rating >= 82 && rng() < 0.6) {
    const pool = (role === 'civ' ? CIV : MIL).filter((t) => t !== base);
    traits.push([rng.pick(pool), 1]);
  }
  return { role, traits };
}

// 레벨업 시 3·5·7·9레벨: 기존 특성 승급 또는 새 특성
export function growTrait(g, rng) {
  const cat = g.role === 'civ' ? CIV : MIL;
  const up = g.traits.filter(([, t]) => t < 3);
  if (up.length && (g.traits.length >= 3 || rng() < 0.5)) {
    const tr = rng.pick(up);
    tr[1] += 1;
    return `「${traitLabel(tr)}」 승급`;
  }
  const fresh = cat.filter((t) => !g.traits.some(([x]) => x === t));
  if (!fresh.length) return null;
  const t = rng.pick(fresh);
  g.traits.push([t, 1]);
  return `새 특성 「${t}Ⅰ」`;
}

export const TITLES = {
  mil: [[3, '역전의 장수'], [5, '백전노장'], [7, '만인적'], [9, '군신']],
  civ: [[3, '능리'], [5, '명재상'], [7, '경세가'], [9, '왕좌지재']],
};
