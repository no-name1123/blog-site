import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml, renderString } from '../generator/template.js';
import { buildPages, formatDate } from '../generator/pages.js';
import { buildSitemap } from '../generator/sitemap.js';
import { CONFIG, makeTmp, meta, post, startTags } from './helpers.js';

const LOCAL_CONFIG = { ...CONFIG, siteUrl: 'http://localhost:8080' };

async function build(t, posts, { config = CONFIG, local = false } = {}) {
  const out = await makeTmp(t);
  await buildPages({ posts }, config, out, { local });
  const read = (rel) => fs.readFile(path.join(out, rel), 'utf8');
  return { out, read };
}

const canonical = (html) => startTags(html, 'link').find((l) => l.rel === 'canonical')?.href;
const preloads = (html) => startTags(html, 'link').filter((l) => l.rel === 'preload').map((l) => l.href);

test('UT-GN-09 テンプレートの差し込み', () => {
  assert.equal(renderString('{{x}}|{{{y}}}', { x: `&<>"'`, y: '<b>b</b>' }), '&amp;&lt;&gt;&quot;&#39;|<b>b</b>');
  assert.throws(() => renderString('{{missing}}', {}));
  assert.equal(escapeHtml('a'), 'a');
});

test('UT-GN-10 記事のタイトル・概要をエスケープする', async (t) => {
  const evil = post('x', { title: '"><script>alert(1)</script>', summary: "it's" });
  const html = await (await build(t, [evil])).read('posts/x/index.html');
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; | テストブログ</title>'));
  assert.ok(html.includes('<h1>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</h1>'));
  assert.ok(html.includes('content="it&#39;s"'));
});

test('UT-GN-11 記事ページの head', async (t) => {
  const withAll = post('full', { ogImage: '/posts/full/images/og.png', leadImage: '/posts/full/images/a.png', updated: '2026-10-05' });
  const { read } = await build(t, [withAll, post('plain')]);
  const full = await read('posts/full/index.html');
  assert.match(full, /<title>タイトル full \| テストブログ<\/title>/);
  assert.equal(meta(full, 'description'), '概要 full');
  assert.equal(canonical(full), 'https://blog.example.com/posts/full/');
  assert.equal(meta(full, 'og:type'), 'article');
  assert.equal(meta(full, 'og:title'), 'タイトル full');
  assert.equal(meta(full, 'og:url'), 'https://blog.example.com/posts/full/');
  assert.equal(meta(full, 'og:image'), 'https://blog.example.com/posts/full/images/og.png');
  assert.equal(meta(full, 'twitter:card'), 'summary_large_image');
  assert.match(meta(full, 'Content-Security-Policy') ?? startTags(full, 'meta').find((m) => m['http-equiv'])?.content, /default-src 'self'/);
  assert.deepEqual(preloads(full), ['body.html', '/posts/full/images/a.png']);
  assert.equal(meta(full, 'article:published_time'), '2026-10-01');
  assert.equal(meta(full, 'article:modified_time'), '2026-10-05');
  assert.match(full, /<div id="post-body" class="prose" aria-busy="true">読み込み中…<\/div>/);
  assert.match(full, /<noscript>/);

  const plain = await read('posts/plain/index.html');
  assert.equal(meta(plain, 'og:image'), 'https://blog.example.com/assets/og-default.png');
  assert.deepEqual(preloads(plain), ['body.html']);
  assert.equal(meta(plain, 'article:modified_time'), undefined);
});

test('UT-GN-12 共通ページの head。404 だけ noindex', async (t) => {
  const { read } = await build(t, [post('a')]);
  const cases = [
    ['index.html', 'テストブログ', 'https://blog.example.com/'],
    ['tags/index.html', 'タグ・カテゴリ | テストブログ', 'https://blog.example.com/tags/'],
    ['search/index.html', '検索 | テストブログ', 'https://blog.example.com/search/'],
    ['404.html', 'ページが見つかりません | テストブログ', 'https://blog.example.com/'],
  ];
  for (const [rel, title, url] of cases) {
    const html = await read(rel);
    assert.ok(html.includes(`<title>${title}</title>`), rel);
    assert.equal(meta(html, 'og:title'), title, rel);
    assert.equal(canonical(html), url, rel);
    assert.equal(meta(html, 'og:type'), 'website', rel);
    assert.equal(meta(html, 'og:image'), 'https://blog.example.com/assets/og-default.png', rel);
    assert.equal(meta(html, 'description'), 'サイトの説明', rel);
    assert.equal(meta(html, 'robots'), rel === '404.html' ? 'noindex' : undefined, rel);
  }
});

