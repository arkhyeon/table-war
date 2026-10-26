import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView.jsx';
import SidePanel from './SidePanel.jsx';
import { MoveModal, DiplomacyModal, GeneralsModal, HelpModal, ProposalModal, NewsModal, GameOverModal, ConfirmModal, DuelModal, BattleReplay, ChronicleModal, ConscriptModal, TakeoverModal, GodModal } from './Modals.jsx';
import { endTurn } from '../game/turn.js';
import { edgeBetween, income, doMove, gensIn, supplied, nationRegions, moveCheck, getRel } from '../game/engine.js';
import { visibleSet, viewOf, troopsShown, updateExplored } from '../game/fog.js';
import { duelist } from '../game/duel.js';
import { ACHIEVEMENTS } from '../game/achievements.js';
import { SEASONS, seasonOf, yearOf, TURNS_PER_SEASON, fmtYear } from '../game/weather.js';
import { spawnGeneral } from '../game/engine.js';
import { stateRng } from '../game/rng.js';
import { G } from '../game/rules.js';
import { fixJosa } from '../game/josa.js';
import { clearSave } from '../storage.js';
import { fmtTroops, fmtGold } from '../game/format.js';

export default function Game({ world, scn, game, setGame, onExit }) {
  const [selected, setSelected] = useState(game.nations[game.playerId].capital);
  const [moveMode, setMoveMode] = useState(false);
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [showLog, setShowLog] = useState(() => window.innerWidth > 860);
  const [ask, setAsk] = useState(null); // { text, onYes }
  const confirmIt = useCallback((text, onYes) => setAsk({ text, onYes }), []);
  const toastId = useRef(0);
  const me = game.nations[game.playerId];
  const pid = game.playerId;
  const [replay, setReplay] = useState(null); // { list, i }
  const [replayDelay, setReplayDelay] = useState(1200);
  const spect = !!game.spectator;
  const [auto, setAuto] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(900);
  const vis = useMemo(() => visibleSet(game, world, pid), [game, world, pid]);

  const toast = useCallback((text, bad = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text: fixJosa(text), bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const act = useCallback(
    (fn) => {
      const s = structuredClone(game);
      const res = fn(s);
      updateExplored(s, world);
      if (res && res.ok === false) {
        toast(res.msg, true);
        return res;
      }
      setGame(s);
      if (res?.msg) toast(res.msg, res.accepted === false);
      return res;
    },
    [game, setGame, toast, world],
  );

  const doEndTurn = () => {
    setMoveMode(false);
    const s = structuredClone(game);
    const before = visibleSet(game, world, pid);
    endTurn(s, world);
    setGame(s);
    if (s.spectator) return;
    for (const id of s.newAchieve || []) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) toast(`🏅 업적 달성: ${a.icon} ${a.name}`);
    }
    const after = visibleSet(s, world, pid);
    const seen = (s.battles || []).filter((b) => b.attacker === pid || b.defender === pid || before.has(b.to) || after.has(b.to) || before.has(b.from));
    if (s.opts?.showBattles !== false && seen.length && !s.gameOver) setReplay({ list: seen, i: 0 });
    else if ((s.turnNews?.length || s.turnEvents?.length) && !s.gameOver) setModal({ type: 'news' });
    if (!s.nations[s.playerId].alive) setSelected(null);
  };

  // 관전 자동 진행
  useEffect(() => {
    if (!spect || !auto || modal) return;
    const t = setTimeout(doEndTurn, autoSpeed);
    return () => clearTimeout(t);
  });

  const takeOver = (nid) => {
    const s = structuredClone(game);
    s.spectator = false;
    s.playerId = nid;
    s.nations.forEach((n) => (n.isPlayer = n.id === nid));
    s.gameOver = null;
    s.explored = null;
    updateExplored(s, world);
    s.log.unshift({ turn: s.turn, text: `🎯 ${s.nations[nid].name}(으)로 난입했습니다!`, nations: [nid], kind: 'info' });
    setGame(s);
    setAuto(false);
    setModal(null);
    setSelected(s.nations[nid].capital);
  };

  const gift = (nid, kind, amount) =>
    act((s) => {
      const n = s.nations[nid];
      if (kind === 'gold') n.gold += amount;
      if (kind === 'troops' && n.capital !== null) s.regions[n.capital].troops += amount;
      if (kind === 'general') {
        const g = spawnGeneral(s, nid, stateRng(s), true);
        if (!g) return { ok: false, msg: '더 출현할 장수가 없습니다.' };
      }
      const what = kind === 'gold' ? `금 ${fmtGold(amount)}` : kind === 'troops' ? `병력 ${fmtTroops(amount)}` : '장수';
      s.log.unshift({ turn: s.turn, text: `🎁 하늘의 도움: ${n.name}에 ${what}`, nations: [nid], kind: 'info' });
      return { ok: true, msg: `${n.name}에 ${what}을(를) 주었습니다.` };
    });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMoveMode(false);
        if (modal && modal.type !== 'over') setModal(null);
      }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'm' && selected !== null && game.regions[selected]?.owner === game.playerId) setMoveMode((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, selected, game]);

  const targets = useMemo(() => {
    if (!moveMode || selected === null || game.regions[selected].owner !== game.playerId) return null;
    const m = new Map();
    const fr = game.regions[selected];
    const gens = gensIn(game, selected, pid).map((g) => g.id);
    const probe = fr.sea ? fr.troops : fr.troops - 1;
    for (const nb of world.regions[selected].neighbors) {
      const t = game.regions[nb.id];
      const ally = t.owner !== null && t.owner !== pid && !t.sea && getRel(game, pid, t.owner).type === 'alliance';
      let kind = ally || t.owner === pid || (t.sea && (t.owner === null || t.troops <= 0)) ? 'move' : 'attack';
      const why = moveCheck(game, world, pid, selected, nb.id, Math.max(1, probe), ally ? [] : gens);
      if (why && !why.startsWith('행동력') && !why.startsWith('이동 병력')) kind = 'blocked';
      m.set(nb.id, kind);
    }
    return m;
  }, [moveMode, selected, game, world, pid]);

  const genCount = useMemo(() => {
    const c = {};
    for (const g of Object.values(game.generals)) if (g.status === 'active') c[g.region] = (c[g.region] || 0) + 1;
    return c;
  }, [game.generals]);

  const openMove = (from, to) => {
    if (!edgeBetween(world, from, to)) return;
    setModal({ type: 'move', from, to });
  };

  const onRegionClick = (rid) => {
    if (targets && targets.has(rid)) {
      if (targets.get(rid) === 'blocked') {
        const fr = game.regions[selected];
        toast(moveCheck(game, world, pid, selected, rid, Math.max(1, fr.sea ? fr.troops : fr.troops - 1), gensIn(game, selected, pid).map((g) => g.id)) || '이동할 수 없습니다.', true);
        return;
      }
      openMove(selected, rid);
      return;
    }
    setSelected(rid);
    setMoveMode(false);
  };

  const onRegionContext = (rid) => {
    if (selected !== null && game.regions[selected].owner === game.playerId && edgeBetween(world, selected, rid)) openMove(selected, rid);
  };

  const inc = income(game, game.playerId);
  const finishReplay = useCallback(() => {
    setReplay(null);
    if (game.turnNews?.length || game.turnEvents?.length) setModal({ type: 'news' });
  }, [game.turnNews, game.turnEvents]);
  const toggleReplaySpeed = () => setReplayDelay((d) => (d < 1000 ? 1200 : 550));
  const nextReplay = useCallback(() => {
    if (!replay) return;
    if (replay.i + 1 < replay.list.length) setReplay({ ...replay, i: replay.i + 1 });
    else finishReplay();
  }, [replay, finishReplay]);
  const view = useCallback((rid) => viewOf(game, vis, rid), [game, vis]);
  const showTroops = useCallback((rid) => troopsShown(game, viewOf(game, vis, rid)), [game, vis]);
  const cutSet = useMemo(() => {
    const sup = supplied(game, world, pid);
    return new Set(nationRegions(game, pid).filter((r) => !sup.has(r)));
  }, [game, world, pid]);
  const shownBattles = replay ? [replay.list[replay.i]] : (game.battles || []).filter((b) => b.attacker === pid || b.defender === pid || vis.has(b.to));
  const year = yearOf(game.turn, scn.startYear ?? 1);
  const flashSet = useMemo(() => new Set((game.turnEvents || []).flatMap((e) => e.rids || [])), [game.turnEvents]);
  const myEvents = (game.turnEvents || []).filter((e) => e.global || e.nations.includes(pid) || e.nations.length > 3 || e.nations.some((id) => vis.has(game.nations[id]?.capital)));

  const startDuel = ({ from, to, count, sel, opts }) => {
    const ag = duelist(sel.map((id) => game.generals[id]));
    const dg = duelist(gensIn(game, to, game.regions[to].owner));
    if (dg.war < ag.war - 15 && Math.random() < 0.7) {
      toast(`${dg.name}이(가) 일기토를 거절하고 성문을 걸어 잠갔습니다.`);
      const res = act((s) => doMove(s, world, pid, from, to, count, sel, { ...opts, duel: false }));
      if (res?.ok) { setModal(null); setMoveMode(false); }
      return;
    }
    setModal({ type: 'duel', from, to, count, sel, opts, attId: ag.id, defId: dg.id });
  };
  const proposal = game.proposals[0];
  const showProposal = proposal && !modal && !replay && !game.gameOver;

  return (
    <div className="game">
      <div className="topbar">
        <div className="stat">
          <small>{scn.name}</small>
          <b>
            <span className="chip" style={{ background: me.color }} />
            {me.name}
          </b>
        </div>
        <div className="stat">
          <small>턴 {game.turn}</small>
          <b>
            {fmtYear(year)} {SEASONS[seasonOf(game.turn)]} <small className="muted">{((game.turn - 1) % TURNS_PER_SEASON) + 1}/{TURNS_PER_SEASON}</small>
          </b>
        </div>
        <div className="stat">
          <small>국고</small>
          <b>
            💰 {fmtGold(me.gold)} <small className="muted">({inc.net >= 0 ? '+' : ''}{fmtGold(inc.net)}/턴)</small>
          </b>
        </div>
        <div className="stat">
          <small>
            행동력 {me.ap}/{me.maxAp}
          </small>
          <div className="ap-dots">
            {Array.from({ length: me.maxAp }, (_, i) => (
              <i key={i} className={i < me.ap ? 'on' : ''} />
            ))}
          </div>
        </div>
        <div className="stat">
          <small>평판</small>
          <b>{me.reputation}</b>
        </div>
        <div className="spacer" />
        {spect && (
          <div className="spectate">
            <b>👁️ 관전</b>
            <button className={'sm' + (auto ? ' primary' : '')} onClick={() => setAuto(!auto)}>
              {auto ? '⏸ 멈춤' : '▶ 자동 진행'}
            </button>
            <select value={autoSpeed} onChange={(e) => setAutoSpeed(+e.target.value)}>
              <option value={1500}>느리게</option>
              <option value={900}>보통</option>
              <option value={300}>빠르게</option>
            </select>
            <button className="sm" onClick={() => setModal({ type: 'god' })}>🎁 지원</button>
            <button className="sm primary" onClick={() => setModal({ type: 'takeover' })}>
              🎯 난입
            </button>
          </div>
        )}
        <button onClick={() => setModal({ type: 'diplo' })} title="외교">🤝<span className="lbl"> 외교</span></button>
        <button onClick={() => setModal({ type: 'gens' })} title="장수">⭐<span className="lbl"> 장수</span></button>
        <button onClick={() => setShowLog((v) => !v)} title="기록">📜<span className="lbl"> 기록</span></button>
        <button onClick={() => setModal({ type: 'chronicle' })} title="연대기">📽️</button>
        <button onClick={() => setModal({ type: 'help' })}>❓</button>
        <button
          onClick={() => {
            confirmIt('메인 화면으로 나갈까요? (자동 저장됨)', onExit);
          }}
        >
          ☰
        </button>
        <button className="primary" onClick={doEndTurn} disabled={!!game.gameOver || (!me.alive && !spect)}>
          <span className="lbl">턴 종료 </span>⏭
        </button>
      </div>
      <div className="main">
        <div style={{ position: 'relative', minHeight: 0 }}>
          <MapView
            world={world}
            regions={game.regions}
            nations={game.nations}
            selected={selected}
            targets={targets}
            genCount={genCount}
            battles={shownBattles}
            fmt={fmtTroops}
            view={view}
            showTroops={showTroops}
            weather={game.weather}
            cutSet={cutSet}
            focus={replay ? replay.list[replay.i].to : null}
            flash={flashSet}
            moves={game.moves}
            showArmy={game.opts?.showArmy !== false}
            onClick={onRegionClick}
            onContext={onRegionContext}
          />
          {replay && <BattleReplay game={game} battles={replay.list} index={replay.i} onNext={nextReplay} onSkip={finishReplay} delay={replayDelay} onSpeed={toggleReplaySpeed} />}
          {moveMode && <div className="map-hint">이동/공격할 인접 지역을 누르세요<span className="lbl"> (Esc 취소)</span> · 노랑=이동 빨강=공격</div>}
          {showLog && (
            <div className="log">
              {game.log.slice(0, 60).map((l, i) => (
                <div key={i} className={l.nations.includes(game.playerId) ? 'me' : ''}>
                  <span className="t">[{l.turn}]</span>
                  {fixJosa(l.text)}
                </div>
              ))}
            </div>
          )}
          <div className="toasts">
            {toasts.map((t) => (
              <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>
                {t.text}
              </div>
            ))}
          </div>
        </div>
        <SidePanel
          world={world}
          game={game}
          selected={selected}
          vis={vis}
          spectator={spect}
          moveMode={moveMode}
          setMoveMode={setMoveMode}
          act={act}
          openGenerals={() => setModal({ type: 'gens' })}
          openConscript={() => setModal({ type: 'conscript', rid: selected })}
        />
      </div>
      {modal?.type === 'move' && <MoveModal world={world} game={game} from={modal.from} to={modal.to} act={act} onClose={() => setModal(null)} onDone={() => { setModal(null); setMoveMode(false); }} onDuel={startDuel} />}
      {modal?.type === 'duel' && (
        <DuelModal
          game={game}
          attId={modal.attId}
          defId={modal.defId}
          onFinish={(d) => {
            const m = modal;
            act((s) => {
              s.duelMoves = [...(s.duelMoves || []), ...d.rounds.map((r) => r.m1)].slice(-24);
              return doMove(s, world, pid, m.from, m.to, m.count, m.sel, { ...m.opts, duel: d });
            });
            setModal(null);
            setMoveMode(false);
          }}
        />
      )}
      {modal?.type === 'takeover' && <TakeoverModal game={game} onPick={takeOver} onClose={() => setModal(null)} />}
      {modal?.type === 'god' && <GodModal game={game} onGift={gift} onClose={() => setModal(null)} />}
      {modal?.type === 'conscript' && <ConscriptModal world={world} game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'chronicle' && <ChronicleModal world={world} game={game} view={view} onClose={() => setModal(null)} />}
      {modal?.type === 'diplo' && <DiplomacyModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} />}
      {modal?.type === 'gens' && <GeneralsModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} onFocus={(rid) => { setSelected(rid); setModal(null); }} />}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal?.type === 'news' && <NewsModal news={game.turnNews || []} events={myEvents} turn={game.turn} onClose={() => setModal(null)} />}
      {showProposal && <ProposalModal world={world} game={game} act={act} />}
      {ask && (
        <ConfirmModal
          text={ask.text}
          onNo={() => setAsk(null)}
          onYes={() => {
            setAsk(null);
            ask.onYes();
          }}
        />
      )}
      {game.gameOver && modal?.type !== 'chronicle' && (
        <GameOverModal
          result={game.gameOver}
          game={game}
          onNew={() => {
            clearSave();
            onExit();
          }}
          onContinue={() => setGame({ ...game, gameOver: null, sandbox: true })}
          onChronicle={() => setModal({ type: 'chronicle' })}
        />
      )}
    </div>
  );
}
