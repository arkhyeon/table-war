import { stateRng } from './rng.js';
import { TERRAIN, TAX, DIFFICULTY } from './rules.js';
import { fmtTroops, fmtGold } from './format.js';
import { aiActions, aiDiplomacy, aiPrisoners, aiTaxPolicy } from './ai.js';
import { income, computeMaxAp, spawnGeneral, log, getRel, setRel, isVassalOf, nationRegions, gensIn, checkElimination, effTax, supplied, WALL_MAX, nationPower, gainExp, landCount, nationTrait, governorOf, governorBonus, buildResolveQueue, resolveAll, arriveReinforcements } from './engine.js';
import { tv } from './traits.js';
import { rollWeather, weatherOf } from './weather.js';
import { runEvents } from './events.js';
import { riseNations, fortune, syncFiefs, fiefLoyalty, spawnHorde, FIEF_TRIBUTE, endgame, promoteHordes, hordeDemands, fiefRequests } from './rise.js';
import { getScenario } from './scenarios.js';
import { yearOf, fmtYear } from './weather.js';

// 실제 역사 연표: 그 해가 되면 '실제로는 이랬다' 카드와 이 세계의 같은 나라 형편을 비교해서 보여줌
function historyNotes(s) {
  const scn = getScenario(s.scenarioId);
  if (!scn?.chronicle) return;
  const year = yearOf(s.turn, scn.startYear ?? 1);
  const list = [...scn.chronicle].sort((a, b) => a[0] - b[0]);
  const land = landCount(s);
  while ((s.chronIdx || 0) < list.length && list[s.chronIdx || 0][0] <= year) {
    const [y, text, who] = list[s.chronIdx || 0];
    s.chronIdx = (s.chronIdx || 0) + 1;
    const n = s.nations.find((x) => x.name === who) || s.nations.find((x) => x.name.includes(who));
    let now = '';
    if (n) {
      if (!n.alive) now = `이 세계의 ${n.name}: 이미 멸망했습니다.`;
      else {
        const cnt = nationRegions(s, n.id).length;
        const rank = s.nations.filter((o) => o.alive && nationRegions(s, o.id).length > cnt).length + 1;
        now = `이 세계의 ${n.name}: 영토 ${cnt}곳(${Math.round((cnt / land) * 100)}%, ${rank}위)${n.id === s.playerId ? ' — 당신의 나라' : ''}`;
      }
    }
    (s.turnEvents = s.turnEvents || []).push({ icon: '📜', title: `${fmtYear(y)} 실제 역사`, story: text, effect: now || '이 세계는 다른 길을 걷고 있습니다.', nations: n ? [n.id] : [], global: true, history: true });
    log(s, `📜 [실제 역사 ${fmtYear(y)}] ${text}`, n ? [n.id] : [], 'event');
  }
}
import { trackStats, checkAchievements } from './achievements.js';
import { updateExplored, encodeOwners } from './fog.js';
import { hashString } from './rng.js';

function revolt(s, world, rid, rng) {
  const r = s.regions[rid];
  const old = r.owner;
  const rebels = Math.max(Math.round(r.troops * 0.6), Math.round(r.pop * 150));
  const own = world.regions[rid].neighbors.map((x) => x.id).filter((x) => s.regions[x].owner === old && !s.regions[x].sea);
  for (const g of gensIn(s, rid, old)) g.region = own[0] ?? s.nations[old].capital;
  r.owner = null;
  r.troops = Math.round(rebels / 100) * 100;
  r.loyalty = 50;
  if (s.nations[old].capital === rid) {
    const rest = nationRegions(s, old);
    s.nations[old].capital = rest.sort((a, b) => s.regions[b].pop - s.regions[a].pop)[0] ?? null;
  }
  log(s, `🔥 ${r.name}에서 반란이 일어나 ${s.nations[old].name}의 지배에서 벗어났습니다! (반란군 ${fmtTroops(r.troops)})`, [old], 'warn');
  checkElimination(s, world, old);
}

