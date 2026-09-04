# Disk-space + stuck-modal guards (2026-06-03 hardening)

> ## STATUS: NEITHER GUARD RUNS ON THIS HOST
>
> Measured 2026-09-04 (card `f6f6216b`). Both are wired as **systemd `--user` timers**,
> and this host is **macOS**:
>
> ```
> uname -s ................... Darwin
> command -v systemctl ....... absent
> ~/.config/systemd/user ..... No such file or directory
> ```
>
> Consumers of either script, in all three places a scheduled job can live:
>
> ```
>                        repo (dist/ src/ scripts/ web/) | ~/Library/LaunchAgents + launchctl | ~/.claude/scheduled-tasks
> disk-space-guard.sh                                  0 |                                  0 |                        0
> stuck-modal-guard.sh                                 0 |                                  0 |                        0
> CONTROL: rulebook-snapshot.sh                    found |                              found |                        -
> ```
>
> (The control matters: the same three queries DO find a script that is known to run,
> so the zeros are a real negative, not a blind measure. `crontab -l`: no crontab.)
>
> **WHAT IS MEASURED vs INFERRED, because the difference matters here.** MEASURED: nothing
> is wired to run either script TODAY. NOT MEASURED: whether either ever ran in the past.
> The scripts log to **stdout only** (`log() { echo ... }`) -- under systemd that goes to
> the journal, and on this host there is no journal and no log file, so there is no
> monotonic artefact to ask. The absence of `~/.config/systemd/user` makes "it was never
> installed by the documented path" very likely, but that is an inference, not a reading.
>
> **WHAT WOULD HAVE TO HAPPEN.** The Activation section below is Linux-only and cannot
> be followed here. Running these on macOS needs a launchd port: a
> `scripts/com.marveen.<unit>.plist.template` for each (the repo tracks eight such
> templates today, and neither guard is among them), installed with
> `scripts/install-launchd-unit.sh`, then `launchctl` load + a behaviour check.
>
> **THAT PORT IS NOT A FREE DECISION and is not taken.** The disk guard runs `rm -rf`
> on an allowlist every minute on Isti's machine; that needs his explicit yes.
> Tracked separately, `waiting` on him. Disk today: 8% against a 90% reap threshold,
> so nothing is pressing.
>
> **NEITHER SCRIPT IS BEING DROPPED.** The 2026-06-03 failure happened, the scripts are
> written and tested, and on a Linux host the shape is already correct. What was wrong
> was this page claiming, in the present tense, that the host was covered.
>
> Everything below describes what the scripts DO when something runs them. Read it as a
> specification, not as a description of this machine.

Two independent systemd `--user` timers (**not running here -- see STATUS above**) that
address the failure mode the 2026-06-03 dawn incident exposed: the root fs filled to 100% from a 2.2G orphaned
`/tmp/health_*` Apple Health export, which wedged the main session in a `/mcp`
modal and left inbound messages dropped until a human noticed. They are
**independent of the dashboard** (which dies with its process and is itself
unreliable under disk-full).

## A. Disk-space guard -- `scripts/disk-space-guard.sh`

Every minute: read `df /` usage.
- `>= 90%` (`REAP_THRESHOLD`): reap **age-guarded allowlist scratch** -- globs in
  `REAP_GLOBS` (currently `health_*`) directly under `/tmp`, only entries older
  than `REAP_MIN_AGE_MIN` (30 min), so a currently-running export (recent mtime)
  is never deleted.
- `>= 95%` (`ALERT_THRESHOLD`) after reap: alert the owner over the **direct Telegram
  Bot API** (the MCP plugin is dead under disk-full), at most once/hour.

Thresholds + the reap allowlist are constants at the top of the script. All
stamp/log writes are best-effort (ENOSPC-tolerant).

## B. Stuck-modal guard -- `scripts/stuck-modal-guard.sh`

Every minute: classify the main channels session pane (`${MAIN_AGENT_ID}-channels`,
mirrors `src/pane-state.ts`):
- **idle** (`? for shortcuts` / `bypass permissions on`) or **busy**
  (`esc to interrupt` / `(Ns · ↓` token counter) → healthy, never touched.
