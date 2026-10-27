import { useState } from 'react';
import { SLOT_COUNT, loadSlot, writeSlot, deleteSlot } from '../storage.js';
import { getScenario } from '../game/scenarios.js';
import { fmtYear, yearOf } from '../game/weather.js';

// 저장 목록: 0번은 자동 저장, 1~3번은 수동 슬롯
function describe(d) {
  if (!d?.state) return null;
  const st = d.state;
  const me = st.nations?.[st.playerId];
  const land = st.regions.filter((r) => !r.sea).length;
  const mine = st.regions.filter((r) => !r.sea && r.owner === st.playerId).length;
  const when = d.savedAt ? new Date(d.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return {
    title: `${me?.name || '?'} · ${getScenario(d.scenarioId)?.name || d.scenarioId}`,
    sub: `${st.turn}턴 (${fmtYear(yearOf(st.turn, getScenario(d.scenarioId)?.startYear ?? 1))}) · 영토 ${mine}/${land}곳${st.gameOver ? ' · 종료됨' : ''}${when ? ` · ${when}` : ''}`,
  };
}

export default function SaveSlots({ current, onLoad, onSaved }) {
  const [, bump] = useState(0);
  const ids = [0, ...Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)];
  return (
    <div className="slots">
      {ids.map((k) => {
        const d = loadSlot(k);
        const info = describe(d);
        return (
          <div key={k} className="slot">
            <div className="info">
              <b>{k === 0 ? '⏱️ 자동 저장' : `💾 슬롯 ${k}`}</b>
              <small>{info ? `${info.title} — ${info.sub}` : '비어 있음'}</small>
            </div>
            {current && k > 0 && (
              <button
                className="sm"
                onClick={() => {
                  if (d && !window.confirm(`슬롯 ${k}에 덮어쓸까요?`)) return;
                  const ok = writeSlot(k, current);
                  bump((v) => v + 1);
                  onSaved?.(ok ? `슬롯 ${k}에 저장했습니다.` : '저장 공간이 부족합니다. 다른 슬롯을 지워 주세요.', !ok);
                }}
              >
                저장
              </button>
            )}
            {d && (
              <button className="sm primary" onClick={() => onLoad(d)}>
                불러오기
              </button>
            )}
            {d && k > 0 && (
              <button
                className="sm"
                title="슬롯 비우기"
                onClick={() => {
                  if (!window.confirm(`슬롯 ${k}를 지울까요?`)) return;
                  deleteSlot(k);
                  bump((v) => v + 1);
                }}
              >
                🗑️
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
