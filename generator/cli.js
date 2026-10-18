// ページ生成スクリプトの入口(詳細設計 2.4.1、2.4.2)
import fs from 'node:fs/promises';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXIT_CONTENT, EXIT_OK, EXIT_RUNTIME, GenError, MESSAGES, UsageError } from './errors.js';
import { loadConfig } from './config.js';
import { dirSize, verifyContent } from './verify.js';
import { buildPages } from './pages.js';
import { buildSitemap } from './sitemap.js';
import { copyAssets, copyContent } from './copy.js';

const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * @param {string[]} argv
 * @param {{ repoRoot?: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void, maxBytes?: number }} [options]
 *   テスト用に差し替えられる値
 * @returns {Promise<number>} 終了コード
 */
export async function main(argv, options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_ROOT;
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    const args = parseCliArgs(argv, repoRoot);
    const assetsDir = path.join(repoRoot, 'src', 'assets');
    const config = await loadConfig(args.config, args.local, { assetsDir });
    const content = await verifyContent(args.content, { assetsDir, maxBytes: options.maxBytes });

    await fs.rm(args.out, { recursive: true, force: true });
    await fs.mkdir(args.out, { recursive: true });
    await copyAssets(assetsDir, args.out);
    await copyContent(args.content, args.out);
    const pageCount = await buildPages(content, config, args.out, { local: args.local });
    await buildSitemap(content.posts, config, args.out, { local: args.local });

    process.stdout.write(`[INFO] 記事 ${content.posts.length} 件、ページ ${pageCount} 件、合計 ${await dirSize(args.out)} バイト\n`);
    return EXIT_OK;
  } catch (e) {
    if (e instanceof GenError) {
      log(`[ERROR] ${e.code} ${MESSAGES[e.code]}`);
      for (const detail of e.details) log(`[ERROR] ${e.code} ${detail}`);
      await writeFailureCode(env, e.code);
      return EXIT_CONTENT;
    }
    if (e instanceof UsageError) {
      log(`[ERROR] 引数が正しくありません(${e.message})`);
    } else {
      log(`[ERROR] D099 ${MESSAGES.D099}(${e?.message ?? e})`);
      if (e?.stack) log(e.stack);
    }
    await writeFailureCode(env, 'D099');
    return EXIT_RUNTIME;
  }
}

async function writeFailureCode(env, code) {
  if (env.FAILURE_CODE_FILE) await fs.writeFile(env.FAILURE_CODE_FILE, `${code}\n`).catch(() => {});
}

function parseCliArgs(argv, repoRoot) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        content: { type: 'string' },
        out: { type: 'string' },
        config: { type: 'string' },
        local: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    throw new UsageError(e.message);
  }
  for (const key of ['content', 'out', 'config']) {
    if (!values[key]) throw new UsageError(`--${key} は必須です`);
  }
  checkOut(values.out, values.content, repoRoot);
  return { content: values.content, out: path.resolve(values.out), config: values.config, local: values.local };
}

/** 存在しないパスは、存在する最も近い祖先を realpath で解決して残りをつなげる */
export function resolveReal(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...rest);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** `child` が `parent` と同じか、その内側か(パス要素の単位で比べる) */
export function isSameOrInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function checkOut(outArg, contentArg, repoRoot) {
  const out = resolveReal(outArg);
  const root = resolveReal(repoRoot);
  const content = resolveReal(contentArg);
  const allowedInside = ['_site', '.local-site'].map((d) => path.join(root, d));
  if (isSameOrInside(out, root) && !allowedInside.includes(out)) {
    throw new UsageError('--out はリポジトリ直下の _site・.local-site か、リポジトリの外にしてください');
  }
  if (isSameOrInside(root, out)) throw new UsageError('--out にリポジトリの祖先は指定できません');
  if (isSameOrInside(out, content) || isSameOrInside(content, out)) {
    throw new UsageError('--out に --content と重なる場所は指定できません');
  }
  const stat = statSync(out, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) throw new UsageError('--out に既存のファイルは指定できません');
}

function isDirectRun() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = await main(process.argv.slice(2));
}
