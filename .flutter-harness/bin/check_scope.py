#!/usr/bin/env python3
"""Local impact selection. Complete unit/widget suite remains mandatory in PR CI."""
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import stat
import subprocess


class UnknownScope(ValueError):
    pass


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


def paths(data):
    return {os.fsdecode(p) for p in data.split(b"\0") if p}


def signature(path):
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return "deleted"
    h = hashlib.sha256()
    if stat.S_ISLNK(mode):
        h.update(b"link\0" + os.fsencode(os.readlink(path)))
    elif stat.S_ISREG(mode):
        h.update(b"x" if mode & stat.S_IXUSR else b"-")
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
    else:
        raise UnknownScope("Non-regular input: " + str(path.name))
    return h.hexdigest()


def snapshot(root, base):
    if not base:
        return {}
    names = paths(git(root, "diff", "--no-renames", "--name-only", "-z", base, "--"))
    names |= paths(git(root, "ls-files", "-z", "--others", "--exclude-standard"))
    return {name: signature(root / name) for name in sorted(names)}


def environment(root):
    """Stable tool/package identity, excluding timestamps in package_config."""
    tools = []
    for name in ("flutter", "dart"):
        binary = shutil.which(name)
        if binary:
            path = Path(binary).resolve()
            for item in (path, path.parent / "cache/flutter.version.json",
                         path.parent / "cache/dart-sdk/version"):
                if item.is_file():
                    tools.append((str(item), item.stat().st_size, item.stat().st_mtime_ns))
        else:
            tools.append((name, "missing"))
    try:
        cfg = json.loads((root / ".dart_tool/package_config.json").read_text())
        packages = sorted(cfg["packages"], key=lambda p: p["name"])
    except (OSError, ValueError, KeyError, TypeError):
        packages = None
    return hashlib.sha256(json.dumps([tools, packages], sort_keys=True).encode()).hexdigest()


def context(root, task, prior):
    base = task.get("base_head") if task else None
    env = environment(root)
    current = snapshot(root, base)
    matched = bool(base and prior and prior.get("task") == task and
                   isinstance(prior.get("files"), dict))
    old = prior["files"] if matched else {}
    delta = sorted(k for k in current.keys() | old.keys() if current.get(k) != old.get(k))
    return base, env, current, delta, matched and prior.get("environment") != env, matched


# Lex only the directive prefix. Comments and strings cannot introduce imports.
# Unsupported/ambiguous syntax is an explicit full-suite fallback, not a guess.
TOKEN = re.compile(
    r"//[^\n]*|/\*[\s\S]*?\*/|r?(?:'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"|"
    r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")|[A-Za-z_$][\w$]*|[^\s]"
)


def directives(source):
    source = source.lstrip("\ufeff")
    if source.startswith("#!"):
        source = source.partition("\n")[2]

    def lex():
        for m in TOKEN.finditer(source):
            t = m.group()
            if t.startswith(("/*", "//")):
                if t.startswith("/*") and "/*" in t[2:]:
                    raise UnknownScope("Nested comment in directive prefix")
                continue
            yield t

    it = iter(lex())
    t = next(it, None)

    def advance():
        nonlocal t
        t = next(it, None)

    def need(expected):
        if t != expected:
            raise UnknownScope("Ambiguous Dart directive")
        advance()

    def balanced():
        need("(")
        depth = 1
        while depth and t is not None:
            depth += (t == "(") - (t == ")")
            advance()
        if depth:
            raise UnknownScope("Unclosed directive metadata/condition")

    def uri():
        token = t or ""
        raw = token[1:] if token.startswith("r") else token
        if (len(raw) < 2 or raw[0] not in "'\"" or raw[-1] != raw[0]
                or raw.startswith(("'''", '"""')) or any(x in raw[1:-1] for x in ("\\", "$", "\n"))):
            raise UnknownScope("Unsupported Dart URI")
        advance()
        return raw[1:-1]

    result = []
    while t is not None:
        if t == "@":
            advance()
            if not t or not re.fullmatch(r"[A-Za-z_$][\w$]*", t):
                raise UnknownScope("Unsupported directive metadata")
            advance()
            while t == ".":
                advance()
                if not t or not re.fullmatch(r"[A-Za-z_$][\w$]*", t):
                    raise UnknownScope("Unsupported directive metadata")
                advance()
            if t == "(":
                balanced()
            continue
        if t == "augment":
            raise UnknownScope("Augmentation dependencies are not supported")
        if t not in ("library", "import", "export", "part"):
            break
        kind = t
        advance()
        if kind == "part" and t == "of":
            advance()
            if t and (t[0] in "'\"" or t.startswith(("r'", 'r"'))):
                result.append(uri())
        elif kind != "library":
            result.append(uri())
            while t == "if":
                advance()
                balanced()
                result.append(uri())
        # Library names, deferred/as and show/hide end at the semicolon.
        while t not in (";", None):
            if kind in ("import", "export", "part") and t.startswith(("'", '"', "r'", 'r"')):
                raise UnknownScope("Unexpected string in Dart directive")
            advance()
        need(";")
    return result


