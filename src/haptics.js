// 진동 알림 (안드로이드만 — 아이폰 사파리는 웹 진동을 막아 둠)
import { pref } from './prefs.js';

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const buzz = (pattern) => {
  if (!pref('vibe', true) || !canVibrate()) return;
  try { navigator.vibrate(pattern); } catch { /* 진동 못 해도 그만 */ }
};
// 쓰는 곳: 성을 얻음(짧게 두 번) · 잃음(길게 두 번) · 적이 내 성을 노림(한 번)
export const BUZZ = { gain: [60, 50, 60], lose: [220, 90, 220], threat: [120] };
