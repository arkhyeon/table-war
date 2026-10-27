import { TERRAIN, BUILDINGS, COST, EDGE, TAX } from '../game/rules.js';
import { traitLabel, traitDesc } from '../game/traits.js';
import { gradeOf, gradeScore } from '../game/generals.js';
import EditableName from './EditableName.jsx';
import { fmtTroops, fmtGold } from '../game/format.js';
import { CIVS } from '../game/civs.js';
import { WEATHER } from '../game/weather.js';
import { viewOf, troopsShown } from '../game/fog.js';
import {
  doBuild, regionTax, buildCost, conscriptMax, gensIn, nationRegions, nationGenerals, appearChance, getRel,
  poachChance, doPoach, income, isVassalOf, effTax, supplied, WALL_MAX, landCount, doRelief, reliefCost, RELIEF_COOLDOWN, doBuildEngine, engineCost, ENGINE_MAX, governorOf, governorBonus, movable, capitalMoveCheck, capitalMoveCost, doMoveCapital, CAPITAL_COOLDOWN, bribeAgents, bribeCost,
} from '../game/engine.js';
import { revokeFief, pacifyCost, pacifyChance, doPacify } from '../game/rise.js';

export function relTag(game, a, b) {
  if (a === b) return null;
  const r = getRel(game, a, b);
  if (r.type === 'alliance') return <span className="tag ally">동맹</span>;
  if (r.type === 'nap') return <span className="tag nap">{r.truce ? '정전' : '불가침'} ~{r.until}턴</span>;
  if (r.type === 'vassal') return <span className="tag vassal">{r.overlord === a ? '내 속국' : '종주국'}</span>;
  return null;
}

export function GradeTag({ g }) {
  const gr = gradeOf(g);
  return <span className={'tag grade g-' + gr} title={`등급 ${gr} (점수 ${gradeScore(g).toFixed(1)})`}>{gr}</span>;
}

export function TraitTags({ g }) {
  return [<GradeTag key="_grade" g={g} />, ...(g.traits || []).map((tr) => (
    <span key={tr[0]} className={'tag trait t' + tr[1]} title={traitDesc(tr[0], tr[1])}>
      {traitLabel(tr)}
    </span>
  ))];
}

export function GenLine({ g, extra }) {
  const lv = g.level || 1;
  return (
    <div className="gen">
      <b>{g.name}</b> <span className="tag">{g.role === 'civ' ? '문관' : '무관'} Lv{lv}</span> {g.title && <span className="tag ally">{g.title}</span>} <TraitTags g={g} />
      <div className="stats4">
        무{g.war} 통{g.lead} 지{g.intel} 정{g.pol} · 충성 {g.loyalty} · 경험 {g.exp || 0}/{lv * 100}
      </div>
      {extra}
    </div>
  );
}

function TaxButtons({ value, onPick, withDefault }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {withDefault && (
        <button className={'sm' + (!value ? ' primary' : '')} onClick={() => onPick(null)} title="국가 일괄 세율을 따름">
          일괄
        </button>
      )}
      {Object.entries(TAX).map(([k, t]) => (
        <button key={k} className={'sm' + (value === k ? ' primary' : '')} title={t.desc} onClick={() => onPick(k)}>
          {t.name}
        </button>
      ))}
    </span>
  );
}

