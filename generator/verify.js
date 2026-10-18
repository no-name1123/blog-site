// FN-008 変換結果の整合性の確認(詳細設計 2.4.3)。確認の順は D001 → D002 → D004 → D005。
import fs from 'node:fs/promises';
import path from 'node:path';
import { GenError } from './errors.js';

export const SITE_MAX_BYTES = 1_073_741_824;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT = /^([0-9a-f]{40}|local)$/;

const isString = (v) => typeof v === 'string';
const isStringOrNull = (v) => v === null || isString(v);
const isStringArray = (v) => Array.isArray(v) && v.every(isString);

async function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch (e) {
    return { ok: false, missing: e.code === 'ENOENT' };
  }
}

const isFile = async (p) => (await fs.stat(p).catch(() => null))?.isFile() === true;

/**
 * @param {string} contentDir
 * @param {{ assetsDir: string, maxBytes?: number }} options
 * @returns {Promise<{ buildInfo: object, posts: object[], totalBytes: number }>}
 */
export async function verifyContent(contentDir, { assetsDir, maxBytes = SITE_MAX_BYTES }) {
  const dirStat = await fs.stat(contentDir).catch(() => null);
  if (!dirStat?.isDirectory()) throw new GenError('D001', ['content ディレクトリがありません']);
  const info = await readJson(path.join(contentDir, 'build-info.json'));
  if (!info.ok && info.missing) throw new GenError('D001', ['build-info.json がありません']);

  // D002
  const b = info.value;
  if (!info.ok || typeof b !== 'object' || b === null
    || b.formatVersion !== 1 || !isString(b.sourceCommit) || !COMMIT.test(b.sourceCommit)
    || !isString(b.builtAt) || !Number.isInteger(b.postCount) || !Number.isInteger(b.totalBytes)) {
    throw new GenError('D002', ['build-info.json の形式が正しくありません']);
  }

  // D004
  const problems = [];
  const postsJson = await readJson(path.join(contentDir, 'data', 'posts.json'));
  const searchJson = await readJson(path.join(contentDir, 'data', 'search-index.json'));
  if (!postsJson.ok) problems.push(postsJson.missing ? 'posts.json がありません' : 'posts.json を JSON として読めません');
  if (!searchJson.ok) problems.push(searchJson.missing ? 'search-index.json がありません' : 'search-index.json を JSON として読めません');
  if (problems.length > 0) throw new GenError('D004', problems);

  const posts = checkList(postsJson.value, 'posts.json', checkPostEntry, problems);
  const search = checkList(searchJson.value, 'search-index.json', checkSearchEntry, problems);
  if (problems.length > 0) throw new GenError('D004', problems);

  for (const post of posts) {
    if (!(await isFile(path.join(contentDir, 'posts', post.slug, 'body.html')))) {
      problems.push(`posts.json の記事 ${post.slug} の body.html がありません`);
    }
    if (post.ogImage && !(await isFile(path.join(contentDir, post.ogImage)))) {
      problems.push(`posts.json の記事 ${post.slug} の ogImage がありません`);
    }
  }
  const a = posts.map((p) => p.slug).sort();
  const s = search.map((p) => p.slug).sort();
  if (a.length !== s.length || a.some((slug, i) => slug !== s[i])) {
    problems.push('posts.json と search-index.json のスラッグが一致しません');
  }
  if (problems.length > 0) throw new GenError('D004', problems);

  // D005:.git には同じ画像の blob が入るため数えない
  const totalBytes = (await dirSize(path.join(contentDir, 'posts')))
    + (await dirSize(path.join(contentDir, 'data')))
    + (await dirSize(assetsDir));
  if (totalBytes > maxBytes) throw new GenError('D005', [`合計 ${totalBytes} バイト`]);

  return { buildInfo: b, posts, totalBytes };
}

function checkList(json, name, checkEntry, problems) {
  if (typeof json !== 'object' || json === null || json.formatVersion !== 1 || !Array.isArray(json.posts)) {
    problems.push(`${name} の形式が正しくありません`);
    return [];
  }
  const seen = new Set();
  json.posts.forEach((entry, i) => {
    const bad = checkEntry(entry);
    if (bad) {
      // スラッグが壊れている可能性があるため、位置と項目名だけを出す
      problems.push(`${name} の ${i + 1} 件目の ${bad} が正しくありません`);
    } else if (seen.has(entry.slug)) {
      problems.push(`${name} の記事 ${entry.slug} が重複しています`);
    } else {
      seen.add(entry.slug);
    }
  });
  return json.posts;
}

function checkPostEntry(p) {
  if (typeof p !== 'object' || p === null) return '記事';
  if (!isString(p.slug) || !SLUG.test(p.slug)) return 'slug';
  for (const key of ['title', 'category', 'summary']) if (!isString(p[key])) return key;
  if (!isString(p.date) || !DATE.test(p.date)) return 'date';
  if (!(p.updated === null || (isString(p.updated) && DATE.test(p.updated)))) return 'updated';
  if (!isStringArray(p.tags)) return 'tags';
  const prefix = `/posts/${p.slug}/images/`;
  for (const key of ['ogImage', 'leadImage']) {
    if (!isStringOrNull(p[key]) || (p[key] && !(p[key].startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(p[key].slice(prefix.length))))) return key;
  }
  if ('draft' in p && typeof p.draft !== 'boolean') return 'draft';
  return null;
}

function checkSearchEntry(p) {
  if (typeof p !== 'object' || p === null) return '記事';
  if (!isString(p.slug) || !SLUG.test(p.slug)) return 'slug';
  for (const key of ['title', 'date', 'summary', 'text']) if (!isString(p[key])) return key;
  if (!isStringArray(p.tags)) return 'tags';
  return null;
}

/** ディレクトリ配下のファイルの合計バイト数(ディレクトリがなければ 0) */
export async function dirSize(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isFile()) total += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}
