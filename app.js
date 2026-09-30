import * as E from './engine.js';
import { REVIEW_SCENARIOS, createReviewGame } from './review-fixtures.js';
import { cleanLeaderboard, recordGame } from './leaderboard.js';

const $ = selector => document.querySelector(selector);
const COLORS = ['#f5cc5c', '#a4cddf', '#efaaa4'];
const NUMBER_COLORS = ['#6e807a', '#bd5150', '#bc6242', '#b38a37', '#738747', '#408164', '#448f8a', '#da623b', '#477da0', '#6676a7', '#866596', '#ad6188', '#b75155'];
const ACTIONS = { freeze: { title: 'Freeze', symbol: '❄', label: 'FREEZE' }, flip3: { title: 'Flip Three', symbol: '↻', label: 'FLIP THREE' }, second_chance: { title: 'Second Chance', symbol: '♥', label: 'SECOND CHANCE' } };
const STORAGE_KEY = 'flip7-table-v2';
const PREFERENCES_KEY = 'flip7-preferences-v2';
const LEADERBOARD_KEY = 'flip7-leaderboard-v1';
const reviewScenario = new URLSearchParams(location.search).get('review');
const reviewMode = REVIEW_SCENARIOS.includes(reviewScenario);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const modal = $('#modal');
const esc = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let game = null;
let view = null;
let names = ['Alex', 'Player 2', 'Player 3'];
let busy = false;
let soundOn = false;
let audioContext = null;
let history = [];
let lastRound = null;
let animationTitle = '';
let animationSub = '';
let latestCard = null;
let latestCardOwner = null;
let newestCardId = null;
let discardPair = null;
let modalKind = null;
let priorFocus = null;
let cooldownUntil = 0;
let saveAvailable = true;
let resultRecorded = false;
let leaderboard = [];
let playerEffect = null;

function snapshot() {
  if (E.publicSnapshot) return E.publicSnapshot(game);
  return { players: structuredClone(game.players), phase: game.phase, round: game.round, dealerIndex: game.dealerIndex, turnIndex: game.turnIndex, pendingAction: structuredClone(game.pendingAction), deckSize: game.deck.length, discardSize: game.discard.length, winnerIndex: game.winnerIndex };
}

function storageRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function save() {
  if (reviewMode) {
    $('#save-status').textContent = 'Review · not saved';
    return;
  }
  if (!game || !E.serializeGame) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ game: E.serializeGame(game), history, lastRound, latestCard, latestCardOwner, resultRecorded }));
    saveAvailable = true;
  } catch { saveAvailable = false; }
  $('#save-status').textContent = saveAvailable ? 'Saved' : 'Not saved — keep this tab open';
}

function saveLeaderboard() {
  if (reviewMode) return;
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard)); } catch { /* The current table remains playable without lifetime stats. */ }
}

function recordResultOnce() {
  if (reviewMode || resultRecorded || game?.phase !== 'gameOver') return;
  leaderboard = recordGame(leaderboard, game.players, game.winnerIndex);
  resultRecorded = true;
  saveLeaderboard();
}

function savePreferences() {
  if (reviewMode) return;
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ names, soundOn })); } catch { /* The table remains playable without storage. */ }
}

function sound(kind = 'flip') {
  if (!soundOn) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const notes = { flip: [590], stay: [523, 659], bust: [175, 130], saved: [660, 880], win: [523, 659, 784, 1047] }[kind] || [590];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + index * .09;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.025, start);
      gain.gain.exponentialRampToValueAtTime(.001, start + .14);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + .15);
    });
  } catch { /* Sound is optional; unsupported audio must not stop play. */ }
}

function cardMarkup(card, extraClass = '') {
  if (card.type === 'number') return `<div class="card number ${extraClass}" style="--card-color:${NUMBER_COLORS[card.value]};--tilt:${[-1.8,1.1,-.5,1.6][card.id % 4]}deg" role="img" aria-label="Number ${card.value}"><span class="corner" aria-hidden="true">${card.value}</span><span class="value" aria-hidden="true">${card.value}</span><span class="corner bottom" aria-hidden="true">${card.value}</span></div>`;
  if (card.type === 'modifier') {
    const label = card.mod === 'x2' ? '×2' : card.mod;
    return `<div class="card modifier ${extraClass}" role="img" aria-label="${card.mod === 'x2' ? 'Double number points' : esc(card.mod) + ' point modifier'}"><span class="corner" aria-hidden="true">${label}</span><span class="value" aria-hidden="true">${label}</span><span class="corner bottom" aria-hidden="true">${label}</span></div>`;
  }
  const action = ACTIONS[card.action];
  return `<div class="card action ${card.action} ${extraClass}" role="img" aria-label="${action.title}"><span class="value" aria-hidden="true">${action.symbol}</span><span class="action-name" aria-hidden="true">${action.label.replace(' ', '<br>')}</span></div>`;
}

