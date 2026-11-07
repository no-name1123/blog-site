// 画面デザイン仕様書(04_screen_design.md)2 章のトークンと 3.3・3.4・3.7 の装飾を style.css で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ASSETS_DIR } from './helpers.js';
import path from 'node:path';

const css = await fs.readFile(path.join(ASSETS_DIR, 'style.css'), 'utf8');

/** `selector { ... }` の中身を返す(入れ子のない単純なブロックだけを扱う) */
function block(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} が見つからない`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
}

/** ブロックの中の `--name: value;` を Map にする */
function tokens(body) {
  const map = new Map();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = tokens(block(css, ':root'));
const dark = new Map([...light, ...tokens(block(css.slice(darkStart), ':root'))]);

function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('色は :root のトークンでだけ指定する(トークン定義の外に色の直書きがない)', () => {
  const withoutRoots = css.replace(/:root\s*\{[^}]*\}/g, '');
  assert.deepEqual(withoutRoots.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
});

test('追加したトークンがライトとダークの両方で決まっている', () => {
  const themed = ['--color-visited', '--color-btn-top', '--color-btn-bottom', '--color-btn-hover', '--color-btn-hi', '--btn-hover-top', '--btn-hover-bottom'];
  const darkOnly = tokens(block(css.slice(darkStart), ':root'));
  for (const name of themed) {
    assert.ok(light.has(name), `ライトに ${name} がない`);
    assert.ok(darkOnly.has(name), `ダークに ${name} がない`);
  }
  for (let i = 1; i <= 6; i += 1) assert.match(light.get(`--color-rainbow-${i}`), /^#[0-9a-f]{6}$/);
  assert.match(light.get('--gradient-rainbow'), /^linear-gradient\(90deg, var\(--color-rainbow-1\)/);
});

test('新しい色の組み合わせが 2.1 のコントラスト比の基準を満たす', () => {
  const resolve = (theme, value) => (value.startsWith('var(') ? theme.get(value.slice(4, -1)) : value);
  for (const [name, theme] of [['ライト', light], ['ダーク', dark]]) {
    const c = (name2) => resolve(theme, theme.get(name2));
    const checks = [
      ['訪問済みリンク / カード', c('--color-visited'), c('--color-surface'), 4.5],
      ['訪問済みリンク / コード背景', c('--color-visited'), c('--color-code-bg'), 4.5],
      ['ボタンの文字 / 上端', c('--color-text'), c('--color-btn-top'), 4.5],
      ['ボタンの文字 / 下端', c('--color-text'), c('--color-btn-bottom'), 4.5],
      ['ボタンの文字 / ホバー', c('--color-text'), c('--color-btn-hover'), 4.5],
      ['ボタンの影の側の枠 / カード', c('--color-input-border'), c('--color-surface'), 3],
      ['ボタンの影の側の枠 / ページ背景', c('--color-input-border'), c('--color-bg'), 3],
    ];
    for (const [label, fg, bg, min] of checks) {
      assert.ok(contrast(fg, bg) >= min, `${name} ${label}: ${contrast(fg, bg).toFixed(2)} < ${min}`);
    }
  }
});

test('虹色の線はページ上端・本文の h2・SC-03 の見出しの 3 か所だけに使う', () => {
  const users = [...css.matchAll(/^([^{}\n]+)\{[^}]*var\(--gradient-rainbow\)[^}]*\}/gm)].map((m) => m[1].trim());
  assert.deepEqual(users.sort(), ['.prose h2', '.section-title', '.site-header::before'].sort());
});

test('ボタンは立体(ベベル)で、押すと枠の明暗が入れ替わる', () => {
  const btn = block(css, '.btn');
  assert.match(btn, /background: linear-gradient\(var\(--color-btn-top\), var\(--color-btn-bottom\)\)/);
  assert.match(btn, /border-color: var\(--color-btn-hi\) var\(--color-input-border\) var\(--color-input-border\) var\(--color-btn-hi\)/);
  assert.match(block(css, '.btn:active'), /border-color: var\(--color-input-border\) var\(--color-btn-hi\) var\(--color-btn-hi\) var\(--color-input-border\)/);
});

test('訪問済みの色を変えるのは本文中のリンクだけ', () => {
  const visited = [...css.matchAll(/([^{}\n]*:visited[^{}\n]*)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(visited, ['.prose a:visited']);
});

test('アニメーションは使わない', () => {
  assert.doesNotMatch(css, /animation|@keyframes|transition/);
});
