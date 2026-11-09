import { useEffect, useState } from 'react';

// 폰(터치)에서 설명 보기: PC는 마우스를 올리면 설명(title)이 뜨지만 폰은 안 뜸
//  · 누르는 기능이 없는 것(정보 칸 등)은 그냥 눌러도 설명이 뜸
//  · 버튼은 꾹 누르면(0.45초) 설명만 뜨고 버튼은 눌리지 않음
const HOLD = 450;
const interactive = (el) => el.matches('button, a, input, select, textarea, label, summary, [role="button"], [tabindex]') || getComputedStyle(el).cursor === 'pointer';

export default function TouchTips() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer = 0, start = null, suppress = 0;
    const show = (el) => {
      const text = el.getAttribute('title') || el.dataset.tip;
      if (!text) return;
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    const down = (e) => {
      if (e.pointerType !== 'touch') return;
      setTip(null);
      clearTimeout(timer);
      const el = e.target.closest?.('[title]');
      if (!el || el.tagName === 'CANVAS' || el.closest('canvas')) return;
      start = { x: e.clientX, y: e.clientY, el };
      if (!interactive(el)) return; // 누르는 기능이 없는 것은 손을 뗄 때 보여 줌
      timer = setTimeout(() => { if (start) { show(el); suppress = performance.now(); start = null; try { navigator.vibrate?.(15); } catch { /* */ } } }, HOLD);
    };
    const move = (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { clearTimeout(timer); start = null; } };
    const up = (e) => {
      clearTimeout(timer);
      if (start && e.pointerType === 'touch' && !interactive(start.el)) show(start.el);
      start = null;
    };
    // 꾹 눌러 설명을 본 버튼은 손을 떼도 눌리지 않게
    const click = (e) => { if (performance.now() - suppress < 700) { e.preventDefault(); e.stopPropagation(); suppress = 0; } };
    const menu = (e) => { if (performance.now() - suppress < 700) e.preventDefault(); };
    const hide = () => setTip(null);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', () => { clearTimeout(timer); start = null; }, true);
    window.addEventListener('click', click, true);
    window.addEventListener('contextmenu', menu, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('contextmenu', menu, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  useEffect(() => { if (!tip) return undefined; const t = setTimeout(() => setTip(null), 4500); return () => clearTimeout(t); }, [tip]);
  if (!tip) return null;
  // 화면 위쪽 절반이면 아래에, 아래쪽이면 위에 띄움
  const below = tip.bottom < window.innerHeight / 2;
  const left = Math.max(12, Math.min(window.innerWidth - 12, tip.x));
  return (
    <div className="touch-tip" role="tooltip" style={{ left, ...(below ? { top: tip.bottom + 8 } : { bottom: window.innerHeight - tip.top + 8 }) }} onPointerDown={() => setTip(null)}>
      {tip.text}
    </div>
  );
}
