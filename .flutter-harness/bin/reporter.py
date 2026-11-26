"""Best-effort, allowlisted Harness reports. No app text, paths or logs leave the machine."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORY = "halsab/flutter-harness"
OWNER = "halsab"
AUTO_CODES = frozenset({"REPO_RESPONSE", "PR_RESPONSE", "PR_IDENTITY_MISMATCH", "PR_URL_MISMATCH"})
SEMANTIC_CODES = frozenset({
    "RISK_CLASSIFICATION", "REVIEW_EVIDENCE", "BUILD_SCOPE", "RUNTIME_EVIDENCE",
    "DELIVERY_RECONCILIATION", "INSTALLER_INVARIANT",
})
CODES = AUTO_CODES | SEMANTIC_CODES
STAGES = frozenset({"unspecified", "delivery-started", "delivery-resolving", "delivery-resolved",
                    "delivery-validated", "delivery-committed", "delivery-pushed",
                    "delivery-remote-verified", "delivery-complete"})
FIELDS = {"schema", "revision", "code", "stage"}
MAX_QUEUE = 32
TIMEOUT = 8


def enabled():
    return not os.environ.get("CI") and os.environ.get("HARNESS_REPORTS", "on").lower() != "off"


def payload(revision, code, stage="unspecified"):
    if type(revision) is not str or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid Harness revision")
    if type(code) is not str or code not in CODES:
        raise ValueError("Unknown lesson code")
    if type(stage) is not str or stage not in STAGES:
        raise ValueError("Unknown report stage")
    return {"schema": 1, "revision": revision, "code": code, "stage": stage}


def validate(value):
    if type(value) is not dict or set(value) != FIELDS or type(value["schema"]) is not int or value["schema"] != 1:
        raise ValueError("Invalid report schema")
    return payload(value["revision"], value["code"], value["stage"])


def canonical(value):
    return json.dumps(validate(value), sort_keys=True, separators=(",", ":"))


def key(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def title(value):
    data = validate(value)
    return "Harness report: " + data["code"] + " [" + key(data) + "]"


def body(value):
    return canonical(value)


def queue_dir(root):
    return Path(root) / ".flutter-harness/work/lessons"


def save(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        tmp = Path(stream.name)
        stream.write(canonical(value) + "\n")
    try:
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def api(*args):
    result = subprocess.run(["gh", "api", "--hostname", "github.com", *args],
                            capture_output=True, text=True, timeout=TIMEOUT, check=True,
                            env={**os.environ, "GH_PROMPT_DISABLED": "1"})
    return json.loads(result.stdout)


def send(value):
    """Only the owner account may submit automated reports to the public repository."""
    if api("user").get("login", "").lower() != OWNER:
        return False
    endpoint = "repos/" + REPOSITORY + "/issues"
    # Direct listing avoids search-index delay; exact code+revision dedup includes closed issues.
    pages = api(endpoint, "--method", "GET", "-f", "state=all", "-f", "creator=" + OWNER,
                "-f", "per_page=100", "--paginate", "--slurp")
    for page in pages:
        for issue in page:
            if (not issue.get("pull_request") and issue.get("title") == title(value)
                    and issue.get("body") == body(value)
                    and issue.get("user", {}).get("login", "").lower() == OWNER):
                return True
    issue = api(endpoint, "--method", "POST", "-f", "title=" + title(value), "-f", "body=" + body(value))
    return type(issue.get("number")) is int and issue["number"] > 0


def _process(root, value=None):
    if not enabled():
        return "DISABLED"
    directory = queue_dir(root)
    if value is None and not directory.is_dir():
        return "EMPTY"
    saved = False
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / "queue.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return "BUSY"
            if value is not None:
                path = directory / (key(value) + ".json")
                sent = directory / (key(value) + ".sent")
                if sent.is_file():
                    return "ALREADY_REPORTED"
                if not path.exists():
                    if len(list(directory.glob("*.json"))) >= MAX_QUEUE:
                        return "QUEUE_FULL"
                    save(path, value)
            else:
                path = next(iter(sorted(directory.glob("*.json"))), None)
                if path is None:
                    return "EMPTY"
            saved = True
            queued = validate(json.loads(path.read_text()))
            if path.name != key(queued) + ".json":
                return "INVALID_QUEUE"
            if send(queued):
                # Receipt before deleting queue; retry after a crash is safe via remote dedup.
                path.with_suffix(".sent").touch()
                path.unlink(missing_ok=True)
                return "REPORTED"
            return "QUEUED"
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        return "QUEUED" if saved else "UNAVAILABLE"


def report(root, revision, code, automatic=False, stage=None):
    if type(code) is not str or code not in (AUTO_CODES if automatic else SEMANTIC_CODES):
        return "IGNORED"
    try:
        return _process(root, payload(revision, code, stage if type(stage) is str and stage in STAGES else "unspecified"))
    except ValueError:
        return "IGNORED"


def retry(root):
    # One pending item per begin, never an indefinite loop or a delivery requirement.
    return _process(root)
