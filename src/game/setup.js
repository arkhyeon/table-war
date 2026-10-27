import { makeRng, hashString } from './rng.js';
import { T, G, DIFFICULTY } from './rules.js';
import { CIVS, RANDOM_CIVS, makeNamer } from './civs.js';
import { POOLS, parseGeneral, rating } from './generals.js';
import { addGeneral, computeMaxAp, nationPower, spawnGeneral } from './engine.js';
import { rollWeather } from './weather.js';
import { detailFactor } from './mapgen.js';
import { assignRealNames } from './places.js';
import { updateExplored, encodeOwners } from './fog.js';

export const colorFor = (i) => `hsl(${Math.round((i * 137.508 + 20) % 360)}, ${58 + (i % 3) * 10}%, ${46 + ((i * 7) % 3) * 6}%)`;

// 시나리오/시드 → 국가 목록(미리보기용)
export function planNations(world, scn, seed, opts = {}) {
  const rng = makeRng(`nations:${scn.id}:${seed}`);
  let list;
  if (scn.procedural) {
    const count = opts.nationCount || 8;
    const civs = rng.shuffle(RANDOM_CIVS.slice());
    const caps = [];
    // 수도 후보: 육지이면서 지역 5곳 이상인 땅덩어리에 속한 곳 (바다 구역·작은 섬 제외)
    const mass = new Array(world.regions.length).fill(-1);
    const massSize = [];
    for (const r of world.regions) {
      if (r.sea || mass[r.id] >= 0) continue;
      const q = [r.id];
      mass[r.id] = massSize.length;
      for (let k = 0; k < q.length; k++) for (const nb of world.regions[q[k]].neighbors) if (!world.regions[nb.id].sea && mass[nb.id] < 0) { mass[nb.id] = mass[r.id]; q.push(nb.id); }
      massSize.push(q.length);
    }
    const regs = world.regions.filter((r) => !r.sea && r.cells.length >= 4 && massSize[mass[r.id]] >= 4);
    // 섬나라 보장: 본토 다음으로 큰 섬에 한 나라를 먼저 둔다
    const main = massSize.indexOf(Math.max(...massSize));
    const isles = regs.filter((r) => mass[r.id] !== main);
    if (isles.length && count > 2) {
      const big = isles.reduce((a, b) => (massSize[mass[b.id]] > massSize[mass[a.id]] ? b : a));
      const on = isles.filter((r) => mass[r.id] === mass[big.id]);
      caps.push(on.reduce((a, b) => (b.cells.length > a.cells.length ? b : a)));
    }
    for (let i = caps.length; i < count && regs.length; i++) {
      let best = null, bd = -1;
      for (let k = 0; k < 60; k++) {
        const r = rng.pick(regs);
        const d = caps.length ? Math.min(...caps.map((c) => Math.hypot(c.cx - r.cx, c.cy - r.cy))) : rng();
        if (d > bd && !caps.includes(r)) { bd = d; best = r; }
      }
      caps.push(best);
    }
    list = caps.map((r, i) => {
      const civ = civs[i % civs.length];
      const names = CIVS[civ].nations;
      return { name: names[Math.floor(i / civs.length) % names.length] || `${CIVS[civ].name}${i}`, civ, region: r.id, size: rng.int(3, 6), capital: null, ruler: null, pools: [civ] };
    });
    // 섬나라는 맨 뒤로 (기본 선택이 늘 섬나라가 되지 않게)
    if (list.length > 1) list.push(list.shift());
  } else {
    // 수도 배치: 모든 (국가, 지역) 쌍을 거리순으로 정렬해 가까운 것부터 짝지음 → 연쇄로 밀려나는 일 방지
    const pairs = [];
    scn.nations.forEach((n, i) => {
      const [x, y] = world.toPx(n.lon, n.lat);
      const best = new Map();
      for (let c = 0; c < world.N; c++) {
        const r = world.region[c];
        if (r < 0) continue;
        const [cx, cy] = world.center(c);
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (!best.has(r) || d < best.get(r)) best.set(r, d);
      }
      // 가장 가까운 칸까지 거리 + 지역 중심까지 거리(큰 지역 하나에 두 수도가 몰릴 때 중심에 가까운 쪽이 차지)
      const score = ([r, d]) => Math.sqrt(d) + 0.6 * Math.hypot(world.regions[r].cx - x, world.regions[r].cy - y);
      [...best.entries()].map((e) => [e[0], score(e)]).sort((a, b) => a[1] - b[1]).slice(0, 12).forEach(([r, d]) => pairs.push([d, i, r]));
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const capOf = new Array(scn.nations.length).fill(-1);
    const taken = new Set();
    for (const [, i, r] of pairs) {
      if (capOf[i] >= 0 || taken.has(r)) continue;
      capOf[i] = r;
      taken.add(r);
    }
    list = scn.nations.map((n, i) => {
      let region = capOf[i];
      if (region < 0) {
        const [x, y] = world.toPx(n.lon, n.lat);
        region = world.nearestRegion(x, y, (id) => !taken.has(id));
        taken.add(region);
      }
      return { ...n, region, pools: n.pools || [n.civ] };
    });
  }
  return list.map((n, i) => ({ ...n, id: i, color: colorFor(i) }));
}

export function createGame(world, scn, seed, playerId, opts = {}, appearHistory = {}) {
  const rng = makeRng(`game:${scn.id}:${seed}`);
  const plan = planNations(world, scn, seed, opts);
  // 지도가 잘게 나뉠수록 나라가 처음 차지하는 지역 수도 비례해서 늘림
  const df = detailFactor(world.detail);
  for (const n of plan) n.size0 = n.size;
  if (df !== 1) for (const n of plan) n.size = Math.max(1, Math.round(n.size * df));
  // 세계 지도: 나라들이 육지의 일정 비율을 채우도록 키움 (회색 중립 땅만 휑하게 남지 않게)
  // 세계판 지역사는 무대 바깥의 나라(filler)만 키움
  if (scn.fill) {
    const fb = world.focusBox;
    const inFocus = (r) => fb && r.cx >= fb[0] && r.cx <= fb[0] + fb[2] && r.cy >= fb[1] && r.cy <= fb[1] + fb[3];
    const grow = plan.filter((n) => !scn.focus || n.filler);
    const room = world.regions.filter((r) => !r.sea && !inFocus(r)).length * scn.fill;
    const sum = grow.reduce((a, n) => a + n.size, 0);
    const k = room / Math.max(1, sum);
    if (k > 1) for (const n of grow) n.size = Math.round(n.size * k);
  }
  for (const [i, nm] of Object.entries(opts.names || {})) if (plan[i] && nm.trim()) plan[i].name = nm.trim().slice(0, 16);
  const R = world.regions.length;
  const owner = new Array(R).fill(null);
  plan.forEach((n) => (owner[n.region] = n.id));
  // 라운드 로빈으로 영토 확장
  const counts = plan.map(() => 1);
  for (let round = 0; round < Math.max(12 * Math.max(1, Math.ceil(df)), ...plan.map((n) => n.size + 2)); round++) {
    let grew = false;
    for (const n of plan) {
      if (counts[n.id] >= n.size) continue;
      const cap = world.regions[n.region];
      let best = null, bd = Infinity;
      for (let r = 0; r < R; r++) {
        if (owner[r] !== n.id) continue;
        for (const nb of world.regions[r].neighbors) {
          if (owner[nb.id] !== null || world.regions[nb.id].sea || nb.type === 'strait') continue;
          const t = world.regions[nb.id];
          const d = Math.hypot(t.cx - cap.cx, t.cy - cap.cy) + rng() * 10;
          if (d < bd) { bd = d; best = nb.id; }
        }
      }
      if (best !== null) {
        owner[best] = n.id;
        counts[n.id]++;
        grew = true;
      }
    }
    if (!grew) break;
  }
  // 지명: 역사 지도는 실제 지명 사전에서 그 시대 이름을, 나머지는 문명 음절로 지은 이름 (역사 지도는 시드와 무관하게 고정)
  const namer = makeNamer(makeRng(`names:${scn.id}:${scn.procedural ? seed : 'fixed'}`));
  const real = world.geo ? assignRealNames(world, scn.startYear ?? 1, new Set(plan.map((n) => n.capital).filter(Boolean))) : {};
  const regions = world.regions.map((wr, i) => {
    if (wr.sea) return { name: '', sea: true, owner: null, troops: 0, pop: 0, buildings: {}, loyalty: 100 };
    const river = !!wr.river;
    let civ;
    if (owner[i] !== null) civ = plan[owner[i]].civ;
    else {
      let bd = Infinity;
      for (const n of plan) {
        const c = world.regions[n.region];
        const d = Math.hypot(c.cx - wr.cx, c.cy - wr.cy);
        if (d < bd) { bd = d; civ = n.civ; }
      }
    }
    const isCap = plan.find((n) => n.region === i);
    // 역사적으로 강했던 나라는 power로 초기 병력 보정 (시나리오에서 지정)
    // 빈 땅의 토착 세력: 대부분 4.5천~1만, 가끔(15%) 2~3배 강한 토호의 산채
    const strong = owner[i] === null && rng() < 0.15;
    const troops = Math.max(5, Math.round((owner[i] === null ? (rng.int(45, 100) + (wr.terrain === T.MOUNTAIN ? 30 : 0)) * (strong ? rng.range(2, 3) : 1) : rng.int(50, 90) * (plan[owner[i]].power || 1)) / df)) * 100;
    return {
      name: isCap && isCap.capital ? isCap.capital : real[i] || namer(civ),
      owner: owner[i],
      troops,
      pop: Math.round((wr.pop / df) * 10) / 10,
      buildings: { market: 0, walls: 0, port: 0, barracks: 0 },
      conscripted: false,
      loyalty: owner[i] === null ? 50 : 80,
      river,
    };
  });
  // 바다 이름: 가장 가까운 해안 지역 이름을 따서
  world.regions.forEach((wr, i) => {
    if (!wr.sea) return;
    const coasts = wr.neighbors.filter((n) => n.type === 'landing' || n.type === 'cliff').map((n) => world.regions[n.id]);
    const near = coasts.sort((a, b) => Math.hypot(a.cx - wr.cx, a.cy - wr.cy) - Math.hypot(b.cx - wr.cx, b.cy - wr.cy))[0];
    regions[i].name = near ? `${regions[near.id].name} 앞바다` : '먼바다';
  });
  const s = {
    version: 5,
    scenarioId: scn.id,
    seed,
    opts,
    winShare: scn.winShare || 0.6,
    df,
    turn: 1,
    rs: hashString(`play:${scn.id}:${seed}`) | 0,
    playerId,
    nations: [],
    regions,
    generals: {},
    usedGen: {},
    appearHistory: { ...appearHistory },
    relations: {},
    opinion: [],
    joint: [],
    proposals: [],
    tried: {},
    log: [],
    gameOver: null,
    buffs: [],
    battles: [],
    history: [],
  };
  for (const n of plan) {
    const capReg = regions[n.region];
    capReg.troops = Math.round(((12 + n.size0 * 2) * 1000 * (n.power || 1) * (n.id === playerId && !opts.spectator ? 1 : DIFFICULTY[opts.difficulty]?.troops || 1)) / 100) * 100;
    capReg.loyalty = 100;
    capReg.buildings.walls = 3;
    capReg.buildings.market = 1;
    if (world.regions[n.region].coastal) capReg.buildings.port = 1;
    s.nations.push({
      id: n.id,
      name: n.name,
      color: n.color,
      civ: n.civ,
      pools: n.pools,
      capital: n.region,
      gold: 100 * G,
      ap: 0,
      maxAp: 0,
      reputation: 60,
      taxRate: 'normal',
      alive: true,
      isPlayer: n.id === playerId && !opts.spectator,
      aggression: Math.round(rng.range(0.35, 0.95) * 100) / 100,
      ruler: null,
    });
  }
  // 군주 배치
  for (const n of plan) {
    let data;
    if (n.ruler) {
      data = parseGeneral(n.ruler, `ruler_${n.id}`);
      for (const list of Object.values(POOLS)) {
        const dup = list.find((g) => g.name === data.name);
        if (dup) s.usedGen[dup.id] = 1;
      }
    } else {
      const cands = (POOLS[n.civ] || []).filter((g) => !s.usedGen[g.id]);
      data = rng.weighted(cands, (g) => rating(g) / (1 + (appearHistory[g.id] || 0) * 0.5)) || parseGeneral(`${n.name} 왕|60|60|60|60|정치`, `ruler_${n.id}`);
    }
    const g = addGeneral(s, data, n.id, n.region, rng, true);
    g.loyalty = 100;
    s.nations[n.id].ruler = g.id;
  }
  const N = plan.length;
  for (let a = 0; a < N; a++) {
    s.opinion.push([]);
    for (let b = 0; b < N; b++) s.opinion[a].push(a === b ? 0 : rng.int(-10, 10));
  }
  for (const n of s.nations) {
    n.maxAp = computeMaxAp(s, n.id);
    n.ap = n.maxAp;
  }
  // 업적용 시작 기록: 국력 순위, 섬 출발 여부
  const pw = s.nations.map((x) => nationPower(s, x.id));
  const isl = (() => {
    const seen = new Set([s.nations[playerId].capital]);
    const q = [...seen];
    for (let k = 0; k < q.length; k++) for (const nb of world.regions[q[k]].neighbors) if (!world.regions[nb.id].sea && !seen.has(nb.id)) { seen.add(nb.id); q.push(nb.id); }
    return seen.size < world.landCount * 0.15;
  })();
  s.stats = { startRank: pw.filter((v) => v > pw[playerId]).length, startCount: pw.length, startIsland: isl };
  s.opts = { revealMap: true, revealTroops: false, rememberExplored: true, showBattles: true, ...opts };
  delete s.opts.names;
  if (opts.spectator) s.spectator = true;
  s.weather = rollWeather(world, 1, hashString(String(seed)) & 0xffff);
  s.history.push(encodeOwners(s));
  updateExplored(s, world);
  // 중원(대평야): 수도 위치로 '가운데' 나라를 고름 — 사방(4방향 중 3방향 이상)에 다른 나라가 있고,
  // 다른 수도들까지 거리 합이 가장 작은 나라들(나라 6개당 1곳). 인재가 모이고(장수 +2) 병력 +25%,
  // 그 나라의 시작 땅은 대평야(세금 +20%·인구 상한 +30%·민심 +1/턴, 주인이 바뀌어도 유지)
  const caps = s.nations.filter((n) => n.capital !== null).map((n) => ({ n, c: world.regions[n.capital] }));
  const around = caps.map(({ n, c }) => {
    const quad = new Set();
    let sum = 0;
    for (const o of caps) {
      if (o.n.id === n.id) continue;
      const dx = o.c.cx - c.cx, dy = o.c.cy - c.cy;
      sum += Math.hypot(dx, dy);
      quad.add(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N');
    }
    return { n, mine: s.regions.map((r, i) => i).filter((i) => s.regions[i].owner === n.id), k: quad.size, sum };
  });
  const pickN = Math.max(1, Math.round(caps.length / 6));
  const chosen = new Set(around.filter((a) => a.k >= 3).sort((a, b) => a.sum - b.sum).slice(0, pickN).map((a) => a.n.id));
  for (const { n, mine } of around) {
    if (!chosen.has(n.id) || mine.length < 2) continue;
    n.heartland = true;
    for (const i of mine) {
      const r = s.regions[i];
      r.plain = true;
      r.pop = Math.round(r.pop * 1.3 * 10) / 10;
      r.troops = Math.round((r.troops * 1.25) / 100) * 100;
    }
    for (let q = 0; q < 2; q++) spawnGeneral(s, n.id, rng, true);
    s.log.push({ turn: 1, text: `🌾 ${n.name}: 사방에 적을 둔 중원의 나라 — 인재가 모여 장수 +2, 병력 +25%, 시작 땅이 대평야(세금 +20%·인구 +30%·민심 +1/턴)입니다.`, nations: [n.id], kind: 'info' });
  }
  s.log.unshift({ turn: 1, text: `🎌 ${scn.name} — ${s.nations[playerId].name}(으)로 천하통일을 시작합니다.${scn.procedural ? ` (시드: ${seed})` : ''}`, nations: [playerId], kind: 'info' });
  return s;
}
