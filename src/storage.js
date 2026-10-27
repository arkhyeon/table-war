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
    localStorage.setItem(SAVE, JSON.stringify({ ...data, savedAt: Date.now() }));
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

// 수동 저장 슬롯 (자동 저장과 별개)
export const SLOT_COUNT = 3;
const slotKey = (k) => `tablewar-slot-${k}`;
export function loadSlot(k) {
  try {
    const raw = localStorage.getItem(k === 0 ? SAVE : slotKey(k));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function writeSlot(k, data) {
  try {
    localStorage.setItem(slotKey(k), JSON.stringify({ ...data, savedAt: Date.now() }));
    return true;
  } catch {
    return false; // 용량 부족 등
  }
}
export function deleteSlot(k) {
  try {
    localStorage.removeItem(slotKey(k));
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
