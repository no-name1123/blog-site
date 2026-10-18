import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dirSize, verifyContent } from '../generator/verify.js';
import { ASSETS_DIR, makeTmp, post, writeContent } from './helpers.js';

const verify = (dir, maxBytes) => verifyContent(dir, { assetsDir: ASSETS_DIR, maxBytes });
const expectCode = (promise, code) => assert.rejects(promise, (e) => {
  assert.equal(e.code, code);
  return true;
});

test('正しい変換結果は通る', async (t) => {
  const dir = await makeTmp(t);
  await writeContent(dir, [post('a', { ogImage: '/posts/a/images/og.png' }), post('b')]);
  const result = await verify(dir);
  assert.deepEqual(result.posts.map((p) => p.slug), ['a', 'b']);
});

test('UT-GN-02 D001 content・build-info.json がない', async (t) => {
  const dir = await makeTmp(t);
  await expectCode(verify(path.join(dir, 'none')), 'D001');
  await writeContent(dir, [post('a')]);
  await fs.rm(path.join(dir, 'build-info.json'));
  await expectCode(verify(dir), 'D001');
});

test('UT-GN-03 D002 build-info.json の形式', async (t) => {
  const dir = await makeTmp(t);
  await writeContent(dir, [post('a')]);
  await fs.writeFile(path.join(dir, 'build-info.json'), 'not json');
  await expectCode(verify(dir), 'D002');
  const base = { formatVersion: 1, sourceCommit: 'local', builtAt: 'x', postCount: 1, totalBytes: 1 };
  for (const bad of [{ ...base, formatVersion: 2 }, { ...base, sourceCommit: 'xyz' }]) {
    await fs.writeFile(path.join(dir, 'build-info.json'), JSON.stringify(bad));
    await expectCode(verify(dir), 'D002');
  }
});

test('UT-GN-04 D004 内容がそろっていない', async (t) => {
  const make = async (posts, options, mutate) => {
    const dir = await makeTmp(t);
    await writeContent(dir, posts, options);
    if (mutate) await mutate(dir);
    return dir;
  };
  await expectCode(verify(await make([post('a')], {}, (d) => fs.rm(path.join(d, 'data/posts.json')))), 'D004');
  await expectCode(verify(await make([post('a')], {}, (d) => fs.rm(path.join(d, 'data/search-index.json')))), 'D004');
  const missingBody = await make([post('a'), post('hello-world')], { skipBody: ['hello-world'] });
  await assert.rejects(verify(missingBody), (e) => {
    assert.equal(e.code, 'D004');
    assert.deepEqual(e.details, ['posts.json の記事 hello-world の body.html がありません']);
    return true;
  });
  await expectCode(verify(await make([post('a', { ogImage: '/posts/a/images/og.png' })], {}, (d) => fs.rm(path.join(d, 'posts/a/images/og.png')))), 'D004');
  await expectCode(verify(await make([post('a'), post('b')], { search: [{ slug: 'a', title: '', date: '', summary: '', tags: [], text: '' }] })), 'D004');
  await expectCode(verify(await make([post('a')], {}, (d) => fs.writeFile(path.join(d, 'data/posts.json'), JSON.stringify({ formatVersion: 2, posts: [] })))), 'D004');
  await expectCode(verify(await make([post('../x')])), 'D004');
});

test('UT-GN-05 D005 容量(.git と build-info.json は数えない)', async (t) => {
  const dir = await makeTmp(t);
  await writeContent(dir, [post('a')]);
  await fs.mkdir(path.join(dir, '.git'));
  await fs.writeFile(path.join(dir, '.git', 'big'), Buffer.alloc(100_000));
  const total = (await dirSize(path.join(dir, 'posts'))) + (await dirSize(path.join(dir, 'data'))) + (await dirSize(ASSETS_DIR));
  assert.equal((await verify(dir, total)).totalBytes, total);
  await expectCode(verify(dir, total - 1), 'D005');
});
