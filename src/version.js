/* global __BUILD__ */
// 빌드할 때 vite.config.js가 넣어 주는 판 정보
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { ver: 'dev', hash: '?', date: '', msg: '', dirty: false, built: '' };
export const versionText = `${BUILD.ver} · ${BUILD.hash}${BUILD.dirty ? '+수정중' : ''}${BUILD.date ? ` · ${BUILD.date}` : ''}`;
