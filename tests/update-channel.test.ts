import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultUpdateChannel,
  isPrereleaseVersion,
  parseUpdateChannel,
} from '../apps/desktop/src/update-channel.js';

void test('stable versions default to the stable update channel', () => {
  assert.equal(isPrereleaseVersion('1.2.3'), false);
  assert.equal(isPrereleaseVersion('1.2.3+build.5'), false);
  assert.equal(defaultUpdateChannel('1.2.3'), 'stable');
});

void test('beta versions default to the beta update channel', () => {
  assert.equal(isPrereleaseVersion('1.2.3-beta.1'), true);
  assert.equal(defaultUpdateChannel('1.2.3-beta.1'), 'beta');
});

void test('saved update channels accept only known values', () => {
  assert.equal(parseUpdateChannel('beta'), 'beta');
  assert.equal(parseUpdateChannel('stable'), 'stable');
  assert.equal(parseUpdateChannel('prod'), null);
  assert.equal(parseUpdateChannel(undefined), null);
});
