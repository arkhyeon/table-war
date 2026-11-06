import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// 빌드 정보: 버전(= main 커밋 수), 커밋 해시·날짜·제목 — 여러 세션에서 작업해도 어떤 판인지 알 수 있게
const git = (c) => { try { return execSync(`git ${c}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const build = {
  ver: `v0.${git('rev-list --count HEAD') || '?'}`,
  hash: git('rev-parse --short HEAD') || process.env.GITHUB_SHA?.slice(0, 7) || '?',
  date: git('log -1 --format=%cd --date=format-local:%Y-%m-%d %H:%M'),
  msg: (git('log -1 --format=%s') || '').slice(0, 80),
  dirty: !!git('status --porcelain --untracked-files=no'),
  built: new Date().toISOString().slice(0, 16).replace('T', ' '),
};

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
  build: { chunkSizeWarningLimit: 1500 },
});
