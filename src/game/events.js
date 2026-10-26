import { log, nationRegions, gensIn, succession, addGeneral, checkElimination, nationTrait } from './engine.js';
import { POOLS } from './generals.js';
import { fmtTroops } from './format.js';

// 사건은 기록에 남고, 관련 국가가 플레이어이거나 역사 사건이면 턴 시작 때 카드로 보여준다
function announce(s, ev) {
  log(s, `${ev.icon} ${ev.title}: ${ev.effect}`, ev.nations, 'event');
  (s.turnEvents = s.turnEvents || []).push(ev);
}

const byName = (s, name) => s.nations.find((n) => n.name === name && n.alive);

function ruinRegions(s, ids, popCut, troopCut) {
  for (const i of ids) {
    const r = s.regions[i];
    if (r.sea) continue;
    const cure = r.owner === null ? 0 : nationTrait(s, r.owner, '의술');
    r.pop = Math.max(3, r.pop * (1 - popCut * (1 - cure)));
    r.troops = Math.max(100, Math.round((r.troops * (1 - troopCut * (1 - cure))) / 100) * 100);
  }
}

function spawnNamed(s, nation, name, rng) {
  for (const list of Object.values(POOLS)) {
    const g = list.find((x) => x.name === name);
    if (g && !s.usedGen[g.id]) return addGeneral(s, g, nation.id, nation.capital, rng);
  }
  return null;
}

function killRuler(s, n) {
  const g = s.generals[n.ruler];
  if (g) g.status = 'dead';
  succession(s, n.id);
}

function breakAway(s, world, n, share) {
  const regs = nationRegions(s, n.id).filter((r) => r !== n.capital);
  const cap = world.regions[n.capital];
  regs.sort((a, b) => Math.hypot(world.regions[b].cx - cap.cx, world.regions[b].cy - cap.cy) - Math.hypot(world.regions[a].cx - cap.cx, world.regions[a].cy - cap.cy));
  const lost = regs.slice(0, Math.floor(regs.length * share));
  for (const r of lost) {
    for (const g of gensIn(s, r, n.id)) g.region = n.capital;
    s.regions[r].owner = null;
    s.regions[r].loyalty = 50;
  }
  checkElimination(s, world, n.id);
  return lost.length;
}

