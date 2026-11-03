// 배경음악·효과음: 파일 없이 브라우저에서 직접 만들어 냄 (WebAudio)
// 배경음: 오음 음계(궁상각치우)로 뜯는 현악기(가야금·고쟁 느낌) + 낮은 지속음 + 가끔 북
// 효과음: 누르기·부딪힘·함락(얻음·잃음)·일기토·건설·순 넘김 — 1초 3개 제한, 압축기, 배경음 잠깐 줄이기
const KEY = 'tablewar-audio';
let ctx = null, master = null, bgmGain = null, sfxGain = null, timer = null;
let opt = (() => { try { return { bgm: true, sfx: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { bgm: true, sfx: true }; } })();
let mood = 'calm';

export const audioOpt = () => ({ ...opt });
function save() { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch { /* 무시 */ } }

// 브라우저는 사용자가 한 번 눌러야 소리를 낼 수 있음
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  // 큰 소리가 겹쳐도 귀가 아프지 않게 전체 출력에 압축기
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.005; comp.release.value = 0.25;
  comp.connect(ctx.destination);
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(comp);
  bgmGain = ctx.createGain(); bgmGain.gain.value = opt.bgm ? 0.22 : 0; bgmGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = opt.sfx ? 0.5 : 0; sfxGain.connect(master);
  startBgm();
}
export function setAudio(k, on) {
  opt = { ...opt, [k]: on };
  save();
  if (!ctx) return;
  const g = k === 'bgm' ? bgmGain : sfxGain;
  g.gain.setTargetAtTime(on ? (k === 'bgm' ? 0.22 : 0.5) : 0, ctx.currentTime, 0.1);
}
let want = 'calm', wantDays = 0;
// 하루마다 부름: 같은 분위기가 이틀 이어져야 바꿈 (왔다 갔다 하지 않게). 실제 전환은 다음 마디 첫 박에
export function setMood(m) { if (m === want) wantDays += 1; else { want = m; wantDays = 1; } }

// ── 악기 ──
function pluck(freq, t, dur = 1.2, vol = 0.5, out = bgmGain) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = freq;
  o2.type = 'sine'; o2.frequency.value = freq * 2.01;
  f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 8, t); f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(out);
  o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}
function drone(freq, t, dur, vol = 0.12) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(bgmGain);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, vol, freq, out, type = 'bandpass') {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t);
}
function drum(t, vol = 0.5, out = bgmGain) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
}

// ── 배경음: 대금 선율 + 가야금 반주 + 장구 장단 (전통 음악 분위기, 곡은 그때그때 새로 지음 — 기존 곡을 옮기지 않음) ──
// 선율은 한 동기(4마디)를 만들어 A·A·A′·B로 되풀이하며 변형 → 흘러가기만 하지 않고 노래처럼 들리게
const SCALES = {
  calm: [0, 2, 4, 7, 9, 12, 14, 16, 19], // 평조: 밝은 오음계
  tension: [0, 3, 5, 7, 10, 12, 15, 17, 19], // 계면조 느낌: 어두운 오음계
  battle: [0, 3, 5, 7, 10, 12, 15, 17, 19],
};
let SCALE = SCALES.calm;
const ROOT = 196; // G3
const hz = (n) => ROOT * Math.pow(2, n / 12);
// 장단 (12칸 한 장단): 덩=양손, 쿵=북편, 덕=채편, 기=채편 작게
const JANGDAN = {
  calm: ['덩', '', '', '덕', '', '쿵', '', '덕', '기', '쿵', '', ''], // 굿거리처럼 느긋하게
  tension: ['덩', '', '', '', '', '', '쿵', '', '', '덕', '', ''], // 무겁고 느리게
  battle: ['덩', '', '덕', '쿵', '', '덕', '덩', '', '덕', '쿵', '덕', '덕'], // 자진모리처럼 몰아치게
};
const BEAT = { calm: 0.25, tension: 0.3, battle: 0.15 }; // 12칸 한 칸 길이(초)
let step = 0, nextT = 0, song = null, sect = -1;

