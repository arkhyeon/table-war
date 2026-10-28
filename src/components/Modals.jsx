import { useEffect, useMemo, useState } from 'react';
import MapView, { Army, armyTier } from './MapView.jsx';
import { MOVES, newDuel, duelRound, aiMove, duelist, duelHp, readChance, bestResponse } from '../game/duel.js';
import { decodeOwners } from '../game/fog.js';
import { makeRng, stateRng } from '../game/rng.js';
import { TERRAIN, EDGE, COST, BUILDINGS, BATTLE_KIND } from '../game/rules.js';
import { TRAITS, TIER, traitDesc, traitLabel } from '../game/traits.js';
import { CIVS } from '../game/civs.js';
import {
  estimateBattle, moveCheck, moveCost, doMove, planMove, gensIn, getRel, nationRegions, nationPower, nationGenerals, doRelocate,
  doRecruit, doExecute, doRelease, recruitChance, isRuler, edgeBetween, WALL_MAX, movable,
  ownDistances, reinforceTurns, frontierOf,
  mercCap, mercPrice, bribeAgents, bribeChance, bribeCost, bribeCheck, doBribe, draftPlan, draftBase, draftAfford, DRAFT_GOLD, doDraft, draftCheck, DRAFT_AP, callTroops, doReward, rewardCheck, rewardCost, trainCheck, doTrain, trainCost, TRAIN_AP, TRAIN_COOLDOWN, pickTrait, commandCap, hireCost, hireCheck, hireMax, doHire, formArmy, garrisonOf, freeGens, PLOTS, plotChance, plotCheck, doPlot, doDisband,
} from '../game/engine.js';
import { fiefRegions, grantFiefCheck, grantFief, FIEF_TRIBUTE, answerRequest, pacifyCost, pacifyChance, doPacify, PERSONA } from '../game/rise.js';
import { emptyDeal, proposeDeal, breakTreaty, validateDeal, applyDeal, TREATY_LABEL, annexCheck, doAnnex, sowCost, sowChance, sowCheck, doSow } from '../game/diplomacy.js';
import { onProposalDeclined } from '../game/ai.js';
import { answerCard } from '../game/cards.js';
import { rating } from '../game/generals.js';
import { fixJosa } from '../game/josa.js';
import { playerStat } from '../game/turn.js';
import SaveSlots from './SaveSlots.jsx';
import { fmtTroops, fmtGold } from '../game/format.js';
import { relTag, GenLine, TraitTags, GradeTag } from './SidePanel.jsx';
import { ACHIEVEMENTS } from '../game/achievements.js';
import EditableName from './EditableName.jsx';
import Slider from './Slider.jsx';
import { G } from '../game/rules.js';

