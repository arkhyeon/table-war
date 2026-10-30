import { useEffect, useState } from 'react';
import { SLOT_COUNT, loadSlot, writeSlot, deleteSlot } from '../storage.js';
import { cloudList, cloudLoad, cloudSave, cloudDelete } from '../cloud.js';
import { getScenario } from '../game/scenarios.js';
import { fmtYear, yearOf } from '../game/weather.js';
import { dateOf } from '../game/hex14.js';

// 저장 목록: 0번은 자동 저장, 1~3번은 수동 슬롯
export function describe(d) {
  if (!d?.state) return null;
  const st = d.state;
  const me = st.nations?.[st.playerId];
  const when = d.savedAt ? new Date(d.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const title = `${me?.name || '?'} · ${getScenario(d.scenarioId)?.name || d.scenarioId}`;
  // 삼국지14식 저장: 지역 대신 도시 수로 표시
  if (st.mode === 'hex14') {
    const cities = (st.castles || []).filter((c) => c.kind !== 'pass');
    const mine = cities.filter((c) => c.owner === st.playerId).length;
    return { title: `🏯 ${title}`, sub: `${dateOf(st, st.startYear)} · 도시 ${mine}/${cities.length}${st.over ? ' · 종료됨' : ''}${when ? ` · ${when}` : ''}` };
  }
  const regions = st.regions || [];
  const land = regions.filter((r) => !r.sea).length;
  const mine = regions.filter((r) => !r.sea && r.owner === st.playerId).length;
  return {
    title,
    sub: `${st.turn}턴 (${fmtYear(yearOf(st.turn, getScenario(d.scenarioId)?.startYear ?? 1))}) · 영토 ${mine}/${land}곳${st.gameOver ? ' · 종료됨' : ''}${when ? ` · ${when}` : ''}`,
  };
}

export default function SaveSlots({ current, onLoad, onSaved }) {
  const [, bump] = useState(0);
  const [cloudMeta, setCloudMeta] = useState({}); // 클라우드 저장 요약
  const [busy, setBusy] = useState(false);
  const refresh = () => cloudList(SLOT_COUNT).then(setCloudMeta);
  useEffect(() => { refresh(); }, []);
  const ids = [0, ...Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)];
  return (
    <div className="slots">
      {ids.map((k) => {
        const d = loadSlot(k);
        const cm = cloudMeta[k];
        // 브라우저 저장과 클라우드 저장 중 더 최근 것
        const useCloud = cm && (!d || (cm.savedAt || 0) > (d.savedAt || 0));
        const info = useCloud ? cm.info : describe(d);
        const has = !!d || !!cm;
        return (
          <div key={k} className="slot">
            <div className="info">
              <b>{k === 0 ? '⏱️ 자동 저장' : `💾 슬롯 ${k}`}{useCloud ? ' ☁️' : ''}</b>
              <small>{info ? `${info.title} — ${info.sub}` : has ? '저장됨' : '비어 있음'}</small>
            </div>
            {current && k > 0 && (
              <button
                className="sm"
                onClick={() => {
                  if (has && !window.confirm(`슬롯 ${k}에 덮어쓸까요?`)) return;
                  const ok = writeSlot(k, current);
                  cloudSave(k, current, describe({ ...current, savedAt: Date.now() }));
                  bump((v) => v + 1);
                  setTimeout(refresh, 1500);
                  onSaved?.(ok ? `슬롯 ${k}에 저장했습니다.` : '이 기기 저장 공간이 부족해 클라우드에만 저장합니다.', !ok);
                }}
              >
                저장
              </button>
            )}
            {has && (
              <button
                className="sm primary"
                disabled={busy}
                onClick={async () => {
                  if (!useCloud) return onLoad(d);
                  setBusy(true);
                  const cd = await cloudLoad(k).catch(() => null);
                  setBusy(false);
                  if (cd) onLoad(cd);
                  else if (d) onLoad(d);
                  else window.alert('클라우드 저장을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
                }}
              >
                {busy ? '불러오는 중…' : '불러오기'}
              </button>
            )}
            {has && k > 0 && (
              <button
                className="sm"
                title="슬롯 비우기"
                onClick={async () => {
                  if (!window.confirm(`슬롯 ${k}를 지울까요?`)) return;
                  deleteSlot(k);
                  await cloudDelete(k);
                  bump((v) => v + 1);
                  refresh();
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
