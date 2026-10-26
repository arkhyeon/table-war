import { useEffect, useMemo, useState } from 'react';
import MapView from './MapView.jsx';
import { MOVES, newDuel, duelRound, aiMove, duelist, duelHp } from '../game/duel.js';
import { decodeOwners } from '../game/fog.js';
import { makeRng } from '../game/rng.js';
import { TERRAIN, EDGE, TRAITS, COST, BUILDINGS } from '../game/rules.js';
import { CIVS } from '../game/civs.js';
import {
  estimateBattle, moveCheck, moveCost, doMove, gensIn, getRel, nationRegions, nationPower, nationGenerals, doRelocate,
  doRecruit, doExecute, doRelease, recruitChance, isRuler, edgeBetween, WALL_MAX,
} from '../game/engine.js';
import { emptyDeal, proposeDeal, breakTreaty, validateDeal, applyDeal, TREATY_LABEL } from '../game/diplomacy.js';
import { onProposalDeclined } from '../game/ai.js';
import { rating } from '../game/generals.js';
import { fixJosa } from '../game/josa.js';
import { fmtTroops } from '../game/format.js';
import { relTag, GenLine } from './SidePanel.jsx';

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
  const [count, setCount] = useState(Math.max(1, fr.troops - 1000));
  const [sel, setSel] = useState(() => myGens.map((g) => g.id));
  const isAttack = tr.owner !== pid;
  const err = moveCheck(game, world, pid, from, to, count, sel);
  const est = useMemo(() => (isAttack && !err ? estimateBattle(game, world, pid, from, to, count, sel) : null), [game, world, pid, from, to, count, sel, isAttack, err]);
  const rel = tr.owner !== null && tr.owner !== pid ? getRel(game, pid, tr.owner) : null;
  const betrayal = rel && (rel.type === 'nap' || rel.type === 'vassal');
  const owner = tr.owner === null ? '중립 세력' : game.nations[tr.owner].name;
  const defGens = isAttack && tr.owner !== null ? gensIn(game, to, tr.owner) : [];
  const canDuel = isAttack && sel.length > 0 && defGens.length > 0;
  const [wantDuel, setWantDuel] = useState(true);

  return (
    <Modal title={isAttack ? `⚔️ ${tr.name} 공격` : fixJosa(`🚩 ${tr.name}(으)로 이동`)} onClose={onClose}>
      <div className="kv" style={{ marginBottom: 10 }}>
        <span>경로</span>
        <span>
          {fr.name} → {tr.name} ({EDGE[edge.type].name})
        </span>
        <span>대상</span>
        <span>
          {owner} · {TERRAIN[world.regions[to].terrain].name} · 병사 {tr.troops.toLocaleString('ko-KR')}명
          {tr.buildings.walls ? ` · 🏰성벽 ${tr.buildings.walls}/${WALL_MAX} (이겨도 성벽이 남으면 함락 안 됨)` : ''}
        </span>
        <span>행동력</span>
        <span>{moveCost(world, from, to, game)} AP</span>
      </div>
      <div className="col">
        <label>
          병력 {count.toLocaleString('ko-KR')} / {(fr.troops - 1).toLocaleString('ko-KR')}명
          <input type="range" min={1} max={Math.max(1, fr.troops - 1)} step={fr.troops > 2000 ? 100 : 1} value={count} onChange={(e) => setCount(Math.min(fr.troops - 1, +e.target.value))} style={{ width: '100%' }} />
        </label>
        {myGens.length > 0 && (
          <div>
            동행 장수
            {myGens.map((g) => (
              <label key={g.id} style={{ display: 'block', fontSize: 13 }}>
                <input type="checkbox" checked={sel.includes(g.id)} onChange={(e) => setSel(e.target.checked ? [...sel, g.id] : sel.filter((x) => x !== g.id))} /> {g.name} (무{g.war}/통{g.lead}, {g.trait}: {TRAITS[g.trait]})
              </label>
            ))}
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
              공격 보정: {est.mods.length ? est.mods.join(', ') : '없음'}
              <br />
              방어 보정: 지형 ×{est.terrDef}
              {est.walls > 1 ? ', 성벽 ×1.5' : ''}
              {est.def.length ? `, 수비 장수 ${est.def.map((g) => g.name).join(', ')}` : ''}
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
                onDuel({ from, to, count, sel });
                return;
              }
              const res = act((s) => doMove(s, world, pid, from, to, count, sel, { duel: canDuel ? false : undefined }));
              if (res?.ok) onDone();
            }}
          >
            {isAttack ? '공격!' : '이동'}
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
  if (r.type === 'nap') return `불가침(~${r.until}턴)`;
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
            </div>
          </div>
          <div className="diplo" style={{ marginTop: 8 }}>
            <div className="card col">
              <b>내가 주는 것</b>
              <label className="row">
                금 <input type="number" min={0} max={me.gold} value={deal.give.gold} onChange={(e) => set((d) => ((d.give.gold = Math.max(0, Math.min(me.gold, +e.target.value || 0))), d))} style={{ width: 90 }} /> / {Math.floor(me.gold)}
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
                금 <input type="number" min={0} max={t.gold} value={deal.get.gold} onChange={(e) => set((d) => ((d.get.gold = Math.max(0, Math.min(t.gold, +e.target.value || 0))), d))} style={{ width: 90 }} /> / {Math.floor(t.gold)}
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
                  {g.name}
                </td>
                <td>{g.war}</td>
                <td>{g.lead}</td>
                <td>{g.intel}</td>
                <td>{g.pol}</td>
                <td title={TRAITS[g.trait]}>
                  {g.trait} <small className="muted">{TRAITS[g.trait]}</small>
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
                  <td>{g.trait}</td>
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

