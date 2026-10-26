import { useEffect, useMemo, useState } from 'react';
import MapView from './MapView.jsx';
import { MOVES, newDuel, duelRound, aiMove, duelist, duelHp, readChance, bestResponse } from '../game/duel.js';
import { decodeOwners } from '../game/fog.js';
import { makeRng } from '../game/rng.js';
import { TERRAIN, EDGE, COST, BUILDINGS, BATTLE_KIND } from '../game/rules.js';
import { TRAITS, TIER, traitDesc, traitLabel } from '../game/traits.js';
import { CIVS } from '../game/civs.js';
import {
  estimateBattle, moveCheck, moveCost, doMove, gensIn, getRel, nationRegions, nationPower, nationGenerals, doRelocate,
  doRecruit, doExecute, doRelease, recruitChance, isRuler, edgeBetween, WALL_MAX, conscriptMax, conscriptCost, doConscript, CONSCRIPT,
} from '../game/engine.js';
import { emptyDeal, proposeDeal, breakTreaty, validateDeal, applyDeal, TREATY_LABEL, annexCheck, doAnnex } from '../game/diplomacy.js';
import { onProposalDeclined } from '../game/ai.js';
import { rating } from '../game/generals.js';
import { fixJosa } from '../game/josa.js';
import { fmtTroops, fmtGold } from '../game/format.js';
import { relTag, GenLine, TraitTags, GradeTag } from './SidePanel.jsx';
import { ACHIEVEMENTS } from '../game/achievements.js';
import EditableName from './EditableName.jsx';
import { G } from '../game/rules.js';

