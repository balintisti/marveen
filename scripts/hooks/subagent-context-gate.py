#!/usr/bin/env python3
"""subagent-context-gate.py -- PreToolUse gate for Agent/Task: no NEW sub-agent near the handoff.

WHY (card 66d4698a, Isti TG 8534, 2026-10-30; measurement sirius dbcbb210): of 290 sub-agent runs
36 never finished, 18 of them because the context guard restarted the parent session under them.
A sub-agent started close to the act threshold (actPct x limitTokens, 0.9 x 200k) is likely to die
in the restart that follows, and its whole run is paid for twice. So above SUBAGENT_MAX_PCT of the
agent's context-guard limit the Agent call is refused, loudly, with the way out: handoff first, the
fresh session spawns it.

THE MEASURE is the guard's own: the last main-chain `message.usage` of the session transcript,
input + cache_read + cache_creation tokens (src/web/active-model.ts), over `limitTokens` from
store/context-guard.json for this agent.

SCOPE, stated: an agent whose guard is disabled or has no `limitTokens` (marveen, the uncapped
agents measured against their model window) is not gated: the cap-relative percentage the card is
about does not exist there.

CONTRACT (hook-exit-code-invariant): exit 2 = refuse, the stderr text goes back to the model;
exit 0 = allow. NEVER exits 1: a malformed payload, an unreadable transcript or config, or an
unknown agent is not a verdict, so the call goes through.
"""
import json
import os
import re
import sys

SUBAGENT_MAX_PCT = 0.75
TAIL_BYTES = 512 * 1024
GATED_TOOLS = ("Agent", "Task")
CONFIG_PATH = os.environ.get("SUBAGENT_GATE_CONFIG") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "store", "context-guard.json"
)


def agent_id(payload):
    """The calling agent: the transcript's project slug (-Users-Shared-marveen-<id>), else the
    config dir (/agents/<id>/.claude-config/), else the cwd (marveen-<id>). None = unknown."""
    tp = payload.get("transcript_path") or ""
    for rx in (r"/projects/-Users-Shared-marveen-([a-z0-9_-]+)/", r"/agents/([a-z0-9_-]+)/\.claude-config/"):
        m = re.search(rx, tp)
        if m:
            return m.group(1)
    base = os.path.basename((payload.get("cwd") or os.getcwd()).rstrip("/"))
    if base == "marveen":
        return "marveen"
    m = re.fullmatch(r"marveen-([a-z0-9_-]+)", base)
    return m.group(1) if m else None


def context_tokens(transcript_path):
    """The last main-chain usage in the transcript, or None."""
    with open(transcript_path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().split(b"\n")
    for raw in reversed(lines):
        if b'"usage"' not in raw:
            continue
        try:
            row = json.loads(raw)
        except Exception:
            continue
        if row.get("isSidechain"):
            continue
        usage = (row.get("message") or {}).get("usage") or {}
        total = sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
        if total > 0:
            return total
    return None


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        return 0
    if not isinstance(payload, dict) or payload.get("tool_name") not in GATED_TOOLS:
        return 0
    try:
        agent = agent_id(payload)
        if not agent:
            return 0
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = (json.load(f) or {}).get(agent) or {}
        limit = cfg.get("limitTokens")
        if not cfg.get("enabled") or not isinstance(limit, (int, float)) or limit <= 0:
            return 0
        tokens = context_tokens(payload.get("transcript_path") or "")
    except Exception:
        return 0
    if tokens is None:
        return 0
    pct = tokens / limit
    if pct < SUBAGENT_MAX_PCT:
        return 0
    act = cfg.get("actPct")
    act_note = f" (the guard asks for a handoff at {round(act * 100)}%)" if isinstance(act, (int, float)) else ""
    sys.stderr.write(
        f"SUBAGENT-GATE (card 66d4698a): no new sub-agent at {round(pct * 100)}% context "
        f"({tokens} of {int(limit)} tokens, the gate is at {round(SUBAGENT_MAX_PCT * 100)}%){act_note}. "
        "A sub-agent started now would most likely be killed by the context-guard restart, and its run "
        "paid for twice. Handoff first: put this sub-agent's brief into HANDOFF.md, so the fresh session "
        "after the restart spawns it. Until then work on without a sub-agent: nothing else is blocked.\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
