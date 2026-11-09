// 안드로이드 앱(APK) 빌드 전 손질: 아이콘·바탕색·판 번호. (android 폴더는 빌드할 때마다 새로 만듦 — npx cap add android)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const res = 'android/app/src/main/res';
const ver = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()) || 1;

// 아이콘: 둥근 네모 그림(옛 런처) + 적응형 아이콘 앞그림(가운데 66%)·바탕색
for (const d of fs.readdirSync(res).filter((x) => x.startsWith('mipmap-') && !x.includes('anydpi'))) {
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) fs.copyFileSync('public/icon-192.png', path.join(res, d, f));
  fs.copyFileSync('android-res/ic_launcher_foreground.png', path.join(res, d, 'ic_launcher_foreground.png'));
}
const bg = path.join(res, 'values/ic_launcher_background.xml');
if (fs.existsSync(bg)) fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1B1D22</color>\n</resources>\n');

// 상태 표시줄·시작 화면을 게임 바탕색(어두운 색)으로 — 기본은 파란색·Capacitor 로고
fs.writeFileSync(path.join(res, 'values/colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="colorPrimary">#1B1D22</color>\n    <color name="colorPrimaryDark">#1B1D22</color>\n    <color name="colorAccent">#F0B94A</color>\n</resources>\n');
const st = path.join(res, 'values/styles.xml');
fs.writeFileSync(st, fs.readFileSync(st, 'utf8').replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@color/ic_launcher_background</item>\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>'));

// 판 번호: 새 APK를 덮어 설치할 수 있게 매번 올림
const gradle = 'android/app/build.gradle';
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode \d+/, `versionCode ${ver}`).replace(/versionName "[^"]*"/, `versionName "0.${ver}"`);
fs.writeFileSync(gradle, g);

// 한 파일짜리(table-war.html)는 앱에 필요 없음
fs.rmSync('android/app/src/main/assets/public/table-war.html', { force: true });
console.log('android prep ok: version', ver);
