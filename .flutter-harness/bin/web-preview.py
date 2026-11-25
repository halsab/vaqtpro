#!/usr/bin/env python3
"""Local Flutter Web preview for Playwright, avoiding Chrome debug-service handshake.

Run from project root: python3 .flutter-harness/bin/web-preview.py start|status|stop
READY means only HTTP service readiness; it does NOT prove browser E2E.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def paths(project):
    name = project.name + "-" + hashlib.sha256(str(project).encode()).hexdigest()[:10]
    directory = Path.home() / ".cache" / "flutter-harness" / name
    return directory / "web-preview.json", directory / "web-preview.log"


def state_at(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def ready(state):
    if not isinstance(state, dict):
        return False
    try:
        with urlopen(f"http://127.0.0.1:{int(state['port'])}/__harness_health", timeout=1.5) as response:
            return response.read().decode() == state["token"]
    except (KeyError, ValueError, OSError, URLError):
        return False


def stop(path):
    state = state_at(path)
    if not state:
        print("No managed Web preview")
        return 0
    if not ready(state):
        path.unlink(missing_ok=True)
        print("Discarded stale server metadata; no process terminated")
        return 0
    try:
        os.kill(int(state["pid"]), signal.SIGTERM)
    except ProcessLookupError:
        pass
    for _ in range(30):
        if not ready(state):
            break
        time.sleep(0.1)
    if ready(state):
        print("BLOCKED: managed server did not stop")
        return 3
    path.unlink(missing_ok=True)
    print("Stopped managed Web preview")
    return 0


def serve(project, state_file, token):
    directory = project / "build" / "web"

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def do_GET(self):
            if self.path == "/__harness_health":
                data = token.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return super().do_GET()

    class Server(http.server.ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

    with Server(("127.0.0.1", 0), Handler) as server:
        state = {"port": server.server_port, "pid": os.getpid(), "token": token}
        state_file.write_text(json.dumps(state), encoding="utf-8")
        server.serve_forever(poll_interval=0.1)


def start(project, state_file, log_file):
    old = state_at(state_file)
    if old:
        if ready(old):
            code = stop(state_file)
            if code:
                return code
        else:
            state_file.unlink(missing_ok=True)
            print("Discarded stale server metadata; no process terminated")
    log_file = log_file.with_name("web-preview-" + str(time.time_ns()) + ".log")
    log_file.parent.mkdir(parents=True, exist_ok=True)
    print("Building Flutter Web for Playwright without Chrome debugger...", flush=True)
    with log_file.open("w", encoding="utf-8") as log:
        try:
            result = subprocess.run(
                ["flutter", "build", "web", "--no-web-resources-cdn"],
                cwd=project, stdout=log, stderr=subprocess.STDOUT,
                timeout=360, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            print(f"BLOCKED: Web build failed to run: {exc}; log: {log_file}")
            return 3
    if result.returncode:
        print(f"FAIL: Flutter Web build exit={result.returncode}; log: {log_file}")
        return 1
    if not (project / "build" / "web" / "index.html").is_file():
        print("FAIL: Flutter build returned success but build/web/index.html is missing")
        return 1
    token = secrets.token_urlsafe(24)
    with log_file.open("a", encoding="utf-8") as log:
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "_serve",
             str(project), str(state_file), token],
            cwd=project, stdin=subprocess.DEVNULL, stdout=log,
            stderr=subprocess.STDOUT, start_new_session=True,
        )
    for _ in range(60):
        current = state_at(state_file)
        if current and current.get("pid") == proc.pid and ready(current):
            print(f"READY Web URL: http://127.0.0.1:{current['port']}/")
            print(f"Web server/build log: {log_file}")
            print("NEXT: Playwright must assert UI behavior; HTTP READY is not E2E PASS")
            return 0
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    if proc.poll() is None:
        proc.terminate()
    print(f"BLOCKED: Web preview failed readiness; log: {log_file}")
    return 3


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "status", "stop", "_serve"))
    parser.add_argument("extra", nargs="*")
    args = parser.parse_args(argv)
    if args.action == "_serve":
        if len(args.extra) != 3:
            parser.error("_serve requires project, state path, token")
        serve(Path(args.extra[0]), Path(args.extra[1]), args.extra[2])
        return 0
    if args.extra:
        parser.error("Unexpected arguments")
    project = Path.cwd().resolve()
    if not (project / "pubspec.yaml").is_file():
        parser.error("Run from the Flutter project root")
    state_file, log_file = paths(project)
    if args.action == "start":
        return start(project, state_file, log_file)
    if args.action == "stop":
        return stop(state_file)
    state = state_at(state_file)
    if ready(state):
        print(f"READY Web URL: http://127.0.0.1:{state['port']}/")
        return 0
    print("BLOCKED: no managed Web preview is running")
    return 3


if __name__ == "__main__":
    sys.exit(main())
