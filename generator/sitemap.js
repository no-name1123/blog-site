// FN-009 sitemap.xml・robots.txt(詳細設計 2.4.5)
import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from './template.js';

/**
 * @param {object[]} posts
 * @param {{ siteUrl: string }} config
 * @param {string} outDir
 * @param {{ local?: boolean }} [options]
 */
export async function buildSitemap(posts, config, outDir, { local = false } = {}) {
  const url = (loc, lastmod) => `<url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : ''}</url>`;
  const urls = [
    url(`${config.siteUrl}/`),
    url(`${config.siteUrl}/tags/`),
    ...posts.map((p) => url(`${config.siteUrl}/posts/${p.slug}/`, p.updated ?? p.date)),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap);
  const robots = local
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`;
  await fs.writeFile(path.join(outDir, 'robots.txt'), robots);
}