function playerScore(player) {
  return ['roundEnd', 'gameOver'].includes(view?.phase) ? player.roundScore : E.roundScoreFor(player);
}

function currentActor() {
  if (!view) return null;
  if (view.phase === 'targeting') return view.pendingAction?.chooser;
  if (busy) return latestCardOwner;
  if (view.phase === 'turn') return view.turnIndex;
  return null;
}

function equation(player) {
  if (player.status === 'busted') return 'Duplicate number. This round scores 0.';
  const base = player.numbers.reduce((sum, card) => sum + card.value, 0);
  const doubled = player.modifiers.some(card => card.mod === 'x2');
  const bonus = player.modifiers.reduce((sum, card) => sum + (card.bonus || 0), 0);
  if (!player.numbers.length && !player.modifiers.length) return player.secondChance ? 'A little insurance for your next flip.' : '';
  const flip7 = player.numbers.length === 7;
  return `${base} number pts${doubled ? ' × 2' : ''}${bonus ? ` + ${bonus} bonus` : ''}${flip7 ? ' + 15 Flip 7' : ''}`;
}

function renderPlayers() {
  const players = view?.players || names.map((name, index) => ({ name, index, total: 0, status: 'active', numbers: [], modifiers: [], actions: [], secondChance: null }));
  const actor = currentActor();
  $('#players').innerHTML = players.map(player => {
    const current = actor === player.index;
    const eligible = !busy && view?.phase === 'targeting' && view.pendingAction.eligible.includes(player.index);
    const pair = discardPair?.player === player.index ? discardPair : null;
    const queuedActions = [...(view?.actionQueue || []), ...(view?.flip3?.queued || [])].filter(action => action.chooser === player.index).map(action => action.card);
    const pendingCard = view?.pendingAction?.chooser === player.index ? [view.pendingAction.card] : [];
    const cards = [...player.numbers, ...player.modifiers, ...(player.actions || []), ...(player.secondChance ? [player.secondChance] : []), ...(player.bustCard ? [player.bustCard] : []), ...queuedActions, ...pendingCard, ...(pair ? [pair.card, pair.secondChance] : [])];
    const roundEnded = ['roundEnd', 'gameOver'].includes(view?.phase);
    const status = !view ? '' : { active: roundEnded ? 'Banked' : current ? 'Your turn' : '', stayed: 'Banked', frozen: 'Frozen', busted: 'Busted' }[player.status];
    const score = view ? playerScore(player) : 0;
    return `<article class="player ${current ? 'current' : ''} ${cards.length > 5 ? 'crowded' : ''} ${cards.length > 9 ? 'very-crowded' : ''} ${player.status === 'busted' ? 'is-busted' : ''} ${playerEffect?.player === player.index ? `effect-${playerEffect.kind}` : ''}" style="--seat-color:${COLORS[player.index]}" data-player="${player.index}" aria-label="${esc(player.name)}'s hand${current ? ', current player' : ''}">
      <div class="player-header"><div class="player-heading"><div class="player-name">${esc(player.name)}</div><div class="player-sub"><span class="banked-total">${player.total} total</span></div></div><div class="player-score" title="${esc(equation(player))}">${score}<small>ROUND</small></div></div>
      <div class="hand" aria-label="Face-up cards">${cards.length ? cards.map(card => cardMarkup(card, `${card.id === newestCardId ? 'just-dealt' : ''} ${card.id === player.bustCard?.id ? 'bust-card' : ''} ${pair && [pair.card.id, pair.secondChance.id].includes(card.id) ? `discard-pair ${pair.leaving ? 'is-leaving' : ''}` : ''}`)).join('') : '<div class="empty-hand">—</div>'}</div>
      <p class="sr-only">${esc(equation(player))}</p>
      <div class="player-footer"><span class="status-chip ${player.status}">${status}</span><span class="seven-count" aria-label="${player.numbers.length} of 7 different numbers">${player.numbers.length} / 7</span></div>
      <div class="player-controls">
        ${eligible ? `<button class="target-button" data-target="${player.index}">${targetLabel(view.pendingAction.kind)} ${esc(player.name)}${view.pendingAction.eligible.length === 1 ? ' <span class="shortcut" aria-hidden="true">Space</span>' : ''}</button>` : ''}
        ${!busy && current && view?.phase === 'turn' ? `<button class="primary" id="btn-hit">Hit <span class="shortcut" aria-hidden="true">Space</span></button><button class="secondary" id="btn-stay" ${E.canStay(game) ? '' : 'disabled'}>Stay <span class="shortcut" aria-hidden="true">Esc</span></button>` : ''}
      </div>
    </article>`;
  }).join('');
  if ($('#btn-hit')) $('#btn-hit').onclick = () => act('hit');
  if ($('#btn-stay')) $('#btn-stay').onclick = () => act('stay');
  document.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => act('target', Number(button.dataset.target))));
}