- **stuck** (neither marker → the modal overlay hides the idle footer and no live
  turn) → only after it **persists `STUCK_SECONDS` = 120s** (≥2 consecutive
  ticks): Escape up to 4× (like `channels.sh ensure_modal_closed`); if still not
  idle, `respawn-pane`. The respawn **shares `channel-watchdog.sh`'s
  `.channel-last-respawn` grace stamp**, so the two watchdogs never double-respawn.

A legitimately working session (`esc to interrupt` + `bypass permissions on`) is
classified busy/idle and is never disturbed (locked by the contract test).

> Companion hardening: make the stamp writes in your existing watchdog scripts
> best-effort (`… 2>/dev/null || true`) so an ENOSPC write under disk-full cannot
> crash a watchdog or emit a false signal.

## Activation (LINUX ONLY -- see STATUS: these steps cannot be run on this host)

`systemctl` does not exist on macOS, so the block below is the Linux recipe, kept
because the unit files are still the right shape there. For this host, see the launchd
port named in STATUS -- it is not done and is waiting on Isti.

The unit files carry `/path/to/marveen` and `/home/USER` placeholders -- replace
them with your install dir and home before installing.

```bash
# 1. install the unit files (after editing the placeholders)
cp scripts/systemd/disk-space-guard.{service,timer}  ~/.config/systemd/user/
cp scripts/systemd/stuck-modal-guard.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
# 2. enable + start the timers
systemctl --user enable --now disk-space-guard.timer stuck-modal-guard.timer
# 3. verify
systemctl --user list-timers | grep -E 'disk-space|stuck-modal'
```

## Tests

```bash
bash scripts/__tests__/disk-space-guard.test.sh    # thresholds / age-guard / alert+cooldown / malformed
bash scripts/__tests__/stuck-modal-guard.test.sh   # classify fixtures (idle/busy/stuck/empty) + confirm-window
```

**NOTHING RUNS THOSE TWO FILES AUTOMATICALLY.** `npm test` is `vitest run`, whose include
never matches `.sh` -- measured with a positive control 2026-09-04: `vitest list` returns
nothing for `scripts/__tests__/disk-space-guard.test.sh` and 5+ lines for a real
`src/__tests__/*.test.ts`. All 14 `scripts/__tests__/*.test.sh` files are hand-run only
(card `27975b85`). Run them by hand, or do not count them as a gate.

And note what the disk-space shell test cannot reach: all nine of its cases pass
`DISK_GUARD_ALERT_DRYRUN=1`, which returns from `alert_owner` before the `curl`. The
alert-delivery behaviour is covered instead by `src/__tests__/disk-guard-alert-delivery.test.ts`,
which the vitest suite does run.

## Re-review hardening (2026-06-03, post-cross-model)

- **W2a -- busy-marker glyph robustness:** the `(Ns · ↓` token-counter separator can
  render as a Unicode middle-dot OR an ASCII period depending on terminal/locale.
  `classify_pane` now matches both (`(·|\.)`), so a working pane is never misread as
  STUCK and respawned mid-turn. Locked by a regression fixture in the test suite.
- **W2b -- respawn plugin id is config-overridable:** `STUCK_MODAL_PLUGIN` (default
  `plugin:telegram@claude-plugins-official`) so a renamed/local-build install isn't
  respawned with a wrong plugin id (which would exit immediately while the alert
  falsely says "respawned"). `%q`-quoted at interpolation, like the model id.

## Deferred findings

- **Telegram bot token in the `curl` URL path (`alert_owner`, both guards).** The
  token is interpolated as `…/bot${token}/sendMessage`, so it is visible in
  `/proc/<pid>/cmdline` for the curl process's lifetime. **Disposition: ACCEPTED**
  for this deployment -- the host is single-user and the guards run as
  `systemctl --user`, so no other local user can read the process table; the token
  already lives in a local `.env` the same user owns. On a shared/multi-user host
  this would be a real exposure and must move to a `--config`/netrc (mode 0600) form.
  Re-evaluate if the deployment model changes. (Source: PR #264 cross-model + sec-*
  re-review, 2026-06-03.)