export default function SidePanel({ world, game, selected, vis, spectator, moveMode, setMoveMode, act, openGenerals, openConscript, openLoyalty, openBribe, openFief, openCall, openDisband, sheetOpen, onCloseSheet }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const myRegions = nationRegions(game, pid);
  const lowLoy = myRegions.filter((x) => !game.regions[x].sea && (game.regions[x].loyalty ?? 100) < 40).length;
  const incoming = (game.reinforce || []).filter((o) => o.n === pid);
  const inc = income(game, pid);
  // 맞닿은 나라들 (전선 투입 대상)
  const foes = [...new Set(myRegions.flatMap((r) => world.regions[r].neighbors.map((x) => (game.regions[x.id].sea ? null : game.regions[x.id].owner))).filter((o) => o !== null && o !== pid && game.nations[o]?.alive && getRel(game, pid, o).type !== 'alliance'))];
  const nextGold = me.gold + inc.net;
  const ruler = game.generals[me.ruler];
  const lord = game.nations.find((o) => o.alive && isVassalOf(game, pid, o.id));
  const overrides = myRegions.filter((r) => game.regions[r].tax).length;
  const supply = supplied(game, world, pid);
  const cut = myRegions.filter((r) => !supply.has(r)).length;

  const r = selected !== null && selected !== undefined ? game.regions[selected] : null;
  const wr = r ? world.regions[selected] : null;
  const view = r ? viewOf(game, vis, selected) : 'hidden';
  const showT = r && troopsShown(game, view);
  const mine = r && r.owner === pid && !spectator;
  const owner = r && r.owner !== null ? game.nations[r.owner] : null;
  // 주둔 장수: 이번 턴 이동 계획에 묶인 장수도 보여줌 (출발 전까지는 이곳에 있음)
  const gens = r && view === 'visible' ? Object.values(game.generals).filter((g) => g.status === 'active' && g.region === selected) : [];
  const orderTo = (g) => (g.order ? (game.orders || []).find((o) => o.id === g.order) : null);
  const w = r ? WEATHER[game.weather?.[selected] || 'clear'] : null;

  const setBulk = (k) =>
    act((s) => {
      s.nations[pid].taxRate = k;
      for (const x of s.regions) if (x.owner === pid) delete x.tax;
      return { ok: true, msg: `전 지역 세율을 '${TAX[k].name}'(으)로 일괄 설정했습니다.` };
    });

  return (
    <div className={'side' + (sheetOpen ? ' open' : '')}>
      <div className="sheet-bar">
        <span className="grip" />
        <button className="sm ghost" onClick={onCloseSheet}>
          닫기 ✕
        </button>
      </div>
      <div className="card nation-card">
        <h3>
          <span className="chip" style={{ background: me.color }} />
          {spectator ? `👁️ 관전 중 (기준: ${me.name})` : <EditableName value={me.name} onSave={(t) => act((s) => ((s.nations[pid].name = t), { ok: true, msg: `국호를 ${t}(으)로 바꿨습니다.` }))} />}
        </h3>
        <div className="quick">
          <span title="국고 (턴당 순수입)">
            💰 <b>{fmtGold(me.gold)}</b> <small style={{ color: inc.net < 0 ? 'var(--danger)' : 'var(--muted)' }}>({inc.net >= 0 ? '+' : ''}{fmtGold(inc.net)}/턴)</small>
          </span>
          <span title="영토">🗺️ {myRegions.length}곳</span>
          <span title="총 병력">🪖 {fmtTroops(inc.troops)}</span>
          {cut > 0 && <span style={{ color: 'var(--danger)' }}>✂ 보급 끊김 {cut}</span>}
          {!spectator && (
            <label title="집결지가 없을 때, 후방 병력이 매 턴 국경으로 자동 행군 (행동력 없음). 어느 나라 쪽으로 보낼지 고를 수 있습니다." style={{ whiteSpace: 'nowrap' }}>
              🚩 전선 투입{' '}
              <select
                value={me.rally?.foe != null ? `n${me.rally.foe}` : me.rally?.front ? 'hot' : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  act((s) => {
                    s.nations[pid].rally = { ...(s.nations[pid].rally || { to: null }), front: v === 'hot', foe: v.startsWith('n') ? +v.slice(1) : null };
                    return { ok: true, msg: v === '' ? '전선 자동 투입을 껐습니다.' : v === 'hot' ? '후방 병력이 위협받는 국경으로 자동 행군합니다.' : `후방 병력이 ${s.nations[+v.slice(1)].name} 쪽 국경으로 자동 행군합니다.` };
                  });
                }}
              >
                <option value="">끔</option>
                <option value="hot">위협받는 국경</option>
                {foes.map((o) => (
                  <option key={o} value={`n${o}`}>
                    {game.nations[o].name} 쪽
                  </option>
                ))}
              </select>
            </label>
          )}
          {me.rally?.to != null && game.regions[me.rally.to]?.owner === pid && <span>🚩 집결: {game.regions[me.rally.to].name}</span>}
          {!spectator && openLoyalty && (
            <button className="sm" onClick={openLoyalty} title="민심 낮은 순으로 지역을 보고 진휼">
              📋 지역 목록{lowLoy ? ` (민심 위험 ${lowLoy})` : ''}
            </button>
          )}
          {incoming.length > 0 && <span title={incoming.map((o) => `${game.regions[o.to].name} ${fmtTroops(o.count)} (${o.arrive - game.turn}턴 뒤)`).join('\n')}>🪖 증원 이동 중 {incoming.length}</span>}
          {game.coalition && <span style={{ color: 'var(--danger)' }}>⚔️ 대동맹: {game.nations[game.coalition.target].name}</span>}
        </div>
        {!spectator && nextGold < 0 && (
          <div className="warn-box">
            ⚠️ 다음 턴 파산 예상 — 수입 {fmtGold(inc.gross)} − 지출 {fmtGold(inc.upkeep)} = {fmtGold(inc.net)}/턴, 국고 {fmtGold(me.gold)}. 이대로면 못 준 녹봉만큼(약 {fmtTroops(-nextGold)}) 병사가 탈영합니다. 지역에서 🏳️해산하거나 세율을 올리세요. (병사 1명당 1금)
          </div>
        )}
        {!spectator && nextGold >= 0 && inc.net < 0 && nextGold + inc.net * 2 < 0 && (
          <div className="warn-box soft">💸 적자 {fmtGold(inc.net)}/턴 — 약 {Math.max(1, Math.floor(me.gold / -inc.net))}턴 뒤 파산. 병력 유지비가 {fmtGold(inc.army)}입니다.</div>
        )}
        <details className="more">
          <summary>자세히 (수입·세율·장수·승리 조건)</summary>
        <div className="kv">
            <span>군주</span>
            <span>{ruler ? ruler.name : '없음'}</span>
            <span>영토</span>
            <span>
              {myRegions.length}지역 / 전체 {landCount(game)}
              {cut > 0 && <span style={{ color: 'var(--danger)' }}> · 보급 끊김 {cut}</span>}
            </span>
            <span>병력</span>
            <span>{fmtTroops(inc.troops)}</span>
            <span>수입</span>
            <span>
              세금 +{fmtGold(inc.gross)} − 병력 유지비 {fmtGold(inc.army)} − 장수 녹봉 {fmtGold(inc.salary)}{inc.admin ? ` − 통치비 ${fmtGold(inc.admin)}` : ''} = <b style={{ color: inc.net < 0 ? 'var(--danger)' : undefined }}>{fmtGold(inc.net)}</b>금/턴
            </span>
            <span>세율 일괄</span>
            <span>
              <TaxButtons value={me.taxRate || 'normal'} onPick={setBulk} />
              {overrides > 0 && <small className="muted"> 개별 설정 {overrides}곳 (일괄 선택 시 초기화)</small>}
            </span>
            <span>장수</span>
            <span>
              {nationGenerals(game, pid).length}명 · 출현확률 {Math.round(appearChance(game, pid) * 100)}%
            </span>
            {lord && (
              <>
                <span>종주국</span>
                <span>{lord.name} (수입 25% 조공)</span>
              </>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            승리: 모든 육지(100%) 점령 또는 모든 국가 멸망·속국화.
          </div>
        </details>
      </div>

      {r && view === 'hidden' && (
        <div className="card">
          <h3>🌫️ 미탐색 지역</h3>
          <div className="muted">아직 정찰하지 못한 땅입니다. 인접한 곳까지 진출하면 보입니다.</div>
        </div>
      )}

      {r && view !== 'hidden' && r.sea && (
        <div className="card">
          <h3>🌊 {r.name}</h3>
          <div className="kv">
            <span>함대</span>
            <span>
              {r.owner !== null && r.troops > 0 ? (
                <>
                  <span className="chip" style={{ background: game.nations[r.owner].color }} />
                  {game.nations[r.owner].name} · {showT ? `${r.troops.toLocaleString('ko-KR')}명` : '?'}
                </>
              ) : (
                '없음'
              )}
            </span>
            <span>날씨</span>
            <span>
              {w.icon} {w.name} {w.desc && <small className="muted">{w.desc}</small>}
            </span>
            <span>연결</span>
            <span style={{ fontSize: 12 }}>
              {wr.neighbors.map((n) => (
                <span key={n.id} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                  {game.regions[n.id].name}
                  <small className="muted">({EDGE[n.type].name}{n.mtn ? '·험산' : ''})</small>
                </span>
              ))}
            </span>
          </div>
          {mine && (
            <div className="actions" style={{ marginTop: 10 }}>
              <button className={moveMode ? 'primary' : ''} onClick={() => setMoveMode(!moveMode)}>
                ⛵ 항해·상륙 (M)
              </button>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            함대는 한 번에 바다 한 구역씩 움직이고, 적 함대가 있는 구역은 해전으로 뚫어야 합니다. 바다에서는 매 턴 2%(폭풍 시 10%)씩 병력이 줄어듭니다.
          </div>
          {view === 'visible' && gens.map((g) => <GenLine key={g.id} g={g} />)}
        </div>
      )}

      {r && view !== 'hidden' && !r.sea && (
        <div className="card">
          <h3>
            {r.name}
            {owner && owner.capital === selected && ' ♛'}
            {view === 'known' && <small className="muted"> (시야 밖)</small>}
          </h3>
          {/* 핵심 정보: 한눈에 */}
          <div className="quick">
            <span>
              {owner ? (
                <>
                  <span className="chip" style={{ background: owner.color }} />
                  {owner.name} {relTag(game, pid, owner.id)}
                </>
              ) : (
                '중립 세력'
              )}
            </span>
            <span title="병사 (이번 턴 이동 가능)">
              🪖 <b>{showT ? fmtTroops(r.troops) : '?'}</b>
              {mine && (r.moved || 0) > 0 && <small className="muted"> (이동 가능 {fmtTroops(movable(game, selected))})</small>}
            </span>
            {r.owner !== null && view === 'visible' && (
              <span title="민심" style={{ color: r.loyalty < 25 ? 'var(--danger)' : r.loyalty < 50 ? 'var(--accent)' : undefined }}>
                ❤️ {Math.round(r.loyalty ?? 100)}
                {r.loyalty < 25 && ' 반란 위험'}
              </span>
            )}
            <span title={TERRAIN[wr.terrain].desc}>⛰️ {TERRAIN[wr.terrain].name}</span>
            {r.plain && <span title="대평야: 세금 +20%, 인구 상한 +30%, 민심 +1/턴">🌾 대평야</span>}
            <span title={w.desc}>
              {w.icon} {w.name}
            </span>
            {r.owner !== null && view === 'visible' && !supplied(game, world, r.owner).has(selected) && <span style={{ color: 'var(--danger)' }}>✂ 보급 끊김</span>}
            {Object.entries(r.buildings).filter(([, v]) => v).length > 0 && (
              <span>
                {Object.entries(r.buildings)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${BUILDINGS[k].icon}${k === 'walls' ? v : ''}`)
                  .join(' ')}
              </span>
            )}
          </div>
          {!spectator && !mine && !r.sea && (() => {
            const own = r.owner !== null ? game.nations[r.owner] : null;
            if (own?.fief && own.lord === pid)
              return (
                <div className="actions" style={{ marginTop: 10 }}>
                  <span className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>🏯 내 군단 — {game.generals[own.ruler]?.name} (충성 {Math.round(game.generals[own.ruler]?.loyalty ?? 60)}) · 상납 없음, 큰일엔 지원 요청</span>
                  <button onClick={() => act((s) => revokeFief(s, world, pid, own.id))}>🏯 군단 회수</button>
                </div>
              );
            const agents = bribeAgents(game, world, pid, selected);
            const canBribe = agents.length > 0 && !(own && (getRel(game, pid, own.id).type === 'alliance' || own.capital === selected));
            const horde = own?.horde && getRel(game, pid, own.id).type === 'none';
            if (!canBribe && !horde) return null;
            return (
              <div className="actions" style={{ marginTop: 10 }}>
                {canBribe && <button onClick={openBribe} title="맞닿은 곳의 장수가 돈으로 이 땅을 넘어오게 함 (실패하면 돈은 상대에게)">💰 매수 ({fmtGold(bribeCost(game, selected))}금)</button>}
                {horde && (
                  <>
                    <button disabled={me.ap < 1 || me.gold < pacifyCost(game, own.id, 'peace')} title="돈을 주고 8턴 동안 서로 치지 않기로 함 (돈만 받고 응하지 않을 수도 있음)" onClick={() => act((s) => doPacify(s, world, pid, own.id, 'peace'))}>
                      🤝 화친 {fmtGold(pacifyCost(game, own.id, 'peace'))}금 · {Math.round(pacifyChance(game, pid, own.id, 'peace') * 100)}%
                    </button>
                    <button disabled={me.ap < 1 || me.gold < pacifyCost(game, own.id, 'absorb')} title="큰돈을 주고 무리 전체를 거둬들임 (땅·병력 60%·장수가 내 것으로)" onClick={() => act((s) => doPacify(s, world, pid, own.id, 'absorb'))}>
                      🏳️ 귀순시키기 {fmtGold(pacifyCost(game, own.id, 'absorb'))}금 · {Math.round(pacifyChance(game, pid, own.id, 'absorb') * 100)}%
                    </button>
                  </>
                )}
              </div>
            );
          })()}
          {mine && (
            <>
              <div className="actions" style={{ marginTop: 10 }}>
                <button className={moveMode ? 'primary' : ''} onClick={() => setMoveMode(!moveMode)} disabled={r.troops < 2}>
                  🚩 이동·공격 (M)
                </button>
                <button onClick={openConscript} disabled={r.conscripted || me.ap < COST.conscript}>
                  🪖 징병 (최대 {fmtTroops(conscriptMax(game, selected, pid))})
                </button>
                <button
                  onClick={() => act((s) => doRelief(s, pid, selected))}
                  disabled={me.gold < reliefCost(game, selected) || (r.loyalty ?? 100) >= 100 || (r.reliefTurn !== undefined && game.turn - r.reliefTurn < RELIEF_COOLDOWN)}
                  title={`민심 40 미만이면 +14, 아니면 +7. 지역마다 ${RELIEF_COOLDOWN}턴에 한 번`}
                >
                  🍚 진휼 ({fmtGold(reliefCost(game, selected))}금)
                </button>
                <button
                  className={me.rally?.to === selected ? 'primary' : ''}
                  title="후방(국경에 닿지 않은 내 땅) 병력이 매 턴 자동으로 이곳에 모입니다. 행동력 없음, 각 지역에 1천(수도 3천)은 남김."
                  onClick={() =>
                    act((s) => {
                      const n = s.nations[pid];
                      const on = n.rally?.to === selected;
                      n.rally = { ...(n.rally || {}), to: on ? null : selected };
                      return { ok: true, msg: on ? '집결지를 해제했습니다.' : `${s.regions[selected].name}을(를) 집결지로 정했습니다. 턴 종료 때마다 후방 병력이 이곳으로 행군합니다.` };
                    })
                  }
                >
                  🚩 {me.rally?.to === selected ? '집결 해제' : '집결지로'}
                </button>
                <button onClick={openCall} title="다른 내 지역에서 정한 만큼 이곳으로 불러옴 (내 땅 3칸에 1턴, 행동력 1)">📯 병력 불러오기</button>
                <button onClick={openDisband} title="병사를 집으로 돌려보냄 (유지비 절감, 행동력 없음)">🏳️ 해산</button>
                {me.capital !== selected && (
                  <button onClick={openFief} title="장수에게 이 일대를 맡겨 스스로 다스리게 함 (언제든 회수)">🏯 분봉</button>
                )}
                {me.capital !== selected && (
                  <button
                    onClick={() => act((s) => doMoveCapital(s, world, pid, selected))}
                    disabled={!!capitalMoveCheck(game, world, pid, selected)}
                    title={capitalMoveCheck(game, world, pid, selected) || `수도를 이곳으로 옮깁니다. 새 수도 민심 +10, 옛 수도 -10. ${CAPITAL_COOLDOWN}턴에 한 번`}
                  >
                    🏯 천도 ({fmtGold(capitalMoveCost(game, pid))}금·3AP)
                  </button>
                )}
              </div>
              <h4 style={{ marginTop: 10 }}>건설</h4>
              <div className="actions">
                {Object.entries(BUILDINGS).map(([k, b]) => {
                  if (b.coastal && !wr.coastal) return null;
                  const cost = buildCost(game, selected, pid, k);
                  const repair = k === 'walls' && r.buildings.walls > 0 && r.buildings.walls < WALL_MAX;
                  const done = r.buildings[k] && !repair;
                  return (
                    <button key={k} title={b.desc} disabled={done || me.gold < cost || me.ap < b.ap} onClick={() => act((s) => doBuild(s, world, pid, selected, k))}>
                      {b.icon} {repair ? '성벽 보수' : b.name} {done ? '✓' : `${fmtGold(cost)}금·${b.ap}AP`}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <details className="more">
            <summary>자세히</summary>
            <div className="kv">
              <span>지형</span>
              <span>
                {TERRAIN[wr.terrain].name} <small className="muted">{TERRAIN[wr.terrain].desc}</small>
              </span>
              <span>날씨</span>
              <span>
                {w.icon} {w.name} {w.desc && <small className="muted">{w.desc}</small>}
              </span>
              {r.owner !== null && view === 'visible' && (
                <>
                  <span>보급</span>
                  <span style={{ color: supplied(game, world, r.owner).has(selected) ? undefined : 'var(--danger)' }}>
                    {supplied(game, world, r.owner).has(selected) ? '연결됨' : '끊김 (병력 -8%/턴, 전투력 -20%)'}
                  </span>
                  <span>세수</span>
                  <span>
                    {fmtGold(regionTax(game, selected))}금/턴 <small className="muted">세율 {TAX[effTax(game, selected)].name}</small>
                  </span>
                </>
              )}
              <span>인구</span>
              <span>{Math.round(r.pop)}천</span>
              {r.owner !== null && governorOf(game, selected) && (
                <>
                  <span>태수</span>
                  <span>
                    {(() => {
                      const gv = governorOf(game, selected), b = governorBonus(gv);
                      return `${gv.name} (정${gv.pol}${gv.role === 'civ' ? '' : ', 무관 절반'}) · 세수 +${Math.round(b.tax * 100)}%${b.loyalty ? ` · 민심 +${b.loyalty}/턴` : ''}`;
                    })()}
                  </span>
                </>
              )}
              <span>특징</span>
              <span>{[wr.coastal && '해안', wr.river && '강 유역'].filter(Boolean).join(' · ') || '-'}</span>
              <span>건물</span>
              <span>
                {Object.entries(r.buildings)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${BUILDINGS[k].icon}${BUILDINGS[k].name}${k === 'walls' ? ` ${v}/${WALL_MAX}` : ''}`)
                  .join(' ') || '없음'}
                {r.engines ? ` · 🛠️공성병기 ${r.engines}` : ''}
              </span>
              <span>인접</span>
              <span style={{ fontSize: 12 }}>
                {wr.neighbors.map((n) => (
                  <span key={n.id} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                    {game.regions[n.id].name}
                    {n.type !== 'land' && <small className="muted">({EDGE[n.type].name})</small>}
                    {n.mtn && <small className="muted">⛰️험산</small>}
                  </span>
                ))}
              </span>
            </div>
          </details>
          {view === 'visible' && (
            <>
              <h4 style={{ marginTop: 10 }}>주둔 장수</h4>
              {gens.length === 0 && <div className="muted">없음</div>}
              {gens.map((g) => (
                <GenLine
                  key={g.id}
                  g={g}
                  extra={
                    orderTo(g) ? (
                      <small className="muted">🚩 이번 턴 {game.regions[orderTo(g).to].name || '바다'}(으)로 출발 예정</small>
                    ) : g.nation !== pid && (
                      <button className="sm" style={{ marginTop: 4 }} onClick={() => act((s) => doPoach(s, pid, g.id))} disabled={me.ap < COST.poach || me.gold < COST.poachGold || poachChance(game, pid, g) === 0}>
                        회유 ({fmtGold(COST.poachGold)}금·{COST.poach}AP · {poachChance(game, pid, g)}%)
                      </button>
                    )
                  }
                />
              ))}
            </>
          )}
          {mine && gens.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>장수는 🚩이동·공격 계획을 세울 때 함께 데려갈 수 있습니다.</div>}
          {!mine && owner && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{CIVS[owner.civ]?.name} 문명 · 공격하려면 인접한 내 지역을 선택 후 이동하세요.</div>}
        </div>
      )}
    </div>
  );
}
