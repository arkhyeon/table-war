import { useEffect, useMemo, useState } from 'react';
import MapView from './MapView.jsx';
import EditableName from './EditableName.jsx';
import SaveSlots from './SaveSlots.jsx';
import { SCENARIOS, canWorld, worldVariant } from '../game/scenarios.js';
import { generateWorld, MAP_DETAIL } from '../game/mapgen.js';
import { fmtYear } from '../game/weather.js';
import { createGame } from '../game/setup.js';
import { CIVS } from '../game/civs.js';
import { nationRegions } from '../game/engine.js';
import { loadHistory } from '../storage.js';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements.js';

const randomSeed = () => Math.random().toString(36).slice(2, 8);

export default function Setup({ onStart, onResume, hasSave }) {
  const [scnId, setScnId] = useState('threekingdoms200');
  const [seed, setSeed] = useState(randomSeed);
  const [nationCount, setNationCount] = useState(8);
  const [detail, setDetail] = useState('normal');
  const [scope, setScope] = useState('region');
  const [player, setPlayer] = useState(0);
  const [error, setError] = useState('');
  const [showSaves, setShowSaves] = useState(false);
  const [rules, setRules] = useState({ revealMap: true, revealTroops: false, rememberExplored: true, showBattles: true, showArmy: true, histStats: false, difficulty: 'normal' });
  const [names, setNames] = useState({});
  const achieved = useMemo(loadAchievements, []);
  const baseScn = SCENARIOS.find((s) => s.id === scnId);
  const scn = scope === 'world' && canWorld(baseScn) ? worldVariant(baseScn) : baseScn;
  const opts = useMemo(() => ({ ...(scn.procedural ? { nationCount } : {}), histStats: rules.histStats, difficulty: rules.difficulty }), [scn, nationCount, rules.histStats, rules.difficulty]);

  // 지도 생성은 큰 지도에서 몇 초 걸리므로 로딩 표시를 먼저 그린 뒤 만듦
  const [world, setWorld] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      try {
        setWorld(generateWorld(scn, seed, detail));
      } catch (e) {
        console.error(e);
        setWorld(null);
      }
      setLoading(false);
    }, 30);
    return () => clearTimeout(t);
  }, [scn, seed, detail]);

  const ready = world && !loading && world.scenarioId === scn.id && world.seed === seed && world.detail === detail;
  const preview = useMemo(() => (ready ? createGame(world, scn, seed, 0, opts) : null), [ready, world, scn, seed, opts]); // eslint-disable-line react-hooks/exhaustive-deps
  const pid = preview && player < preview.nations.length ? player : 0;

  const start = (spectator = false) => {
    const state = createGame(world, scn, seed, pid, { ...opts, ...rules, names, spectator, detail }, loadHistory());
    onStart(world, scn, state);
  };
  const nameOf = (n) => names[n.id] || n.name;
  const pick = (id) => {
    setScnId(id);
    setPlayer(0);
    setNames({});
  };

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="title">⚔️ TABLE WAR</div>
            <div className="muted">역사 속 문명과 장수로 펼치는 턴제 땅따먹기 전략 게임</div>
          </div>
          {hasSave && (
            <button className="primary" onClick={() => setShowSaves((v) => !v)}>
              📂 이어하기·불러오기
            </button>
          )}
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {showSaves && (
          <div style={{ marginTop: 12 }}>
            <SaveSlots onLoad={(d) => { if (!onResume(d)) setError('이 저장은 불러올 수 없습니다(이전 버전).'); }} />
          </div>
        )}
        <h3 style={{ marginTop: 18 }}>1. 시나리오</h3>
        <h4 className="scn-head">🌍 연도별 세계사</h4>
        <div className="timeline">
          {SCENARIOS.filter((s) => s.group === 'world')
            .sort((a, b) => a.startYear - b.startYear)
            .map((s) => (
              <button key={s.id} className={'tl-item' + (s.id === scnId ? ' sel' : '')} onClick={() => pick(s.id)} title={s.desc}>
                <span className="tl-dot" />
                <b>{fmtYear(s.startYear)}</b>
                <small>{s.era}</small>
              </button>
            ))}
        </div>
        {scn.group === 'world' && <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{scn.desc}</p>}
        <h4 className="scn-head">🗺️ 지역사</h4>
        <div className="scn-grid">
          {SCENARIOS.filter((s) => s.group !== 'world')
            .sort((a, b) => (a.group === 'random' ? -1 : b.group === 'random' ? 1 : a.startYear - b.startYear))
            .map((s) => (
              <button key={s.id} className={'scn' + (s.id === scnId ? ' sel' : '')} onClick={() => pick(s.id)}>
                <b>{s.name}</b>
                <small>
                  {s.group === 'random' ? '' : `${fmtYear(s.startYear)} · `}
                  {s.era}
                </small>
                <div style={{ fontSize: 12, marginTop: 6 }} className="muted">
                  {s.desc}
                </div>
              </button>
            ))}
        </div>
        {baseScn.group === 'region' && (
          <div className="row" style={{ marginBottom: 8 }}>
            <span>무대</span>
            <button className={scope !== 'world' || !canWorld(baseScn) ? 'primary' : ''} onClick={() => setScope('region')}>🗺️ 이 지역만</button>
            <button className={scope === 'world' && canWorld(baseScn) ? 'primary' : ''} disabled={!canWorld(baseScn)} onClick={() => { setScope('world'); setPlayer(0); }}>🌍 전 세계</button>
            <span className="muted" style={{ fontSize: 12 }}>
              전 세계: 무대는 잘게 나뉘고, 바깥은 같은 시대의 다른 나라들로 채워집니다(뒤가 비지 않음).
            </span>
          </div>
        )}
        <div className="row" style={{ marginBottom: 12 }}>
          {scn.procedural && (
            <>
          <span>시드</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value || '0')} style={{ width: 120 }} />
          <button onClick={() => setSeed(randomSeed())}>🎲 랜덤</button>
            </>
          )}
          <span style={{ marginLeft: 12 }} title="지역을 얼마나 잘게 나눌지. 잘게 할수록 지역·나라 영토가 많아지고 한 판이 길어집니다.">🧩 지역 크기</span>
          <select value={detail} onChange={(e) => setDetail(e.target.value)}>
            {Object.entries(MAP_DETAIL).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
          {scn.procedural && (
            <>
              <span style={{ marginLeft: 12 }}>국가 수 {nationCount}</span>
              <input type="range" min={4} max={14} value={nationCount} onChange={(e) => setNationCount(+e.target.value)} />
              <button className="sm" title="국가 수를 4~14 중 무작위로" onClick={() => setNationCount(4 + Math.floor(Math.random() * 11))}>🎲</button>
            </>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            {scn.procedural ? '같은 시드는 같은 지도를 만듭니다.' : '역사 시나리오는 그 시대의 정해진 지도·국가 배치로 시작합니다.'}
          </span>
        </div>
        <h3>2. 게임 옵션</h3>
        <div className="setup-opts">
          {[
            ['revealMap', '🗺️ 지도 전체 공개', '끄면 정찰하지 않은 땅은 안개로 가려짐'],
            ['revealTroops', '👁️ 병력 전체 공개', '끄면 시야 밖 지역의 병력은 ?로 표시'],
            ['rememberExplored', '🧭 탐색 지역 기억', '한 번 본 땅은 계속 지도에 표시 (지도 전체 공개를 껐을 때)'],
            ['showBattles', '⚔️ 턴마다 전투 다시보기', '시야 안에서 벌어진 전투만, 건너뛰기 가능'],
            ['showArmy', '🪖 병력 그림·애니메이션', '병력 규모에 따라 병사 그림(1~4명, 대군은 군기)을 보여주고 이동을 애니메이션으로 표시'],
            ['histStats', '📜 역사 능력치 사용', '끄면(기본) 장수 능력치·특성은 무작위, 나라마다 총합만 공평하게'],
          ].map(([k, label, tip]) => (
            <label key={k} title={tip}>
              <input type="checkbox" checked={rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} /> {label}
            </label>
          ))}
          <label title="컴퓨터 세수·초기 병력 보정">
            🎚️ 난이도{' '}
            <select value={rules.difficulty} onChange={(e) => setRules({ ...rules, difficulty: e.target.value })}>
              <option value="easy">쉬움</option>
              <option value="normal">보통</option>
              <option value="hard">어려움</option>
            </select>
          </label>
        </div>
        <h3>3. 국가 선택</h3>
        <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>나라 이름은 ✏️로 바꿀 수 있습니다. 장수 이름은 게임 중 장수 목록에서 바꿉니다.</p>
        <div className="setup-body">
          <div className="preview" style={{ position: 'relative' }}>
            {!ready && (
              <div className="loading">
                <div className="spinner" />
                지도를 만드는 중… {scn.scope === 'world' ? '(세계판은 몇 초 걸립니다)' : ''}
              </div>
            )}
            {ready && preview ? (
              <MapView
                world={world}
                regions={preview.regions}
                nations={preview.nations.map((n) => ({ ...n, name: nameOf(n) }))}
                selected={preview.nations[pid]?.capital}
                compact
                onClick={(rid) => {
                  const o = preview.regions[rid].owner;
                  if (o !== null) setPlayer(o);
                }}
              />
            ) : (
              <p style={{ padding: 20 }}>지도를 생성하지 못했습니다.</p>
            )}
          </div>
          <div className="nation-list">
            {preview?.nations.map((n) => {
              const ruler = preview.generals[n.ruler];
              return (
                <div key={n.id} role="button" tabIndex={0} className={'nation-item btnlike' + (n.id === pid ? ' sel' : '')} onClick={() => setPlayer(n.id)}>
                  <span>
                    <span className="chip" style={{ background: n.color }} />
                    <EditableName value={nameOf(n)} onSave={(t) => setNames({ ...names, [n.id]: t })} />
                    <small className="muted"> · {ruler?.name}</small>
                  </span>
                  <small className="muted">
                    {CIVS[n.civ]?.name} · {nationRegions(preview, n.id).length}지역
                  </small>
                </div>
              );
            })}
          </div>
        </div>
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <span className="muted">
            {world ? `육지 ${world.landCount}곳 · 바다 ${world.regions.length - world.landCount}구역` : ''} · 선택: <b style={{ color: 'var(--text)' }}>{preview && nameOf(preview.nations[pid])}</b>
          </span>
          <button disabled={!ready} onClick={() => start(true)} title="모든 나라를 컴퓨터가 진행하고, 원할 때 아무 나라로 난입">
            👁️ 관전으로 시작
          </button>
          <button className="primary" disabled={!ready} onClick={() => start(false)}>
            게임 시작 ▶
          </button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>
            🏅 업적 {Object.keys(achieved).length}/{ACHIEVEMENTS.length}
          </summary>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {ACHIEVEMENTS.map((a) => (
              <span key={a.id} className={'tag' + (achieved[a.id] ? ' ally' : '')} title={a.desc + (achieved[a.id] ? ` — ${achieved[a.id].nation}, ${achieved[a.id].turn}턴` : '')} style={{ opacity: achieved[a.id] ? 1 : 0.5 }}>
                {a.icon} {a.name} <small>{a.desc}</small>
              </span>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
