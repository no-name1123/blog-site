// テスト用の補助関数。ファイル操作はすべて一時ディレクトリで行う。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ASSETS_DIR = path.join(REPO_ROOT, 'src', 'assets');

export async function makeTmp(t, prefix = 'gn-') {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export const CONFIG = Object.freeze({
  siteName: 'テストブログ',
  siteUrl: 'https://blog.example.com',
  description: 'サイトの説明',
  defaultOgImage: 'og-default.png',
  contentRepo: 'owner/blog-content',
  analyticsToken: 'abc123',
  copyright: '© 2026 test',
});

export function post(slug, extra = {}) {
  return {
    slug,
    title: `タイトル ${slug}`,
    date: '2026-10-01',
    updated: null,
    category: '日記',
    tags: [],
    summary: `概要 ${slug}`,
    ogImage: null,
    leadImage: null,
    ...extra,
  };
}

/**
 * 変換結果(dist 相当)を作る。
 * @param {string} dir
 * @param {object[]} posts
 * @param {{ buildInfo?: object, skipBody?: string[], search?: object[] }} [options]
 */
export async function writeContent(dir, posts, options = {}) {
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  const buildInfo = options.buildInfo ?? {
    formatVersion: 1, sourceCommit: 'a'.repeat(40), builtAt: '2026-10-07T00:00:00.000Z', postCount: posts.length, totalBytes: 0,
  };
  await fs.writeFile(path.join(dir, 'build-info.json'), JSON.stringify(buildInfo));
  await fs.writeFile(path.join(dir, 'data', 'posts.json'), JSON.stringify({ formatVersion: 1, posts }));
  const search = options.search ?? posts.map((p) => ({ slug: p.slug, title: p.title, date: p.date, summary: p.summary, tags: p.tags, text: 'text' }));
  await fs.writeFile(path.join(dir, 'data', 'search-index.json'), JSON.stringify({ formatVersion: 1, posts: search }));
  for (const p of posts) {
    if (options.skipBody?.includes(p.slug) || !/^[a-z0-9-]+$/.test(p.slug)) continue;
    await fs.mkdir(path.join(dir, 'posts', p.slug), { recursive: true });
    await fs.writeFile(path.join(dir, 'posts', p.slug, 'body.html'), `<p>${p.slug}</p>`);
    for (const img of [p.ogImage, p.leadImage]) {
      if (img) {
        await fs.mkdir(path.join(dir, path.dirname(img)), { recursive: true });
        await fs.writeFile(path.join(dir, img), 'img');
      }
    }
  }
}

export async function writeConfig(dir, config = CONFIG) {
  const file = path.join(dir, 'site.config.json');
  await fs.writeFile(file, typeof config === 'string' ? config : JSON.stringify(config));
  return file;
}

/** cli のテスト用に、本物の src を持つリポジトリの配置を一時ディレクトリに作る */
export async function fakeRepo(t) {
  const base = await makeTmp(t);
  const root = path.join(base, 'repo');
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.cp(path.join(REPO_ROOT, 'src'), path.join(root, 'src'), { recursive: true });
  return { base, root };
}

/** HTML から開始タグの属性を取り出す(テスト用の簡易版。属性値は " か ' で囲まれている前提) */
export function startTags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  return [...html.matchAll(re)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([^\s=/]+)(?:="([^"]*)"|='([^']*)')?/g)) attrs[a[1]] = a[2] ?? a[3] ?? '';
    return attrs;
  });
}

export const meta = (html, key) => startTags(html, 'meta').find((m) => m.property === key || m.name === key)?.content;
