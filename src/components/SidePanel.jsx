import { TERRAIN, BUILDINGS, COST, TRAITS, EDGE } from '../game/rules.js';
import { CIVS } from '../game/civs.js';
import {
  doTax, doConscript, doBuild, buildCost, conscriptAmount, gensIn, nationRegions, nationGenerals, appearChance, getRel,
  poachChance, doPoach, income, isVassalOf,
} from '../game/engine.js';

export function relTag(game, a, b) {
  if (a === b) return null;
  const r = getRel(game, a, b);
  if (r.type === 'alliance') return <span className="tag ally">동맹</span>;
  if (r.type === 'nap') return <span className="tag nap">불가침 ~{r.until}턴</span>;
  if (r.type === 'vassal') return <span className="tag vassal">{r.overlord === a ? '내 속국' : '종주국'}</span>;
  return null;
}

export function GenLine({ g, extra }) {
  return (
    <div className="gen">
      <b>{g.name}</b> <span className="tag" title={TRAITS[g.trait]}>{g.trait}</span>
      <div className="stats4">
        무{g.war} 통{g.lead} 지{g.intel} 정{g.pol} · 충성 {g.loyalty}
      </div>
      {extra}
    </div>
  );
}

export default function SidePanel({ world, game, selected, moveMode, setMoveMode, act, openGenerals }) {
  const pid = game.playerId;
  const me = game.nations[pid];
  const myRegions = nationRegions(game, pid);
  const troops = myRegions.reduce((a, r) => a + game.regions[r].troops, 0);
  const inc = income(game, pid);
  const ruler = game.generals[me.ruler];
  const lord = game.nations.find((o) => o.alive && isVassalOf(game, pid, o.id));

  const r = selected !== null && selected !== undefined ? game.regions[selected] : null;
  const wr = r ? world.regions[selected] : null;
  const mine = r && r.owner === pid;
  const owner = r && r.owner !== null ? game.nations[r.owner] : null;
  const gens = r ? gensIn(game, selected) : [];

  return (
    <div className="side">
      <div className="card">
        <h3>
          <span className="chip" style={{ background: me.color }} />
          {me.name}
        </h3>
        <div className="kv">
          <span>군주</span>
          <span>{ruler ? `${ruler.name} (${ruler.trait})` : '없음'}</span>
          <span>영토</span>
          <span>
            {myRegions.length}지역 / 전체 {game.regions.length}
          </span>
          <span>병력</span>
          <span>{troops}명</span>
          <span>수입</span>
          <span>
            +{inc.gross} − 유지비 {inc.upkeep} = {inc.net}금
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
          승리: 전체 지역 60% 점령 또는 모든 국가 멸망·속국화
        </div>
      </div>

      {r && (
        <div className="card">
          <h3>
            {r.name}
            {owner && owner.capital === selected && ' ♛'}
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
            <span>병사</span>
            <span>
              <b>{r.troops}</b>명
            </span>
            <span>인구</span>
            <span>{Math.round(r.pop)}천</span>
            <span>특징</span>
            <span>
              {[wr.coastal && '해안', wr.river && '강 유역', r.unrest > 0 && '징세 피로'].filter(Boolean).join(' · ') || '-'}
            </span>
            <span>건물</span>
            <span>
              {Object.entries(r.buildings)
                .filter(([, v]) => v)
                .map(([k]) => `${BUILDINGS[k].icon}${BUILDINGS[k].name}`)
                .join(' ') || '없음'}
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
              <div className="actions" style={{ marginTop: 10 }}>
                <button className={moveMode ? 'primary' : ''} onClick={() => setMoveMode(!moveMode)} disabled={r.troops < 2}>
                  🚩 이동·공격 (M)
                </button>
                <button onClick={() => act((s) => doTax(s, world, pid, selected))} disabled={r.taxed || me.ap < COST.tax}>
                  💰 징세 ({COST.tax}AP)
                </button>
                <button onClick={() => act((s) => doConscript(s, world, pid, selected))} disabled={r.conscripted || me.ap < COST.conscript || me.gold < COST.conscriptGold} title={`약 +${conscriptAmount(game, selected, pid)}명`}>
                  🪖 징병 +{conscriptAmount(game, selected, pid)} ({COST.conscript}AP·{COST.conscriptGold}금)
                </button>
              </div>
              <h4 style={{ marginTop: 10 }}>건설</h4>
              <div className="actions">
                {Object.entries(BUILDINGS).map(([k, b]) => {
                  if (b.coastal && !wr.coastal) return null;
                  const cost = buildCost(game, selected, pid, k);
                  return (
                    <button key={k} title={b.desc} disabled={!!r.buildings[k] || me.gold < cost || me.ap < b.ap} onClick={() => act((s) => doBuild(s, world, pid, selected, k))}>
                      {b.icon} {b.name} {r.buildings[k] ? '✓' : `${cost}금·${b.ap}AP`}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <h4 style={{ marginTop: 10 }}>주둔 장수</h4>
          {gens.length === 0 && <div className="muted">없음</div>}
          {gens.map((g) => (
            <GenLine
              key={g.id}
              g={g}
              extra={
                g.nation !== pid && (
                  <button className="sm" style={{ marginTop: 4 }} onClick={() => act((s) => doPoach(s, pid, g.id))} disabled={me.ap < COST.poach || me.gold < COST.poachGold || poachChance(game, pid, g) === 0}>
                    회유 ({COST.poachGold}금·{COST.poach}AP · {poachChance(game, pid, g)}%)
                  </button>
                )
              }
            />
          ))}
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
