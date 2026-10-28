import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './MapView.jsx';
import SidePanel from './SidePanel.jsx';
import { MoveModal, DiplomacyModal, GeneralsModal, HelpModal, ProposalModal, NewsModal, GameOverModal, ConfirmModal, DuelModal, BattleReplay, ChronicleModal, TakeoverModal, GodModal, SaveModal, LoyaltyModal, BribeModal, FiefModal, CallModal, DisbandModal, DraftModal, ChoiceModal, LevelChoiceModal, FormArmyModal, PlotModal } from './Modals.jsx';
import { endTurn, endTurnPlan, endTurnFinish, playerStat } from '../game/turn.js';
import Tutorial, { tutorialSeen } from './Tutorial.jsx';
import { edgeBetween, income, gensIn, supplied, nationRegions, moveCheck, getRel, movable, resolveStep, cancelOrder, marchVia, autoMarch, log, armyMarch, setArmyTarget, syncArmies, commandCap, draftCheck } from '../game/engine.js';
import { visibleSet, viewOf, troopsShown, updateExplored } from '../game/fog.js';
import { duelist } from '../game/duel.js';
import FieldBattle from './FieldBattle.jsx';
import { ACHIEVEMENTS } from '../game/achievements.js';
import { SEASONS, seasonOf, yearOf, TURNS_PER_SEASON, fmtYear } from '../game/weather.js';
import { spawnGeneral } from '../game/engine.js';
import { stateRng } from '../game/rng.js';
import { G } from '../game/rules.js';
import { fixJosa } from '../game/josa.js';
import { clearSave } from '../storage.js';
import { fmtTroops, fmtGold } from '../game/format.js';

