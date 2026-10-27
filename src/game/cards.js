// 사건 카드: 선택지가 있는 사건. 플레이어는 창에서 고르고, 컴퓨터는 알아서 고름
// 일반 카드는 어느 판에서나, 역사 카드는 그 시나리오·나라·연도에만 나옴
import { G } from './rules.js';
import { log, nationRegions, nationGenerals, getRel, setRel, spawnGeneral, nationPower } from './engine.js';
import { fmtGold, fmtTroops } from './format.js';
import { yearOf } from './weather.js';
import { getScenario } from './scenarios.js';
import { makeRng } from './rng.js';

const land = (s, nid) => nationRegions(s, nid).filter((r) => !s.regions[r].sea);
const capOf = (s, nid) => s.nations[nid].capital ?? land(s, nid)[0];
const addTroops = (s, nid, k) => {
  const c = capOf(s, nid);
  if (c !== undefined) s.regions[c].troops += Math.round((k * (s.df || 1)) / 100) * 100;
};
const loyAll = (s, nid, d) => {
  for (const g of nationGenerals(s, nid)) if (g.id !== s.nations[nid].ruler) g.loyalty = Math.max(0, Math.min(100, (g.loyalty ?? 60) + d));
};
const buff = (s, nid, turns, b) => (s.buffs = s.buffs || []).push({ nid, until: s.turn + turns, ...b });
// 나와 맞닿은 나라들
function neighbors(s, world, nid) {
  const out = new Set();
  for (const r of nationRegions(s, nid)) for (const x of world.regions[r].neighbors) {
    const o = s.regions[x.id].owner;
    if (o !== null && o !== nid && !s.regions[x.id].sea && s.nations[o].alive && !s.nations[o].horde && !s.nations[o].fief) out.add(o);
  }
  return [...out];
}
// 적과 맞닿은 내 땅 중 병력이 가장 많은 적 땅 (기습 대상)
function bigFoeRegion(s, world, nid, foe) {
  let best = null;
  for (const r of nationRegions(s, nid)) for (const x of world.regions[r].neighbors) {
    const t = s.regions[x.id];
    if (!t.sea && t.owner === foe && (best === null || t.troops > s.regions[best].troops)) best = x.id;
  }
  return best;
}

