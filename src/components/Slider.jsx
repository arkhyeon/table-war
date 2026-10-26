// 범위 슬라이더: 최대값이 step의 배수가 아니어도 손잡이가 끝까지 가고, 끝에 두면 정확히 최대값이 됨
export default function Slider({ min = 0, max, step = 1, value, onChange, style }) {
  const top = max <= min ? min : min + Math.ceil((max - min) / step) * step;
  const shown = value >= max ? top : value;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={top}
      step={step}
      value={shown}
      disabled={max <= min}
      onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value)))}
      style={style}
    />
  );
}
