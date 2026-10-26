import { T } from './rules.js';

export const SEASONS = ['봄', '여름', '가을', '겨울'];
// 2턴 = 한 계절, 8턴 = 1년
export const TURNS_PER_SEASON = 2;
export const seasonOf = (turn) => Math.floor((turn - 1) / TURNS_PER_SEASON) % 4;
// 기원전(음수)에서 출발하면 0년을 건너뜀 (BC 1 다음은 AD 1)
export const yearOf = (turn, start = 1) => {
  const y = start + Math.floor((turn - 1) / (TURNS_PER_SEASON * 4));
  return start < 0 && y >= 0 ? y + 1 : y;
};
export const fmtYear = (y) => (y < 0 ? `기원전 ${-y}년` : `${y}년`);

// 날씨 효과: att=공격력 배율(전장 기준), ap=진입 행동력 추가, tax=세수 배율, loyalty=민심 변화, noSea=항해 불가
export const WEATHER = {
  clear: { name: '맑음', icon: '', att: 1, ap: 0, tax: 1, loyalty: 0 },
  rain: { name: '비', icon: '🌧️', att: 0.9, river: 0.85, ap: 0, tax: 1, loyalty: 0, desc: '공격 -10%, 도강 추가 -15%' },
  storm: { name: '폭풍', icon: '🌀', att: 0.85, ap: 0, tax: 0.9, loyalty: 0, noSea: true, seaLoss: 0.1, desc: '공격 -15%, 항해 불가, 세수 -10%, 함대 손실 10%' },
  snow: { name: '눈', icon: '❄️', att: 0.75, ap: 1, tax: 0.75, loyalty: -1, noGrowth: true, desc: '공격 -25%, 진입 행동력 +1, 세수 -25%, 인구 정체, 민심 -1' },
  drought: { name: '가뭄', icon: '☀️', att: 1, ap: 0, tax: 0.65, loyalty: -2, noGrowth: true, desc: '세수 -35%, 인구 정체, 민심 -2' },
  harvest: { name: '풍년', icon: '🌾', att: 1, ap: 0, tax: 1.35, loyalty: 2, desc: '세수 +35%, 민심 +2' },
  // 바다 날씨
  rough: { name: '풍랑', icon: '🌊', att: 0.8, ap: 0, tax: 1, loyalty: 0, seaLoss: 0.05, desc: '해전·상륙 -20%, 함대 손실 5%' },
  tailwind: { name: '순풍', icon: '⛵', att: 1.15, ap: 0, tax: 1, loyalty: 0, seaLoss: 0, desc: '해전·상륙 +15%, 함대 손실 없음' },
  waterspout: { name: '용오름', icon: '🌪️', att: 0.8, ap: 0, tax: 1, loyalty: 0, noSea: true, seaLoss: 0.15, desc: '항해 불가, 함대 손실 15%' },
  seafog: { name: '해무', icon: '🌫️', att: 1.15, ap: 0, tax: 1, loyalty: 0, seaLoss: 0.02, desc: '짙은 안개로 기습: 상륙·해전 +15%' },
};

function hash(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// 계절·위도·지형에 따라 넓은 기후대 단위로 날씨를 굴린다
// 계절·위도·지형에 따라 넓은 기후대 단위로 날씨를 굴린다
// 북쪽(한랭)은 눈, 남쪽(고온)은 가뭄이 잦지만, 남쪽은 이모작으로 풍년도 잦아 연간 손익이 비슷하도록 맞춤
const CLIMATE = {
  cold: [
    [['rain', 0.2], ['snow', 0.15]],
    [['rain', 0.15], ['drought', 0.05]],
    [['harvest', 0.15], ['rain', 0.15]],
    [['snow', 0.55], ['rain', 0.05]],
  ],
  temperate: [
    [['rain', 0.25], ['harvest', 0.05]],
    [['drought', 0.2], ['rain', 0.15], ['storm', 0.05]],
    [['harvest', 0.25], ['rain', 0.1], ['storm', 0.05]],
    [['snow', 0.25], ['rain', 0.15]],
  ],
  hot: [
    [['drought', 0.15], ['harvest', 0.1], ['rain', 0.1]],
    [['drought', 0.5], ['storm', 0.05]],
    [['harvest', 0.35], ['drought', 0.1]],
    [['rain', 0.25], ['drought', 0.05]],
  ],
  sea: [
    [['seafog', 0.15], ['tailwind', 0.15], ['rough', 0.1], ['storm', 0.05]],
    [['tailwind', 0.2], ['storm', 0.12], ['waterspout', 0.05], ['seafog', 0.05]],
    [['storm', 0.15], ['rough', 0.15], ['tailwind', 0.1], ['waterspout', 0.03]],
    [['rough', 0.25], ['storm', 0.1], ['seafog', 0.1]],
  ],
};

export function climateOf(r) {
  if (r.sea) return 'sea';
  const lat = Math.abs(r.lat);
  if (lat > 54 || r.terrain === T.TUNDRA || r.terrain === T.MOUNTAIN) return 'cold';
  if (lat < 30 || r.terrain === T.DESERT) return 'hot';
  return 'temperate';
}

export function rollWeather(world, turn, seedNum) {
  const season = seasonOf(turn);
  const zone = world.unit * 9;
  return world.regions.map((r) => {
    const zx = Math.floor(r.cx / zone), zy = Math.floor(r.cy / zone);
    const x = hash(zx, zy, turn * 7919 + seedNum);
    let acc = 0;
    for (const [k, p] of CLIMATE[climateOf(r)][season]) {
      if (k === 'storm' && !r.coastal) continue;
      acc += p;
      if (x < acc) return k;
    }
    return 'clear';
  });
}

export const weatherOf = (s, rid) => WEATHER[s.weather?.[rid] || 'clear'];
