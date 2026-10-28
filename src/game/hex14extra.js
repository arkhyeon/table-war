// ───────── 삼국지14식 모드: 계절·날씨, 고유 전법, 일기토, 역사 사건·무작위 사건 ─────────
import { makeRng } from './rng.js';
import { fmtTroops, fmtGold } from './format.js';
import { log, gensOf, enemy, districtTiles } from './hex14.js';
import { makePact, powerOf } from './hex14gov.js';

// ── 계절·날씨: 턴(10일)마다 정함 ──
// 겨울(12~2월) 북쪽엔 눈 → 이동 느림, 장마(6~7월) 비 → 강 건너기 힘듦·불 약함, 바람 → 불 강함
export const WEATHER = { clear: ['☀️', '맑음'], rain: ['🌧️', '비'], snow: ['❄️', '눈'], wind: ['🌬️', '바람'] };
const WIND_NAME = ['동풍', '동남풍', '남서풍', '서풍', '서북풍', '북동풍'];
export const monthOf = (s) => Math.floor((s.turn - 1) / 3) % 12; // 0 = 1월
export function rollWeather(s) {
  const rng = makeRng(`wx:${s.seed}:${s.turn}`);
  const m = monthOf(s);
  const winter = m === 11 || m <= 1, rainy = m === 5 || m === 6;
  const r = rng();
  const kind = winter ? (r < 0.45 ? 'snow' : r < 0.55 ? 'wind' : 'clear') : rainy ? (r < 0.55 ? 'rain' : r < 0.65 ? 'wind' : 'clear') : r < 0.15 ? 'wind' : r < 0.27 ? 'rain' : 'clear';
  s.weather = { kind, wind: Math.floor(rng() * 6), winter };
}
export const weatherText = (s) => { const w = s.weather || { kind: 'clear' }; return `${WEATHER[w.kind][0]} ${WEATHER[w.kind][1]}${w.kind === 'wind' ? `(${WIND_NAME[w.wind]})` : ''}`; };
// 날씨에 따른 이동 비용: 눈 오는 겨울 북쪽(지도 위쪽 55%)은 1.6배, 비 오면 강 칸 +1·전체 +15%
export function weatherCost(s, grid, to, cost) {
  const w = s.weather;
  if (!w || grid.water?.[to]) return cost;
  if (w.kind === 'snow' && grid.center(to)[1] < grid.H * 0.55) return cost * 1.6;
  if (w.kind === 'rain') return cost * 1.15 + (grid.river[to] ? 1 : 0);
  return cost;
}
// 불(화계·화공) 배율
export const fireMult = (s) => ({ wind: 1.6, rain: 0.5, snow: 0.8 })[s.weather?.kind] || 1;

