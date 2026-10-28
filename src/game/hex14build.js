// ───────── 삼국지14식 모드: 도시 시설 건설과 새 도시 세우기(축성) ─────────
import { fmtGold } from './format.js';
import { log } from './hex14.js';

// 시설: 이름, 아이콘, 금, 걸리는 턴(10일), 최대 단계, 설명
export const BUILDINGS = {
  farm: { name: '농지 개간', icon: '🌾', cost: 15000, turns: 4, max: 2, desc: '가을 수확 +20%/단계' },
  market: { name: '시장', icon: '🏪', cost: 15000, turns: 4, max: 2, desc: '금 수입 +20%/단계' },
  barracks: { name: '병영', icon: '⛺', cost: 20000, turns: 5, max: 1, desc: '자원병 +50%, 징병 비용 1명당 8금' },
  wall: { name: '성벽 증축', icon: '🧱', cost: 25000, turns: 6, max: 2, desc: '성벽 내구 +40%/단계' },
  smithy: { name: '대장간', icon: '⚒️', cost: 20000, turns: 5, max: 1, desc: '이 도시에서 나간 부대 공격 +10%' },
  shipyard: { name: '조선소', icon: '⛵', cost: 25000, turns: 6, max: 1, desc: '이 도시에서 나간 부대는 물 위에서도 약해지지 않음 (항구만)', port: true },
  academy: { name: '학당', icon: '📚', cost: 20000, turns: 5, max: 1, desc: '이 도시의 재야·포로 등용 +15%, 담당관 내정 +30%' },
};
export const FOUND_COST = 50000, FOUND_TURNS = 9;

export const lv = (c, k) => c.bld?.[k] || 0;
export const slotsOf = (c) => (c.kind === 'pass' ? 1 : c.capital ? 6 : c.founding ? 0 : 4);
export const usedSlots = (c) => Object.values(c.bld || {}).reduce((a, b) => a + b, 0) + (c.build ? 1 : 0);

export function canBuild(s, c, k) {
  const b = BUILDINGS[k];
  if (!b) return '없는 시설입니다.';
  if (c.founding) return '아직 공사 중인 도시입니다.';
  if (c.kind === 'pass' && k !== 'wall') return '관문에는 성벽만 쌓을 수 있습니다.';
  if (b.port && !c.port) return '항구에만 지을 수 있습니다.';
  if (c.build) return `이미 ${BUILDINGS[c.build.type].name}을(를) 짓는 중입니다.`;
  if (lv(c, k) >= b.max) return '더 올릴 수 없습니다.';
  if (usedSlots(c) >= slotsOf(c)) return `건설 칸이 다 찼습니다 (${slotsOf(c)}칸).`;
  if (s.nations[c.owner].gold < b.cost) return `금이 모자랍니다 (${fmtGold(b.cost)}).`;
  return null;
}

export function startBuild(s, cid, k) {
  const c = s.castles[cid];
  const why = canBuild(s, c, k);
  if (why) return { ok: false, msg: why };
  s.nations[c.owner].gold -= BUILDINGS[k].cost;
  c.build = { type: k, left: BUILDINGS[k].turns };
  return { ok: true, msg: `${c.name}: ${BUILDINGS[k].name} 공사 시작 (${BUILDINGS[k].turns}턴)` };
}

export function cancelBuild(s, cid) {
  const c = s.castles[cid];
  if (!c.build) return { ok: false, msg: '짓는 것이 없습니다.' };
  const back = Math.round(BUILDINGS[c.build.type].cost * 0.5);
  s.nations[c.owner].gold += back;
  c.build = null;
  return { ok: true, msg: `공사를 멈췄습니다 (금 ${fmtGold(back)} 돌려받음).` };
}

// 새 도시 자리: 내 땅, 지나갈 수 있는 칸, 다른 성과 4칸 이상 떨어짐
export const FOUND_GAP = 4;
export function foundCheck(s, grid, tile, nid) {
  if (tile < 0 || !grid.passable(tile)) return '도시를 세울 수 없는 땅입니다.';
  if (s.owner[tile] !== nid) return '내 땅에만 세울 수 있습니다.';
  const near = s.castles.find((c) => grid.dist(c.tile, tile) < FOUND_GAP);
  if (near) return `${near.name}과(와) 너무 가깝습니다 (${FOUND_GAP}칸 이상 떨어져야 함).`;
  if (s.units.some((u) => u.tile === tile)) return '부대가 서 있는 곳입니다.';
  if (s.nations[nid].gold < FOUND_COST) return `금이 모자랍니다 (${fmtGold(FOUND_COST)}).`;
  return null;
}