// 세력 균형: 국력이 평균의 2배를 넘으면 주변국의 경계, 1위가 2.5배를 넘으면 대동맹 결성
function balanceOfPower(s, world) {
  const alive = s.nations.filter((n) => n.alive);
  if (alive.length < 3) return;
  const power = Object.fromEntries(alive.map((n) => [n.id, nationPower(s, n.id)]));
  const avg = Object.values(power).reduce((a, b) => a + b, 0) / alive.length;
  const threat = (id) => power[id] / Math.max(1, avg);
  for (const n of alive) {
    const t = threat(n.id);
    if (t <= 2) continue;
    const nbs = new Set();
    for (const r of nationRegions(s, n.id)) for (const nb of world.regions[r].neighbors) if (s.regions[nb.id].owner !== null) nbs.add(s.regions[nb.id].owner);
    for (const o of alive) {
      if (o.id === n.id || isVassalOf(s, o.id, n.id)) continue;
      s.opinion[o.id][n.id] -= Math.min(4, (t - 2) * 1.5) * (nbs.has(o.id) ? 1.5 : 1);
    }
  }
  const top = alive.reduce((a, b) => (power[b.id] > power[a.id] ? b : a));
  const prev = s.coalition?.target;
  // 대동맹은 20턴 넘게 버티면 내분으로 와해(위협이 압도적이면 유지), 이후 10턴은 재결성 불가
  if (s.coalition && s.turn - s.coalition.since >= 20 && threat(s.coalition.target) < 3.5) {
    log(s, `💢 오랜 전쟁에 지친 대동맹이 내분으로 와해되었습니다. ${s.nations[s.coalition.target].name}에게 기회가 왔습니다!`, s.nations.map((x) => x.id), 'diplo');
    delete s.coalition;
    s.coalitionCooldown = s.turn + 10;
    return;
  }
  if ((s.coalitionCooldown || 0) > s.turn) return;
  // 나라가 많은 지도에서 작은 1위에게까지 대동맹이 생기지 않도록 영토 비율 문턱(통일선의 40%)도 둠
  const topShare = nationRegions(s, top.id).length / landCount(s);
  if (threat(top.id) > (s.turn >= 30 ? 2.1 : 2.5) && topShare >= Math.max(0.2, (s.winShare || 0.6) * 0.4)) {
    if (prev !== top.id) {
      s.coalition = { target: top.id, since: s.turn };
      log(s, `⚔️ ${top.name}의 패권에 맞서 대동맹이 결성되었습니다! 각국이 ${top.name}을(를) 공동의 적으로 삼습니다.`, s.nations.map((x) => x.id), 'diplo');
    }
    const members = alive.filter((o) => o.id !== top.id && !o.horde && !isVassalOf(s, o.id, top.id) && getRel(s, o.id, top.id).type !== 'alliance');
    s.coalition.members = members.map((o) => o.id);
    for (const a of members) for (const b of members) if (a.id !== b.id) s.opinion[a.id][b.id] += 1;
    // 군자금 지원: 패권국과 맞닿지 않은 AI 회원국이 최전선 회원국에 국고의 6%를 보냄
    const front = members.filter((o) => nationRegions(s, o.id).some((r) => world.regions[r].neighbors.some((x) => s.regions[x.id].owner === top.id)));
    const rear = members.filter((o) => !o.isPlayer && !front.includes(o) && o.gold > 0);
    if (front.length && rear.length) {
      const pot = rear.reduce((a, o) => a + Math.floor(o.gold * 0.06), 0);
      for (const o of rear) o.gold -= Math.floor(o.gold * 0.06);
      const share = Math.floor(pot / front.length);
      for (const o of front) o.gold += share;
      const me = front.find((o) => o.isPlayer);
      if (me && share > 0) log(s, `💰 대동맹 후방국들이 ${me.name}에 군자금 ${fmtGold(share)}금을 보냈습니다.`, [me.id], 'diplo');
    }
  } else if (prev !== undefined && threat(prev) < 2) {
    log(s, `🕊️ ${s.nations[prev].name}에 대한 대동맹이 해체되었습니다.`, s.nations.map((x) => x.id), 'diplo');
    delete s.coalition;
  }
}