function targetLabel(kind) {
  return { freeze: 'Freeze', flip3: 'Flip 3 for', second_chance: 'Give to' }[kind];
}

function renderControls() {
  const controls = $('#controls');
  if (!view) {
    $('#turn-title').textContent = 'One more?';
    $('#turn-sub').textContent = 'Seven different numbers. One very tempting next card.';
    controls.innerHTML = '<button class="primary" id="btn-open-setup">Take your seats →</button>';
    $('#btn-open-setup').onclick = () => showSetup();
    return;
  }
  if (busy) {
    $('#turn-title').textContent = animationTitle || 'Here we go…';
    $('#turn-sub').textContent = animationSub || 'Dealing one card at a time.';
    controls.innerHTML = '';
    return;
  }
  if (view.phase === 'roundEnd' || view.phase === 'gameOver') {
    const won = view.phase === 'gameOver';
    $('#turn-title').textContent = won ? `${view.players[view.winnerIndex].name} wins!` : `Round ${view.round}, in the books.`;
    $('#turn-sub').textContent = won ? 'Highest score at the end of the round. A well-earned victory.' : 'Every point is counted. Ready for another round?';
    controls.innerHTML = '<button class="primary" id="btn-results">See the scores →</button>';
    $('#btn-results').onclick = showResults;
    return;
  }
  const player = view.players[currentActor()];
  if (!player) return;
  const targeting = view.phase === 'targeting';
  $('#turn-title').textContent = targeting ? `${ACTIONS[view.pendingAction.kind].title} · choose a player` : `${player.name}'s turn`;
  if (targeting) {
    const kind = view.pendingAction.kind;
    $('#turn-sub').textContent = { freeze: 'Freeze banks someone’s points and ends their round. You can choose yourself.', flip3: 'Flip Three makes someone draw up to 3 cards. You can choose yourself.', second_chance: 'You already have a Second Chance. Give this one to someone without one.' }[kind];
  } else {
    $('#turn-sub').textContent = `${playerScore(player)} round points. ${player.numbers.length} of 7 different numbers.`;
  }
  controls.innerHTML = '';
  if (!targeting && !E.canStay(game)) $('#turn-sub').textContent += ' No cards yet — you must hit.';
}

function render() {
  $('#app').classList.toggle('no-game', !view);
  $('#game-table').classList.toggle('is-turn', !busy && view?.phase === 'turn');
  $('#game-table').classList.toggle('has-table-action', !busy && (!view || ['roundEnd', 'gameOver'].includes(view.phase)));
  $('#round-label').textContent = view ? `ROUND ${String(view.round).padStart(2, '0')}` : 'YOUR TABLE';
  $('#deck-count').textContent = view ? `${view.deckSize} cards in deck` : '94 cards';
  $('#btn-new').disabled = busy;
  $('#btn-rules').disabled = busy;
  $('#btn-history').disabled = busy || !game;
  $('#btn-leaders').disabled = busy;
  renderPlayers();
  renderControls();
}

function announce(message) { $('#latest-event').textContent = message; }
function pause(milliseconds, readingTime = false) { return new Promise(resolve => setTimeout(resolve, reducedMotion.matches && !readingTime ? Math.min(110, milliseconds) : milliseconds)); }

