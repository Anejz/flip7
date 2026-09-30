// Flip 7 — pure rules engine. No DOM. Usable from the browser UI and from Node tests.
// Rules source: RULES.md (official rulebook spec). Any behavior here must match that file.

export const TARGET_SCORE = 200;
export const FLIP7_BONUS = 15;

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export function buildDeck() {
  const cards = [];
  let id = 0;
  // Number cards: one 0, and N copies of each number N from 1..12 (79 cards).
  cards.push({ id: id++, type: 'number', value: 0 });
  for (let v = 1; v <= 12; v++) {
    for (let i = 0; i < v; i++) cards.push({ id: id++, type: 'number', value: v });
  }
  // Action cards: 3 each.
  for (const action of ['freeze', 'flip3', 'second_chance']) {
    for (let i = 0; i < 3; i++) cards.push({ id: id++, type: 'action', action });
  }
  // Modifier cards: one each.
  for (const mod of [2, 4, 6, 8, 10]) cards.push({ id: id++, type: 'modifier', mod: `+${mod}`, bonus: mod });
  cards.push({ id: id++, type: 'modifier', mod: 'x2' });
  return cards; // 94 cards
}

// Mulberry32 — deterministic RNG for tests; Math.random-free so replays are stable.
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a >>> 0;
  return rng;
}