export function Modal({ title, onClose, wide, children }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          {onClose && (
            <button className="sm" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────── 이동/공격 ─────────
export function MoveModal({ world, game, from, to, act, onClose, onDone, onDuel }) {
  const pid = game.playerId;
  const fr = game.regions[from], tr = game.regions[to];
  const edge = edgeBetween(world, from, to) || { type: 'march' };
  // 부대 소속 장수는 부대 말로 움직임
  const myGens = gensIn(game, from, pid).filter((g) => !g.army);
  const aid = tr.owner !== null && tr.owner !== pid && getRel(game, pid, tr.owner).type === 'alliance';
  const [sel, setSel] = useState(() => (aid ? [] : myGens.map((g) => g.id)));
  // 공격이면 군단 지휘 한도까지만
  const attacking = !aid && tr.owner !== pid && !(tr.sea && (tr.owner === null || tr.troops <= 0));
  const cap = attacking ? commandCap(game, sel) : Infinity;
  const maxCount = Math.min(fr.sea ? fr.troops : fr.troops - 1, movable(game, from), cap);
  const [count0, setCount] = useState(fr.sea ? maxCount : Math.max(1, Math.min(maxCount, fr.troops - 1000)));
  const count = Math.max(1, Math.min(count0, maxCount));
  const walls = !tr.sea && (tr.buildings.walls || 0) > 0;
  const [mode, setMode] = useState('siege');
  const [engines, setEngines] = useState(Math.min(2, fr.engines || 0));
  const isAttack = !aid && tr.owner !== pid && !(tr.sea && (tr.owner === null || tr.troops <= 0));
  // 용병: 장수가 이끄는 공격에만 (통솔 → 최대 인원, 정치 → 값)
  const mCap = isAttack && !tr.sea ? mercCap(game, sel) : 0;
  const mPrice = mercPrice(game, sel);
  const [mercWant, setMerc] = useState(0);
  const merc = Math.min(mercWant, mCap);
  const opts = walls ? { mode, engines, merc } : { engines, merc };
  const err = moveCheck(game, world, pid, from, to, count, sel) || (merc * mPrice > game.nations[pid].gold ? '용병을 살 금이 부족합니다.' : null);
  const est = useMemo(() => (isAttack && !err ? estimateBattle(game, world, pid, from, to, count + merc, sel, opts) : null), [game, world, pid, from, to, count, sel, isAttack, err, mode, engines, merc]); // eslint-disable-line react-hooks/exhaustive-deps
  const rel = tr.owner !== null && tr.owner !== pid ? getRel(game, pid, tr.owner) : null;
  const betrayal = isAttack && rel && (rel.type === 'nap' || rel.type === 'vassal');
  const owner = tr.owner === null ? (tr.sea ? '빈 바다' : '중립 세력') : game.nations[tr.owner].name;
  const defGens = isAttack && tr.owner !== null ? gensIn(game, to, tr.owner) : [];
  const canDuel = isAttack && sel.length > 0 && defGens.length > 0;
  const [wantDuel, setWantDuel] = useState(true);
  const verb = aid ? '원군 파견' : edge.type === 'coast' ? '승선' : edge.type === 'landing' ? '상륙' : edge.type === 'cliff' ? '절벽 상륙' : edge.type === 'sea' ? '항해' : '이동';
  const title = isAttack ? (tr.sea ? `⚓ ${tr.name} 해전` : edge.type === 'landing' || edge.type === 'cliff' ? `⚔️ ${tr.name} ${edge.type === 'cliff' ? '절벽 ' : ''}상륙 공격` : `⚔️ ${tr.name} 공격`) : `${aid ? "🤝" : "🚩"} ${tr.name} ${verb}`;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="kv" style={{ marginBottom: 10 }}>
        <span>경로</span>
        <span>
          {fr.name} → {tr.name} ({EDGE[edge.type].name}{edge.mtn ? ' · ⛰️험산 경계: 행동력 +1, 공격 -35%' : ''})
        </span>
        <span>대상</span>
        <span>
          {owner}
          {!tr.sea && ` · ${TERRAIN[world.regions[to].terrain].name}`}
          {(isAttack || tr.owner === pid) && ` · 병사 ${tr.troops.toLocaleString('ko-KR')}명`}
          {walls ? ` · 🏰성벽 ${tr.buildings.walls}/${WALL_MAX}` : ''}
        </span>
        <span>행동력</span>
        <span>{moveCost(world, from, to, game)} AP</span>
      </div>
      <div className="col">
        <label>
          병력 {count.toLocaleString('ko-KR')} / {maxCount.toLocaleString('ko-KR')}명
          {attacking && <small className="muted"> · ⚔️ 군단 지휘 한도 {cap.toLocaleString('ko-KR')}{sel.length ? '' : ' (장수 없이는 공격 불가)'}</small>}
          {(fr.moved || 0) > 0 && <small className="muted"> · 이번 턴 도착 {fmtTroops(Math.min(fr.moved, fr.troops))}은 이동 불가</small>}
          <Slider min={1} max={Math.max(1, maxCount)} step={maxCount > 2000 ? 100 : 1} value={count} onChange={setCount} style={{ width: '100%' }} />
        </label>
        {myGens.length > 0 && !aid && (
          <div className="card col" style={{ gap: 6 }}>
            <b>⭐ 함께 갈 장수 <small className="muted">(누르면 넣고 빼기 · 장수는 군대와 함께 움직입니다)</small></b>
            <div className="gen-picks">
              {myGens.map((g) => {
                const on = sel.includes(g.id);
                return (
                  <button key={g.id} className={'gen-pick' + (on ? ' on' : '')} onClick={() => setSel(on ? sel.filter((x) => x !== g.id) : [...sel, g.id])}>
                    <span>{on ? '✅' : '⬜'} <b>{g.name}</b></span>
                    <small>
                      무{g.war} 통{g.lead} 지{g.intel} <TraitTags g={g} />
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {isAttack && !tr.sea && (
          <div className="card col" style={{ gap: 4 }}>
            <b>💰 용병 고용 <small className="muted">(이 전투에만 함께 싸우고 떠남 · 장수가 있어야 함)</small></b>
            {mCap > 0 ? (
              <label style={{ fontSize: 13 }}>
                {fmtTroops(merc)} / 최대 {fmtTroops(mCap)} · 금 {fmtGold(merc * mPrice)} (1명당 {mPrice}금)
                <Slider min={0} max={mCap} step={100} value={merc} onChange={setMerc} style={{ width: '100%' }} />
                <small className="muted">최대 인원은 장수의 통솔, 값은 정치에 따라 달라집니다.</small>
              </label>
            ) : (
              <small className="muted">함께 갈 장수를 넣으면 고용할 수 있습니다.</small>
            )}
          </div>
        )}
        {walls && isAttack && (
          <div className="card col" style={{ gap: 6 }}>
            <b>🏰 공성 방식</b>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={mode === 'siege'} onChange={() => setMode('siege')} /> 포위 공격 — 이겨도 성벽만 깎음(1, 압승 2, 공성 장수 추가). 성벽 0이 되면 함락. 손실 적음
            </label>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={mode === 'assault'} onChange={() => setMode('assault')} /> 강습 — 이기면 바로 함락. 대신 성벽 방어 2배, 아군 손실 1.5배(공성Ⅱ 장수가 있으면 감소)
            </label>
          </div>
        )}
        {est && (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                공격력 <b>{fmtTroops(est.A)}</b> vs 방어력 <b>{fmtTroops(est.D)}</b>
              </span>
              <b style={{ color: est.winChance > 0.6 ? 'var(--ok)' : est.winChance > 0.35 ? 'var(--accent)' : 'var(--danger)' }}>승률 {Math.round(est.winChance * 100)}%</b>
            </div>
            <div className="odds" style={{ marginTop: 6 }}>
              <i style={{ width: `${est.winChance * 100}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              장수 보정: 공격 +{Math.round(est.genAtt * 100)}%{est.genAttRaw > est.genAtt + 0.005 ? ` (합 +${Math.round(est.genAttRaw * 100)}%, 상한 적용)` : ''} · 수비 +{Math.round(est.genDef * 100)}%{est.genDefRaw > est.genDef + 0.005 ? ` (합 +${Math.round(est.genDefRaw * 100)}%)` : ''}
              <br />
              세부: {est.mods.length ? est.mods.join(', ') : '없음'}
              <br />
              방어 보정: 지형 ×{est.terrDef}
              {est.walls > 1 ? `, 성벽 ×${est.walls.toFixed(2)}` : ''}
              {est.def.length ? `, 수비 장수 ${est.def.map((g) => g.name).join(', ')}` : ''}
              {walls && mode === 'siege' && est.winChance > 0 && <><br />승리해도 성벽이 남으면 함락되지 않습니다.</>}
            </div>
          </div>
        )}
        {canDuel && (
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={wantDuel} onChange={(e) => setWantDuel(e.target.checked)} /> ⚔️ 일기토 신청 — {duelist(sel.map((id) => game.generals[id])).name} vs {duelist(defGens).name} (이기면 전투력 +15%, 지면 -15%)
          </label>
        )}
        {betrayal && <div style={{ color: 'var(--danger)' }}>⚠️ {rel.type === 'nap' ? '불가침 조약' : '종속 관계'} 중인 상대입니다. 공격 시 조약 파기, 평판 -25, 모든 국가 호감도 하락, 다음 턴 행동력 -2.</div>}
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="muted" style={{ fontSize: 12 }}>계획은 바로 실행되지 않고, 턴 종료 때 모든 나라의 계획과 함께 처리됩니다. 같은 곳에 여러 군대가 몰리면 차례로 맞붙습니다.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!!err}
            onClick={() => {
              const res = act((s) => planMove(s, world, pid, from, to, count, sel, { ...opts, wantDuel: canDuel && wantDuel }));
              if (res?.ok) onDone();
            }}
          >
            {isAttack ? '⚔️ 공격 계획' : `🧭 ${verb} 계획`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────── 징병 ─────────
// ───────── 외교 ─────────
function relText(game, a, b) {
  const r = getRel(game, a, b);
  if (r.type === 'alliance') return '동맹';
  if (r.type === 'nap') return `${r.truce ? '정전' : '불가침'}(~${r.until}턴)`;
  if (r.type === 'vassal') return r.overlord === a ? '내 속국' : '나의 종주국';
  return '-';
}

function opinionLabel(v) {
  if (v >= 40) return '우호';
  if (v >= 10) return '호의';
  if (v > -10) return '중립';
  if (v > -40) return '경계';
  return '적대';
}

export function DiplomacyModal({ world, game, act, confirmIt, onClose }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const others = game.nations.filter((n) => n.alive && n.id !== pid);
  const [target, setTarget] = useState(others[0]?.id ?? null);
  const [deal, setDeal] = useState(emptyDeal);
  const [result, setResult] = useState('');
  const t = target !== null ? game.nations[target] : null;
  const rel = t ? getRel(game, pid, t.id) : null;
  const myRegs = nationRegions(game, pid);
  const theirRegs = t ? nationRegions(game, t.id) : [];
  const myPower = nationPower(game, pid);
  const set = (fn) => setDeal((d) => fn(structuredClone(d)));
  const toggle = (side, rid) => set((d) => ((d[side].regions = d[side].regions.includes(rid) ? d[side].regions.filter((x) => x !== rid) : [...d[side].regions, rid]), d));
  const err = t ? validateDeal(game, world, pid, t.id, deal) : null;
  const adjTo = (rid, nid) => world.regions[rid].neighbors.some((n) => game.regions[n.id].owner === nid);

  return (
    <Modal title="🤝 외교" onClose={onClose} wide>
      <table>
        <thead>
          <tr>
            <th>국가</th>
            <th>군주</th>
            <th>영토</th>
            <th>병력</th>
            <th>국력</th>
            <th>관계</th>
            <th>나에 대한 호감</th>
          </tr>
        </thead>
        <tbody>
          {others.map((n) => {
            const op = Math.round(game.opinion[n.id][pid]);
            return (
              <tr
                key={n.id}
                className={'clickable' + (n.id === target ? ' sel' : '')}
                onClick={() => {
                  setTarget(n.id);
                  setDeal(emptyDeal());
                  setResult('');
                }}
              >
                <td>
                  <span className="chip" style={{ background: n.color }} />
                  {n.name}
                </td>
                <td>{game.generals[n.ruler]?.name || '-'}</td>
                <td>{nationRegions(game, n.id).length}</td>
                <td>{game.opts?.revealTroops ? fmtTroops(game.regions.reduce((a, r) => a + (r.owner === n.id ? r.troops : 0), 0)) : '?'}</td>
                <td>{Math.round((nationPower(game, n.id) / myPower) * 100)}%</td>
                <td>{relText(game, pid, n.id)}</td>
                <td>
                  {opinionLabel(op)} ({op})
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <SowBox game={game} act={act} />
      {t && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              <span className="chip" style={{ background: t.color }} />
              {fixJosa(`${t.name}과(와)의 협상`)} {relTag(game, pid, t.id)}
            </h3>
            <div className="row">
              {rel.type !== 'none' && (
                <button
                  className="danger sm"
                  onClick={() => {
                    const warn = rel.type === 'alliance' ? '동맹 파기: 평판 -10, 상대 호감 -30' : rel.type === 'nap' ? '불가침 파기: 평판 -8, 상대 호감 -25' : rel.overlord === pid ? '속국을 독립시킵니다.' : '독립 선언: 평판 -5, 종주국 호감 -40';
                    confirmIt(warn + ' — 진행할까요?', () => act((s) => breakTreaty(s, pid, t.id)));
                  }}
                >
                  {rel.type === 'alliance' ? '동맹 파기' : rel.type === 'nap' ? '불가침 파기' : rel.overlord === pid ? '속국 해방' : '독립 선언'}
                </button>
              )}
              {rel.type === 'vassal' && rel.overlord === pid && (
                <button
                  className="sm"
                  disabled={!!annexCheck(game, pid, t.id)}
                  title={annexCheck(game, pid, t.id) || '속국의 영토·장수·국고를 흡수합니다. 행동력 2, 평판 -5, 주변국 경계'}
                  onClick={() => confirmIt(fixJosa(`${t.name}을(를) 병합할까요? (행동력 2, 평판 -5)`), () => act((s) => doAnnex(s, world, pid, t.id)))}
                >
                  👑 병합
                </button>
              )}
            </div>
          </div>
          <div className="diplo" style={{ marginTop: 8 }}>
            <div className="card col">
              <b>내가 주는 것</b>
              <label className="row">
                금 <input type="number" min={0} max={me.gold} value={deal.give.gold} onChange={(e) => set((d) => ((d.give.gold = Math.max(0, Math.min(me.gold, +e.target.value || 0))), d))} step={10000} style={{ width: 120 }} /> / {fmtGold(me.gold)}
              </label>
              <div className="pick-list">
                {myRegs
                  .slice()
                  .sort((a, b) => adjTo(b, t.id) - adjTo(a, t.id))
                  .map((rid) => (
                    <label key={rid}>
                      <input type="checkbox" checked={deal.give.regions.includes(rid)} onChange={() => toggle('give', rid)} /> {game.regions[rid].name} <small className="muted">병{fmtTroops(game.regions[rid].troops)}{adjTo(rid, t.id) ? ' · 접경' : ''}{me.capital === rid ? ' · 수도' : ''}</small>
                    </label>
                  ))}
              </div>
            </div>
            <div className="card col">
              <b>내가 받는 것</b>
              <label className="row">
                금 <input type="number" min={0} max={t.gold} value={deal.get.gold} onChange={(e) => set((d) => ((d.get.gold = Math.max(0, Math.min(t.gold, +e.target.value || 0))), d))} step={10000} style={{ width: 120 }} /> / {fmtGold(t.gold)}
              </label>
              <div className="pick-list">
                {theirRegs
                  .slice()
                  .sort((a, b) => adjTo(b, pid) - adjTo(a, pid))
                  .map((rid) => (
                    <label key={rid}>
                      <input type="checkbox" checked={deal.get.regions.includes(rid)} onChange={() => toggle('get', rid)} /> {game.regions[rid].name} <small className="muted">병{fmtTroops(game.regions[rid].troops)}{adjTo(rid, pid) ? ' · 접경' : ''}{t.capital === rid ? ' · 수도' : ''}</small>
                    </label>
                  ))}
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span>조약</span>
            <select value={deal.treaty || ''} onChange={(e) => set((d) => ((d.treaty = e.target.value || null), d))}>
              <option value="">없음 (거래·선물·조공 요구)</option>
              {Object.entries(TREATY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {deal.treaty === 'joint' && (
              <select value={deal.target ?? ''} onChange={(e) => set((d) => ((d.target = e.target.value === '' ? null : +e.target.value), d))}>
                <option value="">공격 대상…</option>
                {others
                  .filter((o) => o.id !== t.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            )}
            <div className="spacer" />
            <button
              className="primary"
              disabled={!!err || me.ap < COST.diplomacy}
              onClick={() => {
                const res = act((s) => proposeDeal(s, world, pid, t.id, deal));
                if (res?.ok) {
                  setResult(fixJosa(res.msg));
                  if (res.accepted) setDeal(emptyDeal());
                }
              }}
            >
              제안하기 ({COST.diplomacy}AP)
            </button>
          </div>
          {err && <div className="muted" style={{ marginTop: 6 }}>{err}</div>}
          {result && <div style={{ marginTop: 6, color: 'var(--accent)' }}>{result}</div>}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            동맹: 서로 공격 불가(파기 필요). 불가침·종속 상대 공격 시 배신 페널티. 속국은 수입 25%를 조공. 공동 공격 합의 시 상대 AI가 목표국을 우선 공격합니다. 상대의 호감·국력 차이·평판·외교 장수가 수락률에 영향을 줍니다.
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────── 장수 ─────────
export function GeneralsModal({ world, game, act, confirmIt, onClose, onFocus }) {
  const pid = game.playerId;
  const [tab, setTab] = useState('mine');
  const mine = nationGenerals(game, pid).sort((a, b) => rating(b) - rating(a));
  const prisoners = Object.values(game.generals).filter((g) => g.status === 'prisoner' && g.captor === pid);
  const lost = Object.values(game.generals).filter((g) => g.status === 'prisoner' && g.nation === pid);
  const all = Object.values(game.generals).filter((g) => g.status === 'active' && g.nation !== pid);
  const dead = Object.values(game.generals).filter((g) => g.status === 'dead');
  const myRegs = nationRegions(game, pid);
  const me = game.nations[pid];

  return (
    <Modal title="⭐ 장수" onClose={onClose} wide>
      <div className="tabs">
        {[
          ['mine', `내 장수 (${mine.length})`],
          ['pris', `포로 (${prisoners.length})`],
          ['others', `타국 장수 (${all.length})`],
          ['dead', `전사·처형 (${dead.length})`],
          ['rule', '출현 규칙'],
        ].map(([k, v]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {tab === 'mine' && (
        <div className="row" style={{ gap: 8, margin: '6px 0', flexWrap: 'wrap' }}>
          <button className="primary" disabled={!!hireCheck(game, pid)} onClick={() => act((s) => doHire(s, pid))} title={hireCheck(game, pid) || ''}>
            📜 장수 모집 ({fmtGold(hireCost(game, pid))}금 · 1AP)
          </button>
          <small className="muted">
            {hireCheck(game, pid) || `장수 ${nationGenerals(game, pid).length}/${hireMax(game, pid)}명`} · 장수 한 명 = 군단 하나. 나라를 치려면 장수가 이끄는 군단이 필요하고, 통솔이 높을수록 많이 이끕니다.
          </small>
        </div>
      )}
      {tab === 'mine' && (
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>구분</th>
              <th>무</th>
              <th>통</th>
              <th>지</th>
              <th>정</th>
              <th>특성</th>
              <th>충성·포상·수련</th>
              <th>위치 / 재배치 ({COST.relocate}AP)</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((g) => (
              <tr key={g.id}>
                <td>
                  {me.ruler === g.id && '👑 '}
                  {g.persona && <span title={PERSONA[g.persona].desc}>{PERSONA[g.persona].icon} </span>}
                  <EditableName value={g.name} max={12} onSave={(t) => act((st) => ((st.generals[g.id].name = t), { ok: true, msg: `장수 이름을 ${t}(으)로 바꿨습니다.` }))} />
                  {g.title && <div className="tag ally">{g.title}</div>}
                </td>
                <td>
                  {g.role === 'civ' ? '문관' : '무관'} Lv{g.level || 1}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {g.exp || 0}/{(g.level || 1) * 100}
                  </div>
                </td>
                <td>{g.war}</td>
                <td>{g.lead}</td>
                <td>{g.intel}</td>
                <td>{g.pol}</td>
                <td>
                  <TraitTags g={g} />
                </td>
                <td>
                  {me.ruler === g.id ? (
                    '-'
                  ) : (
                    <>
                      <b style={{ color: (g.loyalty ?? 60) < 40 ? 'var(--danger)' : (g.loyalty ?? 60) < 55 ? 'var(--accent)' : undefined }}>{Math.round(g.loyalty ?? 60)}</b>
                      {(g.loyalty ?? 60) < 40 && <small style={{ color: 'var(--danger)' }}> 봉기 위험</small>}
                      <div>
                        <button className="sm" disabled={!!rewardCheck(game, pid, g.id)} title={rewardCheck(game, pid, g.id) || `충성 +${g.persona === '야심' ? 10 : 15}`} onClick={() => act((s) => doReward(s, pid, g.id))}>
                          🎁 {fmtGold(rewardCost(g))}
                        </button>
                      </div>
                    </>
                  )}
                  <div>
                    <button className="sm" disabled={!!trainCheck(game, pid, g.id)} title={trainCheck(game, pid, g.id) || `수련: 경험치 +${(g.level || 1) * 50} (다음 레벨의 절반) · 행동력 ${TRAIN_AP} · ${TRAIN_COOLDOWN}턴마다`} onClick={() => act((s) => doTrain(s, pid, g.id))}>
                      📚 {fmtGold(trainCost(g))}
                    </button>
                  </div>
                </td>
                <td>
                  <select value={g.region} onChange={(e) => act((s) => doRelocate(s, pid, g.id, +e.target.value))} disabled={me.ap < COST.relocate}>
                    {myRegs.map((rid) => (
                      <option key={rid} value={rid}>
                        {game.regions[rid].name}
                      </option>
                    ))}
                  </select>{' '}
                  <button className="sm" onClick={() => onFocus(g.region)}>
                    📍
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'pris' && (
        <div className="col">
          {prisoners.length === 0 && <div className="muted">붙잡은 포로가 없습니다. 장수가 지키는 지역을 점령하면 포로를 얻을 수 있습니다.</div>}
          {prisoners.map((g) => (
            <GenLine
              key={g.id}
              g={g}
              extra={
                <div className="row" style={{ marginTop: 4 }}>
                  <small className="muted">원소속: {game.nations[g.nation].name}{isRuler(game, g) ? ' (군주)' : ''}</small>
                  <button className="sm" disabled={isRuler(game, g) || game.tried[g.id] === game.turn || me.ap < COST.recruit} onClick={() => act((s) => doRecruit(s, pid, g.id))}>
                    등용 ({recruitChance(game, pid, g)}%, {COST.recruit}AP)
                  </button>
                  <button className="sm danger" onClick={() => confirmIt(fixJosa(`${g.name}을(를) 처형할까요? (평판 -4)`), () => act((s) => doExecute(s, pid, g.id)))}>
                    처형
                  </button>
                  <button className="sm" onClick={() => act((s) => doRelease(s, pid, g.id))}>
                    석방
                  </button>
                </div>
              }
            />
          ))}
          {lost.length > 0 && (
            <>
              <h4>적에게 붙잡힌 내 장수</h4>
              {lost.map((g) => (
                <div key={g.id} className="gen">
                  {g.name} — {game.nations[g.captor]?.name}에 억류
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {tab === 'others' && (
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>소속</th>
              <th>무/통/지/정</th>
              <th>특성</th>
              <th>위치</th>
            </tr>
          </thead>
          <tbody>
            {all
              .sort((a, b) => a.nation - b.nation)
              .map((g) => (
                <tr key={g.id} className="clickable" onClick={() => onFocus(g.region)}>
                  <td>{g.name}</td>
                  <td>
                    <span className="chip" style={{ background: game.nations[g.nation].color }} />
                    {game.nations[g.nation].name}
                  </td>
                  <td>
                    {g.war}/{g.lead}/{g.intel}/{g.pol}
                  </td>
                  <td>
                    <TraitTags g={g} />
                  </td>
                  <td>{game.regions[g.region]?.name}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {tab === 'dead' && (
        <div className="col">
          {dead.length === 0 && <div className="muted">아직 없습니다.</div>}
          {dead.map((g) => (
            <div key={g.id} className="gen">
              ✝ {g.name} <small className="muted">({game.nations[g.nation]?.name})</small>
            </div>
          ))}
        </div>
      )}
      {tab === 'rule' && (
        <div className="help">
          <ul>
            <li>매 턴 각 국가에 확률적으로 역사 속 장수가 출현합니다. 한 판에 같은 장수는 두 번 나오지 않습니다.</li>
            <li>기본 6%. 평균보다 장수가 적은 나라는 확률이 오르고(최대 2.5배), 많은 나라는 내려갑니다. 국고(200금 이상 +20%, 30금 미만 -30%)·평판도 확률에 반영되며, 영토 3곳 이하 약소국은 +2%p. 최대 30%.</li>
            <li>이미 강한 장수진을 가진 나라에는 능력치가 낮은 장수가, 약한 나라에는 뛰어난 장수가 나올 가중치가 커집니다.</li>
            <li>판을 거듭하며 자주 출현한 장수일수록 다음 판의 출현 가중치가 1/(1+0.5×출현횟수)로 줄어듭니다.</li>
            <li>장수는 자기 문명(또는 세력)의 인물이 주로 나오며, 삼국지에서는 재야 인물도 등장합니다.</li>
            <li>현재 내 출현 확률은 국가 카드에 표시됩니다.</li>
            <li>무관은 전투(승리 25, 방어 25, 포위 10, 일기토 40)와 병영 훈련(+3/턴)으로, 문관은 주둔지를 다스리며((정치-40)/6×1.5/턴) 경험치를 얻습니다. 3·5·7·9레벨에 특성 승급 또는 새 특성과 칭호를 얻습니다.</li>
          </ul>
          <h4>특성 (Ⅰ/Ⅱ/Ⅲ)</h4>
          <table>
            <tbody>
              {Object.entries(TRAITS).map(([k, t]) => (
                <tr key={k}>
                  <td>
                    <b>{k}</b> <span className="tag">{t.cat === 'civ' ? '문관' : '무관'}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>{[1, 2, 3].map((tier) => `${TIER[tier]} ${traitDesc(k, tier)}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ display: 'none' }}>
          </ul>
        </div>
      )}
    </Modal>
  );
}

// ───────── AI 제안 ─────────
export function ProposalModal({ world, game, act }) {
  const p = game.proposals[0];
  const from = game.nations[p.from];
  // 군단의 지원 요청 · 도적의 협박
  if (p.kind) {
    const answer = (yes) =>
      act((s) => {
        const prop = s.proposals.shift();
        if (!s.nations[prop.from]?.alive) return { ok: true };
        const res = answerRequest(s, prop, yes);
        if (!res.ok) s.proposals.unshift(prop);
        return res;
      });
    return (
      <Modal title={p.kind === 'fief' ? `🏯 ${from.name}의 요청` : p.kind === 'ally' ? `🆘 동맹국 ${from.name}의 원군 요청` : `🏴 ${from.name}의 협박`}>
        <p>{fixJosa(p.text)}</p>
        <WhereMap world={world} game={game} ids={[p.from]} />
        <p className="muted" style={{ fontSize: 13 }}>보유 금 {fmtGold(game.nations[game.playerId].gold)}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => answer(false)}>거절</button>
          <button className="primary" disabled={game.nations[game.playerId].gold < p.gold} onClick={() => answer(true)}>
            {p.kind === 'fief' || p.kind === 'ally' ? `금 ${fmtGold(p.gold)} 보내기` : `금 ${fmtGold(p.gold)} 주기`}
          </button>
        </div>
      </Modal>
    );
  }
  const err = from.alive ? validateDeal(game, world, p.from, game.playerId, p.deal) : '제안국이 멸망했습니다.';
  return (
    <Modal title={`📨 ${from.name}의 제안`}>
      <p>{fixJosa(p.text)}</p>
      <WhereMap world={world} game={game} ids={[p.from, ...game.nations.filter((n) => n.alive && n.id !== p.from && n.id !== game.playerId && p.text.includes(n.name)).map((n) => n.id)]} />
      <p className="muted" style={{ fontSize: 13 }}>
        {from.name}의 나에 대한 호감: {Math.round(game.opinion[p.from][game.playerId])}
        {p.deal.get.gold > 0 && !p.deal.treaty && ' · 거절하면 원한을 품고 공격해 올 수 있습니다.'}
      </p>
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          onClick={() =>
            act((s) => {
              const prop = s.proposals.shift();
              if (s.nations[prop.from].alive) onProposalDeclined(s, prop);
              return { ok: true };
            })
          }
        >
          거절
        </button>
        <button
          className="primary"
          disabled={!!err}
          onClick={() =>
            act((s) => {
              const prop = s.proposals.shift();
              applyDeal(s, world, prop.from, s.playerId, prop.deal);
              return { ok: true, msg: '제안을 수락했습니다.' };
            })
          }
        >
          수락
        </button>
      </div>
    </Modal>
  );
}

function TurnSummary({ game }) {
  const a = game.prevStat;
  if (!a) return null;
  const b = playerStat(game);
  const pid = game.playerId;
  const bt = (game.battles || []).filter((x) => x.attacker === pid || x.defender === pid);
  const won = bt.filter((x) => (x.attacker === pid) === !!x.win).length;
  const d = (v, f) => <b style={{ color: v > 0 ? 'var(--ok)' : v < 0 ? 'var(--danger)' : 'var(--muted)' }}>{v > 0 ? '+' : ''}{f(v)}</b>;
  return (
    <div className="turn-sum">
      <span>🗺️ 영토 {b.regions}곳 {d(b.regions - a.regions, (v) => v)}</span>
      <span>💂 병력 {fmtTroops(b.troops)} {d(b.troops - a.troops, fmtTroops)}</span>
      <span>💰 국고 {fmtGold(b.gold)} {d(b.gold - a.gold, fmtGold)}</span>
      {bt.length > 0 && <span>⚔️ 전투 {bt.length}회 · {won}승 {bt.length - won}패</span>}
      {b.gens !== a.gens && <span>⭐ 장수 {b.gens}명 {d(b.gens - a.gens, (v) => v)}</span>}
    </div>
  );
}

export function NewsModal({ game, news, events = [], turn, onClose }) {
  const [tab, setTab] = useState('mine');
  const evHeads = events.map((e) => `${e.icon} ${e.title}`);
  const mine = news.filter((n) => !evHeads.some((h) => n.startsWith(h)));
  const pid = game?.playerId;
  const world = (game?.log || []).filter((l) => l.turn >= turn - 1 && !(l.nations || []).includes(pid)).map((l) => l.text);
  const rest = tab === 'mine' ? mine : world;
  return (
    <Modal title={`📰 ${turn}턴 소식`} onClose={onClose}>
      {game && <TurnSummary game={game} />}
      {events.length > 0 && (
        <div className="col" style={{ marginBottom: 12 }}>
          {events.map((e, i) => (
            <div key={i} className="event-card">
              <h4>
                {e.icon} {e.title}
              </h4>
              <div style={{ fontSize: 13 }}>{fixJosa(e.story)}</div>
              <div style={{ fontSize: 13, marginTop: 4, color: 'var(--accent)' }}>▶ {fixJosa(e.effect)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <button className={tab === 'mine' ? 'primary sm' : 'sm'} onClick={() => setTab('mine')}>내 소식 {mine.length}</button>
        <button className={tab === 'world' ? 'primary sm' : 'sm'} onClick={() => setTab('world')}>세계 소식 {world.length}</button>
      </div>
      <div className="col" style={{ fontSize: 14, maxHeight: '40vh', overflow: 'auto' }}>
        {!rest.length && <div className="muted">소식이 없습니다.</div>}
        {rest.slice(0, 40).map((n, i) => (
          <div key={i}>{fixJosa(n)}</div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="primary" onClick={onClose}>
          확인
        </button>
      </div>
    </Modal>
  );
}

// 점령 비율 추이 그래프 (연대기 기록에서 계산)
function ShareChart({ game }) {
  const frames = [...(game.history || []).map(decodeOwners), game.regions.map((r) => r.owner)];
  const land = game.regions.filter((r) => !r.sea).length;
  const N = game.nations.length;
  const series = game.nations.map(() => []);
  for (const f of frames) {
    const c = new Array(N).fill(0);
    f.forEach((o, i) => { if (o !== null && !game.regions[i].sea) c[o]++; });
    c.forEach((v, k) => series[k].push(v / land));
  }
  const peak = series.map((sr) => Math.max(...sr));
  const show = [...new Set([game.playerId, ...peak.map((p, k) => [p, k]).sort((x, y) => y[0] - x[0]).slice(0, 5).map(([, k]) => k)])];
  const W = 320, H = 120, T = Math.max(1, frames.length - 1);
  const ws = 1;
  const top = Math.max(ws, ...show.map((k) => peak[k]));
  const pt = (v, i) => `${((i / T) * W).toFixed(1)},${(H - (v / top) * H).toFixed(1)}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ width: '100%', height: 150, background: 'var(--panel2)', borderRadius: 8 }}>
        <line x1={0} x2={W} y1={H - (ws / top) * H} y2={H - (ws / top) * H} stroke="#e0b04f" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {show.map((k) => (
          <polyline key={k} points={series[k].map(pt).join(' ')} fill="none" stroke={game.nations[k].color} strokeWidth={k === game.playerId ? 2.6 : 1.4} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="row" style={{ flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, marginTop: 4 }}>
        {show.map((k) => (
          <span key={k}>
            <span className="chip" style={{ background: game.nations[k].color }} />
            {game.nations[k].name} 최고 {Math.round(peak[k] * 100)}%
          </span>
        ))}
        <span className="muted">· 점선 = 통일선 {Math.round(ws * 100)}%</span>
      </div>
    </div>
  );
}

const KEY_EVENT = /^(🔥|🌱|👑|☠️|💢|⚔️ .*대동맹|🙇)/;

export function GameOverModal({ result, game, onNew, onContinue, onChronicle }) {
  const me = game.nations[game.playerId];
  const st = game.stats || {};
  const heroes = Object.values(game.generals).filter((g) => g.wins).sort((a, b) => b.wins + (b.takes || 0) * 2 - (a.wins + (a.takes || 0) * 2)).slice(0, 6);
  // 열전 한 줄: 소속·칭호, 전적, 사로잡은 장수, 최후
  const bio = (g) => {
    const nat = game.nations[g.nation]?.name || '';
    const bits = [`${g.wins}승`, g.takes ? `성 ${g.takes}곳 함락` : null, g.duelWins ? `일기토 ${g.duelWins}승` : null, g.caught?.length ? `${g.caught.slice(-2).join('·')}을(를) 사로잡음` : null].filter(Boolean);
    const end = g.status === 'dead' ? ' 끝내 전장에서 쓰러졌다.' : g.status === 'prisoner' ? ' 포로가 되어 생을 마쳤다.' : '';
    return fixJosa(`${nat}의 ${g.title || (g.role === 'civ' ? '모사' : '장수')}. ${bits.join(', ')}.${end}`);
  };
  const events = game.log.filter((l) => KEY_EVENT.test(l.text)).slice(0, 10).reverse();
  const fresh = game.newAchieve || [];
  return (
    <Modal title={result.spectator ? '🏁 관전 종료' : result.partial ? '🏆 천하의 8할!' : result.win ? '🏆 승리!' : '💀 패배'} wide>
      <p>{fixJosa(result.text)}</p>
      {!result.spectator && <p className="muted">
        {me.name} · {game.turn}턴 · 영토 {nationRegions(game, game.playerId).length} · 전투 {st.won || 0}승 {st.lost || 0}패 · 일기토 {st.duels || 0}승 · 최소 영토 {st.minRegions ?? '-'}곳
      </p>}
      {fresh.length > 0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <b>🎉 새 업적</b>{' '}
          {fresh.map((id) => {
            const a = ACHIEVEMENTS.find((x) => x.id === id);
            return (
              <span key={id} className="tag ally" title={a.desc} style={{ marginRight: 4 }}>
                {a.icon} {a.name}
              </span>
            );
          })}
        </div>
      )}
      <h4 style={{ margin: '6px 0' }}>📈 영토 추이</h4>
      <ShareChart game={game} />
      <div className="diplo" style={{ marginTop: 10 }}>
        <div className="card col" style={{ fontSize: 13 }}>
          <b>📜 장수 열전</b>
          {heroes.map((g) => (
            <div key={g.id} style={{ marginBottom: 4 }}>
              <span className="chip" style={{ background: game.nations[g.nation]?.color }} /> <b>{g.name}</b> <GradeTag g={g} /> <small className="muted">Lv{g.level || 1}{g.status === 'dead' ? ' ✝' : ''}</small>
              <div className="muted" style={{ fontSize: 12 }}>{bio(g)}</div>
            </div>
          ))}
          {!heroes.length && <span className="muted">기록 없음</span>}
        </div>
        <div className="card col" style={{ fontSize: 13 }}>
          <b>📜 주요 사건</b>
          {events.map((l, i) => (
            <div key={i}>
              <small className="muted">{l.turn}턴</small> {fixJosa(l.text)}
            </div>
          ))}
          {!events.length && <span className="muted">기록 없음</span>}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={onChronicle}>📽️ 연대기</button>
        {result.win && <button onClick={onContinue}>{result.partial ? '⚔️ 끝까지 싸우기 (100%)' : '계속 플레이'}</button>}
        <button className="primary" onClick={onNew}>
          {result.partial ? '👑 통일 선언하고 끝내기' : '새 게임'}
        </button>
      </div>
    </Modal>
  );
}

export function HelpModal({ onClose }) {
  return (
    <Modal title="❓ 게임 방법" onClose={onClose} wide>
      <div className="help">
        <ul>
          <li><b>목표</b>: 모든 육지(100%)를 차지하거나 다른 모든 나라를 멸망·속국화하세요.</li>
          <li><b>지역 숫자</b> = 주둔 병사 수. ♛ 수도, ★ 장수, 🏰💰⚓⚔️ 건물, ✂ 보급 끊김, 빨간 점 반란 위험.</li>
          <li><b>시간</b>: 2턴이 한 계절, 8턴이 1년. 날씨는 매 턴 바뀝니다.</li>
          <li><b>행동력(AP)</b>: 매 턴 3 + 영토 6곳당 1(최대 +7, 큰 지도는 더 많음) + 신속 특성. 속국 -1, 배신 시 다음 턴 -2.</li>
          <li><b>이동·공격은 계획</b>: 내 지역 선택 → [이동·공격] 또는 M → 인접 지역 클릭 → 병력·함께 갈 장수를 고르고 계획. 바로 실행되지 않고 화살표로 표시되며(오른쪽 아래 목록에서 취소 가능), 턴 종료 때 모든 나라의 계획이 함께 처리됩니다. 같은 곳에 여러 나라 군대가 몰리면 큰 군대부터 차례로 맞붙고, 아군 증원은 전투 전에 합류합니다. 출발한 병력은 그 턴에 다시 계획할 수 없습니다. 일기토를 신청했다면 그 전투 차례에 일기토 창이 뜹니다.</li>
          <li><b>바다</b>: 바다는 구역(점선)으로 나뉩니다. 항구(또는 수군 장수)가 있는 해안에서 승선 → 바다 구역을 한 칸씩 항해 → 해안에 상륙(-25%). 험한 해안은 절벽 상륙(-55%, 행동력 +1). 바다 날씨: 풍랑·순풍·용오름·해무·폭풍. 적 함대가 있는 구역은 해전으로 뚫어야 하고, 함대로 바닷길을 막을 수 있습니다. 바다의 함대는 매 턴 2%(폭풍 10%) 줄어듭니다. 내 함대가 있는 바다는 보급로가 됩니다.</li>
          <li><b>지형</b>: 숲 방어 +15%, 구릉 +25%, 산지 +10%. <b>험산 경계</b>(경계선 위 작은 봉우리)로 넘으면 공격 -35%·AP+1, 다른 경계로 돌아가면 없음. 고산(진한 회색)은 통행 불가. 강 건너 공격 -20%, 좁은 해협(도버·보스포루스 등) 건너기 -30%·AP+1.</li>
          <li><b>내선 작전</b>: 내 땅 안 이동은 행동력이 들지 않고, 내 땅으로만 이어지면 한 번에 <b>3칸</b>까지 이동합니다.</li>
          <li><b>세금</b>: 매 턴 자동 징수. 지역 인구가 많을수록, 시장·대평야·정치 높은 태수가 있으면 많아집니다.</li>
          <li><b>파산</b>: 다음 턴 국고가 바닥날 것 같으면 국가 카드에 경고가 뜹니다. 지역에서 🏳️해산(행동력 없음)으로 병력을 줄이세요. 바닥나면 녹봉을 못 준 만큼(1명당 1금) 병사가 탈영합니다.</li>
          <li><b>병력 불러오기</b>: 지역에서 📯 → 다른 내 지역마다 보낼 병력을 정함(행동력 1, 내 땅 3칸에 1턴 — 직접 행군과 같은 속도). 🚩전선 투입은 「위협받는 국경」 또는 특정 나라 쪽 국경으로 매 턴 자동 행군.</li>
          <li><b>8할 도달</b>: 육지 80%(속국 포함)를 차지하면 통일을 선언하고 끝낼지, 100%까지 싸울지 고릅니다. 그 무렵 남은 나라들은 최후의 동맹을 맺거나 속국을 청합니다.</li>
          <li><b>중원(대평야)</b>: 수도 위치로 고른 가운데 나라(동서남북 4방향 모두에 다른 나라, 바다를 등지지 않은 내륙, 다른 수도들과 가장 가까운 곳, 나라 6개당 1곳)는 장수 +2·병력 +25%로 시작하고, 시작 땅은 🌾대평야(세금 +20%·인구 상한 +30%, 누가 차지해도 유지).</li>
          <li><b>토착 세력</b>: 빈 땅에도 수비병이 있고(4.5천~1만), 15%는 2~3배 강한 토호의 산채입니다.</li>
          <li><b>지출</b>: 병사 1명당 1금/턴, 장수 녹봉 2,500금, 영토 15곳 초과분 1곳당 통치비 1,250금. 국고가 바닥나면 탈영.</li>
          <li><b>부대 (삼국지14식)</b>: 지역을 눌러 ⚔️출진 → 장수와 병력을 고르면 지도에 부대 말이 생깁니다. 부대 말을 누르고 목적지를 누르면 매 턴 내 땅으로 3칸씩 진군하다 닿으면 공격합니다(불리하면 국경에서 대기, ⚔️무리해서 공격 가능). 지역 패널에서 ➕보충·⏹멈춤·🏠귀환.</li>
          <li><b>계략 🧠</b>: 지역 패널의 🧠계략 — 화계(맞닿은 적 땅 병력 -15~25%)·유언비어(적 장수 충성 -15)·매복(이번 턴 수비 +25%). 지력 50↑ 장수, 장수마다 턴에 한 번, 행동력 1.</li>
          <li><b>징병</b>: 지도에서 내 땅 여러 곳을 골라 슬라이더로 인원을 정하면 처음 고른 곳으로 모입니다. 인구 상한 없이 금(1명당 5금)이 닿는 만큼, 대신 뽑은 만큼 그 땅 인구가 1:1로 줄어 세수가 떨어지고 병사마다 유지비 1금/턴(해산하면 인구로 돌아옴). <b>자원병</b>: 평판×40명이 매 턴 수도·병영에 모임(흑자일 때, 위기면 3배).</li>
          <li><b>⏩ 빠른 진행·체크리스트</b>: 내게 일이 생길 때까지 자동으로 턴을 넘기고, 지도 왼쪽 위에 이번 턴 챙길 것을 보여 줍니다.</li>
          <li><b>요격·협공</b>: 공격받는 땅과 맞닿은 같은 나라 땅에 장수가 있으면 그 부대가 달려와 함께 싸웁니다(병력 절반). 한 턴에 두 곳 이상에서 같은 땅을 치면 협공 +15%. 적 부대도 지도에 부대 말로 보입니다.</li>
          <li><b>장수 수련</b>: 장수 창 📚 — 금(레벨×2.5만)·행동력 1로 경험치 +레벨×50, 장수마다 3턴에 한 번.</li>
          <li><b>전선 관리</b>: 이미 싸우는 중에 새 나라를 치면 평판 -5. 평판이 바닥이면 주변 나라 모두의 표적이 되고 자원병도 줄어듭니다.</li>
          <li><b>군단 (토탈워식)</b>: 나라를 치려면 장수가 이끄는 군단이 필요합니다. 장수 한 명이 군단 하나이고, 이끌 수 있는 병력은 통솔로 정해집니다(8천+통솔×800, 함께 가는 장수는 절반씩 더함). 빈 땅·도적을 칠 때도 장수가 있어야 합니다. 지역의 장수 줄에서 🎯목표 지정 → 매 턴 내 땅으로 3칸씩 진군하다 닿으면 공격합니다. 장수가 모자라면 장수 창에서 📜장수 모집.</li>
          <li><b>징병</b>: 상단 💂징병(또는 지역의 💂여기로 징병) 한 번으로 모든 내 땅에서 인구의 4%(병영 8%)씩 뽑아, 제자리·집결지·지도에서 고른 곳으로 행군시킵니다. 1명당 5금, 행동력 2, 한 턴에 한 번. 병사 1명당 유지비 1금/턴이라 많이 뽑으면 파산합니다.</li>
          <li><b>자원병</b>: 보급이 이어진 내 땅에서는 매 턴 백성이 스스로 입대합니다(병영 2배). 영토를 잃거나 수도가 위협받으면 4배.</li>
          <li><b>장수 충성·성격</b>: 🔥야심가는 충성이 쉽게 떨어지고 🛡️충신은 점점 오릅니다. 충성 40 미만 장수는 지키던 땅을 들고 <b>영웅 봉기</b>로 독립할 수 있으니 장수 창에서 🎁포상하세요(금, 장수마다 6턴에 한 번). 평판·인덕 군주가 충성을 받쳐 줍니다.</li>
          <li><b>군주의 죽음·계승 분쟁</b>: 군주는 늙거나 전사·처형으로 죽을 수 있습니다. 큰 나라(8곳↑)에서 새 군주가 즉위하면 야심가나 충성 낮은 2인자가 왕위를 다투며 나라를 둘로 가를 수 있습니다.</li>
          <li><b>군단 명령</b>: 분봉한 군단에 ⚔️자유·🛡️수비·🎯○○ 공략을 명할 수 있습니다(국가 카드 또는 군단 땅을 눌러서).</li>
          <li><b>명소 🏛️</b>: 이름난 큰 고을. 가진 곳마다 나라 전체 세수 +5%.</li>
          <li><b>적의 의도</b>: 내 땅과 맞닿은 적 대군(내 수비의 1.2배↑)에 빨간 점선 화살표가 그려집니다.</li>
          <li><b>레벨업 특성 선택</b>: 내 장수가 Lv3·5·7·9가 되면 승급·새 특성 중 고릅니다.</li>
          <li><b>의형제 🤝</b>: 함께 싸우면 +10%, 같은 나라에 있으면 충성 +10, 봉기할 땐 함께 떠남, 형제를 처형하면 충성 -30.</li>
          <li><b>사건 카드</b>: 가끔 선택지가 있는 사건이 옵니다(흉년·혼인 동맹·기습 간언·무기 상인·명의·인재 천거 등). 역사 시나리오에는 그 시대의 역사 카드도 나옵니다.</li>
          <li><b>변방 침입</b>: 나라들 한가운데에서 먼 변방에 이민족(흉노·여진·바이킹…)이나 해적(왜구·바르바리…)이 쳐들어와 땅을 빼앗습니다. 변방국일수록 등이 위험합니다.</li>
          <li><b>후방 징병</b>: 징병 창의 「보낼 곳」에서 다른 내 지역을 고르면, 내 땅 3칸마다 1턴 걸려 그곳에 도착(🗺️ 지도에서 고르기 가능)(도착지를 잃으면 출발지로).</li>
          <li><b>천운</b>: 한 나라가 육지 25%를 넘게 차지하면 가끔(언제일지 모름, 앞설수록 잦음) 대반란·명장 망명·반패권 원조 중 하나가 일어납니다. 한 판에 최대 2번.</li>
          <li><b>용병</b>: 장수가 이끄는 공격 계획에서만 고용. 장수 통솔이 높을수록 많이, 정치가 높을수록 싸게. 그 전투만 함께 싸우고 떠남(손실도 나눠 짐).</li>
          <li><b>매수</b>: 맞닿은 내 지역에 장수가 있어야 함. 지력·정치가 높을수록 성공, 수비 장수·성벽이 있으면 어려움. 실패하면 금은 상대 나라가 가짐. 수도·동맹·도적 무리는 불가.</li>
          <li><b>분봉</b>: 내 지역에서 🏯분봉 → 장수에게 이어진 땅 몇 곳을 맡기면 그 장수가 컴퓨터처럼 알아서 다스리고 싸움(내 외교를 따름, 상납 없음. 「○○에 성을 쌓으려 하니 금 X를 달라」처럼 실제로 할 일을 청하고, 주면 바로 시행·충성↑, 거절하면 충성↓. 통일에 포함). 군단 땅을 눌러 언제든 회수. 충성 40 미만이면 역모로 독립할 수 있음.</li>
          <li><b>도적·이민족</b>: 빈 땅에서 일어난 도적과 변방에 쳐들어온 이민족·해적(동시에 최대 3). 외교는 안 되지만 땅 매수, 🤝화친(돈 주고 8턴 불가침), 🏳️귀순(큰돈으로 통째로 흡수)이 가능 — 돈만 받고 응하지 않을 수도 있음. 가끔 돈을 내놓으라 협박하고, 거절하면 노립니다. 6곳 이상 차지하면 나라로 승격.</li>
          <li><b>지역 목록</b>: 국가 카드의 📋 지역 목록에서 병력·인구 순으로 보고, 이름을 누르면 그 지역으로 이동.</li>
          <li><b>속국</b>: 수입 25% 조공, 종주국과 맞닿은 적을 함께 공격, 속국 땅도 통일(100%)에 포함.</li>
          <li><b>보급</b>: 수도와 끊긴 지역은 ✂ 표시, 병력이 매 턴 1~10% 무작위 감소, 전투력 -20%(보급 특성으로 경감).</li>
          <li><b>공성</b>: 성벽(내구 3)이 있으면 공격 방식 선택. 포위=이겨도 성벽만 깎음(1, 압승 2, 공성 장수 추가), 0이 되면 함락. 강습=이기면 바로 함락하지만 성벽 효과 2배·손실 1.5배. 포위당하지 않은 턴엔 성벽 복구.</li>
          <li><b>날씨</b>: 북쪽은 눈(공격 -25%, AP+1, 세수 -25%), 남쪽은 가뭄(세수 -35%)이 잦지만 남쪽은 풍년(+35%)도 잦아 연간 손익이 비슷합니다. 비는 도강을 어렵게, 폭풍은 항해를 막습니다.</li>
          <li><b>사건</b>: 역병·홍수·지진·금광·교역 호황·해적·도적·용병단·장수 출분 등 어느 나라에나 일어나는 사건이 턴 소식에 카드로 나옵니다.</li>
          <li><b>이간계</b>: 외교 창에서 두 나라를 골라 금·행동력 1로 이간질 — 성공하면 둘의 호감 -35, 절반 확률로 둘의 동맹·불가침이 깨집니다. 들키면 두 나라가 나를 미워합니다.</li>
          <li><b>역사 강역</b>: 역사 시나리오는 그 시대의 실제 판도로 시작합니다. 수도 가까운 땅은 본토, 먼 땅은 변경(병력 절반·충성 낮음)입니다.</li>
          <li><b>세력 균형</b>: 국력이 평균의 2배를 넘으면 주변국 호감이 계속 떨어지고, 1위가 2.5배를 넘으면서 육지의 35% 이상을 가지면 대동맹이 결성됩니다. AI 회원국끼리는 싸우지 않고 패권국을 노리며, 패권국의 침공에 방어 +15%.</li>
          <li><b>일기토</b>: 반격 &gt; 공격 &gt; 방어 &gt; 반격의 가위바위보, 같은 수끼리는 서로 절반 피해. 체력 = 60 + 무력×0.7 + 통솔×0.2, 위력 = 6 + (무력-30)×0.55(맹장·무쌍 특성 가산). 상대 의도 간파는 무력 85%·지력 15%의 전장 감각 차이로 정해져 힌트로 보입니다. 이기면 전투력 +15%, 지면 -15%. 낙마하면 절반 확률로 전사.</li>
          <li><b>장수와 전투력</b>: 장수는 병사 수를 늘리지 않고 배율을 올립니다. 공격 시 동행 장수 중 최고 (무력+통솔)/2 ÷ 250(최대 약 +40%) + 특성, 방어 시 주둔 장수 최고 (통솔×0.6+지력×0.4) ÷ 250 + 특성.</li>
          <li><b>장수</b>: 무관·문관으로 나뉘고 특성은 Ⅰ~Ⅲ 등급. 등급은 F~SSR. 기본은 공평한 무작위 능력치(이름만 역사 인물이고 능력·주특기는 무작위, 나라마다 장수 수준 합이 비슷 — 뛰어난 장수가 있으면 다음 장수는 약해짐). 레벨이 오르면 특성 승급·추가와 칭호. 포로는 등용·처형·석방, 적 장수는 금으로 회유. 멸망한 나라의 왕은 승자의 장수가 되고, 충성이 낮으면 옛 나라를 부흥시킬 수 있습니다.</li>
          <li><b>천도</b>: 수도와 길이 이어진 내 땅을 골라 🏯천도 — 금·3AP, 12턴에 한 번. 컴퓨터도 수도가 위험하면 천도합니다.</li>
          <li><b>해협</b>: 간몬·쓰가루·도버·메시나·보스포루스·지브롤터 등 좁은 해협은 흰 점선으로 이어져 배 없이 건널 수 있습니다(-30%, AP+1).</li>
          <li><b>지도 보기</b>: 휠·＋－·두 손가락으로 확대, 끌어서 이동. 폰에서는 지역을 누르면 정보창이 아래에서 올라옵니다(📋 버튼으로 열고 닫기). 병력을 모르는 지역은 이름만 보입니다.</li>
          <li><b>태수</b>: 지역에 주둔한 장수 중 정치가 가장 높은 장수가 태수. 정치 50 초과분만큼 세수 증가(정치 90 = +16%). 무관은 효과 절반.</li>
          <li><b>신흥국</b>: 빈 땅의 봉기, 영웅 봉기, 계승 분쟁, 옛 왕의 부흥으로 새 나라가 생깁니다. 지도에서 깜빡이고 소식 카드가 뜹니다.</li>
          <li><b>외교</b>: 금·영토 거래, 동맹(상호 공격 불가), 불가침, 정전(6턴, 땅을 잃는 쪽이 원함), 속국, 공동 공격, 속국 병합. 동맹국 땅으로 이동하면 원군(병사만) 파견. 불가침·종속 상대를 공격하면 배신 페널티.</li>
          <li><b>전황</b>: 시야 안의 전투만 다시보기·화살표로 보여줍니다. 📽️ 연대기로 영토 변화를 돌려볼 수 있습니다.</li>
        </ul>
        <h4>건물</h4>
        <ul>
          {Object.values(BUILDINGS).map((b) => (
            <li key={b.name}>
              {b.icon} {b.name} ({fmtGold(b.cost)}금·{b.ap}AP): {b.desc}
            </li>
          ))}
        </ul>
        <h4>장수 특성</h4>
        <p className="muted">특성은 무관 16종·문관 13종, 등급 Ⅰ~Ⅲ에 따라 효과가 커집니다. 전체 목록은 ⭐장수 → 출현 규칙 탭에서 볼 수 있습니다.</p>
        <p className="muted">문명: {Object.values(CIVS).map((c) => c.name).join(', ')}</p>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ text, onYes, onNo }) {
  return (
    <div className="modal-bg" style={{ zIndex: 20 }} onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="modal" style={{ width: 'min(400px, 100%)' }}>
        <p style={{ marginTop: 0 }}>{text}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onNo}>취소</button>
          <button className="primary" onClick={onYes}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────── 일기토 ─────────
export function DuelModal({ game, attId, defId, onFinish }) {
  const ag = game.generals[attId], dg = game.generals[defId];
  const rng = useMemo(() => makeRng(Date.now()), []);
  const [d, setD] = useState(() => newDuel(ag, dg));
  const [busy, setBusy] = useState(false);
  const history = game.duelMoves || [];
  // 매 합마다 상대가 먼저 수를 정하고, 내 장수 지력으로 그 의도를 간파할 수 있음
  const intent = () => {
    const plan = aiMove(rng, dg, ag, null, [...history, ...d.rounds.map((r) => r.m1)]);
    return { plan, seen: rng() < readChance(ag, dg) };
  };
  const [it, setIt] = useState(intent);
  const play = (m) => {
    if (busy) return;
    const next = structuredClone(d);
    // 상대도 지력으로 내 수를 읽으면 수를 바꿈
    const am = rng() < readChance(dg, ag) ? bestResponse(m) : it.plan;
    duelRound(next, ag, dg, m, am, rng);
    setD(next);
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      const plan = aiMove(rng, dg, ag, null, [...history, ...next.rounds.map((r) => r.m1)]);
      setIt({ plan, seen: rng() < readChance(ag, dg) });
    }, 2700);
  };
  const bar = (hp, max, color) => (
    <div className="odds" style={{ background: '#444' }}>
      <i style={{ width: `${(hp / max) * 100}%`, background: color, transition: 'width .4s .5s' }} />
    </div>
  );
  const last = d.rounds[d.rounds.length - 1];
  const n = d.rounds.length;
  const showEnd = d.done && !busy;
  const downA = showEnd && d.hpA <= 0, downB = showEnd && d.hpB <= 0;
  return (
    <Modal title="⚔️ 일기토">
      <div className="diplo">
        <div className="card">
          <b>{ag.name}</b> <small className="muted">무{ag.war} 지{ag.intel}</small> <TraitTags g={ag} />
          {bar(d.hpA, d.maxA, 'var(--ok)')}
          <small>
            체력 {d.hpA}/{d.maxA}
          </small>
        </div>
        <div className="card">
          <b>{dg.name}</b> <small className="muted">무{dg.war} 지{dg.intel}</small> <TraitTags g={dg} />
          {bar(d.hpB, d.maxB, 'var(--danger)')}
          <small>
            체력 {d.hpB}/{d.maxB}
          </small>
        </div>
      </div>
      {(() => {
        // 이번 합의 승자: L(내 장수) / R(상대) / tie
        const win = !last ? null : last.dB > 0 && last.dA === 0 ? 'L' : last.dA > 0 && last.dB === 0 ? 'R' : 'tie';
        return (
          <div className={'arena' + (win ? ' win-' + win : '')} key={n}>
            <div className="ground" />
            {n > 0 && (
              <>
                <div className="dust L" />
                <div className="dust R" />
              </>
            )}
            <div className={'rider L' + (n ? ' go' : '') + (downA ? ' down' : '') + (win === 'R' ? ' hit' : '')}>🏇</div>
            <div className={'rider R' + (n ? ' go' : '') + (downB ? ' down' : '') + (win === 'L' ? ' hit' : '')}>🏇</div>
            {last && (
              <>
                <div className={'mv L' + (win === 'L' ? ' won' : win === 'R' ? ' lost' : '')}>
                  <span className="mv-ic">{MOVES[last.m1].icon}</span> {MOVES[last.m1].name}
                </div>
                <div className={'mv R' + (win === 'R' ? ' won' : win === 'L' ? ' lost' : '')}>
                  <span className="mv-ic">{MOVES[last.m2].icon}</span> {MOVES[last.m2].name}
                </div>
                <div className="clash">💥</div>
                <div className={'verdict ' + win}>{win === 'L' ? `${ag.name} 우세!` : win === 'R' ? `${dg.name} 우세!` : '맞부딪침 — 서로 상처'}</div>
                {last.dA > 0 && <div className="dmg L">-{last.dA}</div>}
                {last.dB > 0 && <div className="dmg R">-{last.dB}</div>}
              </>
            )}
            {!n && <div className="arena-hint">두 장수가 말을 몰아 마주섰다…</div>}
          </div>
        );
      })()}
      <div className="col" style={{ marginTop: 8, fontSize: 13, maxHeight: 120, overflow: 'auto' }}>
        {d.rounds.map((r, i) => (
          <div key={i}>
            {i + 1}합: {MOVES[r.m1].icon}{MOVES[r.m1].name} vs {MOVES[r.m2].icon}{MOVES[r.m2].name} → {ag.name} -{r.dA} / {dg.name} -{r.dB}
          </div>
        ))}
      </div>
      {!d.done || busy ? (
        <>
          <div className="card" style={{ marginTop: 8, fontSize: 13 }}>
            {busy ? '…' : it.seen ? (
              <>
                👁️ 간파! {fixJosa(`${dg.name}은(는)`)} <b>{MOVES[it.plan].icon} {fixJosa(`${MOVES[it.plan].name}을(를)`)}</b> 노리는 듯하다. <small className="muted">(상대도 내 수를 읽으면 바꿀 수 있음)</small>
              </>
            ) : (
              <span className="muted">🌫️ {dg.name}의 의도를 읽지 못했다.</span>
            )}{' '}
            <small className="muted">간파 확률 {Math.round(readChance(ag, dg) * 100)}% · 상대 간파 {Math.round(readChance(dg, ag) * 100)}%</small>
          </div>
          <div className="actions" style={{ marginTop: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
            {Object.entries(MOVES).map(([k, m]) => (
              <button key={k} onClick={() => play(k)} title={m.desc} disabled={busy || d.done}>
                {m.icon} {m.name}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            반격 &gt; 공격 &gt; 방어 &gt; 반격 (가위바위보). 같은 수끼리는 서로 절반 피해. 최대 6합. 무력(85%)과 지력(15%)으로 정한 전장 감각이 높을수록 상대 의도를 미리 간파하고, 같은 수를 반복하면 상대가 버릇을 노립니다.
          </div>
        </>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <b>{d.winner === 0 ? '무승부!' : `${d.winner === 1 ? ag.name : dg.name} 승리!${d.ko ? ' (낙마)' : ' (판정)'}`}</b>
          <button className="primary" onClick={() => onFinish(d)}>
            전투 개시 ▶
          </button>
        </div>
      )}
    </Modal>
  );
}

// ───────── 전투 다시보기 ─────────
export function BattleReplay({ game, battles, index, onNext, onSkip, delay = 1200, onSpeed }) {
  const b = battles[index];
  useEffect(() => {
    const t = setTimeout(onNext, delay);
    return () => clearTimeout(t);
  }, [index, onNext, delay]);
  const att = game.nations[b.attacker];
  const def = b.defender === null ? null : game.nations[b.defender];
  const res = b.result === 'win' ? '점령' : b.result === 'siege' ? '포위 공격' : '격퇴됨';
  return (
    <div className="replay">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>
          ⚔️ 전투 {index + 1}/{battles.length}
        </b>
        <span className="row" style={{ gap: 4 }}>
          <button className="sm" onClick={onSpeed} title="다시보기 속도">
            {delay < 1000 ? '⏩ 2배속' : '▶ 1배속'}
          </button>
          <button className="sm" onClick={onNext}>
            다음 ⏭
          </button>
          <button className="sm" onClick={onSkip}>
            모두 건너뛰기
          </button>
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <span className="chip" style={{ background: att.color }} />
        {att.name} → {def ? (
          <>
            <span className="chip" style={{ background: def.color }} />
            {def.name}
          </>
        ) : (
          '중립 세력'
        )}{' '}
        · {game.regions[b.to].name} · {b.kind && <span className="tag">{BATTLE_KIND[b.kind]}</span>} <b style={{ color: b.result === 'win' ? 'var(--accent)' : undefined }}>{res}</b>
      </div>
      <BattleField key={index} b={b} att={att} def={def} />
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {b.msg}
      </div>
    </div>
  );
}

// 전투 장면: 양쪽 군세(병력만큼 병사 그림)가 맞붙고, 일기토·요격·협공 같은 효과를 배지로
function BattleField({ b, att, def }) {
  const tags = [];
  if (b.duel) tags.push(`⚔️ 일기토 ${b.duel.a} vs ${b.duel.b}${b.duel.killed ? ` — ${b.duel.killed} 전사` : ''}`);
  if (/요격/.test(b.msg || '')) tags.push('🛡️ ' + (b.msg.match(/요격: ([^\]/]+)/)?.[1] || '요격').trim());
  if (/협공/.test(b.msg || '')) tags.push('🗡️ 협공 +15%');
  if (/용병/.test(b.msg || '')) tags.push('💰 용병 참전');
  if (b.siege) tags.push(`🏰 성벽 ${b.siege.before}→${b.siege.after}`);
  if (/성벽 붕괴/.test(b.msg || '')) tags.push('💥 성벽 붕괴');
  const win = b.result === 'win';
  return (
    <div className="battlefield">
      <svg viewBox="0 0 300 92" width="100%" height="92">
        <rect x="0" y="62" width="300" height="30" fill="#7a8a4a" opacity="0.35" />
        <g className="bf-left">
          <g transform="translate(70,74)">
            <Army tier={armyTier(b.count)} color={att.color} u={9} />
          </g>
          <text x="70" y="88" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">{fmtTroops(b.count)}</text>
        </g>
        <g className="bf-right">
          <g transform="translate(230,74) scale(-1,1)">
            <Army tier={armyTier(b.defTroops)} color={def ? def.color : '#8a8577'} u={9} />
          </g>
          <text x="230" y="88" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">{fmtTroops(b.defTroops)}</text>
        </g>
        <text className="bf-clash" x="150" y="50" textAnchor="middle" fontSize="26">💥</text>
        <text x="150" y="16" textAnchor="middle" fontSize="11" fontWeight="800" fill={win ? '#e8a33a' : '#e2655a'}>
          {win ? '점령!' : b.result === 'siege' ? '포위 공격' : '격퇴'}
        </text>
        {(b.attLoss || b.defLoss) && (
          <text x="150" y="30" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.8">
            손실 {fmtTroops(b.attLoss || 0)} : {fmtTroops(b.defLoss || 0)}
          </text>
        )}
      </svg>
      {tags.length > 0 && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {tags.map((t, i) => (
            <span key={i} className="tag">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── 연대기 ─────────
export function ChronicleModal({ world, game, onClose, view }) {
  const frames = useMemo(() => [...(game.history || []), null], [game.history]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (i < frames.length - 1 ? setI(i + 1) : setPlaying(false)), 450);
    return () => clearTimeout(t);
  }, [i, playing, frames.length]);
  const owners = frames[i] === null ? game.regions.map((r) => r.owner) : decodeOwners(frames[i]);
  const regions = owners.map((o) => ({ owner: o, troops: 0, buildings: {} }));
  const nations = game.nations.map((n) => ({ ...n, alive: false }));
  const counts = {};
  owners.forEach((o) => o !== null && (counts[o] = (counts[o] || 0) + 1));
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return (
    <Modal title="📽️ 연대기" onClose={onClose} wide>
      <div style={{ height: 420, borderRadius: 8, overflow: 'hidden' }}>
        <MapView world={world} regions={regions} nations={nations} compact view={game.gameOver ? undefined : view} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="sm" onClick={() => (i >= frames.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? '⏸' : '▶'}
        </button>
        <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(+e.target.value))} style={{ flex: 1 }} />
        <b>{i + 1}턴</b>
      </div>
      <div className="row" style={{ marginTop: 6, fontSize: 13 }}>
        {top.map(([nid, c]) => (
          <span key={nid}>
            <span className="chip" style={{ background: game.nations[nid].color }} />
            {game.nations[nid].name} {c}
          </span>
        ))}
      </div>
    </Modal>
  );
}

// ───────── 관전 모드: 난입·지원 ─────────
export function TakeoverModal({ game, onPick, onClose }) {
  const alive = game.nations.filter((n) => n.alive).sort((a, b) => nationRegions(game, b.id).length - nationRegions(game, a.id).length);
  return (
    <Modal title="🎯 어느 나라로 난입할까요?" onClose={onClose}>
      <div className="col">
        {alive.map((n) => (
          <button key={n.id} className="nation-item" onClick={() => onPick(n.id)}>
            <span>
              <span className="chip" style={{ background: n.color }} />
              {n.name}
            </span>
            <small className="muted">
              영토 {nationRegions(game, n.id).length} · 금 {fmtGold(n.gold)} · 장수 {nationGenerals(game, n.id).length}
            </small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function GodModal({ game, onGift, onClose }) {
  const alive = game.nations.filter((n) => n.alive);
  const [nid, setNid] = useState(alive[0]?.id ?? 0);
  return (
    <Modal title="🎁 지원 (관전 중 개입)" onClose={onClose}>
      <div className="col">
        <select value={nid} onChange={(e) => setNid(+e.target.value)}>
          {alive.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <div className="actions">
          <button onClick={() => onGift(nid, 'gold', 100 * G)}>💰 금 +{fmtGold(100 * G)}</button>
          <button onClick={() => onGift(nid, 'gold', 500 * G)}>💰 금 +{fmtGold(500 * G)}</button>
          <button onClick={() => onGift(nid, 'troops', 10000)}>💂 수도 병력 +1만</button>
          <button onClick={() => onGift(nid, 'troops', 50000)}>💂 수도 병력 +5만</button>
          <button onClick={() => onGift(nid, 'general')}>⭐ 장수 1명 출현</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>판을 지켜보다 원하는 나라를 밀어줄 수 있습니다. 준 내역은 기록에 남습니다.</div>
      </div>
    </Modal>
  );
}

// ───────── 저장·불러오기 ─────────
export function SaveModal({ game, onLoad, toast, onClose }) {
  return (
    <Modal title="💾 저장·불러오기" onClose={onClose}>
      <SaveSlots current={game ? { scenarioId: game.scenarioId, seed: game.seed, state: game } : null} onLoad={onLoad} onSaved={toast} />
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>자동 저장은 매 행동마다 갱신됩니다. 저장은 이 브라우저(기기)에만 남습니다.</div>
    </Modal>
  );
}

// ───────── 지역 목록 ─────────
export function LoyaltyModal({ world, game, onFocus, onClose }) {
  const pid = game.playerId;
  const [sort, setSort] = useState('troops');
  const list = nationRegions(game, pid)
    .filter((rid) => !game.regions[rid].sea)
    .map((rid) => {
      const r = game.regions[rid];
      const inner = world.regions[rid].neighbors.every((x) => game.regions[x.id].sea || game.regions[x.id].owner === pid);
      return { rid, r, inner };
    })
    .sort((a, b) => (sort === 'troops' ? b.r.troops - a.r.troops : b.r.pop - a.r.pop));
  return (
    <Modal title="📋 지역 목록" onClose={onClose} wide>
      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <span>정렬</span>
        {[['troops', '💂 병력'], ['pop', '👥 인구']].map(([k, l]) => (
          <button key={k} className={'sm' + (sort === k ? ' primary' : '')} onClick={() => setSort(k)}>{l}</button>
        ))}
        <small className="muted">이름을 누르면 그 지역으로 이동</small>
      </div>
      <div className="col" style={{ maxHeight: '55vh', overflow: 'auto', gap: 4 }}>
        {list.map((x) => (
          <div key={x.rid} className="row" style={{ gap: 8, fontSize: 13, borderBottom: '1px dashed var(--line)', padding: '3px 0' }}>
            <a style={{ flex: 1, cursor: 'pointer' }} onClick={() => onFocus(x.rid)}>
              {x.r.name} <small className="muted">{x.inner ? '내륙' : '국경'}{game.nations[pid].capital === x.rid ? ' · 수도' : ''}</small>
            </a>
            <span style={{ width: 70, textAlign: 'right' }}>💂 {fmtTroops(x.r.troops)}</span>
            <span className="muted" style={{ width: 54, textAlign: 'right' }}>👥 {Math.round(x.r.pop)}천</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ───────── 매수: 맞닿은 곳의 장수가 돈으로 지역을 넘어오게 함 ─────────
export function BribeModal({ world, game, rid, act, onClose }) {
  const pid = game.playerId;
  const r = game.regions[rid];
  const agents = bribeAgents(game, world, pid, rid).sort((a, b) => bribeChance(game, world, pid, rid, b) - bribeChance(game, world, pid, rid, a));
  const [gid, setGid] = useState(agents[0]?.id);
  const g = game.generals[gid];
  const cost = bribeCost(game, rid);
  const err = gid === undefined ? '맞닿은 내 지역에 장수가 없습니다.' : bribeCheck(game, world, pid, rid, gid);
  const owner = r.owner === null ? '중립 세력' : game.nations[r.owner].name;
  return (
    <Modal title={`💰 ${r.name} 매수`} onClose={onClose}>
      <div className="col">
        <div className="muted" style={{ fontSize: 13 }}>
          {owner}의 땅을 돈으로 넘어오게 합니다. 장수의 지력·정치가 높을수록 잘 되고, 수비 장수·성벽이 있으면 어렵습니다. <b>실패하면 금은 {r.owner === null ? '날아갑니다' : `${owner}이(가) 갖습니다`}.</b> 성공하면 수비병 절반이 귀순합니다.
        </div>
        <div className="gen-picks">
          {agents.map((a) => (
            <button key={a.id} className={'gen-pick' + (a.id === gid ? ' on' : '')} onClick={() => setGid(a.id)}>
              <span>{a.id === gid ? '✅' : '⬜'} <b>{a.name}</b></span>
              <small>지{a.intel} 정{a.pol} · 성공률 {Math.round(bribeChance(game, world, pid, rid, a) * 100)}%</small>
            </button>
          ))}
        </div>
        <div className="kv">
          <span>비용</span>
          <span>{fmtGold(cost)}금 · 1 AP (보유 {fmtGold(game.nations[pid].gold)})</span>
          <span>성공률</span>
          <span>{g ? `${Math.round(bribeChance(game, world, pid, rid, g) * 100)}%` : '-'}</span>
        </div>
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!!err} onClick={() => { const res = act((s) => doBribe(s, world, pid, rid, gid)); if (res?.ok || res?.done) onClose(); }}>
            💰 매수 시도
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────── 분봉: 장수에게 땅을 맡겨 스스로 다스리게 함 ─────────
export function FiefModal({ world, game, rid, act, onClose }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const gens = nationGenerals(game, pid).filter((g) => g.id !== me.ruler && !g.order).sort((a, b) => (b.loyalty ?? 60) - (a.loyalty ?? 60));
  const mine = nationRegions(game, pid).length;
  const [gid, setGid] = useState(gens[0]?.id);
  const [n, setN] = useState(Math.min(5, Math.max(1, mine - 2)));
  const rids = fiefRegions(game, world, pid, rid, n);
  const err = grantFiefCheck(game, pid, gid, rids);
  const g = game.generals[gid];
  return (
    <Modal title="🏯 분봉 — 장수에게 땅 맡기기" onClose={onClose}>
      <div className="col">
        <div className="muted" style={{ fontSize: 13 }}>
          맡긴 땅은 장수가 컴퓨터처럼 알아서 다스리고 싸웁니다(내 외교를 따름). 상납은 없고, 성 쌓기·징병 같은 큰일이 있으면 금을 청합니다(주면 실제로 시행). 그 땅도 통일에 포함됩니다. 언제든 회수할 수 있지만, <b>충성 40 미만이면 역모로 독립할 수 있습니다</b>.
        </div>
        <div className="gen-picks">
          {gens.map((x) => (
            <button key={x.id} className={'gen-pick' + (x.id === gid ? ' on' : '')} onClick={() => setGid(x.id)}>
              <span>{x.id === gid ? '✅' : '⬜'} <b>{x.name}</b></span>
              <small style={{ color: (x.loyalty ?? 60) < 40 ? 'var(--danger)' : undefined }}>
                충성 {Math.round(x.loyalty ?? 60)} · 무{x.war} 통{x.lead} 지{x.intel} 정{x.pol}
              </small>
            </button>
          ))}
        </div>
        <label>
          맡길 땅 {rids.length}곳 ({game.regions[rid].name}에서 이어진 곳, 수도 제외)
          <Slider min={1} max={Math.max(1, mine - 2)} value={n} onChange={setN} style={{ width: '100%' }} />
        </label>
        <small className="muted">{rids.map((x) => game.regions[x].name).join(', ')}</small>
        {g && (g.loyalty ?? 60) < 40 && <div style={{ color: 'var(--danger)' }}>⚠️ 충성이 낮아 역모 위험이 큽니다.</div>}
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!!err} onClick={() => { const res = act((s) => grantFief(s, world, pid, gid, rids)); if (res?.ok) onClose(); }}>
            🏯 맡기기 (1 AP)
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────── 병력 불러오기: 어디서 몇 명 데려올지 ─────────
export function CallModal({ world, game, rid, act, onClose }) {
  const pid = game.playerId;
  const dist = useMemo(() => ownDistances(game, world, pid, rid), [game, world, pid, rid]);
  const list = [...dist.entries()].filter(([x]) => x !== rid).map(([x, d]) => ({ x, d, can: Math.max(0, Math.min(movable(game, x), game.regions[x].troops - 100)) })).filter((o) => o.can >= 100).sort((a, b) => a.d - b.d);
  const [want, setWant] = useState({});
  const total = list.reduce((a, o) => a + (want[o.x] || 0), 0);
  return (
    <Modal title={`📯 ${game.regions[rid].name}(으)로 병력 불러오기`} onClose={onClose} wide>
      <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>각 지역에서 보낼 병력을 정하세요. 내 땅 3칸에 1턴 — 직접 행군과 같은 속도 걸려 도착하고, 길이 끊기면 그 앞 내 땅에서 멈춥니다. (행동력 1)</div>
      <div className="col" style={{ maxHeight: '50vh', overflow: 'auto', gap: 4 }}>
        {!list.length && <div className="muted">보낼 수 있는 병력이 없습니다.</div>}
        {list.map((o) => (
          <div key={o.x} className="row" style={{ gap: 8, fontSize: 13 }}>
            <span style={{ width: 120 }}>{game.regions[o.x].name} <small className="muted">{reinforceTurns(o.d)}턴</small></span>
            <Slider min={0} max={o.can} step={100} value={want[o.x] || 0} onChange={(v) => setWant({ ...want, [o.x]: v })} style={{ flex: 1 }} />
            <span style={{ width: 120, textAlign: 'right' }}>{fmtTroops(want[o.x] || 0)} / {fmtTroops(o.can)}</span>
            <button className="sm" onClick={() => setWant({ ...want, [o.x]: o.can })}>전부</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <span className="muted">합계 {fmtTroops(total)}</span>
        <button onClick={onClose}>취소</button>
        <button className="primary" disabled={!total || game.nations[pid].ap < 1} onClick={() => { const res = act((s) => callTroops(s, world, pid, rid, Object.entries(want).map(([k, v]) => ({ rid: +k, count: v })))); if (res?.ok) onClose(); }}>
          📯 불러오기
        </button>
      </div>
    </Modal>
  );
}

// ───────── 해산 ─────────
export function DisbandModal({ game, rid, act, onClose }) {
  const pid = game.playerId;
  const r = game.regions[rid];
  const max = Math.max(0, r.troops - 100);
  const [n, setN] = useState(Math.min(max, Math.round(max / 2 / 100) * 100));
  return (
    <Modal title={`🏳️ ${r.name} 병사 해산`} onClose={onClose}>
      <label>
        {fmtTroops(n)} / {fmtTroops(max)}
        <Slider min={0} max={max} step={100} value={n} onChange={setN} style={{ width: '100%' }} />
      </label>
      <div className="muted" style={{ fontSize: 13 }}>유지비 -{fmtGold(n)}금/턴 · 인구 +{(n / 1000).toFixed(1)}천 · 행동력 없음</div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button onClick={onClose}>취소</button>
        <button className="primary" disabled={n < 100} onClick={() => { const res = act((s) => doDisband(s, pid, rid, n)); if (res?.ok) onClose(); }}>해산</button>
      </div>
    </Modal>
  );
}

// 이간계: 두 나라를 골라 서로 싸우게 함
function SowBox({ game, act }) {
  const pid = game.playerId;
  const others = game.nations.filter((n) => n.alive && n.id !== pid && !n.horde);
  const [a, setA] = useState(others[0]?.id);
  const [b, setB] = useState(others[1]?.id);
  if (others.length < 2) return null;
  const err = sowCheck(game, pid, a, b);
  return (
    <div className="card row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
      <b>🗡️ 이간계</b>
      <select value={a} onChange={(e) => setA(+e.target.value)}>{others.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
      <span>↔</span>
      <select value={b} onChange={(e) => setB(+e.target.value)}>{others.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
      <button className="sm primary" disabled={!!err} onClick={() => act((s) => doSow(s, pid, a, b, stateRng(s)))}>
        이간 ({a !== b && a != null && b != null ? fmtGold(sowCost(game, a, b)) : '-'}금 · 1AP · 성공 {Math.round(sowChance(game, pid) * 100)}%)
      </button>
      <small className="muted">{err || '성공하면 두 나라 호감 -35, 절반 확률로 둘의 동맹·불가침이 깨짐. 들키면 두 나라가 나를 미워함. 지력 높은 장수가 있으면 잘 됨.'}</small>
    </div>
  );
}

// 징병: 지도에서 고른 지역마다 슬라이더로 인원을 정해 뽑고, 처음 고른 지역으로 모음 (행동력 2, 한 턴 1회)
// 인구 상한 없음 — 금(1명당 5금)이 닿는 만큼. 뽑은 땅은 인구가 줄어 세수가 떨어짐
export function DraftModal({ world, game, act, onClose, init = {}, onPickRegions, onPickDest }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const ok = (rid) => game.regions[rid]?.owner === pid && !game.regions[rid].sea;
  const [order, setOrder] = useState(() => (init.order || (init.rid != null ? [init.rid] : [])).filter(ok));
  const [want, setWant] = useState(() => {
    const o = { ...(init.picks || {}) };
    for (const r of order) if (o[r] === undefined) o[r] = draftBase(game, pid, r);
    return o;
  });
  const [stay, setStay] = useState(!!init.stay);
  const [dest, setDest] = useState(init.dest ?? null);
  const afford = draftAfford(game, pid);
  const men = order.reduce((a, r) => a + (want[r] || 0), 0);
  const gold = men * DRAFT_GOLD;
  const target = stay ? null : dest ?? order[0] ?? null;
  const dist = useMemo(() => (target !== null ? ownDistances(game, world, pid, target) : null), [game, world, pid, target]);
  const far = dist ? Math.max(0, ...order.filter((r) => r !== target && dist.has(r)).map((r) => dist.get(r))) : 0;
  const cut = dist ? order.filter((r) => r !== target && !dist.has(r)).length : 0;
  const base = draftCheck(game, pid);
  const err = base || (!men ? '징병할 지역을 고르고 인원을 정하세요.' : me.gold < gold ? '금이 부족합니다.' : null);
  const remove = (r) => { setOrder(order.filter((x) => x !== r)); const w = { ...want }; delete w[r]; setWant(w); };
  const state = () => ({ picks: want, order, stay, dest });
  return (
    <Modal title="💂 징병" onClose={onClose} wide>
      <div className="col">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {onPickRegions && <button className="sm primary" onClick={() => onPickRegions(state())}>🗺️ 지도에서 지역 고르기</button>}
          <button className="sm" onClick={() => { setOrder([]); setWant({}); }}>비우기</button>
          <small className="muted">1명당 {DRAFT_GOLD}금 · 금으로 최대 {fmtTroops(afford)} · 뽑은 만큼 그 땅 인구가 줄어 세수가 떨어집니다</small>
        </div>
        <div className="col" style={{ maxHeight: '42vh', overflow: 'auto', gap: 4 }}>
          {!order.length && <div className="muted">아직 고른 지역이 없습니다. 지도에서 징병할 내 땅을 골라 주세요. 처음 고른 곳으로 병사가 모입니다.</div>}
          {order.map((r, i) => {
            const max = Math.max(want[r] || 0, afford - (men - (want[r] || 0)));
            return (
              <div key={r} className="row" style={{ gap: 8, fontSize: 13 }}>
                <span style={{ width: 130 }}>{i === 0 && !stay && dest === null ? '🚩 ' : ''}{game.regions[r].name} <small className="muted">인구 {game.regions[r].pop}천</small></span>
                <Slider min={0} max={Math.max(100, max)} step={100} value={want[r] || 0} onChange={(v) => setWant({ ...want, [r]: v })} style={{ flex: 1 }} />
                <span style={{ width: 90, textAlign: 'right' }}>{fmtTroops(want[r] || 0)}</span>
                <button className="sm" onClick={() => setWant({ ...want, [r]: Math.max(0, max) })}>최대</button>
                <button className="sm" onClick={() => remove(r)}>✕</button>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>모일 곳</span>
          <button className={'sm' + (!stay && dest === null ? ' primary' : '')} onClick={() => { setStay(false); setDest(null); }}>🚩 처음 고른 곳{order[0] != null ? ` (${game.regions[order[0]].name})` : ''}</button>
          {onPickDest && <button className={'sm' + (!stay && dest !== null ? ' primary' : '')} onClick={() => onPickDest(state())}>🗺️ 다른 곳{dest !== null ? ` → ${game.regions[dest].name}` : ''}</button>}
          <button className={'sm' + (stay ? ' primary' : '')} onClick={() => setStay(true)}>뽑은 자리에 둠</button>
          {target !== null && order.length > 1 && <small className="muted">내 땅 3칸에 1턴 (가장 먼 곳 {reinforceTurns(far)}턴){cut > 0 && ` · 길이 이어지지 않은 ${cut}곳은 제자리`}</small>}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <span className="muted">합계 <b>{fmtTroops(men)}</b> · 금 {fmtGold(gold)} · 행동력 {DRAFT_AP} · 유지비 +{fmtGold(men)}/턴</span>
          {err && <small style={{ color: 'var(--danger)' }}>{err}</small>}
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!!err}
            onClick={() => {
              const res = act((s) => doDraft(s, pid, world, target, order.map((r) => ({ rid: r, amt: want[r] || 0 }))));
              if (res?.ok) onClose();
            }}
          >
            징병
          </button>
        </div>
      </div>
    </Modal>
  );
}

// 제안·요청한 나라가 어디인지: 그 나라(와 언급된 나라)만 색칠한 작은 지도
export function WhereMap({ world, game, ids }) {
  const keep = new Set([game.playerId, ...ids]);
  const regions = game.regions.map((r) => ({ ...r, owner: keep.has(r.owner) ? r.owner : null, troops: 0 }));
  return (
    <div>
      <div style={{ height: 180, borderRadius: 8, overflow: 'hidden', margin: '6px 0' }}>
        <MapView world={world} regions={regions} nations={game.nations} compact selected={game.nations[ids[0]]?.capital} />
      </div>
      <div className="row" style={{ gap: 10, fontSize: 13 }}>
        {[...keep].map((id) => (
          <span key={id}>
            <span className="chip" style={{ background: game.nations[id].color }} /> {game.nations[id].name}
            {id === game.playerId && ' (나)'}
          </span>
        ))}
      </div>
    </div>
  );
}

// 사건 카드: 선택지 고르기
export function ChoiceModal({ world, game, act }) {
  const c = game.choices[0];
  return (
    <Modal title={`${c.icon} ${c.title}${c.hist ? ' · 역사' : ''}`}>
      <p>{fixJosa(c.story)}</p>
      <div className="col" style={{ gap: 8 }}>
        {c.options.map((o, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} style={{ textAlign: 'left' }} onClick={() => act((s) => answerCard(s, world, i))}>
            <b>{o.label}</b>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{o.desc}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// 레벨업: 특성 두 갈래 중 고르기
export function LevelChoiceModal({ game, act }) {
  const c = game.levelChoices[0];
  const g = game.generals[c.gid];
  const roman = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];
  return (
    <Modal title={`🎖️ ${g?.name} Lv${g?.level} — 특성 고르기`}>
      <div className="col" style={{ gap: 8 }}>
        {c.opts.map((o, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} style={{ textAlign: 'left' }} onClick={() => act((s) => pickTrait(s, i))}>
            <b>
              {o.kind === 'up' ? '⬆️ 승급' : '✨ 새 특성'} 「{o.t}
              {roman[o.lv]}」
            </b>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{traitDesc(o.t, o.lv)}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// 출진: 장수와 병력을 골라 부대를 만듦 (지도 위 말이 되어 클릭으로 움직임)
export function FormArmyModal({ game, rid, act, onClose, onDone }) {
  const pid = game.playerId;
  const gens = freeGens(game, pid, rid);
  const [sel, setSel] = useState(gens.length ? [gens.slice().sort((a, b) => b.lead - a.lead)[0].id] : []);
  const cap = commandCap(game, sel);
  const room = Math.max(0, garrisonOf(game, rid) - 100);
  const max = Math.max(0, Math.min(cap, room));
  const [n0, setN] = useState(max);
  const n = Math.min(n0, max);
  return (
    <Modal title={`⚔️ ${game.regions[rid].name}에서 출진`} onClose={onClose}>
      <div className="col">
        <b>이끌 장수 <small className="muted">(통솔이 높을수록 많이 이끔, 함께 가는 장수는 절반씩 더함)</small></b>
        <div className="gen-picks">
          {gens.map((g) => {
            const on = sel.includes(g.id);
            return (
              <button key={g.id} className={'gen-pick' + (on ? ' on' : '')} onClick={() => setSel(on ? sel.filter((x) => x !== g.id) : [...sel, g.id])}>
                <span>{on ? '✅' : '⬜'} <b>{g.name}</b></span>
                <small>무{g.war} 통{g.lead} 지{g.intel} <TraitTags g={g} /></small>
              </button>
            );
          })}
        </div>
        <label>
          병력 <b>{n.toLocaleString('ko-KR')}</b> / 지휘 한도 {cap.toLocaleString('ko-KR')} · 수비대 {garrisonOf(game, rid).toLocaleString('ko-KR')}
          <Slider min={0} max={Math.max(500, max)} step={100} value={n} onChange={setN} style={{ width: '100%' }} />
        </label>
        <small className="muted">출진하면 지도에 부대가 생깁니다. 부대를 누르고 목적지를 누르면 매 턴 내 땅으로 3칸씩 진군하다 닿으면 공격합니다. 부대 병력도 그 지역을 함께 지킵니다.</small>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!sel.length || n < 500} onClick={() => { const res = act((s) => formArmy(s, pid, rid, sel, n)); if (res?.ok) onDone(res.army); }}>
            출진
          </button>
        </div>
      </div>
    </Modal>
  );
}

// 계략: 장수를 골라 화계·유언비어(맞닿은 적 땅)·매복(제 땅)
export function PlotModal({ world, game, rid, act, onClose }) {
  const pid = game.playerId;
  const gens = gensIn(game, rid, pid).filter((g) => g.intel >= 50 && !g.order);
  const [gid, setGid] = useState(gens.sort((a, b) => b.intel - a.intel)[0]?.id);
  const g = game.generals[gid];
  const foes = world.regions[rid].neighbors.map((x) => x.id).filter((x) => { const t = game.regions[x]; return !t.sea && t.owner !== null && t.owner !== pid && getRel(game, pid, t.owner).type === 'none'; });
  const [kind, setKind] = useState('fire');
  const [target, setTarget] = useState(foes[0]);
  const tgt = kind === 'ambush' ? rid : target;
  const err = !g ? '지력 50 이상인 장수가 없습니다.' : tgt === undefined ? '맞닿은 적 땅이 없습니다.' : plotCheck(game, world, pid, gid, kind, tgt);
  return (
    <Modal title={`🧠 ${game.regions[rid].name}에서 계략`} onClose={onClose}>
      <div className="col">
        <div className="gen-picks">
          {gens.map((x) => (
            <button key={x.id} className={'gen-pick' + (x.id === gid ? ' on' : '')} onClick={() => setGid(x.id)}>
              <span>{x.id === gid ? '✅' : '⬜'} <b>{x.name}</b></span>
              <small>지{x.intel} {x.plotTurn === game.turn ? '· 이번 턴 사용함' : ''}</small>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(PLOTS).map(([k, p]) => (
            <button key={k} className={'sm' + (kind === k ? ' primary' : '')} title={p.desc} onClick={() => setKind(k)}>{p.name}</button>
          ))}
        </div>
        <small className="muted">{PLOTS[kind].desc}</small>
        {kind !== 'ambush' && (
          <label>
            대상{' '}
            <select value={target} onChange={(e) => setTarget(+e.target.value)}>
              {foes.map((x) => <option key={x} value={x}>{game.regions[x].name} ({game.nations[game.regions[x].owner].name} · {fmtTroops(game.regions[x].troops)})</option>)}
            </select>
          </label>
        )}
        {g && tgt !== undefined && <div>성공률 <b>{Math.round(plotChance(game, g, tgt, kind) * 100)}%</b> · 행동력 1</div>}
        {err && <small style={{ color: 'var(--danger)' }}>{err}</small>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>닫기</button>
          <button className="primary" disabled={!!err} onClick={() => act((s) => doPlot(s, world, pid, gid, kind, tgt))}>계략 실행</button>
        </div>
      </div>
    </Modal>
  );
}
