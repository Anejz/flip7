import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLeaderboard, recordGame } from './leaderboard.js';

test('records a complete table and sorts the winner first', () => {
  const rows = recordGame([], [
    { name: 'Alex', total: 173 },
    { name: 'Sam', total: 205 },
    { name: 'Taylor', total: 198 },
  ], 1);
  assert.deepEqual(rows, [
    { name: 'Sam', games: 1, wins: 1, points: 205, best: 205 },
    { name: 'Taylor', games: 1, wins: 0, points: 198, best: 198 },
    { name: 'Alex', games: 1, wins: 0, points: 173, best: 173 },
  ]);
});

test('the same trimmed case-insensitive name accumulates lifetime stats', () => {
  const first = recordGame([], [
    { name: 'Alex', total: 173 }, { name: 'Sam', total: 205 }, { name: 'Taylor', total: 198 },
  ], 1);
  const rows = recordGame(first, [
    { name: ' alex ', total: 214 }, { name: 'Sam', total: 190 }, { name: 'Taylor', total: 101 },
  ], 0);
  assert.deepEqual(rows.find(row => row.name === 'alex'), { name: 'alex', games: 2, wins: 1, points: 387, best: 214 });
  assert.deepEqual(rows.find(row => row.name === 'Sam'), { name: 'Sam', games: 2, wins: 1, points: 395, best: 205 });
});

test('sanitizes corrupt stored data without mutating it', () => {
  const input = [
    { name: ' Alex ', games: 2, wins: 9, points: 320, best: 201 },
    { name: 'alex', games: 99, wins: 99, points: 999, best: 999 },
    { name: '', games: 1 },
    { name: 'Sam', games: -2, wins: -1, points: -7, best: -3 },
    null,
  ];
  const copy = structuredClone(input);
  assert.deepEqual(cleanLeaderboard(input), [
    { name: 'Alex', games: 2, wins: 2, points: 320, best: 201 },
    { name: 'Sam', games: 0, wins: 0, points: 0, best: 0 },
  ]);
  assert.deepEqual(input, copy);
});
