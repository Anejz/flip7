import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeck, createGame, startRound, nextRound, hit, stay, canStay,
  chooseTarget, roundScoreFor, takeEvents, makeRng,
} from './engine.js';

// Independent oracle: revised classic rulebook (Edition 3.1), publisher FAQ,
// and publisher-verified Dized FAQ. Do not derive expected results from RULES.md.
// https://bghub.org/r/flip7.pdf
// https://theop.games/pages/flip-7-faqs
// https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq

function rig(tokens, options = {}) {
  const pool = buildDeck();
  const cards = tokens.map(token => {
    const index = pool.findIndex(card => typeof token === 'number'
      ? card.type === 'number' && card.value === token
      : card.action === token || card.mod === token);
    assert.notEqual(index, -1, `Impossible fixture card: ${token}`);
    return pool.splice(index, 1)[0];
  });
  const g = createGame(['Ada', 'Bea', 'Cy'], { seed: 42, ...options, deck: cards.toReversed() });
  return { g, cards, pool };
}

function normal(tokens) {
  const result = rig([10, 11, 12, ...tokens]);
  startRound(result.g);
  assert.equal(result.g.turnIndex, 1);
  takeEvents(result.g);
  return result;
}

function finishByStaying(g) {
  for (let i = 0; i < 3 && g.phase === 'turn'; i++) stay(g);
  assert.ok(['roundEnd', 'gameOver'].includes(g.phase));
}

function values(p) { return p.numbers.map(card => card.value); }
function flipEvents(g) { return g.events.filter(event => event.t === 'flip'); }

test('classic deck is exactly 94 uniquely identified cards with every official multiplicity', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 94);
  assert.equal(new Set(deck.map(card => card.id)).size, 94);
  for (let value = 0; value <= 12; value++) {
    assert.equal(deck.filter(card => card.type === 'number' && card.value === value).length, value || 1);
  }
  for (const action of ['freeze', 'flip3', 'second_chance']) {
    assert.equal(deck.filter(card => card.action === action).length, 3);
  }
  assert.deepEqual(deck.filter(card => card.type === 'modifier').map(card => card.mod).sort(),
    ['+10', '+2', '+4', '+6', '+8', 'x2']);
});

test('scoring doubles numbers only, then plus modifiers, then the Flip 7 bonus', () => {
  const p = { status: 'active', numbers: [0, 2, 3, 4, 5, 6, 7].map(value => ({ value })),
    modifiers: [{ mod: 'x2' }, { mod: '+10', bonus: 10 }, { mod: '+4', bonus: 4 }] };
  assert.equal(roundScoreFor(p, { flip7: true }), 83);
  p.status = 'busted';
  assert.equal(roundScoreFor(p, { flip7: true }), 0);
});

test('modifier-only and Second Chance-only hands may Stay, score bonuses but not x2', () => {
  const { g } = rig(['+10', 'x2', 'second_chance']);
  startRound(g);
  assert.equal(canStay(g), true);
  finishByStaying(g);
  assert.deepEqual(g.players.map(p => p.total), [0, 10, 0]);
});

test('house opening deals one card to everyone before Freeze targeting', () => {
  const { g } = rig(['freeze', 6, 7]);
  startRound(g);
  assert.equal(g.phase, 'targeting');
  assert.equal(flipEvents(g).length, 3);
  assert.deepEqual(g.pendingAction.eligible, [0, 1, 2]);
  assert.deepEqual(values(g.players[2]), [6]);
  assert.deepEqual(values(g.players[0]), [7]);
  chooseTarget(g, 2);
  assert.equal(g.players[2].status, 'frozen');
  assert.equal(g.players[2].roundScore, 6);
  assert.equal(g.turnIndex, 1);
  assert.equal(canStay(g), false, 'Drawer passed their sole card and must hit');
  assert.throws(() => stay(g));
});

test('house opening resolves Flip Three after all three first cards', () => {
  const { g } = rig(['flip3', 2, 3, 4, 5, 6]);
  startRound(g);
  chooseTarget(g, 2);
  assert.deepEqual(flipEvents(g).map(event => event.player), [1, 2, 0, 2, 2, 2]);
  assert.deepEqual(values(g.players[2]), [2, 4, 5, 6]);
  assert.deepEqual(values(g.players[0]), [3]);
  assert.equal(g.turnIndex, 1);
});

