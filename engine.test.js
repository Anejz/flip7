import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';

let id = 1000;
const number = value => ({ id: id++, type: 'number', value });
const action = action => ({ id: id++, type: 'action', action });
const modifier = bonus => ({ id: id++, type: 'modifier', mod: `+${bonus}`, bonus });
const double = () => ({ id: id++, type: 'modifier', mod: 'x2' });
const names = ['Ada', 'Bea', 'Cai'];
const values = player => player.numbers.map(card => card.value);

function fixture(cards, { start = true } = {}) {
  const g = E.createGame(names, { seed: 123, deck: cards.slice().reverse() });
  if (start) E.startRound(g);
  return g;
}

function forceThree(cards) {
  const g = fixture([number(1), number(2), number(3), action('flip3'), ...cards]);
  E.hit(g);
  return g;
}

test('classic deck: 94 distinct identities and exact face frequencies', () => {
  const deck = E.buildDeck();
  assert.equal(deck.length, 94);
  assert.equal(new Set(deck.map(card => card.id)).size, 94);
  for (let value = 0; value <= 12; value++) {
    assert.equal(deck.filter(card => card.type === 'number' && card.value === value).length, value || 1);
  }
  assert.deepEqual(deck.filter(card => card.type === 'modifier').map(card => card.mod), ['+2', '+4', '+6', '+8', '+10', 'x2']);
  for (const kind of ['freeze', 'flip3', 'second_chance']) {
    assert.equal(deck.filter(card => card.action === kind).length, 3);
  }
});

test('seeded shuffling and RNG state are reproducible', () => {
  assert.deepEqual(E.createGame(names, { seed: 42 }).deck, E.createGame(names, { seed: 42 }).deck);
  assert.notDeepEqual(E.createGame(names, { seed: 42 }).deck, E.createGame(names, { seed: 43 }).deck);
  const rng = E.makeRng(42);
  rng(); rng();
  const resumed = E.makeRng(rng.getState());
  assert.deepEqual(Array.from({ length: 20 }, rng), Array.from({ length: 20 }, resumed));
});

test('initial order and ordinary turns start left of dealer', () => {
  const g = fixture([number(1), number(2), number(3), number(4)]);
  assert.deepEqual(g.players.map(values), [[3], [1], [2]]);
  assert.equal(g.turnIndex, 1);
  E.hit(g);
  assert.equal(g.turnIndex, 2);
  E.stay(g);
  assert.equal(g.turnIndex, 0);
  E.stay(g);
  assert.equal(g.turnIndex, 1);
});

test('house opening deals all three first cards before Freeze resolves', () => {
  const g = fixture([action('freeze'), number(9), number(8)]);
  assert.equal(g.phase, 'targeting');
  assert.equal(g.deck.length, 0);
  assert.deepEqual(values(g.players[0]), [8]);
  assert.deepEqual(values(g.players[2]), [9]);
  E.chooseTarget(g, 2);
  assert.equal(g.players[2].status, 'frozen');
  assert.equal(g.players[2].roundScore, 9);
  assert.equal(g.turnIndex, 1);
  assert.equal(E.canStay(g), false);
  assert.throws(() => E.stay(g), /no cards/);
});

test('house opening resolves Flip Three only after every first card', () => {
  const g = fixture([action('flip3'), number(4), number(5), number(6), number(7), number(8)]);
  E.chooseTarget(g, 2);
  assert.deepEqual(values(g.players[2]), [4, 6, 7, 8]);
  assert.deepEqual(values(g.players[0]), [5]);
  assert.deepEqual(values(g.players[1]), []);
  assert.equal(g.turnIndex, 1);
  assert.equal(E.canStay(g), false);
});

test('stay eligibility: zero is a card, as are modifiers and Second Chance', () => {
  for (const card of [number(0), modifier(10), double(), action('second_chance')]) {
    const g = fixture([card, number(2), number(3)]);
    assert.equal(E.canStay(g), true);
    E.stay(g);
    assert.equal(g.players[1].status, 'stayed');
  }
});

