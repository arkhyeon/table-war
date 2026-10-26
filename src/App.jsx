import { useEffect, useState } from 'react';
import Setup from './components/Setup.jsx';
import Game from './components/Game.jsx';
import { generateWorld } from './game/mapgen.js';
import { getScenario } from './game/scenarios.js';
import { loadSave, writeSave, writeHistory } from './storage.js';

export default function App() {
  const [session, setSession] = useState(null); // { world, scn }
  const [game, setGame] = useState(null);

  useEffect(() => {
    if (!game || !session) return;
    writeSave({ scenarioId: game.scenarioId, seed: game.seed, state: game });
    writeHistory(game.appearHistory);
  }, [game, session]);

  const start = (world, scn, state) => {
    setSession({ world, scn });
    setGame(state);
  };

  const resume = () => {
    const save = loadSave();
    if (!save) return false;
    const scn = getScenario(save.scenarioId);
    if (!scn || save.state?.version !== 3) return false;
    const world = generateWorld(scn, save.seed);
    if (world.regions.length !== save.state.regions.length) return false;
    start(world, scn, save.state);
    return true;
  };

  if (!session || !game) return <Setup onStart={start} onResume={resume} hasSave={!!loadSave()} />;
  return (
    <Game
      world={session.world}
      scn={session.scn}
      game={game}
      setGame={setGame}
      onExit={() => {
        setSession(null);
        setGame(null);
      }}
    />
  );
}