function shuffle(cards, rng) {
  const arr = cards.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

// Player status within a round:
//   'active'  — still flipping
//   'stayed'  — banked voluntarily
//   'frozen'  — banked via Freeze card
//   'busted'  — flipped a duplicate number, scores 0 this round
// Phases:
//   'roundStart' — round not yet dealt (UI calls startRound)
//   'turn'       — waiting for current player to hit/stay
//   'targeting'  — an action card needs a target (pendingAction set)
//   'roundEnd'   — round scored, waiting for nextRound()
//   'gameOver'   — a player won

export function createGame(playerNames, opts = {}) {
  if (!Array.isArray(playerNames) || playerNames.length < 1 || playerNames.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('players must have non-empty names');
  }
  if (!Number.isInteger(opts.dealerIndex ?? 0) || (opts.dealerIndex ?? 0) < 0 || (opts.dealerIndex ?? 0) >= playerNames.length) {
    throw new Error('invalid dealer index');
  }
  const rng = opts.rng || makeRng(opts.seed ?? (Date.now() & 0xffffffff));
  return {
    rng,
    players: playerNames.map((name, i) => ({
      index: i,
      name,
      total: 0,
      status: 'active',
      numbers: [],        // number cards in front of the player this round
      modifiers: [],      // modifier cards this round
      actions: [],        // resolved Freeze / Flip Three remain here until round cleanup
      bustCard: null,     // the unprotected duplicate stays with the busted line
      secondChance: null, // the Second Chance card if held
      roundScore: 0,
    })),
    // opts.deck (tests only): explicit deck order; cards are drawn from the END.
    deck: opts.deck ? opts.deck.slice() : shuffle(buildDeck(), rng),
    discard: [],
    dealerIndex: opts.dealerIndex ?? 0,
    turnIndex: 0,
    round: 0,
    phase: 'roundStart',
    pendingAction: null, // { kind, chooser, card, eligible: [indices] }
    actionQueue: [],     // earned actions from successfully completed forced batches
    flip3: null,         // { target, remaining, queued } owns its unearned deferred cards
    dealResume: null,    // { order, next } when the initial deal paused on an action card
    winnerIndex: null,
    events: [],
  };
}

// Each frame contains face-up information only. Copies ensure later draws
// cannot change a previously emitted frame or expose future cards.
export function publicSnapshot(g) {
  return structuredClone({
    players: g.players,
    deckSize: g.deck.length,
    discardSize: g.discard.length,
    dealerIndex: g.dealerIndex,
    turnIndex: g.turnIndex,
    round: g.round,
    phase: g.phase,
    pendingAction: g.pendingAction,
    actionQueue: g.actionQueue,
    flip3: g.flip3,
    dealResume: g.dealResume,
    winnerIndex: g.winnerIndex,
  });
}

function emit(g, event) { g.events.push({ ...event, snapshot: publicSnapshot(g) }); }

export function serializeGame(g) {
  if (typeof g.rng?.getState !== 'function') throw new Error('cannot save a game with a non-serializable RNG');
  const { rng, events, ...state } = g;
  return JSON.stringify({ version: 1, rngState: rng.getState(), game: state });
}

export function restoreGame(saved) {
  let data;
  try { data = typeof saved === 'string' ? JSON.parse(saved) : structuredClone(saved); }
  catch { throw new Error('invalid game save JSON'); }
  const g = data?.game;
  if (data?.version !== 1 || !Number.isInteger(data.rngState) || data.rngState < 0 || data.rngState > 0xffffffff ||
      !validSavedState(g)) {
    throw new Error('invalid or unsupported game save');
  }
  return { ...g, rng: makeRng(data.rngState), events: [] };
}

// Persistence is the untrusted boundary. Validate it here, not repeatedly in
// the internal scheduler, so corrupted saves never become partially live games.
function validSavedState(g) {
  const natural = value => Number.isSafeInteger(value) && value >= 0;
  const arrayOf = (values, predicate) => Array.isArray(values) && values.every(predicate);
  const cardValid = card => {
    if (!card || !natural(card.id)) return false;
    if (card.type === 'number') return natural(card.value) && card.value <= 12;
    if (card.type === 'action') return ['freeze', 'flip3', 'second_chance'].includes(card.action);
    if (card.type === 'modifier') return (card.mod === 'x2' && card.bonus === undefined) ||
      ([2, 4, 6, 8, 10].includes(card.bonus) && card.mod === `+${card.bonus}`);
    return false;
  };
  const numberValid = card => cardValid(card) && card.type === 'number';
  const actionValid = card => cardValid(card) && card.type === 'action' && ['freeze', 'flip3'].includes(card.action);
  if (!g || !Array.isArray(g.players) || !g.players.length || !natural(g.round) ||
      !['roundStart', 'turn', 'targeting', 'roundEnd', 'gameOver'].includes(g.phase)) return false;
  const indexValid = index => natural(index) && index < g.players.length;
  const queuedValid = item => item && indexValid(item.chooser) && actionValid(item.card);
  if (!indexValid(g.turnIndex) || !indexValid(g.dealerIndex) ||
      !arrayOf(g.deck, cardValid) || !arrayOf(g.discard, cardValid) || !arrayOf(g.actionQueue, queuedValid)) return false;
  if (!g.players.every((p, i) => p && p.index === i && typeof p.name === 'string' && p.name.trim() &&
      natural(p.total) && natural(p.roundScore) && ['active', 'stayed', 'frozen', 'busted'].includes(p.status) &&
      arrayOf(p.numbers, numberValid) && p.numbers.length <= 7 && new Set(p.numbers.map(card => card.value)).size === p.numbers.length &&
      arrayOf(p.modifiers, card => cardValid(card) && card.type === 'modifier') && arrayOf(p.actions, actionValid) &&
      (p.secondChance === null || (cardValid(p.secondChance) && p.secondChance.type === 'action' && p.secondChance.action === 'second_chance')) &&
      (p.bustCard === null || (numberValid(p.bustCard) && p.status === 'busted' && p.numbers.some(card => card.value === p.bustCard.value))))) return false;
  if (g.flip3 !== null && (!g.flip3 || !indexValid(g.flip3.target) || !natural(g.flip3.remaining) ||
      g.flip3.remaining > 3 || !arrayOf(g.flip3.queued, queuedValid))) return false;
  if (g.dealResume !== null && (!g.dealResume || !arrayOf(g.dealResume.order, indexValid) ||
      new Set(g.dealResume.order).size !== g.players.length || !natural(g.dealResume.next) ||
      g.dealResume.next > g.players.length)) return false;
  if (g.phase === 'targeting') {
    const pa = g.pendingAction;
    if (!pa || !indexValid(pa.chooser) || !cardValid(pa.card) || pa.card.type !== 'action' ||
        pa.kind !== pa.card.action || !arrayOf(pa.eligible, indexValid) || !pa.eligible.length) return false;
    if (pa.kind === 'second_chance' && !g.players[pa.chooser].secondChance) return false;
    if (g.flip3 && pa.kind !== 'second_chance') return false;
    const eligible = g.players.filter(p => p.status === 'active' &&
      (pa.kind !== 'second_chance' || (p.index !== pa.chooser && !p.secondChance))).map(p => p.index);
    if (JSON.stringify(pa.eligible) !== JSON.stringify(eligible)) return false;
  } else if (g.pendingAction !== null || g.flip3 !== null || g.dealResume !== null || g.actionQueue.length) return false;
  if (g.phase === 'turn' && g.players[g.turnIndex].status !== 'active') return false;
  if (g.phase === 'gameOver') {
    if (!indexValid(g.winnerIndex) || g.players[g.winnerIndex].total < TARGET_SCORE ||
        g.players.some(p => p.index !== g.winnerIndex && p.total >= g.players[g.winnerIndex].total)) return false;
  } else if (g.winnerIndex !== null) return false;
  const cards = [...g.deck, ...g.discard];
  if (g.phase !== 'roundEnd' && g.phase !== 'gameOver') {
    for (const p of g.players) cards.push(...p.numbers, ...p.modifiers, ...p.actions, ...[p.secondChance, p.bustCard].filter(Boolean));
    cards.push(...g.actionQueue.map(item => item.card), ...(g.flip3?.queued ?? []).map(item => item.card));
    if (g.pendingAction) cards.push(g.pendingAction.card);
  }
  return new Set(cards.map(card => card.id)).size === cards.length;
}

function draw(g) {
  if (g.deck.length === 0) {
    if (g.discard.length === 0) throw new Error('no cards available to draw');
    // Reshuffle the discard pile into a new deck. Cards in front of players stay put.
    g.deck = shuffle(g.discard, g.rng);
    g.discard = [];
    emit(g, { t: 'shuffle', deckSize: g.deck.length });
  }
  return g.deck.pop();
}

function activePlayers(g) { return g.players.filter(p => p.status === 'active'); }

export function roundScoreFor(p, { flip7 = false } = {}) {
  if (p.status === 'busted') return 0;
  let sum = p.numbers.reduce((a, c) => a + c.value, 0);
  if (p.modifiers.some(m => m.mod === 'x2')) sum *= 2;
  sum += p.modifiers.reduce((a, m) => a + (m.bonus || 0), 0);
  if (flip7) sum += FLIP7_BONUS;
  return sum;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

export function startRound(g) {
  if (g.phase !== 'roundStart') throw new Error(`startRound in phase ${g.phase}`);
  g.phase = 'resolving';
  g.round += 1;
  for (const p of g.players) {
    // Last round's cards were already swept to discard. Clear display copies.
    p.status = 'active';
    p.numbers = [];
    p.modifiers = [];
    p.actions = [];
    p.bustCard = null;
    p.secondChance = null;
    p.roundScore = 0;
  }
  g.flip3 = null;
  g.actionQueue = [];
  g.pendingAction = null;
  emit(g, { t: 'roundStart', round: g.round, dealer: g.dealerIndex });
  // Initial deal: one card face up to each player, starting left of the dealer.
  // Action cards dealt now resolve immediately (RULES.md §2).
  const order = [];
  for (let k = 1; k <= g.players.length; k++) order.push((g.dealerIndex + k) % g.players.length);
  g.dealResume = { order, next: 0 };
  continueRound(g);
  return g;
}

// The single scheduler: advances whatever is in progress until the engine needs
// UI input (turn / targeting) or the round ends. Safe to call after any resolution.
function continueRound(g) {
  for (;;) {
    if (g.phase === 'roundEnd' || g.phase === 'gameOver' || g.phase === 'targeting') return;

    // 1. A Flip Three in progress takes priority.
    if (g.flip3) {
      const target = g.players[g.flip3.target];
      if (target.status === 'busted') {
        // A bust voids only this unfinished batch, not a completed ancestor's
        // remaining actions waiting for this nested effect to finish.
        for (const q of g.flip3.queued) g.discard.push(q.card);
        emit(g, { t: 'flip3End', target: g.flip3.target });
        g.flip3 = null;
        continue;
      }
      if (g.flip3.remaining === 0) {
        g.actionQueue.unshift(...g.flip3.queued);
        emit(g, { t: 'flip3End', target: g.flip3.target });
        // Keep the original turn cursor: the FAQ resumes after the initial
        // drawer, even if the action was passed to another player.
        g.flip3 = null;
        continue;
      }
      g.flip3.remaining -= 1;
      flipCardTo(g, g.flip3.target, { flip3: true });
      continue;
    }

    // 2. House opening: every player receives exactly one face-up card before
    // any opening Freeze / Flip Three is resolved.
    if (g.dealResume) {
      const { order } = g.dealResume;
      if (g.dealResume.next >= order.length) {
        g.dealResume = null;
        if (g.actionQueue.length) continue;
        beginTurns(g);
        return;
      }
      const idx = order[g.dealResume.next++];
      flipCardTo(g, idx, { initialDeal: true });
      continue;
    }

    // 3. Earned and opening action cards resolve in reveal order.
    if (g.actionQueue.length > 0) {
      const { card, chooser } = g.actionQueue.shift();
      const eligible = activePlayers(g).map(q => q.index);
      if (eligible.length === 0) { g.discard.push(card); continue; }
      g.pendingAction = { kind: card.action, chooser, card, eligible };
      g.phase = 'targeting';
      emit(g, { t: 'targeting', kind: card.action, chooser, eligible });
      return;
    }

    // 4. Normal turn flow.
    if (activePlayers(g).length === 0) { endRound(g); return; }
    advanceTurn(g);
    return;
  }
}

function beginTurns(g) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (g.dealerIndex + k) % n;
    if (g.players[idx].status === 'active') {
      g.turnIndex = idx;
      g.phase = 'turn';
      emit(g, { t: 'turnStart', player: idx });
      return;
    }
  }
  endRound(g); // nobody active after the deal
}

