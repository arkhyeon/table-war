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
  poachChance, doPoach, income, isVassalOf, effTax, supplied, WALL_MAX, landCount, doRelief, reliefCost, RELIEF_COOLDOWN, doBuildEngine, engineCost, ENGINE_MAX, governorOf, governorBonus,
} from '../game/engine.js';

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

export default function SidePanel({ world, game, selected, vis, spectator, moveMode, setMoveMode, act, openGenerals, openConscript }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const myRegions = nationRegions(game, pid);
  const inc = income(game, pid);
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
  const gens = r && view === 'visible' ? gensIn(game, selected) : [];
  const w = r ? WEATHER[game.weather?.[selected] || 'clear'] : null;

  const setBulk = (k) =>
    act((s) => {
      s.nations[pid].taxRate = k;
      for (const x of s.regions) if (x.owner === pid) delete x.tax;
      return { ok: true, msg: `전 지역 세율을 '${TAX[k].name}'(으)로 일괄 설정했습니다.` };
    });

  return (
    <div className="side">
      <div className="card">
        <h3>
          <span className="chip" style={{ background: me.color }} />
          {spectator ? `👁️ 관전 중 (기준: ${me.name})` : <EditableName value={me.name} onSave={(t) => act((s) => ((s.nations[pid].name = t), { ok: true, msg: `국호를 ${t}(으)로 바꿨습니다.` }))} />}
        </h3>
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
          {game.coalition && <div style={{ color: 'var(--danger)' }}>⚔️ 대동맹 결성: {game.nations[game.coalition.target].name}이(가) 공공의 적</div>}
          승리: 전체 육지의 {Math.round((game.winShare || 0.6) * 100)}% 점령 또는 모든 국가 멸망·속국화.
        </div>
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
                  <small className="muted">({EDGE[n.type].name})</small>
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
          <div className="kv">
            <span>소유</span>
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
            <span>지형</span>
            <span>
              {TERRAIN[wr.terrain].name} <small className="muted">{TERRAIN[wr.terrain].desc}</small>
            </span>
            <span>날씨</span>
            <span>
              {w.icon} {w.name} {w.desc && <small className="muted">{w.desc}</small>}
            </span>
            <span>병사</span>
            <span>{showT ? <><b>{r.troops.toLocaleString('ko-KR')}</b>명</> : '?'}</span>
            {r.owner !== null && view === 'visible' && (
              <>
                <span>민심</span>
                <span style={{ color: r.loyalty < 25 ? 'var(--danger)' : r.loyalty < 50 ? 'var(--accent)' : undefined }}>
                  {Math.round(r.loyalty ?? 100)} {r.loyalty < 25 && '⚠️ 반란 위험'}
                </span>
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
                </span>
              ))}
            </span>
          </div>
          {mine && (
            <>
              <div className="row" style={{ marginTop: 8, fontSize: 13 }}>
                <span className="muted">지역 세율</span>
                <TaxButtons
                  value={r.tax || null}
                  withDefault
                  onPick={(k) =>
                    act((s) => {
                      if (k) s.regions[selected].tax = k;
                      else delete s.regions[selected].tax;
                      return { ok: true };
                    })
                  }
                />
              </div>
              <div className="actions" style={{ marginTop: 10 }}>
                <button className={moveMode ? 'primary' : ''} onClick={() => setMoveMode(!moveMode)} disabled={r.troops < 2}>
                  🚩 이동·공격 (M)
                </button>
                <button onClick={openConscript} disabled={r.conscripted || me.ap < COST.conscript}>
                  🪖 징병 (최대 {fmtTroops(conscriptMax(game, selected, pid))})
                </button>
                <button
                  onClick={() => act((s) => doRelief(s, pid, selected))}
                  disabled={me.ap < 1 || me.gold < reliefCost(game, selected) || (r.reliefTurn !== undefined && game.turn - r.reliefTurn < RELIEF_COOLDOWN)}
                  title={`민심 40 미만이면 +14, 아니면 +7. 지역마다 ${RELIEF_COOLDOWN}턴에 한 번`}
                >
                  🍚 진휼 ({fmtGold(reliefCost(game, selected))}금·1AP)
                </button>
                <button onClick={() => act((s) => doBuildEngine(s, pid, selected))} disabled={me.ap < 1 || me.gold < engineCost(game, selected) || (r.engines || 0) >= ENGINE_MAX} title="포위 공격 시 성벽 피해 +1, 성벽 방어 효과 감소. 병영이 있으면 저렴">
                  🛠️ 공성병기 {r.engines || 0}/{ENGINE_MAX} ({fmtGold(engineCost(game, selected))}금·1AP)
                </button>
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
          {view === 'visible' && (
            <>
              <h4 style={{ marginTop: 10 }}>주둔 장수</h4>
              {gens.length === 0 && <div className="muted">없음</div>}
              {gens.map((g) => (
                <GenLine
                  key={g.id}
                  g={g}
                  extra={
                    g.nation !== pid && (
                      <button className="sm" style={{ marginTop: 4 }} onClick={() => act((s) => doPoach(s, pid, g.id))} disabled={me.ap < COST.poach || me.gold < COST.poachGold || poachChance(game, pid, g) === 0}>
                        회유 ({fmtGold(COST.poachGold)}금·{COST.poach}AP · {poachChance(game, pid, g)}%)
                      </button>
                    )
                  }
                />
              ))}
            </>
          )}
          {mine && gens.length > 0 && (
            <button className="sm" onClick={openGenerals} style={{ marginTop: 6 }}>
              장수 재배치 →
            </button>
          )}
          {!mine && owner && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{CIVS[owner.civ]?.name} 문명 · 공격하려면 인접한 내 지역을 선택 후 이동하세요.</div>}
        </div>
      )}
    </div>
  );
}