test('illegal commands and targets fail without mutating state', () => {
  const g = fixture([number(1), number(2), number(3), action('freeze')]);
  assert.throws(() => E.startRound(g));
  assert.throws(() => E.nextRound(g));
  assert.throws(() => E.chooseTarget(g, 0));
  E.hit(g);
  const before = E.serializeGame(g);
  assert.throws(() => E.hit(g));
  assert.throws(() => E.stay(g));
  assert.throws(() => E.chooseTarget(g, -1));
  assert.throws(() => E.chooseTarget(g, '1'));
  assert.equal(E.serializeGame(g), before);
});

test('Freeze banks modifiers, excludes inactive players, and may target self', () => {
  const g = fixture([modifier(10), number(2), number(3), action('freeze')]);
  E.hit(g);
  E.chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'frozen');
  assert.equal(g.players[1].roundScore, 10);
  assert.equal(g.turnIndex, 2);
  E.stay(g); E.stay(g);
  assert.equal(g.players[1].total, 10);
});

test('sole active player must target themself', () => {
  const g = fixture([number(1), number(2), number(3), number(4), action('freeze')]);
  E.hit(g); E.stay(g); E.stay(g); E.hit(g);
  assert.deepEqual(g.pendingAction.eligible, [1]);
  assert.throws(() => E.chooseTarget(g, 0));
  E.chooseTarget(g, 1);
  assert.equal(g.phase, 'roundEnd');
});

test('a passed Flip Three returns to original drawer clockwise successor, not target', () => {
  const g = forceThree([number(4), modifier(2), number(5)]);
  E.chooseTarget(g, 0);
  assert.deepEqual(values(g.players[0]), [3, 4, 5]);
  assert.equal(g.players[0].modifiers.length, 1);
  assert.equal(g.turnIndex, 2);
});

for (const position of [1, 2, 3]) {
  test(`Flip Three bust on forced card ${position} stops without another draw`, () => {
    const cards = Array.from({ length: position - 1 }, (_, i) => number(i + 4));
    cards.push(number(1), number(12));
    const g = forceThree(cards);
    E.chooseTarget(g, 1);
    assert.equal(g.players[1].status, 'busted');
    assert.equal(g.deck.length, 1);
    assert.equal(g.deck[0].value, 12);
    assert.equal(g.turnIndex, 2);
  });

  test(`Flip Seven on forced card ${position} stops every player immediately`, () => {
    const cards = Array.from({ length: position }, (_, i) => number(7 - position + i));
    cards.push(number(12));
    const g = forceThree(cards);
    g.players[1].numbers = Array.from({ length: 7 - position }, (_, i) => number(i));
    E.chooseTarget(g, 1);
    assert.equal(g.phase, 'roundEnd');
    assert.equal(g.deck.length, 1);
    assert.equal(g.players[1].roundScore, 21 + 15);
    assert.equal(g.players[0].roundScore, 3);
    assert.equal(g.players[2].roundScore, 2);
  });
}

test('deferred Freeze counts toward three but waits until all three complete', () => {
  const g = forceThree([action('freeze'), number(4), number(5)]);
  E.chooseTarget(g, 1);
  assert.equal(g.phase, 'targeting');
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.deepEqual(values(g.players[1]), [1, 4, 5]);
  E.chooseTarget(g, 2);
  assert.equal(g.turnIndex, 0);
});

test('a bust discards only the current forced batch unresolved actions', () => {
  const freeze = action('freeze');
  const g = forceThree([freeze, number(1), number(12)]);
  E.chooseTarget(g, 1);
  assert.equal(g.pendingAction, null);
  assert.ok(g.discard.some(card => card.id === freeze.id));
  assert.equal(g.deck.length, 1);
  assert.equal(g.players.filter(player => player.status === 'frozen').length, 0);
});