function upkeep(s, world) {
  const rng = stateRng(s);
  for (const n of s.nations) {
    if (!n.alive) continue;
    if (n.lost) n.lost = n.lost < 0.3 ? 0 : Math.round(n.lost * 0.85 * 100) / 100;
    const inc = income(s, n.id);
    let net = inc.net;
    if (!n.isPlayer && inc.gross > 0) net += Math.round(inc.gross * (DIFFICULTY[s.opts?.difficulty]?.tax || 0));
    const lord = s.nations.find((o) => o.alive && isVassalOf(s, n.id, o.id));
    if (lord && inc.gross > 0) {
      const tribute = Math.round(inc.gross * (n.fief ? FIEF_TRIBUTE : 0.25));
      net -= tribute;
      lord.gold += tribute;
    }
    n.gold = Math.round(n.gold + net);
    if (n.gold < 0) {
      // 국고가 바닥나면 녹봉을 못 받은 만큼(1명당 1금) 병사가 탈영
      const unpaid = -n.gold;
      n.gold = 0;
      const total = s.regions.reduce((a, r) => a + (r.owner === n.id ? r.troops : 0), 0);
      const frac = Math.min(0.95, unpaid / Math.max(1, total));
      let gone = 0;
      for (const r of s.regions) if (r.owner === n.id) { const d = Math.floor((r.troops * frac) / 100) * 100; r.troops = Math.max(100, r.troops - d); gone += d; }
      log(s, `💸 ${n.name}의 국고가 바닥나 녹봉을 못 받은 병사 ${fmtTroops(gone)}이(가) 탈영했습니다.`, [n.id], 'warn');
    }
  }
  // 위기 판단: 영토를 잃었거나 수도 주변 적병이 수도 수비대보다 많으면 '나라가 위태로움'
  const danger = {};
  for (const n of s.nations) {
    if (!n.alive) continue;
    const count = nationRegions(s, n.id).length;
    let d = n.lastCount !== undefined && count < n.lastCount;
    if (n.capital !== null) {
      let enemy = 0;
      for (const nb of world.regions[n.capital].neighbors) {
        const t = s.regions[nb.id];
        if (t.owner !== null && t.owner !== n.id && getRel(s, n.id, t.owner).type === 'none') enemy += t.troops;
      }
      if (enemy > s.regions[n.capital].troops * 1.2) d = true;
    }
    danger[n.id] = d;
    n.lastCount = count;
  }
  const volunteers = {};
  const supply = {};
  const sizes = {};
  for (const r of s.regions) if (r.owner !== null && !r.sea) sizes[r.owner] = (sizes[r.owner] || 0) + 1;
  const land = landCount(s);
  for (const n of s.nations) if (n.alive) supply[n.id] = supplied(s, world, n.id);
  for (let i = 0; i < s.regions.length; i++) {
    const r = s.regions[i];
    const w = weatherOf(s, i);
    if (r.sea) {
      // 바다의 함대: 보급 손실과 폭풍 피해
      if (r.owner !== null && r.troops > 0) {
        const loss = (w.seaLoss ?? 0.02) * (1 - tv(gensIn(s, i, r.owner), '항해'));
        r.troops = Math.round((r.troops * (1 - loss)) / 100) * 100;
        if (r.troops <= 0) {
          r.troops = 0;
          r.owner = null;
        }
      }
      continue;
    }
    const tax = r.owner === null ? TAX.normal : TAX[effTax(s, i)];
    const gens = r.owner === null ? [] : gensIn(s, i, r.owner);
    const df = s.df || 1;
    const cap = (((TERRAIN[world.regions[i].terrain].pop || 10) * 1.6 + (r.buildings.market ? 8 : 0)) * (r.plain ? 1.3 : 1)) / df;
    if (r.pop < cap && !w.noGrowth) r.pop = Math.min(cap, r.pop * (1 + 0.025 * tax.growth * (1 + tv(gens, '농정'))) + (0.3 * tax.growth) / df);
    if (r.buildings.walls > 0 && r.buildings.walls < WALL_MAX && r.siegedTurn !== s.turn) r.buildings.walls = Math.min(WALL_MAX, r.buildings.walls + 1 + (tv(gens, '축성') ? 1 : 0));
    r.pop = Math.round(r.pop * 10) / 10;
    r.conscripted = false;
    if (r.owner === null) {
      if (s.turn % 3 === 0 && r.troops < 12000 / (s.df || 1)) r.troops += Math.max(100, Math.round(1000 / (s.df || 1) / 100) * 100);
      continue;
    }
    // 민심: 매 턴 회복, 세율·주둔군·수도·인덕 장수 반영
    const garrison = r.troops >= 3000 ? 2 : 0;
    const isCap = s.nations[r.owner].capital === i ? 3 : 0;
    // 보급이 끊긴 지역: 병력 1~10% 감소, 민심 하락
    const cut = !supply[r.owner]?.has(i);
    if (cut) r.troops = Math.max(100, Math.round((r.troops * (1 - rng.int(1, 10) / 100 * (1 - tv(gens, '보급')))) / 100) * 100);
    // 대제국일수록 통치 부담: 지도 대비 영토 비율로(큰 지도에서 과하지 않게), 전 육지의 1/8마다 -1
    // 통치 부담은 내륙(국경에 닿지 않은 곳)만, 상한 -5. 국경은 전쟁 중이니 민심이 덜 흔들리고, 내륙은 진휼로 관리
    const inner = world.regions[i].neighbors.every((x) => s.regions[x.id].sea || s.regions[x.id].owner === r.owner);
    const sprawl = inner ? Math.min(5, Math.floor(((sizes[r.owner] || 0) / land) * 8)) : 0;
    // 계엄: 인구 대비 대군이 주둔하면 반란은 막지만 민심 회복이 더디다
    const martial = r.troops >= r.pop * 250;
    r.loyalty = Math.max(0, Math.min(100, (r.loyalty ?? 100) + 3 + tax.loyalty + garrison + isCap + w.loyalty + tv(gens, '인덕') + governorBonus(governorOf(s, i)).loyalty + (r.plain ? 1 : 0) - (cut ? 3 : 0) - sprawl - (martial ? 1 : 0)));
    if (!martial && r.loyalty < 25 && rng() < ((25 - r.loyalty) / 70) * (1 - tv(gens, '치안'))) revolt(s, world, i, rng);
    // 자원병: 민심이 높으면 스스로 입대, 나라가 위태로우면 더 많이 (민심 영향 없음)
    const minLoy = danger[r.owner] ? 40 : 60;
    if (r.loyalty >= minLoy && !cut && !s.nations[r.owner].horde) {
      const rate = (r.loyalty >= 80 ? 0.004 : 0.0025) * (danger[r.owner] ? 4 : 1) * (1 + tv(gens, '모병'));
      const v = Math.floor((r.pop * 1000 * rate) / 100) * 100;
      if (v > 0) {
        r.troops += v;
        volunteers[r.owner] = (volunteers[r.owner] || 0) + v;
      }
    }
    // 문관은 다스리며 성장, 무관은 병영에서 훈련
    for (const g of gens) {
      const govern = Math.max(0, (g.pol - 40) / 6) * (g.role === 'civ' ? 1.5 : 1);
      const drill = r.buildings.barracks && g.role !== 'civ' ? 3 : 0;
      if (govern + drill >= 1) gainExp(s, g, govern + drill);
    }
  }
  for (const [nid, v] of Object.entries(volunteers)) {
    if (+nid === s.playerId && !s.spectator) log(s, `🙋 ${s.nations[nid].name}${danger[nid] ? '이(가) 위기에 처하자 백성들이 앞다퉈' : '에'} 자원 입대했습니다. (총 +${fmtTroops(v)})`, [+nid], 'info');
  }
  for (const n of s.nations) if (n.alive) spawnGeneral(s, n.id, rng);
  balanceOfPower(s, world);
  for (const [k, rel] of Object.entries(s.relations)) {
    if (rel.type === 'nap' && rel.until <= s.turn) {
      const [a, b] = k.split('-').map(Number);
      setRel(s, a, b, null);
      log(s, `📜 ${s.nations[a].name}과(와) ${s.nations[b].name}의 불가침 조약이 만료되었습니다.`, [a, b], 'diplo');
    }
  }
  s.joint = s.joint.filter((j) => j.until > s.turn);
  for (const a of s.nations) {
    if (!a.alive) continue;
    for (const b of s.nations) {
      if (a.id === b.id || !b.alive) continue;
      let o = s.opinion[a.id][b.id];
      o += o > 0 ? -0.5 : 0.5;
      if (getRel(s, a.id, b.id).type === 'alliance') o += 1;
      s.opinion[a.id][b.id] = Math.max(-100, Math.min(100, o));
    }
    if (a.reputation < 60) a.reputation += 1;
    const fame = nationTrait(s, a.id, '명망');
    if (fame && a.reputation < 80) a.reputation = Math.min(80, a.reputation + fame);
    a.maxAp = computeMaxAp(s, a.id);
    a.ap = Math.max(1, a.maxAp - (a.apPenalty || 0));
    a.apPenalty = 0;
    if (a.grudge !== undefined && rng.chance(0.15)) delete a.grudge;
  }
}

