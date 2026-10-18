// FN-009 ページ生成(詳細設計 2.4.4、5 章)。FN-014 の計測タグ、FN-015 の 404 もここで作る。
import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml, render } from './template.js';

export const PAGE_SIZE = 10;
const DRAFT_PREFIX = '[下書き]';

/** `YYYY-MM-DD` を `YYYY年M月D日` にする */
export function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

const displayTitle = (post, local) => (local && post.draft === true ? `${DRAFT_PREFIX}${post.title}` : post.title);

function metaHtml(post, { withCategory = true } = {}) {
  const parts = [`<time datetime="${escapeHtml(post.date)}">${escapeHtml(formatDate(post.date))}</time>`];
  if (post.updated) {
    parts.push(`<span>更新:<time datetime="${escapeHtml(post.updated)}">${escapeHtml(formatDate(post.updated))}</time></span>`);
  }
  if (withCategory) {
    parts.push(`<a href="/?category=${escapeHtml(encodeURIComponent(post.category))}">${escapeHtml(post.category)}</a>`);
  }
  return parts.join('');
}

function tagsHtml(tags) {
  if (tags.length === 0) return '';
  const items = tags.map((t) => `<li><a class="tag" href="/?tag=${escapeHtml(encodeURIComponent(t))}">#${escapeHtml(t)}</a></li>`);
  return `<ul class="tags">${items.join('')}</ul>`;
}

/** 記事カード(5.2)。app.js の描画と同じ構造にする */
export function cardHtml(post, local) {
  return [
    '<article class="card post-card">',
    `<h2><a href="/posts/${escapeHtml(post.slug)}/">${escapeHtml(displayTitle(post, local))}</a></h2>`,
    `<div class="meta">${metaHtml(post)}</div>`,
    `<p>${escapeHtml(post.summary)}</p>`,
    tagsHtml(post.tags),
    '</article>',
  ].join('');
}

function analyticsTag(config, local) {
  if (local) return '';
  const beacon = escapeHtml(JSON.stringify({ token: config.analyticsToken }));
  return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="${beacon}"></script>`;
}

function page(config, local, spec) {
  const extraHead = [...(spec.extraHead ?? [])];
  if (local || spec.noindex) extraHead.push('<meta name="robots" content="noindex">');
  return render('base.html', {
    pageTitle: spec.pageTitle,
    ogTitle: spec.ogTitle ?? spec.pageTitle,
    description: spec.description,
    canonicalUrl: spec.canonicalUrl,
    siteName: config.siteName,
    ogType: spec.ogType ?? 'website',
    ogImageUrl: spec.ogImageUrl ?? `${config.siteUrl}/assets/${config.defaultOgImage}`,
    extraHead: extraHead.join('\n'),
    analytics: analyticsTag(config, local),
    pageType: spec.pageType,
    main: spec.main,
    copyright: config.copyright,
  });
}

/**
 * 記事ページ・トップ・タグ一覧・検索・404 を生成する。
 * @param {{ posts: object[] }} content verifyContent の結果
 * @param {object} config loadConfig の結果
 * @param {string} outDir
 * @param {{ local?: boolean }} [options]
 * @returns {Promise<number>} 生成したページ数
 */
export async function buildPages(content, config, outDir, { local = false } = {}) {
  const { posts } = content;
  const write = async (rel, html) => {
    const file = path.join(outDir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
  };

  for (const post of posts) {
    const title = displayTitle(post, local);
    const extraHead = ['<link rel="preload" href="body.html" as="fetch" crossorigin="anonymous">'];
    if (post.leadImage) extraHead.push(`<link rel="preload" href="${escapeHtml(post.leadImage)}" as="image" fetchpriority="high">`);
    extraHead.push(`<meta property="article:published_time" content="${escapeHtml(post.date)}">`);
    if (post.updated) extraHead.push(`<meta property="article:modified_time" content="${escapeHtml(post.updated)}">`);
    await write(path.join('posts', post.slug, 'index.html'), page(config, local, {
      pageType: 'post',
      pageTitle: `${title} | ${config.siteName}`,
      ogTitle: title,
      description: post.summary,
      canonicalUrl: `${config.siteUrl}/posts/${post.slug}/`,
      ogType: 'article',
      ogImageUrl: post.ogImage ? `${config.siteUrl}${post.ogImage}` : undefined,
      extraHead,
      main: render('post.html', { title, meta: metaHtml(post), tags: tagsHtml(post.tags) }),
    }));
  }

  const totalPages = Math.ceil(posts.length / PAGE_SIZE);
  const pager = totalPages > 1 ? `<span>1 / ${totalPages}</span><a href="/?page=2">次へ ›</a>` : '';
  await write('index.html', page(config, local, {
    pageType: 'index',
    pageTitle: config.siteName,
    description: config.description,
    canonicalUrl: `${config.siteUrl}/`,
    main: render('index.html', {
      cards: posts.slice(0, PAGE_SIZE).map((p) => cardHtml(p, local)).join('\n'),
      pager,
      pagerHidden: pager ? '' : ' hidden',
    }),
  }));

  const common = [
    ['tags/index.html', 'tags', `タグ・カテゴリ | ${config.siteName}`, `${config.siteUrl}/tags/`, 'tags.html', false],
    ['search/index.html', 'search', `検索 | ${config.siteName}`, `${config.siteUrl}/search/`, 'search.html', false],
    ['404.html', 'notfound', `ページが見つかりません | ${config.siteName}`, `${config.siteUrl}/`, '404.html', true],
  ];
  for (const [rel, pageType, pageTitle, canonicalUrl, body, noindex] of common) {
    await write(rel, page(config, local, {
      pageType, pageTitle, description: config.description, canonicalUrl, noindex, main: render(body, {}),
    }));
  }
  return posts.length + 1 + common.length;
}