export function NewsModal({ news, turn, onClose }) {
  return (
    <Modal title={`📰 ${turn}턴 소식`} onClose={onClose}>
      <div className="col" style={{ fontSize: 14 }}>
        {news.slice(0, 30).map((n, i) => (
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

export function GameOverModal({ result, game, onNew, onContinue, onChronicle }) {
  const me = game.nations[game.playerId];
  return (
    <Modal title={result.win ? '🏆 승리!' : '💀 패배'}>
      <p>{fixJosa(result.text)}</p>
      <p className="muted">
        {me.name} · {game.turn}턴 · 영토 {nationRegions(game, game.playerId).length}
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
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
          <li><b>목표</b>: 전체 지역의 60%를 차지하거나 다른 모든 나라를 멸망·속국화하세요.</li>
          <li><b>지역 숫자</b> = 주둔 병사 수. ♛ 수도, ★ 장수, 🏰💰⚓⚔️ 건물.</li>
          <li><b>행동력(AP)</b>: 매 턴 3 + 영토 6개당 1(최대 +5) + 신속 장수(최대 +2). 속국은 -1, 배신하면 다음 턴 -2.</li>
          <li><b>이동·공격</b>: 내 지역 선택 → [이동·공격] 또는 M → 인접 지역 클릭 (우클릭으로 바로 열기). 최소 1명은 남겨야 합니다.</li>
          <li><b>지형</b>: 숲 방어+15%, 구릉 +25%, 험산 +50%·진입 AP+1, 고산(진한 회색)은 통행 불가. 강 건너 공격 -20%, 바다 건너 -30%(항구 필요, AP+1).</li>
          <li><b>세금</b>: 매 턴 자동 징수. 국가 카드에서 세율을 일괄 설정하고, 지역마다 따로 바꿀 수도 있습니다(높음=세수↑ 민심↓ 인구 정체).</li>
          <li><b>유지비</b>: 병력 2,500명당 1금 + 장수 1명당 녹봉 1금. 국고가 바닥나면 병사가 탈영합니다.</li>
          <li><b>징병</b>: 금 20과 인구를 소모하고 민심 -6. 병영이 있으면 +50%.</li>
          <li><b>민심</b>: 점령 직후 15에서 회복. 낮으면 세수·징병 감소, 25 미만이면 반란. 영토가 15곳 늘 때마다 통치 부담으로 회복이 느려집니다.</li>
          <li><b>보급</b>: 수도와 내 땅으로(바닷길은 양쪽 항구) 이어지지 않은 지역은 ✂ 표시, 병력 -8%/턴·전투력 -20%.</li>
          <li><b>공성</b>: 성벽(내구 3)이 있으면 이겨도 성벽만 깎입니다(압승 시 2). 0이 되어야 함락. 포위당하지 않은 턴에는 1씩 복구됩니다.</li>
          <li><b>날씨</b>: 계절(1턴=한 계절)·위도에 따라 비(공격 -10%, 도강 추가 감소)·눈(공격 -25%, 진입 AP+1)·폭풍(항해 불가)·가뭄(세수 -35%)·풍년(세수 +35%).</li>
          <li><b>사건</b>: 시나리오별 역사 사건(쿠릴타이, 흑사병, 적벽의 동남풍 등)과 무작위 사건(역병, 금광, 의용군 등).</li>
          <li><b>견제</b>: 영토 30% 이상의 강대국은 다른 나라들의 호감도가 계속 떨어집니다.</li>
          <li><b>일기토</b>: 양쪽에 장수가 있으면 신청 가능. 공격 &gt; 강타, 강타 &gt; 방어, 방어 &gt; 공격(약한 피해)·반격, 반격 &gt; 공격·강타. 이기면 전투력 +15%.</li>
          <li><b>장수 성장</b>: 전투·일기토 승리로 경험치를 얻어 레벨업(능력치 상승), 3·5·7·9레벨에 칭호.</li>
          <li><b>장수</b>: 턴마다 확률적으로 출현(공평 규칙 적용). 이동 시 동행하면 공격 보정, 지역에 주둔하면 방어 보정. 적 지역 점령 시 수비 장수를 포로로 잡아 등용·처형·석방할 수 있고, 적 장수를 금으로 회유할 수도 있습니다.</li>
          <li><b>외교</b>: 금·영토를 주고받거나 동맹(상호 공격 불가), 불가침, 속국화, 공동 공격을 제안할 수 있습니다. 불가침·종속 상대를 공격하면 배신 페널티를 받습니다.</li>
          <li><b>맵 조작</b>: 휠 확대/축소, 드래그 이동. 자동 저장됩니다.</li>
        </ul>
        <h4>건물</h4>
        <ul>
          {Object.values(BUILDINGS).map((b) => (
            <li key={b.name}>
              {b.icon} {b.name} ({b.cost}금·{b.ap}AP): {b.desc}
            </li>
          ))}
        </ul>
        <h4>장수 특성</h4>
        <ul>
          {Object.entries(TRAITS).map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>: {v}
            </li>
          ))}
        </ul>
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
  const play = (m) => {
    const next = structuredClone(d);
    const am = aiMove(rng, dg, ag, m);
    duelRound(next, ag, dg, m, am, rng);
    setD(next);
  };
  const bar = (hp, max, color) => (
    <div className="odds" style={{ background: '#444' }}>
      <i style={{ width: `${(hp / max) * 100}%`, background: color }} />
    </div>
  );
  const last = d.rounds[d.rounds.length - 1];
  return (
    <Modal title="⚔️ 일기토">
      <div className="diplo">
        <div className="card">
          <b>{ag.name}</b> <small className="muted">무{ag.war} 지{ag.intel}</small>
          {bar(d.hpA, d.maxA, 'var(--ok)')}
          <small>
            체력 {d.hpA}/{d.maxA}
          </small>
        </div>
        <div className="card">
          <b>{dg.name}</b> <small className="muted">무{dg.war} 지{dg.intel}</small>
          {bar(d.hpB, d.maxB, 'var(--danger)')}
          <small>
            체력 {d.hpB}/{d.maxB}
          </small>
        </div>
      </div>
      <div className="col" style={{ marginTop: 10, fontSize: 13 }}>
        {d.rounds.map((r, i) => (
          <div key={i}>
            {i + 1}합: {MOVES[r.m1].icon}{MOVES[r.m1].name} vs {MOVES[r.m2].icon}{MOVES[r.m2].name} → {ag.name} -{r.dA} / {dg.name} -{r.dB}
          </div>
        ))}
        {last && last.m2 && <div className="muted">상대는 지력이 높을수록 내 수를 간파합니다.</div>}
      </div>
      {!d.done ? (
        <>
          <div className="actions" style={{ marginTop: 10 }}>
            {Object.entries(MOVES).map(([k, m]) => (
              <button key={k} onClick={() => play(k)} title={m.desc}>
                {m.icon} {m.name}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            공격 &gt; 강타 · 강타 &gt; 방어 · 방어 &gt; 공격(약한 피해)·반격 · 반격 &gt; 공격·강타. 최대 6합, 체력이 0이 되면 패배(전사 위험).
          </div>
        </>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <b>{d.winner === 0 ? '무승부!' : `${d.winner === 1 ? ag.name : dg.name} 승리!${d.ko ? ' (쓰러뜨림)' : ' (판정)'}`}</b>
          <button className="primary" onClick={() => onFinish(d)}>
            전투 개시 ▶
          </button>
        </div>
      )}
    </Modal>
  );
}

// ───────── 전투 다시보기 ─────────
export function BattleReplay({ game, battles, index, onNext, onSkip }) {
  const b = battles[index];
  useEffect(() => {
    const t = setTimeout(onNext, 2200);
    return () => clearTimeout(t);
  }, [index, onNext]);
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
        · {game.regions[b.to].name} · <b style={{ color: b.result === 'win' ? 'var(--accent)' : undefined }}>{res}</b>
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
