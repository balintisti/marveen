#!/usr/bin/env python3
"""Which tmux session the watchdog probes for a progress dir (card 574c9f0f).

The defect: agent_name_from() returns None for the DEFAULT progress dir
(~/.claude/channels/telegram/progress), and the caller read that as "assume
up". That dir is the coordinator's -- the one Isti's own Telegram messages land
in -- so the agent-down branch (120 s) was structurally unreachable there and
only the 15-minute backstop ever applied. Measured 2026-09-10: all four fires
that morning were `wedged-backstop`, zero `agent-down`.

The payoff is a LATENCY CUT, not a silence fixed. A WEDGED turn renders exactly
like a live one, so no session probe can separate them -- only time can, and
that question already has two instruments. These tests therefore pin ONE thing:
which session name comes out, and that AMBIGUITY yields None rather than a guess.

Why None matters more than the happy path: a wrong session name does not merely
miss. It makes the DOWN branch fire on a HEALTHY session, which rewrites a live
placeholder and tells the user something is stuck while the agent works. So
"cannot tell" must return None and keep the old conservative behaviour.

Run: python3 <thisfile>   Exit 0 = all pass.
"""
import importlib.util
import os
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks",
                    "telegram_progress_watchdog.py")
spec = importlib.util.spec_from_file_location("wd", HOOK)
wd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wd)

failed = []


def check(label, got, want):
    if got == want:
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}: got {got!r}, want {want!r}")


# The real fleet list, copied from `tmux list-sessions` on 2026-09-10.
FLEET = ["agent-computress", "agent-deeper", "agent-dexter", "agent-didi",
         "agent-friday", "agent-jarvis", "agent-mandark",
         "marveen-channels", "marveen-worker", "marveen-worker-fast"]

check("the live fleet list resolves to the coordinator's channels session",
      wd.pick_channels_session(FLEET), "marveen-channels")
check("the -worker sessions are not mistaken for it",
      wd.pick_channels_session(["marveen-worker", "marveen-worker-fast"]), None)
check("no candidate -> None (nothing to probe)",
      wd.pick_channels_session(["agent-friday"]), None)
check("an empty list -> None",
      wd.pick_channels_session([]), None)
# The one that keeps a wrong guess out. Two installs, or a leftover session,
# and we cannot tell which owns this chat -- so we do not choose.
check("TWO candidates -> None, deliberately, rather than picking the first",
      wd.pick_channels_session(["a-channels", "b-channels"]), None)
check("a name that merely CONTAINS 'channels' does not count",
      wd.pick_channels_session(["channels-backup", "marveen-channels"]),
      "marveen-channels")

# session_for: the per-agent path must be untouched by all of the above.
AGENT_DIR = "/Users/x/marveen/agents/friday/.claude/channels/telegram/progress"
DEFAULT_DIR = "/Users/x/.claude/channels/telegram/progress"
check("a per-agent dir still resolves to agent-<name>",
      wd.session_for(AGENT_DIR), "agent-friday")

# --- the two resolution paths, isolated -------------------------------------
# CONFIG FIRST, and that ordering is the fix, not a detail. A name derived from
# the LIVE list cannot detect absence: with the coordinator crashed there are
# zero `*-channels` candidates, which is byte-identical to "no such install" --
# so the down branch could never fire, which is the very defect this card is
# about, one level deeper. Found by a FAILING test, not by reading.
real_list, real_mid = wd.tmux_sessions, wd.main_agent_id
try:
    wd.main_agent_id = lambda: "marveen"
    wd.tmux_sessions = lambda: []          # deliberately contradicts the config
    check("config wins over the live list -- and works when NOTHING is running,"
          " which is the case that has to fire",
          wd.session_for(DEFAULT_DIR), "marveen-channels")
    wd.tmux_sessions = lambda: ["other-channels"]
    check("config wins over a DIFFERENT running channels session",
          wd.session_for(DEFAULT_DIR), "marveen-channels")

    # Fallback path: no config to read.
    wd.main_agent_id = lambda: None
    wd.tmux_sessions = lambda: FLEET
    check("no config, exactly one candidate -> that one",
          wd.session_for(DEFAULT_DIR), "marveen-channels")
    wd.tmux_sessions = lambda: ["a-channels", "b-channels"]
    check("no config, ambiguous -> None rather than a guess",
          wd.session_for(DEFAULT_DIR), None)
    wd.tmux_sessions = lambda: []
    check("no config, nothing running -> None (absence is NOT evidence here)",
          wd.session_for(DEFAULT_DIR), None)
finally:
    wd.tmux_sessions, wd.main_agent_id = real_list, real_mid

# CONTROL: the config reader actually works on this host, so the stubs above
# are not covering for a function that always returns None.
_mid = wd.main_agent_id()
check("CONTROL: main_agent_id() reads a real id from FLEET_ROOT/.env",
      isinstance(_mid, str) and len(_mid) > 0, True)

# CONTROL on the meter itself: agent_name_from must still return None for the
# default dir. If a future change made it return something, every assertion
# above would pass for the wrong reason.
check("CONTROL: agent_name_from still yields None for the default dir",
      wd.agent_name_from(DEFAULT_DIR), None)
check("CONTROL: and a real name for a per-agent dir",
      wd.agent_name_from(AGENT_DIR), "friday")

# --- THE SUFFIX IS NOT AN ASSUMPTION, AND THIS IS WHAT KEEPS IT THAT WAY -----
# `<id>-channels` is built in ONE canonical place, src/web/session-names.ts
# (card 228c9252), whose own header says it exists because that rule used to
# live in FIVE hand-written copies and one caller never got it -- which told the
# fleet in writing that the coordinator was not running.
#
# This Python hook cannot import that module, so it is now another copy of the
# same rule, in another language, outside the module's reach. That is the drift
# shape, so the template is pinned here instead: if session-names.ts ever
# changes the suffix, this goes red rather than the hook silently probing a
# session that has never existed.
import re
TS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                  "src", "web", "session-names.ts")
try:
    ts_src = open(TS, encoding="utf-8").read()
except OSError:
    ts_src = ""
m = re.search(r"return `\$\{mainAgentId\}(-[A-Za-z-]+)`", ts_src)
# Positive control FIRST: without it a moved or renamed file yields None and the
# assertion below would be "satisfied" by having found nothing.
check("CONTROL: the canonical template was located in session-names.ts",
      bool(m), True)
check("the hook's suffix still matches session-names.ts",
      m.group(1) if m else None, "-channels")

print()
if failed:
    print(f"{len(failed)} FAILED: {failed}", file=sys.stderr)
    sys.exit(1)
print("All watchdog session-resolve tests passed.")