// 시나리오별 역사 사건 (해당 국가가 살아 있을 때만)
const SCRIPTED = {
  world1200: [
    { turn: 8, run: (s) => {
      const n = byName(s, '몽골');
      if (!n) return;
      s.buffs.push({ nid: n.id, att: 1.2, until: s.turn + 16, label: '쿠릴타이' });
      announce(s, { icon: '📯', title: '쿠릴타이', story: '초원의 부족장들이 모여 테무진을 칭기즈 칸으로 추대했습니다. 흩어졌던 유목민이 하나의 군대가 됩니다.', effect: '몽골 공격력 +20% (16턴)', nations: [n.id] });
    } },
    { turn: 24, run: (s) => {
      const n = byName(s, '가마쿠라 막부');
      if (!n) return;
      s.buffs.push({ nid: n.id, def: 1.5, until: s.turn + 8, label: '가미카제' });
      announce(s, { icon: '🌊', title: '가미카제(신풍)', story: '거센 태풍이 일본 열도를 감싸, 바다를 건너오는 적을 막아줍니다.', effect: '가마쿠라 막부 방어력 +50% (8턴)', nations: [n.id] });
    } },
    { turn: 48, run: (s, w) => {
      const n = byName(s, '몽골');
      if (!n || nationRegions(s, n.id).length < 10) return;
      killRuler(s, n);
      const k = breakAway(s, w, n, 0.35);
      announce(s, { icon: '⚰️', title: '칭기즈 칸의 죽음', story: '대칸이 숨을 거두자 아들과 장군들이 저마다 땅을 나눠 가지려 합니다.', effect: `몽골 군주 사망, 수도에서 먼 영토 ${k}곳이 이탈해 중립화`, nations: [n.id] });
    } },
  ],
  eastasia650: [
    { turn: 6, run: (s) => {
      const n = byName(s, '당');
      if (!n) return;
      killRuler(s, n);
      announce(s, { icon: '⚰️', title: '당 태종 붕어', story: '정관의 치를 이끈 태종이 세상을 떠났습니다.', effect: '당 군주 사망, 가장 뛰어난 장수가 즉위', nations: [n.id] });
    } },
    { turn: 20, run: (s) => {
      const n = byName(s, '고구려');
      if (!n) return;
      killRuler(s, n);
      for (const r of nationRegions(s, n.id)) s.regions[r].loyalty = Math.max(0, s.regions[r].loyalty - 25);
      announce(s, { icon: '⚔️', title: '연개소문 사망', story: '막리지가 죽자 세 아들이 권력을 두고 다투기 시작합니다.', effect: '고구려 군주 사망, 전 지역 민심 -25', nations: [n.id] });
    } },
  ],
  threekingdoms200: [
    { turn: 3, run: (s) => {
      const a = byName(s, '조조'), b = byName(s, '원소');
      if (!a || !b) return;
      s.opinion[a.id][b.id] -= 60;
      s.opinion[b.id][a.id] -= 60;
      announce(s, { icon: '🔥', title: '관도대전', story: '하북의 원소가 대군을 일으켜 남하하고, 조조는 관도에서 맞섭니다.', effect: '조조·원소 서로 호감 -60 (전면전)', nations: [a.id, b.id] });
    } },
    { turn: 10, run: (s, w, rng) => {
      const n = byName(s, '유비');
      if (!n) return;
      if (spawnNamed(s, n, '제갈량', rng)) announce(s, { icon: '🪶', title: '삼고초려', story: '유비가 융중의 초가를 세 번 찾아가 와룡을 얻었습니다.', effect: '유비 진영에 제갈량 합류', nations: [n.id] });
    } },
    { turn: 16, run: (s) => {
      const ids = s.nations.filter((n) => n.alive && ['손권', '유비'].includes(n.name)).map((n) => n.id);
      if (!ids.length) return;
      for (const id of ids) s.buffs.push({ nid: id, def: 1.4, until: s.turn + 4, label: '동남풍' });
      announce(s, { icon: '🌬️', title: '적벽의 동남풍', story: '겨울에 불 리 없는 동남풍이 불어와 화공이 가능해집니다.', effect: '손권·유비 방어력 +40% (4턴)', nations: ids });
    } },
  ],
  europe1400: [
    { turn: 6, run: (s, w, rng) => {
      const ids = s.regions.map((_, i) => i).filter((i) => !s.regions[i].sea && rng() < 0.35);
      ruinRegions(s, ids, 0.3, 0.15);
      announce(s, { icon: '☠️', title: '흑사병 재유행', story: '검은 죽음이 다시 유럽을 휩씁니다. 마을이 비고 군대가 무너집니다.', effect: `무작위 ${ids.length}개 지역 인구 -30%, 병력 -15% (의술 장수가 피해 경감)`, nations: s.nations.map((n) => n.id) });
    } },
    { turn: 10, run: (s) => {
      const n = byName(s, '오스만');
      if (!n) return;
      ruinRegions(s, nationRegions(s, n.id), 0, 0.35);
      killRuler(s, n);
      announce(s, { icon: '🐎', title: '앙카라 전투', story: '동방에서 티무르가 쳐들어와 술탄 바예지드를 사로잡았습니다.', effect: '오스만 군주 사망, 전 병력 -35%', nations: [n.id] });
    } },
    { turn: 24, run: (s, w, rng) => {
      const n = byName(s, '프랑스');
      if (!n) return;
      if (spawnNamed(s, n, '잔 다르크', rng)) {
        s.buffs.push({ nid: n.id, att: 1.2, def: 1.2, until: s.turn + 10, label: '오를레앙의 처녀' });
        announce(s, { icon: '🗡️', title: '잔 다르크', story: '신의 목소리를 들었다는 소녀가 군대를 이끌고 나타났습니다.', effect: '프랑스에 잔 다르크 합류, 공격·방어 +20% (10턴)', nations: [n.id] });
      }
    } },
  ],
  africa1400: [
    { turn: 5, run: (s) => {
      const n = byName(s, '말리');
      if (!n) return;
      n.gold += 400;
      n.reputation = Math.min(100, n.reputation + 15);
      announce(s, { icon: '🕋', title: '만사 무사의 순례', story: '말리의 황제가 황금을 싣고 메카로 순례를 떠나, 지나는 곳마다 금을 뿌렸습니다.', effect: '말리 국고 +400금, 평판 +15', nations: [n.id] });
    } },
    { turn: 20, run: (s) => {
      const n = byName(s, '송가이');
      if (!n) return;
      s.buffs.push({ nid: n.id, att: 1.25, until: s.turn + 12, label: '순니 알리의 원정' });
      announce(s, { icon: '🐎', title: '순니 알리의 대원정', story: '송가이의 기병대가 니제르강을 따라 거침없이 진격합니다.', effect: '송가이 공격력 +25% (12턴)', nations: [n.id] });
    } },
  ],
};

