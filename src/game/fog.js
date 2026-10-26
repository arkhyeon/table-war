import { getRel, isVassalOf } from './engine.js';

// 플레이어 시야: 내 땅·동맹·속국/종주국 땅과 그 인접 지역 (항구가 있으면 바닷길 너머도)
export function visibleSet(s, world, nid) {
  const vis = new Set();
  const friendly = (o) => o === nid || (o !== null && o !== undefined && (getRel(s, nid, o).type === 'alliance' || isVassalOf(s, o, nid) || isVassalOf(s, nid, o)));
  s.regions.forEach((r, i) => {
    if (!friendly(r.owner)) return;
    vis.add(i);
    for (const nb of world.regions[i].neighbors) vis.add(nb.id);
  });
  return vis;
}

export function updateExplored(s, world) {
  if (!s.explored) s.explored = new Array(s.regions.length).fill(0);
  for (const i of visibleSet(s, world, s.playerId)) s.explored[i] = 1;
}

// 지역 표시 상태: 'visible' | 'known'(지도만) | 'hidden'(안개)
export function viewOf(s, vis, rid) {
  const o = s.opts || {};
  if (vis.has(rid)) return 'visible';
  if (o.revealMap !== false || (o.rememberExplored !== false && s.explored?.[rid])) return 'known';
  return 'hidden';
}

export const troopsShown = (s, view) => view === 'visible' || (s.opts || {}).revealTroops === true;

// 기록(연대기)용 영토 스냅샷
const CH = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const encodeOwners = (s) => s.regions.map((r) => (r.owner === null ? '.' : CH[r.owner])).join('');
export const decodeOwners = (str) => [...str].map((c) => (c === '.' ? null : CH.indexOf(c)));
