'use strict';

// sync uploads with -f replace unless the target opted in to keeping versions, in which case it
// uploads with -f create-new-revision. A fake CLI (PROTON_DRIVE_BIN) records every call.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function world(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-versions-'));
  t.after(() => {
    if (!root.startsWith(os.tmpdir()) || !path.basename(root).startsWith('proton-versions-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(__dirname, '..', 'backup.js'), path.join(root, 'backup.js'));
  const vaultA = path.join(root, 'vault-a');
  const vaultB = path.join(root, 'vault-b');
  for (const dir of [vaultA, vaultB]) {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config({ vaultA, vaultB })) + '\n');
  const log = path.join(root, 'calls.jsonl');
  const fake = path.join(root, 'fake-proton.js');
  fs.writeFileSync(fake, `
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('fake 0.9.0'); process.exit(0); }
if (args[0] === 'filesystem' && args[1] === 'list') { console.log('[]'); process.exit(0); }
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
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'backup.js'), ...args],
    { encoding: 'utf8', env: { ...process.env, PROTON_DRIVE_BIN: bin }, cwd: root });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const uploads = () => calls().filter((a) => a[0] === 'filesystem' && a[1] === 'upload');
  const readConfig = () => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  return { root, run, uploads, readConfig };
}

const twoTargets = ({ vaultA, vaultB }) => ({
  targets: {
    default: { vaultPath: vaultA, remoteFolder: '/my-files/backups/host/vault', keepVersions: true },
    keys: { vaultPath: vaultB, remoteFolder: '/my-files/backups/shared/keys' },
  },
});

test('a keepVersions target uploads with -f create-new-revision', (t) => {
  const w = world(t, twoTargets);
  const r = w.run('sync');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = w.uploads();
  assert.deepEqual(call.slice(-4), ['-d', 'merge', '-f', 'create-new-revision']);
});

test('a target without keepVersions still uploads with -f replace', (t) => {
  const w = world(t, twoTargets);
  const r = w.run('sync', '--target', 'keys');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = w.uploads();
  assert.deepEqual(call.slice(-4), ['-d', 'merge', '-f', 'replace']);
});

test('a flat (pre-targets) config honors a top-level keepVersions', (t) => {
  const w = world(t, ({ vaultA }) => ({
    vaultPath: vaultA, remoteFolder: '/my-files/backups/host/vault', keepVersions: true,
  }));
  const r = w.run('sync');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.uploads()[0].slice(-1)[0], 'create-new-revision');
});

test('set-target turns versions on and off without touching other targets or needing a login', (t) => {
  const w = world(t, ({ vaultA, vaultB }) => ({
    targets: {
      default: { vaultPath: vaultA, remoteFolder: '/my-files/backups/host/vault' },
      keys: { vaultPath: vaultB, remoteFolder: '/my-files/backups/shared/keys' },
    },
  }));
  const on = w.run('set-target', 'default', '--keep-versions', 'on');
  assert.equal(on.status, 0, on.stdout + on.stderr);
  assert.equal(w.readConfig().targets.default.keepVersions, true);
  assert.equal(w.readConfig().targets.keys.keepVersions, undefined);
  assert.match(w.run('targets').stdout, /default: .*\[keeps old versions\]/);

  const off = w.run('set-target', 'default', '--keep-versions', 'off');
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.equal('keepVersions' in w.readConfig().targets.default, false);

  const unknown = w.run('set-target', 'nope', '--keep-versions', 'on');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown target "nope"/);
  const badValue = w.run('set-target', 'default', '--keep-versions', 'maybe');
  assert.equal(badValue.status, 1);
  assert.equal(w.uploads().length, 0, 'set-target must not call the CLI');
});
