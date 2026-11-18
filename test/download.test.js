'use strict';

// pull and get pass the download conflict strategy Proton Drive CLI 0.9.0 accepts. A fake CLI
// (PROTON_DRIVE_BIN) rejects `-f replace` on download the way 0.9.0 does and records each call.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-download-'));
  t.after(() => {
    if (!root.startsWith(os.tmpdir()) || !path.basename(root).startsWith('proton-download-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(__dirname, '..', 'backup.js'), path.join(root, 'backup.js'));
  const vault = path.join(root, 'vault');
  fs.writeFileSync(path.join(root, 'config.json'),
    JSON.stringify({ vaultPath: vault, remoteFolder: '/my-files/backups/host/vault' }) + '\n');
  const log = path.join(root, 'calls.jsonl');
  const fake = path.join(root, 'fake-proton.js');
  fs.writeFileSync(fake, `
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('fake 0.9.0'); process.exit(0); }
if (args[0] === 'filesystem' && args[1] === 'list') {
  console.log(JSON.stringify([{ name: { value: 'a.txt' } }, { name: { value: 'b.txt' } }]));
  process.exit(0);
}
if (args[0] === 'filesystem' && args[1] === 'download') {
  const f = args[args.indexOf('-f') + 1];
  if (!['rename', 'remove', 'skip'].includes(f)) { console.error('invalid file conflict strategy: ' + f); process.exit(2); }
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
  const downloads = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((a) => a[0] === 'filesystem' && a[1] === 'download');
  return { root, run, downloads };
}

test('pull downloads with -f remove, which CLI 0.9.0 accepts', (t) => {
  const w = world(t);
  const r = w.run('pull');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = w.downloads();
  assert.deepEqual(call.slice(-4), ['-d', 'merge', '-f', 'remove']);
  assert.ok(call.includes('/my-files/backups/host/vault/a.txt'));
});

test('get downloads with -f remove', (t) => {
  const w = world(t);
  const r = w.run('get', 'a.txt', path.join(w.root, 'out'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = w.downloads();
  assert.deepEqual(call.slice(-4), ['-d', 'merge', '-f', 'remove']);
  assert.equal(call[2], '/my-files/backups/host/vault/a.txt');
});