test('nested recipient bust cannot erase original successful batch Freeze', () => {
  const g = forceThree([action('flip3'), action('freeze'), number(4), number(2), number(12)]);
  E.chooseTarget(g, 1);
  assert.equal(g.pendingAction.kind, 'flip3');
  E.chooseTarget(g, 2);
  assert.equal(g.players[2].status, 'busted');
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.equal(g.pendingAction.chooser, 1);
  assert.deepEqual(g.pendingAction.eligible, [0, 1]);
  E.chooseTarget(g, 0);
  assert.equal(g.players[0].status, 'frozen');
  assert.equal(g.turnIndex, 1);
});

test('nested batches resolve fully before remaining parent deferred cards', () => {
  const g = forceThree([
    action('flip3'), action('freeze'), number(4),
    action('freeze'), number(5), number(6),
  ]);
  E.chooseTarget(g, 1);
  E.chooseTarget(g, 2);
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.equal(g.pendingAction.chooser, 2);
  E.chooseTarget(g, 0);
  assert.equal(g.pendingAction.chooser, 1);
  E.chooseTarget(g, 2);
  assert.equal(g.turnIndex, 1);
});

test('Second Chance acquired during forced draw protects the next duplicate', () => {
  const g = forceThree([action('second_chance'), number(1), number(4)]);
  E.chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'active');
  assert.equal(g.players[1].secondChance, null);
  assert.deepEqual(values(g.players[1]), [1, 4]);
  assert.equal(g.discard.length, 2);
});

test('Second Chance use ends an ordinary hit without replacement', () => {
  const g = fixture([action('second_chance'), number(2), number(3), number(4), number(2), number(4), number(12)]);
  E.hit(g); E.hit(g); E.stay(g); E.hit(g);
  assert.equal(g.players[1].status, 'active');
  assert.equal(g.players[1].secondChance, null);
  assert.equal(g.deck.length, 1);
  assert.equal(g.turnIndex, 1);
});

test('duplicate Second Chance transfer pauses and resumes the same forced batch', () => {
  const g = forceThree([action('second_chance'), number(1), number(4)]);
  g.players[1].secondChance = action('second_chance');
  E.chooseTarget(g, 1);
  assert.equal(g.pendingAction.kind, 'second_chance');
  assert.deepEqual(g.pendingAction.eligible, [0, 2]);
  assert.equal(g.flip3.remaining, 2);
  E.chooseTarget(g, 2);
  assert.ok(g.players[2].secondChance);
  assert.equal(g.players[1].secondChance, null);
  assert.equal(g.players[1].status, 'active');
  assert.deepEqual(values(g.players[1]), [1, 4]);
});

test('duplicate Second Chance discards when all other active players already have one', () => {
  const extra = action('second_chance');
  const g = fixture([action('second_chance'), action('second_chance'), action('second_chance'), extra]);
  E.hit(g);
  assert.equal(g.pendingAction, null);
  assert.ok(g.discard.some(card => card.id === extra.id));
  assert.equal(g.players.filter(player => player.secondChance).length, 3);
});

test('unused Second Chances are discarded on round end and never carried over', () => {
  const shield = action('second_chance');
  const g = fixture([shield, number(2), number(3), number(4), number(5), number(6)]);
  E.stay(g); E.stay(g); E.stay(g);
  assert.ok(g.discard.some(card => card.id === shield.id));
  assert.equal(g.players[1].secondChance, null);
  E.nextRound(g);
  assert.equal(g.players[1].secondChance, null);
});

test('scoring order: x2 applies only to numbers, then bonuses, then Flip Seven +15', () => {
  const p = { status: 'active', numbers: [3, 11, 5, 7, 10].map(number), modifiers: [] };
  assert.equal(E.roundScoreFor(p), 36);
  p.modifiers = [double()];
  assert.equal(E.roundScoreFor(p), 72);
  p.modifiers = [modifier(10)];
  assert.equal(E.roundScoreFor(p), 46);
  p.modifiers = [double(), modifier(10)];
  assert.equal(E.roundScoreFor(p, { flip7: true }), 97);
  p.status = 'busted';
  assert.equal(E.roundScoreFor(p, { flip7: true }), 0);
});