// ───────── 일반 카드 ─────────
const GENERIC = [
  {
    id: 'famine',
    when: (s, w, nid) => land(s, nid).length >= 3,
    make: (s, w, nid) => ({
      icon: '🌾', title: '흉년', story: '가뭄으로 곡식이 말라 백성들이 굶주립니다.',
      options: [
        { label: '곳간을 연다', desc: `금 -${fmtGold(20 * G + land(s, nid).length * 3 * G)}`, ai: 1, run: () => { s.nations[nid].gold = Math.max(0, s.nations[nid].gold - (20 * G + land(s, nid).length * 3 * G)); return '굶주림을 넘겼습니다.'; } },
        { label: '버틴다', desc: '큰 고을 세 곳 인구 -15%, 병력 -10%', ai: 1, run: () => { for (const r of land(s, nid).sort((a, b) => s.regions[b].pop - s.regions[a].pop).slice(0, 3)) { s.regions[r].pop *= 0.85; s.regions[r].troops = Math.round((s.regions[r].troops * 0.9) / 100) * 100; } return '백성이 흩어지고 병사가 굶주렸습니다.'; } },
      ],
    }),
  },
  {
    id: 'marriage',
    when: (s, w, nid) => neighbors(s, w, nid).some((o) => getRel(s, nid, o).type === 'none'),
    make: (s, w, nid, rng) => {
      const o = rng.pick(neighbors(s, w, nid).filter((x) => getRel(s, nid, x).type === 'none'));
      return {
        icon: '💍', title: '혼인 동맹', story: `${s.nations[o].name}의 사신이 왕실 간 혼인을 청합니다.`,
        options: [
          { label: '받아들인다', desc: `${s.nations[o].name}과(와) 20턴 불가침, 호감 +30, 지참금 금 -${fmtGold(20 * G)}`, ai: 2, run: () => { setRel(s, nid, o, { type: 'nap', until: s.turn + 20, since: s.turn }); s.opinion[o][nid] += 30; s.opinion[nid][o] += 30; s.nations[nid].gold = Math.max(0, s.nations[nid].gold - 20 * G); return `${s.nations[o].name}과(와) 사돈이 되었습니다.`; } },
          { label: '거절한다', desc: `${s.nations[o].name} 호감 -15`, ai: 1, run: () => { s.opinion[o][nid] -= 15; return '혼담을 물렸습니다.'; } },
        ],
      };
    },
  },
  {
    id: 'raid',
    when: (s, w, nid) => neighbors(s, w, nid).some((o) => getRel(s, nid, o).type === 'none') && nationGenerals(s, nid).length >= 2,
    make: (s, w, nid, rng) => {
      const foe = rng.pick(neighbors(s, w, nid).filter((x) => getRel(s, nid, x).type === 'none'));
      const g = rng.pick(nationGenerals(s, nid).filter((x) => x.id !== s.nations[nid].ruler).concat(nationGenerals(s, nid)));
      const t = bigFoeRegion(s, w, nid, foe);
      return {
        icon: '🗡️', title: `${g.name}의 간언`, story: `${g.name}이(가) "${s.nations[foe].name}의 ${s.regions[t].name}을(를) 밤에 기습하면 크게 이길 수 있습니다"라고 아룁니다.`,
        options: [
          { label: '기습을 허락한다', desc: '60%: 적 병력 -40% / 40%: 우리 수도 병력 -20%', ai: 1, run: () => { if (rng() < 0.6) { s.regions[t].troops = Math.round((s.regions[t].troops * 0.6) / 100) * 100; s.opinion[foe][nid] -= 20; return `기습 성공! ${s.regions[t].name}의 적군이 크게 꺾였습니다.`; } const c = capOf(s, nid); s.regions[c].troops = Math.round((s.regions[c].troops * 0.8) / 100) * 100; return '기습이 들통나 군사를 잃었습니다.'; } },
          { label: '물리친다', desc: `${g.name} 충성 -5`, ai: 1, run: () => { g.loyalty = Math.max(0, (g.loyalty ?? 60) - 5); return `${g.name}이(가) 서운해합니다.`; } },
        ],
      };
    },
  },
  {
    id: 'arms',
    when: (s, w, nid) => s.nations[nid].gold >= 60 * G,
    make: (s, w, nid) => ({
      icon: '⚒️', title: '무기 상인', story: '먼 나라의 상인이 날카로운 무기와 갑옷을 팔겠다고 찾아왔습니다.',
      options: [
        { label: '산다', desc: `금 -${fmtGold(50 * G)}, 8턴 동안 공격 +10%`, ai: 1, run: () => { s.nations[nid].gold -= 50 * G; buff(s, nid, 8, { att: 1.1 }); return '군대가 새 무기를 갖췄습니다.'; } },
        { label: '돌려보낸다', desc: '아무 일 없음', ai: 1, run: () => '상인이 떠났습니다.' },
      ],
    }),
  },
  {
    id: 'doctor',
    when: (s, w, nid) => s.generals[s.nations[nid].ruler]?.status === 'active' && !(s.nations[nid].healthy > s.turn),
    make: (s, w, nid) => ({
      icon: '💊', title: '이름난 의원', story: `떠돌던 명의가 ${s.generals[s.nations[nid].ruler].name}의 건강을 돌보겠다고 합니다.`,
      options: [
        { label: '모신다', desc: `금 -${fmtGold(25 * G)}, 40턴 동안 군주가 병으로 죽지 않음`, ai: 1, run: () => { s.nations[nid].gold = Math.max(0, s.nations[nid].gold - 25 * G); s.nations[nid].healthy = s.turn + 40; return '군주가 강건해졌습니다.'; } },
        { label: '돌려보낸다', desc: '아무 일 없음', ai: 1, run: () => '의원이 떠났습니다.' },
      ],
    }),
  },
  {
    id: 'oracle',
    when: () => true,
    make: (s, w, nid) => ({
      icon: '🔮', title: '점술가의 예언', story: '점술가가 "하늘이 이 나라를 택했다"고 외치며 저잣거리를 돕니다.',
      options: [
        { label: '예언을 퍼뜨린다', desc: '모든 장수 충성 +6, 평판 -3', ai: 1, run: () => { loyAll(s, nid, 6); s.nations[nid].reputation = Math.max(0, s.nations[nid].reputation - 3); return '장수들의 사기가 올랐습니다.'; } },
        { label: '혹세무민이라 내쫓는다', desc: '평판 +3', ai: 1, run: () => { s.nations[nid].reputation = Math.min(100, s.nations[nid].reputation + 3); return '현명한 군주라는 평이 돕니다.'; } },
      ],
    }),
  },
  {
    id: 'talent',
    when: (s, w, nid) => s.nations[nid].gold >= 40 * G,
    make: (s, w, nid, rng) => ({
      icon: '📜', title: '인재 천거', story: '재야의 선비가 이름난 인재를 천거하며 예를 갖춰 모시라고 합니다.',
      options: [
        { label: '삼고초려한다', desc: `금 -${fmtGold(35 * G)}, 장수 1명 등용`, ai: 2, run: () => { const g = spawnGeneral(s, nid, rng, true); if (!g) return '인재가 이미 다른 곳으로 떠났습니다.'; s.nations[nid].gold -= 35 * G; return `${g.name}이(가) 출사했습니다.`; } },
        { label: '사양한다', desc: '아무 일 없음', ai: 1, run: () => '천거를 사양했습니다.' },
      ],
    }),
  },
  {
    id: 'tribute',
    when: (s, w, nid) => neighbors(s, w, nid).some((o) => nationPower(s, o) > nationPower(s, nid) * 1.5 && getRel(s, nid, o).type === 'none'),
    make: (s, w, nid, rng) => {
      const o = rng.pick(neighbors(s, w, nid).filter((x) => nationPower(s, x) > nationPower(s, nid) * 1.5 && getRel(s, nid, x).type === 'none'));
      const gold = Math.round(Math.max(30 * G, s.nations[nid].gold * 0.25) / 1000) * 1000;
      return {
        icon: '👑', title: '강국의 요구', story: `강대한 ${s.nations[o].name}이(가) 사신을 보내 공물을 바치라 합니다.`,
        options: [
          { label: '공물을 바친다', desc: `금 -${fmtGold(gold)}, ${s.nations[o].name}과(와) 10턴 불가침`, ai: 1, run: () => { s.nations[nid].gold = Math.max(0, s.nations[nid].gold - gold); s.nations[o].gold += gold; setRel(s, nid, o, { type: 'nap', until: s.turn + 10, since: s.turn }); s.opinion[o][nid] += 20; return `${s.nations[o].name}의 칼끝을 돌렸습니다.`; } },
          { label: '사신의 목을 벤다', desc: `${s.nations[o].name} 호감 -40 (침공 위험), 모든 장수 충성 +4`, ai: 1, run: () => { s.opinion[o][nid] -= 40; s.nations[o].goal = nid; s.nations[o].goalSince = s.turn; loyAll(s, nid, 4); return `${s.nations[o].name}이(가) 분노했습니다!`; } },
        ],
      };
    },
  },
  {
    id: 'festival',
    when: (s, w, nid) => s.nations[nid].gold >= 50 * G && nationGenerals(s, nid).length >= 2,
    make: (s, w, nid) => ({
      icon: '🎊', title: '큰 잔치', story: '전쟁에 지친 장수들이 잔치를 열어 노고를 위로해 달라고 청합니다.',
      options: [
        { label: '잔치를 연다', desc: `금 -${fmtGold(30 * G)}, 모든 장수 충성 +8`, ai: 1, run: () => { s.nations[nid].gold -= 30 * G; loyAll(s, nid, 8); return '장수들이 흥겹게 취했습니다.'; } },
        { label: '검소하게 넘긴다', desc: '모든 장수 충성 -2', ai: 1, run: () => { loyAll(s, nid, -2); return '장수들이 아쉬워합니다.'; } },
      ],
    }),
  },
  {
    id: 'deserters',
    when: (s, w, nid) => land(s, nid).length >= 2,
    make: (s, w, nid) => ({
      icon: '🏳️', title: '귀순병', story: '이웃 나라에서 도망친 병사들이 받아 달라고 성문 앞에 모였습니다.',
      options: [
        { label: '받아들인다', desc: `수도 병력 +${fmtTroops(5000 * (s.df || 1))} (첩자가 섞였을 수 있음: 가끔 장수 하나 충성 -10)`, ai: 2, run: () => { addTroops(s, nid, 5000); const gs = nationGenerals(s, nid).filter((x) => x.id !== s.nations[nid].ruler); if (gs.length && s.turn % 3 === 0) { gs[0].loyalty = Math.max(0, (gs[0].loyalty ?? 60) - 10); return '병사를 받았지만 장수 하나가 꺼림칙해합니다.'; } return '병사들이 기꺼이 충성을 맹세했습니다.'; } },
        { label: '돌려보낸다', desc: '아무 일 없음', ai: 1, run: () => '병사들이 흩어졌습니다.' },
      ],
    }),
  },
];

