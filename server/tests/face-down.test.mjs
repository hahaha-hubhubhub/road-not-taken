import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context = {};
runInNewContext(readFileSync(new URL('../../web/regret-remedy/face-down.js', import.meta.url), 'utf8'), context);
const create = context.RNTFaceDown.create;

test('brief tilt, screen-up, and invalid samples do not reveal a receipt', () => {
  const gesture = create();
  assert.equal(gesture.sample(0, 0, 0), null);
  assert.equal(gesture.sample(80, 0, 100), null);
  assert.equal(gesture.sample(175, 0, 200), null);
  assert.equal(gesture.sample(0, 0, 300), null);
  assert.equal(gesture.sample(null, 0, 350), null);
  assert.equal(gesture.phase, 'waiting');
});

test('screen down must be held, then returned face-up exactly once', () => {
  const gesture = create();
  assert.equal(gesture.sample(172, 5, 100), null);
  assert.equal(gesture.sample(174, 4, 400), null);
  assert.equal(gesture.sample(170, 2, 750), 'down');
  assert.equal(gesture.sample(170, 2, 850), null);
  assert.equal(gesture.sample(0, 0, 950), 'complete');
  assert.equal(gesture.sample(0, 0, 1000), null);
});

test('interrupted sensor stream cannot count toward continuous hold', () => {
  const gesture = create();
  assert.equal(gesture.sample(-170, 3, 0), null);
  assert.equal(gesture.sample(-170, 3, 200), null);
  assert.equal(gesture.sample(-170, 3, 1000), null);
  assert.equal(gesture.sample(-170, 3, 1400), null);
  assert.equal(gesture.sample(-170, 3, 1750), 'down');
  gesture.reset();
  assert.equal(gesture.phase, 'waiting');
  assert.equal(gesture.sample(0, 0, 1800), null);
});