test('no-number hands score additive modifiers, while x2 alone scores zero', () => {
  const p = { status: 'active', numbers: [], modifiers: [double()] };
  assert.equal(E.roundScoreFor(p), 0);
  p.modifiers.push(modifier(10), modifier(4));
  assert.equal(E.roundScoreFor(p), 14);
});

test('200 threshold is checked only at round end; highest total, not first crosser, wins', () => {
  const g = fixture([number(2), number(12), number(3)]);
  g.players[1].total = 198;
  g.players[2].total = 195;
  E.stay(g);
  assert.equal(g.phase, 'turn');
  assert.equal(g.players[1].total, 198);
  E.stay(g); E.stay(g);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerIndex, 2);
  assert.deepEqual(g.players.map(player => player.total), [3, 200, 207]);
});

test('top tie over 200 gives everyone another round and rotates dealer', () => {
  const g = fixture([number(5), number(5), number(3), number(9), number(10), number(11)]);
  g.players[1].total = 195;
  g.players[2].total = 195;
  E.stay(g); E.stay(g); E.stay(g);
  assert.equal(g.phase, 'roundEnd');
  assert.equal(g.winnerIndex, null);
  assert.equal(g.dealerIndex, 1);
  const tie = E.takeEvents(g).find(event => event.t === 'tiebreak');
  assert.deepEqual(tie.players, [1, 2]);
  E.nextRound(g);
  assert.equal(g.round, 2);
  assert.equal(g.turnIndex, 2);
  assert.ok(g.players.every(player => player.status === 'active'));
  E.stay(g); E.stay(g); E.stay(g);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerIndex, 1);
});

test('round end leaves undealt cards in order for the new dealer', () => {
  const rest = [number(8), number(9), number(10)];
  const g = fixture([number(1), number(2), number(3), ...rest]);
  E.stay(g); E.stay(g); E.stay(g);
  assert.deepEqual(g.deck, rest.slice().reverse());
  E.nextRound(g);
  assert.deepEqual(values(g.players[2]), [8]);
  assert.deepEqual(values(g.players[0]), [9]);
  assert.deepEqual(values(g.players[1]), [10]);
});

test('mid-round shuffle cannot return resolved actions, bust duplicate, or held cards', () => {
  const played = action('flip3');
  const duplicate = number(1);
  const recycle = modifier(10);
  const g = fixture([number(1), number(2), number(3), played, duplicate]);
  g.discard.push(recycle);
  E.hit(g); E.chooseTarget(g, 1);
  assert.equal(g.deck.length, 0);
  assert.deepEqual(g.discard, [recycle]);
  assert.equal(g.players[1].bustCard.id, duplicate.id);
  assert.equal(g.players[1].actions[0].id, played.id);
  E.hit(g);
  assert.equal(g.players[2].modifiers[0].id, recycle.id);
  assert.equal(g.players[1].bustCard.id, duplicate.id);
  assert.equal(g.discard.length, 0);
});

test('last draw does not shuffle early; the next empty-pile draw automatically shuffles only discards', () => {
  const finalCard = number(4);
  const recyclable = modifier(10);
  const g = fixture([number(1), number(2), number(3), finalCard]);
  g.discard.push(recyclable);
  E.takeEvents(g);
  const rngBefore = g.rng.getState();
  E.hit(g);
  assert.equal(g.deck.length, 0);
  assert.equal(g.rng.getState(), rngBefore);
  assert.deepEqual(g.discard, [recyclable]);
  assert.equal(E.takeEvents(g).some(event => event.t === 'shuffle'), false);
  const heldIds = g.players.flatMap(player => player.numbers.map(card => card.id));
  E.hit(g);
  const events = E.takeEvents(g);
  assert.equal(events.filter(event => event.t === 'shuffle').length, 1);
  assert.ok(events.findIndex(event => event.t === 'shuffle') < events.findIndex(event => event.t === 'flip'));
  assert.deepEqual(g.players.flatMap(player => player.numbers.map(card => card.id)), heldIds);
  assert.equal(g.players[2].modifiers[0].id, recyclable.id);
  assert.equal(g.discard.length, 0);
});

