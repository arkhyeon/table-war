// 이 기기에만 저장하는 설정 (판과 상관없이): 날씨·깃발 움직임 등
const KEY = 'tw-prefs';
let p = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
export const pref = (k, d) => (p[k] === undefined ? d : p[k]);
export const setPref = (k, v) => { p = { ...p, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 저장 못 해도 이번 실행엔 적용 */ } };
