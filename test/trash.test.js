'use strict';

// trash moves one top-level remote item to Proton Drive's Trash, only with --yes, only when the
// item exists remotely and not locally, and never permanently deletes. A fake CLI
// (PROTON_DRIVE_BIN) records each call.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trashNameProblem } = require('../backup.js');

const FOLDER = '/my-files/backups/host/vault';

function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-trash-'));
  t.after(() => {
    if (!root.startsWith(os.tmpdir()) || !path.basename(root).startsWith('proton-trash-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(__dirname, '..', 'backup.js'), path.join(root, 'backup.js'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault);
  fs.writeFileSync(path.join(root, 'config.json'),
    JSON.stringify({ vaultPath: vault, remoteFolder: FOLDER }) + '\n');
  const log = path.join(root, 'calls.jsonl');
  const fake = path.join(root, 'fake-proton.js');
  fs.writeFileSync(fake, `
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('fake 0.9.0'); process.exit(0); }
if (args[0] === 'filesystem' && args[1] === 'list') {
  console.log(JSON.stringify([{ name: { value: 'old.env' } }, { name: { value: 'kept.env' } }]));
  process.exit(0);
}
process.exit(0);
`);
  let bin = fake;
  if (process.platform === 'win32') {
    bin = path.join(root, 'fake-proton.cmd');
    fs.writeFileSync(bin, `@"${process.execPath}" "${fake}" %*\r\n`);
  } else {
    bin = path.join(root, 'fake-proton');
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'backup.js'), ...args],
    { encoding: 'utf8', env: { ...process.env, PROTON_DRIVE_BIN: bin }, cwd: root });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])
    .filter(Boolean).map((l) => JSON.parse(l));
  const destructive = () => calls().filter((a) => a[0] === 'filesystem' && ['trash', 'delete', 'empty-trash'].includes(a[1]));
  return { root, vault, run, destructive };
}

test('without --yes it only reports the plan', (t) => {
  const w = world(t);
  const r = w.run('trash', 'old.env');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Would move/);
  assert.deepEqual(w.destructive(), []);
});

test('with --yes it trashes exactly that item, never deletes', (t) => {
  const w = world(t);
  const r = w.run('trash', 'old.env', '--yes');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(w.destructive(), [['filesystem', 'trash', `${FOLDER}/old.env`]]);
});

test('refuses a name that is not in the remote folder', (t) => {
  const w = world(t);
  const r = w.run('trash', 'missing.env', '--yes');
  assert.equal(r.status, 1);
  assert.deepEqual(w.destructive(), []);
});

test('refuses while the local vault still has the item', (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.vault, 'kept.env'), 'x');
  const r = w.run('trash', 'kept.env', '--yes');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /still in your local vault/);
  assert.deepEqual(w.destructive(), []);
});

test('refuses paths, dots and blanks before touching anything', (t) => {
  const w = world(t);
  for (const bad of ['../x', 'a/b', 'a\\b', '..', '.']) {
    const r = w.run('trash', bad, '--yes');
    assert.equal(r.status, 1, bad);
  }
  assert.deepEqual(w.destructive(), []);
  assert.ok(trashNameProblem(''));
  assert.ok(trashNameProblem(' x'));
  assert.equal(trashNameProblem('old.env'), null);
});
