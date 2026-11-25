#!/usr/bin/env python3
"""Check Flutter Harness OpenCode V2 routing and safeguards (stdlib only)."""

import argparse
import json
import fnmatch
import sys
from pathlib import Path

LUNA = "openai/gpt-6-luna"
SOL = "openai/gpt-6.2-sol"
ROLES = {
    "build": f"{LUNA}#medium",
    "plan": f"{LUNA}#high",
    "architect": f"{LUNA}#high",
    "advisor": f"{SOL}#medium",
    "reviewer": f"{LUNA}#medium",
    "general": f"{LUNA}#medium",
    "explore": f"{LUNA}#low",
    "compaction": f"{LUNA}#low",
    "title": f"{LUNA}#low",
    "summary": f"{LUNA}#low",
}
REQUIRED_SAFETY = {
    ("external_directory", "*", "ask"),
    ("shell", "git push *", "deny"),
    ("shell", "gh pr create *", "deny"),
    ("shell", "gh pr ready *", "deny"),
    ("shell", "gh pr edit *", "deny"),
    ("shell", "python3 .flutter-harness/bin/harness.py deliver", "ask"),
    ("skill", "*", "deny"),
    ("shell", "git push --force*", "deny"),
    ("shell", "git push -f *", "deny"),
    ("shell", "gh pr merge *", "deny"),
    ("shell", "gh api *", "ask"),
    ("shell", "gh release create *", "deny"),
    ("shell", "flutter pub publish *", "deny"),
}
DISABLED_INTERACTIVE_SKILLS = {
    "brainstorming",
    "writing-plans",
    "executing-plans",
    "subagent-driven-development",
    "using-git-worktrees",
    "finishing-a-development-branch",
}

REVIEW_READONLY = {
    ("edit", "*", "deny"),
    ("shell", "*", "deny"),
    ("shell", "git status *", "allow"),
    ("shell", "git diff *", "allow"),
    ("shell", "git merge-base *", "allow"),
    ("shell", "git show *", "allow"),
    ("shell", "git log *", "allow"),
}


def ensure(value, message):
    if not value:
        raise ValueError(message)


def ruleset(rules):
    ensure(isinstance(rules, list), "permissions must be an ordered list")
    for rule in rules:
        ensure(isinstance(rule, dict), "permission entry must be an object")
        ensure(
            all(isinstance(rule.get(key), str) for key in ("action", "resource", "effect")),
            "permission entry must contain action/resource/effect strings",
        )
    return {(r["action"], r["resource"], r["effect"]) for r in rules}


def validate(filename, profile):
    data = json.loads(Path(filename).read_text(encoding="utf-8"))
    ensure(data.get("model") == LUNA, "default model must be Luna")
    ensure(data.get("default_agent") == "build", "default agent must be build")

    agents = data.get("agents", {})
    for name, model in ROLES.items():
        ensure(agents.get(name, {}).get("model") == model, f"wrong model/effort: {name}")
    for name in ("architect", "reviewer"):
        subagent = agents[name]
        ensure(subagent.get("mode") == "subagent", f"{name} must be a subagent")
        subagent_rules = ruleset(subagent.get("permissions"))
        ensure(REVIEW_READONLY <= subagent_rules, f"{name} isn't read-only")
        allowed_shell = {rule for rule in subagent_rules if rule[0] == "shell" and rule[2] == "allow"}
        ensure(allowed_shell <= REVIEW_READONLY, f"{name} permits unexpected shell commands")
    advisor = agents["advisor"]
    ensure(advisor.get("mode") == "subagent", "advisor must be a subagent")
    advisor_rules = ruleset(advisor.get("permissions"))
    for action in ("shell","subagent","question","external_directory","browser","dart_*","maestro_*","playwright_*","chrome-devtools_*","xcode_*","xcodebuild_*","generate_image","webfetch","websearch"):
        ensure((action,"*","deny") in advisor_rules, f"advisor must deny {action}")
    ensure("worker" not in agents, "Parallel implementation worker must not be configured")
    for action in ("edit", "read", "grep", "glob", "list", "skill"):
        ensure((action, "*", "deny") in advisor_rules, f"advisor must deny {action}")
    ensure(not any(effect == "allow" for _, _, effect in advisor_rules), "advisor must not override restrictions")
    ensure(all(name == "advisor" or agent.get("model", "").startswith(LUNA + "#")
               for name, agent in agents.items()), "only advisor may route outside Luna in supplied profile")
    ensure("OPEN" in agents["reviewer"].get("description", ""), "reviewer must report incomplete coverage as OPEN")

    ensure(REQUIRED_SAFETY <= ruleset(data.get("permissions")), "missing safety permissions")
    for action, resource, expected in REQUIRED_SAFETY:
        if "*" in resource:
            probe = resource.replace("*", "sample")
        else:
            probe = resource
        effective = [r["effect"] for r in data["permissions"] if fnmatch.fnmatchcase(action, r["action"]) and fnmatch.fnmatchcase(probe, r["resource"])]
        ensure(effective and effective[-1] == expected, f"unsafe effective permission: {action} {probe}")
    disabled_skills = {("skill", name, "deny") for name in DISABLED_INTERACTIVE_SKILLS}
    ensure(
        disabled_skills <= ruleset(data.get("permissions")),
        "interactive Superpowers workflow skills must be hidden in the autonomous profile",
    )

    provider = data.get("providers", {}).get("openai", {}).get("models", {})
    for name, effort in (("gpt-6-luna", "medium"), ("gpt-6.2-sol", "medium")):
        ensure(
            provider.get(name, {}).get("settings", {}).get("reasoningEffort") == effort,
            f"wrong model default effort: {name}",
        )

    servers = data.get("mcp", {}).get("servers", {})
    expected = {"dart", "maestro"}
    if profile == "mobile-web":
        expected |= {"playwright", "chrome-devtools"}
    ensure(set(servers) == expected, f"{profile} MCP servers must be {sorted(expected)}")
    ensure(all(server.get("disabled") is True for server in servers.values()), "MCP must be off in default templates")
    if profile == "mobile-web":
        ensure(
            servers["chrome-devtools"].get("disabled") is True,
            "Chrome DevTools MCP must be disabled unless diagnosing a Web failure",
        )
    ensure(servers["dart"].get("command") == ["dart", "mcp-server"], "Dart MCP command changed")
    ensure(servers["maestro"].get("command") == ["bash", ".flutter-harness/bin/maestro.sh", "mcp"], "Maestro MCP launcher changed")
    ensure(servers["maestro"].get("cwd") == ".", "Maestro MCP must use workspace cwd")
    if profile == "mobile-web":
        ensure(servers["playwright"].get("command") == ["npx", "--yes", "@playwright/mcp@0.0.86"], "Playwright pin changed")
        ensure(servers["chrome-devtools"].get("command") == ["npx", "--yes", "chrome-devtools-mcp@1.13.0"], "Chrome DevTools pin changed")
    ensure(
        data.get("plugins") == [
            "-superpowers",
            "-superpowers.*",
            "-superpowers@git+https://github.com/obra/superpowers.git#v7.0.2",
        ],
        "autonomous profile must explicitly exclude globally merged Superpowers",
    )
    print(f"PASS OpenCode {profile}: {filename}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("profile", choices=("mobile", "mobile-web"))
    args = parser.parse_args()
    try:
        validate(args.file, args.profile)
    except (ValueError, OSError) as error:
        print(f"FAIL OpenCode {args.file}: {error}", file=sys.stderr)
        sys.exit(1)
