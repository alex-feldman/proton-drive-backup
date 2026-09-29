'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { defaultRemoteFolder, normalizeRemoteFolder, overlappingTarget, resolveTarget } = require('../backup.js');

test('new default destinations have a dedicated vault child', () => {
  assert.equal(normalizeRemoteFolder(defaultRemoteFolder()),
    `/my-files/backups/${os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-')}/vault`);
  assert.equal(normalizeRemoteFolder(defaultRemoteFolder(true)), '/my-files/backups/shared/vault');
});

test('overlap detection uses path segments and works with legacy config', () => {
  const legacy = { vaultPath: '/local/vault', remoteFolder: '/my-files/backups/host' };
  assert.equal(resolveTarget(legacy, 'default').remoteFolder, legacy.remoteFolder);
  for (const candidate of [
    '/my-files/backups/host',
    '/my-files/backups/host/photos',
    '/my-files/backups',
  ]) {
    assert.equal(overlappingTarget(legacy, candidate).name, 'default');
  }
  assert.equal(overlappingTarget(legacy, '/my-files/backups/hosted'), null);
  assert.equal(overlappingTarget(legacy, '/my-files/backups/other'), null);
});

test('add-target refuses overlap without changing config, then accepts a sibling', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proton-targets-'));
  t.after(() => {
    if (!root.startsWith(os.tmpdir()) || !path.basename(root).startsWith('proton-targets-')) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(__dirname, '..', 'backup.js'), path.join(root, 'backup.js'));
  const configPath = path.join(root, 'config.json');
  const original = JSON.stringify({ vaultPath: '/local/vault', remoteFolder: '/my-files/backups/host/vault' }) + '\n';
  fs.writeFileSync(configPath, original);

  const run = (name, remote) => spawnSync(process.execPath,
    [path.join(root, 'backup.js'), 'add-target', name, '/local/other', remote], { encoding: 'utf8' });
  const overlap = run('photos', '/my-files/backups/host/vault/photos');
  assert.equal(overlap.status, 1);
  assert.match(overlap.stderr, /overlaps target "default"/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);

  const sibling = run('photos', '/my-files/backups/host/photos');
  assert.equal(sibling.status, 0, sibling.stderr);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.targets.default.remoteFolder, '/my-files/backups/host/vault');
  assert.equal(config.targets.photos.remoteFolder, '/my-files/backups/host/photos');

  const duplicate = run('photos', '/my-files/backups/host/other');
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).targets.photos.remoteFolder,
    '/my-files/backups/host/photos');
});
