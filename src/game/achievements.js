

// 업적: 승리했을 때 조건을 검사해 브라우저에 기록
export const ACHIEVEMENTS = [
  { id: 'first', icon: '🏆', name: '천하통일', desc: '처음으로 승리' },
  { id: 'fast', icon: '⚡', name: '질풍노도', desc: '60턴 안에 승리' },
  { id: 'island', icon: '🏝️', name: '바다 건너 천하', desc: '섬에서 시작해 승리' },
  { id: 'underdog', icon: '🐜', name: '약자의 반란', desc: '시작 국력 하위 3위 안의 나라로 승리' },
  { id: 'phoenix', icon: '🔥', name: '불사조', desc: '10턴 이후 영토가 3곳 이하로 몰렸다가 승리' },
  { id: 'hard', icon: '💀', name: '난세의 영웅', desc: '어려움 난이도에서 승리' },
  { id: 'duelist', icon: '⚔️', name: '만인지적', desc: '한 게임에서 일기토 10승' },
  { id: 'emperor', icon: '👑', name: '황제', desc: '속국 3개 이상을 거느린 채 승리' },
  { id: 'veteran', icon: '🎖️', name: '백전노장', desc: '한 게임에서 전투 100승' },
  { id: 'nofog', icon: '🌫️', name: '안개 속 승리', desc: '지도 전체 공개를 끄고 승리' },
];

const KEY = 'tablewar-achieve';

export function loadAchievements() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function save(a) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* 저장 불가 환경 */
  }
}