// ── 고유 전법: 이름난 장수만 쓰는 전법 ──
// kind: atk(큰 피해) · fire(불, 옆 적까지·날씨 영향) · shout(주변 적 사기↓·발 묶음) · guard(이틀 동안 받는 피해 절반) · scare(적 사기 크게↓)
export const UNIQUE = {
  관우: ['청룡언월', 'atk', 3.0, 15], 장비: ['장판교 일갈', 'shout', 1.6, 22], 조운: ['단기돌파', 'atk', 2.6, 12], 마초: ['금마돌격', 'atk', 2.7, 12],
  황충: ['백보천양', 'atk', 2.5, 8], 여포: ['무쌍', 'atk', 3.2, 18], 장료: ['위진합비', 'atk', 2.6, 18], 허저: ['나의투구', 'atk', 2.4, 10],
  전위: ['쌍철극', 'atk', 2.5, 10], 손책: ['소패왕', 'atk', 2.5, 12], 감녕: ['백기야습', 'atk', 2.3, 16], 태사자: ['신궁', 'atk', 2.3, 8],
  하후돈: ['발시담목', 'atk', 2.4, 14], 하후연: ['신속', 'atk', 2.2, 8], 위연: ['자오곡', 'atk', 2.3, 10], 서황: ['장구직입', 'atk', 2.3, 10],
  제갈량: ['팔진', 'guard', 1.6, 10], 사마의: ['신산', 'scare', 1.8, 25], 주유: ['적벽화공', 'fire', 2.6, 15], 육손: ['이릉화공', 'fire', 2.4, 15],
  방통: ['연환계', 'fire', 2.0, 12], 곽가: ['유책', 'scare', 1.6, 20], 순욱: ['왕좌지재', 'guard', 1.4, 8], 가후: ['이간', 'scare', 1.5, 22],
  조조: ['난세의 간웅', 'scare', 2.0, 20], 손권: ['강동의 주인', 'guard', 1.5, 8], 유비: ['인덕', 'guard', 1.4, 6], 원소: ['사세삼공', 'atk', 1.8, 8],
  여몽: ['백의도강', 'atk', 2.2, 12], 노숙: ['연합', 'guard', 1.3, 6], 등애: ['음평 기습', 'atk', 2.4, 15], 강유: ['일신시담', 'atk', 2.4, 12],
  // 세계 시나리오의 이름난 장수
  한니발: ['칸나에 포위', 'atk', 3.0, 25], 스키피오: ['자마의 계략', 'atk', 2.4, 15], 나폴레옹: ['아우스터리츠', 'atk', 2.8, 22], 넬슨: ['트라팔가르', 'atk', 2.6, 15],
  웰링턴: ['역사면 방어', 'guard', 1.6, 8], 쿠투조프: ['초토화', 'scare', 1.6, 22], 칭기즈칸: ['기마 포위', 'atk', 2.8, 20], 수부타이: ['우회 기동', 'atk', 2.6, 18],
  '오다 노부나가': ['삼단 철포', 'atk', 2.6, 15], '다케다 신겐': ['풍림화산', 'atk', 2.5, 15], '우에스기 겐신': ['차륜진', 'atk', 2.6, 15], 이순신: ['학익진', 'atk', 3.0, 25],
  을지문덕: ['살수 수공', 'atk', 2.8, 20], 연개소문: ['비도술', 'atk', 2.3, 12], 이세민: ['현무문', 'atk', 2.4, 12], 이정: ['육화진', 'guard', 1.5, 8],
  살라딘: ['하틴의 갈증', 'scare', 1.8, 22], 리처드: ['사자심왕', 'atk', 2.6, 15], 잔다르크: ['오를레앙의 깃발', 'scare', 1.6, 20], 티무르: ['절름발이 정복자', 'atk', 2.6, 18],
};
export const uniqueOf = (g) => UNIQUE[g.name] || null;

// 오늘 부대 u가 쓸 전법: 고유 전법이 있으면 먼저(25%), 없으면 능력 70 이상으로 돌격·일제사격·화계
const BASIC = { war: ['돌격', 'atk', 2.2, 8], lead: ['일제사격', 'atk', 1.8, 5], intel: ['화계', 'fire', 1.6, 10] };
export function tacticOf(s, u, rng) {
  let best = null;
  for (const g of gensOf(s, u.gens)) {
    const un = uniqueOf(g);
    if (un && rng() < 0.25) { const [name, kind, mult, morale] = un; return { g, name, kind, mult, morale, unique: true }; }
    for (const k of ['war', 'lead', 'intel']) {
      const v = g[k];
      if (v < 70) continue;
      const ch = Math.min(0.4, (v - 60) / 100);
      if (rng() < ch && (!best || v > best.v)) { const [name, kind, mult, morale] = BASIC[k]; best = { g, v, name, kind, mult, morale }; }
    }
  }
  return best;
}

