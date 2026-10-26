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
  coast: { name: '승선', mult: 1, desc: '항구 또는 수군 장수 필요' },
  sea: { name: '해전', mult: 1, desc: '함대끼리 교전' },
  landing: { name: '상륙', mult: 0.75, desc: '바다에서 상륙 공격 -25% (수군 장수는 무시)' },
};


export const BUILDINGS = {
  market: { name: '시장', icon: '💰', cost: 60, ap: 2, desc: '세수 +50%, 인구 상한 증가' },
  walls: { name: '성벽', icon: '🏰', cost: 80, ap: 2, desc: '방어 +50%, 내구 3: 0이 되기 전엔 함락 불가' },
  port: { name: '항구', icon: '⚓', cost: 70, ap: 2, desc: '해상 이동 가능, 턴 수입 +3', coastal: true },
  barracks: { name: '병영', icon: '⚔️', cost: 60, ap: 2, desc: '징병 +50%' },
};

export const COST = {
  conscript: 1,
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

// 세율 정책: 매 턴 자동 징수
export const TAX = {
  low: { name: '낮음', mult: 0.6, loyalty: 3, growth: 1.6, desc: '세수 60% · 민심 +3/턴 · 인구 증가 빠름' },
  normal: { name: '보통', mult: 1, loyalty: 0, growth: 1, desc: '세수 100%' },
  high: { name: '높음', mult: 1.45, loyalty: -4, growth: 0.3, desc: '세수 145% · 민심 -4/턴 · 인구 정체' },
};