test('opening Flip Three can bust only after its target already received a first card', () => {
  const { g } = rig(['flip3', 2, 8, 2, 9, 10]);
  startRound(g);
  assert.deepEqual(values(g.players[2]), [2]);
  assert.deepEqual(values(g.players[0]), [8]);
  chooseTarget(g, 2);
  assert.equal(g.players[2].status, 'busted');
  assert.deepEqual(values(g.players[0]), [8]);
  assert.equal(g.deck.at(-1).value, 9);
  assert.deepEqual(flipEvents(g).map(event => event.player), [1, 2, 0, 2]);
});

test('opening and forced Freeze wait until every first card has been dealt', () => {
  const { g } = rig(['flip3', 'freeze', 3, 4, 5, 6]);
  startRound(g);
  assert.deepEqual(values(g.players[0]), [3]);
  chooseTarget(g, 1);
  assert.equal(g.phase, 'targeting');
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.equal(flipEvents(g).length, 6);
  chooseTarget(g, 2);
  assert.deepEqual(values(g.players[0]), [3]);
  assert.equal(g.players[2].status, 'frozen');
  assert.equal(g.deck.length, 0);
});

test('three initial self-Freezes end a zero-point round with no normal turns', () => {
  const { g } = rig(['freeze', 'freeze', 'freeze', 2]);
  startRound(g);
  chooseTarget(g, 1);
  chooseTarget(g, 2);
  chooseTarget(g, 0);
  assert.equal(g.phase, 'roundEnd');
  assert.deepEqual(g.players.map(p => p.total), [0, 0, 0]);
  assert.equal(g.events.some(event => event.t === 'turnStart'), false);
  assert.equal(g.deck.at(-1).value, 2);
});

test('multiple opening actions resolve in reveal order after all three first cards', () => {
  const { g } = rig(['flip3', 'freeze', 0, 4, 5, 6]);
  startRound(g);
  assert.equal(g.pendingAction.kind, 'flip3');
  assert.equal(g.pendingAction.chooser, 1);
  assert.deepEqual(values(g.players[0]), [0]);
  chooseTarget(g, 1);
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.equal(g.pendingAction.chooser, 2);
  chooseTarget(g, 2);
  assert.equal(g.phase, 'turn');
  assert.equal(g.turnIndex, 1);
  assert.deepEqual(values(g.players[1]), [4, 5, 6]);
  assert.equal(g.players[2].status, 'frozen');
});

test('normal passed Flip Three resumes clockwise after original DRAWER, not chosen recipient', () => {
  const { g } = normal(['flip3', 2, 3, 4]);
  hit(g); // Bea draws Flip Three.
  chooseTarget(g, 0); // Ada accepts it.
  assert.deepEqual(values(g.players[0]), [12, 2, 3, 4]);
  assert.equal(g.turnIndex, 2, 'Cy follows Bea; Ada receiving forced cards must not move the turn origin');
});

test('a passed Flip Three that busts still resumes after its original drawer', () => {
  const { g } = normal(['flip3', 12, 2, 3]);
  hit(g);
  chooseTarget(g, 0);
  assert.equal(g.players[0].status, 'busted');
  assert.equal(g.turnIndex, 2);
  assert.equal(g.deck.length, 2);
});

test('nested Flip Three chain keeps the original normal-turn continuation', () => {
  const { g } = normal(['flip3', 'flip3', 2, 3, 4, 5, 6]);
  hit(g);
  chooseTarget(g, 0);
  assert.equal(g.pendingAction.chooser, 0);
  chooseTarget(g, 2);
  assert.equal(g.phase, 'turn');
  assert.equal(g.turnIndex, 2, 'Original drawer Bea is followed by Cy, even if Cy just received forced draws');
});

test('nested recipient bust cancels only that batch, not successful ancestor pending actions', () => {
  const { g } = normal(['flip3', 'flip3', 'freeze', 2, 11, 3]);
  hit(g);
  chooseTarget(g, 0); // Ada completes her three: Flip Three, Freeze, 2.
  assert.equal(g.pendingAction.kind, 'flip3');
  chooseTarget(g, 2); // Cy busts immediately on duplicate 11.
  assert.equal(g.players[2].status, 'busted');
  assert.equal(g.phase, 'targeting', 'Ada survived her batch, so her Freeze still has to resolve');
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.equal(g.pendingAction.chooser, 0);
  assert.deepEqual(g.pendingAction.eligible, [0, 1]);
});