async function playback(events) {
  for (const event of events) {
    if (event.snapshot) view = event.snapshot;
    const player = view?.players[event.player];
    newestCardId = null;
    let delay = 0;
    switch (event.t) {
      case 'roundStart': latestCard = null; latestCardOwner = null; animationTitle = `Round ${event.round}. Fresh chances.`; animationSub = 'One card each, starting to the left of the dealer.'; delay = 300; break;
      case 'flip': {
        latestCard = event.card;
        latestCardOwner = event.player;
        const label = event.card.type === 'number' ? String(event.card.value) : event.card.type === 'modifier' ? event.card.mod.replace('x', '×') : ACTIONS[event.card.action].title;
        animationTitle = `${player.name} flips ${label}.`;
        animationSub = event.ctx?.flip3 ? 'Flip Three · the cards keep coming.' : event.ctx?.initialDeal ? 'First, one face-up card for every player.' : 'A little suspense is part of the game.';
        sound('flip');
        announce(`${player.name} flipped ${label}.`);
        delay = 390;
        break;
      }
      case 'cardResolved': newestCardId = event.card?.id ?? latestCard?.id; delay = 120; break;
      case 'bust': playerEffect = { player: event.player, kind: 'bust' }; animationTitle = `${player.name} busts!`; animationSub = `Another ${event.card.value}. No points this round — your previous total is safe.`; sound('bust'); announce(`${player.name} busted on a duplicate ${event.card.value}. This round: 0.`); delay = 1050; break;
      case 'stayed': playerEffect = { player: event.player, kind: 'bank' }; animationTitle = `${player.name} banks ${event.score}.`; animationSub = 'Knowing when to stop is a skill, too.'; announce(`${player.name} stayed and banked ${event.score} points for this round.`); sound('stay'); delay = 520; break;
      case 'frozen': playerEffect = { player: event.player, kind: 'freeze' }; animationTitle = `${player.name} is frozen.`; animationSub = `${event.score} points banked. Their round ends here.`; announce(`${player.name} was frozen and banked ${event.score} points.`); sound('stay'); delay = 800; break;
      case 'secondChanceUsed': {
        discardPair = { player: event.player, card: event.card, secondChance: event.secondChance, leaving: false };
        animationTitle = `Second Chance saves the duplicate ${event.card.value}.`;
        animationSub = 'The new duplicate and Second Chance go. The original number stays.';
        announce(`${player.name}: duplicate ${event.card.value} and Second Chance used. The original ${event.card.value} stays.`);
        sound('saved');
        render();
        await pause(1200, true);
        discardPair.leaving = true;
        render();
        await pause(280);
        discardPair = null;
        break;
      }
      case 'secondChanceGained': announce(`${player.name} holds a Second Chance. It cancels one duplicate.`); break;
      case 'secondChanceGiven': announce(`${view.players[event.from].name} gave a Second Chance to ${view.players[event.to].name}.`); delay = 450; break;
      case 'secondChanceDiscarded': announce('Extra Second Chance discarded: no active player can receive it.'); delay = 350; break;
      case 'actionQueued': announce(`${ACTIONS[event.card.action].title} set aside until these forced flips finish.`); break;
      case 'openingActionDeferred': animationSub = `${ACTIONS[event.card.action].title} waits until all three first cards are face up.`; announce(`${ACTIONS[event.card.action].title} waits until every player has a first card.`); delay = 260; break;
      case 'flip3Start': animationTitle = `${view.players[event.target].name}, three coming up.`; animationSub = 'No hitting or staying until the forced cards resolve.'; delay = 600; break;
      case 'flip7': playerEffect = { player: event.player, kind: 'flip7' }; animationTitle = `${player.name} flipped 7!`; animationSub = 'Seven different numbers. +15 bonus. The round ends now.'; announce(`${player.name} flipped seven different numbers! +15 bonus, everyone still in banks.`); sound('win'); confetti(); delay = 1200; break;
      case 'shuffle': animationTitle = 'Deck empty · shuffling discards'; animationSub = 'Cards in your hands stay on the table.'; announce('Deck empty. Discards automatically reshuffled; held cards stay out.'); delay = 700; break;
      case 'roundEnd': break;
      case 'tiebreak': announce('Tied for the lead at 200 or more. All three players continue next round.'); break;
      case 'gameOver': sound('win'); confetti(); break;
    }
    render();
    if (delay) await pause(delay);
  }
  view = snapshot();
  discardPair = null;
  newestCardId = null;
  playerEffect = null;
  busy = false;
  cooldownUntil = performance.now() + 250;
  render();
  save();
  if (view.phase === 'roundEnd' || view.phase === 'gameOver') showResults();
  else if (view.phase === 'targeting') document.querySelector('[data-target]')?.focus({ preventScroll: true });
  else $('#btn-hit')?.focus({ preventScroll: true });
}

