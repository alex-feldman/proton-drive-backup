# proton-drive-backup

A small, cross-platform wrapper around Proton's **official Proton Drive CLI**
that keeps a local "vault" folder synced to a dedicated Proton Drive folder,
as a secure, encrypted offsite copy.

## What this is (and isn't)

**This is a secure encrypted file drop, not a versioned backup.** There is no
dedup, no snapshots, no point-in-time history, and no scheduled/unattended
running. If you overwrite a good file with a bad one and sync again, the old
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
want a dead-simple, "drop files in a folder, run one command" way to get
copies of things into an encrypted cloud drive, on a machine and account you
already control.

## How it works: the vault folder

Everything revolves around one local folder, the **vault** — by default
`~/Documents/proton-vault`, but you choose the location during setup.

- It's a plain folder. Organize it however you want: this tool's `move`
  command, or just drag-and-drop in Finder/Explorer/your file manager.
- `sync` uploads the whole vault to your dedicated Proton Drive folder.
- Sync never deletes anything remotely. Removing a file from the vault only
  removes your local copy — the remote copy stays until you delete it
  yourself (in the Proton Drive web app, or with the CLI directly).

This means the vault is the single place to look to know what's backed up,
and you can use whatever local organization (subfolders, renaming) you like
before running `sync`.

If the vault folder lives inside something already cloud-synced (OneDrive,
iCloud Drive, Dropbox, etc.), pick a different location during setup —
otherwise you'd be syncing the same files through two services at once.

## Requirements

- **A Proton account, created ahead of time in your browser.** This tool does
  not and cannot create one for you — `proton-drive auth login` only
  authenticates an *existing* account. Sign up free at
  [proton.me/mail/signup](https://proton.me/mail/signup) (Drive is included
  with any Proton account, no card required; free tier is currently 2 GB,
  rising to 5 GB after a few onboarding actions — check current limits at
  [proton.me/support/account/manage-account/storage](https://proton.me/support/account/manage-account/storage)).
  If you don't have one yet, that's fine — `node backup.js setup` asks and
  will wait for you to go create one before continuing.
- [Node.js](https://nodejs.org/) 18 or newer
- The official [Proton Drive CLI](https://proton.me/support/drive-cli)
  (`proton-drive`), installed and on your `PATH`. Grab a prebuilt binary from
  the [ProtonDriveApps/sdk](https://github.com/ProtonDriveApps/sdk) releases,
  or build it yourself with [Bun](https://bun.sh/) per that repo's `cli/README.md`.
  If you skip this, `setup` tells you exactly where to get it and stops there
  — safe to run before you've installed anything.

## Setup

```bash
git clone https://github.com/alex-feldman/proton-drive-backup.git
cd proton-drive-backup
node backup.js setup
```

`setup` will:

1. Ask whether you already have a Proton account. If not, it prints the
   signup link and **waits** — type `done` once you've created one, and it
   continues from there. No account, no login, so this has to come first.
2. Check that the `proton-drive` binary is on your `PATH` (and tell you where
   to get it if it isn't).
3. Ask where you want your local vault folder (default
   `~/Documents/proton-vault`) and create it.
4. Ask which remote Proton Drive folder to sync it to (default
   `/backups/<your-hostname>`).
5. Run `proton-drive auth login`, which opens your browser. Finish the Proton
   login there, then come back to the terminal.
6. Verify the login worked.

You only need to do this once per machine per Proton account. The CLI caches
your session in your OS's secure credential store, so you won't be asked to
log in again until that session eventually expires.

## Usage

```bash
# Move a file into the vault (use --copy to leave the original in place)
node backup.js move /path/to/some-file.pdf

# Or just drag files into the vault folder yourself, then:
node backup.js sync

# Shorthand: move one file into the vault and sync immediately
node backup.js add /path/to/some-file.pdf

# List what's currently in your remote backup folder
node backup.js list

# Download something back down (to prove it's really there and restorable)
node backup.js get some-file.pdf ./restored/

# Check whether your login session is still valid, without syncing anything
node backup.js check
```

After a sync, open [drive.proton.me](https://drive.proton.me) in your browser
and confirm the files show up in your backup folder — that's the real proof
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
- No versioning — syncing a file with the same name overwrites the remote
  copy silently on Proton's side (Drive itself may keep some native history;
  this tool makes no promise about that and doesn't manage it).
- `sync` re-uploads the whole vault folder each time via the CLI's own
  recursive upload, rather than diffing file-by-file — simple and robust, at
  the cost of some redundant transfer on a large, mostly-unchanged vault.
- The official Proton Drive CLI is new (shipped June 2026) and its exact
  command syntax may shift. If a command in `backup.js` stops matching what
  `proton-drive --help` shows, that's why — please open an issue or send a
  fix.

## License

MIT — see `LICENSE`.
