// site.config.json の読み込みと検証(詳細設計 3.5)
import fs from 'node:fs/promises';
import path from 'node:path';
import { GenError } from './errors.js';

export const LOCAL_SITE_URL = 'http://localhost:8080';
const REQUIRED = ['siteName', 'siteUrl', 'description', 'defaultOgImage', 'contentRepo', 'analyticsToken', 'copyright'];
const CONTROL = /\p{Cc}/u;

const len = (s) => [...s].length;

/**
 * @param {string} configPath
 * @param {boolean} local `--local` のとき siteUrl を localhost に置き換える
 * @param {{ assetsDir: string }} options defaultOgImage の存在を確かめる場所
 */
export async function loadConfig(configPath, local, { assetsDir }) {
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (e) {
    throw new GenError('D006', [e.code === 'ENOENT' ? '設定ファイルがありません' : '設定ファイルを JSON として読めません']);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new GenError('D006', ['設定ファイルはオブジェクトで書いてください']);
  }

  const problems = [];
  for (const key of REQUIRED) {
    if (typeof config[key] !== 'string' || config[key] === '') problems.push(`${key} がないか、文字列ではありません`);
  }
  if (problems.length > 0) throw new GenError('D006', problems);

  const { siteName, siteUrl, description, defaultOgImage, contentRepo, analyticsToken, copyright } = config;
  if (len(siteName) > 50 || CONTROL.test(siteName)) problems.push('siteName は 1〜50 文字');
  if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(siteUrl) || siteUrl.endsWith('/')) {
    problems.push('siteUrl は https:// で始め、末尾に / を付けないでください');
  }
  if (len(description) > 200 || CONTROL.test(description)) problems.push('description は 1〜200 文字');
  if (!/^[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(defaultOgImage)) {
    problems.push('defaultOgImage は src/assets/ 内の png/jpg/jpeg のファイル名');
  } else {
    const stat = await fs.stat(path.join(assetsDir, defaultOgImage)).catch(() => null);
    if (!stat?.isFile()) problems.push('defaultOgImage のファイルが src/assets/ にありません');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(contentRepo)) problems.push('contentRepo は <owner>/<repo>');
  if (!/^[A-Za-z0-9]{1,64}$/.test(analyticsToken)) problems.push('analyticsToken は英数字 1〜64 文字');
  if (CONTROL.test(copyright)) problems.push('copyright に改行・制御文字は使えません');
  if (problems.length > 0) throw new GenError('D006', problems);

  return {
    siteName,
    siteUrl: local ? LOCAL_SITE_URL : siteUrl,
    description,
    defaultOgImage,
    contentRepo,
    analyticsToken,
    copyright,
  };
}
