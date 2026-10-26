// 이(가)·을(를)·과(와)·은(는)·(으)로 를 앞 글자 받침에 맞게 치환
function lastHangul(text, end) {
  let i = end - 1;
  let depth = 0;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') { depth++; continue; }
    if (ch === '(') { depth--; continue; }
    if (depth > 0) continue;
    if (/\s/.test(ch)) return null;
    return ch;
  }
  return null;
}

function batchim(ch) {
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch) ? 1 : 0;
  return null;
}

const RULES = [
  ['이(가)', '이', '가'],
  ['을(를)', '을', '를'],
  ['과(와)', '과', '와'],
  ['은(는)', '은', '는'],
];

export function fixJosa(text) {
  if (!text) return text;
  let out = text;
  for (const [tok, a, b] of RULES) {
    let idx;
    while ((idx = out.indexOf(tok)) !== -1) {
      const f = batchim(lastHangul(out, idx));
      const rep = f === null ? tok : f ? a : b;
      out = out.slice(0, idx) + rep + out.slice(idx + tok.length);
      if (rep === tok) break;
    }
  }
  let idx;
  while ((idx = out.indexOf('(으)로')) !== -1) {
    const f = batchim(lastHangul(out, idx));
    const rep = f === null ? '(으)로' : f && f !== 8 ? '으로' : '로';
    out = out.slice(0, idx) + rep + out.slice(idx + 4);
    if (rep === '(으)로') break;
  }
  return out;
}
