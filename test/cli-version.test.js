'use strict';

// `setup` installs the pinned, tested Proton Drive CLI version by default, whatever Proton lists
// as newest. A newer or specific version is opt-in.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveCliVersion, PINNED_CLI_VERSION } = require('../backup.js');

const newer = async () => '9.9.9';

test('with no request the pinned version is used and discovery is never consulted', async () => {
  let asked = false;
  const version = await resolveCliVersion('', async () => { asked = true; return '9.9.9'; });
  assert.equal(version, PINNED_CLI_VERSION);
  assert.equal(asked, false);
  assert.match(PINNED_CLI_VERSION, /^\d+\.\d+\.\d+$/);
});

test('"latest" opts in to whatever discovery returns', async () => {
  assert.equal(await resolveCliVersion('latest', newer), '9.9.9');
});

test('an explicit x.y.z is installed as given', async () => {
  assert.equal(await resolveCliVersion('0.8.0', newer), '0.8.0');
});

test('anything else is refused with a clear message', async () => {
  await assert.rejects(resolveCliVersion('newest', newer), /Invalid CLI version "newest"/);
  await assert.rejects(resolveCliVersion('0.9', newer), /Invalid CLI version "0.9"/);
  await assert.rejects(resolveCliVersion('../../x', newer), /Invalid CLI version/);
});
