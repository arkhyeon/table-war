// ───────── 삼국지14식 모드: 충성·배신, 나이·수명, 계략 (가볍게: 포상은 한 번에, 계략은 버튼 셋) ─────────
import { makeRng } from './rng.js';
import { fmtGold } from './format.js';
import { log, enemy } from './hex14.js';
import { addRel, powerOf } from './hex14gov.js';

// 처음: 충성과 나이를 정함 (군주는 늘 100)
export function initPeople(s, rng) {
  for (const g of Object.values(s.generals)) {
    if (g.loyal === undefined) g.loyal = g.ruler ? 100 : Math.round(60 + rng() * 35);
    if (g.age === undefined) g.age = Math.round(22 + rng() * 33);
  }
}
export const loyalOf = (g) => (g.ruler ? 100 : Math.round(g.loyal ?? 70));

// 포상: 장수 1명당 금 1천, 모두 충성 +12
export const rewardCost = (s, nid) => Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && !g.ruler).length * 1000;
export function rewardAll(s, nid) {
  const n = s.nations[nid], cost = rewardCost(s, nid);
  if (n.gold < cost) return { ok: false, msg: `금이 모자랍니다 (${fmtGold(cost)}).` };
  n.gold -= cost;
  for (const g of Object.values(s.generals)) if (g.nation === nid && g.status === 'active' && !g.ruler) g.loyal = Math.min(100, (g.loyal ?? 70) + 12);
  return { ok: true, msg: `장수들에게 포상했습니다 (금 -${fmtGold(cost)}, 충성 +12)` };
}

// 순마다: 충성 변화·배신, 해가 바뀌면 나이 +1·병사
export function peopleTurn(s) {
  const rng = makeRng(`ppl2:${s.seed}:${s.turn}`);
  const newYear = (s.turn - 1) % 36 === 0 && s.turn > 1;
  for (const g of Object.values(s.generals)) {
    if (g.loyal === undefined) g.loyal = 65;
    if (g.age === undefined) g.age = 30;
    if (newYear && g.status !== 'gone') {
      g.age += 1;
      // 60세 무렵부터 병사할 수 있음
      if (g.age >= 58 && rng() < (g.age - 55) * 0.03) {
        g.status = 'gone';
        g.castle = null;
        if (g.nation !== null && g.nation !== undefined && s.nations[g.nation]) log(s, `🕯️ ${s.nations[g.nation].name}의 ${g.name}이(가) ${g.age}세로 세상을 떠났습니다.`, 'info', [g.nation]);
        continue;
      }
    }
    if (g.status !== 'active' || g.ruler || g.nation === null || g.nation === undefined) continue;
    const n = s.nations[g.nation];
    // 금이 바닥나면 녹봉을 못 받아 불만, 아니면 조금씩 회복
    g.loyal = Math.max(0, Math.min(100, g.loyal + (n.gold <= 0 ? -4 : 0.4)));
    // 충성이 낮으면 가끔 더 센 나라로 넘어감 (부대를 이끄는 중이면 그대로)
    if (g.loyal < 35 && !g.unit && rng() < 0.08) {
      const to = s.nations.filter((m) => m.alive && !m.horde && m.id !== n.id).sort((a, b) => powerOf(s, b.id) - powerOf(s, a.id))[0];
      const cap = to && (s.castles.find((c) => c.owner === to.id && c.capital) || s.castles.find((c) => c.owner === to.id));
      if (!cap) continue;
      log(s, `🏃 ${n.name}의 ${g.name}이(가) 불만을 품고 ${to.name}(으)로 떠났습니다!`, 'bad', [n.id, to.id]);
      s.eventsQ = s.eventsQ || [];
      if (n.id === s.playerId && !s.spectator) s.eventsQ.push({ title: '장수의 출분', text: `${g.name}이(가) 불만을 품고 ${to.name}(으)로 떠났습니다. 「전체 포상」으로 충성을 챙기세요.`, faces: [g.name], nations: [n.id] });
      Object.assign(g, { nation: to.id, castle: cap.id, loyal: 60 });
    }
  }
}