test('Freeze waits until all three forced cards are drawn and every card counts', () => {
  const { g } = normal(['flip3', 'freeze', '+4', 2, 3]);
  hit(g);
  chooseTarget(g, 1);
  assert.equal(g.phase, 'targeting');
  assert.equal(g.pendingAction.kind, 'freeze');
  assert.deepEqual(values(g.players[1]), [10, 2]);
  assert.equal(roundScoreFor(g.players[1]), 16);
  assert.equal(g.deck.at(-1).value, 3);
  chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'frozen');
  assert.equal(g.players[1].roundScore, 16);
});

test('bust during a forced batch cancels its own deferred Freeze and unused forced draws', () => {
  const { g } = normal(['flip3', 'freeze', 10, 3]);
  hit(g);
  chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'busted');
  assert.equal(g.phase, 'turn');
  assert.equal(g.pendingAction, null);
  assert.equal(g.deck.at(-1).value, 3);
  assert.equal(g.players.every(p => p.status !== 'frozen'), true);
});

for (const position of [1, 2, 3]) {
  const prefix = ['freeze', '+2'].slice(0, position - 1);
  test(`bust on forced card ${position} stops immediately and voids this batch's deferred actions`, () => {
    const { g } = normal(['flip3', ...prefix, 10, 9]);
    hit(g);
    chooseTarget(g, 1);
    assert.equal(g.players[1].status, 'busted');
    assert.equal(g.phase, 'turn');
    assert.equal(g.pendingAction, null);
    assert.equal(g.deck.at(-1).value, 9);
    assert.equal(flipEvents(g).length, position + 1);
    assert.equal(g.players.some(p => p.status === 'frozen'), false);
  });

  test(`Flip 7 on forced card ${position} stops immediately, including unresolved effects`, () => {
    const { g, pool } = normal(['flip3', ...prefix, 7, 8, 9]);
    // A legal late-round six-number hand, constructed without extra turn noise.
    for (const value of [0, 2, 3, 4, 5]) {
      g.players[1].numbers.push(pool.find(card => card.type === 'number' && card.value === value));
    }
    hit(g);
    chooseTarget(g, 1);
    assert.equal(g.phase, 'roundEnd');
    assert.equal(g.pendingAction, null);
    assert.equal(g.deck.at(-1).value, 8);
    assert.equal(flipEvents(g).length, position + 1);
    assert.deepEqual(g.players.map(p => p.total), [12, position === 3 ? 48 : 46, 11]);
    assert.equal(g.players.some(p => p.status === 'frozen'), false);
  });
}

test('new Second Chance immediately protects a later forced draw and remaining forced cards continue', () => {
  const { g } = normal(['flip3', 'second_chance', 10, 2, 3]);
  hit(g);
  chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'active');
  assert.equal(g.players[1].secondChance, null);
  assert.deepEqual(values(g.players[1]), [10, 2]);
  assert.equal(g.deck.at(-1).value, 3);
  assert.equal(g.discard.filter(card => card.action === 'second_chance').length, 1);
});

test('duplicate Second Chance interrupts forced drawing only for its legal giveaway, then resumes', () => {
  const { g } = rig(['second_chance', 11, 12, 'flip3', 'second_chance', 2, 3, 4]);
  startRound(g);
  hit(g);
  chooseTarget(g, 1);
  assert.equal(g.pendingAction.kind, 'second_chance');
  assert.deepEqual(g.pendingAction.eligible, [0, 2]);
  assert.deepEqual(values(g.players[1]), []);
  chooseTarget(g, 2);
  assert.ok(g.players[1].secondChance);
  assert.ok(g.players[2].secondChance);
  assert.deepEqual(values(g.players[1]), [2, 3]);
  assert.equal(g.deck.at(-1).value, 4);
});