test('public snapshots cannot reveal deck order and do not alias engine state', () => {
  const g = fixture([number(1), number(2), number(3)]);
  const snapshot = E.publicSnapshot(g);
  assert.equal(snapshot.deckSize, 0);
  for (const forbidden of ['deck', 'discard', 'rng', 'rngState', 'events']) assert.equal(forbidden in snapshot, false);
  snapshot.players[1].numbers[0].value = 99;
  assert.equal(g.players[1].numbers[0].value, 1);
});

test('each resolved card has its own chronological public snapshot', () => {
  const g = fixture([number(1), number(2), number(3)]);
  const events = E.takeEvents(g).filter(event => event.t === 'cardResolved');
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event.snapshot.players.map(player => player.numbers.length)), [[0, 1, 0], [0, 1, 1], [1, 1, 1]]);
  assert.deepEqual(events.map(event => event.snapshot.deckSize), [2, 1, 0]);
  g.players[1].numbers.push(number(12));
  assert.equal(events[0].snapshot.players[1].numbers.length, 1);
});

// This is a physical-card check, not merely a length check. Terminal hands are
// display caches: the same cards have already moved into discard for next round.
function assertMatchInvariants(g, previousTotals) {
  const terminal = g.phase === 'roundEnd' || g.phase === 'gameOver';
  const cards = [...g.deck, ...g.discard];
  if (!terminal) {
    for (const p of g.players) cards.push(...p.numbers, ...p.modifiers, ...p.actions, ...[p.secondChance, p.bustCard].filter(Boolean));
    if (g.pendingAction) cards.push(g.pendingAction.card);
    cards.push(...g.actionQueue.map(item => item.card), ...(g.flip3?.queued ?? []).map(item => item.card));
  }
  assert.equal(cards.length, 94);
  assert.equal(new Set(cards.map(card => card.id)).size, 94, 'each physical card has exactly one owner');
  assert.deepEqual(cards.map(card => card.id).sort((a, b) => a - b), Array.from({ length: 94 }, (_, i) => i));
  for (const p of g.players) {
    assert.equal(new Set(values(p)).size, p.numbers.length);
    assert.ok(p.numbers.length <= 7);
    assert.ok(Number.isInteger(p.total) && p.total >= previousTotals[p.index]);
    if (!terminal) assert.equal(p.total, previousTotals[p.index]);
    if (p.status === 'busted') assert.equal(E.roundScoreFor(p), 0);
  }
  if (g.phase === 'turn') assert.equal(g.players[g.turnIndex].status, 'active');
  if (g.phase === 'targeting') {
    assert.ok(g.pendingAction.eligible.length > 0);
    const eligible = g.players.filter(p => p.status === 'active' && (g.pendingAction.kind !== 'second_chance' || (p.index !== g.pendingAction.chooser && !p.secondChance))).map(p => p.index);
    assert.deepEqual(g.pendingAction.eligible, eligible);
  }
  if (terminal) {
    for (const p of g.players) {
      const sum = p.numbers.reduce((total, card) => total + card.value, 0);
      const bonus = p.modifiers.reduce((total, card) => total + (card.bonus ?? 0), 0);
      const score = p.status === 'busted' ? 0 : sum * (p.modifiers.some(card => card.mod === 'x2') ? 2 : 1) + bonus + (p.numbers.length === 7 ? 15 : 0);
      assert.equal(p.roundScore, score);
      assert.equal(p.total, previousTotals[p.index] + score);
    }
  }
}

function command(g, rng, policy) {
  if (g.phase === 'roundStart') return { kind: 'startRound' };
  if (g.phase === 'roundEnd') return { kind: 'nextRound' };
  if (g.phase === 'targeting') return { kind: 'chooseTarget', target: g.pendingAction.eligible[Math.floor(rng() * g.pendingAction.eligible.length)] };
  assert.equal(g.phase, 'turn');
  const score = E.roundScoreFor(g.players[g.turnIndex]);
  const threshold = [15, 25, 35, 45][policy];
  return { kind: E.canStay(g) && (score >= threshold || rng() < 0.12) ? 'stay' : 'hit' };
}

