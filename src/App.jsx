import { useEffect, useState } from 'react';
import Setup from './components/Setup.jsx';
import Game from './components/Game.jsx';
import { generateWorld } from './game/mapgen.js';
import { getScenario } from './game/scenarios.js';
import { loadSave, writeSave, writeHistory, loadSlot, SLOT_COUNT } from './storage.js';

const hasSlots = () => Array.from({ length: SLOT_COUNT }, (_, i) => loadSlot(i + 1)).some(Boolean);

export default function App() {
  const [session, setSession] = useState(null); // { world, scn }
  const [game, setGame] = useState(null);
  const [gen, setGen] = useState(0); // 불러올 때마다 게임 화면을 새로 그림

  useEffect(() => {
    if (!game || !session) return;
    writeSave({ scenarioId: game.scenarioId, seed: game.seed, state: game });
    writeHistory(game.appearHistory);
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
    if (!scn || save.state?.version !== 5) return false;
    const world = generateWorld(scn, save.seed, save.state.opts?.detail || 'normal');
    if (world.regions.length !== save.state.regions.length) return false;
    start(world, scn, save.state);
    return true;
  };

  if (!session || !game) return <Setup onStart={start} onResume={resume} hasSave={!!loadSave() || hasSlots()} />;
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