test('second chance cannot be given to an inactive player and no recipient means discard', () => {
  const { g } = rig(['second_chance', 11, 12, 'second_chance']);
  startRound(g);
  g.players[0].status = 'stayed';
  g.players[2].status = 'frozen';
  hit(g);
  assert.equal(g.phase, 'turn');
  assert.equal(g.turnIndex, 1);
  assert.equal(g.discard.filter(card => card.action === 'second_chance').length, 1);
});

test('normal Second Chance use consumes a turn without an immediate extra draw', () => {
  const { g } = rig(['second_chance', 11, 12, 10, 2, 3, 10, 4]);
  startRound(g);
  hit(g); hit(g); hit(g); hit(g);
  assert.equal(g.turnIndex, 2);
  assert.equal(g.players[1].status, 'active');
  assert.equal(g.players[1].secondChance, null);
  assert.deepEqual(values(g.players[1]), [10]);
  assert.equal(g.deck.at(-1).value, 4);
});

test('Freeze ignores Second Chance protection and only active targets are legal', () => {
  const { g } = rig(['second_chance', 11, 12, 'freeze']);
  startRound(g);
  g.players[2].status = 'stayed';
  hit(g);
  assert.deepEqual(g.pendingAction.eligible, [0, 1]);
  assert.throws(() => chooseTarget(g, 2));
  assert.equal(g.phase, 'targeting');
  chooseTarget(g, 1);
  assert.equal(g.players[1].status, 'frozen');
  assert.ok(g.players[1].secondChance);
});

test('last active player must self-target Freeze and round ends with correct score', () => {
  const { g } = normal(['freeze']);
  stay(g); stay(g);
  hit(g);
  assert.deepEqual(g.pendingAction.eligible, [0]);
  chooseTarget(g, 0);
  assert.equal(g.phase, 'roundEnd');
  assert.deepEqual(g.players.map(p => p.total), [12, 10, 11]);
});

test('Flip 7 during forced draws ends immediately, cancels deferred effects, scores every nonbusted player', () => {
  const { g } = normal([2, 3, 4, 5, 6, 'flip3', 'freeze', 0, 7]);
  stay(g); stay(g); // Ada is last active.
  for (let i = 0; i < 5; i++) hit(g);
  hit(g);
  chooseTarget(g, 0);
  assert.equal(g.phase, 'roundEnd');
  assert.deepEqual(g.players.map(p => p.total), [47, 10, 11]);
  assert.equal(g.deck.at(-1).value, 7);
  assert.equal(g.pendingAction, null);
  assert.equal(g.players[0].status, 'active');
});

test('a regular Flip 7 banks other still-active hands and 0 counts toward seven', () => {
  const { g } = normal([0, 2, 3, 4, 5, 6]);
  // Keep other seats active, but set the public turn cursor for a compact scoring fixture.
  for (let i = 0; i < 6; i++) { g.turnIndex = 1; hit(g); }
  assert.equal(g.phase, 'roundEnd');
  assert.deepEqual(g.players.map(p => p.total), [12, 45, 11]);
});

test('bust-causing duplicate is retained outside the recyclable discard until round end', () => {
  const { g, cards } = normal([10, 2]);
  const duplicate = cards[3];
  hit(g);
  assert.equal(g.players[1].status, 'busted');
  assert.equal(g.discard.some(card => card.id === duplicate.id), false,
    'A bust is not Second Chance: the bust card belongs to the out-of-round table hand');
  finishByStaying(g);
  assert.equal(g.discard.filter(card => card.id === duplicate.id).length, 1);
});

test('resolved Freeze stays on the table, unavailable to mid-round recycling', () => {
  const { g, cards } = normal(['freeze', 2]);
  const freeze = cards[3];
  hit(g);
  chooseTarget(g, 0);
  assert.equal(g.discard.some(card => card.id === freeze.id), false);
  finishByStaying(g);
  assert.equal(g.discard.filter(card => card.id === freeze.id).length, 1);
});

test('resolved Flip Three stays on the table, unavailable to mid-round recycling', () => {
  const { g, cards } = normal(['flip3', 2, 3, 4]);
  const flip3 = cards[3];
  hit(g);
  chooseTarget(g, 1);
  assert.equal(g.discard.some(card => card.id === flip3.id), false);
  finishByStaying(g);
  assert.equal(g.discard.filter(card => card.id === flip3.id).length, 1);
});

