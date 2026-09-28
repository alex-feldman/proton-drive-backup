# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[Semantic Versioning](https://semver.org/).

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