function Modal({ title, onClose, wide, children }) {
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
  const edge = edgeBetween(world, from, to);
  const myGens = gensIn(game, from, pid);
  const maxCount = fr.sea ? fr.troops : fr.troops - 1;
  const [count, setCount] = useState(fr.sea ? fr.troops : Math.max(1, fr.troops - 1000));
  const aid = tr.owner !== null && tr.owner !== pid && getRel(game, pid, tr.owner).type === 'alliance';
  const [sel, setSel] = useState(() => (aid ? [] : myGens.map((g) => g.id)));
  const walls = !tr.sea && (tr.buildings.walls || 0) > 0;
  const [mode, setMode] = useState('siege');
  const [engines, setEngines] = useState(Math.min(2, fr.engines || 0));
  const isAttack = !aid && tr.owner !== pid && !(tr.sea && (tr.owner === null || tr.troops <= 0));
  const opts = walls ? { mode, engines } : { engines };
  const err = moveCheck(game, world, pid, from, to, count, sel);
  const est = useMemo(() => (isAttack && !err ? estimateBattle(game, world, pid, from, to, count, sel, opts) : null), [game, world, pid, from, to, count, sel, isAttack, err, mode, engines]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {fr.name} → {tr.name} ({EDGE[edge.type].name})
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
          <input type="range" min={1} max={Math.max(1, maxCount)} step={maxCount > 2000 ? 100 : 1} value={count} onChange={(e) => setCount(Math.min(maxCount, +e.target.value))} style={{ width: '100%' }} />
        </label>
        {myGens.length > 0 && !aid && (
          <div>
            동행 장수
            {myGens.map((g) => (
              <label key={g.id} style={{ display: 'block', fontSize: 13 }}>
                <input type="checkbox" checked={sel.includes(g.id)} onChange={(e) => setSel(e.target.checked ? [...sel, g.id] : sel.filter((x) => x !== g.id))} /> {g.name} (무{g.war}/통{g.lead}) <TraitTags g={g} />
              </label>
            ))}
          </div>
        )}
        {walls && isAttack && (
          <div className="card col" style={{ gap: 6 }}>
            <b>🏰 공성 방식</b>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={mode === 'siege'} onChange={() => setMode('siege')} /> 포위 공격 — 이겨도 성벽만 깎음(1, 압승 2, 공성병기·공성 장수 추가). 성벽 0이 되면 함락. 손실 적음
            </label>
            <label style={{ fontSize: 13 }}>
              <input type="radio" checked={mode === 'assault'} onChange={() => setMode('assault')} /> 강습 — 이기면 바로 함락. 대신 성벽 방어 2배, 아군 손실 1.5배(공성Ⅱ 장수가 있으면 감소)
            </label>
            {(fr.engines || 0) > 0 && (
              <label style={{ fontSize: 13 }}>
                🛠️ 공성병기 동행 {engines}/{fr.engines} <input type="range" min={0} max={fr.engines} value={engines} onChange={(e) => setEngines(+e.target.value)} />
                <small className="muted"> 대당 성벽 효과 -15%, 포위 피해 +1(최대 2)</small>
              </label>
            )}
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
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!!err}
            onClick={() => {
              if (canDuel && wantDuel) {
                onDuel({ from, to, count, sel, opts });
                return;
              }
              const res = act((s) => doMove(s, world, pid, from, to, count, sel, { ...opts, duel: canDuel ? false : undefined }));
              if (res?.ok) onDone();
            }}
          >
            {isAttack ? '공격!' : verb}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ───────── 징병 ─────────
export function ConscriptModal({ world, game, rid, act, onClose }) {
  const pid = game.playerId;
  const r = game.regions[rid];
  const [mode, setMode] = useState('draft');
  const max = conscriptMax(game, rid, pid, mode);
  const [amount, setAmount] = useState(Math.min(max, Math.max(100, Math.round(max / 2 / 100) * 100)));
  const amt = Math.min(amount, max);
  const c = conscriptCost(game, rid, amt, mode);
  const me = game.nations[pid];
  const free = Math.floor((r.pop * 1000 * 0.05) / 100) * 100;
  return (
    <Modal title={`🪖 ${r.name} 징병`} onClose={onClose}>
      <div className="col">
        <div className="row">
          {Object.entries(CONSCRIPT).map(([k, m]) => (
            <button key={k} className={'sm' + (mode === k ? ' primary' : '')} onClick={() => setMode(k)} title={m.desc}>
              {m.name}
            </button>
          ))}
          <small className="muted">{CONSCRIPT[mode].desc}</small>
        </div>
        <label>
          인원 <b>{amt.toLocaleString('ko-KR')}명</b> / 최대 {max.toLocaleString('ko-KR')}
          <input type="range" min={100} max={max} step={100} value={amt} onChange={(e) => setAmount(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <div className="kv">
          <span>금</span>
          <span style={{ color: c.gold > me.gold ? 'var(--danger)' : undefined }}>
            -{fmtGold(c.gold)} (1명당 {CONSCRIPT[mode].gold}금) · 보유 {fmtGold(me.gold)}
          </span>
          <span>민심</span>
          <span style={{ color: (r.loyalty ?? 100) - c.loyalty < 25 ? 'var(--danger)' : undefined }}>
            {Math.round(r.loyalty ?? 100)} → {Math.round((r.loyalty ?? 100) - c.loyalty)}
            {mode === 'draft' && <small className="muted"> ({free.toLocaleString('ko-KR')}명까지는 영향 없음)</small>}
          </span>
          <span>인구</span>
          <span>
            {Math.round(r.pop)}천 → {Math.round(r.pop - c.pop)}천
          </span>
          <span>유지비</span>
          <span>+{fmtGold(amt)}금/턴 (1명당 1금)</span>
          <span>행동력</span>
          <span>{COST.conscript} AP</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>민심 60 이상인 지역에서는 매 턴 자원병이 저절로 들어오고, 나라가 위태로우면(영토 상실·수도 위협) 민심 40 이상에서 4배로 늘어납니다.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={c.gold > me.gold || me.ap < COST.conscript}
            onClick={() => {
              const res = act((s) => doConscript(s, world, pid, rid, amt, mode));
              if (res?.ok) onClose();
            }}
          >
            {CONSCRIPT[mode].name}
          </button>
        </div>
      </div>
    </Modal>
  );
}

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
              <th>위치 / 재배치 ({COST.relocate}AP)</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((g) => (
              <tr key={g.id}>
                <td>
                  {me.ruler === g.id && '👑 '}
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
            <li>기본 6%. 평균보다 장수가 적은 나라는 확률이 오르고(최대 2.5배), 많은 나라는 내려갑니다. 민심(평균 75 기준)·국고(200금 이상 +20%, 30금 미만 -30%)·평판도 확률에 반영되며, 영토 3곳 이하 약소국은 +2%p. 최대 30%.</li>
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
  const err = from.alive ? validateDeal(game, world, p.from, game.playerId, p.deal) : '제안국이 멸망했습니다.';
  return (
    <Modal title={`📨 ${from.name}의 제안`}>
      <p>{fixJosa(p.text)}</p>
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

export function NewsModal({ news, events = [], turn, onClose }) {
  const evHeads = events.map((e) => `${e.icon} ${e.title}`);
  const rest = news.filter((n) => !evHeads.some((h) => n.startsWith(h)));
  return (
    <Modal title={`📰 ${turn}턴 소식`} onClose={onClose}>
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
      <div className="col" style={{ fontSize: 14 }}>
        {rest.slice(0, 30).map((n, i) => (
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
  const ws = game.winShare || 0.6;
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
  const heroes = Object.values(game.generals).filter((g) => g.wins).sort((a, b) => b.wins - a.wins).slice(0, 5);
  const events = game.log.filter((l) => KEY_EVENT.test(l.text)).slice(0, 10).reverse();
  const fresh = game.newAchieve || [];
  return (
    <Modal title={result.win ? '🏆 승리!' : '💀 패배'} wide>
      <p>{fixJosa(result.text)}</p>
      <p className="muted">
        {me.name} · {game.turn}턴 · 영토 {nationRegions(game, game.playerId).length} · 전투 {st.won || 0}승 {st.lost || 0}패 · 일기토 {st.duels || 0}승 · 최소 영토 {st.minRegions ?? '-'}곳
      </p>
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
          <b>🎖️ 최다 전공 장수</b>
          {heroes.map((g) => (
            <div key={g.id}>
              <span className="chip" style={{ background: game.nations[g.nation]?.color }} /> {g.name} <GradeTag g={g} /> {g.wins}승{g.duelWins ? ` · 일기토 ${g.duelWins}승` : ''} <small className="muted">Lv{g.level || 1}{g.status === 'dead' ? ' ✝' : ''}</small>
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
        {result.win && <button onClick={onContinue}>계속 플레이</button>}
        <button className="primary" onClick={onNew}>
          새 게임
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
          <li><b>목표</b>: 전체 육지의 60%(세계사 35%, 동아시아 45%)를 차지하거나 다른 모든 나라를 멸망·속국화하세요.</li>
          <li><b>지역 숫자</b> = 주둔 병사 수. ♛ 수도, ★ 장수, 🏰💰⚓⚔️ 건물, ✂ 보급 끊김, 빨간 점 반란 위험.</li>
          <li><b>시간</b>: 2턴이 한 계절, 8턴이 1년. 날씨는 매 턴 바뀝니다.</li>
          <li><b>행동력(AP)</b>: 매 턴 3 + 영토 6곳당 1(최대 +7, 큰 지도는 더 많음) + 신속 특성. 속국 -1, 배신 시 다음 턴 -2.</li>
          <li><b>이동·공격</b>: 내 지역 선택 → [이동·공격] 또는 M → 인접 지역 클릭(우클릭으로 바로 열기). 육지는 최소 1명을 남겨야 합니다.</li>
          <li><b>바다</b>: 바다는 구역(점선)으로 나뉩니다. 항구(또는 수군 장수)가 있는 해안에서 승선 → 바다 구역을 한 칸씩 항해 → 해안에 상륙(-25%). 험한 해안은 절벽 상륙(-55%, 행동력 +1). 바다 날씨: 풍랑·순풍·용오름·해무·폭풍. 적 함대가 있는 구역은 해전으로 뚫어야 하고, 함대로 바닷길을 막을 수 있습니다. 바다의 함대는 매 턴 2%(폭풍 10%) 줄어듭니다. 내 함대가 있는 바다는 보급로가 됩니다.</li>
          <li><b>지형</b>: 숲 방어 +15%, 구릉 +25%, 험산 +50%·진입 AP+1, 고산(진한 회색)은 통행 불가. 강 건너 공격 -20%, 좁은 해협(도버·보스포루스 등) 건너기 -30%·AP+1.</li>
          <li><b>세금</b>: 매 턴 자동 징수. 국가 카드에서 세율 일괄 설정, 지역마다 개별 설정 가능(높음=세수↑ 민심↓ 인구 정체).</li>
          <li><b>지출</b>: 병사 1명당 1금/턴, 장수 녹봉 2,500금, 영토 15곳 초과분 1곳당 통치비 1,250금. 국고가 바닥나면 탈영.</li>
          <li><b>징병</b>: 인원을 직접 정합니다. 징집은 1명당 5금이고 인구의 5%를 넘게 뽑으면 넘은 만큼 민심 하락, 모병은 1명당 12금에 민심 영향 없음(최대치 절반). 병영 +50%.</li>
          <li><b>자원병</b>: 민심 60 이상인 지역은 매 턴 백성이 스스로 입대합니다. 영토를 잃거나 수도가 위협받으면 민심 40 이상 지역에서 4배로 늘어납니다.</li>
          <li><b>민심</b>: 점령 직후 15(중립지는 35)에서 매 턴 회복. 주둔군 3천↑·수도·낮은 세율·인덕 장수로 빨라지고, 전 육지의 1/8을 차지할 때마다 통치 부담 -1. 25 미만이면 반란. 대책: 🍚진휼(비싸고 6턴에 한 번, +7/+14), 계엄(인구 대비 대군 주둔 시 반란 불가, 대신 회복 -1), 치안 장수.</li>
          <li><b>보급</b>: 수도와 끊긴 지역은 ✂ 표시, 병력이 매 턴 1~10% 무작위 감소, 전투력 -20%(보급 특성으로 경감).</li>
          <li><b>공성</b>: 성벽(내구 3)이 있으면 공격 방식 선택. 포위=이겨도 성벽만 깎음(1, 압승 2, 🛠️공성병기·공성 장수 추가), 0이 되면 함락. 강습=이기면 바로 함락하지만 성벽 효과 2배·손실 1.5배. 포위당하지 않은 턴엔 성벽 복구.</li>
          <li><b>날씨</b>: 북쪽은 눈(공격 -25%, AP+1, 세수 -25%), 남쪽은 가뭄(세수 -35%)이 잦지만 남쪽은 풍년(+35%)도 잦아 연간 손익이 비슷합니다. 비는 도강을 어렵게, 폭풍은 항해를 막습니다.</li>
          <li><b>사건</b>: 역병·홍수·지진·금광·교역 호황·해적·도적·용병단·장수 출분 등 어느 나라에나 일어나는 사건이 턴 소식에 카드로 나옵니다.</li>
          <li><b>세력 균형</b>: 국력이 평균의 2배를 넘으면 주변국 호감이 계속 떨어지고, 1위가 2.5배를 넘으면 대동맹이 결성됩니다. AI 회원국끼리는 싸우지 않고 패권국을 노리며, 패권국의 침공에 방어 +15%.</li>
          <li><b>일기토</b>: 반격 &gt; 공격 &gt; 방어 &gt; 반격의 가위바위보, 같은 수끼리는 서로 절반 피해. 체력 = 60 + 무력×0.7 + 통솔×0.2, 위력 = 2 + (무력-40)×0.42(맹장·무쌍 특성 가산). 상대 의도 간파는 무력 85%·지력 15%의 전장 감각 차이로 정해져 힌트로 보입니다. 이기면 전투력 +15%, 지면 -15%.</li>
          <li><b>장수와 전투력</b>: 장수는 병사 수를 늘리지 않고 배율을 올립니다. 공격 시 동행 장수 중 최고 (무력+통솔)/2 ÷ 250(최대 약 +40%) + 특성, 방어 시 주둔 장수 최고 (통솔×0.6+지력×0.4) ÷ 250 + 특성.</li>
          <li><b>장수</b>: 무관·문관으로 나뉘고 특성은 Ⅰ~Ⅲ 등급. 등급은 F~SSR. 기본은 공평한 무작위 능력치(장수 성향만 역사대로, 나라마다 장수 수준 합이 비슷 — 뛰어난 장수가 있으면 다음 장수는 약해짐). 레벨이 오르면 특성 승급·추가와 칭호. 포로는 등용·처형·석방, 적 장수는 금으로 회유. 멸망한 나라의 왕은 승자의 장수가 되고, 충성이 낮으면 옛 나라를 부흥시킬 수 있습니다.</li>
          <li><b>태수</b>: 지역에 주둔한 장수 중 정치가 가장 높은 장수가 태수. 정치 50 초과분만큼 세수 증가(정치 90 = +16%), 정치 70↑ 민심 +1, 90↑ +2. 무관은 효과 절반.</li>
          <li><b>신흥국</b>: 빈 땅의 봉기, 민심 30 미만 변방(컴퓨터 나라)의 독립, 옛 왕의 부흥으로 새 나라가 생깁니다. 지도에서 깜빡이고 소식 카드가 뜹니다.</li>
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
    }, 1150);
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
      <div className="arena" key={n}>
        <div className="ground" />
        <div className={'rider L' + (n ? ' go' : '') + (downA ? ' down' : '')}>🏇</div>
        <div className={'rider R' + (n ? ' go' : '') + (downB ? ' down' : '')}>🏇</div>
        {last && (
          <>
            <div className="mv L">
              {MOVES[last.m1].icon} {MOVES[last.m1].name}
            </div>
            <div className="mv R">
              {MOVES[last.m2].icon} {MOVES[last.m2].name}
            </div>
            <div className="clash">💥</div>
            {last.dA > 0 && <div className="dmg L">-{last.dA}</div>}
            {last.dB > 0 && <div className="dmg R">-{last.dB}</div>}
          </>
        )}
        {!n && <div className="arena-hint">두 장수가 말을 몰아 마주섰다…</div>}
      </div>
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
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {b.msg}
      </div>
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
          <button onClick={() => onGift(nid, 'troops', 10000)}>🪖 수도 병력 +1만</button>
          <button onClick={() => onGift(nid, 'troops', 50000)}>🪖 수도 병력 +5만</button>
          <button onClick={() => onGift(nid, 'general')}>⭐ 장수 1명 출현</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>판을 지켜보다 원하는 나라를 밀어줄 수 있습니다. 준 내역은 기록에 남습니다.</div>
      </div>
    </Modal>
  );
}
