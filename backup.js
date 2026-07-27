#!/usr/bin/env node
'use strict';

/**
 * proton-drive-backup — a thin wrapper around the official Proton Drive CLI
 * (`proton-drive`) for keeping a local "vault" folder synced to a dedicated,
 * encrypted Proton Drive folder. Not a versioned backup tool — see README.md.
 *
 * The `proton-drive` CLI shipped June 2026 and its exact subcommand syntax
 * may drift. If a command below stops matching `proton-drive --help`,
 * update the runProton() invocations to match.
 */

const { spawnSync } = require('child_process');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOCAL_BIN_DIR = path.join(__dirname, 'bin');
// Last known-good version, used only if live version discovery fails.
const FALLBACK_CLI_VERSION = '0.6.0';

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.warn(`Warning: could not parse ${CONFIG_PATH}, ignoring it (${err.message})`);
    }
  }
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function defaultVaultPath() {
  return path.join(os.homedir(), 'Documents', 'proton-vault');
}

function defaultRemoteFolder() {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-');
  return `/backups/${hostname}`;
}

// CLI 0.6.0's root namespace is "/my-files" — a bare "/backups/..." path is
// not valid on its own. Verified live against a real authenticated account
// 2026-07-28. Applied here, at the single read choke point, so every
// existing config.json (saved before this fix) self-heals on next read
// without anyone needing to hand-edit it.
function normalizeRemoteFolder(folder) {
  let f = folder.trim().replace(/\/+$/, '');
  if (!f.startsWith('/')) f = '/' + f;
  if (f !== '/my-files' && !f.startsWith('/my-files/')) {
    f = '/my-files' + f;
  }
  return f || '/my-files';
}

/** Shared primitive: does `path` exist and list cleanly? */
function listPath(remotePath) {
  return runProton(['filesystem', 'list', remotePath, '--json']);
}

function vaultPath() {
  const config = loadConfig();
  return process.env.PROTON_VAULT_PATH || config.vaultPath || defaultVaultPath();
}

function remoteFolder() {
  const config = loadConfig();
  const raw = process.env.PROTON_BACKUP_FOLDER || config.remoteFolder || defaultRemoteFolder();
  return normalizeRemoteFolder(raw);
}

/** Resolution order: explicit env override > a binary this tool installed itself > PATH. */
function protonBinPath() {
  if (process.env.PROTON_DRIVE_BIN) return process.env.PROTON_DRIVE_BIN;
  const config = loadConfig();
  if (config.protonBinPath && fs.existsSync(config.protonBinPath)) return config.protonBinPath;
  return 'proton-drive';
}

// Manual line-queue readline, not repeated rl.question() calls: with piped
// (non-TTY) stdin, Node can deliver multiple buffered lines before a second
// question() is registered, and any line arriving without a pending listener
// is silently dropped. A persistent 'line' listener + FIFO queue is reliable
// for both interactive and piped input.
let rlInstance = null;
let lineQueue = [];
let lineWaiters = [];

function getReadline() {
  if (!rlInstance) {
    rlInstance = readline.createInterface({ input: process.stdin, output: process.stdout });
    rlInstance.on('line', (line) => {
      if (lineWaiters.length) lineWaiters.shift()(line);
      else lineQueue.push(line);
    });
  }
  return rlInstance;
}