// 무작위 사건
const RANDOM = [
  { w: 3, run: (s, w, rng) => {
    const owned = s.regions.map((r, i) => i).filter((i) => !s.regions[i].sea && s.regions[i].owner !== null);
    if (!owned.length) return;
    const c = rng.pick(owned);
    const ids = [c, ...w.regions[c].neighbors.filter((n) => n.type === 'land' || n.type === 'river').map((n) => n.id)];
    ruinRegions(s, ids, 0.25, 0.2);
    const owners = [...new Set(ids.map((i) => s.regions[i].owner).filter((o) => o !== null))];
    announce(s, { icon: '🦠', title: '역병', story: `${s.regions[c].name} 일대에 역병이 돕니다.`, effect: `주변 ${ids.length}개 지역 인구 -25%, 병력 -20% (의술 장수가 피해 경감)`, nations: owners });
  } },
  { w: 2, run: (s, w, rng) => {
    const owned = s.regions.map((r, i) => i).filter((i) => !s.regions[i].sea && s.regions[i].owner !== null);
    if (!owned.length) return;
    const c = rng.pick(owned);
    const ids = [c, ...w.regions[c].neighbors.filter((n) => !s.regions[n.id].sea).map((n) => n.id)];
    for (const i of ids) s.regions[i].loyalty = Math.max(0, (s.regions[i].loyalty ?? 100) - 15);
    announce(s, { icon: '🦗', title: '메뚜기 떼', story: `${s.regions[c].name} 일대의 들판을 메뚜기가 덮쳤습니다.`, effect: `주변 ${ids.length}개 지역 민심 -15`, nations: [...new Set(ids.map((i) => s.regions[i].owner).filter((o) => o !== null))] });
  } },
  { w: 2, run: (s, w, rng) => {
    const n = rng.pick(s.nations.filter((x) => x.alive));
    const g = 80 + rng.int(0, 120);
    n.gold += g;
    announce(s, { icon: '⛏️', title: '금광 발견', story: `${n.name}의 산중에서 금맥이 발견되었습니다.`, effect: `${n.name} 국고 +${g}금`, nations: [n.id] });
  } },
  { w: 1, run: (s, w, rng) => {
    const n = rng.pick(s.nations.filter((x) => x.alive));
    let add = 0;
    for (const r of nationRegions(s, n.id)) {
      if ((s.regions[r].loyalty ?? 100) < 60) continue;
      const x = Math.round((s.regions[r].pop * 60) / 100) * 100;
      s.regions[r].troops += x;
      add += x;
    }
    if (add) announce(s, { icon: '🚩', title: '의용군', story: `${n.name}의 민심이 높은 고을에서 백성들이 스스로 무기를 들었습니다.`, effect: `민심 60 이상 지역 병력 총 +${fmtTroops(add)}`, nations: [n.id] });
  } },
];

export function runEvents(s, world, rng) {
  s.buffs = (s.buffs || []).filter((b) => b.until >= s.turn);
  for (const e of SCRIPTED[s.scenarioId] || []) if (e.turn === s.turn) e.run(s, world, rng);
  if (rng() < 0.18) rng.weighted(RANDOM, (e) => e.w).run(s, world, rng);
}
