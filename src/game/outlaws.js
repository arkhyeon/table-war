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

export const PIRATES = [
  ['왜구', ['japan', 'korea', 'china'], 1220, 1600],
  ['바이킹', ['nordic', 'english', 'frank', 'german', 'slavic'], 790, 1070],
  ['사라센 해적', ['italian', 'arab', 'iberian', 'byzantine'], 820, 1100],
  ['바르바리 해적', ['north_african', 'iberian', 'italian', 'frank'], 1500, 1830],
  ['카리브 해적', ['americas', 'iberian', 'english'], 1550, 1830],
  ['코르세어', ['frank'], 1600, 1800],
  ['킬리키아 해적', ['rome', 'byzantine', 'italian', 'arab', 'turk'], -200, -60],
  ['일리리아 해적', ['rome', 'italian', 'byzantine'], -240, -160],
  ['말레이 해적', ['southeast_asian'], 1300, 1900],
  ['카와심 해적', ['arab', 'persia', 'india'], 1760, 1830],
  ['수적', ['tk', 'china'], ...ANY],
  ['해적단', null, ...ANY],
];

export const FRONTIER = [
  ['흉노', ['china', 'tk', 'steppe'], -300, 216],
  ['오환', ['tk', 'china', 'korea'], 100, 210],
  ['선비', ['tk', 'china', 'steppe'], 150, 400],
  ['강족', ['tk', 'china', 'tibet'], 100, 400],
  ['남만', ['tk', 'southeast_asian'], 180, 260],
  ['돌궐', ['china', 'steppe', 'persia'], 550, 750],
  ['위구르', ['china', 'steppe'], 744, 850],
  ['거란', ['china', 'korea', 'steppe'], 900, 1125],
  ['여진', ['korea', 'china'], 1000, 1650],
  ['몽골', ['china', 'korea', 'steppe', 'persia', 'slavic', 'arab', 'turk'], 1200, 1400],
  ['오이라트', ['china', 'steppe'], 1400, 1650],
  ['카자흐 기병', ['steppe', 'slavic', 'china'], 1500, 1850],
  ['스키타이', ['persia', 'byzantine', 'rome', 'slavic'], -700, -100],
  ['사르마트', ['rome', 'slavic'], -300, 400],
  ['게르만 약탈대', ['rome'], -150, 400],
  ['훈족', ['rome', 'german', 'byzantine', 'slavic', 'magyar'], 370, 470],
  ['마자르', ['german', 'frank', 'italian'], 890, 960],
  ['페체네그', ['byzantine', 'slavic'], 850, 1100],
  ['쿠만', ['slavic', 'byzantine', 'magyar'], 1050, 1240],
  ['타타르', ['slavic', 'magyar', 'turk'], 1240, 1700],
  ['투르크멘', ['persia', 'arab', 'turk'], 1000, 1880],
  ['아프간 부족', ['india', 'persia'], 1000, 1900],
  ['베두인', ['arab', 'persia', 'north_african'], ...ANY],
  ['투아레그', ['west_african', 'north_african'], ...ANY],
  ['오로모', ['east_african'], 1500, 1880],
  ['코만치', ['americas'], 1700, 1870],
  ['치치멕', ['americas'], ...ANY],
  ['준가르', ['china', 'steppe'], 1630, 1760],
  ['체첸 산악민', ['slavic', 'persia', 'turk'], 1780, 1860],
  ['아파치', ['americas'], 1600, 1886],
  ['마사이 전사단', ['east_african'], 1700, 1900],
  ['풀라니 기병', ['west_african'], 1700, 1900],
  ['이민족 약탈대', null, ...ANY],
];

// 변방 이민족의 역사 속 수령
export const RAID_LEADERS = {
  흉노: ['어부라', '호주천', '거비', '유표'], 오환: ['답돈', '누반', '구력거', '난루'], 선비: ['가비능', '보도근', '단석괴', '소리', '부라한'],
  강족: ['미당', '북궁백옥', '아하소과', '봉상'], 남만: ['맹획', '맹우', '축융', '올돌골', '타사대왕', '목록대왕', '대래동주'],
  돌궐: ['힐리 가한', '돌리 가한', '묵철'], 거란: ['야율아보기', '야율덕광'], 여진: ['아골타', '오아속', '누르하치'],
  몽골: ['테무진', '무칼리', '수부타이', '제베'], 오이라트: ['에센', '토곤'], 훈족: ['아틸라', '블레다', '루길라'], 마자르: ['아르파드', '불추'],
  타타르: ['노가이', '토크타미시', '마마이'], 스키타이: ['아테아스', '스킬루로스'], 왜구: ['아지발도'], 바이킹: ['라그나르', '비요른', '할프단', '롤로'],
  '카리브 해적': ['검은 수염', '헨리 모건', '바르톨로뮤 로버츠'], '바르바리 해적': ['하이레딘', '오루치', '투르구트'],
};

// 그 문명·시대에 맞는 이름 고르기 (딱 맞는 것을 먼저, 없으면 문명만 맞는 것, 그래도 없으면 어디나 쓰는 이름)
export function outlawName(list, civ, year, rng) {
  const fits = (x) => year >= x[2] - 15 && year <= x[3] + 15;
  const exact = list.filter((x) => x[1] && x[1].includes(civ) && fits(x) && x[2] > -9999);
  if (exact.length) return rng.pick(exact)[0];
  const civOnly = list.filter((x) => x[1] && x[1].includes(civ) && fits(x));
  if (civOnly.length) return rng.pick(civOnly)[0];
  return list.find((x) => !x[1])[0];
}