test('UT-GN-13 トップに最新 10 件を書き出す', async (t) => {
  const many = (n) => Array.from({ length: n }, (_, i) => post(`p${i}`));
  for (const [n, cards, next] of [[9, 9, false], [10, 10, false], [11, 10, true]]) {
    const html = await (await build(t, many(n))).read('index.html');
    assert.equal((html.match(/class="card post-card"/g) ?? []).length, cards, `${n} 件`);
    assert.equal(html.includes('href="/?page=2"'), next, `${n} 件`);
  }
  const html = await (await build(t, [post('a', { tags: ['A&B'], category: '日 記', updated: '2026-10-02' })])).read('index.html');
  assert.ok(html.includes('<a href="/posts/a/">タイトル a</a>'));
  assert.ok(html.includes('<time datetime="2026-10-01">2026年10月1日</time>'));
  assert.ok(html.includes('更新:<time datetime="2026-10-02">'));
  assert.ok(html.includes('href="/?category=%E6%97%A5%20%E8%A8%98"'));
  assert.ok(html.includes('href="/?tag=A%26B">#A&amp;B</a>'));
});

test('UT-GN-14 計測タグと --local', async (t) => {
  const normal = await build(t, [post('a')]);
  for (const rel of ['index.html', 'posts/a/index.html', 'tags/index.html', 'search/index.html', '404.html']) {
    const html = await normal.read(rel);
    const beacon = startTags(html, 'script').find((s) => s.src === 'https://static.cloudflareinsights.com/beacon.min.js');
    assert.ok(beacon, rel);
    assert.deepEqual(JSON.parse(beacon['data-cf-beacon'].replaceAll('&quot;', '"')), { token: 'abc123' });
    assert.ok(html.includes('Cloudflare Web Analytics を使用しています'), rel);
  }
  const local = await build(t, [post('a'), post('d', { draft: true })], { config: LOCAL_CONFIG, local: true });
  for (const rel of ['index.html', 'posts/a/index.html', 'tags/index.html', 'search/index.html', '404.html']) {
    const html = await local.read(rel);
    assert.ok(!html.includes('beacon.min.js'), rel);
    assert.equal(meta(html, 'robots'), 'noindex', rel);
    assert.ok(canonical(html).startsWith('http://localhost:8080/'), rel);
  }
  assert.ok((await local.read('posts/d/index.html')).includes('<h1>[下書き]タイトル d</h1>'));
  assert.ok((await local.read('index.html')).includes('>[下書き]タイトル d</a>'));
  assert.ok(!(await local.read('posts/a/index.html')).includes('[下書き]'));
});

test('UT-GN-15 404 のリンク・CSS・JS はルートからの絶対パス', async (t) => {
  const html = await (await build(t, [])).read('404.html');
  const refs = [
    ...startTags(html, 'a').map((a) => a.href),
    ...startTags(html, 'link').filter((l) => l.rel === 'stylesheet').map((l) => l.href),
    ...startTags(html, 'script').map((s) => s.src),
    ...startTags(html, 'form').map((f) => f.action),
  ];
  assert.ok(refs.length >= 4);
  for (const ref of refs) assert.ok(ref.startsWith('/') || ref.startsWith('https://'), ref);
});

test('UT-GN-16 sitemap.xml・robots.txt', async (t) => {
  const out = await makeTmp(t);
  await buildSitemap([post('a', { updated: '2026-10-05' }), post('b')], CONFIG, out);
  const xml = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['https://blog.example.com/', 'https://blog.example.com/tags/', 'https://blog.example.com/posts/a/', 'https://blog.example.com/posts/b/']);
  assert.ok(xml.includes('<loc>https://blog.example.com/posts/a/</loc><lastmod>2026-10-05</lastmod>'));
  assert.ok(xml.includes('<loc>https://blog.example.com/posts/b/</loc><lastmod>2026-10-01</lastmod>'));
  assert.equal(await fs.readFile(path.join(out, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\nSitemap: https://blog.example.com/sitemap.xml\n');
  await buildSitemap([], LOCAL_CONFIG, out, { local: true });
  assert.equal(await fs.readFile(path.join(out, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
});

test('日付の表示形式', () => {
  assert.equal(formatDate('2026-01-05'), '2026年1月5日');
});