// ── 일기토: 무력 75 이상 대장끼리 붙으면 가끔 ──
export function maybeDuel(s, u, t, rng) {
  if (s.duelDone?.[`${u.id}-${t.id}`] || s.duelDone?.[`${t.id}-${u.id}`]) return null;
  const a = gensOf(s, u.gens).sort((x, y) => y.war - x.war)[0], b = gensOf(s, t.gens).sort((x, y) => y.war - x.war)[0];
  if (!a || !b || a.war < 75 || b.war < 75 || rng() > 0.06) return null;
  s.duelDone = s.duelDone || {};
  s.duelDone[`${u.id}-${t.id}`] = 1;
  // 세 합: 무력 + 운으로 체력을 깎음
  let ha = 100, hb = 100;
  const rounds = [];
  for (let r = 0; r < 5 && ha > 0 && hb > 0; r++) {
    const da = Math.round(Math.max(4, (a.war - b.war) * 0.8 + 18 + rng() * 22));
    const db = Math.round(Math.max(4, (b.war - a.war) * 0.8 + 18 + rng() * 22));
    hb = Math.max(0, hb - da);
    ha = Math.max(0, ha - db);
    rounds.push([ha, hb]);
  }
  const winA = ha === hb ? a.war >= b.war : ha > hb;
  const [W, Lo, wu, lu] = winA ? [a, b, u, t] : [b, a, t, u];
  lu.morale -= 30;
  wu.morale = Math.min(100, wu.morale + 10);
  const big = Math.abs(ha - hb) > 45;
  let fate = '';
  if (big && rng() < 0.25) {
    // 크게 지면 사로잡힘
    Lo.status = 'prisoner'; Lo.captor = W.nation; Lo.castle = null; Lo.unit = null;
    lu.gens = lu.gens.filter((id) => id !== Lo.id);
    if (!lu.gens.length) lu.morale = 0;
    fate = ` ${Lo.name}이(가) 사로잡혔습니다!`;
  }
  const d = { a: a.name, b: b.name, an: u.nation, bn: t.nation, rounds, winner: W.name, fate, tile: t.tile };
  s.duels = s.duels || [];
  s.duels.push(d);
  log(s, `⚔️ 일기토! ${a.name} 대 ${b.name} — ${W.name}의 승리.${fate}`, 'battle', [u.nation, t.nation]);
  return d;
}

// ── 사건: 삼국지는 역사 사건, 그 밖은 무작위 사건 ──
const TK = (s) => /^threekingdoms/.test(s.scenarioId);
const findGen = (s, name) => Object.values(s.generals).find((g) => g.name === name);
const nationNamed = (s, name) => s.nations.find((n) => n.alive && n.name === name);
const turnAt = (s, y, m, part = 0) => (y - (s.startYear ?? 200)) * 36 + (m - 1) * 3 + part + 1;
const capitalOf = (s, nid) => s.castles.find((c) => c.owner === nid && c.capital) || s.castles.find((c) => c.owner === nid && c.kind !== 'pass');

function pushEvent(s, ev) {
  s.eventsQ = s.eventsQ || [];
  s.eventsQ.push(ev);
  log(s, `📜 ${ev.title}: ${ev.text}`, 'event', ev.nations || []);
}