function advanceTurn(g) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (g.turnIndex + k) % n;
    if (g.players[idx].status === 'active') {
      g.turnIndex = idx;
      g.phase = 'turn';
      emit(g, { t: 'turnStart', player: idx });
      return;
    }
  }
  endRound(g);
}

function bank(g, idx, how) {
  const p = g.players[idx];
  p.status = how; // 'stayed' | 'frozen'
  p.roundScore = roundScoreFor(p);
  emit(g, { t: how === 'frozen' ? 'frozen' : 'stayed', player: idx, score: p.roundScore });
}

function endRound(g, { flip7Player = null } = {}) {
  g.phase = 'roundEnd';
  // Void anything mid-resolution.
  for (const q of g.actionQueue) g.discard.push(q.card);
  for (const q of g.flip3?.queued ?? []) g.discard.push(q.card);
  g.actionQueue = [];
  g.flip3 = null;
  g.pendingAction = null;
  g.dealResume = null;
  const results = [];
  for (const p of g.players) {
    if (p.status === 'active') {
      // Round ended by Flip 7 while this player was still in: they score their cards.
      p.roundScore = roundScoreFor(p, { flip7: p.index === flip7Player });
    } else if (p.status === 'busted') {
      p.roundScore = 0;
    } // stayed/frozen already banked
    p.total += p.roundScore;
    results.push({ player: p.index, roundScore: p.roundScore, total: p.total });
    // At terminal phases these arrays become display-only copies; discard is
    // their physical owner. startRound clears the copies before dealing.
    g.discard.push(...p.numbers, ...p.modifiers, ...p.actions);
    if (p.bustCard) g.discard.push(p.bustCard);
    if (p.secondChance) g.discard.push(p.secondChance);
    p.secondChance = null;
  }
  emit(g, { t: 'roundEnd', round: g.round, results, flip7Player });
  const leaders = g.players.filter(p => p.total >= TARGET_SCORE);
  if (leaders.length > 0) {
    const top = Math.max(...leaders.map(p => p.total));
    const topPlayers = g.players.filter(p => p.total === top);
    if (topPlayers.length === 1) {
      g.phase = 'gameOver';
      g.winnerIndex = topPlayers[0].index;
      emit(g, { t: 'gameOver', winner: g.winnerIndex, totals: g.players.map(p => p.total) });
      return;
    }
    // Tied at the top: everyone plays another round.
    emit(g, { t: 'tiebreak', players: topPlayers.map(p => p.index) });
  }
  g.dealerIndex = (g.dealerIndex + 1) % g.players.length;
}

