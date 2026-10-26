import { nationRegions, isVassalOf, landCount } from './engine.js';

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

// 매 턴 기록 갱신 (최소 영토)
export function trackStats(s) {
  const st = (s.stats = s.stats || {});
  const n = nationRegions(s, s.playerId).length;
  // 시작 직후의 작은 영토는 '몰렸다'로 치지 않음
  if (s.turn >= 10) st.minRegions = Math.min(st.minRegions ?? n, n);
  st.maxShare = Math.max(st.maxShare || 0, n / landCount(s));
}

// 진행 중에 얻는 업적(일기토·전투)과 승리 업적. 새로 얻은 목록을 반환
export function checkAchievements(s, win) {
  if (s.spectator) return [];
  const st = s.stats || {};
  const got = [];
  if ((st.duels || 0) >= 10) got.push('duelist');
  if ((st.won || 0) >= 100) got.push('veteran');
  if (win) {
    got.push('first');
    if (s.turn <= 60) got.push('fast');
    if (st.startIsland) got.push('island');
    if (st.startRank !== undefined && st.startRank >= st.startCount - 3) got.push('underdog');
    if ((st.minRegions ?? 99) <= 3) got.push('phoenix');
    if (s.opts?.difficulty === 'hard') got.push('hard');
    if (s.nations.filter((o) => o.alive && isVassalOf(s, o.id, s.playerId)).length >= 3) got.push('emperor');
    if (s.opts?.revealMap === false) got.push('nofog');
  }
  const all = loadAchievements();
  const fresh = got.filter((id) => !all[id]);
  for (const id of fresh) all[id] = { turn: s.turn, nation: s.nations[s.playerId].name, at: Date.now() };
  if (fresh.length) save(all);
  return fresh;
}