export default function Game({ world, scn, game, setGame, onExit, onLoad }) {
  const [selected, setSelected] = useState(game.nations[game.playerId].capital);
  const [moveMode, setMoveModeRaw] = useState(false);
  // 모바일: 정보 패널을 바텀시트로 (이동 대상 고를 땐 내려감)
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const setMoveMode = useCallback((v) => {
    setMoveModeRaw(v);
    if (v) setSheet(false);
  }, []);
  const [modal, setModal] = useState(null);
  // 지도에서 고르기: { hint, valid: Set, onPick(rid) }
  const [pick, setPick] = useState(null);
  // 고른 부대: 지도에서 목적지를 누르면 진군
  const [selArmy, setSelArmy] = useState(null);
  // 빠른 진행: 내게 일이 생길 때까지 턴을 넘김 (남은 턴 수)
  const [fast, setFast] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [showLog, setShowLog] = useState(() => window.innerWidth > 860);
  const [ask, setAsk] = useState(null); // { text, onYes }
  const confirmIt = useCallback((text, onYes) => setAsk({ text, onYes }), []);
  const toastId = useRef(0);
  const me = game.nations[game.playerId];
  const pid = game.playerId;
  const [replay, setReplay] = useState(null); // { list, i }
  const [replayDelay, setReplayDelay] = useState(3000);
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

  // 턴 종료: ① 컴퓨터 계획 ② 모든 계획을 하나씩 처리(플레이어 일기토는 창을 띄워 멈춤) ③ 마무리
  const runResolve = (s, before, duel, field) => {
    let first = duel, fieldRes = field;
    for (let k = 0; k < 5000; k++) {
      const r = resolveStep(s, world, first, fieldRes);
      first = undefined;
      fieldRes = undefined;
      if (r.needField) {
        setGame(s);
        setModal({ type: 'field', ...r.needField, pending: s, before });
        return;
      }
      if (r.needDuel) {
        setGame(s);
        setModal({ type: 'duel', ...r.needDuel, pending: s, before });
        return;
      }
      if (r.done) break;
    }
    endTurnFinish(s, world);
    afterTurn(s, before);
  };
  // 큰 지도는 턴 처리에 시간이 걸리므로 '처리 중' 표시를 먼저 그린 뒤 계산
  const [busy, setBusy] = useState(false);
  const [panTo, setPanTo] = useState(null);
  const [tut, setTut] = useState(() => !tutorialSeen());
  const doEndTurn = () => {
    if (busy) return;
    setBusy(true);
    setTimeout(() => {
      try {
        endTurnNow();
      } finally {
        setBusy(false);
      }
    }, 30);
  };
  const endTurnNow = () => {
    setMoveMode(false);
    const s = structuredClone(game);
    const before = visibleSet(game, world, pid);
    if (s.spectator) {
      endTurn(s, world);
      setGame(s);
      return;
    }
    // 부대 진군 → 집결지·전선 자동 행군 (내 땅 안은 행동력 없음)
    for (const line of armyMarch(s, world, pid)) log(s, line, [pid], 'info');
    setSelArmy(null);
    const sent = autoMarch(s, world, pid);
    endTurnPlan(s, world);
    if (sent) log(s, `🚩 후방 병력 ${fmtTroops(sent)}이(가) ${s.nations[pid].rally?.to != null ? `집결지 ${s.regions[s.nations[pid].rally.to].name}` : '전선'}(으)로 행군합니다.`, [pid], 'info');
    runResolve(s, before);
  };
  const afterTurn = (s, before) => {
    setGame(s);
    // 빠른 진행 멈춤: 내 땅이 바뀌었거나, 내가 싸웠거나, 고를 일이 생기면 (계속 가는 중엔 다시보기·소식 창을 띄우지 않음)
    if (fast) {
      const mine = (s.battles || []).some((b) => b.attacker === pid || b.defender === pid);
      const ask = (s.choices || []).length || (s.levelChoices || []).length || (s.turnEvents || []).some((e) => e.nations?.includes(pid) && e.global);
      const changed = s.prevStat && playerStat(s).regions !== s.prevStat.regions;
      const stop = mine || ask || changed || fast <= 1;
      setFast(stop ? 0 : fast - 1);
      if (!stop) return;
    }
    for (const id of s.newAchieve || []) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) toast(`🏅 업적 달성: ${a.icon} ${a.name}`);
    }
    // 다시보기는 내가 싸운 전투만, 소식 창은 내게 큰일(땅을 잃음·나를 겨냥한 사건)이 있을 때만 — 나머지는 📰 알림으로
    const seen = (s.battles || []).filter((b) => b.attacker === pid || b.defender === pid);
    if (s.opts?.showBattles !== false && seen.length && !s.gameOver) setReplay({ list: seen, i: 0 });
    else if (bigNews(s) && !s.gameOver) setModal({ type: 'news' });
    else if (s.turnNews?.length || s.turnEvents?.length) toast(`📰 소식 ${(s.turnNews?.length || 0) + (s.turnEvents?.length || 0)}건 — 왼쪽 위 📰에서 볼 수 있어요`);
    if (!s.nations[s.playerId].alive) setSelected(null);
  };

  // 제안 창: 다 답하면 닫힘
  useEffect(() => {
    if (modal?.type === 'proposal' && !(game.proposals || []).length) setModal(null);
  }, [modal, game.proposals]);
  // 빠른 진행: 창이 없을 때 다음 턴으로
  useEffect(() => {
    if (!fast || spect || modal || replay || busy || game.gameOver || (game.choices || []).length || (game.levelChoices || []).length) return;
    const t = setTimeout(doEndTurn, 250);
    return () => clearTimeout(t);
  });
  // 관전 자동 진행
  useEffect(() => {
    if (!spect || !auto || modal || game.gameOver) return;
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
        setPick(null);
        setSelArmy(null);
      }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'm' && selected !== null && game.regions[selected]?.owner === game.playerId) setMoveMode((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, selected, game]);

  const targets = useMemo(() => {
    if (pick) return new Map([...pick.valid].map((r) => [r, pick.chosen?.has(r) ? 'chosen' : 'move']));
    if (!moveMode || selected === null || game.regions[selected].owner !== game.playerId) return null;
    const m = new Map();
    const fr = game.regions[selected];
    const gens = gensIn(game, selected, pid).filter((g) => !g.army).map((g) => g.id);
    const probe = Math.min(fr.sea ? fr.troops : fr.troops - 1, movable(game, selected));
    for (const nb of world.regions[selected].neighbors) {
      const t = game.regions[nb.id];
      const ally = t.owner !== null && t.owner !== pid && !t.sea && getRel(game, pid, t.owner).type === 'alliance';
      let kind = ally || t.owner === pid || (t.sea && (t.owner === null || t.troops <= 0)) ? 'move' : 'attack';
      const why = moveCheck(game, world, pid, selected, nb.id, Math.max(1, probe), ally ? [] : gens);
      if (why && !why.startsWith('행동력') && !why.startsWith('이동 병력')) kind = 'blocked';
      m.set(nb.id, kind);
    }
    // 내 땅 3칸 행군 목적지 (내선 작전)
    if (!fr.sea) {
      const seen = new Set([selected]);
      let front = [selected];
      for (let d = 0; d < 3; d++) {
        const nxt = [];
        for (const r of front) for (const x of world.regions[r].neighbors) {
          if (seen.has(x.id) || game.regions[x.id].sea || game.regions[x.id].owner !== pid || (x.type !== 'land' && x.type !== 'river')) continue;
          seen.add(x.id);
          nxt.push(x.id);
          if (!m.has(x.id)) {
            const why = moveCheck(game, world, pid, selected, x.id, Math.max(1, probe), gens);
            m.set(x.id, why && !why.startsWith('행동력') && !why.startsWith('이동 병력') ? 'blocked' : 'move');
          }
        }
        front = nxt;
      }
    }
    return m;
  }, [moveMode, selected, game, world, pid, pick]);

  // 지역마다 군단(장수) 수와 대장(통솔 최고)의 첫 글자
  const genCount = useMemo(() => {
    const c = {};
    for (const g of Object.values(game.generals)) {
      if (g.status !== 'active' || g.order) continue;
      const x = (c[g.region] = c[g.region] || { n: 0, lead: -1, ch: '' });
      x.n++;
      if (g.lead > x.lead) { x.lead = g.lead; x.ch = g.name[0]; }
    }
    return c;
  }, [game.generals]);

  const openMove = (from, to) => {
    if (!edgeBetween(world, from, to) && marchVia(world, game, from, to) === null) return;
    setModal({ type: 'move', from, to });
  };

  const onRegionClick = (rid) => {
    if (selArmy) {
      const aid = selArmy;
      setSelArmy(null);
      if (game.regions[rid].sea) return toast('부대는 육지로만 진군합니다.', true);
      act((s) => setArmyTarget(s, world, pid, aid, rid));
      return;
    }
    if (pick) {
      if (!pick.valid.has(rid)) return toast('여기는 고를 수 없습니다. 노랗게 표시된 내 땅(길이 이어진 곳)을 누르세요.', true);
      if (pick.chosen) {
        // 여러 곳 고르기: 누를 때마다 넣었다 뺐다
        const c = new Set(pick.chosen);
        if (c.has(rid)) c.delete(rid);
        else c.add(rid);
        setPick({ ...pick, chosen: c });
        return;
      }
      const f = pick.onPick;
      setPick(null);
      f(rid);
      return;
    }
    if (targets && targets.has(rid)) {
      if (targets.get(rid) === 'blocked') {
        const fr = game.regions[selected];
        toast(moveCheck(game, world, pid, selected, rid, Math.max(1, fr.sea ? fr.troops : fr.troops - 1), gensIn(game, selected, pid).filter((g) => !g.army).map((g) => g.id)) || '이동할 수 없습니다.', true);
        return;
      }
      openMove(selected, rid);
      return;
    }
    setSelected(rid);
    setMoveMode(false);
    setSheet(true);
  };

  const onRegionContext = (rid) => {
    if (selected !== null && game.regions[selected].owner === game.playerId && (edgeBetween(world, selected, rid) || marchVia(world, game, selected, rid) !== null)) openMove(selected, rid);
  };

  // 내게 큰일: 땅을 잃었거나, 나를 겨냥한 사건(변방 침입·해적·반란 등)
  const bigNews = (s) => (s.prevStat && playerStat(s).regions < s.prevStat.regions) || (s.turnEvents || []).some((e) => e.nations?.includes(s.playerId) && e.nations.length <= 3);
  const newsCount = (game.turnNews?.length || 0) + (game.turnEvents?.length || 0);
  const inc = income(game, game.playerId);
  const finishReplay = useCallback(() => {
    setReplay(null);
    if (bigNews(game)) setModal({ type: 'news' });
  }, [game.turnNews, game.turnEvents]);
  const toggleReplaySpeed = () => setReplayDelay((d) => (d < 2000 ? 3000 : 1500));
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
  const myOrders = (game.orders || []).filter((o) => o.n === pid);
  const flashSet = useMemo(() => new Set((game.turnEvents || []).flatMap((e) => e.rids || [])), [game.turnEvents]);
  const myEvents = (game.turnEvents || []).filter((e) => e.global || e.nations.includes(pid) || e.nations.length > 3 || e.nations.some((id) => vis.has(game.nations[id]?.capital)));

  // 적의 의도: 내 땅과 맞닿은, 보이는 적 대군 (내 수비보다 1.2배↑)
  const threats = useMemo(() => {
    if (spect || !me.alive) return [];
    const out = [];
    for (const r of nationRegions(game, pid)) {
      if (game.regions[r].sea) continue;
      for (const x of world.regions[r].neighbors) {
        const t = game.regions[x.id];
        if (t.sea || t.owner === null || t.owner === pid || !vis.has(x.id) || getRel(game, pid, t.owner).type !== 'none') continue;
        if (t.troops >= 3000 && t.troops > game.regions[r].troops * 1.2) out.push({ from: x.id, to: r, k: t.troops / Math.max(1, game.regions[r].troops) });
      }
    }
    return out.sort((a, b) => b.k - a.k).slice(0, 8);
  }, [game, world, pid, vis, spect, me.alive]);
  // 내 부대들 (지도 위 말)
  const myArmies = useMemo(() => {
    const out = Object.values(game.armies || {}).filter((a) => a.n === pid || vis.has(a.rid)).map((a) => ({ ...a, enemy: a.n !== pid, ch: game.generals[a.gids[0]]?.name || '?', color: a.n === pid ? me.color : game.nations[a.n]?.color || '#888', target: a.n === pid ? a.target : null }));
    // 부대에 속하지 않은 적 장수도 이끌 수 있는 만큼을 부대 말로
    const by = {};
    for (const g of Object.values(game.generals)) {
      if (g.status !== 'active' || g.order || g.army || g.nation === pid || !vis.has(g.region)) continue;
      const r = game.regions[g.region];
      if (r.sea || r.owner !== g.nation) continue;
      (by[g.region] = by[g.region] || []).push(g);
    }
    for (const [rid, gs] of Object.entries(by)) {
      const lead = gs.reduce((a, b) => (b.lead > a.lead ? b : a));
      const nat = game.nations[lead.nation];
      out.push({ id: 'v' + rid, rid: +rid, enemy: true, ch: lead.name, troops: Math.min(game.regions[rid].troops, commandCap(game, gs.map((g) => g.id))), color: nat?.color || '#888', target: null });
    }
    return out;
  }, [game.armies, game.generals, game.regions, game.nations, pid, me.color, vis]);
  // 이번 턴 챙길 것
  const riskGens = Object.values(game.generals).filter((g) => g.nation === pid && g.status === 'active' && g.id !== me.ruler && (g.loyalty ?? 60) < 40);
  const idleArmies = Object.values(game.armies || {}).filter((a) => a.n === pid && (a.target === null || a.target === undefined) && !(game.orders || []).some((o) => o.opts?.army === a.id));
  const canDraft = me.alive && !draftCheck(game, pid);
  const landmarks = useMemo(() => new Set(game.landmarks || []), [game.landmarks]);
  const proposal = game.proposals[0];
  const showLevel = (game.levelChoices || []).length > 0 && !modal && !replay && !game.gameOver && !spect;
  const showChoice = !showLevel && (game.choices || []).length > 0 && !modal && !replay && !game.gameOver && !spect;
  // 외교 제안·요청은 저절로 띄우지 않고 알림(📨)으로 — 누르면 엶
  const showProposal = proposal && modal?.type === 'proposal' && !game.gameOver;

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
        <div className="stat opt">
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
        {!spect && me.alive && (
          <button onClick={() => setModal({ type: 'draft' })} title="지도에서 고른 지역마다 슬라이더로 인원을 정해 징병">💂<span className="lbl"> 징병</span></button>
        )}
        <button onClick={() => setModal({ type: 'diplo' })} title="외교">🤝<span className="lbl"> 외교</span></button>
        <button onClick={() => setModal({ type: 'gens' })} title="장수">⭐<span className="lbl"> 장수</span></button>
        <div className="menu-wrap">
          <button
            onClick={(e) => {
              // 상단바가 줄바꿈돼 버튼이 왼쪽에 있어도 메뉴가 화면 안에 열리도록 버튼 위치 기준으로 배치
              const b = e.currentTarget.getBoundingClientRect();
              setMenu((v) => (v ? false : { top: b.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 198, b.right - 190)) }));
            }}
            title="메뉴"
            className={menu ? 'primary' : ''}
          >
            ☰
          </button>
          {menu && (
            <div className="menu" style={{ top: menu.top, left: menu.left }} onClick={() => setMenu(false)}>
              <button onClick={() => setShowLog((v) => !v)}>📜 기록 {showLog ? '숨기기' : '보기'}</button>
              <button onClick={() => setModal({ type: 'save' })}>💾 저장·불러오기</button>
              <button onClick={() => setModal({ type: 'chronicle' })}>📽️ 연대기</button>
              <button onClick={() => setModal({ type: 'help' })}>❓ 게임 방법</button>
              <button onClick={() => setTut(true)}>🧭 처음 안내 다시 보기</button>
              <button onClick={() => confirmIt('메인 화면으로 나갈까요? (자동 저장됨)', onExit)}>🚪 메인 화면으로</button>
            </div>
          )}
        </div>
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
            focus={replay ? replay.list[replay.i].to : panTo}
            flash={flashSet}
            orders={myOrders}
            home={game.nations[pid]?.capital}
            rally={game.nations[pid]?.rally?.to}
            threats={threats}
            armies={myArmies}
            selArmy={selArmy}
            onArmy={(id) => { const A = game.armies?.[id]; if (!A || A.n !== pid) { setSelected(A ? A.rid : +id.slice(1)); setSheet(true); return; } setSelArmy((cur) => (cur === id ? null : id)); setSelected(game.armies[id].rid); setMoveMode(false); }}
            landmarks={landmarks}
            moves={game.moves}
            showArmy={game.opts?.showArmy !== false}
            onClick={onRegionClick}
            onContext={onRegionContext}
            canDrag={(rid) => !spect && !pick && !selArmy && me.alive && game.regions[rid].owner === pid && game.regions[rid].troops > 1}
            onDragMove={(from, to) => {
              setSelected(from);
              if (!edgeBetween(world, from, to) && marchVia(world, game, from, to) === null) return toast('맞닿은 땅(또는 내 땅으로 3칸 안)으로만 보낼 수 있습니다.', true);
              openMove(from, to);
            }}
          />
          {replay && <BattleReplay game={game} battles={replay.list} index={replay.i} onNext={nextReplay} onSkip={finishReplay} delay={replayDelay} onSpeed={toggleReplaySpeed} />}
          {myOrders.length > 0 && (
            <div className="orders-box">
              <b>🧭 이동 계획 {myOrders.length}건</b>
              {myOrders.map((o) => (
                <div key={o.id} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {game.regions[o.from].name || '바다'} → {game.regions[o.to].name || '바다'} {fmtTroops(o.count)}
                    {o.gens.length > 0 && ` ★${o.gens.length}`}
                  </span>
                  <button className="sm ghost" title="계획 취소" onClick={() => act((s) => cancelOrder(s, o.id))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="primary end-turn" onClick={doEndTurn} disabled={!!game.gameOver || (!me.alive && !spect)}>
            턴 종료 ⏭
          </button>
          {!spect && me.alive && (
            <button className={'fast-btn' + (fast ? ' primary' : '')} onClick={() => setFast(fast ? 0 : 15)} title="내게 일(전투·땅 변화·제안·사건)이 생길 때까지 최대 15턴 자동으로 넘김">
              {fast ? `⏸ 멈춤 (${fast})` : '⏩ 빠른 진행'}
            </button>
          )}
          {!spect && me.alive && !pick && !selArmy && (
            <div className="checklist">
              {threats.length > 0 && <button className="sm" onClick={() => { setSelected(threats[0].to); setPanTo(threats[0].to); setTimeout(() => setPanTo(null), 1500); }}>⚠️ 위협받는 땅 {threats.length}</button>}
              {riskGens.length > 0 && <button className="sm" onClick={() => setModal({ type: 'gens' })}>😠 충성 위험 장수 {riskGens.length}</button>}
              {idleArmies.length > 0 && <button className="sm" onClick={() => { setSelArmy(idleArmies[0].id); setSelected(idleArmies[0].rid); }}>⚔️ 쉬는 부대 {idleArmies.length}</button>}
              {(game.proposals || []).length > 0 && <button className="sm primary" onClick={() => setModal({ type: 'proposal' })}>📨 제안 {game.proposals.length}</button>}
              {newsCount > 0 && <button className="sm" onClick={() => setModal({ type: 'news' })}>📰 소식 {newsCount}</button>}
              {canDraft && <button className="sm" onClick={() => setModal({ type: 'draft' })}>💂 징병 가능</button>}
              {me.ap > 0 && <span className="muted">행동력 {me.ap} 남음</span>}
            </div>
          )}
          {selArmy && game.armies?.[selArmy] && (
            <div className="map-hint">
              ⚔️ {game.generals[game.armies[selArmy].gids[0]]?.name} 부대 {fmtTroops(game.armies[selArmy].troops)} — 목적지를 누르세요 (매 턴 내 땅으로 3칸씩, 닿으면 공격) <button className="sm" onClick={() => setSelArmy(null)}>취소</button>
            </div>
          )}
          {pick && (
            <div className="map-hint">
              {pick.hint}
              {pick.chosen && <> · <b>{pick.chosen.size}곳</b> <button className="sm primary" onClick={() => { const f = pick.onPick; setPick(null); f(pick.chosen); }}>완료</button></>}{' '}
              <button className="sm" onClick={() => { const f = pick.onCancel; setPick(null); f?.(); }}>취소</button>
            </div>
          )}
          {moveMode && !pick && <div className="map-hint">이동/공격할 인접 지역을 누르세요<span className="lbl"> (Esc 취소)</span> · 노랑=이동 빨강=공격</div>}
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
        <button className="sheet-fab" onClick={() => setSheet((v) => !v)} title="정보 패널">
          {sheet ? '▾' : '📋'}
        </button>
        <SidePanel
          sheetOpen={sheet}
          onCloseSheet={() => setSheet(false)}
          world={world}
          game={game}
          selected={selected}
          vis={vis}
          spectator={spect}
          moveMode={moveMode}
          setMoveMode={setMoveMode}
          act={act}
          openGenerals={() => setModal({ type: 'gens' })}
          openConscript={() => setModal({ type: 'draft', init: { rid: selected } })}
          openLoyalty={() => setModal({ type: 'loyalty' })}
          openBribe={() => setModal({ type: 'bribe', rid: selected })}
          openFief={() => setModal({ type: 'fief', rid: selected })}
          openCall={() => setModal({ type: 'call', rid: selected })}
          openDisband={() => setModal({ type: 'disband', rid: selected })}
          openFormArmy={() => setModal({ type: 'form', rid: selected })}
          openPlot={() => setModal({ type: 'plot', rid: selected })}
          selectArmy={(id) => { setSelArmy(id); setSheet(false); }}
        />
      </div>
      {modal?.type === 'move' && <MoveModal world={world} game={game} from={modal.from} to={modal.to} act={act} onClose={() => setModal(null)} onDone={() => { setModal(null); setMoveMode(false); }} />}
      {modal?.type === 'duel' && (
        <DuelModal
          game={modal.pending}
          attId={modal.attId}
          defId={modal.defId}
          onFinish={(d) => {
            const m = modal;
            const s = structuredClone(m.pending);
            s.duelMoves = [...(s.duelMoves || []), ...d.rounds.map((r) => r.m1)].slice(-24);
            setModal(null);
            runResolve(s, m.before, d);
          }}
        />
      )}
      {modal?.type === 'field' && (() => {
        const s0 = modal.pending;
        const tr = s0.regions[modal.to];
        const owner = tr.owner === null ? null : s0.nations[tr.owner];
        return (
          <FieldBattle
            att={{ name: s0.nations[pid].name, color: s0.nations[pid].color, troops: modal.count, hero: s0.generals[modal.heroId], mult: modal.attMult }}
            def={{ name: owner ? owner.name : tr.bandit || '토착 세력', color: owner ? owner.color : '#8a7a66', troops: Math.max(500, modal.defTroops), hero: modal.enemyHeroId !== null ? s0.generals[modal.enemyHeroId] : null, mult: modal.defMult }}
            terrain={modal.terrain}
            walls={modal.walls}
            onFinish={(res) => {
              const m = modal;
              const s = structuredClone(m.pending);
              setModal(null);
              runResolve(s, m.before, undefined, res);
            }}
          />
        );
      })()}
      {modal?.type === 'takeover' && <TakeoverModal game={game} onPick={takeOver} onClose={() => setModal(null)} />}
      {modal?.type === 'god' && <GodModal game={game} onGift={gift} onClose={() => setModal(null)} />}
      {modal?.type === 'plot' && <PlotModal world={world} game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'form' && <FormArmyModal game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} onDone={(id) => { setModal(null); setSelArmy(id); setSheet(false); }} />}
      {modal?.type === 'draft' && (
        <DraftModal
          world={world}
          game={game}
          init={modal.init}
          act={act}
          onClose={() => setModal(null)}
          onPickRegions={(st) => {
            setModal(null);
            setSheet(false);
            const valid = new Set(nationRegions(game, pid).filter((r) => !game.regions[r].sea));
            setPick({
              hint: '징병할 내 땅을 누르세요 (처음 누른 곳으로 모임, 다시 누르면 빠짐)',
              valid,
              chosen: new Set(st.order.filter((r) => valid.has(r))),
              onCancel: () => setModal({ type: 'draft', init: st }),
              onPick: (set) => setModal({ type: 'draft', init: { ...st, order: [...set] } }),
            });
          }}
          onPickDest={(st) => {
            setModal(null);
            setSheet(false);
            setPick({ hint: '징병한 병사들을 모을 내 땅을 누르세요', valid: new Set(nationRegions(game, pid).filter((r) => !game.regions[r].sea)), onCancel: () => setModal({ type: 'draft', init: st }), onPick: (d) => setModal({ type: 'draft', init: { ...st, stay: false, dest: d } }) });
          }}
        />
      )}
      {modal?.type === 'chronicle' && <ChronicleModal world={world} game={game} view={view} onClose={() => setModal(null)} />}
      {modal?.type === 'diplo' && <DiplomacyModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} />}
      {modal?.type === 'gens' && <GeneralsModal world={world} game={game} act={act} confirmIt={confirmIt} onClose={() => setModal(null)} onFocus={(rid) => { setSelected(rid); setModal(null); }} />}
      {tut && !spect && !modal && <Tutorial onClose={() => setTut(false)} />}
      {busy && !spect && (
        <div className="loading" style={{ position: 'fixed' }}>
          <div className="spinner" />
          각 나라가 움직이는 중…
        </div>
      )}
      {modal?.type === 'loyalty' && <LoyaltyModal world={world} game={game} onFocus={(rid) => { setSelected(rid); setPanTo(rid); setTimeout(() => setPanTo(null), 1500); setModal(null); setSheet(true); }} onClose={() => setModal(null)} />}
      {modal?.type === 'bribe' && <BribeModal world={world} game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'call' && <CallModal world={world} game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'disband' && <DisbandModal game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'fief' && <FiefModal world={world} game={game} rid={modal.rid} act={act} onClose={() => setModal(null)} />}
      {modal?.type === 'save' && (
        <SaveModal
          game={game}
          toast={toast}
          onClose={() => setModal(null)}
          onLoad={(d) => {
            if (!onLoad(d)) toast('이 저장은 불러올 수 없습니다(이전 버전).', true);
          }}
        />
      )}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal?.type === 'news' && <NewsModal game={game} news={game.turnNews || []} events={myEvents} turn={game.turn} onClose={() => setModal(null)} />}
      {showLevel && <LevelChoiceModal game={game} act={act} />}
      {showChoice && <ChoiceModal world={world} game={game} act={act} />}
      {showProposal && <ProposalModal world={world} game={game} act={act} onClose={() => setModal(null)} />}
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
          onContinue={() => setGame({ ...game, gameOver: null, ...(game.gameOver.partial ? { asked80: true } : { sandbox: true }) })}
          onChronicle={() => setModal({ type: 'chronicle' })}
        />
      )}
    </div>
  );
}
