import { log, nationRegions, gensIn, nationTrait, nationGenerals, gainExp, WALL_MAX } from './engine.js';
import { fmtTroops, fmtGold } from './format.js';
import { G, T } from './rules.js';
import { tv } from './traits.js';

// 무작위 사건: 특정 국가 이름에 묶이지 않고 조건만 맞으면 어느 나라에나 일어난다
// 관련 국가가 플레이어이거나 시야 안이면 턴 소식에 카드로 보여준다
function announce(s, ev) {
  log(s, `${ev.icon} ${ev.title}: ${ev.effect}`, ev.nations, 'event');
  (s.turnEvents = s.turnEvents || []).push(ev);
}

const landOwned = (s) => s.regions.map((_, i) => i).filter((i) => !s.regions[i].sea && s.regions[i].owner !== null);
const ownersOf = (s, ids) => [...new Set(ids.map((i) => s.regions[i].owner).filter((o) => o !== null))];
const landNeighbors = (s, w, c) => w.regions[c].neighbors.filter((n) => !s.regions[n.id].sea).map((n) => n.id);

function ruin(s, ids, popCut, troopCut) {
  for (const i of ids) {
    const r = s.regions[i];
    if (r.sea) continue;
    const cure = r.owner === null ? 0 : nationTrait(s, r.owner, '의술');
    r.pop = Math.max(3, r.pop * (1 - popCut * (1 - cure)));
    r.troops = Math.max(100, Math.round((r.troops * (1 - troopCut * (1 - cure))) / 100) * 100);
  }
}

