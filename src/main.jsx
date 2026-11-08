import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// 크롬(안드로이드·PC)의 「앱 설치」 신호를 잡아 두었다가 첫 화면의 설치 버튼에서 씀
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; window.dispatchEvent(new Event('tw-install')); });
window.addEventListener('appinstalled', () => { window.__installEvt = null; window.dispatchEvent(new Event('tw-install')); });

createRoot(document.getElementById('root')).render(<App />);

// 웹앱(홈 화면에 추가)으로 설치했을 때 오프라인에서도 열리도록
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
