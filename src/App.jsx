import { useEffect, useRef, useState } from 'react';
import Setup from './components/Setup.jsx';
import Game from './components/Game.jsx';
import Hex14 from './components/Hex14.jsx';
import { generateWorld } from './game/mapgen.js';
import { getScenario } from './game/scenarios.js';
import { loadSave, writeSave, writeHistory, loadSlot, SLOT_COUNT } from './storage.js';
import { cloudSave } from './cloud.js';
import { describe } from './components/SaveSlots.jsx';

const hasSlots = () => Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i + 1)).some(Boolean);

export default function App() {
  const [session, setSession] = useState(null); // { world, scn }
  const [game, setGame] = useState(null);
  const [gen, setGen] = useState(0); // 불러올 때마다 게임 화면을 새로 그림
  const cloudKey = useRef(null);

  useEffect(() => {
    if (!game || !session) return;
    const data = { scenarioId: game.scenarioId, seed: game.seed, state: game };
    writeSave(data);
    writeHistory(game.appearHistory);
    // 클라우드 자동 저장은 턴이 바뀔 때만 (하루마다 쓰면 너무 잦음)
    const key = `${game.turn}:${game.over ? 1 : 0}`;
    if (cloudKey.current !== key) {
      cloudKey.current = key;
      cloudSave(0, data, describe({ ...data, savedAt: Date.now() }));
    }
  }, [game, session]);

  const start = (world, scn, state) => {
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
    if (save.state.version === 5 && world.regions.length !== save.state.regions.length) return false;
    start(world, scn, save.state);
    return true;
  };

  if (!session || !game) return <Setup onStart={start} onResume={resume} hasSave={!!loadSave() || hasSlots()} />;
  if (game.mode === 'hex14')
    return <Hex14 key={gen} world={session.world} game={game} setGame={setGame} onExit={() => { setSession(null); setGame(null); }} />;
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
