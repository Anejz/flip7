import * as E from './engine.js';

export const REVIEW_SCENARIOS = ['rich', 'target', 'flip7', 'bust', 'forced', 'secondchance', 'secondchance-forced', 'opening-freeze', 'sole-target'];

// These review tables are reached by legal engine commands against a full
// 94-card deck. No game-state mutation, fake score, or shortened deck is used.
export function createReviewGame(scenario = 'rich') {
  if (!REVIEW_SCENARIOS.includes(scenario)) throw new Error('Unknown review scenario');
  const remaining = E.buildDeck();
  const order = [];
  const take = predicate => {
    const index = remaining.findIndex(predicate);
    if (index < 0) throw new Error('Review fixture requests an unavailable card');
    order.push(...remaining.splice(index, 1));
  };
  if (scenario === 'opening-freeze') {
    take(card => card.action === 'freeze');
    take(card => card.type === 'number' && card.value === 6);
    take(card => card.type === 'number' && card.value === 7);
    const game = E.createGame(['Alex', 'Sam', 'Taylor'], { seed: 717, dealerIndex: 2, deck: [...order, ...remaining].reverse() });
    E.startRound(game);
    E.takeEvents(game);
    return game;
  }
  if (scenario === 'sole-target') {
    for (const value of [1, 2, 3]) take(card => card.type === 'number' && card.value === value);
    take(card => card.action === 'freeze');
    const game = E.createGame(['Alex', 'Sam', 'Taylor'], { seed: 717, dealerIndex: 2, deck: [...order, ...remaining].reverse() });
    E.startRound(game);
    E.stay(game);
    E.stay(game);
    E.hit(game);
    E.takeEvents(game);
    return game;
  }
  if (scenario.startsWith('secondchance')) {
    for (const value of [5, 2, 3]) take(card => card.type === 'number' && card.value === value);
    take(card => card.action === 'second_chance');
    for (const value of [4, 6]) take(card => card.type === 'number' && card.value === value);
    const forced = scenario === 'secondchance-forced';
    if (forced) take(card => card.action === 'flip3');
    for (const value of forced ? [5, 7, 9] : [5]) take(card => card.type === 'number' && card.value === value);
    const game = E.createGame(['Alex', 'Player 2', 'Player 3'], { seed: 717, dealerIndex: 2, deck: [...order, ...remaining].reverse() });
    E.startRound(game);
    E.hit(game); E.hit(game); E.hit(game);
    if (forced) E.hit(game);
    E.takeEvents(game);
    return game;
  }
  if (scenario === 'forced') {
    for (const value of [1, 2, 3]) take(card => card.type === 'number' && card.value === value);
    take(card => card.type === 'action' && card.action === 'flip3');
    for (const value of [4, 6, 8]) take(card => card.type === 'number' && card.value === value);
    const game = E.createGame(['Alex', 'Player 2', 'Player 3'], { seed: 717, dealerIndex: 2, deck: [...order, ...remaining].reverse() });
    E.startRound(game);
    E.hit(game);
    E.takeEvents(game);
    return game;
  }
  for (const value of [5, 6, 7, 8, 9, 10]) {
    for (let seat = 0; seat < 3; seat++) take(card => card.type === 'number' && card.value === value);
  }
  for (const mod of ['+10', '+8', '+6', '+4', '+2', 'x2']) take(card => card.type === 'modifier' && card.mod === mod);
  if (scenario === 'target') take(card => card.type === 'action' && card.action === 'freeze');
  else take(card => card.type === 'number' && card.value === (scenario === 'bust' ? 5 : 11));
  const game = E.createGame(['Alex', 'Player 2', 'Player 3'], { seed: 717, dealerIndex: 2, deck: [...order, ...remaining].reverse() });
  E.startRound(game);
  for (let step = 0; step < 21; step++) E.hit(game);
  if (scenario === 'target') E.hit(game);
  E.takeEvents(game);
  return game;
}
