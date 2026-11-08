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

// ── 배경음: 영화 음악 느낌의 웅장한 합주 (곡은 그때그때 새로 지음 — 기존 곡을 옮기지 않음) ──
// 귀가 아프지 않게: 높은 쇳소리·찰칵거리는 고음 없이, 모든 악기를 저역 필터로 둥글게 + 잔향으로 공간감
// 평온: 따뜻한 현악 화음 + 하프 분산화음 + 부드러운 플루트 선율 / 긴장: 낮은 현 반복음 + 큰북 / 전투: 큰북 몰아치기 + 현 스타카토 + 금관 선율
const ROOT = 146.83; // D3
const hz = (n) => ROOT * Math.pow(2, n / 12);
const PROG = {
  calm: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], // 밝고 당당하게 (I-V-vi-IV)
  tension: [[0, 3, 7], [8, 12, 15], [10, 14, 17], [7, 10, 14]], // 어둡게 조여 오는 (i-VI-VII-v)
  battle: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], // 몰아치는 (i-VI-III-VII)
};
const SCALE_OF = { calm: [0, 2, 4, 5, 7, 9, 11], tension: [0, 2, 3, 5, 7, 8, 10], battle: [0, 2, 3, 5, 7, 8, 10] };
const STEP = { calm: 0.17, tension: 0.15, battle: 0.115 }; // 16분음표 길이(초)
// 큰북 (16칸 한 마디): 2=큰 소리, 1=작은 소리
const TAIKO = {
  calm: [2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  tension: [2, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 1, 1],
  battle: [2, 0, 1, 0, 2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 2, 1],
};
let step = 0, nextT = 0, song = null, bus = null;

function makeBus() {
  // 잔향: 짧게 사라지는 잡음으로 만든 공간 울림
  bus = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const verb = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.35;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 4500; // 전체 고음 깎기
  bus.connect(dry); dry.connect(tone); bus.connect(verb); verb.connect(wet); wet.connect(tone); tone.connect(bgmGain);
}
const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.linearRampToValueAtTime(0.0001, t + d); };
// 현악 화음: 살짝 어긋난 톱니파 둘을 저역 필터로 감싸 따뜻하게
function strings(freqs, t, dur, vol) {
  for (const f of freqs) for (const det of [-6, 6]) {
    const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    fl.type = 'lowpass'; fl.frequency.value = 900; fl.Q.value = 0.5;
    env(g, t, dur * 0.35, vol / freqs.length, dur);
    o.connect(fl); fl.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
}
function bass(f, t, dur, vol) {
  const o = ctx.createOscillator(), s = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = f; s.type = 'sine'; s.frequency.value = f / 2;
  fl.type = 'lowpass'; fl.frequency.value = 380;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(fl); s.connect(fl); fl.connect(g); g.connect(bus); o.start(t); s.start(t); o.stop(t + dur + 0.05); s.stop(t + dur + 0.05);
}
// 하프: 둥근 뜯는 소리
function harp(f, t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = f;
  fl.type = 'lowpass'; fl.frequency.setValueAtTime(Math.min(2400, f * 4), t); fl.frequency.exponentialRampToValueAtTime(f * 1.2, t + 1.2);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(fl); fl.connect(g); g.connect(bus); o.start(t); o.stop(t + 1.65);
}
// 선율: 평온·긴장은 부드러운 플루트, 전투는 금관(소리가 열리며 커지는 톱니파)
function lead(f, t, dur, vol, brass) {
  const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.4 ? f * 0.008 : 0, t + Math.min(dur, 0.4));
  lfo.connect(lg); lg.connect(o.frequency);
  if (brass) { o.type = 'sawtooth'; fl.type = 'lowpass'; fl.frequency.setValueAtTime(400, t); fl.frequency.linearRampToValueAtTime(1500, t + 0.12); fl.frequency.linearRampToValueAtTime(900, t + dur); }
  else { o.type = 'triangle'; fl.type = 'lowpass'; fl.frequency.value = 1800; }
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (brass ? 0.05 : 0.09)); g.gain.setValueAtTime(vol * 0.85, t + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(fl); fl.connect(g); g.connect(bus); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}
// 큰북: 낮게 쿵 울리는 소리 (높은 찰칵 소리 없음)
function taiko(t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(85, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.65);
  noise(t, 0.08, vol * 0.5, 260, bus, 'lowpass');
}
// 선율 한 소절(16칸): 화음 음을 디딤으로 음계를 따라 움직임
function phrase(m, chordIdx) {
  const sc = SCALE_OF[m], ch = PROG[m][chordIdx];
  const out = [];
  let k = 0;
  let deg = sc.indexOf(ch[0] % 12) >= 0 ? sc.indexOf(ch[0] % 12) : 0;
  while (k < 16) {
    const len = m === 'battle' ? [2, 2, 4, 1, 1, 2, 6][Math.floor(Math.random() * 7)] : [4, 2, 6, 2, 8, 3][Math.floor(Math.random() * 6)];
    const l = Math.min(len, 16 - k);
    deg = Math.max(-2, Math.min(9, deg + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
    const n = sc[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
    out.push({ at: k, len: l, n: k === 0 ? ch[Math.floor(Math.random() * 3)] : Math.random() < 0.12 ? null : n });
    k += l;
  }
  return out;
}
// 곡: 4마디 화성 진행 × 4 (A A B A) — 같은 선율이 되풀이되어 기억에 남게
function newSong(m) {
  const A = [0, 1, 2, 3].map((c) => phrase(m, c)), B = [0, 1, 2, 3].map((c) => phrase(m, c).map((x) => ({ ...x, n: x.n === null ? null : x.n + 5 })));
  return { m, parts: [A, A, B, A] };
}
function tick() {
  if (!ctx) return;
  if (!bus) makeBus();
  while (nextT < ctx.currentTime + 0.4) {
    const k = step % 16, bar = Math.floor(step / 16) % 16;
    if (k === 0 && want !== mood && wantDays >= 2) { mood = want; song = null; }
    if (!song || (k === 0 && bar === 0 && step > 0)) song = newSong(mood);
    const m = song.m, dt = STEP[m];
    const ci = bar % 4, ch = PROG[m][ci].map(hz);
    const part = song.parts[Math.floor(bar / 4)][ci];
    if (k === 0) {
      strings(ch, nextT, dt * 16 * 1.05, m === 'battle' ? 0.1 : 0.12);
      if (m === 'calm') bass(ch[0] / 2, nextT, dt * 14, 0.22);
    }
    // 저음: 긴장은 8분음표 반복, 전투는 16분음표 스타카토
    if (m === 'tension' && k % 2 === 0) bass(ch[0] / 2, nextT, dt * 1.6, 0.18);
    if (m === 'battle') bass(ch[0] / 2 * (k % 8 === 6 ? 2 : 1), nextT, dt * 0.9, k % 4 === 0 ? 0.24 : 0.15);
    // 하프 분산화음 (평온)
    if (m === 'calm' && k % 2 === 0) harp(ch[[0, 1, 2, 1, 0, 2, 1, 2][(k / 2) % 8]] * 2, nextT, 0.09);
    // 선율
    for (const x of part) if (x.at === k && x.n !== null) lead(hz(x.n + 12), nextT, x.len * dt * 0.95, m === 'battle' ? 0.08 : 0.1, m === 'battle');
    // 큰북
    const tk = TAIKO[m][k];
    if (tk) taiko(nextT, (tk === 2 ? 0.5 : 0.28) * (m === 'calm' ? 0.6 : 1));
    nextT += dt;
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