// ───────── 역사 카드: 시나리오(세계판 포함)·나라·연도 ─────────
const HIST = [
  {
    scn: 'threekingdoms200', nation: '조조', from: 200, to: 203, icon: '🔥', title: '허유의 투항',
    story: '원소의 모사 허유가 투항해 와 "오소의 군량고를 불태우면 원소군이 무너집니다"라고 알립니다.',
    make: (s, w, nid, rng) => {
      const foe = s.nations.find((n) => n.alive && n.name === '원소');
      const t = foe ? bigFoeRegion(s, w, nid, foe.id) : null;
      return [
        { label: '오소를 기습한다', desc: t !== null ? `70%: 원소 ${s.regions[t].name} 병력 -50% / 30%: 우리 수도 병력 -20%` : '원소와 맞닿아 있지 않으면 효과 없음', ai: 2, run: () => { if (t === null) return '원소와 맞닿은 곳이 없습니다.'; if (rng() < 0.7) { s.regions[t].troops = Math.round((s.regions[t].troops * 0.5) / 100) * 100; return '오소의 군량이 불타고 원소군이 흔들립니다!'; } const c = capOf(s, nid); s.regions[c].troops = Math.round((s.regions[c].troops * 0.8) / 100) * 100; return '허유의 말은 함정이었습니다.'; } },
        { label: '의심해 내친다', desc: '아무 일 없음', ai: 1, run: () => '허유를 돌려보냈습니다.' },
      ];
    },
  },
  {
    scn: 'threekingdoms200', nation: ['손권', '유비', '유표'], from: 207, to: 212, icon: '🔥', title: '적벽의 화공',
    story: '모사가 "북쪽 군대는 물에 익숙지 않아 배를 쇠사슬로 묶었습니다. 동남풍이 불 때 불을 놓으면 됩니다"라고 아룁니다.',
    make: (s, w, nid, rng) => {
      const foe = s.nations.find((n) => n.alive && n.name === '조조');
      const t = foe ? bigFoeRegion(s, w, nid, foe.id) : null;
      return [
        { label: '화공을 쓴다', desc: t !== null ? `65%: 조조 ${s.regions[t].name} 병력 -60% / 35%: 바람이 바뀌어 수도 병력 -15%` : '조조와 맞닿아 있지 않으면 효과 없음', ai: 2, run: () => { if (t === null) return '조조와 맞닿은 곳이 없습니다.'; if (rng() < 0.65) { s.regions[t].troops = Math.round((s.regions[t].troops * 0.4) / 100) * 100; return '적벽이 불타고 조조의 대군이 무너졌습니다!'; } const c = capOf(s, nid); s.regions[c].troops = Math.round((s.regions[c].troops * 0.85) / 100) * 100; return '바람이 바뀌어 불길이 우리 쪽으로 번졌습니다.'; } },
        { label: '때를 기다린다', desc: '아무 일 없음', ai: 1, run: () => '화공을 미뤘습니다.' },
      ];
    },
  },
  {
    scn: 'threekingdoms225', nation: '촉', from: 227, to: 234, icon: '📜', title: '출사표',
    story: '승상이 "한실을 다시 일으키려면 지금 북쪽을 쳐야 합니다"라며 출사표를 올립니다.',
    make: (s, w, nid) => [
      { label: '북벌한다', desc: '10턴 동안 공격 +15%, 수도 병력 +1만', ai: 2, run: () => { buff(s, nid, 10, { att: 1.15 }); addTroops(s, nid, 10000); return '촉군이 기산으로 나아갑니다!'; } },
      { label: '내정에 힘쓴다', desc: `금 +${fmtGold(60 * G)}`, ai: 1, run: () => { s.nations[nid].gold += 60 * G; return '나라 살림을 다졌습니다.'; } },
    ],
  },
  {
    scn: 'imjin1592', nation: '조선', from: 1592, to: 1598, icon: '⚓', title: '전라좌수사 이순신',
    story: '전라좌수사가 거북선을 만들어 바다를 지키겠다고 장계를 올립니다.',
    make: (s, w, nid, rng) => [
      { label: '전권을 맡긴다', desc: `금 -${fmtGold(30 * G)}, 12턴 동안 방어 +20%`, ai: 2, run: () => { s.nations[nid].gold = Math.max(0, s.nations[nid].gold - 30 * G); buff(s, nid, 12, { def: 1.2 }); return '수군이 바다를 지킵니다.'; } },
      { label: '육군에 보탠다', desc: '수도 병력 +8천', ai: 1, run: () => { addTroops(s, nid, 8000); return '수군을 뭍으로 올렸습니다.'; } },
    ],
  },
  {
    scn: 'imjin1592', nation: '조선', from: 1592, to: 1600, icon: '🏹', title: '의병 봉기',
    story: '나라가 위태롭자 선비와 승려들이 의병을 일으켜 관군을 돕겠다고 나섭니다.',
    make: (s, w, nid) => [
      { label: '의병을 받아들인다', desc: '수도 병력 +1.2만, 모든 장수 충성 +5', ai: 2, run: () => { addTroops(s, nid, 12000); loyAll(s, nid, 5); return '의병이 곳곳에서 일어났습니다!'; } },
      { label: '관군만 믿는다', desc: '아무 일 없음', ai: 1, run: () => '의병을 돌려보냈습니다.' },
    ],
  },
  {
    scn: 'napoleon1805', nation: '프랑스 제국', from: 1805, to: 1812, icon: '🚢', title: '대륙 봉쇄령',
    story: '황제가 영국과의 교역을 끊어 영국을 말려 죽이자고 합니다.',
    make: (s, w, nid) => {
      const uk = s.nations.find((n) => n.alive && n.name === '영국');
      return [
        { label: '봉쇄한다', desc: uk ? `영국 금 -30%, 우리 금 -${fmtGold(30 * G)}` : '영국이 없으면 효과 없음', ai: 2, run: () => { if (!uk) return '영국이 없습니다.'; uk.gold = Math.round(uk.gold * 0.7); s.nations[nid].gold = Math.max(0, s.nations[nid].gold - 30 * G); return '영국의 상선이 항구에 묶였습니다.'; } },
        { label: '교역을 이어간다', desc: `금 +${fmtGold(30 * G)}`, ai: 1, run: () => { s.nations[nid].gold += 30 * G; return '상인들이 반깁니다.'; } },
      ];
    },
  },
  {
    scn: 'world1200', nation: '몽골', from: 1200, to: 1210, icon: '🐎', title: '쿠릴타이',
    story: '초원의 부족장들이 모여 테무진을 칸으로 추대하려 합니다.',
    make: (s, w, nid) => [
      { label: '칭기즈 칸에 오른다', desc: '15턴 동안 공격 +15%, 수도 병력 +1만', ai: 2, run: () => { buff(s, nid, 15, { att: 1.15 }); addTroops(s, nid, 10000); return '푸른 늑대의 군대가 일어섭니다!'; } },
      { label: '부족 연합에 머문다', desc: '모든 장수 충성 +8', ai: 1, run: () => { loyAll(s, nid, 8); return '부족장들이 만족합니다.'; } },
    ],
  },
];

