// 変換結果・静的ファイルのコピー(詳細設計 2.4.2 の 4)
import fs from 'node:fs/promises';
import path from 'node:path';

/** `<content>/posts/*`・`<content>/data/*` をコピーする。build-info.json と .git はコピーしない */
export async function copyContent(contentDir, outDir) {
  for (const dir of ['posts', 'data']) {
    const from = path.join(contentDir, dir);
    if (await fs.stat(from).catch(() => null)) {
      await fs.cp(from, path.join(outDir, dir), { recursive: true, dereference: true });
    }
  }
}

/** `src/assets` を `<out>/assets` にコピーする */
export async function copyAssets(srcDir, outDir) {
  await fs.cp(srcDir, path.join(outDir, 'assets'), { recursive: true, dereference: true });
}
