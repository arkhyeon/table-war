import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView.jsx';
import SidePanel from './SidePanel.jsx';
import { MoveModal, DiplomacyModal, GeneralsModal, HelpModal, ProposalModal, NewsModal, GameOverModal, ConfirmModal } from './Modals.jsx';
import { endTurn } from '../game/turn.js';
import { edgeBetween, getRel, canSail, income } from '../game/engine.js';
import { fixJosa } from '../game/josa.js';
import { clearSave } from '../storage.js';
import { fmtTroops } from '../game/format.js';

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

  const toast = useCallback((text, bad = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text: fixJosa(text), bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const act = useCallback(
    (fn) => {
      const s = structuredClone(game);
      const res = fn(s);
      if (res && res.ok === false) {
        toast(res.msg, true);
        return res;
      }
      setGame(s);
      if (res?.msg) toast(res.msg, res.accepted === false);
      return res;
    },
    [game, setGame, toast],
  );

  const doEndTurn = () => {
    setMoveMode(false);
    const s = structuredClone(game);
    endTurn(s, world);
    setGame(s);
    if (s.turnNews?.length && !s.gameOver) setModal({ type: 'news' });
    if (!s.nations[s.playerId].alive) setSelected(null);
  };

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
    for (const nb of world.regions[selected].neighbors) {
      const t = game.regions[nb.id];
      let kind = t.owner === game.playerId ? 'move' : 'attack';
      if (t.owner !== null && t.owner !== game.playerId && getRel(game, game.playerId, t.owner).type === 'alliance') kind = 'blocked';
      if (nb.type === 'sea' && !canSail(game, game.playerId, selected, Object.values(game.generals).filter((g) => g.status === 'active' && g.region === selected && g.nation === game.playerId).map((g) => g.id))) kind = 'blocked';
      m.set(nb.id, kind);
    }
    return m;
  }, [moveMode, selected, game, world]);

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
        toast(getRel(game, game.playerId, game.regions[rid].owner ?? -1).type === 'alliance' ? '동맹국은 공격할 수 없습니다.' : '항구 또는 수군 장수가 있어야 항해할 수 있습니다.', true);
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
  const proposal = game.proposals[0];
  const showProposal = proposal && !modal && !game.gameOver;

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
          <small>턴</small>
          <b>{game.turn}</b>
        </div>
        <div className="stat">
          <small>국고</small>
          <b>
            💰 {Math.floor(me.gold)} <small className="muted">({inc.net >= 0 ? '+' : ''}{inc.net}/턴)</small>
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
        <button onClick={() => setModal({ type: 'diplo' })}>🤝 외교</button>
        <button onClick={() => setModal({ type: 'gens' })}>⭐ 장수</button>
        <button onClick={() => setShowLog((v) => !v)}>📜 기록</button>
        <button onClick={() => setModal({ type: 'help' })}>❓</button>
        <button
          onClick={() => {
            confirmIt('메인 화면으로 나갈까요? (자동 저장됨)', onExit);
          }}
        >
          ☰
        </button>
        <button className="primary" onClick={doEndTurn} disabled={!!game.gameOver || !me.alive}>
          턴 종료 ⏭
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
            battles={game.battles}
            fmt={fmtTroops}
            onClick={onRegionClick}
            onContext={onRegionContext}
          />
          {moveMode && <div className="map-hint">이동/공격할 인접 지역을 클릭하세요 (Esc 취소) · 노랑=이동 빨강=공격</div>}
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
          moveMode={moveMode}
          setMoveMode={setMoveMode}
          act={act}
          openGenerals={() => setModal({ type: 'gens' })}
        />
      </div>
      {modal?.type === 'move' && <MoveModal world={world} game={game} from={modal.from} to={modal.to} act={act} onClose={() => setModal(null)} onDone={() => { setModal(null); setMoveMode(false); }} />}
      {modal?.type === 'diplo' && <DiplomacyModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} />}
      {modal?.type === 'gens' && <GeneralsModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} onFocus={(rid) => { setSelected(rid); setModal(null); }} />}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal?.type === 'news' && <NewsModal news={game.turnNews || []} turn={game.turn} onClose={() => setModal(null)} />}
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
      {game.gameOver && (
        <GameOverModal
          result={game.gameOver}
          game={game}
          onNew={() => {
            clearSave();
            onExit();
          }}
          onContinue={() => setGame({ ...game, gameOver: null, sandbox: true })}
        />
      )}
    </div>
  );
}
