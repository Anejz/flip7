import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

let server;
let base;
before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, FLIP7_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
});
after(() => server?.kill());

test('local server serves game with correct MIME and no stale cache', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /Flip 7/);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css))"/g)) {
    const asset = await fetch(new URL(match[1], base));
    assert.equal(asset.status, 200, `Missing entry asset ${match[1]}`);
    assert.match(asset.headers.get('content-type'), /text\/(javascript|css)/);
  }
});

test('server exposes public rules and excludes private development files', async () => {
  assert.equal((await fetch(`${base}/RULES.md`)).status, 200);
  assert.equal((await fetch(`${base}/README.md`)).status, 200);
  for (const path of ['/.git/config', '/.env', '/package.json', '/server.mjs', '/progress.json', '/evidence/browser-match.json']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
});

test('server rejects external file traversal and non-read methods', async () => {
  assert.equal((await fetch(`${base}/..%2f..%2f..%2fetc/passwd`)).status, 403);
  assert.equal((await fetch(`${base}/missing.html`)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/evidence/`)).status, 404);
});
