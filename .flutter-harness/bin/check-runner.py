#!/usr/bin/env python3
"""Bounded, fail-fast native verification. No model or external service calls."""
import argparse
import csv
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def stop_group(process):
    # Only our own process group. Also stop Flutter worker descendants on failure.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def execute(project, command, timeout, log):
    with log.open("ab") as stream:
        stream.write(("\nRUN " + " ".join(command) + "\n").encode())
        stream.flush()
        try:
            process = subprocess.Popen(command, cwd=project, stdout=stream,
                                       stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as exc:
            stream.write((str(exc)+"\n").encode())
            return "FAIL", 127
        try:
            code = process.wait(timeout=timeout)
            if code:
                stop_group(process)
            return ("PASS", 0) if code == 0 else ("FAIL", code)
        except subprocess.TimeoutExpired:
            stop_group(process)
            stream.write((f"TIMEOUT after {timeout}s\n").encode())
            return "TIMEOUT", 124
        except (KeyboardInterrupt, InterruptedError):
            stop_group(process)
            stream.write(b"INTERRUPTED\n")
            return "INTERRUPTED", 130


def tail(log, limit=8192):
    with log.open("rb") as stream:
        stream.seek(max(0, log.stat().st_size-limit))
        return "\n".join(stream.read().decode(errors="replace").replace("\r","\n").splitlines()[-45:])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("project",type=Path)
    p.add_argument("level",nargs="?",choices=("quick","standard","full"),default="standard")
    p.add_argument("profile",choices=("mobile","mobile-web"))
    a = p.parse_args()
    project = a.project.resolve()
    if not (project/"pubspec.yaml").is_file():
        p.error("Expected Flutter project")
    if not all(shutil.which(name) for name in ("flutter","dart")):
        print("BLOCKED: Flutter/Dart missing from PATH",file=sys.stderr)
        return 3
    try:
        suite_timeout = int(os.environ.get("HARNESS_TEST_SUITE_TIMEOUT","180"))
        if not 1<=suite_timeout<=1800:
            raise ValueError
    except ValueError:
        p.error("HARNESS_TEST_SUITE_TIMEOUT must be 1–1800 seconds")
    key = hashlib.sha256(str(project).encode()).hexdigest()[:12]
    folder = Path(os.environ.get("HARNESS_ARTIFACTS_DIR",str(Path.home()/".cache/flutter-harness"/(project.name+"-"+key))))
    folder.mkdir(parents=True,exist_ok=True)
    ident = time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+str(os.getpid())
    log = folder/("check-"+ident+".log")
    report = folder/("check-"+ident+".tsv")
    steps = [("format",["dart","format","--output=none","--set-exit-if-changed","lib","test"],60)]
    if (project/".flutter-harness/product.json").is_file():
        steps.append(("product",[sys.executable,".flutter-harness/bin/check-product.py","."],60))
    steps.append(("analyze",["flutter","analyze"],120))
    if a.level!="quick":
        steps.append(("flutter-tests",["flutter","test","--fail-fast","--timeout","45s","--reporter","expanded"],suite_timeout))
    if a.level=="full":
        steps.append(("android-build",["flutter","build","apk","--debug"],600))
        # Keep the existing testable platform contract.
        if subprocess.check_output(["uname","-s"],text=True).strip()=="Darwin":
            steps.append(("ios-simulator-build",["flutter","build","ios","--simulator","--no-codesign"],600))
        else:
            steps.append(("ios-simulator-build",None,0))
        if a.profile=="mobile-web":
            steps.append(("web-build",["flutter","build","web"],600))
    print(f"Profile: {a.profile}; level: {a.level}",flush=True)
    def interrupted(signum,frame):
        raise InterruptedError(f"signal {signum}")
    signal.signal(signal.SIGTERM,interrupted)
    with report.open("w",encoding="utf-8",newline="") as stream:
        writer = csv.writer(stream,delimiter="\t",lineterminator="\n")
        writer.writerow(["check","status","exit_code"])
        stream.flush()
        for label,command,timeout in steps:
            print("RUN  "+label,flush=True)
            status,code = execute(project,command,timeout,log) if command else ("BLOCKED",3)
            writer.writerow([label,status,code])
            stream.flush()
            print(f"{status} {label}"+(f" (exit {code})" if code else ""),flush=True)
            if code:
                if log.exists():
                    print(tail(log),flush=True)
                print(f"Log: {log}\nResults: {report}",flush=True)
                return 1
    print(f"Log: {log}\nResults: {report}",flush=True)
    print("All requested checks passed. Device E2E and MCP runtime are NOT covered by this bootstrap script.")
    return 0


if __name__=="__main__":
    sys.exit(main())