// ── 계략: 적 도시에 유언비어·이간·매수 ──
export const SCHEMES = {
  rumor: { name: '유언비어', icon: '🗣️', cost: 5000, desc: '수비병 −8%, 다음 순 자원병·땅 넓히기 멈춤' },
  sow: { name: '이간', icon: '🐍', cost: 5000, desc: '그 도시 장수들 충성 −15' },
  bribe: { name: '매수', icon: '💰', cost: 15000, desc: '충성 낮은 장수 하나를 빼 옴' },
};
const bestIntel = (s, nid, cid) => Math.max(30, ...Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && (cid === undefined || g.castle === cid)).map((g) => g.intel));
export function schemeChance(s, nid, c, k) {
  const me = bestIntel(s, nid), them = bestIntel(s, c.owner, c.id);
  let p = 0.45 + (me - them) / 100;
  if (k === 'bribe') {
    const t = schemeTarget(s, c);
    if (!t) return 0;
    p = p * (100 - loyalOf(t)) / 70;
  }
  return Math.max(0.05, Math.min(0.9, p));
}
const schemeTarget = (s, c) => Object.values(s.generals).filter((g) => g.castle === c.id && g.status === 'active' && !g.ruler).sort((a, b) => loyalOf(a) - loyalOf(b))[0] || null;

export function doScheme(s, nid, cid, k, rng = Math.random) {
  const c = s.castles[cid], sc = SCHEMES[k], n = s.nations[nid];
  if (!c || c.owner === null || !enemy(s, nid, c.owner)) return { ok: false, msg: '적 도시에만 쓸 수 있습니다.' };
  if (c.schemed === s.turn) return { ok: false, msg: '이번 순에는 이미 계략을 썼습니다.' };
  if (n.gold < sc.cost) return { ok: false, msg: `금이 모자랍니다 (${fmtGold(sc.cost)}).` };
  if (k === 'bribe' && !schemeTarget(s, c)) return { ok: false, msg: '빼 올 장수가 없습니다.' };
  n.gold -= sc.cost;
  c.schemed = s.turn;
  if (rng() >= schemeChance(s, nid, c, k)) {
    addRel(s, nid, c.owner, -5);
    return { ok: true, msg: `${sc.icon} ${sc.name} 실패… 들켜서 ${s.nations[c.owner].name}과(와)의 우호가 떨어졌습니다.` };
  }
  if (k === 'rumor') { c.troops = Math.round(c.troops * 0.92); c.unrest = s.turn + 1; }
  if (k === 'sow') for (const g of Object.values(s.generals)) if (g.castle === c.id && g.status === 'active' && !g.ruler) g.loyal = Math.max(0, loyalOf(g) - 15);
  let extra = '';
  if (k === 'bribe') {
    const t = schemeTarget(s, c);
    const home = s.castles.find((x) => x.owner === nid && x.capital) || s.castles.find((x) => x.owner === nid);
    Object.assign(t, { nation: nid, castle: home.id, loyal: 55 });
    extra = ` ${t.name}이(가) 우리 편이 되었습니다!`;
  }
  log(s, `${sc.icon} ${n.name}의 ${sc.name}이(가) ${c.name}에서 성공했습니다.${extra}`, 'info', [nid, c.owner]);
  return { ok: true, msg: `${sc.icon} ${sc.name} 성공!${extra}` };
}

// 컴퓨터: 가끔 가장 가까운 적 도시에 계략, 충성이 떨어지면 포상
export function aiPeople(s, grid, nid, rng) {
  const n = s.nations[nid];
  const gens = Object.values(s.generals).filter((g) => g.nation === nid && g.status === 'active' && !g.ruler);
  if (gens.length && gens.reduce((a, g) => a + loyalOf(g), 0) / gens.length < 55 && n.gold > rewardCost(s, nid) * 3) rewardAll(s, nid);
  if (rng() > 0.12 || n.gold < 30000) return;
  const mine = s.castles.filter((c) => c.owner === nid);
  const targets = s.castles.filter((c) => c.owner !== null && enemy(s, nid, c.owner) && mine.some((m) => grid.dist(m.tile, c.tile) <= 12));
  if (!targets.length) return;
  const c = targets[Math.floor(rng() * targets.length)];
  const k = schemeTarget(s, c) && loyalOf(schemeTarget(s, c)) < 45 ? 'bribe' : rng() < 0.5 ? 'rumor' : 'sow';
  doScheme(s, nid, c.id, k, rng);
}
