import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { HOST, serve } from '../generator/serve.js';
import { makeTmp } from './helpers.js';

/** fetch は URL の .. を正規化してしまうため、生のパスで要求する */
function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], location: res.headers.location, body }));
    }).on('error', reject);
  });
}

test('UT-GN-18 ローカル確認用サーバー', async (t) => {
  const base = await makeTmp(t);
  const site = path.join(base, 'site');
  await fs.mkdir(path.join(site, 'posts', 'x'), { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), 'top');
  await fs.writeFile(path.join(site, '404.html'), 'nf');
  await fs.writeFile(path.join(site, 'posts', 'x', 'index.html'), 'post');
  await fs.writeFile(path.join(base, 'package.json'), 'secret');
  const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain', ico: 'image/x-icon' };
  for (const ext of Object.keys(types)) await fs.writeFile(path.join(site, `f.${ext}`), 'x');

  const server = await serve(site, 0);
  t.after(() => new Promise((r) => server.close(r)));
  const { address, port } = server.address();
  assert.equal(address, HOST);
  assert.equal(HOST, '127.0.0.1');

  assert.deepEqual([(await get(port, '/')).status, (await get(port, '/')).body], [200, 'top']);
  assert.equal((await get(port, '/posts/x/')).body, 'post');
  const redirect = await get(port, '/posts/x');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.location, '/posts/x/');
  for (const p of ['/nothing', '/../package.json', '/%2e%2e/package.json', '/posts/%2E%2E/%2E%2E/package.json']) {
    const res = await get(port, p);
    assert.equal(res.status, 404, p);
    assert.equal(res.body, 'nf', p);
  }
  for (const [ext, type] of Object.entries(types)) {
    assert.ok((await get(port, `/f.${ext}`)).type.startsWith(type), ext);
  }
});