export function nextRound(g) {
  if (g.phase !== 'roundEnd') throw new Error(`nextRound in phase ${g.phase}`);
  g.phase = 'roundStart';
  return startRound(g);
}

// ---------------------------------------------------------------------------
// Card resolution
// ---------------------------------------------------------------------------

// Flip the top card to player idx and resolve it. May set phase to
// 'targeting' / 'roundEnd' / 'gameOver'; otherwise leaves phase unchanged.
function flipCardTo(g, idx, ctx = {}) {
  const card = draw(g);
  emit(g, { t: 'flip', player: idx, card, ctx });
  resolveCardTo(g, idx, card, ctx);
  emit(g, { t: 'cardResolved', player: idx, card, ctx });
}

function resolveCardTo(g, idx, card, ctx = {}) {
  const p = g.players[idx];
  if (card.type === 'number') {
    const dup = p.numbers.find(c => c.value === card.value);
    if (dup) {
      if (p.secondChance) {
        // Second Chance: discard the duplicate AND the Second Chance; keep going.
        const secondChance = p.secondChance;
        g.discard.push(card, secondChance);
        p.secondChance = null;
        emit(g, { t: 'secondChanceUsed', player: idx, card, secondChance });
        return;
      }
      p.status = 'busted';
      p.bustCard = card;
      emit(g, { t: 'bust', player: idx, card });
      return;
    }
    p.numbers.push(card);
    if (p.numbers.length === 7) {
      emit(g, { t: 'flip7', player: idx });
      endRound(g, { flip7Player: idx });
    }
    return;
  }

  if (card.type === 'modifier') {
    p.modifiers.push(card);
    return;
  }

  // Action cards.
  if (ctx.initialDeal && (card.action === 'freeze' || card.action === 'flip3')) {
    g.actionQueue.push({ card, chooser: idx });
    emit(g, { t: 'openingActionDeferred', player: idx, card });
    return;
  }
  if (card.action === 'second_chance') {
    if (!p.secondChance) {
      p.secondChance = card;
      emit(g, { t: 'secondChanceGained', player: idx });
      return;
    }
    // Already holding one: must give it to an active player without one; discard if none.
    const eligible = activePlayers(g).filter(q => q.index !== idx && !q.secondChance).map(q => q.index);
    if (eligible.length === 0) {
      g.discard.push(card);
      emit(g, { t: 'secondChanceDiscarded', player: idx });
      return;
    }
    g.pendingAction = { kind: 'second_chance', chooser: idx, card, eligible };
    g.phase = 'targeting';
    emit(g, { t: 'targeting', kind: 'second_chance', chooser: idx, eligible });
    return;
  }

  // Freeze / Flip Three flipped DURING a Flip Three are set aside and resolved
  // after the three flips finish. The flipper becomes the chooser.
  if (g.flip3 && (card.action === 'freeze' || card.action === 'flip3')) {
    g.flip3.queued.push({ card, chooser: idx });
    emit(g, { t: 'actionQueued', player: idx, card });
    return;
  }

  g.pendingAction = { kind: card.action, chooser: idx, card, eligible: activePlayers(g).map(q => q.index) };
  g.phase = 'targeting';
  emit(g, { t: 'targeting', kind: card.action, chooser: idx, eligible: g.pendingAction.eligible });
}