const HISTORY = [
  {
    id: 'sunce', at: (s) => turnAt(s, 200, 4),
    run(s, grid) {
      const g = findGen(s, '손책');
      if (!g || g.status !== 'active') return false;
      g.status = 'gone'; g.castle = null;
      if (g.unit) { const u = s.units.find((x) => x.id === g.unit); if (u) { u.gens = u.gens.filter((id) => id !== g.id); if (!u.gens.length) u.morale = 0; } }
      pushEvent(s, { title: '소패왕의 죽음', text: '손책이 사냥길에 자객의 화살을 맞고 세상을 떠났습니다. 강동은 손권이 이어받습니다.', faces: ['손책', '손권'], nations: [g.nation] });
      return true;
    },
  },
  {
    id: 'guandu', at: (s) => turnAt(s, 200, 10),
    run(s, grid) {
      const cao = nationNamed(s, '조조'), yuan = nationNamed(s, '원소');
      if (!cao || !yuan || !enemy(s, cao.id, yuan.id)) return false;
      const xu = findGen(s, '허유');
      if (xu && xu.nation === yuan.id && xu.status === 'active') Object.assign(xu, { nation: cao.id, castle: capitalOf(s, cao.id)?.id ?? xu.castle, unit: null });
      yuan.food = Math.round((yuan.food || 0) * 0.5);
      for (const u of s.units) if (u.nation === yuan.id) u.morale = Math.max(0, u.morale - 20);
      pushEvent(s, { title: '관도대전 — 오소 습격', text: '원소의 모사 허유가 조조에게 투항해 오소의 군량고를 알려 주었습니다. 원소군 병량이 절반으로 줄고 사기가 꺾였습니다.', faces: ['허유', '조조'], nations: [cao.id, yuan.id] });
      return true;
    },
  },
  {
    id: 'yuanshao', at: (s) => turnAt(s, 202, 5),
    run(s, grid) {
      const g = findGen(s, '원소');
      if (!g || g.status !== 'active') return false;
      g.status = 'gone'; g.castle = null;
      const heir = Object.values(s.generals).find((x) => x.nation === g.nation && x.status === 'active' && (x.name === '원상' || x.name === '원담'));
      if (heir) heir.ruler = true;
      for (const u of s.units) if (u.nation === g.nation) u.morale = Math.max(0, u.morale - 15);
      pushEvent(s, { title: '원소 병사', text: `관도의 패배 뒤 원소가 병으로 죽었습니다.${heir ? ` ${heir.name}이(가) 뒤를 이었으나 형제 사이가 벌어졌습니다.` : ''}`, faces: ['원소', heir?.name].filter(Boolean), nations: [g.nation] });
      return true;
    },
  },
  {
    id: 'zhuge', at: (s) => turnAt(s, 207, 1),
    run(s, grid) {
      const liu = nationNamed(s, '유비'), z = findGen(s, '제갈량');
      if (!liu || !z || z.status !== 'free') return false;
      const at = capitalOf(s, liu.id);
      if (!at) return false;
      Object.assign(z, { status: 'active', nation: liu.id, castle: at.id });
      pushEvent(s, { title: '삼고초려', text: '유비가 융중의 초가를 세 번 찾아가 제갈량을 군사로 맞아들였습니다. 「천하삼분지계」', faces: ['유비', '제갈량'], nations: [liu.id] });
      return true;
    },
  },
  {
    id: 'liubiao', at: (s) => turnAt(s, 208, 8),
    run(s, grid) {
      const lb = nationNamed(s, '유표'), cao = nationNamed(s, '조조');
      const g = findGen(s, '유표');
      if (!lb || !g || g.status !== 'active') return false;
      g.status = 'gone'; g.castle = null;
      if (cao && powerOf(s, cao.id) > powerOf(s, lb.id) * 2) {
        // 유종이 조조에게 항복: 형주가 통째로 넘어감
        for (const c of s.castles) if (c.owner === lb.id) { c.owner = cao.id; for (const t of districtTiles(s)[c.id] || []) if (s.owner[t] === lb.id) s.owner[t] = cao.id; s.owner[c.tile] = cao.id; }
        for (const x of Object.values(s.generals)) if (x.nation === lb.id && x.status === 'active') x.nation = cao.id;
        for (const u of s.units) if (u.nation === lb.id) u.nation = cao.id;
        lb.alive = false;
        pushEvent(s, { title: '유종의 항복', text: '유표가 병으로 죽자 뒤를 이은 유종이 싸우지도 않고 형주를 조조에게 바쳤습니다.', faces: ['유표', '조조'], nations: [lb.id, cao.id] });
      } else pushEvent(s, { title: '유표 병사', text: '형주목 유표가 병으로 세상을 떠났습니다.', faces: ['유표'], nations: [lb.id] });
      return true;
    },
  },
  {
    id: 'chibi', at: (s) => turnAt(s, 208, 11),
    run(s, grid) {
      const cao = nationNamed(s, '조조'), sun = nationNamed(s, '손권');
      if (!cao || !sun) return false;
      const liu = nationNamed(s, '유비');
      if (liu && !s.pacts?.some((p) => (p.a === sun.id && p.b === liu.id) || (p.a === liu.id && p.b === sun.id))) makePact(s, sun.id, liu.id, 'ally');
      // 동남풍: 강·물 위의 조조군이 불탐
      let burnt = 0;
      for (const u of s.units) if (u.nation === cao.id && (grid.water?.[u.tile] || grid.river[u.tile])) { const x = Math.round(u.troops * 0.4); u.troops -= x; u.morale = Math.max(0, u.morale - 30); burnt += x; }
      s.weather = { kind: 'wind', wind: 1, winter: false };
      pushEvent(s, { title: '적벽대전 — 동남풍', text: `제갈량이 동남풍을 빌리고 주유·황개의 화공이 조조의 선단을 불살랐습니다.${burnt ? ` 조조군 ${fmtTroops(burnt)}이(가) 불에 탔습니다.` : ''} 손권과 유비가 손을 잡았습니다.`, faces: ['주유', '제갈량', '조조'], nations: [cao.id, sun.id] });
      return true;
    },
  },
];

