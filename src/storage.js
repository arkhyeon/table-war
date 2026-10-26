const SAVE = 'tablewar-save';
const HIST = 'tablewar-history';

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE, JSON.stringify(data));
  } catch {
    /* 저장 실패는 무시 */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE);
  } catch {
    /* 무시 */
  }
}

// 장수 출현 기록: 판을 넘어 누적되어 자주 나온 장수의 재출현 확률을 낮춤
export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HIST) || '{}');
  } catch {
    return {};
  }
}

export function writeHistory(h) {
  try {
    localStorage.setItem(HIST, JSON.stringify(h));
  } catch {
    /* 무시 */
  }
}
