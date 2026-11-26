#!/usr/bin/env python3
"""Deterministic Flutter lifecycle; no model calls or shell interpolation."""
import argparse
import csv
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time

# Installed modules must not create untracked artifacts or alter the candidate.
sys.dont_write_bytecode = True
import reporter

HERE = Path(__file__).resolve().parent
PNG = b"\x89PNG\r\n\x1a\n"


class Blocked(RuntimeError):
    pass


class DeliveryBlocked(Blocked):
    """A safe, actionable delivery failure; only known transient errors retry."""
    def __init__(self, code, message, retryable=False, stage=None):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.stage = stage

    def details(self):
        return {"code": self.code, "message": str(self), "retryable": self.retryable}


def remote_call(operation, fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except DeliveryBlocked:
        raise
    except subprocess.TimeoutExpired as exc:
        raise DeliveryBlocked(operation + "_TIMEOUT",
                              operation + " timed out; reconcile remote state", True) from exc
    except Blocked as exc:
        detail = str(exc).lower()
        if (operation == "PR_CREATE" and "already exists" in detail) or re.search(
                r"rate limit|http 429|http 5[0-9]{2}|temporary|temporarily|timed? out|timeout|connection (?:reset|refused|closed)|could not resolve host|network is unreachable|service unavailable|bad gateway|unexpected eof", detail):
            raise DeliveryBlocked(operation + "_TRANSIENT",
                                  operation + " temporarily unavailable; reconcile remote state", True) from exc
        if re.search(r"authentication|not authenticated|not logged|permission denied|forbidden|http 40[13]|bad credentials|gh auth login|could not read username", detail):
            raise DeliveryBlocked(operation + "_ACCESS",
                                  operation + " denied; check GitHub authentication/permissions") from exc
        raise DeliveryBlocked(operation + "_FAILED",
                              operation + " failed; inspect local command output before retrying") from exc


def require(ok, message):
    if not ok:
        raise Blocked(message)


def run(root, *args, capture=False, timeout=600, log=None, env=None):
    if log:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("wb") as stream:
            result = subprocess.run(args, cwd=root, stdout=stream,
                                    stderr=subprocess.STDOUT, timeout=timeout, env=env)
        if result.returncode:
            event(root, "command-failed", executable=args[0], exit=result.returncode, log=str(log.relative_to(root)))
            raise Blocked(f"{args[0]} exit={result.returncode}; log={log}")
        return ""
    result = subprocess.run(args, cwd=root, capture_output=capture,
                            timeout=timeout, env=env)
    if result.returncode:
        detail = (result.stderr or b"").decode(errors="replace")[-1000:] if capture else ""
        raise Blocked(f"{args[0]} exit={result.returncode}: {detail}")
    return result.stdout if capture else b""


def git(root, *args):
    return run(root, "git", *args, capture=True, timeout=60)


def text(data):
    return data.decode("utf-8").strip()


def output(**data):
    print(json.dumps(data, ensure_ascii=False, sort_keys=True))


def read_json(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"Expected JSON object: {path}")
    return value


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                     dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write("\n")
    try:
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def config(root):
    c = read_json(root / ".flutter-harness/config.json")
    require(c.get("schema") == 2, "Install/sync Harness schema 2 first")
    require(c.get("profile") in ("mobile", "mobile-web"), "Invalid profile")
    base = c.get("integration_branch")
    require(isinstance(base, str) and base and not base.startswith("-"),
            "Invalid integration branch")
    git(root, "check-ref-format", "--branch", base)
    return c


def installed_revision(root, c, expected=None, base_ref=None):
    """Validate local managed bytes and, before begin, the fetched base.
    This is consistency, not a remote latest-version service."""
    revision = c.get("revision")
    require(isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40,64}",revision),
            "Missing Harness revision; sync managed installation")
    manifest_path = root / ".flutter-harness/managed.json"
    manifest = read_json(manifest_path)
    require(manifest.get("schema") == 2 and manifest.get("revision") == revision,
            "Harness config/manifest revision mismatch")
    require(expected is None or revision == expected,
            "Installed Harness revision differs from expected source revision; sync first")
    managed = manifest.get("files")
    require(isinstance(managed,dict) and ".flutter-harness/config.json" in managed and
            ".flutter-harness/bin/harness.py" in managed and
            ".opencode/plugins/delivery-guard/index.js" in managed,
            "Incomplete managed manifest")
    for name, digest in managed.items():
        path = root / name
        require(not Path(name).is_absolute() and ".." not in Path(name).parts and
                not any(p.is_symlink() for p in (path,*path.parents) if p != root and root in p.parents)
                and path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                "Managed Harness file differs: " + name)
    def agents_hash(data):
        blocks = re.findall(rb"<!-- flutter-harness:start -->[\s\S]*?<!-- flutter-harness:end -->",data)
        require(len(blocks)==1,"Missing or ambiguous managed AGENTS block")
        return hashlib.sha256(blocks[0]).hexdigest()
    require(agents_hash((root/"AGENTS.md").read_bytes()) == manifest.get("agents_block"),
            "Managed AGENTS block differs")
    if base_ref:
        try:
            remote = git(root,"show",base_ref+":.flutter-harness/managed.json")
            remote_agents = git(root,"show",base_ref+":AGENTS.md")
        except Blocked:
            raise Blocked("Integration branch has no compatible Harness installation; merge sync PR first") from None
        require(json.loads(remote) == manifest and agents_hash(remote_agents)==manifest["agents_block"],
                "Integration branch has a different Harness revision; merge sync PR and restart OpenCode before begin")
        require(not git(root,"diff","--name-only",base_ref,"--",*managed),
                "Integration branch managed files differ; merge sync PR first")
    return {"status":"PASS","revision":revision,"managed_files":len(managed),
            "manifest_sha256":hashlib.sha256(manifest_path.read_bytes()).hexdigest()}


def work(root):
    return root / ".flutter-harness/work"


def event(root, stage, **details):
    """Append only structured lifecycle facts, never prompts or command output."""
    path = work(root) / "lifecycle.jsonl"
    try:
        details.setdefault("revision",read_json(root/".flutter-harness/config.json").get("revision"))
    except (OSError,ValueError,Blocked):
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"at": int(time.time() * 1000), "stage": stage, **details}) + "\n")


def paths(data):
    return [os.fsdecode(p) for p in data.split(b"\0") if p]


def fingerprint(root):
    """All tracked and nonignored files, including native/assets/configuration.
    Stable across staging/commit of the same working-tree contents."""
    names = sorted(set(paths(git(root, "ls-files", "-z", "--cached",
                                "--others", "--exclude-standard"))))
    h = hashlib.sha256()
    for name in names:
        path = root / name
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            continue
        require(not stat.S_ISDIR(mode), f"Submodules are outside v0 scope: {name}")
        h.update(os.fsencode(name) + b"\0")
        if stat.S_ISLNK(mode):
            h.update(b"link\0" + os.fsencode(os.readlink(path)))
        else:
            require(stat.S_ISREG(mode), f"Unsupported file: {name}")
            h.update(b"x" if mode & stat.S_IXUSR else b"-")
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
        h.update(b"\0")
    return h.hexdigest()


def dirty(root):
    return sorted(set(paths(git(root, "diff", "--no-renames", "--name-only",
                                "-z", "HEAD", "--")) +
                      paths(git(root, "ls-files", "-z", "--others",
                                "--exclude-standard")) +
                      paths(git(root, "diff", "--cached", "--no-renames",
                                "--name-only", "-z", "HEAD", "--"))))


def branch(root, base):
    name = text(git(root, "symbolic-ref", "--short", "HEAD"))
    require(name not in (base, "main", "master", "app", "develop", ""),
            f"Expected feature branch, got {name}")
    return name


def fetch_base(root,base):
    # Refresh the explicit integration reference.
    git(root,"fetch","--no-write-fetch-head","origin",
        "+refs/heads/"+base+":refs/remotes/origin/"+base)
    return text(git(root,"rev-parse","refs/remotes/origin/"+base))