test('300 seeded complete matches preserve cards, legal state, independent scoring, and winner', t => {
  let shuffles = 0;
  let actions = 0;
  let flipSevens = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const g = E.createGame(names, { seed });
    const rng = E.makeRng(seed ^ 0x5eed);
    let totals = [0, 0, 0];
    let steps = 0;
    while (g.phase !== 'gameOver' && steps++ < 10000) {
      if (g.phase === 'roundEnd') totals = g.players.map(p => p.total);
      const move = command(g, rng, seed % 4);
      E[move.kind](g, move.target);
      assertMatchInvariants(g, totals);
      const events = E.takeEvents(g);
      shuffles += events.filter(event => event.t === 'shuffle').length;
      actions += events.filter(event => event.t === 'targeting').length;
      flipSevens += events.filter(event => event.t === 'flip7').length;
    }
    assert.equal(g.phase, 'gameOver', `seed ${seed} terminated`);
    const winner = g.players[g.winnerIndex];
    assert.ok(winner.total >= 200);
    assert.ok(g.players.every(p => p.index === winner.index || p.total < winner.total));
  }
  t.diagnostic(`300 complete games: ${shuffles} reshuffles, ${actions} targeting decisions, ${flipSevens} Flip Sevens`);
  assert.ok(shuffles > 0, 'actual discard recycling exercised');
  assert.ok(actions > 300, 'actual targeting exercised');
  assert.ok(flipSevens > 0, 'actual Flip Sevens exercised');
});

test('30 matches resume at every decision with identical future shuffles and final results', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const uninterrupted = E.createGame(names, { seed });
    let resumed = E.restoreGame(E.serializeGame(uninterrupted));
    const rng = E.makeRng(seed ^ 9876);
    let steps = 0;
    while (uninterrupted.phase !== 'gameOver' && steps++ < 10000) {
      const move = command(uninterrupted, rng, seed % 4);
      E[move.kind](uninterrupted, move.target);
      E[move.kind](resumed, move.target);
      assert.equal(E.serializeGame(resumed), E.serializeGame(uninterrupted), `seed ${seed}, decision ${steps}`);
      E.takeEvents(uninterrupted); E.takeEvents(resumed);
      resumed = E.restoreGame(E.serializeGame(resumed));
    }
    assert.equal(uninterrupted.phase, 'gameOver');
    assert.equal(resumed.winnerIndex, uninterrupted.winnerIndex);
  }
});

test('malformed or unsupported saves fail clearly', () => {
  for (const saved of ['not json', '{}', 'null', '{"version":999,"game":{}}']) assert.throws(() => E.restoreGame(saved), /save|JSON/i);
  const custom = E.createGame(names, { rng: () => 0.5 });
  assert.throws(() => E.serializeGame(custom), /RNG|random/i);
});

test('corrupted saved players, card identities, and action continuation are rejected at restore', () => {
  const g = E.createGame(names, { seed: 42 });
  const saved = JSON.parse(E.serializeGame(g));
  const corruptions = [
    game => { game.players[0] = null; },
    game => { game.players[0].numbers = [null]; },
    game => { game.deck[0].type = 'unknown'; },
    game => { game.deck[0] = game.deck[1]; },
    game => { game.phase = 'turn'; game.players[game.turnIndex].status = 'stayed'; },
    game => { game.phase = 'targeting'; game.pendingAction = {}; },
    game => { game.dealResume = { order: [1], next: 4 }; },
    game => { game.flip3 = { target: 100, remaining: 3, queued: [] }; },
    game => { game.actionQueue = [{ chooser: 0, card: null }]; },
    game => { game.phase = 'gameOver'; game.winnerIndex = 0; },
  ];
  for (const corrupt of corruptions) {
    const copy = structuredClone(saved);
    corrupt(copy.game);
    assert.throws(() => E.restoreGame(copy), /invalid.*save/);
  }
});
