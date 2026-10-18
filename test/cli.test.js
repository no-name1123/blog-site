import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSameOrInside, main } from '../generator/cli.js';
import { copyAssets, copyContent } from '../generator/copy.js';
import { ASSETS_DIR, CONFIG, fakeRepo, makeTmp, post, writeConfig, writeContent } from './helpers.js';

async function setup(t) {
  const { base, root } = await fakeRepo(t);
  const content = path.join(base, 'content');
  await writeContent(content, [post('a'), post('b')]);
  const config = await writeConfig(root, CONFIG);
  return { base, root, content, config };
}

async function run(argv, root, env = {}) {
  const lines = [];
  const code = await main(argv, { repoRoot: root, env, log: (l) => lines.push(l) });
  return { code, lines };
}

const exists = (p) => fs.stat(p).then(() => true, () => false);

test('UT-GN-07 --out に _site・.local-site・リポジトリの外(未作成を含む)を指定できる', async (t) => {
  const { base, root, content, config } = await setup(t);
  for (const out of [path.join(root, '_site'), path.join(root, '.local-site'), path.join(base, 'outside'), path.join(base, 'new', 'deep')]) {
    const { code, lines } = await run(['--content', content, '--out', out, '--config', config], root);
    assert.equal(code, 0, `${out} ${lines.join('\n')}`);
    assert.ok(await exists(path.join(out, 'posts/a/index.html')), out);
    assert.ok(await exists(path.join(out, 'posts/a/body.html')), out);
    assert.ok(await exists(path.join(out, 'sitemap.xml')), out);
  }
});

test('UT-GN-08 --out の拒否', async (t) => {
  const { base, root, content, config } = await setup(t);
  await fs.mkdir(path.join(root, 'src', 'assets'), { recursive: true });
  const cases = ['.', '.git', 'src', 'src/assets', 'site.config.json', '..'].map((p) => path.join(root, p));
  cases.push(content, path.join(content, 'posts'), base, path.join(root, 'other'));
  await fs.writeFile(path.join(base, 'file.txt'), 'x');
  cases.push(path.join(base, 'file.txt'));
  for (const out of cases) {
    const { code } = await run(['--content', content, '--out', out, '--config', config], root);
    assert.equal(code, 2, out);
  }
  assert.ok(await exists(path.join(root, 'site.config.json')), '拒否した出力先を消していない');
  assert.equal(isSameOrInside('/a/bc', '/a/b'), false);
});

test('UT-GN-06 FAILURE_CODE_FILE に最初のコードを書く', async (t) => {
  const { base, root, content } = await setup(t);
  const codeFile = path.join(base, 'failure-code.txt');
  const badConfig = await writeConfig(path.join(base), { ...CONFIG, siteUrl: 'http://x' });
  await fs.rm(path.join(content, 'data', 'posts.json'));
  const out = path.join(root, '_site');
  const first = await run(['--content', content, '--out', out, '--config', badConfig], root, { FAILURE_CODE_FILE: codeFile });
  assert.equal(first.code, 1);
  assert.equal(await fs.readFile(codeFile, 'utf8'), 'D006\n');

  const good = await writeConfig(root, CONFIG);
  const second = await run(['--content', content, '--out', out, '--config', good], root, { FAILURE_CODE_FILE: codeFile });
  assert.equal(second.code, 1);
  assert.equal(await fs.readFile(codeFile, 'utf8'), 'D004\n');
  assert.ok(second.lines.every((l) => l.startsWith('[ERROR] D004')), second.lines.join('\n'));

  const usage = await run(['--content', content], root, { FAILURE_CODE_FILE: codeFile });
  assert.equal(usage.code, 2);
  assert.equal(await fs.readFile(codeFile, 'utf8'), 'D099\n');
});

test('UT-GN-17 変換結果と静的ファイルのコピー', async (t) => {
  const { base, content } = await setup(t);
  await fs.mkdir(path.join(content, '.git'));
  await fs.writeFile(path.join(content, '.git', 'HEAD'), 'x');
  const out = path.join(base, 'copy-out');
  await copyContent(content, out);
  await copyAssets(ASSETS_DIR, out);
  assert.deepEqual((await fs.readdir(out)).sort(), ['assets', 'data', 'posts']);
  assert.ok(await exists(path.join(out, 'posts/a/body.html')));
  assert.ok(await exists(path.join(out, 'data/search-index.json')));
  assert.ok(await exists(path.join(out, 'assets/style.css')));
});

test('生成し直すと前回の出力は残らない', async (t) => {
  const { root, content, config } = await setup(t);
  const out = path.join(root, '_site');
  await fs.mkdir(path.join(out, 'posts', 'old'), { recursive: true });
  assert.equal((await run(['--content', content, '--out', out, '--config', config], root)).code, 0);
  assert.equal(await exists(path.join(out, 'posts', 'old')), false);
  assert.equal(await exists(path.join(out, 'build-info.json')), false);
});
