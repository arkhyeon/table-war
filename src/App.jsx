import { useEffect, useRef, useState } from 'react';
import Setup from './components/Setup.jsx';
import Game from './components/Game.jsx';
import Hex14 from './components/Hex14.jsx';
import { generateWorld } from './game/mapgen.js';
import { normalizeHex14 } from './game/hex14.js';
import { getScenario } from './game/scenarios.js';
import { buildGrid } from './game/hex14.js';
import { loadSave, writeSave, writeHistory, loadSlot, SLOT_COUNT } from './storage.js';
import { cloudSave } from './cloud.js';
import { describe } from './components/SaveSlots.jsx';

// 게임 중이라는 표시 (이 탭에서만 유지). 폰 브라우저가 메모리 때문에 페이지를 다시 열면 처음 화면 대신 이어서 들어감
const PLAYING = 'tw-playing';
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch { /* 무시 */ } } };
// 1분 안에 세 번째로 다시 열리면 이어 들어가지 않음 (들어가자마자 또 꺼지는 경우 처음 화면에서 멈추게)
const shouldAutoResume = () => {
  if (ss.get(PLAYING) !== '1' || !loadSave()) return false;
  const recent = Date.now() - +(ss.get('tw-autores-t') || 0) < 60000, n = recent ? +(ss.get('tw-autores') || 0) + 1 : 1;
  ss.set('tw-autores', String(n)); ss.set('tw-autores-t', String(Date.now()));
  return n <= 2;
};

const hasSlots = () => Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i + 1)).some(Boolean);

export default function App() {
  const [session, setSession] = useState(null); // { world, scn }
  const [game, setGame] = useState(null);
  const [gen, setGen] = useState(0); // 불러올 때마다 게임 화면을 새로 그림
  const cloudKey = useRef(null);

  // 자동 저장: 순이 바뀌면 바로, 순 중간(하루 진행·명령)에는 손이 멈추고 1.5초 뒤에 한 번만 (순을 재생하는 동안 날마다 큰 상태를 저장하느라 끊기지 않게). 창을 닫을 때도 저장
  const saveT = useRef(null), latest = useRef(null);
  useEffect(() => {
    const flush = () => { if (latest.current) { writeSave(latest.current); latest.current = null; } };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); };
  }, []);
  useEffect(() => {
    if (!game || !session || game.tutGame) return; // 튜토리얼 판은 자동 저장하지 않음 (진짜 저장을 덮지 않게)
    const data = { scenarioId: game.scenarioId, seed: game.seed, state: game };
    latest.current = data;
    clearTimeout(saveT.current);
    const now = () => { if (latest.current === data) { writeSave(data); latest.current = null; } };
    if (game.day === 0 || game.over) now(); else saveT.current = setTimeout(now, 1500);
    writeHistory(game.appearHistory);
    // 클라우드 자동 저장은 턴이 바뀔 때만 (하루마다 쓰면 너무 잦음)
    const key = `${game.turn}:${game.over ? 1 : 0}`;
    if (cloudKey.current !== key) {
      cloudKey.current = key;
      cloudSave(0, data, describe({ ...data, savedAt: Date.now() }));
    }
  }, [game, session]);

  const start = (world, scn, state) => {
    if (state?.tutGame || state?.spectator) ss.del(PLAYING); else ss.set(PLAYING, '1');
    setSession({ world, scn });
    setGame(state);
    setGen((v) => v + 1);
  };

  const resume = (data) => {
    const save = data || loadSave();
    if (!save) return false;
    const scn = getScenario(save.scenarioId);
    if (!scn || (save.state?.version !== 5 && save.state?.version !== 14)) return false;
    const world = generateWorld(scn, save.seed, save.state.opts?.detail || 'normal');
    // 지도 크기가 바뀐(업데이트 전) 삼국지14식 저장은 칸 수가 달라 불러올 수 없음
    if (save.state.mode === 'hex14' && save.state.owner?.length !== buildGrid(world).N) return false;
    if (save.state.version === 5 && world.regions.length !== save.state.regions.length) return false;
    start(world, scn, normalizeHex14(save.state));
    return true;
  };

  // 갑자기 다시 열렸으면(폰에서 메모리 부족 등) 마지막 자동 저장으로 바로 이어 들어감
  const [resuming, setResuming] = useState(shouldAutoResume);
  useEffect(() => {
    if (!resuming) return;
    const t = setTimeout(() => { try { if (!resume()) ss.del(PLAYING); } catch (e) { console.error(e); ss.del(PLAYING); } setResuming(false); }, 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (resuming) return <div className="boot-loading"><div className="spinner" /><b>하던 게임으로 돌아가는 중…</b><small className="muted">화면이 다시 열려서 마지막 자동 저장을 불러오고 있어요</small></div>;
  if (!session || !game) return <Setup onStart={start} onResume={resume} hasSave={!!loadSave() || hasSlots()} />;
  if (game.mode === 'hex14')
    return <Hex14 key={gen} world={session.world} game={game} setGame={setGame} onExit={() => { ss.del(PLAYING); setSession(null); setGame(null); }} />;
  return (
    <Game
      key={gen}
      world={session.world}
      scn={session.scn}
      game={game}
      setGame={setGame}
      onLoad={resume}
      onExit={() => {
        setSession(null);
        setGame(null);
      }}
    />
  );
}
