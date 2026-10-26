import { useMemo, useState } from 'react';
import { TERRAIN, EDGE, TRAITS, COST, BUILDINGS } from '../game/rules.js';
import { CIVS } from '../game/civs.js';
import {
  estimateBattle, moveCheck, moveCost, doMove, gensIn, getRel, nationRegions, nationPower, nationGenerals, doRelocate,
  doRecruit, doExecute, doRelease, recruitChance, isRuler, edgeBetween,
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
export function MoveModal({ world, game, from, to, act, onClose, onDone }) {
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
          {tr.buildings.walls ? ' · 🏰성벽' : ''}
        </span>
        <span>행동력</span>
        <span>{moveCost(world, from, to)} AP</span>
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
        {betrayal && <div style={{ color: 'var(--danger)' }}>⚠️ {rel.type === 'nap' ? '불가침 조약' : '종속 관계'} 중인 상대입니다. 공격 시 조약 파기, 평판 -25, 모든 국가 호감도 하락, 다음 턴 행동력 -2.</div>}
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!!err}
            onClick={() => {
              const res = act((s) => doMove(s, world, pid, from, to, count, sel));
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
                <td>{fmtTroops(game.regions.reduce((a, r) => a + (r.owner === n.id ? r.troops : 0), 0))}</td>
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
            <li>기본 13%. 평균보다 장수가 적은 나라는 확률이 오르고(최대 2.5배), 많은 나라는 내려갑니다. 영토가 3개 이하인 약소국은 +5%.</li>
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

export function GameOverModal({ result, game, onNew, onContinue }) {
  const me = game.nations[game.playerId];
  return (
    <Modal title={result.win ? '🏆 승리!' : '💀 패배'}>
      <p>{fixJosa(result.text)}</p>
      <p className="muted">
        {me.name} · {game.turn}턴 · 영토 {nationRegions(game, game.playerId).length}
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
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
          <li><b>세금</b>: 매 턴 자동 징수. 세율(낮음·보통·높음)로 세수와 민심·인구 증가를 조절합니다. 병력 4천 명당 군량 1금.</li>
          <li><b>민심</b>: 점령 직후 15에서 시작해 매 턴 회복(주둔군 3천 이상·수도·낮은 세율이면 더 빠름). 민심이 낮으면 세수·징병이 줄고, 25 미만이면 반란이 일어나 중립 반란군이 됩니다(지도에 빨간 점). 징병은 민심 -6.</li>
          <li><b>내정</b>: 징병(20금, 병영 +50%), 건설(시장·성벽·항구·병영).</li>
          <li><b>전황</b>: 지난 턴의 공격이 지도에 화살표로 표시됩니다(실선=점령, 점선=실패).</li>
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
