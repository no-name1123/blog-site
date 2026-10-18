// UT-WF-02・03 deploy.yml の静的確認(テスト計画 5.3)。blog-site は依存を持たないため、文字列と正規表現で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const wf = await fs.readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const block = (name) => {
  const m = new RegExp(`^${name}:\\n((?:[ ]+.*\\n|\\n)*)`, 'm').exec(wf);
  return m ? m[1] : '';
};

test('UT-WF-02 deploy.yml の契機・権限・同時実行・SSH での配置', () => {
  const on = block('on');
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}repository_dispatch:\n {4}types: \[content-updated\]$/m);
  assert.match(on, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(wf, /pull_request/);
  const perms = block('permissions').trim().split('\n').map((l) => l.trim()).sort();
  assert.deepEqual(perms, ['contents: read', 'issues: write']);
  assert.match(block('concurrency'), /group: deploy\n\s+cancel-in-progress: false/);
  assert.match(wf, /timeout-minutes: 15/);
  assert.doesNotMatch(wf, /deploy-pages|upload-pages-artifact|pages: write/);
  // ファイル名を公開ログに出さない(N-008)
  const rsync = wf.split('\n').filter((l) => /(^|\s)rsync\s+-/.test(l));
  assert.equal(rsync.length, 1);
  assert.doesNotMatch(rsync[0], /\s-[a-zA-Z]*v|--verbose|--progress|--itemize/);
  // 接続先の鍵は事前登録したものだけを信用する
  assert.match(wf, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(wf, /StrictHostKeyChecking=(no|accept-new)|ssh-keyscan/);
  // 通信が止まったときに打ち切る
  assert.match(wf, /ConnectTimeout=\d+/);
  assert.match(wf, /ServerAliveInterval=\d+/);
  assert.match(rsync[0], /--timeout=\d+/);
  // current は一度に差し替える
  assert.match(wf, /mv -Tf current\.tmp current/);
  assert.match(wf, /if: failure\(\) \|\| cancelled\(\)/);
});

test('UT-WF-03 App のトークンは blog-content の contents:read・actions:read だけ', () => {
  const m = /uses: actions\/create-github-app-token@v\d+\n((?:\s+.*\n)*?)\n/.exec(wf);
  assert.ok(m);
  const withBlock = m[1];
  assert.match(withBlock, /repositories: blog-content\n/);
  const perms = [...withBlock.matchAll(/(permission-[a-z-]+): (\w+)/g)].map((x) => `${x[1]}=${x[2]}`).sort();
  assert.deepEqual(perms, ['permission-actions=read', 'permission-contents=read']);
});
