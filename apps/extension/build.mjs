// 拡張機能をビルドする。dist/ に popup.html / popup.js / manifest.json を配置する。
//   開発: node build.mjs --watch
//   本番: node build.mjs

import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const buildOpts = {
  entryPoints: ['src/popup.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/popup.js',
  target: 'chrome120',
  logLevel: 'info',
  // executeScript({func}) で関数を .toString() するため、
  // 関数の構造を壊さないよう minify は無効にする。
  minify: false,
};

await mkdir('dist', { recursive: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/popup.html', 'dist/popup.html');

if (watch) {
  const ctx = await esbuild.context(buildOpts);
  await ctx.watch();
  console.log('watching...');
} else {
  await esbuild.build(buildOpts);
}
