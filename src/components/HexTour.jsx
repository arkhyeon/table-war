import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 가이드 투어: 화면의 실제 버튼·칸을 밝게 비추고(나머지는 어둡게) 말풍선으로 설명함
// steps: [{ title, body, target?: 'CSS 선택자' | () => DOMRect, before?: () => void }]
//  - target이 없으면 화면 가운데 말풍선만
//  - before: 그 단계에 들어갈 때 화면을 준비 (성 고르기·탭 바꾸기 등)
export const TOUR_KEY = 'h14-tour-done';
export const tourSeen = () => { try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return true; } };

export default function HexTour({ steps, onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const bubble = useRef(null);
  const [bh, setBh] = useState(160);
  const st = steps[i];

  // 단계에 들어갈 때 화면 준비 → 잠깐 뒤 대상 위치를 잼 (패널이 열리고 그려진 뒤)
  useEffect(() => {
    st.before?.();
    let n = 0, id;
    const measure = () => {
      let r = null;
      if (typeof st.target === 'function') r = st.target();
      else if (st.target) { const el = document.querySelector(st.target); if (el) { el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); r = el.getBoundingClientRect(); } }
      setRect(r && r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
      if (++n < 6) id = setTimeout(measure, 120); // 부드럽게 스크롤·펼쳐지는 동안 몇 번 더 잼
    };
    id = setTimeout(measure, 60);
    return () => clearTimeout(id);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onR = () => { setVw(window.innerWidth); setI((x) => x); };
    window.addEventListener('resize', onR);
    const onKey = (e) => { if (e.key === 'Escape') finish(); else if (e.key === 'ArrowRight' || e.key === 'Enter') next(); else if (e.key === 'ArrowLeft') prev(); };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('resize', onR); window.removeEventListener('keydown', onKey, true); };
  });
  useLayoutEffect(() => { if (bubble.current) setBh(bubble.current.offsetHeight); }, [i, rect, vw]);

  const finish = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* 무시 */ } onClose(); };
  const next = () => (i < steps.length - 1 ? setI(i + 1) : finish());
  const prev = () => i > 0 && setI(i - 1);

  // 말풍선 자리: 대상 아래가 넉넉하면 아래, 아니면 위, 둘 다 좁으면 대상 옆/화면 가운데
  const vh = window.innerHeight, pad = 10, bw = Math.min(360, vw - 24);
  let bx = (vw - bw) / 2, by = (vh - bh) / 2;
  if (rect) {
    const below = vh - (rect.y + rect.h) - pad, above = rect.y - pad;
    bx = Math.max(12, Math.min(vw - bw - 12, rect.x + rect.w / 2 - bw / 2));
    if (below >= bh + 12) by = rect.y + rect.h + pad + 4;
    else if (above >= bh + 12) by = rect.y - bh - pad - 4;
    else if (rect.x > bw + 24) { bx = rect.x - bw - 12; by = Math.max(12, Math.min(vh - bh - 12, rect.y)); }
    else if (vw - rect.x - rect.w > bw + 24) { bx = rect.x + rect.w + 12; by = Math.max(12, Math.min(vh - bh - 12, rect.y)); }
    else by = Math.max(12, vh - bh - 12);
  }
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="게임 안내">
      {rect ? <div className="tour-hole" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} /> : <div className="tour-dim" />}
      <div ref={bubble} className="tour-bubble" style={{ left: bx, top: by, width: bw }}>
        <div className="tour-step">{i + 1} / {steps.length}</div>
        <h3>{st.title}</h3>
        <div className="tour-body">{st.body}</div>
        <div className="tour-dots" aria-hidden>{steps.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />)}</div>
        <div className="tour-btns">
          <button className="sm" onClick={finish}>건너뛰기</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="sm" onClick={prev}>← 이전</button>}
          <button className="primary sm" onClick={next} autoFocus>{i < steps.length - 1 ? '다음 →' : '시작하기 🎉'}</button>
        </div>
      </div>
    </div>
  );
}