// 대금: 숨소리 섞인 부드러운 소리, 길게 끌면 떨림
function daegeum(freq, t, dur, vol = 0.22) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sine'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2; const g2 = ctx.createGain(); g2.gain.value = 0.12;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.6 ? freq * 0.012 : 0, t + Math.min(dur, 0.5));
  lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
  f.type = 'lowpass'; f.frequency.value = freq * 5;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.setValueAtTime(vol * 0.85, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(bgmGain);
  [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.05); });
  noise(t, Math.min(0.25, dur), vol * 0.25, freq * 3, bgmGain); // 숨소리
}
// 장구: 쿵(낮은 북편), 덕(채편 따닥), 덩(둘 다)
function janggu(kind, t, vol) {
  if (!kind) return;
  if (kind === '쿵' || kind === '덩') drum(t, vol, bgmGain);
  if (kind === '덕' || kind === '덩') noise(t, 0.05, vol * 0.9, 3200, bgmGain);
  if (kind === '기') noise(t, 0.03, vol * 0.5, 4200, bgmGain);
}

// 동기 하나(4마디×12칸): 음과 길이. 디딤음(으뜸·5도)에 오래 머물고 이웃 음으로 움직임
function motif() {
  const out = [];
  let i = 4;
  for (let b = 0; b < 4; b++) {
    let k = 0;
    while (k < 12) {
      const len = [3, 3, 6, 2, 1, 3][Math.floor(Math.random() * 6)];
      const l = Math.min(len, 12 - k);
      i = Math.max(0, Math.min(SCALE.length - 1, i + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
      out.push({ at: b * 12 + k, len: l, n: Math.random() < 0.15 && k > 0 ? null : SCALE[i] });
      k += l;
    }
  }
  // 마지막 마디는 으뜸음으로 길게 맺음
  const last = out.filter((x) => x.at >= 36);
  if (last.length) { last[last.length - 1].n = SCALE[0] + 12; }
  return out;
}
// 곡: A·A·A′(끝만 다르게)·B(높은 데서) — 16마디마다 새 곡
function newSong() {
  const A = motif(), B = motif().map((x) => ({ ...x, n: x.n === null ? null : Math.min(x.n + 5, SCALE[SCALE.length - 1]) }));
  const A2 = A.map((x) => ({ ...x }));
  for (const x of A2) if (x.at >= 36 && x.n !== null) x.n = SCALE[3];
  return [A, A, A2, B];
}

function tick() {
  if (!ctx) return;
  while (nextT < ctx.currentTime + 0.4) {
    const k = step % 48; // 4마디(=동기 하나) 안의 칸
    if (step % 12 === 0) {
      // 마디 첫 박: 분위기 바꿈(이틀 넘게 이어진 분위기로) — 바뀌면 그 분위기의 새 곡
      if (want !== mood && wantDays >= 2) { mood = want; SCALE = SCALES[mood]; song = null; }
      // 낮은 지속음 (가야금 저음현 울림)
      drone(hz(-12), nextT, BEAT[mood] * 12, mood === 'calm' ? 0.05 : 0.08);
    }
    // 4마디마다 다음 동기 (A·A·A′·B), 한 바퀴 돌면 새 곡
    if (k === 0) { sect = (sect + 1) % 4; if (sect === 0 || !song) song = newSong(); }
    if (!song) song = newSong();
    const beat = BEAT[mood];
    const part = song[Math.max(0, sect)];
    // 대금 선율
    for (const x of part) if (x.at === k && x.n !== null) daegeum(hz(x.n + 12), nextT, x.len * beat * (mood === 'battle' ? 0.9 : 1.05), mood === 'battle' ? 0.16 : 0.2);
    // 가야금 반주: 박마다 으뜸·5도·8도를 뜯음 (전투는 촘촘하게)
    if (k % (mood === 'battle' ? 3 : 6) === 0) { const root = (part.find((x) => x.at <= k && x.at + x.len > k)?.n ?? 0) % 12; pluck(hz(root - 12), nextT, 1.2, 0.16); if (Math.random() < 0.6) pluck(hz(root - 5), nextT + beat, 0.9, 0.11); }
    // 장구 장단
    janggu(JANGDAN[mood][step % 12], nextT, mood === 'calm' ? 0.18 : mood === 'tension' ? 0.24 : 0.28);
    nextT += beat;
    step++;
  }
}
function startBgm() {
  nextT = ctx.currentTime + 0.1;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 120);
}

// ── 효과음 ──
let last = {}, recent = [];
const IMPORTANT = new Set(['capture', 'lose', 'duel', 'gong', 'duelHit', 'duelWin', 'duelLose', 'cutin']); // 중요한 소리는 개수 제한을 넘어도 냄
// 일기토·컷인 장면 동안에는 다른 전투음을 내지 않음 (장면 소리만 또렷하게)
let holdUntil = 0;
export function holdSfx(sec) { if (ctx) holdUntil = Math.max(holdUntil, ctx.currentTime + sec); }
export function sfx(kind) {
  if (!ctx || !opt.sfx) return;
  const now = ctx.currentTime;
  if (now < holdUntil && !IMPORTANT.has(kind)) return;
  if (last[kind] && now - last[kind] < 0.35) return; // 같은 소리는 0.35초 안에 다시 안 냄
  recent = recent.filter((x) => now - x < 1);
  if (recent.length >= 3 && !IMPORTANT.has(kind)) return; // 1초에 최대 3개 (여기저기 싸워도 귀 아프지 않게)
  last[kind] = now;
  recent.push(now);
  if (kind === 'cutin') holdUntil = Math.max(holdUntil, now + 1.5); // 컷인·일기토 동안 다른 전투음 멈춤
  if (kind === 'duel') holdUntil = Math.max(holdUntil, now + 3.5);
  // 효과음이 날 때 배경음을 잠깐 줄였다가 되돌림
  if (opt.bgm && bgmGain) { bgmGain.gain.cancelScheduledValues(now); bgmGain.gain.setTargetAtTime(0.13, now, 0.03); bgmGain.gain.setTargetAtTime(0.22, now + 0.35, 0.3); }
  const t = now + 0.01;
  if (kind === 'click') pluck(880, t, 0.12, 0.25, sfxGain);
  else if (kind === 'clash') { noise(t, 0.18, 0.5, 2500, sfxGain); noise(t + 0.06, 0.12, 0.3, 4000, sfxGain); }
  else if (kind === 'hit') noise(t, 0.12, 0.35, 900, sfxGain, 'lowpass');
  else if (kind === 'capture') { // 뿔나팔
    for (const [f, d] of [[hz(7), 0], [hz(12), 0.22]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(0.35, t + d + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + d + 0.5);
      o.connect(fl); fl.connect(g); g.connect(sfxGain); o.start(t + d); o.stop(t + d + 0.55);
    }
  } else if (kind === 'duel') { for (let i = 0; i < 3; i++) { pluck(1320 + i * 90, t + i * 0.13, 0.4, 0.3, sfxGain); noise(t + i * 0.13, 0.08, 0.3, 5000, sfxGain); } }
  else if (kind === 'build') { drum(t, 0.4, sfxGain); drum(t + 0.15, 0.3, sfxGain); }
  else if (kind === 'gong') { // 순 넘김: 징
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 98;
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 2.3);
    noise(t, 0.6, 0.12, 700, sfxGain);
  } else if (kind === 'duelHit') { // 칼 부딪힘: 높은 쇳소리 두 겹 + 짧은 잡음
    pluck(1760 + Math.random() * 200, t, 0.35, 0.28, sfxGain); pluck(2490 + Math.random() * 200, t + 0.01, 0.25, 0.18, sfxGain); noise(t, 0.06, 0.35, 6000, sfxGain, 'highpass');
  } else if (kind === 'duelWin') { // 일기토 승리: 북 둘 + 올라가는 세 음
    drum(t, 0.4, sfxGain); drum(t + 0.18, 0.4, sfxGain);
    [0, 4, 7].forEach((n, i) => pluck(hz(n + 12), t + 0.3 + i * 0.12, 0.9, 0.3, sfxGain));
  } else if (kind === 'duelLose') { // 일기토 패배: 내려가는 두 음
    pluck(hz(5), t, 0.8, 0.3, sfxGain); pluck(hz(-2), t + 0.25, 1.2, 0.3, sfxGain);
  } else if (kind === 'cutin') { // 고유 전법 컷인: 바람 가르는 소리 + 큰 북 + 높은 화음
    const len = Math.floor(ctx.sampleRate * 0.5), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
    const g = ctx.createGain(); g.gain.value = 0.45; src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t);
    drum(t + 0.42, 0.55, sfxGain);
    [0, 7, 12].forEach((n) => pluck(hz(n + 12), t + 0.45, 1.1, 0.22, sfxGain));
  } else if (kind === 'lose') { // 내 성을 잃음: 낮은 북 + 내려가는 두 음
    drum(t, 0.45, sfxGain); pluck(hz(-5), t + 0.05, 1.0, 0.35, sfxGain); pluck(hz(-12), t + 0.35, 1.4, 0.35, sfxGain);
  } else if (kind === 'bad') { pluck(hz(-2), t, 0.5, 0.35, sfxGain); pluck(hz(-7), t + 0.18, 0.8, 0.35, sfxGain); }
}