const RANDOM = [
  ['풍년', 0.3, (s, n, rng) => { const x = Math.round((n.food || 0) * 0.2 + 10000); n.food += x; return `들판이 황금빛입니다. 병량 +${fmtTroops(x)}`; }],
  ['메뚜기 떼', 0.2, (s, n) => { const x = Math.round((n.food || 0) * 0.15); n.food -= x; return `메뚜기 떼가 곡식을 갉아먹었습니다. 병량 -${fmtTroops(x)}`; }],
  ['역병', 0.2, (s, n, rng) => { const c = rng.pick(s.castles.filter((x) => x.owner === n.id && x.kind !== 'pass')); if (!c) return null; const x = Math.round(c.troops * 0.15); c.troops -= x; c.pop = Math.round(c.pop * 0.95); return `${c.name}에 역병이 돌아 병사 ${fmtTroops(x)}이(가) 쓰러졌습니다.`; }],
  ['큰 상단', 0.2, (s, n) => { n.gold += 20000; return `서역 상단이 들러 세금을 냈습니다. 금 +${fmtGold(20000)}`; }],
  ['의병', 0.1, (s, n, rng) => { const c = rng.pick(s.castles.filter((x) => x.owner === n.id && x.kind !== 'pass')); if (!c) return null; const x = Math.round(c.pop * 60); c.troops += x; return `${c.name}에서 백성들이 의병으로 모였습니다. 병력 +${fmtTroops(x)}`; }],
];

export function eventsTurn(s, grid) {
  s.evDone = s.evDone || {};
  // 역사 사건: 그 날짜부터 1년 안에 조건이 맞으면 일어남 (안 맞으면 지나감)
  if (TK(s)) for (const ev of HISTORY) {
    const at = ev.at(s);
    if (s.evDone[ev.id] || s.turn < at || at < 1) continue;
    if (ev.run(s, grid) || s.turn > at + 36) s.evDone[ev.id] = true;
  }
  const rng = makeRng(`ev:${s.seed}:${s.turn}`);
  for (const n of s.nations) {
    if (!n.alive || n.horde || rng() > 0.03) continue;
    let r = rng(), pick = RANDOM[0];
    for (const e of RANDOM) { if ((r -= e[1]) <= 0) { pick = e; break; } }
    const text = pick[2](s, n, rng);
    if (!text) continue;
    if (n.id === s.playerId && !s.spectator) pushEvent(s, { title: pick[0], text, nations: [n.id] });
  }
}