const EVENTS = [
  {
    w: 3,
    run: (s, w, rng) => {
      const pool = landOwned(s);
      if (!pool.length) return;
      const c = rng.pick(pool);
      const ids = [c, ...landNeighbors(s, w, c)];
      ruin(s, ids, 0.25, 0.2);
      announce(s, { icon: '🦠', title: '역병', story: `${s.regions[c].name} 일대에 역병이 돕니다. 마을이 비고 병영이 텅 빕니다.`, effect: `${ids.length}개 지역 인구 -25%, 병력 -20% (의술 장수가 경감)`, nations: ownersOf(s, ids) });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const pool = landOwned(s);
      if (!pool.length) return;
      const c = rng.pick(pool);
      const ids = [c, ...landNeighbors(s, w, c)];
      for (const i of ids) s.regions[i].loyalty = Math.max(0, (s.regions[i].loyalty ?? 100) - 15);
      announce(s, { icon: '🦗', title: '메뚜기 떼', story: `${s.regions[c].name}의 들판을 메뚜기가 뒤덮었습니다.`, effect: `${ids.length}개 지역 민심 -15`, nations: ownersOf(s, ids) });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const pool = landOwned(s).filter((i) => s.regions[i].river);
      if (!pool.length) return;
      const c = rng.pick(pool);
      const r = s.regions[c];
      if (tv(gensIn(s, c, r.owner), '치수')) {
        announce(s, { icon: '🌊', title: '홍수를 막아냄', story: `${r.name}에 큰물이 졌지만 미리 쌓은 제방이 버텼습니다.`, effect: '치수 장수 덕분에 피해 없음, 민심 +5', nations: [r.owner] });
        r.loyalty = Math.min(100, r.loyalty + 5);
        return;
      }
      ruin(s, [c], 0.15, 0.05);
      r.loyalty = Math.max(0, r.loyalty - 10);
      announce(s, { icon: '🌊', title: '대홍수', story: `강이 넘쳐 ${r.name}의 논밭과 마을이 잠겼습니다.`, effect: '인구 -15%, 민심 -10 (치수 장수가 있으면 막음)', nations: [r.owner] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const pool = landOwned(s).filter((i) => [T.MOUNTAIN, T.HILLS].includes(w.regions[i].terrain));
      if (!pool.length) return;
      const c = rng.pick(pool);
      const r = s.regions[c];
      ruin(s, [c], 0.1, 0.05);
      if (r.buildings.walls) r.buildings.walls = Math.max(1, r.buildings.walls - 2);
      announce(s, { icon: '🫨', title: '지진', story: `${r.name}의 땅이 크게 흔들렸습니다.`, effect: '인구 -10%, 성벽 내구 -2', nations: [r.owner] });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive));
      const g = (80 + rng.int(0, 120)) * G;
      n.gold += g;
      announce(s, { icon: '⛏️', title: '금광 발견', story: `${n.name}의 산중에서 금맥이 발견되었습니다.`, effect: `${n.name} 국고 +${fmtGold(g)}금`, nations: [n.id] });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive && nationRegions(s, x.id).some((r) => s.regions[r].buildings.port)));
      if (!n) return;
      const ports = nationRegions(s, n.id).filter((r) => s.regions[r].buildings.port).length;
      const g = ports * 40 * G;
      n.gold += g;
      announce(s, { icon: '🚢', title: '교역 호황', story: `${n.name}의 항구마다 외국 상선이 몰려들었습니다.`, effect: `항구 ${ports}곳, 국고 +${fmtGold(g)}금`, nations: [n.id] });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive));
      const regs = nationRegions(s, n.id);
      const coast = regs.filter((r) => w.regions[r].coastal);
      if (!coast.length) return;
      const c = rng.pick(coast);
      const loss = Math.min(n.gold, 30 * G);
      n.gold -= loss;
      ruin(s, [c], 0.05, 0.1);
      announce(s, { icon: '🏴‍☠️', title: '해적 습격', story: `해적이 ${s.regions[c].name} 해안을 약탈했습니다.`, effect: `국고 -${fmtGold(loss)}금, 해당 지역 병력 -10%`, nations: [n.id] });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive));
      const regs = nationRegions(s, n.id).sort((a, b) => s.regions[a].loyalty - s.regions[b].loyalty);
      if (!regs.length || s.regions[regs[0]].loyalty > 55) return;
      const c = regs[0];
      ruin(s, [c], 0.05, 0.2);
      s.regions[c].loyalty = Math.max(0, s.regions[c].loyalty - 5);
      announce(s, { icon: '🗡️', title: '도적 창궐', story: `민심이 흉흉한 ${s.regions[c].name}에 도적떼가 들끓습니다.`, effect: '병력 -20%, 민심 -5', nations: [n.id] });
    },
  },
  {
    w: 2,
    run: (s, w, rng) => {
      const pool = landOwned(s).filter((i) => s.regions[i].loyalty >= 60);
      if (!pool.length) return;
      const c = rng.pick(pool);
      s.regions[c].pop *= 1.2;
      announce(s, { icon: '🧳', title: '유민 정착', story: `살기 좋다는 소문을 듣고 ${s.regions[c].name}으로 유민이 몰려왔습니다.`, effect: '인구 +20%', nations: [s.regions[c].owner] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive));
      for (const r of nationRegions(s, n.id)) s.regions[r].loyalty = Math.min(100, s.regions[r].loyalty + 6);
      announce(s, { icon: '🎉', title: '태평성대', story: `${n.name} 곳곳에서 풍악이 울립니다.`, effect: '전 지역 민심 +6', nations: [n.id] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive && x.capital !== null));
      const r = s.regions[n.capital];
      if (!r.buildings.market) return;
      r.buildings.market = 0;
      announce(s, { icon: '🔥', title: '도성 대화재', story: `${r.name}의 시장 거리가 불길에 휩싸였습니다.`, effect: '수도의 시장 소실', nations: [n.id] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive && nationGenerals(s, x.id).length));
      if (!n) return;
      const g = rng.pick(nationGenerals(s, n.id));
      gainExp(s, g, 80);
      announce(s, { icon: '📚', title: '스승을 만나다', story: `${g.name}이(가) 이름난 은자를 만나 가르침을 받았습니다.`, effect: `${g.name} 경험치 +80`, nations: [n.id] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive && x.reputation < 45));
      if (!n) return;
      const g = nationGenerals(s, n.id).filter((x) => x.id !== n.ruler && x.loyalty < 65).sort((a, b) => a.loyalty - b.loyalty)[0];
      if (!g) return;
      const others = s.nations.filter((x) => x.alive && x.id !== n.id && x.capital !== null);
      const to = rng.pick(others);
      g.nation = to.id;
      g.region = to.capital;
      g.loyalty = 55;
      announce(s, { icon: '🏃', title: '장수 출분', story: `평판이 떨어진 ${n.name}에 실망한 ${g.name}이(가) ${to.name}(으)로 떠났습니다.`, effect: `${g.name} → ${to.name}`, nations: [n.id, to.id] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive && x.gold >= 80 * G && x.capital !== null));
      if (!n) return;
      const troops = 8000;
      n.gold -= 60 * G;
      s.regions[n.capital].troops += troops;
      announce(s, { icon: '💂', title: '용병단 고용', story: `떠돌던 용병단이 ${n.name}의 깃발 아래 모였습니다.`, effect: `국고 -${fmtGold(60 * G)}금, 수도 병력 +${fmtTroops(troops)}`, nations: [n.id] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const pool = landOwned(s).filter((i) => w.regions[i].terrain === T.DESERT);
      if (!pool.length) return;
      const c = rng.pick(pool);
      ruin(s, [c], 0, 0.15);
      announce(s, { icon: '🏜️', title: '모래폭풍', story: `${s.regions[c].name}에 거센 모래바람이 불었습니다.`, effect: '병력 -15%', nations: [s.regions[c].owner] });
    },
  },
  {
    w: 1,
    run: (s, w, rng) => {
      const n = rng.pick(s.nations.filter((x) => x.alive));
      let sum = 0;
      for (const r of nationRegions(s, n.id)) {
        const reg = s.regions[r];
        if (reg.buildings.walls && reg.buildings.walls < WALL_MAX) {
          reg.buildings.walls = WALL_MAX;
          sum++;
        }
      }
      if (!sum) return;
      announce(s, { icon: '🧱', title: '성곽 대수리', story: `${n.name}의 백성들이 자진해서 성벽을 쌓았습니다.`, effect: `성벽 ${sum}곳 완전 복구`, nations: [n.id] });
    },
  },
];

export function runEvents(s, world, rng) {
  s.buffs = (s.buffs || []).filter((b) => b.until >= s.turn);
  if (rng() < 0.3) rng.weighted(EVENTS, (e) => e.w).run(s, world, rng);
}
