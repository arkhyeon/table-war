// 지형 코드
export const T = { SEA: 0, PLAINS: 1, FOREST: 2, HILLS: 3, DESERT: 4, TUNDRA: 5, MOUNTAIN: 6, PEAK: 7 };

export const TERRAIN = {
  [T.SEA]: { name: '바다', color: '#8fb8cc' },
  [T.PLAINS]: { name: '평원', def: 1.0, pop: 30, color: '#d6dfa6', desc: '방어 보정 없음' },
  [T.FOREST]: { name: '숲', def: 1.15, pop: 20, color: '#8db37a', desc: '방어 +15%' },
  [T.HILLS]: { name: '구릉', def: 1.25, pop: 22, color: '#cdb486', desc: '방어 +25%' },
  [T.DESERT]: { name: '사막', def: 1.0, pop: 9, color: '#ecd9a0', desc: '인구 적음, 공격측 소모 10%' },
  [T.TUNDRA]: { name: '동토', def: 1.05, pop: 8, color: '#e3e8e8', desc: '인구 적음' },
  [T.MOUNTAIN]: { name: '험산', def: 1.5, pop: 11, color: '#a8927a', desc: '넘기 힘든 산: 방어 +50%, 진입 행동력 +1' },
  [T.PEAK]: { name: '고산', color: '#6e645a', desc: '통행 불가' },
};

export const EDGE = {
  land: { name: '육로', mult: 1, desc: '' },
  river: { name: '도강', mult: 0.8, desc: '강 건너 공격 -20%' },
  sea: { name: '항해', mult: 0.7, desc: '해상 공격 -30%, 항구 필요, 행동력 +1' },
};

export const TRAITS = {
  명장: '공격 +15%',
  맹장: '공격 +10%, 전투에서 적장 처치 확률 증가',
  수성: '방어 +25%',
  기마: '평원·사막·동토 공격 +15%',
  수군: '해상 페널티 무시, 항구 없이 항해 가능',
  산악: '험산 방어 보정 무시',
  도하: '도강 페널티 무시',
  정치: '주둔 지역 징세 +30%',
  징병: '주둔 지역 징병 +30%',
  건축: '주둔 지역 건설비 -30%',
  외교: '외교 수락률 증가',
  신속: '국가 행동력 +1',
  책략: '공격·방어 +10%',
  인덕: '포로 등용 확률 +15%',
};

export const BUILDINGS = {
  market: { name: '시장', icon: '💰', cost: 60, ap: 2, desc: '징세 +50%, 턴 수입 +4' },
  walls: { name: '성벽', icon: '🏰', cost: 80, ap: 2, desc: '방어 +50%' },
  port: { name: '항구', icon: '⚓', cost: 70, ap: 2, desc: '해상 이동 가능, 턴 수입 +3', coastal: true },
  barracks: { name: '병영', icon: '⚔️', cost: 60, ap: 2, desc: '징병 +50%' },
};

export const COST = {
  tax: 1,
  conscript: 1,
  conscriptGold: 15,
  move: 1,
  diplomacy: 1,
  recruit: 1,
  relocate: 1,
  poach: 1,
  poachGold: 80,
};

export const TREATY = {
  none: '없음',
  alliance: '동맹',
  nap: '불가침',
  vassal: '종속',
};
