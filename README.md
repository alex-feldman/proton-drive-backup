# proton-drive-backup

A small, cross-platform wrapper around Proton's **official Proton Drive CLI**
that makes it easy to drop files into a dedicated Proton Drive folder as a
secure, encrypted offsite copy.

## What this is (and isn't)

**This is a secure encrypted file drop, not a versioned backup.** There is no
dedup, no snapshots, no point-in-time history, and no scheduled/unattended
running. If you overwrite a good file with a bad one and upload again, the old
copy is gone. Think "a safe place to put a copy of something important," not
"a time machine."

If you need real backup semantics — versioning, deduplication, incremental
snapshots, fully unattended/scheduled runs — use a tool built for that (e.g.
[restic](https://restic.net/)). Proton Drive's official CLI does not currently
support any non-interactive/token-based authentication, so nothing built on
top of it (including this tool) can run truly unattended: a human has to
complete one browser login, and has to redo it again whenever the cached
session expires (Proton doesn't document how long that takes).

This tool exists for the case where that trade-off is fine: you (or a friend)
want a dead-simple, "run one command, paste a file path" way to get a copy of
something into an encrypted cloud drive, on a machine and account you already
control.

## Requirements

- A [Proton account](https://proton.me/drive) (the free tier works — currently
  2 GB, rising to 5 GB after a few onboarding actions; check current limits at
  [proton.me/support/account/manage-account/storage](https://proton.me/support/account/manage-account/storage))
- [Node.js](https://nodejs.org/) 18 or newer
- The official [Proton Drive CLI](https://proton.me/support/drive-cli)
  (`proton-drive`), installed and on your `PATH`. Grab a prebuilt binary from
  the [ProtonDriveApps/sdk](https://github.com/ProtonDriveApps/sdk) releases,
  or build it yourself with [Bun](https://bun.sh/) per that repo's `cli/README.md`.

## Setup

```bash
git clone https://github.com/alex-feldman/proton-drive-backup.git
cd proton-drive-backup
node backup.js setup
```

`setup` will:

1. Check that the `proton-drive` binary is on your `PATH` (and tell you where
   to get it if it isn't).
2. Run `proton-drive auth login`, which opens your browser. Finish the Proton
   login there, then come back to the terminal.
3. Verify the login worked and create a dedicated remote folder for this
   machine (default: `/backups/<your-hostname>`), so your uploads don't end
   up scattered across your whole Drive.

You only need to do this once per machine per Proton account. The CLI caches
your session in your OS's secure credential store, so you won't be asked to
log in again until that session eventually expires.

## Usage

```bash
# Upload a file (or folder) to your dedicated backup folder
node backup.js add /path/to/some-file.pdf

# List what's currently up there
node backup.js list

# Download something back down (to prove it's really there and restorable)
node backup.js get some-file.pdf ./restored/

# Check whether your login session is still valid, without uploading anything
node backup.js check
```

After adding a file, open [drive.proton.me](https://drive.proton.me) in your
browser and confirm it shows up in your backup folder — that's the real proof
it worked, not just the command exiting cleanly.

## When your session expires

If a command fails with an authentication-shaped error, you'll see:

```
Your Proton session has expired (or you haven't logged in yet).
Run: node backup.js setup
Then try your command again.
```

That's it — there's no separate "refresh" step. Re-run `setup`, finish the
browser login again, and continue.

## Why a separate repo

This is deliberately small and self-contained so it's easy to hand to a
friend: `git clone` it, run `node backup.js setup`, and they have their own
independent encrypted file drop on their own Proton account. It does not
touch, share, or depend on anyone else's data, bucket, or account.

## Known limitations

- No unattended/scheduled backups (the auth model doesn't allow it today).
- No versioning — uploading a file with the same name overwrites the remote
  copy silently on Proton's side (Drive itself may keep some native history;
  this tool makes no promise about that and doesn't manage it).
- The official Proton Drive CLI is new (shipped June 2026) and its exact
  command syntax may shift. If a command in `backup.js` stops matching what
  `proton-drive --help` shows, that's why — please open an issue or send a
  fix.

## License

MIT — see `LICENSE`.