test('mid-round exhaustion shuffles only prior discards, leaving held and busted cards out', () => {
  const { g, cards, pool } = normal([10]);
  const priorDiscard = pool.find(card => card.type === 'number' && card.value === 2);
  g.discard = [priorDiscard];
  g.rng = () => 0.999999;
  hit(g); // Bea busts on the last draw-pile card.
  takeEvents(g);
  hit(g); // Cy forces discard reshuffle.
  assert.equal(flipEvents(g)[0].card.id, priorDiscard.id,
    'The newly busted duplicate must not reappear when prior-round discards are recycled');
  assert.equal(g.events.find(event => event.t === 'shuffle').deckSize, 1);
  assert.equal(g.players[1].numbers[0].id, cards[0].id);
});

test('round end preserves undealt order and rotates dealer before next initial deal', () => {
  const { g } = normal([2, 3, 4, 5]);
  const undealt = g.deck.map(card => card.id);
  finishByStaying(g);
  assert.deepEqual(g.deck.map(card => card.id), undealt);
  assert.equal(g.dealerIndex, 1);
  nextRound(g);
  assert.equal(g.round, 2);
  assert.equal(g.turnIndex, 2);
  assert.deepEqual(g.players.map(values), [[3], [4], [2]]);
  assert.equal(g.deck.at(-1).value, 5);
});

test('crossing 200 waits for round end and highest total, not first threshold crosser, wins', () => {
  const { g } = normal([]);
  g.players[1].total = 190;
  g.players[0].total = 195;
  stay(g);
  assert.equal(g.phase, 'turn');
  assert.equal(g.winnerIndex, null);
  finishByStaying(g);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerIndex, 0);
  assert.deepEqual(g.players.map(p => p.total), [207, 200, 11]);
});

test('tied exactly 200 continues with every player, including a previous nonleader who can win', () => {
  const { g } = normal([2, 0, 1]);
  g.players[0].total = 188;
  g.players[1].total = 190;
  g.players[2].total = 188;
  finishByStaying(g);
  assert.equal(g.phase, 'roundEnd');
  assert.equal(g.winnerIndex, null);
  assert.deepEqual(g.players.map(p => p.total), [200, 200, 199]);
  nextRound(g);
  assert.equal(g.players.every(p => p.status === 'active'), true);
  finishByStaying(g);
  assert.equal(g.phase, 'roundEnd', 'Tied 201 repeats again rather than breaking tie by seat');
  assert.deepEqual(g.players.map(p => p.total), [200, 201, 201]);
});

test('previous nonleader may win the tie-break round outright', () => {
  const { g } = normal([12, 0, 1]);
  g.players[0].total = 188;
  g.players[1].total = 190;
  g.players[2].total = 188;
  finishByStaying(g);
  nextRound(g);
  finishByStaying(g);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerIndex, 2);
  assert.deepEqual(g.players.map(p => p.total), [200, 201, 211]);
});

test('deterministic complete games reach a unique 200+ winner with score arithmetic conserved', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const policy = makeRng(seed + 1000);
    const g = createGame(['Ada', 'Bea', 'Cy'], { seed });
    startRound(g);
    let steps = 0;
    while (g.phase !== 'gameOver' && steps++ < 10000) {
      if (g.phase === 'targeting') {
        const eligible = g.pendingAction.eligible;
        chooseTarget(g, eligible[Math.floor(policy() * eligible.length)]);
      } else if (g.phase === 'roundEnd') nextRound(g);
      else if (g.phase === 'turn') {
        const p = g.players[g.turnIndex];
        if (canStay(g) && (roundScoreFor(p) >= 22 || policy() < 0.15)) stay(g);
        else hit(g);
      } else assert.fail(`seed ${seed} stuck in ${g.phase}`);
    }
    assert.ok(steps < 10000, `seed ${seed} failed to terminate`);
    const totals = [0, 0, 0];
    for (const event of g.events.filter(event => event.t === 'roundEnd')) {
      for (const result of event.results) {
        totals[result.player] += result.roundScore;
        assert.equal(result.total, totals[result.player]);
      }
    }
    assert.deepEqual(g.players.map(p => p.total), totals);
    assert.ok(totals[g.winnerIndex] >= 200);
    assert.equal(totals.filter(total => total === Math.max(...totals)).length, 1);
  }
});
