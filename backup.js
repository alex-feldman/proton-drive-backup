#!/usr/bin/env node
'use strict';

/**
 * proton-drive-backup — a thin wrapper around the official Proton Drive CLI
 * (`proton-drive`) for dropping files into a dedicated, per-machine encrypted
 * folder. Not a versioned backup tool — see README.md.
 *
 * The `proton-drive` CLI shipped June 2026 and its exact subcommand syntax
 * may drift. If a command below stops matching `proton-drive --help`,
 * update the CLI_* constants and PROTON_BIN invocations to match.
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

function defaultRemoteFolder() {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-');
  return `/backups/${hostname}`;
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

async function cmdSetup() {
  ensureBinary();

  const config = loadConfig();
  const currentFolder = config.remoteFolder || defaultRemoteFolder();
  const chosen = await ask(`Remote backup folder [${currentFolder}]: `);
  const folder = chosen || currentFolder;
  config.remoteFolder = folder;
  saveConfig(config);

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
    console.log('It will be created automatically the first time you upload something with:');
    console.log(`  node backup.js add <file>`);
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
    console.error(`Could not reach "${folder}" (it may not exist yet — that is fine before your first upload).`);
    console.error(result.stderr.trim() || result.stdout.trim());
  }
  return false;
}

function cmdAdd(filePath) {
  if (!filePath) {
    console.error('Usage: node backup.js add <file-or-folder>');
    process.exit(1);
  }
  ensureBinary();
  if (!fs.existsSync(filePath)) {
    console.error(`No such file or folder: ${filePath}`);
    process.exit(1);
  }
  const folder = remoteFolder();
  const result = runProton(['filesystem', 'upload', filePath, folder], { inherit: true });
  if (!result.ok) {
    if (result.authFailure) {
      printAuthHelp();
    } else {
      console.error(`Upload failed. If this keeps happening, check "proton-drive --help" — the CLI's command syntax may have changed since this tool was written.`);
    }
    process.exit(1);
  }
  console.log(`\nUploaded to ${folder}. Confirm it in your browser at https://drive.proton.me`);
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

Usage:
  node backup.js setup              One-time login + remote folder setup
  node backup.js check              Verify your session is still valid
  node backup.js add <path>         Upload a file or folder
  node backup.js list               List what is in your backup folder
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
