// 배경음악·효과음: 파일 없이 브라우저에서 직접 만들어 냄 (WebAudio)
// 배경음: 오음 음계(궁상각치우)로 뜯는 현악기(가야금·고쟁 느낌) + 낮은 지속음 + 가끔 북
// 효과음: 누르기·부딪힘·함락·일기토·건설·순 넘김
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
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
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
export function setMood(m) { mood = m; }

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

// ── 배경음: 4마디씩 오음 음계로 흘러가는 선율 (마디마다 조금씩 다르게) ──
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // 궁상각치우
const ROOT = 196; // G3
const hz = (n) => ROOT * Math.pow(2, n / 12);
let step = 0, nextT = 0, phrase = [];
function newPhrase() {
  // 앞 음에서 가까운 음으로 걷는 선율, 마지막은 으뜸음으로
  const out = [];
  let i = 3;
  for (let k = 0; k < 16; k++) {
    i = Math.max(0, Math.min(SCALE.length - 1, i + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
    out.push(Math.random() < 0.28 ? null : SCALE[i]);
  }
  out[15] = 0;
  return out;
}
function tick() {
  if (!ctx) return;
  const beat = mood === 'battle' ? 0.24 : 0.36;
  while (nextT < ctx.currentTime + 0.4) {
    const k = step % 16;
    if (k === 0) { phrase = newPhrase(); drone(hz(-12), nextT, beat * 16, mood === 'battle' ? 0.1 : 0.07); drone(hz(-5), nextT, beat * 16, 0.04); }
    const n = phrase[k];
    if (n !== null && n !== undefined) pluck(hz(n), nextT, mood === 'battle' ? 0.6 : 1.4, 0.32);
    if (k % 4 === 0 && Math.random() < 0.5) pluck(hz(n ?? 0) / 2, nextT, 1.8, 0.18);
    if (mood === 'battle' ? k % 2 === 0 : k === 0 || k === 8) drum(nextT, mood === 'battle' ? 0.35 : 0.22);
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
let last = {};
export function sfx(kind) {
  if (!ctx || !opt.sfx) return;
  const now = ctx.currentTime;
  if (last[kind] && now - last[kind] < 0.12) return; // 한꺼번에 몰리면 하나만
  last[kind] = now;
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
  } else if (kind === 'bad') { pluck(hz(-2), t, 0.5, 0.35, sfxGain); pluck(hz(-7), t + 0.18, 0.8, 0.35, sfxGain); }
}
