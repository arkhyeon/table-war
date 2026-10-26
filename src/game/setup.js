import { makeRng, hashString } from './rng.js';
import { T, G } from './rules.js';
import { CIVS, RANDOM_CIVS, makeNamer } from './civs.js';
import { POOLS, parseGeneral, rating } from './generals.js';
import { addGeneral, computeMaxAp } from './engine.js';
import { rollWeather } from './weather.js';
import { updateExplored, encodeOwners } from './fog.js';

const colorFor = (i) => `hsl(${Math.round((i * 137.508 + 20) % 360)}, ${58 + (i % 3) * 10}%, ${46 + ((i * 7) % 3) * 6}%)`;

// 시나리오/시드 → 국가 목록(미리보기용)
export function planNations(world, scn, seed, opts = {}) {
  const rng = makeRng(`nations:${scn.id}:${seed}`);
  let list;
  if (scn.procedural) {
    const count = opts.nationCount || 8;
    const civs = rng.shuffle(RANDOM_CIVS.slice());
    const caps = [];
    const regs = world.regions.filter((r) => r.cells.length >= 4);
    for (let i = 0; i < count && regs.length; i++) {
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
  } else {
    const taken = new Set();
    list = scn.nations.map((n) => {
      const [x, y] = world.toPx(n.lon, n.lat);
      const region = world.nearestRegion(x, y, (id) => !taken.has(id));
      taken.add(region);
      return { ...n, region, pools: n.pools || [n.civ] };
    });
  }
  return list.map((n, i) => ({ ...n, id: i, color: colorFor(i) }));
}

export function createGame(world, scn, seed, playerId, opts = {}, appearHistory = {}) {
  const rng = makeRng(`game:${scn.id}:${seed}`);
  const plan = planNations(world, scn, seed, opts);
  for (const [i, nm] of Object.entries(opts.names || {})) if (plan[i] && nm.trim()) plan[i].name = nm.trim().slice(0, 16);
  const R = world.regions.length;
  const owner = new Array(R).fill(null);
  plan.forEach((n) => (owner[n.region] = n.id));
  // 라운드 로빈으로 영토 확장
  const counts = plan.map(() => 1);
  for (let round = 0; round < 12; round++) {
    let grew = false;
    for (const n of plan) {
      if (counts[n.id] >= n.size) continue;
      const cap = world.regions[n.region];
      let best = null, bd = Infinity;
      for (let r = 0; r < R; r++) {
        if (owner[r] !== n.id) continue;
        for (const nb of world.regions[r].neighbors) {
          if (owner[nb.id] !== null || world.regions[nb.id].sea) continue;
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
  const namer = makeNamer(rng);
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
    const troops = (owner[i] === null ? rng.int(20, 70) + (wr.terrain === T.MOUNTAIN ? 30 : 0) : rng.int(50, 90)) * 100;
    return {
      name: isCap && isCap.capital ? isCap.capital : namer(civ),
      owner: owner[i],
      troops,
      pop: wr.pop,
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
    capReg.troops = (12 + n.size * 2) * 1000;
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
    const g = addGeneral(s, data, n.id, n.region, rng);
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
  s.opts = { revealMap: true, revealTroops: false, rememberExplored: true, showBattles: true, turnsPerSeason: 2, ...opts };
  delete s.opts.names;
  if (opts.spectator) s.spectator = true;
  s.weather = rollWeather(world, 1, hashString(String(seed)) & 0xffff, s.opts.turnsPerSeason);
  s.history.push(encodeOwners(s));
  updateExplored(s, world);
  s.log.unshift({ turn: 1, text: `🎌 ${scn.name} — ${s.nations[playerId].name}(으)로 천하통일을 시작합니다. (시드: ${seed})`, nations: [playerId], kind: 'info' });
  return s;
}
