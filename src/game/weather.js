import { T } from './rules.js';

export const SEASONS = ['봄', '여름', '가을', '겨울'];
export const seasonOf = (turn) => (turn - 1) % 4;

// 날씨 효과: att=공격력 배율(전장 기준), ap=진입 행동력 추가, tax=세수 배율, loyalty=민심 변화, noSea=항해 불가
export const WEATHER = {
  clear: { name: '맑음', icon: '', att: 1, ap: 0, tax: 1, loyalty: 0 },
  rain: { name: '비', icon: '🌧️', att: 0.9, river: 0.85, ap: 0, tax: 1, loyalty: 0, desc: '공격 -10%, 도강 추가 -15%' },
  storm: { name: '폭풍', icon: '🌀', att: 0.85, ap: 0, tax: 0.9, loyalty: 0, noSea: true, desc: '공격 -15%, 항해 불가, 세수 -10%' },
  snow: { name: '눈', icon: '❄️', att: 0.75, ap: 1, tax: 0.9, loyalty: 0, desc: '공격 -25%, 진입 행동력 +1' },
  drought: { name: '가뭄', icon: '☀️', att: 1, ap: 0, tax: 0.65, loyalty: -2, noGrowth: true, desc: '세수 -35%, 인구 정체, 민심 -2' },
  harvest: { name: '풍년', icon: '🌾', att: 1, ap: 0, tax: 1.35, loyalty: 2, desc: '세수 +35%, 민심 +2' },
};

function hash(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// 계절·위도·지형에 따라 넓은 기후대 단위로 날씨를 굴린다
export function rollWeather(world, turn, seedNum) {
  const season = seasonOf(turn);
  const zone = world.unit * 9;
  return world.regions.map((r) => {
    const zx = Math.floor(r.cx / zone), zy = Math.floor(r.cy / zone);
    const x = hash(zx, zy, turn * 7919 + seedNum);
    const lat = Math.abs(r.lat);
    const cold = lat > 50 || r.terrain === T.TUNDRA || r.terrain === T.MOUNTAIN;
    const hot = lat < 32 || r.terrain === T.DESERT;
    const table = [];
    if (season === 3) table.push(['snow', cold ? 0.55 : lat > 35 ? 0.2 : 0.02], ['rain', hot ? 0.1 : 0.12]);
    if (season === 0) table.push(['rain', 0.28], ['snow', cold ? 0.12 : 0]);
    if (season === 1) table.push(['drought', hot ? 0.3 : 0.12], ['storm', r.coastal ? 0.14 : 0.03], ['rain', 0.14]);
    if (season === 2) table.push(['harvest', r.terrain === T.PLAINS || r.terrain === T.FOREST ? 0.28 : 0.1], ['storm', r.coastal ? 0.1 : 0.02], ['rain', 0.12]);
    let acc = 0;
    for (const [k, p] of table) {
      acc += p;
      if (x < acc) return k;
    }
    return 'clear';
  });
}

export const weatherOf = (s, rid) => WEATHER[s.weather?.[rid] || 'clear'];
