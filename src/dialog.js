// 확인·알림 창: 아티팩트(샌드박스) 안에서는 브라우저 기본 confirm/alert/prompt가 막혀 그냥 '취소'로 끝나므로 직접 그림
export function uiConfirm(msg, { ok = '확인', cancel = '취소' } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.style.zIndex = '1000';
    const box = document.createElement('div');
    box.className = 'modal';
    box.style.maxWidth = '360px';
    const p = document.createElement('div');
    p.textContent = msg;
    p.style.marginBottom = '14px';
    p.style.whiteSpace = 'pre-line';
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = '8px'; row.style.justifyContent = 'flex-end';
    const done = (v) => { bg.remove(); resolve(v); };
    if (cancel) { const b = document.createElement('button'); b.textContent = cancel; b.onclick = () => done(false); row.appendChild(b); }
    const y = document.createElement('button'); y.className = 'primary'; y.textContent = ok; y.onclick = () => done(true); row.appendChild(y);
    bg.onclick = (e) => { if (e.target === bg) done(false); };
    box.append(p, row); bg.appendChild(box); document.body.appendChild(bg);
    y.focus();
  });
}
export const uiAlert = (msg) => uiConfirm(msg, { cancel: null });
