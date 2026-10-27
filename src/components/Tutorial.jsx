import { useState } from 'react';

// 첫 판 안내: 한 번 닫으면 다시 안 뜸 (☰ → 게임 방법에서 다시 볼 수 있음)
const KEY = 'tablewar-tut';
const STEPS = [
  ['👋 환영합니다', '지도에서 내 지역(내 색)을 누르면 오른쪽(폰은 아래) 패널에 정보와 할 일이 나옵니다.'],
  ['⚔️ 이동·공격', '내 지역 → 🚩이동·공격(M) → 빨간 테두리 지역을 누르고 병력·장수를 골라 「공격 계획」. 장수가 함께 가면 💰용병도 붙일 수 있습니다.'],
  ['⏭ 턴 종료', '계획은 바로 실행되지 않고, 턴 종료 때 모든 나라가 동시에 움직입니다. 행동력(●)이 남았는지 위쪽에서 확인하세요.'],
  ['💂 병력 모으기', '상단 💂징병 한 번으로 모든 땅에서 뽑아 원하는 곳으로 바로 보내고, 지역에서 📯병력 불러오기, 국가 카드의 🚩전선 투입으로 후방 병력을 자동으로 보낼 수 있습니다.'],
  ['🤝 외교와 장수', '중앙에 있는 나라는 불가침·동맹으로 전선을 줄이세요. 장수에게 🏯분봉해 땅을 맡기거나, 💰매수로 땅을 돈으로 얻을 수도 있습니다.'],
  ['💾 저장', '☰ 메뉴에서 저장·불러오기와 「게임 방법」을 볼 수 있습니다. 자동 저장도 됩니다. 행운을 빕니다!'],
];
export const tutorialSeen = () => {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return true;
  }
};
export default function Tutorial({ onClose }) {
  const [i, setI] = useState(0);
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* 무시 */
    }
    onClose();
  };
  const [t, d] = STEPS[i];
  return (
    <div className="tut">
      <h4>
        {t} <small className="muted">{i + 1}/{STEPS.length}</small>
      </h4>
      <div>{d}</div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="sm" onClick={close}>그만 보기</button>
        {i > 0 && <button className="sm" onClick={() => setI(i - 1)}>이전</button>}
        {i < STEPS.length - 1 ? <button className="sm primary" onClick={() => setI(i + 1)}>다음</button> : <button className="sm primary" onClick={close}>시작!</button>}
      </div>
    </div>
  );
}