async function transition(operation) {
  if (busy) return;
  busy = true;
  try {
    operation();
    recordResultOnce();
    const events = E.takeEvents(game);
    const roundEnd = events.find(event => event.t === 'roundEnd');
    if (roundEnd) {
      lastRound = { ...roundEnd, snapshot: undefined, statuses: game.players.map(player => player.status) };
      if (!history.some(round => round.round === roundEnd.round)) history.push(lastRound);
    }
    save();
    await playback(events);
  } catch (error) {
    console.error(error);
    discardPair = null;
    playerEffect = null;
    busy = false;
    view = game ? snapshot() : null;
    render();
    openModal('error', `<p class="eyebrow">TABLE PAUSED</p><h2 id="modal-title">Let’s keep your place.</h2><p class="modal-description">That move could not finish. Your saved game has not been cleared. Close this message to inspect the table, or refresh to resume your saved position.</p><button class="primary" id="btn-error-close">Back to the table</button>`);
    $('#btn-error-close').onclick = closeModal;
  }
}

function act(kind, target) {
  if (busy || modal.open || performance.now() < cooldownUntil) return;
  if (kind === 'hit' && game.phase === 'turn') transition(() => E.hit(game));
  if (kind === 'stay' && game.phase === 'turn' && E.canStay(game)) transition(() => E.stay(game));
  if (kind === 'target' && game.phase === 'targeting' && game.pendingAction.eligible.includes(target)) transition(() => E.chooseTarget(game, target));
}

function openModal(kind, content, closable = true) {
  if (!modal.open) priorFocus = document.activeElement;
  modalKind = kind;
  modal.innerHTML = `<div class="modal-content">${closable ? '<button class="modal-close" aria-label="Close dialog">×</button>' : ''}${content}</div>`;
  modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
  if (!modal.open) modal.showModal();
}

