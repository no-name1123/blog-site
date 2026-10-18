import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../generator/config.js';
import { ASSETS_DIR, CONFIG, makeTmp, writeConfig } from './helpers.js';

const load = async (t, config, local = false) => {
  const dir = await makeTmp(t);
  return loadConfig(await writeConfig(dir, config), local, { assetsDir: ASSETS_DIR });
};
const rejects = (t, config) => assert.rejects(load(t, config), (e) => e.code === 'D006', JSON.stringify(config));

test('UT-GN-01 正しい設定を読む。--local は siteUrl を置き換える', async (t) => {
  assert.equal((await load(t, CONFIG)).siteUrl, 'https://blog.example.com');
  assert.equal((await load(t, CONFIG, true)).siteUrl, 'http://localhost:8080');
});

test('UT-GN-01 誤りは D006', async (t) => {
  for (const key of Object.keys(CONFIG)) {
    const c = { ...CONFIG };
    delete c[key];
    await rejects(t, c);
  }
  await rejects(t, { ...CONFIG, siteUrl: 'http://blog.example.com' });
  await rejects(t, { ...CONFIG, siteUrl: 'https://blog.example.com/' });
  await rejects(t, { ...CONFIG, defaultOgImage: 'none.png' });
  const dir = await makeTmp(t);
  await fs.writeFile(path.join(dir, 'a.svg'), '<svg/>');
  await assert.rejects(loadConfig(await writeConfig(dir, { ...CONFIG, defaultOgImage: 'a.svg' }), false, { assetsDir: dir }), (e) => e.code === 'D006');
  await rejects(t, { ...CONFIG, analyticsToken: 'abc-123' });
  await rejects(t, { ...CONFIG, analyticsToken: 'a'.repeat(65) });
  await rejects(t, { ...CONFIG, siteName: 'n'.repeat(51) });
  await rejects(t, { ...CONFIG, contentRepo: 'blog-content' });
  await rejects(t, '{ broken');
});