function closeReadline() {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

function ask(question) {
  getReadline();
  process.stdout.write(question);
  return new Promise((resolve) => {
    if (lineQueue.length) {
      resolve(lineQueue.shift().trim());
    } else {
      lineWaiters.push((line) => resolve(line.trim()));
    }
  });
}

function binaryExists(bin) {
  const result = spawnSync(bin, ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Run a proton-drive subcommand, capturing output. Returns
 * { ok, stdout, stderr, status, authFailure }.
 * authFailure is a best-effort guess based on common wording in Proton's
 * CLI errors for an expired/missing session — not a documented contract.
 */
function runProton(args, opts = {}) {
  const result = spawnSync(protonBinPath(), args, {
    stdio: opts.inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const ok = result.status === 0;
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const authFailure = !ok && /(auth|login|session|unauthor|forbidden|401|403)/.test(combined);
  return { ok, stdout, stderr, status: result.status, authFailure };
}

function printAuthHelp() {
  console.error('\nYour Proton session has expired (or you have not logged in yet).');
  console.error('Run: node backup.js setup');
  console.error('Then try your command again.\n');
}

/** win32/darwin/linux + x64/arm64 -> Proton's download-page naming, or null if unsupported. */
function detectPlatformKey() {
  const arch = process.arch;
  if (arch !== 'x64' && arch !== 'arm64') return null;
  if (process.platform === 'win32') return { os: 'windows', arch, ext: '.exe' };
  if (process.platform === 'darwin') return { os: 'darwin', arch, ext: '' };
  if (process.platform === 'linux') return { os: 'linux', arch, ext: '' };
  return null;
}

function httpGetFollow(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpGetFollow(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function discoverCliVersion() {
  try {
    const res = await httpGetFollow('https://proton.me/download/drive/cli/index.html');
    let body = '';
    for await (const chunk of res) body += chunk;
    const match = body.match(/\/download\/drive\/cli\/(\d+\.\d+\.\d+)\//);
    return match ? match[1] : FALLBACK_CLI_VERSION;
  } catch (err) {
    return FALLBACK_CLI_VERSION;
  }
}

async function downloadFile(url, destPath) {
  const res = await httpGetFollow(url);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    res.on('error', reject);
  });
}

/** Best-effort automatic install into ./bin. Returns true on success. */
async function tryAutoInstall() {
  const plat = detectPlatformKey();
  if (!plat) {
    console.error(`Automatic install is not supported on this platform/architecture (${process.platform}/${process.arch}).`);
    return false;
  }

  try {
    const version = await discoverCliVersion();
    const url = `https://proton.me/download/drive/cli/${version}/${plat.os}-${plat.arch}/proton-drive${plat.ext}`;
    fs.mkdirSync(LOCAL_BIN_DIR, { recursive: true });
    const dest = path.join(LOCAL_BIN_DIR, `proton-drive${plat.ext}`);

    console.log(`Downloading Proton Drive CLI ${version} for ${plat.os}-${plat.arch} (roughly 100+ MB, may take a minute)...`);
    await downloadFile(url, dest);
    if (plat.ext !== '.exe') fs.chmodSync(dest, 0o755);

    if (!binaryExists(dest)) {
      console.error('Downloaded binary did not run correctly.');
      return false;
    }

    const config = loadConfig();
    config.protonBinPath = dest;
    saveConfig(config);
    console.log(`Installed Proton Drive CLI to ${dest}`);
    return true;
  } catch (err) {
    console.error(`Automatic install failed: ${err.message}`);
    return false;
  }
}

async function ensureBinary() {
  if (binaryExists(protonBinPath())) return;

  console.log('Proton Drive CLI not found — attempting automatic install...');
  const installed = await tryAutoInstall();
  if (installed) return;

  console.error('\nCould not install the Proton Drive CLI automatically.');
  console.error('Install it yourself, then re-run this command:');
  console.error('  https://proton.me/support/drive-cli');
  console.error('  https://proton.me/download/drive/cli/index.html');
  console.error('(Or set PROTON_DRIVE_BIN to the full path of an existing "proton-drive" binary.)');
  process.exit(1);
}

function ensureVault(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function ensureProtonAccount() {
  const has = await ask('Do you already have a Proton account (proton.me)? [y/N]: ');
  if (/^y/i.test(has.trim())) return;

  console.log('\nYou need a free Proton account before you can log in.');
  console.log('Sign up here (Drive is included with any Proton account, no card required):');
  console.log('  https://proton.me/mail/signup\n');

  for (;;) {
    const answer = await ask('Type "done" once you have created your account (or "skip" to stop here): ');
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'done' || normalized === 'y' || normalized === 'yes') {
      return;
    }
    if (normalized === 'skip') {
      console.log('\nOkay. Re-run "node backup.js setup" once you have a Proton account.');
      process.exit(0);
    }
    console.log('Waiting for you to finish creating an account at https://proton.me/mail/signup ...');
  }
}

async function cmdSetup() {
  await ensureProtonAccount();
  await ensureBinary();

  const config = loadConfig();

  const currentVault = config.vaultPath || defaultVaultPath();
  const chosenVault = await ask(`Local vault folder [${currentVault}]: `);
  const vault = chosenVault || currentVault;
  config.vaultPath = vault;

  const modeAnswer = await ask(
    'Is this vault specific to this machine, or a shared vault you will connect ' +
    'from multiple computers (advanced)? [per-machine/shared, default per-machine]: '
  );
  const shared = /^shared/i.test(modeAnswer.trim());
  const remoteDefault = normalizeRemoteFolder(
    config.remoteFolder || (shared ? '/backups/shared' : defaultRemoteFolder())
  );
  if (shared) {
    console.log('\nShared mode: use this exact same remote folder name on every machine');
    console.log('you want connected to this vault.');
  }

  const chosenFolder = await ask(`Remote backup folder [${remoteDefault}]: `);
  const folder = normalizeRemoteFolder(chosenFolder || remoteDefault);
  config.remoteFolder = folder;

  closeReadline(); // release stdin cleanly before spawning `proton-drive auth login` with inherited stdio

  saveConfig(config);
  ensureVault(vault);
  console.log(`\nVault folder ready at: ${vault}`);
  console.log('This is a plain local folder. Drop files into it however you like');
  console.log('(this command, or your OS file browser), then run "node backup.js sync".');
  console.log('If this folder lives inside something already cloud-synced (OneDrive,');
  console.log('iCloud Drive, etc.), consider picking a different location to avoid');
  console.log('double-syncing the same files through two services.');

  console.log('\nOpening Proton Drive login. Finish the login in your browser, then return here.\n');
  const login = runProton(['auth', 'login'], { inherit: true });
  if (!login.ok) {
    console.error('\nLogin did not complete successfully. Re-run "node backup.js setup" to try again.');
    process.exit(1);
  }

  console.log('\nVerifying the session...');
  const check = listPath(folder);
  if (!check.ok) {
    console.log(`Folder "${folder}" was not found yet — that is expected on first use.`);
    console.log('It will be created automatically the first time you run "node backup.js sync".');
  } else {
    console.log(`Session verified. Remote folder "${folder}" already exists — it may have`);
    console.log('files in it already (from another machine, or a previous install here).');
    const pull = await ask('Pull them into your local vault now? [Y/n]: ');
    if (!/^n/i.test(pull.trim())) {
      await cmdPull();
    }
  }

  console.log('\nSetup complete. You should not need to log in again until your session eventually expires.');
}

/**
 * Exit code is the real signal here, not just the printed text: 0 means
 * "safe to proceed" (session valid, or the only problem is a folder that
 * doesn't exist yet — harmless, sync creates it), non-zero means "you need
 * to re-run setup." A missing/unreachable folder is deliberately treated as
 * success, not failure — only an auth-shaped error sets a non-zero exit.
 */
async function cmdCheck() {
  await ensureBinary();
  const folder = remoteFolder();
  const result = listPath(folder);
  if (result.ok) {
    console.log(`Session OK. "${folder}" is reachable.`);
    return;
  }
  if (result.authFailure) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }
  console.log(`"${folder}" was not reachable, but that's expected if it doesn't exist yet`);
  console.log('(it gets created automatically on first sync) — not treated as a failure.');
}

/**
 * `filesystem upload` does not create missing parent folders on its own
 * (verified live 2026-07-28: uploading into a non-existent chain fails
 * outright). Walk the target path and create whatever segments are missing
 * with `filesystem create-folder`, below the root namespace itself (the
 * first segment, e.g. "my-files" — that's intrinsic, never created here).
 * Best-effort: any failure here just falls through to the real upload/
 * download call, which reports the actual error if something is still wrong.
 */
function ensureRemoteFolder(folder) {
  const segments = folder.split('/').filter(Boolean);
  if (segments.length <= 1) return;
  let current = '/' + segments[0];
  for (let i = 1; i < segments.length; i++) {
    const name = segments[i];
    const next = `${current}/${name}`;
    const check = listPath(next);
    if (!check.ok && !check.authFailure) {
      console.log(`Remote folder "${next}" not found — creating it...`);
      runProton(['filesystem', 'create-folder', current, name]);
    }
    current = next;
  }
}

function cmdMove(filePath, opts = {}) {
  if (!filePath) {
    console.error('Usage: node backup.js move <file> [--copy]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`No such file: ${filePath}`);
    process.exit(1);
  }
  const vault = vaultPath();
  ensureVault(vault);
  const dest = path.join(vault, path.basename(filePath));
  if (opts.copy) {
    fs.copyFileSync(filePath, dest);
    console.log(`Copied into vault: ${dest}`);
  } else {
    fs.renameSync(filePath, dest);
    console.log(`Moved into vault: ${dest}`);
  }
  console.log('Run "node backup.js sync" when you are ready to upload the vault.');
}

async function cmdSync() {
  await ensureBinary();
  const vault = vaultPath();
  ensureVault(vault);
  const folder = remoteFolder();

  const entries = fs.readdirSync(vault).filter((name) => name !== 'config.json' && !name.startsWith('.'));
  if (entries.length === 0) {
    console.log(`Vault at ${vault} is empty — nothing to sync.`);
    return;
  }

  ensureRemoteFolder(folder);

  console.log(`Uploading ${vault} -> ${folder} ...`);
  const result = runProton(['filesystem', 'upload', vault, folder, '-d', 'merge', '-f', 'replace'], { inherit: true });
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
    } else {
      console.error('Sync failed. If this keeps happening, check "proton-drive --help" — the CLI\'s command syntax may have changed since this tool was written.');
    }
    process.exit(1);
  }
  console.log(`\nSync complete. Confirm it in your browser at https://drive.proton.me`);
  console.log('Note: sync only uploads. Removing a file from the vault does not delete it remotely.');
}

async function cmdPull() {
  await ensureBinary();
  const vault = vaultPath();
  ensureVault(vault);
  const folder = remoteFolder();

  const precheck = listPath(folder);
  if (!precheck.ok) {
    if (precheck.authFailure) {
      printAuthHelp();
      process.exitCode = 1;
    } else {
      console.log(`"${folder}" doesn't exist yet — nothing to pull.`);
    }
    return;
  }

  console.log(`Downloading ${folder} -> ${vault} ...`);
  const result = runProton(['filesystem', 'download', folder, vault, '-d', 'merge', '-f', 'replace'], { inherit: true });
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
    } else {
      console.error('Pull failed. If this keeps happening, check "proton-drive --help" — the CLI\'s command syntax may have changed since this tool was written.');
    }
    process.exit(1);
  }
  console.log('\nPull complete.');
  console.log('Note: pull only adds/updates files locally — it does not delete anything from');
  console.log('your vault that is not present remotely. Combined with sync\'s matching');
  console.log('upload-only guarantee, neither command can ever wipe out the other side.');
}

async function cmdAdd(filePath) {
  cmdMove(filePath, { copy: false });
  await cmdSync();
}

async function cmdBoth() {
  console.log('Running both: pulling remote first, then syncing local up...\n');
  await cmdPull();
  console.log('');
  await cmdSync();
  console.log('\nBoth complete. Local vault and remote folder now hold the union of both sides.');
}

async function cmdList() {
  await ensureBinary();
  const folder = remoteFolder();
  const result = listPath(folder);
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
      process.exitCode = 1;
      return;
    }
    console.log(`"${folder}" doesn't exist yet — nothing to list.`);
    return;
  }
  console.log(result.stdout.trim() || '(empty)');
}

