// 역사 속 도적단·해적단·변방 이민족: 문명(civ)과 시대(연도)에 맞는 이름
// [이름, 문명 목록(null이면 어디나), 시작 연도, 끝 연도]
const ANY = [-9999, 9999];

export const BANDITS = [
  ['황건적 잔당', ['tk', 'china'], 184, 215],
  ['흑산적', ['tk', 'china'], 185, 215],
  ['백파적', ['tk', 'china'], 188, 205],
  ['금범적', ['tk', 'china'], 190, 210],
  ['산월', ['tk', 'china'], 150, 280],
  ['황소의 잔당', ['china'], 875, 920],
  ['양산박 무리', ['china'], 1100, 1130],
  ['홍건적', ['china', 'korea', 'steppe'], 1351, 1370],
  ['백련교도', ['china'], 1350, 1810],
  ['천지회', ['china', 'southeast_asian'], 1760, 1900],
  ['녹림적', ['china', 'tk'], ...ANY],
  ['명화적', ['korea'], 1500, 1900],
  ['초적', ['korea'], ...ANY],
  ['잇코잇키', ['japan'], 1480, 1590],
  ['산적단', ['japan'], ...ANY],
  ['마적단', ['steppe', 'tibet'], ...ANY],
  ['아사신', ['persia', 'arab'], 1090, 1260],
  ['베두인 약탈자', ['arab', 'north_african'], ...ANY],
  ['젤랄리 반도', ['turk'], 1590, 1610],
  ['노예 반란군', ['rome', 'italian'], -140, -70],
  ['바가우다이', ['rome', 'frank'], 280, 450],
  ['용병 약탈단', ['frank', 'italian', 'german', 'iberian'], 1340, 1450],
  ['로빈 후드 무리', ['english'], 1190, 1400],
  ['하이두크', ['magyar', 'slavic', 'byzantine', 'turk'], 1500, 1850],
  ['코사크 도적', ['slavic'], 1500, 1800],
  ['브리간티', ['italian', 'iberian', 'frank'], 1500, 1870],
  ['툭기', ['india'], 1300, 1850],
  ['핀다리', ['india'], 1780, 1820],
  ['다코이트', ['india'], 1000, 1900],
  ['투아레그 약탈자', ['west_african', 'north_african'], ...ANY],
  ['오로모 전사단', ['east_african'], 1500, 1800],
  ['치치멕 전사단', ['americas'], ...ANY],
  ['산적단', null, ...ANY],
];

// 그 문명·시대에 맞는 이름 고르기 (딱 맞는 것을 먼저, 없으면 문명만 맞는 것, 그래도 없으면 어디나 쓰는 이름)
export function outlawName(list, civ, year, rng) {
  const fits = (x) => year >= x[2] - 15 && year <= x[3] + 15;
  const exact = list.filter((x) => x[1] && x[1].includes(civ) && fits(x) && x[2] > -9999);
  if (exact.length) return rng.pick(exact)[0];
  const civOnly = list.filter((x) => x[1] && x[1].includes(civ) && fits(x));
  if (civOnly.length) return rng.pick(civOnly)[0];
  return list.find((x) => !x[1])[0];
}