// ---------------------------------------------------------------------------
// Player actions (called by the UI)
// ---------------------------------------------------------------------------

export function hit(g) {
  if (g.phase !== 'turn') throw new Error(`hit in phase ${g.phase}`);
  const idx = g.turnIndex;
  g.phase = 'resolving';
  emit(g, { t: 'hit', player: idx });
  flipCardTo(g, idx);
  continueRound(g);
  return g;
}

// "You may 'Stay' as long as you have a card in front of you" (RULES.md §3).
export function canStay(g) {
  if (g.phase !== 'turn') return false;
  const p = g.players[g.turnIndex];
  return p.numbers.length + p.modifiers.length + p.actions.length > 0 || !!p.secondChance;
}

export function stay(g) {
  if (g.phase !== 'turn') throw new Error(`stay in phase ${g.phase}`);
  if (!canStay(g)) throw new Error('cannot stay with no cards in front of you');
  g.phase = 'resolving';
  bank(g, g.turnIndex, 'stayed');
  continueRound(g);
  return g;
}

// Resolve a pending action card by choosing its target.
export function chooseTarget(g, targetIdx) {
  if (g.phase !== 'targeting' || !g.pendingAction) throw new Error('no pending action');
  const pa = g.pendingAction;
  if (!pa.eligible.includes(targetIdx)) throw new Error(`illegal target ${targetIdx}`);
  g.pendingAction = null;
  g.phase = 'resolving';

  if (pa.kind === 'second_chance') {
    g.players[targetIdx].secondChance = pa.card;
    emit(g, { t: 'secondChanceGiven', from: pa.chooser, to: targetIdx });
  } else if (pa.kind === 'freeze') {
    g.players[targetIdx].actions.push(pa.card);
    bank(g, targetIdx, 'frozen');
  } else if (pa.kind === 'flip3') {
    g.players[targetIdx].actions.push(pa.card);
    g.flip3 = { target: targetIdx, remaining: 3, queued: [] };
    emit(g, { t: 'flip3Start', target: targetIdx, by: pa.chooser });
  } else {
    throw new Error(`unknown action ${pa.kind}`);
  }
  continueRound(g);
  return g;
}

// Drain and clear the event queue (UI animation feed).
export function takeEvents(g) {
  const ev = g.events;
  g.events = [];
  return ev;
}