def graph(root):
    pubspec = (root / "pubspec.yaml").read_text(encoding="utf-8")
    match = re.search(r"(?m)^name:[ \t]*['\"]?([a-zA-Z0-9_]+)['\"]?[ \t]*(?:#.*)?$", pubspec)
    if not match:
        raise UnknownScope("Cannot resolve project package")
    package = match.group(1)
    names = paths(git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"))
    dart = {n for n in names if n.endswith(".dart") and (root / n).is_file()}
    reverse = {}
    io_sources = set()
    for name in sorted(dart):
        if (root / name).is_symlink():
            raise UnknownScope("Symlinked Dart source")
        for uri in directives((root / name).read_text(encoding="utf-8")):
            if uri.startswith(("dart:io", "dart:ffi", "package:file/", "package:cross_file/")):
                io_sources.add(name)
            if uri.startswith("dart:"):
                continue
            if uri.startswith("package:"):
                pkg, sep, rest = uri[8:].partition("/")
                if not sep or not rest:
                    raise UnknownScope("Malformed package URI")
                if pkg != package:
                    continue
                target = posixpath.normpath("lib/" + rest)
            else:
                if not uri or any(x in uri for x in (":", "%", "?", "#")) or uri.startswith("/"):
                    raise UnknownScope("Unsupported local URI")
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), uri))
            if target not in dart:
                raise UnknownScope("Unresolved local Dart dependency: " + target)
            reverse.setdefault(target, set()).add(name)
    tests = {n for n in dart if n.startswith("test/") and n.endswith("_test.dart")}
    return reverse, tests, io_sources


def closure(reverse, seeds):
    reached = set(seeds)
    queue = list(reached)
    while queue:
        for dependent in reverse.get(queue.pop(), ()):
            if dependent not in reached:
                reached.add(dependent)
                queue.append(dependent)
    return reached


def dependency_input(name):
    return Path(name).name in ("pubspec.yaml", "pubspec.lock", "pubspec_overrides.yaml")


def native_input(name):
    return name.split("/", 1)[0] in ("android", "ios", "web", "linux", "macos", "windows")


def docs_input(name):
    return name.startswith("docs/") or ("/" not in name and name.lower().endswith((".md", ".txt")))


def scenario_input(name):
    return name.split("/", 1)[0] in ("maestro", ".maestro", "e2e", "playwright") or name.startswith("playwright.config.")


def known_dart(name):
    return name.endswith(".dart") and name.startswith(("lib/", "test/", "integration_test/", "tool/"))


def plan(root, task=None, prior=None, *, prepare_only=False):
    base, env, current, delta, env_changed, matched = context(root, task, prior)
    deps = any(dependency_input(n) for n in delta)
    pub_get = not base or env_changed or deps or not (root / ".dart_tool/package_config.json").is_file()
    reason = ""
    if not base:
        reason = "no task baseline"
    elif env_changed:
        reason = "SDK/package environment changed"
    elif deps:
        reason = "package dependencies changed"
    elif any(not (known_dart(n) or native_input(n) or docs_input(n) or scenario_input(n)) for n in delta):
        reason = "global or unclassified input changed"
    formats = sorted(n for n in delta if known_dart(n) and (root / n).is_file())
    if not base:
        formats = [n for n in ("lib", "test", "integration_test") if (root / n).is_dir()]
    if prepare_only:
        return {"pub_get": pub_get, "format": formats}, None
    dart_changed = {n for n in delta if n.endswith(".dart")}
    selected = set()
    uncovered = []
    if not reason and delta:
        try:
            reverse, tests, io_sources = graph(root)
            selected = closure(reverse, dart_changed) & tests
            # File-reading tests can depend on native/config/docs outside Dart imports.
            if any(native_input(n) or docs_input(n) or scenario_input(n) for n in delta):
                selected |= closure(reverse, io_sources) & tests
            uncovered = sorted(n for n in dart_changed if n.startswith("lib/") and
                               (root / n).is_file() and not (closure(reverse, {n}) & tests))
        except (UnknownScope, OSError, UnicodeError) as exc:
            reason = "uncertain Dart dependencies: " + str(exc)[:180]
    mode = "full" if reason else "selected" if selected else "none"
    return {
        "basis": "last-success" if matched else "task-base" if base else "none",
        "changed": delta,
        "mode": mode,
        "reason": reason or ("transitive Dart/IO dependencies" if selected else "no affected unit/widget tests"),
        "tests": sorted(selected),
        "uncovered": uncovered,
        "format": formats,
        "analyze": bool(reason or dart_changed),
        "product": bool(reason or any(n.startswith("lib/") for n in dart_changed)),
        "pub_get": pub_get,
        "platforms": sorted({n.split("/", 1)[0] for n in delta if native_input(n)}),
    }, {"task": task, "files": current, "environment": env}