// 세울 수 있는 칸 모두 (금은 따지지 않음)
export function foundSpots(s, grid, nid) {
  const out = [];
  for (let t = 0; t < grid.N; t++) {
    if (!grid.passable(t) || s.owner[t] !== nid) continue;
    if (s.castles.some((c) => grid.dist(c.tile, t) < FOUND_GAP)) continue;
    out.push(t);
  }
  return out;
}

export function foundCity(s, grid, tile, nid, name) {
  const why = foundCheck(s, grid, tile, nid);
  if (why) return { ok: false, msg: why };
  s.nations[nid].gold -= FOUND_COST;
  const id = s.castles.length;
  const used = new Set(s.castles.map((c) => c.name));
  let nm = name || `${s.castles.reduce((a, c) => (grid.dist(c.tile, tile) < grid.dist(a.tile, tile) ? c : a)).name} 신성`;
  for (let k = 2; used.has(nm); k++) nm = `${name || '신성'} ${k}`;
  s.castles.push({ id, tile, region: grid.region[tile], name: nm, kind: 'city', owner: nid, troops: 500, dur: 300, maxDur: 1500, pop: 5, capital: false, bandit: null, port: grid.water.some((w, t) => w && grid.dist(t, tile) <= 3), devMax: 300, farm: 50, trade: 50, jobs: { farm: null, trade: null, draft: null }, auto: true, founding: FOUND_TURNS, bld: {} });
  log(s, `🏗️ ${s.nations[nid].name}이(가) ${nm}을(를) 세우기 시작했습니다 (${FOUND_TURNS}턴).`, 'info', [nid]);
  return { ok: true, msg: `${nm} 축성 시작! ${FOUND_TURNS}턴 뒤 완공됩니다.` };
}

// 한 턴마다: 공사 진행, 새 도시 완공 시 관할 다시 나눔
export function buildTurn(s, grid, redistrict) {
  let regrid = false;
  for (const c of s.castles) {
    if (c.owner === null) continue;
    if (c.founding) {
      c.founding -= 1;
      c.dur = Math.min(c.maxDur, c.dur + c.maxDur / FOUND_TURNS);
      if (c.founding <= 0) {
        delete c.founding;
        Object.assign(c, { pop: 20, devMax: 500, dur: c.maxDur });
        regrid = true;
        log(s, `🏯 ${c.name}이(가) 완공되었습니다!`, 'capture', [c.owner]);
      }
      continue;
    }
    if (!c.build) continue;
    // 정치 높은 담당관이 있으면 빨리 (학당이 있으면 더)
    c.build.left -= 1;
    if (c.build.left > 0) continue;
    const k = c.build.type;
    c.bld = { ...(c.bld || {}), [k]: lv(c, k) + 1 };
    c.build = null;
    if (k === 'wall') { const add = Math.round((c.kind === 'pass' ? 6000 : 3000) * 0.4); c.maxDur += add; c.dur += add; }
    if (k === 'farm' || k === 'market') c.devMax = Math.round(c.devMax * 1.1);
    log(s, `${BUILDINGS[k].icon} ${c.name}의 ${BUILDINGS[k].name}이(가) 완공되었습니다 (${lv(c, k)}단계).`, 'info', [c.owner]);
  }
  if (regrid) redistrict(s, grid);
}

// 컴퓨터: 금이 넉넉하면 도시 하나에 쓸모 있는 시설을 지음 (위협받는 곳은 성벽, 아니면 시장·농지·병영 순)
export function aiBuild(s, grid, nid, threat) {
  const n = s.nations[nid];
  if (n.gold < 40000) return;
  const mine = s.castles.filter((c) => c.owner === nid && !c.build && !c.founding);
  for (const c of mine.sort((a, b) => threat(b) - threat(a))) {
    const order = threat(c) > 0 ? ['wall', 'barracks', 'smithy'] : ['market', 'farm', 'barracks', 'academy', 'shipyard', 'smithy', 'wall'];
    for (const k of order) if (!canBuild(s, c, k)) { startBuild(s, c.id, k); return; }
  }
}
