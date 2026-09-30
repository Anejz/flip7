import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual registered handler, with browser defaults tested separately.
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = source.indexOf('function activateSpace() {');
const end = source.indexOf('\n\nconst preferences', start);
assert.ok(start >= 0 && end > start);
const handlerSource = source.slice(start, end);

function keyboard(options = {}) {
  let handler;
  const moves = [];
  const clicks = [];
  const state = {
    document: { addEventListener: (_, callback) => { handler = callback; } },
    modal: { open: false }, modalKind: null, game: { phase: 'turn', pendingAction: null }, busy: false,
    $: selector => ({ click: () => clicks.push(selector) }),
    act: (move, target) => moves.push(target === undefined ? move : [move, target]),
    closeModal: () => { state.modal.open = false; },
    ...options,
  };
  runInNewContext(handlerSource, state);
  return { moves, clicks, state, press(key, extra = {}) {
    let prevented = false;
    handler({ key, repeat: false, target: { tagName: 'BODY' }, preventDefault: () => { prevented = true; }, ...extra });
    return prevented;
  } };
}

test('Space hits and Escape stays, suppressing native browser activation', () => {
  const k = keyboard();
  assert.equal(k.press(' '), true);
  assert.equal(k.press('Escape'), true);
  assert.equal(k.press('Esc'), true);
  assert.deepEqual(k.moves, ['hit', 'stay', 'stay']);
});

test('Space overrides a focused Stay button without activating it', () => {
  const k = keyboard();
  assert.equal(k.press(' ', { target: { tagName: 'BUTTON', id: 'btn-stay' } }), true);
  assert.deepEqual(k.moves, ['hit']);
});

test('Escape only closes an open dialog; a held Escape cannot then stay', () => {
  const k = keyboard({ modal: { open: true }, modalKind: 'rules' });
  assert.equal(k.press('Escape'), true);
  assert.equal(k.state.modal.open, false);
  assert.equal(k.press('Escape', { repeat: true }), true);
  assert.deepEqual(k.moves, []);
});

test('Space and Escape cannot move during animation, including repeated keys', () => {
  const k = keyboard({ busy: true });
  for (const key of [' ', 'Escape', 'h', 's']) {
    assert.equal(k.press(key), true);
    assert.equal(k.press(key, { repeat: true }), true);
  }
  assert.deepEqual(k.moves, []);
});

test('editing and modified shortcuts do not play moves', () => {
  const k = keyboard();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    assert.equal(k.press(' ', { target }), false);
    assert.equal(k.press('Escape', { target }), false);
  }
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) assert.equal(k.press(' ', { [modifier]: true }), false);
  assert.deepEqual(k.moves, []);
});

test('Space activates an unambiguous dialog continuation', () => {
  const results = keyboard({ modal: { open: true }, modalKind: 'results' });
  assert.equal(results.press(' '), true);
  assert.deepEqual(results.clicks, ['#btn-next']);
  assert.deepEqual(results.moves, []);

  const rules = keyboard({ modal: { open: true }, modalKind: 'rules' });
  rules.press(' ');
  assert.deepEqual(rules.clicks, ['#btn-close-rules']);
});

test('Space waits when a dialog or target choice is ambiguous', () => {
  const setup = keyboard({ modal: { open: true }, modalKind: 'setup', game: null });
  assert.equal(setup.press(' '), true);
  assert.deepEqual(setup.clicks, []);

  const multiple = keyboard({ game: { phase: 'targeting', pendingAction: { eligible: [0, 1, 2] } } });
  assert.equal(multiple.press(' '), true);
  assert.deepEqual(multiple.moves, []);
});

test('Space chooses the only legal action target', () => {
  const k = keyboard({ game: { phase: 'targeting', pendingAction: { eligible: [2] } } });
  assert.equal(k.press(' '), true);
  assert.deepEqual(k.moves, [['target', 2]]);
});

test('initial name setup cannot be dismissed by Escape', () => {
  const k = keyboard({ modal: { open: true }, modalKind: 'setup', game: null });
  assert.equal(k.press('Escape'), true);
  assert.equal(k.state.modal.open, true);
  assert.deepEqual(k.moves, []);
});

test('H and S remain compatible aliases', () => {
  const k = keyboard();
  for (const key of ['h', 'H', 's', 'S']) k.press(key);
  assert.deepEqual(k.moves, ['hit', 'hit', 'stay', 'stay']);
});