async function cmdGet(name, destDir) {
  if (!name) {
    console.error('Usage: node backup.js get <remote-file-name> [local-dest-dir]');
    process.exit(1);
  }
  await ensureBinary();
  const folder = remoteFolder();
  const dest = destDir || '.';
  fs.mkdirSync(dest, { recursive: true });
  const remotePath = `${folder}/${name}`;
  const result = runProton(['filesystem', 'download', remotePath, dest, '-d', 'merge', '-f', 'replace'], { inherit: true });
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
    } else {
      console.error(`Could not download "${remotePath}". Check "node backup.js list" for the exact name.`);
    }
    process.exit(1);
  }
  console.log(`\nDownloaded to ${dest}`);
}

function printHelp() {
  console.log(`proton-drive-backup — simple encrypted file drop on Proton Drive

A local "vault" folder (default ~/Documents/proton-vault) mirrors to a
dedicated Proton Drive folder. Organize the vault with this CLI or your
OS file browser, then sync. "setup" installs the official Proton Drive CLI
automatically on Windows/macOS/Linux (x64/arm64) if it is not already on
your PATH.

Usage:
  node backup.js setup              One-time: CLI install + vault + login
  node backup.js check              Verify your session is still valid
  node backup.js move <file> [--copy]  Move (or copy) a file into the vault
  node backup.js sync               Upload the whole vault to Proton Drive
  node backup.js pull               Download the whole remote folder into the vault
  node backup.js both               Pull, then sync: make both sides hold everything
  node backup.js add <path>         Shorthand: move + sync in one step
  node backup.js list               List what is in your remote backup folder
  node backup.js get <name> [dest]  Download a file back down

"sync" (a.k.a. push) and "pull" are separate one-way directions: sync never
deletes remotely, pull never deletes locally, so running them in either order
can never wipe out either side. "both" is a convenience that just runs pull
then sync back-to-back for you when you want both sides fully caught up in
one command — it does not change what sync or pull do on their own.

Not a versioned backup tool. See README.md for what this is and is not.`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'setup':
      await cmdSetup();
      break;
    case 'check':
      await cmdCheck();
      break;
    case 'move':
      cmdMove(rest.find((a) => a !== '--copy'), { copy: rest.includes('--copy') });
      break;
    case 'sync':
      await cmdSync();
      break;
    case 'pull':
      await cmdPull();
      break;
    case 'both':
      await cmdBoth();
      break;
    case 'add':
      await cmdAdd(rest[0]);
      break;
    case 'list':
      await cmdList();
      break;
    case 'get':
      await cmdGet(rest[0], rest[1]);
      break;
    default:
      printHelp();
      process.exit(cmd ? 1 : 0);
  }
}

main();