export function checkGameOver(s) {
  const p = s.nations[s.playerId];
  if (!p.alive) return { win: false, text: `${p.name}이(가) 멸망했습니다.` };
  // 속국의 땅도 내 판도로 셈
  const owned = s.nations.filter((n) => n.alive && (n.id === s.playerId || isVassalOf(s, n.id, s.playerId))).reduce((a, n) => a + nationRegions(s, n.id).length, 0);
  // 승리: 육지 100% (s.winShare는 컴퓨터의 견제·확장 속도 기준으로만 씀)
  if (owned >= landCount(s)) return { win: true, text: '모든 땅을 차지해 천하를 통일했습니다!' };
  // 8할을 차지하면 여기서 끝낼지 한 번 물음
  if (!s.asked80 && owned / landCount(s) >= 0.8) return { win: true, partial: true, text: `천하의 ${Math.floor((owned / landCount(s)) * 100)}%를 차지했습니다! 여기서 통일을 선언하고 끝낼 수도, 끝까지 싸울 수도 있습니다.` };
  const rivals = s.nations.filter((n) => n.alive && n.id !== s.playerId && !isVassalOf(s, n.id, s.playerId));
  if (!rivals.length) return { win: true, text: '모든 국가가 멸망하거나 당신의 속국이 되었습니다!' };
  return null;
}

