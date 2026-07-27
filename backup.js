#!/usr/bin/env node
'use strict';

/**
 * proton-drive-backup — a thin wrapper around the official Proton Drive CLI
 * (`proton-drive`) for keeping a local "vault" folder synced to a dedicated,
 * encrypted Proton Drive folder. Not a versioned backup tool — see README.md.
 *
 * The `proton-drive` CLI shipped June 2026 and its exact subcommand syntax
 * may drift. If a command below stops matching `proton-drive --help`,
 * update the PROTON_BIN invocations to match.
 */

const { spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROTON_BIN = process.env.PROTON_DRIVE_BIN || 'proton-drive';
const CONFIG_PATH = path.join(__dirname, 'config.json');

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

function vaultPath() {
  const config = loadConfig();
  return process.env.PROTON_VAULT_PATH || config.vaultPath || defaultVaultPath();
}

function remoteFolder() {
  const config = loadConfig();
  return process.env.PROTON_BACKUP_FOLDER || config.remoteFolder || defaultRemoteFolder();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function binaryExists() {
  const result = spawnSync(PROTON_BIN, ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Run a proton-drive subcommand, capturing output. Returns
 * { ok, stdout, stderr, status, authFailure }.
 * authFailure is a best-effort guess based on common wording in Proton's
 * CLI errors for an expired/missing session — not a documented contract.
 */
function runProton(args, opts = {}) {
  const result = spawnSync(PROTON_BIN, args, {
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

function ensureBinary() {
  if (!binaryExists()) {
    console.error(`Could not find "${PROTON_BIN}" on your PATH.`);
    console.error('Install the official Proton Drive CLI first:');
    console.error('  https://proton.me/support/drive-cli');
    console.error('  https://github.com/ProtonDriveApps/sdk (cli/ subpackage, prebuilt binaries or build with Bun)');
    process.exit(1);
  }
}

function ensureVault(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function cmdSetup() {
  ensureBinary();

  const config = loadConfig();

  const currentVault = config.vaultPath || defaultVaultPath();
  const chosenVault = await ask(`Local vault folder [${currentVault}]: `);
  const vault = chosenVault || currentVault;
  config.vaultPath = vault;

  const currentFolder = config.remoteFolder || defaultRemoteFolder();
  const chosenFolder = await ask(`Remote backup folder [${currentFolder}]: `);
  const folder = chosenFolder || currentFolder;
  config.remoteFolder = folder;

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
  const check = runProton(['filesystem', 'list', folder, '--json']);
  if (!check.ok) {
    console.log(`Folder "${folder}" was not found yet — that is expected on first use.`);
    console.log('It will be created automatically the first time you run "node backup.js sync".');
  } else {
    console.log(`Session verified. Remote folder "${folder}" is ready.`);
  }

  console.log('\nSetup complete. You should not need to log in again until your session eventually expires.');
}

function cmdCheck() {
  ensureBinary();
  const folder = remoteFolder();
  const result = runProton(['filesystem', 'list', folder, '--json']);
  if (result.ok) {
    console.log(`Session OK. "${folder}" is reachable.`);
    return true;
  }
  if (result.authFailure) {
    printAuthHelp();
  } else {
    console.error(`Could not reach "${folder}" (it may not exist yet — that is fine before your first sync).`);
    console.error(result.stderr.trim() || result.stdout.trim());
  }
  return false;
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

function cmdSync() {
  ensureBinary();
  const vault = vaultPath();
  ensureVault(vault);
  const folder = remoteFolder();

  const entries = fs.readdirSync(vault).filter((name) => name !== 'config.json' && !name.startsWith('.'));
  if (entries.length === 0) {
    console.log(`Vault at ${vault} is empty — nothing to sync.`);
    return;
  }

  console.log(`Uploading ${vault} -> ${folder} ...`);
  const result = runProton(['filesystem', 'upload', vault, folder], { inherit: true });
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

function cmdAdd(filePath) {
  cmdMove(filePath, { copy: false });
  cmdSync();
}

function cmdList() {
  ensureBinary();
  const folder = remoteFolder();
  const result = runProton(['filesystem', 'list', folder, '--json']);
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
    } else {
      console.error(`Nothing found at "${folder}" yet, or it does not exist.`);
    }
    process.exit(1);
  }
  console.log(result.stdout.trim() || '(empty)');
}

function cmdGet(name, destDir) {
  if (!name) {
    console.error('Usage: node backup.js get <remote-file-name> [local-dest-dir]');
    process.exit(1);
  }
  ensureBinary();
  const folder = remoteFolder();
  const dest = destDir || '.';
  const remotePath = `${folder}/${name}`;
  const result = runProton(['filesystem', 'download', remotePath, dest], { inherit: true });
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
OS file browser, then sync.

Usage:
  node backup.js setup              One-time: vault + remote folder + login
  node backup.js check              Verify your session is still valid
  node backup.js move <file> [--copy]  Move (or copy) a file into the vault
  node backup.js sync               Upload the whole vault to Proton Drive
  node backup.js add <path>         Shorthand: move + sync in one step
  node backup.js list               List what is in your remote backup folder
  node backup.js get <name> [dest]  Download a file back down

Not a versioned backup tool. See README.md for what this is and is not.`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'setup':
      await cmdSetup();
      break;
    case 'check':
      cmdCheck();
      break;
    case 'move':
      cmdMove(rest.find((a) => a !== '--copy'), { copy: rest.includes('--copy') });
      break;
    case 'sync':
      cmdSync();
      break;
    case 'add':
      cmdAdd(rest[0]);
      break;
    case 'list':
      cmdList();
      break;
    case 'get':
      cmdGet(rest[0], rest[1]);
      break;
    default:
      printHelp();
      process.exit(cmd ? 1 : 0);
  }
}

main();
