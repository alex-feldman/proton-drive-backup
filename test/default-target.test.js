'use strict';

// A config with a `targets` map but no `default` must not silently fall back to the built-in
// default vault folder and per-hostname remote folder. Asking for `default` is an error, and
// `add-target default` can then create it.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function world(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-nodefault-'));
  t.after(() => {
    if (!root.startsWith(os.tmpdir()) || !path.basename(root).startsWith('proton-nodefault-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(__dirname, '..', 'backup.js'), path.join(root, 'backup.js'));
  const keysDir = path.join(root, 'keys');
  fs.mkdirSync(keysDir);
  fs.writeFileSync(path.join(keysDir, 'secret.txt'), 'x');
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config(keysDir)) + '\n');
  const log = path.join(root, 'calls.jsonl');
  const fake = path.join(root, 'fake-proton.js');
  fs.writeFileSync(fake, `
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'filesystem' && args[1] === 'list') { console.log('[]'); }
process.exit(0);
`);
  let bin;
  if (process.platform === 'win32') {
    bin = path.join(root, 'fake-proton.cmd');
    fs.writeFileSync(bin, `@"${process.execPath}" "${fake}" %*\r\n`);
  } else {
    bin = path.join(root, 'fake-proton');
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }
  // HOME points at the sandbox so a wrongly used built-in default folder cannot touch the real one.
  const env = { ...process.env, PROTON_DRIVE_BIN: bin, HOME: root, USERPROFILE: root };
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'backup.js'), ...args],
    { encoding: 'utf8', env, cwd: root });
  const uploads = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])
    .filter((l) => l.includes('"upload"'));
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  return { root, run, uploads, readConfig };
}

const keysOnly = (keysDir) => ({
  targets: { keys: { vaultPath: keysDir, remoteFolder: '/my-files/backups/shared/keys' } },
});

test('sync with no --target errors when the config has targets but no default', (t) => {
  const w = world(t, keysOnly);
  const r = w.run('sync');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Unknown target "default"\. Configured targets: keys/);
  assert.equal(w.uploads().length, 0, 'nothing may be uploaded');
  assert.equal(fs.existsSync(path.join(w.root, 'Documents', 'proton-vault')), false,
    'the built-in default vault folder must not be created');
});

test('the named target still works when there is no default', (t) => {
  const w = world(t, keysOnly);
  const r = w.run('sync', '--target', 'keys');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.uploads().length, 1);
});

test('add-target default works when the targets map lacks it, and is refused when present', (t) => {
  const w = world(t, keysOnly);
  const add = w.run('add-target', 'default', path.join(w.root, 'personal'), '/my-files/backups/host/vault');
  assert.equal(add.status, 0, add.stdout + add.stderr);
  const config = w.readConfig();
  assert.equal(config.targets.default.remoteFolder, '/my-files/backups/host/vault');
  assert.equal(config.targets.keys.remoteFolder, '/my-files/backups/shared/keys');

  const again = w.run('add-target', 'default', path.join(w.root, 'other'), '/my-files/backups/host/other');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already configured/);
});

test('a flat config still has its implicit default and refuses add-target default', (t) => {
  const w = world(t, (keysDir) => ({ vaultPath: keysDir, remoteFolder: '/my-files/backups/host/vault' }));
  const r = w.run('add-target', 'default', path.join(w.root, 'other'), '/my-files/backups/host/other');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"default" already exists implicitly/);
  assert.equal(w.run('sync').status, 0);
});
