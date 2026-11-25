#!/usr/bin/env python3
"""Summarize tokens and tool activity from sanitized OpenCode session exports.

No provider call, network request or raw message text. Usage fields follow
the export format and are NOT a billing estimate. Export parent AND child
sessions to include delegated-model use.
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


FIELDS = ("input", "output", "reasoning", "cache_read", "cache_write")


def summarize(exports):
    result = {
        "sessions": 0,
        "assistant_messages": 0,
        "usage": {name: 0 for name in FIELDS},
        "by_model": {},
        "tool_calls": {},
        "provider_errors": {},
        "tool_errors": {},
        "retry_events": 0,
        "synthetic_continuations": 0,
        "session_windows": [],
        "tool_duration_ms": 0,
    }
    models = defaultdict(lambda: {"messages": 0, **{name: 0 for name in FIELDS}})
    tools = Counter()
    provider_errors = Counter()
    tool_errors = Counter()
    seen_sessions = set()

    for data in exports:
        info = data.get("info") or {}
        session_id = info.get("id")
        if session_id and session_id in seen_sessions:
            raise ValueError("Duplicate session export: " + session_id)
        if session_id:
            seen_sessions.add(session_id)
        result["sessions"] += 1
        timing = info.get("time") or {}
        if isinstance(timing.get("created"), int) and isinstance(timing.get("idle", timing.get("updated")), int):
            result["session_windows"].append([timing["created"], timing.get("idle", timing.get("updated"))])

        for message in data.get("messages", []):
            if message.get("type") == "synthetic":
                result["synthetic_continuations"] += 1
            if message.get("type") != "assistant":
                continue
            if message.get("error"):
                provider_errors[str(message["error"].get("type") or "unknown")] += 1
            if message.get("retry"):
                result["retry_events"] += 1
            model = message.get("model") or {}
            if not model.get("id"):
                continue
            result["assistant_messages"] += 1
            key = "/".join(
                (
                    str(message.get("agent") or "?"),
                    str(model.get("providerID") or "?"),
                    str(model["id"]),
                    str(model.get("variant") or "?"),
                )
            )
            row = models[key]
            row["messages"] += 1
            tokens = message.get("tokens") or {}
            cache = tokens.get("cache") or {}
            usage = {
                "input": tokens.get("input") or 0,
                "output": tokens.get("output") or 0,
                "reasoning": tokens.get("reasoning") or 0,
                "cache_read": cache.get("read") or 0,
                "cache_write": cache.get("write") or 0,
            }
            for name, value in usage.items():
                row[name] += int(value)
                result["usage"][name] += int(value)
            for part in message.get("content") or []:
                if part.get("type") == "tool":
                    name = str(part.get("name") or "unknown")
                    tools[name] += 1
                    if (part.get("state") or {}).get("status") == "error":
                        tool_errors[name] += 1
                    timing = part.get("time") or {}
                    if isinstance(timing.get("ran"), int) and isinstance(timing.get("completed"), int):
                        result["tool_duration_ms"] += max(0, timing["completed"] - timing["ran"])

    result["by_model"] = dict(sorted(models.items()))
    result["tool_calls"] = dict(sorted(tools.items()))
    result["provider_errors"] = dict(sorted(provider_errors.items()))
    result["tool_errors"] = dict(sorted(tool_errors.items()))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="JSON export files, or - for stdin")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable totals")
    args = parser.parse_args()

    if args.files.count("-") > 1:
        parser.error("stdin can only be used once")
    try:
        exports = [
            json.load(sys.stdin) if path == "-" else json.loads(Path(path).read_text(encoding="utf-8"))
            for path in args.files
        ]
        summary = summarize(exports)
    except (ValueError, OSError, TypeError, KeyError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return

    print(f"Sessions: {summary['sessions']}; assistant messages: {summary['assistant_messages']}")
    print("Token counters (raw OpenCode export, not USD or a guaranteed total):")
    print("  " + ", ".join(f"{key}={value}" for key, value in summary["usage"].items()))
    print("By agent/provider/model/variant:")
    for name, counts in summary["by_model"].items():
        print(f"  {name}: messages={counts['messages']}, "
              + ", ".join(f"{k}={counts[k]}" for k in FIELDS))
    print("Tool calls: " + (", ".join(f"{k}={v}" for k, v in summary["tool_calls"].items()) or "none"))
    print("Note: supply child-session exports as well; caches and reasoning may overlap other counters.")


if __name__ == "__main__":
    main()
