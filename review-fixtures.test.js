import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';
import { createReviewGame } from './review-fixtures.js';

test('dense review is a legal complete deck with six numbers and two modifiers per seat', () => {
  const game = createReviewGame('rich');
  assert.equal(game.phase, 'turn');
  assert.deepEqual(game.players.map(p => p.numbers.length), [6, 6, 6]);
  assert.deepEqual(game.players.map(p => p.modifiers.length), [2, 2, 2]);
  assert.deepEqual(game.players.map(p => E.roundScoreFor(p)), [59, 55, 96]);
  assert.equal(game.deck.length, 70);
  const ids = [...game.deck, ...game.players.flatMap(p => [...p.numbers, ...p.modifiers])].map(card => card.id);
  assert.equal(new Set(ids).size, 94);
  assert.equal(E.serializeGame(E.restoreGame(E.serializeGame(game))), E.serializeGame(game));
});

test('target review shows all three legal Freeze targets at maximum hand density', () => {
  const game = createReviewGame('target');
  assert.equal(game.phase, 'targeting');
  assert.deepEqual(game.pendingAction.eligible, [0, 1, 2]);
  E.chooseTarget(game, 2);
  assert.equal(game.players[2].status, 'frozen');
  assert.equal(game.players[2].roundScore, 96);
});

test('Flip 7 review reaches real bonus and round-end through Hit', () => {
  const game = createReviewGame('flip7');
  E.hit(game);
  assert.equal(game.phase, 'roundEnd');
  assert.deepEqual(game.players.map(p => p.total), [85, 55, 96]);
});

test('bust review reaches actual duplicate loss through Hit', () => {
  const game = createReviewGame('bust');
  E.hit(game);
  assert.equal(game.players[0].status, 'busted');
  assert.equal(E.roundScoreFor(game.players[0]), 0);
  assert.equal(game.players[0].bustCard.value, 5);
});

test('forced review emits distinct one-card-at-a-time hands', () => {
  const game = createReviewGame('forced');
  assert.equal(game.pendingAction.kind, 'flip3');
  E.chooseTarget(game, 0);
  const frames = E.takeEvents(game).filter(event => event.t === 'cardResolved');
  assert.deepEqual(frames.map(event => event.snapshot.players[0].numbers.map(card => card.value)), [[1, 4], [1, 4, 6], [1, 4, 6, 8]]);
  assert.equal(game.turnIndex, 1);
  assert.equal(E.roundScoreFor(game.players[0]), 19);
});

for (const scenario of ['secondchance', 'secondchance-forced']) {
  test(`${scenario}: reveal carries the exact discarded pair, never the original number`, () => {
    const game = createReviewGame(scenario);
    const original = game.players[0].numbers[0];
    const shield = game.players[0].secondChance;
    assert.equal(new Set([...game.deck, ...game.players.flatMap(p => [...p.numbers, ...(p.secondChance ? [p.secondChance] : [])]), ...(game.pendingAction ? [game.pendingAction.card] : [])].map(c => c.id)).size, 94);
    if (scenario === 'secondchance') E.hit(game);
    else E.chooseTarget(game, 0);
    const events = E.takeEvents(game);
    const used = events.find(event => event.t === 'secondChanceUsed');
    assert.equal(used.card.value, original.value);
    assert.notEqual(used.card.id, original.id);
    assert.equal(used.secondChance.id, shield.id);
    assert.deepEqual(game.discard.map(c => c.id), [used.card.id, shield.id]);
    assert.deepEqual(used.snapshot.players[0].numbers.map(c => c.id), [original.id]);
    assert.equal(used.snapshot.players[0].secondChance, null);
    assert.equal(game.players[0].status, 'active');
    assert.equal(game.players[0].secondChance, null);
    assert.equal(game.turnIndex, 1);
    assert.deepEqual(game.players[0].numbers.map(c => c.value), scenario === 'secondchance' ? [5] : [5, 7, 9]);
    assert.equal(events.some(event => event.t === 'bust'), false);
  });
}

test('opening Freeze waits until all three first cards are face up', () => {
  const game = createReviewGame('opening-freeze');
  assert.equal(game.phase, 'targeting');
  assert.equal(game.pendingAction.kind, 'freeze');
  assert.deepEqual(game.players.map(player => player.numbers.map(card => card.value)), [[], [6], [7]]);
  assert.equal(game.dealResume, null, 'opening deal is complete before targeting begins');
});

test('sole-target review exposes exactly one legal target for Space', () => {
  const game = createReviewGame('sole-target');
  assert.equal(game.phase, 'targeting');
  assert.deepEqual(game.pendingAction.eligible, [2]);
  E.chooseTarget(game, 2);
  assert.equal(game.phase, 'roundEnd');
});