// 턴 종료 1단계: 컴퓨터들도 이동 계획을 세움 (플레이어 계획으로 빠져나간 병력은 모르는 채로)
// 턴 요약용: 플레이어의 영토·병력·국고
export function playerStat(s) {
  const pid = s.playerId;
  let regions = 0, troops = 0;
  for (const r of s.regions) if (r.owner === pid) { troops += r.troops; if (!r.sea) regions++; }
  for (const o of s.orders || []) if (o.n === pid) troops += o.count;
  for (const o of s.reinforce || []) if (o.n === pid) troops += o.count;
  return { regions, troops, gold: s.nations[pid].gold, gens: Object.values(s.generals).filter((g) => g.status === 'active' && g.nation === pid).length };
}

export function endTurnPlan(s, world) {
  s.prevStat = playerStat(s);
  s.turnNews = [];
  s.turnEvents = [];
  s.battles = [];
  s.moves = [];
  for (const r of s.regions) delete r.moved;
  const mine = (s.orders || []).filter((o) => s.nations[o.n]?.isPlayer);
  const hide = (sign) => {
    for (const o of mine) {
      const fr = s.regions[o.from];
      fr.troops += sign * o.count;
      if (fr.sea) fr.owner = fr.troops > 0 ? o.n : null;
    }
  };
  hide(1);
  syncFiefs(s);
  const rng = stateRng(s);
  const order = rng.shuffle(s.nations.filter((n) => n.alive && !n.isPlayer).map((n) => n.id));
  for (const id of order) {
    if (!s.nations[id].alive) continue;
    aiTaxPolicy(s, id);
    aiDiplomacy(s, world, id);
    aiPrisoners(s, id);
    aiActions(s, world, id);
  }
  hide(-1);
  buildResolveQueue(s);
}

// 턴 종료 3단계: 경제·사건·다음 턴 준비
export function endTurnFinish(s, world) {
  s.orders = [];
  s.resolveQueue = [];
  // 전투 직후 100%를 채웠다면 턴 끝 반란·부흥과 상관없이 승리
  const early = s.spectator || s.sandbox ? null : checkGameOver(s);
  upkeep(s, world);
  // 새 턴: 모든 부대가 다시 움직일 수 있음
  for (const r of s.regions) delete r.moved;
  riseNations(s, world, stateRng(s));
  fortune(s, world, stateRng(s));
  spawnHorde(s, world, stateRng(s));
  fiefLoyalty(s, world, stateRng(s));
  endgame(s, world, stateRng(s));
  promoteHordes(s, world, stateRng(s));
  hordeDemands(s, world, stateRng(s));
  fiefRequests(s, world, stateRng(s));
  (s.history = s.history || []).push(encodeOwners(s));
  s.turn += 1;
  arriveReinforcements(s);
  s.weather = rollWeather(world, s.turn, hashString(String(s.seed)) & 0xffff);
  runEvents(s, world, stateRng(s));
  historyNotes(s);
  updateExplored(s, world);
  s.gameOver = early?.win ? early : s.spectator || (s.sandbox && s.nations[s.playerId].alive) ? null : checkGameOver(s);
  if (!s.spectator) {
    trackStats(s);
    s.newAchieve = checkAchievements(s, !!s.gameOver?.win);
  }
  return s;
}

// 한 번에: 계획 → 동시 처리(일기토 자동) → 마무리 (관전·시뮬레이션용)
export function endTurn(s, world) {
  endTurnPlan(s, world);
  resolveAll(s, world);
  return endTurnFinish(s, world);
}