def begin(root, c, name):
    base = c["integration_branch"]
    require(not name.startswith("-"), "Invalid branch")
    git(root, "check-ref-format", "--branch", name)
    require(name not in (base, "main", "master", "app", "develop") and
            not name.startswith("-"), "Unsafe feature branch")
    require(not dirty(root), "Dirty checkout; preserve existing changes before begin")
    fetch_base(root,base)
    installed_revision(root,c,base_ref="origin/"+base)
    current = text(git(root, "symbolic-ref", "--short", "HEAD"))
    task_path = work(root)/"task.json"
    base_head = text(git(root,"rev-parse","origin/"+base))
    task = read_json(task_path) if task_path.is_file() else {}
    if current == name and task:
        if all(task.get(k)==v for k,v in {"branch":name,"base_head":base_head,"revision":c["revision"]}.items()):
            output(status="PASS",branch=name,base=base,reused=True)
            return
    if current != name:
        git(root, "switch", "-c", name, "origin/" + base)
    if current != name or task.get("branch") != name:
        for filename in ("check.json","delivery.json","delivery-result.json","delivery-state.json","runtime.json","visual-plan.json","visual-preflight.json","runtime-selection.json","sessions.json","baseline.json","check-attempt.json","e2e-android.json","e2e-ios.json","e2e-web.json"):
            (work(root)/filename).unlink(missing_ok=True)
    require(text(git(root, "merge-base", "HEAD", "origin/" + base)) ==
            text(git(root, "rev-parse", "origin/" + base)),
            "Feature branch does not contain current integration base")
    installed_revision(root,c)
    atomic_json(task_path,{"branch":name,"base_head":base_head,"revision":c["revision"],"baseline_digest":fingerprint(root),"started_at":int(time.time()*1000)})
    event(root, "begin", branch=name, base=base)
    output(status="PASS", branch=name, base=base)


def doctor(root, c, operation, only=None):
    require(only is None or operation=="visual", "--only is for visual preflight")
    if operation == "visual":
        visual_preflight(root, c, only)
        return
    needed = {"check": ("git", "flutter", "dart", "python3"),
              "deliver": ("git", "gh"), "android": ("flutter", "adb"),
              "ios": ("flutter", "xcrun"), "web": ("flutter", "npx"),
              "e2e": ("flutter",)}[operation]
    tools = {name: shutil.which(name) for name in needed}
    missing = [name for name, location in tools.items() if not location]
    devices = None
    if operation in ("android", "ios", "web") and not missing:
        try:
            devices = json.loads(run(root, "flutter", "devices", "--machine",
                                     capture=True, timeout=60))
        except (Blocked, ValueError):
            missing.append("Flutter device discovery")
    if operation == "deliver" and not missing:
        try:
            run(root, "gh", "auth", "status", "--hostname", "github.com",
                capture=True, timeout=30)
        except Blocked:
            missing.append("github authentication")
    output(status="BLOCKED" if missing else "PASS", operation=operation,
           tools=tools, missing=missing, profile=c["profile"], devices=devices)
    require(not missing, "Missing required prerequisites")


def current_check(root,digest):
    """Read the canonical receipt only when no verification owns the lock."""
    folder=work(root)
    folder.mkdir(parents=True,exist_ok=True)
    with (folder/"check.lock").open("a") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        receipt=folder/"check.json"
        if not receipt.is_file():
            return False
        value=read_json(receipt)
        return value.get("status")=="PASS" and value.get("digest")==digest


def check(root, c):
    folder = work(root)
    folder.mkdir(parents=True,exist_ok=True)
    # A second canonical check cannot erase a running check's receipt.
    with (folder/"check.lock").open("a") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise Blocked("Standard check already running; inspect check-attempt.json")
        attempt = {"status":"RUNNING","branch":text(git(root,"branch","--show-current")),
                   "revision":c["revision"],"started_at":int(time.time()*1000),"pid":os.getpid()}
        path = folder/"check-attempt.json"
        atomic_json(path,attempt)
        try:
            check_candidate(root,c,attempt)
        except BaseException as exc:
            attempt.update(status="INTERRUPTED" if isinstance(exc,(KeyboardInterrupt,SystemExit)) else "FAIL",
                           error_type=type(exc).__name__,finished_at=int(time.time()*1000))
            atomic_json(path,attempt)
            raise
        attempt.update(status="PASS",finished_at=int(time.time()*1000))
        atomic_json(path,attempt)


def check_candidate(root,c,attempt):
    receipt = work(root) / "check.json"
    receipt.unlink(missing_ok=True)
    event(root, "check-start")
    require((root / ".flutter-harness/product.json").is_file(), "Missing product policy configuration")
    logs = Path(tempfile.mkdtemp(prefix="prepare-", dir=work(root)))
    run(root, "flutter", "pub", "get", log=logs / "pub-get.log",timeout=120)
    run(root, "dart", "format", "lib", "test", log=logs / "format.log",timeout=60)
    before = fingerprint(root)
    # Unique artifact directory prevents collisions between runs/checkouts.
    artifact_dir = Path(tempfile.mkdtemp(prefix="standard-", dir=work(root)))
    environment = dict(os.environ, HARNESS_ARTIFACTS_DIR=str(artifact_dir))
    attempt.update(digest=before,artifacts=str(artifact_dir.relative_to(root)))
    atomic_json(work(root)/"check-attempt.json",attempt)
    event(root, "check-run", artifacts=str(artifact_dir.relative_to(root)))
    # Keep short runner stdout visible for the OpenCode quality hook.
    try:
        run(root, "bash", str(HERE / "check.sh"), ".", "standard", c["profile"], env=environment, timeout=2400)
    except (Blocked,subprocess.TimeoutExpired):
        reports=list(artifact_dir.glob("check-*.tsv"))
        if len(reports)==1:
            with reports[0].open(encoding="utf-8") as stream:
                rows=list(csv.DictReader(stream,delimiter="\t"))
            attempt["checks"]=rows
            attempt["report"]=str(reports[0].relative_to(root))
            failures=[r for r in rows if r.get("status")!="PASS"]
            if failures:
                event(root,"check-failed",check=failures[-1]["check"],status=failures[-1]["status"],exit=failures[-1]["exit_code"],report=attempt["report"])
        raise
    require(fingerprint(root) == before, "Check inputs changed during verification")
    reports = list(artifact_dir.glob("check-*.tsv"))
    require(len(reports) == 1, "Missing unique runner report")
    with reports[0].open() as f:
        checks = list(csv.DictReader(f, delimiter="\t"))
    require({r.get("check") for r in checks if r.get("status")=="PASS"} ==
            {"format","product","analyze","flutter-tests"}, "Incomplete standard runner evidence")
    attempt["checks"]=checks
    attempt["report"]=str(reports[0].relative_to(root))
    atomic_json(receipt, {"digest": before, "status": "PASS", "checks":checks,
                          "report":str(reports[0]), "checked_at": int(time.time())})
    event(root, "check-pass", digest=before)
    output(status="PASS", digest=before, receipt=str(receipt))


def origin_repo(root):
    origin = text(git(root, "remote", "get-url", "origin"))
    match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?", origin)
    require(match, "Expected a GitHub origin remote")
    require(text(git(root, "remote", "get-url", "--push", "origin")) == origin,
            "Push URL differs from origin")
    return match.group(1)


def canonical_repo(root, origin):
    """Resolve GitHub redirects without changing the user's local remote."""
    raw = remote_call("REPO_RESOLVE", run, root, "gh", "repo", "view", origin,
                      "--json", "nameWithOwner,id", capture=True, timeout=60)
    try:
        data = json.loads(raw)
        name, repo_id = data["nameWithOwner"], data["id"]
    except (ValueError, TypeError, KeyError) as exc:
        raise DeliveryBlocked("REPO_RESPONSE", "Invalid GitHub repository response") from exc
    if not (isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", name)
            and isinstance(repo_id, str) and repo_id):
        raise DeliveryBlocked("REPO_RESPONSE", "Invalid GitHub repository identity")
    return name, repo_id


def valid_pr_url(url, repo, number):
    return (type(number) is int and number > 0 and isinstance(repo, str)
            and isinstance(url, str)
            and url.lower() == ("https://github.com/" + repo + "/pull/" + str(number)).lower())


def pr_list(root, repo, name):
    data = json.loads(run(root, "gh", "pr", "list", "--repo", repo,
                          "--head", name, "--state", "open",
                          "--json", "number,baseRefName,headRefName,headRepositoryOwner,isCrossRepository,isDraft,headRefOid,state,url,title,body",
                          capture=True, timeout=60))
    if not isinstance(data, list) or not all(isinstance(p, dict) for p in data):
        raise DeliveryBlocked("PR_RESPONSE", "Invalid GitHub PR response")
    own = [p for p in data if p.get("headRefName") == name and
           p.get("isCrossRepository") is False and
           (p.get("headRepositoryOwner") or {}).get("login", "").lower() ==
           repo.split("/")[0].lower()]
    if len(own) > 1:
        raise DeliveryBlocked("PR_MULTIPLE", "Multiple PRs for this branch")
    return own[0] if own else None


