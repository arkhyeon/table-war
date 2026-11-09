import { useEffect, useState } from 'react';

// 홈 화면에 앱처럼 설치: 크롬은 버튼 한 번, 아이폰은 사파리 공유 메뉴 안내, 설치를 못 하는 곳(미리보기 등)에선 게임 주소 안내
const HOME = 'https://arkhyeon.github.io/table-war/';
const APK = 'https://github.com/arkhyeon/table-war/releases/download/android-latest/table-war.apk';
const isAndroid = () => /Android/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const framed = () => { try { return window.self !== window.top; } catch { return true; } };

export default function InstallCard() {
  const [evt, setEvt] = useState(() => window.__installEvt || null);
  const [hide, setHide] = useState(() => { try { return standalone() || !!window.Capacitor || localStorage.getItem('tw-install-hide') === '1'; } catch { return standalone() || !!window.Capacitor; } });
  const [help, setHelp] = useState(false);
  useEffect(() => { const on = () => setEvt(window.__installEvt || null); window.addEventListener('tw-install', on); return () => window.removeEventListener('tw-install', on); }, []);
  if (hide) return null;
  const close = () => { setHide(true); try { localStorage.setItem('tw-install-hide', '1'); } catch {} };
  const install = async () => { if (!evt) { setHelp((v) => !v); return; } evt.prompt(); const r = await evt.userChoice.catch(() => null); if (r?.outcome === 'accepted') close(); window.__installEvt = null; setEvt(null); };
  const away = framed() || !/^https:/.test(location.protocol);
  return (
    <div className="tut-card install-card">
      <div>
        <b>📲 앱으로 설치</b>
        <small className="muted">홈 화면 아이콘으로 전체 화면 실행 (인터넷 없어도 됨)</small>
        {help && (
          <small className="install-help">
            {away ? <>여기(미리보기)에선 설치가 안 돼요. 크롬·사파리로 <a href={HOME} target="_blank" rel="noreferrer">{HOME.replace('https://', '')}</a> 를 열고 설치하세요.</>
              : isIOS() ? <>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.</>
              : <>크롬 오른쪽 위 <b>⋮ 메뉴</b> → <b>홈 화면에 추가</b>(PC는 <b>앱 설치</b>)를 누르세요.</>}
            {!isIOS() && <><br />안드로이드는 <a href={APK}>앱 파일(APK) 받기</a> — 받아서 설치하면 인터넷 없이 실행돼요 (처음 한 번 「출처를 알 수 없는 앱」 허용).</>}
          </small>
        )}
      </div>
      <button className="primary install-go" onClick={install}>{evt ? '설치' : '방법'}</button>
      <button className="ghost install-x" title="다시 보지 않기" aria-label="닫기" onClick={close}>✕</button>
    </div>
  );
}
