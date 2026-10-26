// 병력 표기: 지도용 짧은 표기와 문장용 표기
export function fmtTroops(n) {
  n = Math.round(n);
  if (n >= 100000) return `${Math.round(n / 10000)}만`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}천`;
  return String(n);
}

export const fmtNum = (n) => Math.round(n).toLocaleString('ko-KR');