// 카드 만들기: 같은 시드면 같은 카드 (플레이어 카드는 id·시드만 저장했다가 고를 때 다시 만듦 — 세이브는 JSON이라 함수를 못 담음)
function build(s, world, nid, id, seed) {
  const rng = makeRng(seed);
  if (id.startsWith('h')) {
    const h = HIST[+id.slice(1)];
    return { card: { icon: h.icon, title: h.title, story: h.story, options: h.make(s, world, nid, rng) }, rng };
  }
  return { card: GENERIC.find((c) => c.id === id.slice(1)).make(s, world, nid, rng), rng };
}

// 매 턴: 플레이어는 가끔 카드 한 장(밀린 카드가 없을 때), 컴퓨터도 가끔 알아서 고름
export function drawCards(s, world, rng) {
  if (s.turn < 3) return;
  const scnId = (s.scenarioId || '').replace('@world', '');
  const year = yearOf(s.turn, getScenario(s.scenarioId)?.startYear ?? 1);
  s.histDone = s.histDone || {};
  for (const n of s.nations) {
    if (!n.alive || n.horde || n.fief) continue;
    const isP = n.isPlayer && !s.spectator;
    if (isP && (s.choices || []).length) continue;
    // 역사 카드 먼저 (한 번씩)
    const hi = HIST.findIndex((h, i) => !s.histDone[i] && h.scn === scnId && [].concat(h.nation).includes(n.name) && year >= h.from && year <= h.to);
    let id = null;
    if (hi >= 0 && rng() < 0.25) {
      s.histDone[hi] = true;
      id = `h${hi}`;
    } else if (rng() < (isP ? 0.1 : 0.04)) {
      const pool = GENERIC.filter((c) => c.when(s, world, n.id));
      if (pool.length) id = `g${rng.pick(pool).id}`;
    }
    if (!id) continue;
    const seed = Math.floor(rng() * 1e9);
    const { card, rng: r2 } = build(s, world, n.id, id, seed);
    if (isP) {
      s.choices = [{ nid: n.id, id, seed, icon: card.icon, title: card.title, story: card.story, hist: id.startsWith('h'), options: card.options.map((o) => ({ label: o.label, desc: o.desc })) }];
    } else {
      const pick = r2.weighted(card.options, (o) => o.ai || 1);
      const res = pick.run();
      log(s, `${card.icon} ${n.name} — ${card.title}: 「${pick.label}」 ${res}`, [n.id], 'event');
    }
  }
}

export function answerCard(s, world, idx) {
  const c = s.choices?.[0];
  if (!c) return { ok: false, msg: '고를 사건이 없습니다.' };
  s.choices = [];
  if (!s.nations[c.nid]?.alive) return { ok: true };
  const { card } = build(s, world, c.nid, c.id, c.seed);
  const o = card.options[idx];
  if (!o) return { ok: false, msg: '없는 선택지입니다.' };
  const res = o.run();
  log(s, `${c.icon} ${c.title}: 「${o.label}」 ${res}`, [c.nid], 'event');
  return { ok: true, msg: res };
}
