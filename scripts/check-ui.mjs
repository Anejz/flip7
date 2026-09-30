import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

// Startup/offline contracts only. Rendered behavior is checked by browser review.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
const app = await readFile(resolve(root, 'app.js'), 'utf8');

assert(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(html), 'Startup must not fetch remote scripts or fonts.');
assert(!/url\(["']?https?:/i.test(css), 'The card table must not depend on remote CSS assets.');
for (const path of ['app.js', 'engine.js', 'leaderboard.js', 'review-fixtures.js']) {
  await access(resolve(root, path));
  execFileSync(process.execPath, ['--check', resolve(root, path)], { stdio: 'pipe' });
}
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
  await access(resolve(root, match[1]));
}
assert(app.includes('event.snapshot'), 'Animation must consume authoritative event frames.');
assert(app.includes("case 'cardResolved'"), 'Settled cards must be processed in event order.');
assert(app.includes('reviewMode ? null : storageRead(STORAGE_KEY)'), 'Review fixtures must not read a live game.');
assert(app.includes('if (reviewMode) return;'), 'Review settings must not change live preferences.');
assert(app.includes('function activateSpace()') && app.includes("if (!busy) activateSpace()") && app.includes('/^(INPUT|TEXTAREA|SELECT)$/'), 'Keyboard play must use the contextual Space action and respect editing and animation gates.');
assert(app.includes('recordResultOnce()') && app.includes('resultRecorded'), 'Completed games must be recorded idempotently.');
assert(!app.includes('btn-ready') && !app.includes('let ready'), 'Shared-screen turns must not require a handoff confirmation.');
assert(app.includes('player-controls') && app.includes("if ($('#btn-hit'))"), 'Direct play controls belong in the current hand.');
assert(!html.includes('magic number') && !html.includes('score-track'), 'Keep the table free of promotional copy and duplicate scores.');
console.log('UI startup checks passed: local module graph, offline assets, syntax, event-frame rendering, review isolation, keyboard gates.');
console.log('These are structural checks, not a substitute for the recorded real-browser review.');
