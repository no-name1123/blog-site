// FN-016 ローカル確認用の静的ファイルサーバー(詳細設計 2.8)。127.0.0.1 だけで待ち受ける。
import http from 'node:http';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOST = '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const contentType = (file) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * @param {string} dir 配信するディレクトリ
 * @param {number} port 0 なら空いている番号
 * @returns {Promise<http.Server>}
 */
export function serve(dir, port) {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    const send = async (status, file) => {
      try {
        const body = await fs.readFile(file);
        res.writeHead(status, { 'Content-Type': contentType(file) });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      }
    };
    const notFound = () => send(404, path.join(root, '404.html'));

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return notFound();
    }
    // 生の要求とデコード後の両方で .. を拒む(%2e%2e も含めて配信先の外に出さない)
    if (req.url.includes('..') || pathname.split('/').includes('..') || pathname.includes('\0')) return notFound();

    const file = path.join(root, pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return notFound();
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        // 記事ページは相対パスで body.html を読むため、公開サーバ(nginx)と同じく末尾に / を付けて転送する
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      const index = path.join(file, 'index.html');
      return (await fs.stat(index).catch(() => null))?.isFile() ? send(200, index) : notFound();
    }
    if (stat?.isFile()) return send(200, file);
    return notFound();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

function isDirectRun() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const [dir = '.local-site', port = '8080'] = process.argv.slice(2);
  const server = await serve(dir, Number(port));
  const { port: actual } = server.address();
  process.stdout.write(`http://localhost:${actual}/ で配信しています(Ctrl+C で終了)\n`);
}