function closeModal() {
  const focusId = priorFocus?.id;
  const focusTarget = priorFocus?.dataset?.target;
  modal.close();
  modalKind = null;
  render();
  const returnFocus = focusTarget !== undefined ? document.querySelector(`[data-target="${focusTarget}"]`) : focusId ? document.getElementById(focusId) : null;
  if (returnFocus && !modal.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  else ($('#btn-hit') || document.querySelector('[data-target]'))?.focus({ preventScroll: true });
}

function showSetup() {
  openModal('setup', `<div class="setup-heading"><div class="setup-art" aria-hidden="true">${[3, 7, 12].map((value, id) => cardMarkup({ type: 'number', value, id })).join('')}</div><p class="eyebrow">GOOD COMPANY. QUESTIONABLE DECISIONS.</p><h2 id="modal-title">Who’s in?</h2><p class="modal-description">Three friends, one screen, and just one more card.<br>Take a seat. We’ll keep the score.</p></div><form id="setup-form"><div class="setup-fields">${names.map((name, index) => `<div class="name-field"><label for="name-${index}">SEAT ${index + 1}</label><input id="name-${index}" name="name-${index}" value="${esc(name)}" aria-label="Player ${index + 1} name" maxlength="18" autocomplete="off" required></div>`).join('')}</div><button class="primary" type="submit">Deal us in <span aria-hidden="true">→</span></button></form><p class="setup-footnote">All cards are face up. Pass the controls between turns.<br>No accounts, no bots. Just your table.</p>`, !!game);
  $('#setup-form').onsubmit = event => {
    event.preventDefault();
    if (busy || modalKind !== 'setup') return;
    names = [0, 1, 2].map(index => $(`#name-${index}`).value.trim() || `Player ${index + 1}`);
    const normalized = names.map(name => name.toLocaleLowerCase('en-US'));
    const duplicate = normalized.findIndex((name, index) => normalized.indexOf(name) !== index);
    if (duplicate >= 0) {
      const input = $(`#name-${duplicate}`);
      input.setCustomValidity('Use a different name for each player so the leaderboard stays accurate.');
      input.reportValidity();
      return;
    }
    savePreferences();
    game = E.createGame(names);
    view = snapshot();
    history = [];
    lastRound = null;
    resultRecorded = false;
    latestCard = null;
    latestCardOwner = null;
    closeModal();
    transition(() => E.startRound(game));
  };
  $('#name-0').focus();
  $('#name-0').select();
  document.querySelectorAll('#setup-form input').forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
}

function showNewGame() {
  if (busy) return;
  if (!game || game.phase === 'gameOver') return showSetup();
  openModal('confirm', '<p class="eyebrow">A FRESH DECK?</p><h2 id="modal-title">Leave this game?</h2><p class="modal-description">Starting a new game replaces this table’s saved game and its scores. Your current game stays safe until you deal the new one.</p><div class="modal-actions"><button class="secondary" id="btn-keep">Keep playing</button><button class="primary" id="btn-restart">New table →</button></div>');
  $('#btn-keep').onclick = closeModal;
  $('#btn-restart').onclick = showSetup;
  $('#btn-keep').focus();
}

function resultReason(player) {
  if (player.status === 'busted') return 'Busted · duplicate number';
  if (player.numbers.length === 7) return 'Flip 7 · includes +15 bonus';
  return { frozen: 'Frozen · points banked', stayed: 'Stayed · points banked', active: 'Round ended · points banked' }[player.status];
}

function showResults() {
  if (busy || !['roundEnd', 'gameOver'].includes(game?.phase)) return;
  const won = game.phase === 'gameOver';
  const high = Math.max(...game.players.map(player => player.total));
  const tied = !won && high >= 200 && game.players.filter(player => player.total === high).length > 1;
  const title = won ? `${game.players[game.winnerIndex].name} takes the table.` : lastRound?.flip7Player != null ? `${game.players[lastRound.flip7Player].name} flipped 7!` : `Round ${game.round}, all counted.`;
  openModal('results', `<p class="eyebrow">${won ? 'A LITTLE LUCK. A WELL-EARNED WIN.' : 'THE ROUND IS IN THE BOOKS'}</p><h2 id="modal-title">${esc(title)}</h2><p class="modal-description">${won ? 'The highest total at the end of the round wins. Same friends, fresh deck?' : tied ? 'The lead is tied at 200 or more. All three players play another round.' : 'Banked points stay yours. Busted this round? The next one is a fresh start.'}</p><div class="result-rows">${[...game.players].sort((a, b) => b.total - a.total).map(player => `<div class="result-row"><span class="seat-avatar" style="--seat-color:${COLORS[player.index]}">${player.index + 1}</span><span class="result-name">${esc(player.name)}<span class="result-reason">${resultReason(player)}</span></span><span class="result-delta">+${player.roundScore}</span><strong class="result-total">${player.total}</strong></div>`).join('')}</div>${!won ? `<div class="round-banner">Next dealer: <strong>${esc(game.players[game.dealerIndex].name)}</strong>. The opening deal starts to their left.</div>` : ''}<button class="primary" id="btn-next">${won ? 'Play again' : `Deal round ${game.round + 1}`} →</button>`);
  $('#btn-next').onclick = () => {
    if (busy || modalKind !== 'results') return;
    if (won) return showSetup();
    closeModal();
    transition(() => E.nextRound(game));
  };
}

function showRules() {
  if (busy) return;
  openModal('rules', `
    <p class="eyebrow">THE SHORT VERSION</p><h2 id="modal-title">One more. Or no more.</h2>
    <p class="modal-description">Hit to draw. Stay to bank your round points. Keep different numbers — a duplicate busts your round.</p>
    <div class="rules-grid">
      <div class="rule-row"><span class="rule-icon">7</span><div><strong>Seven different numbers changes everything.</strong><p>Collect seven for +15 bonus points. The round ends immediately and every non-busted player scores their cards.</p></div></div>
      <div class="rule-row"><span class="rule-icon">❄</span><div><strong>Freeze</strong><p>Choose any active player, including yourself. They bank their points and leave the round.</p></div></div>
      <div class="rule-row"><span class="rule-icon">↻</span><div><strong>Flip Three</strong><p>Choose an active player, including yourself, to draw up to three cards. Bust or Flip 7 stops the draws. Queued actions resolve afterward.</p></div></div>
      <div class="rule-row"><span class="rule-icon">♥</span><div><strong>Second Chance</strong><p>Cancel one duplicate: discard the duplicate and this card, then keep your hand. Already holding one? Give the extra to an eligible player, or discard it if nobody can receive it.</p></div></div>
    </div>
    <div class="faq">
      <details open><summary>How are the points counted?</summary><p>Add your number cards. ×2 doubles only that number sum. Add the +2 to +10 modifiers, then a +15 Flip 7 bonus if earned. Modifiers score even without a number card. The 0 is a number and counts toward seven.</p></details>
      <details><summary>Who wins? What about a tie?</summary><p>Check for 200 only after the round naturally ends: everyone has stopped, or someone flips seven. If at least one total is 200 or more, the highest total wins. If the highest total is tied, all three players play another round.</p></details>
      <details><summary>What happens to actions during Flip Three?</summary><p>Freeze and Flip Three wait until the forced draws finish. A Second Chance applies immediately, including giving away an extra one. If a recipient busts, that forced batch’s queued actions are discarded; earlier batches still resolve. Flip 7 ends the whole round immediately. Normal play resumes clockwise after the original action drawer.</p></details>
      <details><summary>Can I stay with no number cards?</summary><p>Yes — if you have any card in front of you, including an action or modifier. A banked zero is not a bust. With no cards at all you must hit.</p></details>
      <details><summary>What if the deck runs out?</summary><p>The deck is shuffled once at the start, then used across rounds without reshuffling. Only when the next draw finds it empty do the discards automatically form a shuffled new deck. No manual click is needed. Cards still in players’ hands stay out.</p></details>
      <details><summary>What is your opening-deal house rule?</summary><p>Every player always receives exactly one face-up card before an opening Freeze or Flip Three resolves. This keeps all three friends in the opening deal. It is our table’s explicit house rule; the publisher FAQ resolves an opening action immediately.</p></details>
      <details><summary>Playing on one computer</summary><p>The highlighted player is on turn. Space performs the one safe next action: Hit, continue to the next round, or choose a target when only one is legal. Esc stays. H and S also work. If an action has multiple legal targets, choose one on the table. In a dialog, Esc closes it and Space activates its primary continuation when unambiguous. Shortcuts are disabled while cards are moving. Your game and lifetime leaderboard save on this device.</p></details>
    </div>
    <a class="source-link" href="https://theop.games/products/flip-7" target="_blank" rel="noopener noreferrer">Based on the publisher’s revised classic rules & FAQ ↗</a>
    <button class="primary" id="btn-close-rules">Got it. Back to the table.</button>`);
  $('#btn-close-rules').onclick = closeModal;
}

function showHistory() {
  if (!game || busy) return;
  openModal('history', `<p class="eyebrow">EVERY ROUND, REMEMBERED</p><h2 id="modal-title">The score so far.</h2><p class="modal-description">Round points, automatically counted. A zero is only a bust when the hand says so.</p>${history.length ? `<table class="round-history"><thead><tr><th scope="col">Round</th>${names.map(name => `<th scope="col">${esc(name)}</th>`).join('')}</tr></thead><tbody>${history.map(round => `<tr><th scope="row">${round.round}</th>${round.results.map(result => `<td>${result.roundScore}${round.statuses?.[result.player] === 'busted' ? ' · bust' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="round-banner">No completed rounds yet. There’s still plenty of game ahead.</div>'}<button class="primary" id="btn-close-history">Back to the table</button>`);
  $('#btn-close-history').onclick = closeModal;
}

function showLeaderboard() {
  if (busy) return;
  const rows = leaderboard.map((row, index) => `<div class="leader-row"><span class="leader-rank">${index + 1}</span><span class="leader-name">${esc(row.name)}</span><strong>${row.wins}<small>WINS</small></strong><strong>${row.points}<small>POINTS</small></strong><span>${row.games}<small>GAMES</small></span><span>${row.best}<small>BEST</small></span></div>`).join('');
  openModal('leaders', `<p class="eyebrow">YOUR TABLE, OVER TIME</p><h2 id="modal-title">Leaderboard.</h2><p class="modal-description">Saved on this device. Ranked by wins, then lifetime points. Use the same player names to keep building your record.</p>${rows ? `<div class="leaderboard">${rows}</div>` : '<div class="round-banner">No finished games yet. The first winner gets the top spot.</div>'}<button class="primary" id="btn-close-leaders">Back to the table</button>`);
  $('#btn-close-leaders').onclick = closeModal;
}

function confetti() {
  if (reducedMotion.matches) return;
  const host = $('#celebration');
  host.innerHTML = Array.from({ length: 50 }, (_, index) => `<i class="confetto" style="--x:${(index * 37) % 100}%;--color:${COLORS[index % 3]};--delay:${(index % 9) * .08}s;--duration:${2.1 + (index % 7) * .15}s"></i>`).join('');
  setTimeout(() => host.replaceChildren(), 4200);
}

$('#btn-rules').onclick = showRules;
$('#btn-new').onclick = showNewGame;
$('#btn-history').onclick = showHistory;
$('#btn-leaders').onclick = showLeaderboard;
$('#btn-sound').onclick = () => {
  soundOn = !soundOn;
  $('#btn-sound').textContent = soundOn ? 'Sound on' : 'Sound off';
  $('#btn-sound').setAttribute('aria-pressed', String(soundOn));
  $('#btn-sound').setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
  savePreferences();
  if (soundOn) sound('stay');
};
modal.addEventListener('cancel', event => {
  event.preventDefault();
  if (modalKind === 'setup' && !game) return;
  closeModal();
});
function activateSpace() {
  if (modal.open) {
    const buttonId = { results: '#btn-next', rules: '#btn-close-rules', history: '#btn-close-history', leaders: '#btn-close-leaders', error: '#btn-error-close' }[modalKind];
    const button = buttonId && $(buttonId);
    if (!button) return false;
    button.click();
    return true;
  }
  if (game?.phase === 'turn') {
    act('hit');
    return true;
  }
  if (game?.phase === 'targeting' && game.pendingAction.eligible.length === 1) {
    act('target', game.pendingAction.eligible[0]);
    return true;
  }
  return false;
}

document.addEventListener('keydown', event => {
  if (event.repeat && ['Enter', ' ', 'Escape', 'Esc', 'h', 'H', 's', 'S'].includes(event.key)) {
    event.preventDefault();
    return;
  }
  if ((event.key === 'Escape' || event.key === 'Esc') && modal.open) {
    event.preventDefault();
    if (modalKind !== 'setup' || game) closeModal();
    return;
  }
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === ' ') {
    event.preventDefault();
    if (!busy) activateSpace();
    return;
  }
  if (modal.open) return;
  const move = event.key.toLowerCase() === 'h' ? 'hit' : ['Escape', 'Esc', 's', 'S'].includes(event.key) ? 'stay' : null;
  if (move) {
    event.preventDefault();
    if (!busy) act(move);
  }
});

const preferences = reviewMode ? null : storageRead(PREFERENCES_KEY);
leaderboard = reviewMode ? [] : cleanLeaderboard(storageRead(LEADERBOARD_KEY));
if (preferences?.names?.length === 3 && preferences.names.every(name => typeof name === 'string')) names = preferences.names.map((name, index) => name.trim().slice(0, 18) || `Player ${index + 1}`);
soundOn = preferences?.soundOn === true;
$('#btn-sound').textContent = soundOn ? 'Sound on' : 'Sound off';
$('#btn-sound').setAttribute('aria-pressed', String(soundOn));
$('#btn-sound').setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
const saved = reviewMode ? null : storageRead(STORAGE_KEY);
if (saved?.game && E.restoreGame) {
  try {
    game = E.restoreGame(saved.game);
    if (game.players.length !== 3) throw new Error('This table requires three players.');
    names = game.players.map(player => player.name);
    view = snapshot();
    announce('Welcome back. Your table is exactly where you left it.');
    resultRecorded = saved.resultRecorded === true;
  } catch { game = null; view = null; }
  if (game) {
    history = Array.isArray(saved.history) ? saved.history.filter(round => round && Number.isInteger(round.round) && round.round > 0 && round.round <= game.round && (round.flip7Player == null || [0, 1, 2].includes(round.flip7Player)) && Array.isArray(round.results) && round.results.length === 3 && round.results.every((result, index) => result && result.player === index && Number.isInteger(result.roundScore) && result.roundScore >= 0 && Number.isInteger(result.total) && result.total >= 0)) : [];
    lastRound = history.find(round => round.round === game.round) || null;
    const canonical = E.buildDeck().find(card => card.id === saved.latestCard?.id);
    if (canonical && ['type', 'value', 'action', 'mod', 'bonus'].every(key => canonical[key] === saved.latestCard[key])) {
      latestCard = canonical;
      latestCardOwner = [0, 1, 2].includes(saved.latestCardOwner) ? saved.latestCardOwner : null;
    }
  }
}
if (reviewMode) {
  game = createReviewGame(reviewScenario);
  E.takeEvents(game);
  view = snapshot();
  names = game.players.map(player => player.name);
  $('#review-banner').hidden = false;
  $('#review-name').textContent = reviewScenario;
  announce('Review scenario: legal engine-built hands. This is not your live game.');
}
recordResultOnce();
render();
if (game) {
  save();
  if (game.phase === 'roundEnd' || game.phase === 'gameOver') showResults();
} else showSetup();
