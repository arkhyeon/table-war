import { log, nationRegions, gensIn, succession, addGeneral, checkElimination } from './engine.js';
import { POOLS } from './generals.js';
import { fmtTroops } from './format.js';

const byName = (s, name) => s.nations.find((n) => n.name === name && n.alive);

function ruinRegions(s, ids, popCut, troopCut) {
  for (const i of ids) {
    const r = s.regions[i];
    r.pop = Math.max(3, r.pop * (1 - popCut));
    r.troops = Math.max(100, Math.round((r.troops * (1 - troopCut)) / 100) * 100);
  }
}

function spawnNamed(s, nation, name, rng) {
  for (const list of Object.values(POOLS)) {
    const g = list.find((x) => x.name === name);
    if (g && !s.usedGen[g.id]) {
      addGeneral(s, g, nation.id, nation.capital, rng);
      return g;
    }
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

// 시나리오별 역사 이벤트
const SCRIPTED = {
  world1200: [
    { turn: 8, run: (s, w, rng) => {
      const n = byName(s, '몽골');
      if (!n) return;
      s.buffs.push({ nid: n.id, att: 1.2, until: s.turn + 12, label: '쿠릴타이' });
      log(s, '📯 쿠릴타이: 테무진이 칭기즈 칸으로 추대되었습니다! 몽골군 공격력 +20% (12턴)', [n.id], 'event');
    } },
    { turn: 36, run: (s, w) => {
      const n = byName(s, '몽골');
      if (!n || nationRegions(s, n.id).length < 10) return;
      killRuler(s, n);
      const k = breakAway(s, w, n, 0.35);
      log(s, `⚰️ 칭기즈 칸 사후 제국이 분열했습니다! 몽골 영토 ${k}곳이 이탈.`, [n.id], 'event');
    } },
    { turn: 20, run: (s, w, rng) => {
      const n = byName(s, '가마쿠라 막부');
      if (!n) return;
      s.buffs.push({ nid: n.id, def: 1.5, until: s.turn + 6, label: '가미카제' });
      log(s, '🌊 가미카제(신풍): 가마쿠라 막부 방어력 +50% (6턴)', [n.id], 'event');
    } },
  ],
  eastasia650: [
    { turn: 6, run: (s) => {
      const n = byName(s, '당');
      if (!n) return;
      killRuler(s, n);
      log(s, '⚰️ 당 태종이 붕어했습니다. 새 황제가 즉위합니다.', [n.id], 'event');
    } },
    { turn: 16, run: (s) => {
      const n = byName(s, '고구려');
      if (!n) return;
      killRuler(s, n);
      for (const r of nationRegions(s, n.id)) s.regions[r].loyalty = Math.max(0, s.regions[r].loyalty - 25);
      log(s, '⚔️ 연개소문 사후 아들들의 권력 다툼으로 고구려 민심이 크게 흔들립니다 (민심 -25).', [n.id], 'event');
    } },
  ],
  threekingdoms200: [
    { turn: 3, run: (s) => {
      const a = byName(s, '조조'), b = byName(s, '원소');
      if (!a || !b) return;
      s.opinion[a.id][b.id] -= 60;
      s.opinion[b.id][a.id] -= 60;
      log(s, '🔥 관도대전: 조조와 원소가 숙명의 대결에 들어갑니다.', [a.id, b.id], 'event');
    } },
    { turn: 7, run: (s, w, rng) => {
      const n = byName(s, '유비');
      if (!n) return;
      if (spawnNamed(s, n, '제갈량', rng)) log(s, '🪶 삼고초려: 제갈량이 유비의 군사가 되었습니다!', [n.id], 'event');
    } },
    { turn: 12, run: (s) => {
      for (const name of ['손권', '유비']) {
        const n = byName(s, name);
        if (n) s.buffs.push({ nid: n.id, def: 1.4, until: s.turn + 3, label: '동남풍' });
      }
      log(s, '🌬️ 적벽의 동남풍: 손권·유비 방어력 +40% (3턴)', s.nations.filter((n) => ['손권', '유비'].includes(n.name)).map((n) => n.id), 'event');
    } },
  ],
  europe1400: [
    { turn: 6, run: (s, w, rng) => {
      const ids = s.regions.map((_, i) => i).filter(() => rng() < 0.35);
      ruinRegions(s, ids, 0.3, 0.15);
      log(s, `☠️ 흑사병 재유행: 유럽 ${ids.length}개 지역 인구 -30%, 병력 -15%`, s.nations.map((n) => n.id), 'event');
    } },
    { turn: 10, run: (s) => {
      const n = byName(s, '오스만');
      if (!n) return;
      ruinRegions(s, nationRegions(s, n.id), 0, 0.35);
      killRuler(s, n);
      log(s, '🐎 앙카라 전투: 티무르가 오스만을 격파했습니다! 술탄 사망, 오스만 병력 -35%.', [n.id], 'event');
    } },
    { turn: 18, run: (s, w, rng) => {
      const n = byName(s, '프랑스');
      if (!n) return;
      if (spawnNamed(s, n, '잔 다르크', rng)) {
        s.buffs.push({ nid: n.id, att: 1.2, def: 1.2, until: s.turn + 8, label: '오를레앙의 처녀' });
        log(s, '🗡️ 잔 다르크가 나타나 프랑스군의 사기가 치솟습니다! (8턴간 공방 +20%)', [n.id], 'event');
      }
    } },
  ],
  africa1400: [
    { turn: 5, run: (s) => {
      const n = byName(s, '말리');
      if (!n) return;
      n.gold += 400;
      n.reputation = Math.min(100, n.reputation + 15);
      log(s, '🕋 만사 무사의 메카 순례: 말리의 황금이 세상을 놀라게 합니다 (+400금, 평판 +15).', [n.id], 'event');
    } },
    { turn: 15, run: (s) => {
      const n = byName(s, '송가이');
      if (!n) return;
      s.buffs.push({ nid: n.id, att: 1.25, until: s.turn + 10, label: '순니 알리의 원정' });
      log(s, '🐎 순니 알리의 대원정: 송가이 기병 공격력 +25% (10턴)', [n.id], 'event');
    } },
  ],
};

// 무작위 사건
const RANDOM = [
  { w: 3, run: (s, w, rng) => {
    const owned = s.regions.map((r, i) => i).filter((i) => s.regions[i].owner !== null);
    if (!owned.length) return;
    const c = rng.pick(owned);
    const ids = [c, ...w.regions[c].neighbors.filter((n) => n.type !== 'sea').map((n) => n.id)];
    ruinRegions(s, ids, 0.25, 0.2);
    const owners = [...new Set(ids.map((i) => s.regions[i].owner).filter((o) => o !== null))];
    log(s, `🦠 역병: ${s.regions[c].name} 일대에 역병이 돌아 인구 -25%, 병력 -20%`, owners, 'event');
  } },
  { w: 2, run: (s, w, rng) => {
    const owned = s.regions.map((r, i) => i).filter((i) => s.regions[i].owner !== null);
    if (!owned.length) return;
    const c = rng.pick(owned);
    for (const i of [c, ...w.regions[c].neighbors.map((n) => n.id)]) s.regions[i].loyalty = Math.max(0, (s.regions[i].loyalty ?? 100) - 15);
    log(s, `🦗 메뚜기 떼: ${s.regions[c].name} 일대 흉작으로 민심 -15`, [s.regions[c].owner], 'event');
  } },
  { w: 2, run: (s, w, rng) => {
    const alive = s.nations.filter((n) => n.alive);
    const n = rng.pick(alive);
    const g = 80 + rng.int(0, 120);
    n.gold += g;
    log(s, `⛏️ ${n.name}에서 금광이 발견되었습니다! (+${g}금)`, [n.id], 'event');
  } },
  { w: 1, run: (s, w, rng) => {
    const alive = s.nations.filter((n) => n.alive);
    const n = rng.pick(alive);
    const regs = nationRegions(s, n.id);
    let add = 0;
    for (const r of regs) {
      const x = Math.round(s.regions[r].pop * 60 / 100) * 100;
      s.regions[r].troops += x;
      add += x;
    }
    log(s, `🚩 ${n.name}에 의용군이 모여듭니다! (총 +${fmtTroops(add)})`, [n.id], 'event');
  } },
];

export function runEvents(s, world, rng) {
  s.buffs = (s.buffs || []).filter((b) => b.until >= s.turn);
  for (const e of SCRIPTED[s.scenarioId] || []) if (e.turn === s.turn) e.run(s, world, rng);
  if (rng() < 0.22) rng.weighted(RANDOM, (e) => e.w).run(s, world, rng);
}