def validate_remote_pr(pr, repo, base, name, head):
    if not (pr and pr.get("state") == "OPEN" and pr.get("baseRefName") == base and
            pr.get("headRefName") == name and pr.get("headRefOid") == head and
            pr.get("isCrossRepository") is False and pr.get("isDraft") is False):
        raise DeliveryBlocked("PR_IDENTITY_MISMATCH",
                              "PR missing, draft, stale, closed, cross-repo or targets the wrong branch")
    if not valid_pr_url(pr.get("url"), repo, pr.get("number")):
        raise DeliveryBlocked("PR_URL_MISMATCH", "Unexpected PR URL for canonical repository and PR number")
    return pr


def manifest_digest(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def current_delivery_failure(root, c, name, digest, head, receipt):
    """Return only a failure belonging to the exact current checked candidate."""
    try:
        state = read_json(work(root) / "delivery-state.json")
        manifest = read_json(work(root) / "delivery.json")
        expected = {"branch": name, "base": c["integration_branch"], "digest": digest,
                    "head": head, "revision": c["revision"],
                    "manifest_digest": manifest_digest(manifest), "checked_at": receipt.get("checked_at")}
        if state.get("status") != "BLOCKED" or any(state.get(k) != v for k, v in expected.items()):
            return None
        if state.get("origin_repo") and state["origin_repo"].lower() != origin_repo(root).lower():
            return None
        error = state["error"]
        if not (isinstance(error.get("code"), str) and isinstance(error.get("message"), str)
                and isinstance(error.get("retryable"), bool)):
            return None
        return DeliveryBlocked(error["code"], error["message"], error["retryable"], state["stage"])
    except (OSError, ValueError, KeyError, AttributeError, Blocked):
        return None


def completion(root, c):
    """Local evidence of an exact candidate previously verified against GitHub.
    No network call. Use verify for an explicit fresh remote read."""
    name = branch(root, c["integration_branch"])
    digest = fingerprint(root)
    head = text(git(root, "rev-parse", "HEAD"))
    receipt_path = work(root) / "check.json"
    if dirty(root) and not receipt_path.is_file():
        raise Blocked("Uncommitted work remains")
    receipt = read_json(receipt_path)
    failure = current_delivery_failure(root, c, name, digest, head, receipt)
    if failure and receipt.get("status") == "PASS" and receipt.get("digest") == digest:
        raise failure
    require(not dirty(root), "Uncommitted work remains")
    require(receipt.get("status") == "PASS" and receipt.get("digest") == digest,
            "Missing/stale standard check receipt")
    path = work(root) / "delivery-result.json"
    require(path.is_file(), "Missing delivery-result.json; resume canonical deliver")
    result = read_json(path)
    manifest = read_json(work(root) / "delivery.json")
    require(all(result.get(k) == v for k, v in {
        "status": "PASS", "head": head, "digest": digest, "branch": name,
        "base": c["integration_branch"], "revision":c["revision"],
        "manifest_digest": manifest_digest(manifest), "checked_at": receipt.get("checked_at"),
    }.items()) and isinstance(result.get("delivered_at"), int),
            "Missing/stale delivery evidence; resume canonical deliver")
    require(isinstance(result.get("repo_id"), str) and result["repo_id"] and
            isinstance(result.get("origin_repo"), str) and isinstance(result.get("repo"), str) and
            origin_repo(root).lower() in (result["origin_repo"].lower(), result["repo"].lower()),
            "Missing/stale repository identity; resume canonical deliver")
    require(valid_pr_url(result.get("pr"), result["repo"], result.get("pr_number")),
            "Invalid delivery PR URL")
    return result


def verify(root, c):
    result = completion(root, c)
    repo, repo_id = canonical_repo(root, origin_repo(root))
    require(repo_id == result["repo_id"], "Remote repository differs from delivery receipt")
    pr = validate_remote_pr(remote_call("PR_LIST", pr_list, root, repo, result["branch"]),
                            repo, result["base"], result["branch"], result["head"])
    require(pr["number"] == result["pr_number"], "Remote PR differs from delivery receipt")
    output(status="PASS", pr=pr["url"], head=result["head"])
    return pr


def delivery_manifest(root,c):
    """Validate before expensive acceptance/review, without staging or network."""
    manifest = read_json(work(root)/"delivery.json")
    for key in ("review_required","visual_required","visual_interaction"):
        require(key not in manifest or isinstance(manifest[key],bool),"Expected boolean "+key)
    required_e2e = manifest.get("required_e2e",[])
    require(isinstance(required_e2e,list) and all(isinstance(p,str) and p in ("android","ios","web") for p in required_e2e)
            and len(set(required_e2e))==len(required_e2e),"Invalid required_e2e: use [] or platform names")
    require(c["profile"]=="mobile-web" or "web" not in required_e2e,"Web disabled")
    for key in ("message","title","body"):
        require(isinstance(manifest.get(key),str) and manifest[key].strip(),"Missing delivery "+key)
    files = manifest.get("files")
    require(isinstance(files,list) and all(isinstance(x,str) for x in files)
            and len(files)==len(set(files)),"Expected exact task file list")
    for path in files:
        require(path and not Path(path).is_absolute() and Path(path).as_posix()==path
                and ".." not in Path(path).parts and not path.startswith(("-",".git/",".flutter-harness/work/",".flutter-harness/previews/"))
                and path!=".git","Unsafe delivery path: "+path)
    changed = dirty(root)
    require(not changed or set(changed)==set(files),"Dirty files differ from explicit task list; no files staged")
    return manifest


def prepare_delivery(root,c,a):
    name = branch(root,c["integration_branch"])
    files = dirty(root)
    require(files,"No uncommitted task files; retain existing manifest for delivery recovery")
    require(a.message.strip() and a.title.strip() and a.body.strip(),"Nonempty delivery text required")
    manifest = {"message":a.message,"title":a.title,"body":a.body,"files":files,
                "review_required":a.review or a.visual or a.interaction,
                "visual_required":a.visual or a.interaction,"visual_interaction":a.interaction,
                "required_e2e":sorted(set(a.e2e))}
    path = work(root)/"delivery.json"
    previous = read_json(path) if path.is_file() else {}
    # Never silently relax declared acceptance in a retry.
    for k in ("review_required","visual_required","visual_interaction"):
        manifest[k] = manifest[k] or previous.get(k) is True
    old_e2e = previous.get("required_e2e",[])
    if isinstance(old_e2e,list) and all(isinstance(p,str) and p in ("android","ios","web") for p in old_e2e):
        manifest["required_e2e"] = sorted(set(manifest["required_e2e"]+old_e2e))
    atomic_json(path,manifest)
    delivery_manifest(root,c)
    output(status="PASS",branch=name,files=files,required_e2e=manifest["required_e2e"],
           visual_required=manifest["visual_required"],visual_interaction=manifest["visual_interaction"])


def deliver(root, c):
    """Called only after the OpenCode policy gate and owner publication approval."""
    state = {}
    try:
        return _deliver(root, c, state)
    except (Blocked, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        if state:
            if isinstance(exc, DeliveryBlocked):
                failure = exc
                if failure.stage is None:
                    failure.stage = state["stage"]
            elif isinstance(exc, Blocked) and "\n" not in str(exc) and "exit=" not in str(exc):
                failure = DeliveryBlocked("DELIVERY_INVARIANT", str(exc)[:240])
            else:
                failure = DeliveryBlocked("DELIVERY_LOCAL_ERROR",
                                          "Delivery failed locally; inspect command output")
            failed = {**state, "status": "BLOCKED", "error": failure.details()}
            atomic_json(work(root) / "delivery-state.json", failed)
            event(root, "delivery-failed", branch=state["branch"], digest=state["digest"],
                  failed_stage=state["stage"], error=failure.details())
            # Report the original exception in the terminal; recovery uses safe structured evidence.
        raise


def _deliver(root, c, state):
    name = branch(root, c["integration_branch"])
    receipt = read_json(work(root) / "check.json")
    digest = fingerprint(root)
    require(current_check(root,digest),
            "Missing/stale standard check receipt or check running; run check")
    manifest = delivery_manifest(root,c)
    identity = {"branch": name, "base": c["integration_branch"], "digest": digest,
                "revision": c["revision"], "manifest_digest": manifest_digest(manifest),
                "checked_at": receipt.get("checked_at"), "head": text(git(root, "rev-parse", "HEAD"))}
    def checkpoint(stage, **extra):
        state.clear()
        state.update({**identity, "stage": stage, **extra})
        atomic_json(work(root) / "delivery-state.json", state)
        event(root, stage, **{k: v for k, v in state.items() if k != "stage"})
    checkpoint("delivery-started")
    visual = visual_evidence(root,manifest.get("visual_interaction") is True,emit=False) if manifest.get("visual_required") is True or manifest.get("visual_interaction") is True else None
    required_e2e = manifest.get("required_e2e", [])
    require(isinstance(required_e2e, list) and all(p in ("android", "ios", "web") for p in required_e2e), "Invalid required_e2e")
    for platform in required_e2e:
        e = read_json(work(root) / ("e2e-" + platform + ".json"))
        require(e.get("status") == "PASS" and e.get("digest") == digest and e.get("platform") == platform,
                f"Missing/stale required {platform} E2E")
    files = manifest["files"]
    changed = dirty(root)
    origin = origin_repo(root)
    identity["origin_repo"] = origin
    checkpoint("delivery-resolving")
    repo, repo_id = canonical_repo(root, origin)
    identity.update(repo=repo, repo_id=repo_id)
    checkpoint("delivery-resolved")
    base = c["integration_branch"]
    # Refresh base before publishing; never merge/rebase implicitly.
    remote_call("GIT_FETCH", fetch_base, root, base)
    require(text(git(root, "merge-base", "HEAD", "origin/" + base)) ==
            text(git(root, "rev-parse", "origin/" + base)),
            "Integration branch advanced; reconcile and recheck")
    require(fingerprint(root) == digest, "Candidate changed before publication")
    existing = remote_call("PR_LIST", pr_list, root, repo, name)
    if existing:
        if existing.get("baseRefName") != base:
            raise DeliveryBlocked("PR_BASE_MISMATCH", "Existing PR targets another base")
        if not valid_pr_url(existing.get("url"), repo, existing.get("number")):
            raise DeliveryBlocked("PR_URL_MISMATCH", "Unexpected PR URL for canonical repository and PR number")
    checkpoint("delivery-validated")
    if changed:
        git(root, "--literal-pathspecs", "add", "-A", "--", *files)
        staged = paths(git(root, "diff", "--cached", "--no-renames",
                           "--name-only", "-z", "HEAD", "--"))
        require(set(staged) == set(changed) and
                not git(root, "diff", "--name-only", "-z") and
                not git(root, "ls-files", "-z", "--others", "--exclude-standard") and
                fingerprint(root) == digest, "Index/working candidate mismatch")
        git(root, "commit", "-m", manifest["message"])
    require(not dirty(root) and fingerprint(root) == digest,
            "Commit does not match checked working candidate")
    require(git(root, "diff", "--name-only", "origin/" + base, "HEAD"),
            "No task change to publish")
    head = text(git(root, "rev-parse", "HEAD"))
    identity["head"] = head
    checkpoint("delivery-committed", head=head)
    body = work(root) / "pr-body.md"
    summary = ["", "", "## Harness evidence (generated)", f"- Harness revision: {c['revision']}", f"- Candidate: {digest}", "- Standard check: PASS"]
    if visual:
        summary.append(f"- Visual evidence: {visual['evidence_digest']}")
    for platform in required_e2e:
        summary.append(f"- Required {platform} E2E: PASS")
    expected_body = manifest["body"].rstrip() + "\n".join(summary) + "\n"
    body.write_text(expected_body, encoding="utf-8")
    def matching(pr):
        return (pr and pr.get("headRefOid") == head and
                pr.get("title") == manifest["title"] and
                (pr.get("body") or "").rstrip() == expected_body.rstrip() and
                not pr.get("isDraft"))
    # Recover a completed remote operation even if the previous process died
    # before writing its local receipt. Never republish an identical PR.
    if not existing or existing.get("headRefOid") != head:
        remote_call("GIT_PUSH", git, root, "push", "-u", "origin", "HEAD:refs/heads/" + name)
    checkpoint("delivery-pushed", head=head)
    if not matching(existing):
        if existing:
            if (existing.get("title") != manifest["title"] or
                    (existing.get("body") or "").rstrip() != expected_body.rstrip()):
                remote_call("PR_EDIT", run, root, "gh", "pr", "edit", str(existing["number"]), "--repo", repo,
                            "--title", manifest["title"], "--body-file", str(body), capture=True, timeout=60)
            if existing.get("isDraft"):
                remote_call("PR_READY", run, root, "gh", "pr", "ready", str(existing["number"]), "--repo", repo,
                            capture=True, timeout=60)
        else:
            remote_call("PR_CREATE", run, root, "gh", "pr", "create", "--repo", repo, "--base", base,
                        "--head", name, "--title", manifest["title"], "--body-file", str(body), capture=True, timeout=60)
        existing = remote_call("PR_LIST", pr_list, root, repo, name)
        if not existing:
            raise DeliveryBlocked("PR_NOT_VISIBLE", "Published PR not yet visible; reconcile remote state", True)
    pr = validate_remote_pr(existing, repo, base, name, head)
    require(matching(pr), "Remote PR metadata differs from delivery manifest")
    checkpoint("delivery-remote-verified", head=head, pr=pr["url"])
    require(not dirty(root) and fingerprint(root) == digest and
            text(git(root, "rev-parse", "HEAD")) == head,
            "Candidate changed during delivery")
    result = {**identity, "status": "PASS", "head": head, "pr": pr["url"],
              "pr_number": pr["number"], "delivered_at": int(time.time())}
    atomic_json(work(root) / "delivery-result.json", result)
    checkpoint("delivery-complete", head=head, pr=pr["url"])
    output(**result)


def scaffold(root, name, layers):
    require(re.fullmatch(r"[a-z][a-z0-9_]*", name), "Use snake_case feature name")
    require(layers, "Select needed layers")
    for layer in layers:
        target = root / "lib/features" / name / layer
        require(not any(p.is_symlink() for p in (target, *target.parents) if p != root and root in p.parents), "Symlink in scaffold path")
        target.mkdir(parents=True, exist_ok=True)
        suffix = {"view_models": "view_model", "screens": "screen"}.get(layer)
        if suffix:
            file = target / (name + "_" + suffix + ".dart")
            if not file.exists():
                cls = "".join(part.capitalize() for part in name.split("_"))
                template = root / ".flutter-harness/templates/product/scaffold" / (suffix + ".dart.template")
                file.write_text(template.read_text().replace("@CLASS@", cls), encoding="utf-8")
    output(status="PASS", feature=name, layers=layers)


def png_size(data):
    require(len(data) >= 33 and data.startswith(PNG) and data[12:16] == b"IHDR",
            "Invalid PNG header")
    width, height = struct.unpack(">II", data[16:24])
    require(width > 0 and height > 0, "Invalid PNG dimensions")
    return [width, height]


@contextmanager
def target_lock(platform, device):
    # OS releases the lock if a capture process dies. Per-user, per-device,
    # across project checkouts. No concurrent theme change/capture via CLI.
    key = hashlib.sha256((platform + ":" + device).encode()).hexdigest()
    folder = Path(tempfile.gettempdir()) / ("flutter-harness-" + str(os.getuid()))
    folder.mkdir(mode=0o700, exist_ok=True)
    with (folder / (key + ".lock")).open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Blocked("Runtime target busy; wait for the current capture/launch")
        yield


def probe_runtime(root, platform, device=None):
    with tempfile.TemporaryDirectory() as temp:
        image = Path(temp) / "probe.png"
        if platform == "android":
            require(device and not device.startswith("-"), "Explicit emulator ID required")
            require(text(run(root, "adb", "-s", device, "shell", "getprop",
                             "ro.kernel.qemu", capture=True, timeout=15)) == "1",
                    "Not an Android emulator")
            require(text(run(root, "adb", "-s", device, "shell", "getprop",
                             "sys.boot_completed", capture=True, timeout=15)) == "1",
                    "Android emulator not booted")
            image.write_bytes(run(root, "adb", "-s", device, "exec-out", "screencap",
                                  "-p", capture=True, timeout=15))
        elif platform == "ios":
            require(device and not device.startswith("-"), "Explicit simulator ID required")
            run(root, "xcrun", "simctl", "getenv", device, "HOME", capture=True, timeout=15)
            run(root, "xcrun", "simctl", "io", device, "screenshot", str(image),
                capture=True, timeout=20)
        else:
            # Probe the actual installed browser, not merely the npx executable.
            # --no-install prevents opportunistic downloads.
            run(root, "npx", "--no-install", "playwright", "screenshot",
                "--browser=chromium", "about:blank", str(image), capture=True, timeout=30)
        return png_size(image.read_bytes())


def runtime_targets(root,c,only=None):
    devices = json.loads(run(root,"flutter","devices","--machine",capture=True,timeout=60))
    require(isinstance(devices,list),"Invalid Flutter device discovery")
    choices = {"ios":[],"android":[]}
    for item in devices:
        target = item.get("id")
        platform = str(item.get("targetPlatform",""))
        if item.get("emulator") is not True or not isinstance(target,str):
            continue
        platform = "android" if platform.startswith("android") else platform
        if platform not in choices:
            continue
        name = str(item.get("name",""))
        preferred = os.environ.get("HARNESS_"+platform.upper()+"_DEVICE")
        phone = not re.search(r"ipad|tablet|fold|desktop",name,re.I)
        choices[platform].append(((target != preferred,not phone,name.casefold(),target),target))
    targets = []
    for platform in ("ios","android"):
        if only and only != platform:
            continue
        # One deterministic booted device per platform, not all emulators.
        if choices[platform]:
            targets.append((platform,min(choices[platform])[1]))
    if c["profile"] == "mobile-web" and only in (None,"web"):
        targets.append(("web",None))
    return targets


def pinned_target(root):
    path = work(root)/"runtime-selection.json"
    if not path.exists():
        return None
    data = read_json(path)
    require(data.get("branch")==text(git(root,"branch","--show-current")),
            "Runtime selection belongs to another task; use begin")
    return (data["platform"],data.get("device"))


def save_preflight(root,ready,unavailable):
    report = {"status":"PASS" if ready else "BLOCKED","ready":ready,"unavailable":unavailable,
              "branch":text(git(root,"branch","--show-current")),"digest":fingerprint(root)}
    atomic_json(work(root)/"visual-preflight.json",report)
    event(root,"visual-preflight",ready=[x["platform"] for x in ready],
          unavailable=[x["platform"] for x in unavailable])
    return report


def visual_preflight(root,c,only=None):
    pin = pinned_target(root)
    require(not pin or only in (None,pin[0]), "Required platform differs from pinned task target")
    unavailable = []
    for platform,target in ([pin] if pin else runtime_targets(root,c,only)):
        try:
            dimensions = probe_runtime(root,platform,target)
        except (Blocked,OSError,ValueError,subprocess.TimeoutExpired) as exc:
            unavailable.append({"platform":platform,"device":target,"reason":str(exc)[:800]})
            continue
        report = save_preflight(root,[{"platform":platform,"device":target,"size":dimensions}],unavailable)
        output(**report)
        return
    output(**save_preflight(root,[],unavailable))
    raise Blocked("No capture-capable selected runtime target")


def launch_auto(root,c,only=None,fresh=False):
    """First successful launch pins the task target. No silent platform switch
    after baseline, no boot/install/reset of devices, no all-platform build."""
    pin = pinned_target(root)
    require(not pin or only in (None,pin[0]), "Required platform differs from pinned task target")
    digest = fingerprint(root)
    task_path = work(root)/"task.json"
    require(task_path.is_file(),"Run begin before launch auto")
    task = read_json(task_path)
    require(task.get("branch")==text(git(root,"branch","--show-current")) and task.get("revision")==c["revision"],
            "Runtime task receipt is stale; begin on the correct branch")
    if digest != task.get("baseline_digest"):
        require(current_check(root,digest),
                "Run the canonical check on the changed candidate before building runtime")
    unavailable = []
    for platform,target in ([pin] if pin else runtime_targets(root,c,only)):
        try:
            dimensions = probe_runtime(root,platform,target)
            previous = work(root)/"runtime.json"
            old = read_json(previous) if previous.is_file() else {}
            # A prior successful launch proves installed candidate, not current UI.
            # Reuse only on the pinned native device with a live screenshot probe.
            # --fresh deliberately reinstalls/relaunches if the app was stopped,
            # replaced, or another app is foregrounded.
            if (not fresh and pin and platform!="web" and old.get("digest")==digest
                    and old.get("platform")==platform and old.get("device")==target):
                event(root,"runtime-reused",platform=platform,digest=digest)
                result = {"status":"READY","platform":platform,"target":target,"digest":digest,
                          "reused":True,"note":"Prior launch reused; inspect actual foreground UI or use --fresh"}
            else:
                result = launch(root,c,platform,target,preprobed=True,emit=False)
        except (Blocked,OSError,ValueError,subprocess.TimeoutExpired) as exc:
            unavailable.append({"platform":platform,"device":target,"reason":str(exc)[:800]})
            event(root,"runtime-target-failed",platform=platform,error_type=type(exc).__name__)
            # A candidate mutation is not a platform failure.
            if isinstance(exc,Blocked) and "source changed" in str(exc).lower():
                raise
            continue
        save_preflight(root,[{"platform":platform,"device":target,"size":dimensions}],unavailable)
        atomic_json(work(root)/"runtime-selection.json",{"branch":text(git(root,"branch","--show-current")),
                    "platform":platform,"device":target})
        output(**result)
        return
    output(**save_preflight(root,[],unavailable))
    raise Blocked("Pinned runtime failed; preserve comparable evidence and diagnose it" if pin else
                  "No runtime target could launch; inspect retained logs")


def launch(root,c,platform,device,*,preprobed=False,emit=True):
    require(platform != "web" or c["profile"] == "mobile-web", "Web disabled")
    digest = fingerprint(root)
    receipt = work(root) / "runtime.json"
    previous = read_json(receipt) if receipt.exists() else {}
    receipt.unlink(missing_ok=True)
    event(root, "runtime-launch-start", platform=platform, digest=digest)
    if platform == "web":
        # Fail on missing Chromium before expensive Flutter Web compilation.
        if not preprobed:
            probe_runtime(root, platform)
        action = "status" if previous.get("digest") == digest and previous.get("platform") == "web" else "start"
        try:
            result = text(run(root, sys.executable, str(HERE / "web-preview.py"),
                              action, capture=True))
        except Blocked:
            if action != "status":
                raise
            result = text(run(root, sys.executable, str(HERE / "web-preview.py"),
                              "start", capture=True))
        match = re.search(r"READY Web URL: (http://127\.0\.0\.1:\d+/)", result)
        require(match, "Web preview missing readiness URL")
        device = match.group(1)
    else:
        require(device and not device.startswith("-"), "Explicit emulator/simulator ID required")
        with target_lock(platform, device):
            if not preprobed:
                probe_runtime(root, platform, device)
            folder = Path(tempfile.mkdtemp(prefix="launch-" + platform + "-", dir=work(root)))
            log = folder / "launch.log"
            event(root, "runtime-launch-log", platform=platform, log=str(log.relative_to(root)))
            run(root, "flutter", "run", "--no-resident", "-d", device, log=log, timeout=900)
    require(fingerprint(root) == digest, "Runtime source changed during launch")
    atomic_json(receipt, {"digest": digest, "platform": platform, "device": device})
    event(root, "runtime-ready", platform=platform, digest=digest)
    result = {"status":"READY","platform":platform,"target":device,"digest":digest}
    if emit:
        output(**result)
    return result


def capture(root,platform,label,theme,viewport,settle=1.5,scenario=None,*,fixture=None):
    require(re.fullmatch(r"[a-zA-Z0-9_-]+", label), "Invalid capture label")
    require(0.5 <= settle <= 5, "Settle must be between 0.5 and 5 seconds")
    current = read_json(work(root) / "runtime.json")
    digest = fingerprint(root)
    require(current.get("digest") == digest and current.get("platform") == platform,
            "Launch this candidate/platform before capture")
    device = current["device"]
    directory = root / ".flutter-harness/previews" / digest
    directory.mkdir(parents=True, exist_ok=True)
    image = directory / (label + "-" + platform + "-" + theme + ".png")
    scenario_hash = None
    if scenario:
        path = Path(scenario)
        require(not path.is_absolute() and ".." not in path.parts and
                (root / path).is_file() and not (root / path).is_symlink(),
                "Capture scenario must be a project-local file")
        scenario_hash=hashlib.sha256((root/path).read_bytes()).hexdigest()
    with target_lock(platform, device):
        image.with_suffix(".json").unlink(missing_ok=True)
        image.unlink(missing_ok=True)
        if platform == "android":
            run(root, "adb", "-s", device, "shell", "cmd", "uimode", "night",
                "yes" if theme == "dark" else "no")
        elif platform == "ios":
            run(root, "xcrun", "simctl", "ui", device, "appearance", theme)
        if platform in ("android", "ios"):
            time.sleep(settle)
            if scenario:
                log = Path(tempfile.mkdtemp(prefix="capture-", dir=work(root))) / "scenario.log"
                run(root, "bash", str(HERE / "maestro.sh"), "--device", device, "test",
                    scenario, log=log, timeout=180)
                time.sleep(settle)
            if platform == "android":
                image.write_bytes(run(root, "adb", "-s", device, "exec-out", "screencap",
                                      "-p", capture=True))
            else:
                run(root, "xcrun", "simctl", "io", device, "screenshot", str(image))
        else:
            require(re.fullmatch(r"\d+,\d+", viewport), "Viewport must be width,height")
            if scenario:
                env = dict(os.environ, HARNESS_WEB_URL=device, HARNESS_CAPTURE_PATH=str(image),
                           HARNESS_CAPTURE_THEME=theme, HARNESS_CAPTURE_VIEWPORT=viewport,
                           HARNESS_CAPTURE_SETTLE_MS=str(int(settle * 1000)))
                log = Path(tempfile.mkdtemp(prefix="capture-", dir=work(root))) / "scenario.log"
                run(root, "npx", "--no-install", "playwright", "test", scenario,
                    log=log, env=env, timeout=180)
            else:
                run(root, "npx", "--no-install", "playwright", "screenshot",
                    "--viewport-size=" + viewport, "--color-scheme=" + theme,
                    "--wait-for-timeout=" + str(int(settle * 1000)), device, str(image))
        data = image.read_bytes()
        size = png_size(data)
        require(fingerprint(root) == digest, "Stale capture")
        require(not scenario or hashlib.sha256((root/scenario).read_bytes()).hexdigest()==scenario_hash,"Capture scenario changed during execution")
        require(read_json(work(root) / "runtime.json") == current, "Runtime target changed during capture")
        atomic_json(image.with_suffix(".json"), {"digest": digest, "label": label, "platform": platform,
                    "target": device, "theme": theme, "viewport": viewport if platform == "web" else None,
                    "size": size, "scenario": scenario, "scenario_sha256":scenario_hash, "fixture":fixture, "sha256": hashlib.sha256(data).hexdigest(),
                    "path": str(image)})
    event(root, "visual-captured", platform=platform, label=label, theme=theme, digest=digest)
    output(status="CAPTURED", path=str(image), digest=digest)


def capture_plan(root,c,refresh=()):
    """Execute an explicit, project-specific scripted plan, serially.
    No guessed taps, no destructive fixture creation, no model calls."""
    plan = read_json(work(root)/"visual-plan.json")
    platform = plan.get("platform")
    pin = pinned_target(root)
    require(pin and pin[0]==platform,"Plan must use the pinned runtime")
    items = plan.get("scenarios")
    require(isinstance(items,list) and 0<len(items)<=12,"Invalid visual scenarios")
    labels = set()
    for item in items:
        require(isinstance(item,dict) and isinstance(item.get("label"),str)
                and re.fullmatch(r"[a-zA-Z0-9_-]+",item["label"]) and item["label"] not in labels
                and item.get("kind") in ("screen","interaction"),"Invalid or duplicate visual scenario")
        labels.add(item["label"])
        scenario = item.get("scenario")
        require(isinstance(scenario,str) and scenario,"Each batch state needs a project-local scripted scenario")
        path = Path(scenario)
        require(not path.is_absolute() and ".." not in path.parts and (root/path).is_file()
                and not (root/path).is_symlink(),"Invalid batch scenario")
        require(platform!="web" or isinstance(item.get("viewport"),str) and re.fullmatch(r"\d+,\d+",item["viewport"]),
                "Web batch scenario needs viewport")
    digest = fingerprint(root)
    require(current_check(root,digest),"Check exact candidate before capture-plan")
    runtime = read_json(work(root)/"runtime.json")
    require(runtime.get("digest")==digest and runtime.get("platform")==platform,
            "Run launch auto for checked candidate before capture-plan")
    require(set(refresh)<=labels,"Unknown capture label in --refresh")
    for item in items:
        for theme in ("light","dark"):
            image=root/".flutter-harness/previews"/digest/(item["label"]+"-"+platform+"-"+theme+".png")
            expected={"digest":digest,"label":item["label"],"platform":platform,"theme":theme,"target":runtime["device"],
                      "viewport":item.get("viewport") if platform=="web" else None,"scenario":item["scenario"],
                      "fixture":plan.get("fixture"),"scenario_sha256":hashlib.sha256((root/item["scenario"]).read_bytes()).hexdigest()}
            if item["label"] not in refresh and reusable_capture(image,expected):
                event(root,"visual-reused",platform=platform,label=item["label"],theme=theme,digest=digest)
                continue
            capture(root,platform,item["label"],theme,item.get("viewport") or "390,844",
                    scenario=item["scenario"],fixture=plan.get("fixture"))
    visual_evidence(root,any(x["kind"]=="interaction" for x in items))


def reusable_capture(image,expected):
    try:
        data=image.read_bytes()
        meta=read_json(image.with_suffix(".json"))
        return all(meta.get(k)==v for k,v in expected.items()) and meta.get("size")==png_size(data) and meta.get("sha256")==hashlib.sha256(data).hexdigest()
    except (OSError,ValueError,KeyError,Blocked):
        return False


def visual_evidence(root, require_interaction=False, *, emit=True):
    """Validate receipt coverage, not aesthetic quality or truthful UI content."""
    digest = fingerprint(root)
    plan_path = work(root) / "visual-plan.json"
    require(plan_path.is_file(), "Missing visual-plan.json: declare populated screens and changed interaction states")
    plan = read_json(plan_path)
    platform = plan.get("platform")
    pin = pinned_target(root)
    require(not pin or platform==pin[0], "Visual plan differs from pinned runtime platform")
    require(platform in ("android", "ios", "web"), "Visual plan needs one representative platform")
    require(isinstance(plan.get("fixture"), str) and plan["fixture"].strip(), "Describe representative isolated fixture data")
    baseline = plan.get("baseline")
    require(baseline is None or isinstance(baseline, dict), "Optional baseline must be an object")
    preflight_path = work(root) / "visual-preflight.json"
    require(preflight_path.is_file(), "Run launch auto (or doctor visual) before runtime work")
    preflight = read_json(preflight_path)
    require(preflight.get("status") == "PASS" and preflight.get("branch") == text(git(root,"branch","--show-current")),
            "Visual preflight missing or from another task branch")
    require(any(x.get("platform") == platform for x in preflight.get("ready", [])), "Planned platform did not pass runtime preflight")
    scenarios = plan.get("scenarios")
    require(isinstance(scenarios, list) and scenarios and len(scenarios) <= 12,
            "Visual plan needs 1–12 relevant named scenarios")
    labels = set()
    for item in scenarios:
        require(isinstance(item, dict) and isinstance(item.get("label"), str) and
                re.fullmatch(r"[a-zA-Z0-9_-]+", item["label"]) and item["label"] not in labels and
                item.get("kind") in ("screen", "interaction"), "Invalid or duplicate visual scenario")
        labels.add(item["label"])
        if platform == "web":
            require(isinstance(item.get("viewport"), str) and re.fullmatch(r"\d+,\d+", item["viewport"]),
                    "Each Web scenario needs its actual viewport")
        else:
            require(item.get("viewport") is None, "Native capture dimensions are read from the image")
    require(any(s["kind"] == "screen" for s in scenarios), "Missing populated screen scenario")
    require(not require_interaction or any(s["kind"] == "interaction" for s in scenarios),
            "Substantial UI change requires a changed interaction scenario")
    folder = root / ".flutter-harness/previews" / digest
    captures = []
    targets = set()
    for item in scenarios:
        pair = []
        for theme in ("light", "dark"):
            path = folder / (item["label"] + "-" + platform + "-" + theme + ".png")
            metadata = path.with_suffix(".json")
            require(path.is_file() and metadata.is_file(),
                    f"Missing capture receipt: {item['label']} / {platform} / {theme}")
            receipt = read_json(metadata)
            data = path.read_bytes()
            size = png_size(data)
            require(all(receipt.get(k) == v for k,v in {
                "digest":digest, "label":item["label"], "platform":platform, "theme":theme,
                "size":size, "viewport":item.get("viewport"),
                "sha256":hashlib.sha256(data).hexdigest(),
            }.items()) and isinstance(receipt.get("target"), str) and receipt["target"],
                    f"Stale or invalid capture: {path.name}")
            require("scenario" not in item or receipt.get("scenario")==item["scenario"],
                    "Capture scenario differs from planned state: "+path.name)
            if item.get("scenario"):
                scenario=Path(item["scenario"])
                require(not scenario.is_absolute() and ".." not in scenario.parts and (root/scenario).is_file() and not (root/scenario).is_symlink(),"Invalid visual scenario")
                require(receipt.get("scenario_sha256")==hashlib.sha256((root/scenario).read_bytes()).hexdigest(),"Capture scenario content changed: "+path.name)
            require(platform != "web" or item["kind"] != "interaction" or receipt.get("scenario"),
                    "Web interaction capture needs a Playwright scenario; a fresh-page screenshot is insufficient")
            targets.add(receipt["target"])
            pair.append({**receipt, "path": str(path)})
        require(pair[0]["size"] == pair[1]["size"] and pair[0]["sha256"] != pair[1]["sha256"],
                f"Theme pair must have equal dimensions and distinct image content: {item['label']}")
        captures.extend(pair)
    require(len(targets) == 1, "All planned evidence must use the same runtime target")
    target = next(iter(targets))
    require(not pin or platform=="web" or target==pin[1], "Capture target differs from pinned runtime device")
    require(platform == "web" or any(x.get("platform") == platform and x.get("device") == target for x in preflight["ready"]),
            "Native capture target did not pass preflight")
    baseline_receipt = None
    if baseline is None:
        pass
    elif "unavailable" in baseline:
        require(isinstance(baseline["unavailable"], str) and baseline["unavailable"].strip(), "Explain the actual baseline blocker")
    else:
        before = baseline.get("digest")
        label = baseline.get("label")
        require(isinstance(before,str) and re.fullmatch(r"[0-9a-f]{64}",before) and before != digest and
                isinstance(label,str) and re.fullmatch(r"[a-zA-Z0-9_-]+",label), "Invalid baseline candidate/label")
        task = read_json(work(root)/"task.json")
        require(task.get("branch")==preflight.get("branch") and task.get("baseline_digest")==before,
                "Baseline must match the original candidate of this task; do not use another task\'s screenshot")
        image = root / ".flutter-harness/previews" / before / (label+"-"+platform+"-light.png")
        require(image.is_file() and image.with_suffix(".json").is_file(), "Missing comparable baseline capture receipt")
        meta = read_json(image.with_suffix(".json"))
        data = image.read_bytes()
        first = next(x for x in captures if x["label"] == next(s["label"] for s in scenarios if s["kind"]=="screen") and x["theme"]=="light")
        require(all(meta.get(k)==v for k,v in {"digest":before,"label":label,"platform":platform,"theme":"light",
                "sha256":hashlib.sha256(data).hexdigest(),"size":png_size(data),"viewport":first.get("viewport")}.items()) and
                png_size(data)==first["size"] and (platform=="web" or meta.get("target")==target),
                "Baseline capture is stale or not comparable to final screen")
        baseline_receipt = {**meta,"path":str(image)}
    require(fingerprint(root) == digest, "Candidate changed while verifying images")
    # Bind review to the exact declared plan and validated image contents.
    evidence_digest = manifest_digest({"plan": plan, "baseline_sha256": (baseline_receipt or {}).get("sha256"), "captures": [
        {k:v for k,v in item.items() if k != "path"} for item in captures]})
    result = {"status":"PASS", "digest":digest, "evidence_digest":evidence_digest,
              "captures":captures, "plan":plan, "baseline":baseline_receipt}
    if emit:
        output(**result)
    return result


def e2e(root,platform,scenario,device):
    path = Path(scenario)
    require(not path.is_absolute() and ".." not in path.parts and
            (root / path).is_file() and not (root / path).is_symlink(),
            "Expected a project-local scenario file")
    digest = fingerprint(root)
    runtime = read_json(work(root) / "runtime.json")
    require(runtime.get("digest") == digest and runtime.get("platform") == platform,
            "Launch the current candidate before E2E")
    environment = dict(os.environ)
    if platform == "web":
        environment["HARNESS_WEB_URL"] = runtime["device"]
        require(path.parts[0] in ("e2e", "playwright", "tests"), "Use a committed Playwright scenario")
        args = ("npx", "--no-install", "playwright", "test", scenario)
    else:
        require(device and not device.startswith("-") and path.parts[0] == "maestro",
                "Maestro scenario and explicit device required")
        require(device == runtime["device"], "E2E device differs from launched target")
        args = ("bash", str(HERE / "maestro.sh"), "--device", device, "test", scenario)
    log = work(root) / ("e2e-" + platform + ".log")
    receipt = log.with_suffix(".json")
    receipt.unlink(missing_ok=True)
    run(root, *args, log=log, timeout=600, env=environment)
    require(fingerprint(root) == digest, "E2E candidate changed")
    atomic_json(receipt, {"status": "PASS", "digest": digest, "scenario": scenario,
                          "platform": platform, "device": device, "log": str(log)})
    output(status="PASS", receipt=str(receipt))


def usage(root, sessions, *, emit=True):
    with tempfile.TemporaryDirectory() as tmp:
        exports = []
        for i, session in enumerate(sessions):
            path = Path(tmp) / f"{i}.json"
            path.write_bytes(run(root, "opencode", "session", "export", session,
                                 "--sanitize", capture=True, timeout=120))
            exports.append(str(path))
        summary = json.loads(run(root, sys.executable, str(HERE / "session-usage.py"), "--json", *exports, capture=True))
        if emit:
            print(json.dumps(summary, indent=2))
        return summary


def diagnostics(root, sessions, *, local_only=False):
    """Always retain local evidence; usage export is best effort."""
    directory = work(root)
    errors = []
    data = {"harness":None,"usage":None,"usage_scope":"session-cumulative","artifacts":{}}
    try:
        data["harness"]=installed_revision(root,config(root))
    except (OSError,ValueError,KeyError,Blocked,subprocess.TimeoutExpired) as exc:
        data["harness"]={"status":"BLOCKED","error_type":type(exc).__name__}
        errors.append("Harness revision unavailable or inconsistent")
    events = []
    path=directory/"lifecycle.jsonl"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                item=json.loads(line)
                if isinstance(item,dict):
                    events.append(item)
            except ValueError:
                errors.append("Unreadable lifecycle entry skipped")
    # Most recent task boundary if no explicit session or durable session list.
    if not sessions:
        start=next((i for i in range(len(events)-1,-1,-1) if events[i].get("stage")=="task-start"),None)
        if start is not None:
            events=events[start:]
            sessions=list(dict.fromkeys(x.get("session") for x in events if isinstance(x.get("session"),str)))
        else:
            events=events[-100:]
    else:
        start=next((i for i in range(len(events)-1,-1,-1) if events[i].get("stage")=="task-start" and events[i].get("session") in sessions),None)
        if start is not None:
            end=next((i for i in range(start+1,len(events)) if events[i].get("stage")=="task-start"),len(events))
            events=events[start:end]
        else:
            events=events[-100:]
    for name in ("check.json","check-attempt.json","delivery-state.json","delivery-result.json","sessions.json",
                 "runtime.json","runtime-selection.json","task.json","visual-preflight.json"):
        candidate=directory/name
        if candidate.is_file():
            try:
                data["artifacts"][name]=read_json(candidate)
            except (OSError,ValueError,Blocked):
                errors.append("Unreadable artifact: "+name)
    # Report actual lock status, not a stale PID after a killed process.
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/"check.lock").open("a") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            data["check_running"]=False
        except BlockingIOError:
            data["check_running"]=True
    data["events"]=events
    reports=[]
    for item in events:
        if item.get("stage")!="check-run":
            continue
        run_dir=(root/item.get("artifacts","")).resolve()
        if directory.resolve() not in run_dir.parents:
            continue
        for path in run_dir.glob("check-*.tsv"):
            try:
                with path.open(encoding="utf-8") as stream:
                    reports.append({"report":str(path.relative_to(root)),"checks":list(csv.DictReader(stream,delimiter="\t"))})
            except OSError:
                errors.append("Unreadable standard report")
    data["standard_runs"]=reports
    data["errors"]=errors
    target=directory/"diagnostics.json"
    # Persist immediately, even if the session exporter subsequently hangs.
    data["usage_status"]="NOT_REQUESTED" if local_only else "PENDING" if sessions else "UNAVAILABLE"
    atomic_json(target,data)
    if sessions and not local_only:
        try:
            data["usage"]=usage(root,sessions,emit=False)
            data["usage_status"]="PASS"
        except (OSError,ValueError,KeyError,Blocked,subprocess.TimeoutExpired) as exc:
            data["usage_status"]="UNAVAILABLE"
            errors.append("Sanitized OpenCode export unavailable: "+type(exc).__name__)
    atomic_json(target,data)
    output(status="PASS",report=str(target),usage_status=data["usage_status"])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=".", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("doctor")
    p.add_argument("operation", choices=("check","deliver","android","ios","web","e2e","visual"))
    p.add_argument("--only", choices=("ios","android","web"))
    p = sub.add_parser("revision")
    p.add_argument("--expect")
    p = sub.add_parser("begin")
    p.add_argument("branch")
    p = sub.add_parser("lesson", help="Record a confirmed reusable Harness failure, never app details")
    p.add_argument("code", choices=sorted(reporter.SEMANTIC_CODES))
    for cmd in ("check","ci","deliver","verify","completion","status","fingerprint","stop-preview","adopt"):
        sub.add_parser(cmd)
    p = sub.add_parser("capture-plan")
    p.add_argument("--refresh",action="append",default=[],help="Recapture both themes of an explicitly changed UI state")
    sub.add_parser("validate-delivery")
    p = sub.add_parser("prepare-delivery")
    p.add_argument("--message", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--body", required=True)
    p.add_argument("--review", action="store_true")
    p.add_argument("--visual", action="store_true")
    p.add_argument("--interaction", action="store_true")
    p.add_argument("--e2e", action="append", choices=("android","ios","web"), default=[])
    p = sub.add_parser("visual-evidence")
    p.add_argument("--require-interaction", action="store_true")
    p = sub.add_parser("scaffold")
    p.add_argument("name")
    p.add_argument("layers", nargs="+", choices=("models","repositories","services","view_models","screens","widgets","use_cases"))
    p = sub.add_parser("launch")
    p.add_argument("platform", choices=("auto","android","ios","web"))
    p.add_argument("--device")
    p.add_argument("--only", choices=("ios","android","web"))
    p.add_argument("--fresh", action="store_true")
    p = sub.add_parser("capture")
    p.add_argument("platform", choices=("android","ios","web"))
    p.add_argument("label")
    p.add_argument("theme", choices=("light","dark"))
    p.add_argument("--viewport", default="390,844")
    p.add_argument("--settle", type=float, default=1.5)
    p.add_argument("--scenario")
    p = sub.add_parser("e2e")
    p.add_argument("platform", choices=("android","ios","web"))
    p.add_argument("scenario")
    p.add_argument("--device")
    for cmd in ("usage", "diagnostics"):
        p = sub.add_parser(cmd)
        p.add_argument("sessions", nargs="*")
        if cmd=="diagnostics":
            p.add_argument("--local",action="store_true",help="Write local evidence without waiting for OpenCode export")
    a = parser.parse_args()
    root = a.project.resolve()
    try:
        require((root / "pubspec.yaml").is_file(), "Expected Flutter project")
        if a.command == "fingerprint":
            print(fingerprint(root))
            return 0
        if a.command=="diagnostics":
            sessions=a.sessions
            if not sessions:
                try:
                    sessions=read_json(work(root)/"sessions.json").get("sessions",[])
                except (OSError,ValueError,Blocked):
                    sessions=[]
            diagnostics(root,sessions,local_only=a.local)
            return 0
        c = config(root)
        if a.command == "revision":
            output(**installed_revision(root,c,a.expect))
            return 0
        if a.command in ("begin","check","ci","deliver","verify","completion","launch","capture","capture-plan","prepare-delivery","validate-delivery","visual-evidence","e2e"):
            installed_revision(root,c)
        if a.command == "doctor":
            doctor(root, c, a.operation, a.only)
        elif a.command == "begin":
            reporter.retry(root)
            begin(root, c, a.branch)
        elif a.command == "lesson":
            installed_revision(root,c)
            output(status=reporter.report(root,c.get("revision"),a.code))
        elif a.command == "check":
            check(root, c)
        elif a.command == "ci":
            run(root, sys.executable, str(HERE / "validate-opencode.py"), "opencode.jsonc", c["profile"])
            require((root / ".flutter-harness/product.json").is_file(), "Missing product policy configuration")
            run(root, "flutter", "pub", "get", log=work(root)/"pub-get.log")
            run(root, "bash", str(HERE/"check.sh"), ".", "standard", c["profile"])
            require(not git(root,"diff","--name-only","HEAD","--","pubspec.lock"), "Dependency lock changed in CI")
        elif a.command == "deliver":
            deliver(root, c)
        elif a.command == "verify":
            verify(root, c)
        elif a.command == "completion":
            output(**completion(root, c))
        elif a.command == "status":
            receipt = work(root) / "check.json"
            digest = fingerprint(root)
            output(branch=text(git(root,"branch","--show-current")),
                   base=c["integration_branch"], revision=c.get("revision"), changed=dirty(root), digest=digest,
                   checked=current_check(root,digest))
        elif a.command == "scaffold":
            scaffold(root, a.name, a.layers)
        elif a.command == "adopt":
            run(root, sys.executable, str(HERE / "init-product.py"), ".")
        elif a.command == "launch":
            if a.platform == "auto":
                require(a.device is None,"Use HARNESS_IOS_DEVICE/HARNESS_ANDROID_DEVICE for preference")
                launch_auto(root,c,a.only,a.fresh)
            else:
                require(a.only is None and not a.fresh,"--only and --fresh are for launch auto")
                launch(root,c,a.platform,a.device)
        elif a.command == "prepare-delivery":
            prepare_delivery(root,c,a)
        elif a.command == "validate-delivery":
            delivery_manifest(root,c)
            output(status="PASS")
        elif a.command == "capture-plan":
            capture_plan(root,c,a.refresh)
        elif a.command == "capture":
            capture(root, a.platform, a.label, a.theme, a.viewport, a.settle, a.scenario)
        elif a.command == "visual-evidence":
            visual_evidence(root, a.require_interaction)
        elif a.command == "stop-preview":
            run(root, sys.executable, str(HERE / "web-preview.py"), "stop")
        elif a.command == "e2e":
            e2e(root, a.platform, a.scenario, a.device)
        elif a.command == "usage":
            sessions = a.sessions or read_json(work(root)/"sessions.json")["sessions"]
            require(sessions, "No recorded sessions")
            usage(root, sessions)
        return 0
    except (Blocked, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        if a.command in ("begin", "check", "deliver", "doctor", "launch", "capture", "capture-plan", "prepare-delivery", "validate-delivery", "visual-evidence", "e2e"):
            try:
                # Keep compact shareable error classifications; full command logs
                # remain local. No arbitrary stderr, prompts or environment values.
                event(root, a.command + "-blocked", error_type=type(exc).__name__,
                      reason=str(exc)[:240] if isinstance(exc, Blocked) and "\n" not in str(exc) and "exit=" not in str(exc) else "See local command log/terminal")
            except OSError:
                pass
        if a.command == "deliver" and isinstance(exc, DeliveryBlocked):
            reporter.report(root, locals().get("c", {}).get("revision"), exc.code, automatic=True, stage=exc.stage)
        if a.command == "completion" and isinstance(exc, DeliveryBlocked):
            output(status="BLOCKED", stage=exc.stage, error=exc.details())
        if a.command == "deliver" and isinstance(exc, DeliveryBlocked) and isinstance(exc.__cause__, Blocked):
            # Original command output stays in the local terminal, not shareable lifecycle evidence.
            print("Local command: " + str(exc.__cause__), file=sys.stderr)
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
