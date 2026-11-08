import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 가이드 투어: 화면의 실제 버튼·칸을 밝게 비추고(나머지는 어둡게) 말풍선으로 설명함
// steps: [{ title, body, target?: 'CSS 선택자' | () => DOMRect, before?: () => void, wait?: () => boolean, doIt?: '직접 할 일' }]
//  - wait가 있으면 체험 단계: 사람이 실제로 해 보면(wait()가 참이 되면) 저절로 다음으로 넘어감
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
  const st = steps[Math.min(i, steps.length - 1)];
  const stepsRef = useRef(steps);
  stepsRef.current = steps; // 체험 단계의 조건은 늘 지금 게임 상태로 확인
  const [done, setDone] = useState(false);

  // 단계에 들어갈 때 화면 준비 → 잠깐 뒤 대상 위치를 잼 (패널이 열리고 그려진 뒤)
  useEffect(() => {
    st.before?.();
    setDone(false);
    let n = 0, id, passed = false;
    const measure = () => {
      const cur = stepsRef.current[i];
      let r = null;
      if (typeof cur.target === 'function') r = cur.target(n);
      else if (cur.target) { const el = document.querySelector(cur.target); if (el) { if (n < 6) el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); r = el.getBoundingClientRect(); } }
      setRect(r && r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
      // 체험 단계: 해냈으면 잠깐 「잘했어요」를 보여 주고 다음으로
      if (cur.wait && !passed && cur.wait()) { passed = true; setDone(true); id = setTimeout(() => setI((x) => (x === i ? x + 1 : x)), 900); return; }
      if (++n < 6) id = setTimeout(measure, 120); // 부드럽게 스크롤·펼쳐지는 동안 몇 번 더 잼
      else if (cur.wait) id = setTimeout(measure, 250); // 체험 단계는 해낼 때까지 계속 지켜봄
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
  useEffect(() => { if (i >= steps.length) finish(); }); // eslint-disable-line react-hooks/exhaustive-deps
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
        {st.doIt && <div className={'tour-do' + (done ? ' ok' : '')}>{done ? '✅ 잘했어요!' : `👉 직접 해 보세요: ${st.doIt}`}</div>}
        <div className="tour-dots" aria-hidden>{steps.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />)}</div>
        <div className="tour-btns">
          <button className="sm" onClick={finish}>건너뛰기</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="sm" onClick={prev}>← 이전</button>}
          {st.wait ? <button className="sm" onClick={next}>이 단계 넘기기 →</button> : <button className="primary sm" onClick={next} autoFocus>{i < steps.length - 1 ? '다음 →' : '시작하기 🎉'}</button>}
        </div>
      </div>
    </div>
  );
}
