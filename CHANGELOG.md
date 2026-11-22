# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `trash <name> [--yes]` moves one top-level item of a target's remote folder
  to Proton Drive's Trash (`filesystem trash`), the first command that removes
  anything remotely. Trash only, never a permanent delete or empty-trash; a
  bare name only (no slashes), so nothing outside the backup folder is
  reachable; refused when the item is missing remotely or still in the local
  vault; a dry run without `--yes`. Covered by `test/trash.test.js`.
- The README's "Give this to a friend" skill prompt now tells the agent to
  remove things from the backup only through `trash`, dry run first, and only
  after the user says yes.

## [1.6.0] - 2026-11-19

### Added

- `set-target <name> --keep-versions on|off` lets a target keep the old remote
  copy of a changed file as a version of the same file (`sync` uploads with
  `-f create-new-revision`) instead of replacing it. Off by default, so
  existing setups behave exactly as before. It is a per-target setting
  (`keepVersions: true`, or at the top level of an older single-folder config),
  shown by `targets`. There is still no restore command; old versions are
  recovered from a file's version history in Proton Drive on the web. Covered
  by `test/upload-versions.test.js`.
- `setup --cli-version x.y.z|latest` (or `PROTON_DRIVE_CLI_VERSION`) installs a
  specific Proton Drive CLI version, or the newest one, on request.

### Changed

- `setup` and the automatic install now install the pinned, tested Proton Drive
  CLI version (`0.9.0`) instead of whatever Proton lists as newest. CLI `0.9.0`
  renamed a flag value between minor releases and broke `pull`, so a newer
  version is now an explicit choice. Already installed CLIs are untouched.
  The old `0.6.0` fallback is gone. Covered by `test/cli-version.test.js`.
- A config that has a `targets` map but no target named `default` no longer
  falls back to the built-in default vault folder and per-hostname remote
  folder: a command without `--target` now stops with "Unknown target".
  `add-target default ...` can now create that target. Single-folder configs
  without a `targets` map are unchanged. Covered by
  `test/default-target.test.js`.

### Fixed

- `pull` and `get` work with Proton Drive CLI `0.9.0`, which renamed the
  download file-conflict value `replace` to `remove` and rejects the old one.
  Uploads still pass `replace`. Covered by `test/download.test.js`.

### Documentation

- README: where CLI `0.9.0` keeps the login (`PROTON_DRIVE_CREDENTIALS_STORE`:
  `keychain`, `unsafe_file`, `pass`), and why a Windows command run over SSH
  with key authentication reports an expired session (it cannot read
  Credential Manager; run it in the desktop session instead).
- README: new "Keeping old versions" section, the "not a versioned backup"
  wording now says "by default", and a neutral example replaces a personal
  folder name in the shared-vault section.

## [1.5.0] - 2026-09-29

### Changed

- New per-machine and shared setups put the default vault in a dedicated
  `/vault` folder beneath the backup grouping folder. Existing configured
  destinations remain unchanged.
- `add-target` and repeat `setup` refuse a remote folder that overlaps another
  configured target. Repeat setup now reads and writes `targets.default` when
  multiple targets are configured, preserving the actual saved destination.

## [1.4.0] - 2026-09-29

### Added

- `usage [--target <name>]` walks a configured remote target and reports
  active-revision file bytes, counts, and the ten largest current files.
  It explicitly excludes account quota, prior versions, Trash, and other
  Drive content from its claim.

## [1.3.0] - 2026-09-28

### Added

- Orphan detection, advisory only (never changes the exit code, never touches
  either side): `check` warns about top-level remote entries with no local
  counterpart (drift from a local delete, since `sync` never deletes
  remotely); `sync` warns if anything is still local-only right after
  uploading, which at that point means a failed upload.

## [1.2.0] - 2026-09-28

### Added

- `.vaultignore`: drop this file at the root of any target's local folder to
  exclude named top-level entries from `sync`, one basename per line. No
  wildcards, no negation, top-level only (see README, "Multiple targets").

## [1.1.0] - 2026-09-28

### Added

- Multi-target support: `add-target <name> <local-path> <remote-folder>` and
  `targets` register and list independent local<->remote pairs under the same
  Proton login. Every other command (`check`, `sync`, `pull`, `both`, `move`,
  `add`, `list`, `get`) now accepts `--target <name>` to operate on a target
  other than the original vault. No new login is required — one Proton
  session already covers the whole account.

### Notes

- Fully backward compatible: a pre-1.1.0 `config.json` (flat top-level
  `vaultPath`/`remoteFolder`, no `targets` map) is read as an implicit
  `default` target and is only migrated into the new `targets` shape the
  first time `add-target` is run.
- On Windows, running `add-target` from Git Bash (or any MSYS2 shell) can
  mangle a remote-folder argument that starts with `/` before `node` even
  sees it. Set `MSYS2_ARG_CONV_EXCL="*"` for that one command if you hit
  this — see the README's "Multiple targets" section.

## [1.0.0] - 2026-07-27 to 2026-08-01

Initial build. A thin wrapper around the official Proton Drive CLI for
keeping a local "vault" folder synced to a dedicated, encrypted Proton Drive
folder.

### Added

- `setup`: one-time flow — Proton account check, automatic CLI install
  (Windows/macOS/Linux, x64/arm64), vault folder + remote folder
  configuration, browser login.
- `check`, `move` (+ `--copy`), `sync`, `pull`, `both`, `add` (move + sync),
  `list`, `get`.
- Per-machine vaults by default (`/my-files/backups/<hostname>`), with an
  opt-in shared-vault mode for multiple machines pointed at the same remote
  folder.
- Upload and download both pass `-d merge -f replace` and transfer folder
  contents item-by-item, so repeated `pull`/`sync` cycles can't compound
  nested folders and neither direction can delete the other side's data.
- Verified against Proton Drive CLI `0.6.0` (2026-07-28) and `0.7.0`
  (2026-08-01).
