# proton-drive-backup

A small, cross-platform wrapper around Proton's **official Proton Drive CLI**
that keeps a local "vault" folder synced to a dedicated Proton Drive folder,
as a secure, encrypted offsite copy.

## Give this to a friend

If someone handed you this repo's URL, paste this into your AI coding
assistant (Claude, ChatGPT, etc.) to get set up:

> Clone the repo at https://github.com/alex-feldman/proton-drive-backup and
> install it. It needs Node.js — check for that and tell me if it's missing,
> with instructions to get it. Then run `node backup.js setup` and walk me
> through it: it will ask if I have a Proton account already, and if not it
> will wait for me to create one at proton.me before continuing. It
> downloads and installs the Proton Drive CLI itself, so you shouldn't need
> to do that manually. It will also ask where I want my local vault folder
> and which remote folder to use — the defaults are fine unless I say
> otherwise. It finishes with a browser login; tell me when to switch to my
> browser and when to come back.

Once setup finishes, give it this next, so future backups are a one-line ask
instead of remembering two commands:

> Create a skill (or the closest equivalent your tools support — a slash
> command, a saved routine, whatever you have) called "vault-backup" that
> does this: run `node backup.js check` first. If the session is valid, run
> `node backup.js sync` next and report the result. If check fails (expired
> or missing login), stop and tell me to run `node backup.js setup` instead
> — don't try to sync anyway. This should be something I ask for on demand,
> not something you schedule automatically — Proton's login can't run
> unattended, so a scheduled job could fail silently for weeks without me
> noticing.

Then prove it actually works end to end:

> Write a file named hello.txt directly into my vault folder (whatever path
> was set during setup) with some placeholder text, then run
> `node backup.js sync` (or the vault-backup skill, if you just made one).
> Once it succeeds, give me the exact URL to open in my browser so I can
> confirm the file is really there.

That's the whole flow — no other instructions needed. Everything below is
reference detail for anyone who wants to understand how it works.

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
- [Node.js](https://nodejs.org/) 18 or newer. Nothing else to install by
  hand — `setup` downloads and installs the official
  [Proton Drive CLI](https://proton.me/support/drive-cli) itself.

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
2. Check for the `proton-drive` binary and, if it's missing, download and
   install it automatically into this folder's `bin/` (Windows/macOS/Linux,
   x64/arm64 — no admin/sudo needed, nothing added to your system `PATH`).
   If your platform isn't one of those (e.g. Linux musl/Alpine), or the
   download fails, it tells you exactly where to get the binary yourself and
   how to point this tool at it (`PROTON_DRIVE_BIN`).
3. Ask where you want your local vault folder (default
   `~/Documents/proton-vault`) and create it.
4. Ask whether this is a per-machine backup (default) or a
   [shared vault](#shared-vaults-across-multiple-computers-advanced) you'll
   connect from more than one computer.
5. Ask which remote Proton Drive folder to sync it to (default
   `/my-files/backups/<your-hostname>` for per-machine,
   `/my-files/backups/shared` for shared). Proton Drive's root namespace is
   `/my-files` — if you type a folder without that prefix, it's added for
   you automatically.
6. Run `proton-drive auth login`, which opens your browser. Finish the Proton
   login there, then come back to the terminal.
7. Verify the login worked. If the remote folder already exists (typically
   because you're joining an existing shared vault, or reinstalling on a
   machine that already used this tool), it offers to `pull` whatever's
   already there into your local vault before finishing.

You only need to do this once per machine per Proton account. The CLI caches
your session in your OS's secure credential store, so you won't be asked to
log in again until that session eventually expires.

## Shared vaults across multiple computers (advanced)

By default, every machine gets its own remote folder
(`/my-files/backups/<hostname>`) — completely independent backups, nothing
expected to appear on a second computer. If you want one vault visible from
multiple machines instead, choose "shared" when `setup` asks, and **use the
exact same remote folder name on every machine** you connect (the default
`/my-files/backups/shared` is fine, or pick your own).

This tool does not do two-way sync. `sync` only uploads; it is a one-way
push from your local vault to the remote folder, and it never deletes
anything remotely. That's deliberate: it means a machine can never
accidentally erase what another machine already backed up. To catch a
machine up on what's already in a shared vault (or to recover a local vault
you've lost — new machine, wiped disk, accidentally deleted files, whatever),
run:

```bash
node backup.js pull
```

`pull` downloads everything from your remote folder into your local vault.
Like `sync`, it's one-directional and non-destructive: it only adds/updates
files locally, it never deletes local files that aren't present remotely.
Because both directions are add-only, there is no sequence of `pull` and
`sync` that can wipe out either side — the worst case of losing your local
vault and then running `pull` followed by `sync` just re-establishes both
copies, it can't erase anything.

What this does **not** give you: live sync (changes only move when you run
`sync`/`pull`), conflict resolution (if two machines both create a file
with the same name before syncing, whichever uploads last is what the
official CLI decides to keep — untested, since it depends on the CLI's own
conflict behavior), or deletion propagation (deleting a file on one machine
and syncing does not remove it from the shared folder or from any other
machine's vault).

### If your AI agent is running `setup` for you

`setup` is genuinely interactive (an account yes/no question, optional vault
folder/mode/remote-folder overrides, then a real browser login, then —
conditionally, only if the remote folder already exists — a pull-now yes/no
question) — not something a coding agent can just run as one ordinary
foreground command. If your agent's tool calls don't share a persistent
shell/TTY across calls (true of most AI coding assistants, including Claude
Code), a plain foreground run will look like it "hangs" and then silently
dies at the first prompt: don't try to patch that with a named pipe
(`mkfifo`) — that's unreliable in the same way across separate tool-call
boundaries, especially on Windows.

What works reliably: have the agent ask you up front for anything it can
know in advance (do you have an account yet, per-machine or shared, any
non-default vault/folder path), pipe all of those answers into `setup` at
once (`printf 'y\n\nper-machine\n\n\n' | node backup.js setup` — the extra
trailing blank line safely covers the conditional pull-now question in case
it fires; an unused piped line just sits unread if it doesn't), and run
that in the background with output going to a log file it can poll — not a
single foreground call with a short timeout, since the one-time CLI
download can take a while. Once `setup` reaches the browser-login step it
doesn't need any more stdin, so this pre-answer-then-background approach
gets all the way through cleanly.

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

# Pull everything from your remote folder into your local vault (recover a
# lost vault, or catch a machine up on a shared vault)
node backup.js pull

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
- Automatic CLI install only covers Windows/macOS/Linux on x64/arm64 glibc.
  Linux musl (e.g. Alpine) and anything else isn't auto-installed — `setup`
  will tell you and point at manual install instructions instead.
- The official Proton Drive CLI is new (shipped June 2026) and its exact
  command syntax may shift between versions. The commands in `backup.js`,
  including the `/my-files` root-namespace path and the parent-folder
  auto-create logic, are verified against CLI `0.6.0` live on a real
  authenticated account (2026-07-28); if a command starts failing with
  something that looks like a usage error rather than an auth error, check
  `proton-drive --help` — the syntax may have moved on since this was
  written. Please open an issue or send a fix.

## License

MIT — see `LICENSE`.
