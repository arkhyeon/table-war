// 금 단위: 병사 1명 유지비 = 1금/턴이 되도록 맞춘 배율
export const G = 2500;

// 지형 코드
export const T = { SEA: 0, PLAINS: 1, FOREST: 2, HILLS: 3, DESERT: 4, TUNDRA: 5, MOUNTAIN: 6, PEAK: 7 };

export const TERRAIN = {
  [T.SEA]: { name: '바다', color: '#8fb8cc' },
  [T.PLAINS]: { name: '평원', def: 1.0, pop: 30, color: '#d6dfa6', desc: '방어 보정 없음' },
  [T.FOREST]: { name: '숲', def: 1.15, pop: 20, color: '#8db37a', desc: '방어 +15%' },
  [T.HILLS]: { name: '구릉', def: 1.25, pop: 22, color: '#cdb486', desc: '방어 +25%' },
  [T.DESERT]: { name: '사막', def: 1.0, pop: 9, color: '#ecd9a0', desc: '인구 적음, 공격측 소모 10%' },
  [T.TUNDRA]: { name: '동토', def: 1.05, pop: 8, color: '#e3e8e8', desc: '인구 적음' },
  [T.MOUNTAIN]: { name: '산지', def: 1.1, pop: 11, color: '#a8927a', desc: '방어 +10% (험산은 경계선에 걸림: 그 경계로 넘을 때만 페널티)' },
  [T.PEAK]: { name: '고산', color: '#6e645a', desc: '통행 불가' },
};

export const EDGE = {
  land: { name: '육로', mult: 1, desc: '' },
  river: { name: '도강', mult: 0.8, desc: '강 건너 공격 -20%' },
  strait: { name: '해협', mult: 0.7, desc: '좁은 해협 건너기: 공격 -30%, 행동력 +1 (수군·상륙 장수가 경감)' },
  coast: { name: '승선', mult: 1, desc: '항구 또는 수군 장수 필요' },
  sea: { name: '해전', mult: 1, desc: '함대끼리 교전' },
  landing: { name: '상륙', mult: 0.75, desc: '바다에서 상륙 공격 -25% (수군·상륙 장수가 경감)' },
  cliff: { name: '절벽 상륙', mult: 0.45, desc: '깎아지른 해안: 공격 -55%, 행동력 +1 (상륙 장수가 경감)' },
  march: { name: '행군(내 땅 3칸)', mult: 1, desc: '내 땅으로만 이어진 길로 한 번에 3칸, 행동력 없음' },
};
// 험산 경계: 이 경계선으로 넘으면 공격 -35%, 행동력 +1 (다른 경계로 돌아가면 없음)
export const MTN_EDGE = { name: '험산 경계', mult: 0.65 };


export const BUILDINGS = {
  market: { name: '시장', icon: '💰', cost: 150000, ap: 2, desc: '그 지역 세수 +50%, 인구 상한 +8천' },
  walls: { name: '성벽', icon: '🏰', cost: 200000, ap: 2, desc: '방어 +50%, 내구 3: 0이 되기 전엔 함락 불가' },
  port: { name: '항구', icon: '⚓', cost: 175000, ap: 2, desc: '승선 가능, 턴 수입 +7,500', coastal: true },
  barracks: { name: '병영', icon: '⚔️', cost: 150000, ap: 2, desc: '징병 한도 +50%, 일괄 징병 5%→8%, 자원병 2배, 무관 훈련' },
};

export const COST = {
  conscript: 1,
  move: 1,
  diplomacy: 1,
  recruit: 1,
  relocate: 1,
  poach: 1,
  poachGold: 200000,
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

// 전투 종류 (다시보기·기록 표시용)
export const BATTLE_KIND = {
  field: '⚔️ 야전',
  siege: '🏰 공성전',
  river: '🌊 도하전',
  strait: '⛵ 해협 도하',
  naval: '⚓ 해전',
  landing: '🚣 상륙전',
  cliff: '🧗 절벽 상륙전',
};

// 난이도: 컴퓨터 세수·초기 병력 보정
export const DIFFICULTY = {
  easy: { name: '쉬움', tax: -0.15, troops: 0.85 },
  normal: { name: '보통', tax: 0, troops: 1 },
  hard: { name: '어려움', tax: 0.2, troops: 1.2 },
};
