#!/usr/bin/env python3
"""Fast convention guard; not a replacement for the Dart analyzer or UX review."""
import argparse
import json
import posixpath
import re
import subprocess
from pathlib import Path, PurePosixPath

# Retain string literals for import parsing; remove comments and mask strings
# for source pattern checks. This is intentionally a lexical convention check.
LEX = re.compile(r"""//[^\n]*|/\*[\s\S]*?\*/|(?:r)?(?:'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")""")
DIRECTIVE = re.compile(r"\b(?:import|export|part(?!\s+of\b))\s+([^;]+);")
URI = re.compile(r"""['"]([^'"]+)['"]""")
FEATURE_LAYERS = {"models", "repositories", "services", "use_cases", "view_models", "screens", "widgets"}
PRESENTATION = {"screens", "widgets"}
DEPENDENCIES = {
    "models": {"models"},
    "services": {"models", "services"},
    "repositories": {"models", "services", "repositories"},
    "use_cases": {"models", "repositories", "use_cases"},
    "view_models": {"models", "repositories", "use_cases", "view_models"},
    "screens": {"models", "view_models", "screens", "widgets"},
    "widgets": {"models", "view_models", "screens", "widgets"},
}
DESIGN_IMPORT = re.compile(r"^package:(?:material_ui/|cupertino_ui/|flutter/(?:material|cupertino)\.dart$|shadcn_ui/|shadcn_flutter/|shad/)")
MATERIAL_IMPORT = re.compile(r"^package:(?:material_ui/|flutter/material\.dart$)")
WIDGET_IMPORT = re.compile(r"^package:flutter/(?:widgets|rendering|painting|gestures|services)\.dart$")
DATA_IMPORT = re.compile(r"^package:(?:shared_preferences(?:_platform_interface)?|dio|http|drift|sqflite|flutter_secure_storage|hive|isar)(?:/|_)")
STYLE_LITERAL = re.compile(r"\b(?:Color\s*\(\s*0x[0-9a-fA-F]+|(?:Colors|CupertinoColors)\s*\.|BorderRadius\s*\.\s*circular\s*\(\s*\d|EdgeInsets\s*\.\s*(?:all|symmetric|only|fromLTRB)\s*\([^)]*?(?:\b(?:left|right|top|bottom|horizontal|vertical)\s*:\s*)?\b[1-9]\d*(?:\.\d+)?\b|TextStyle\s*\([^)]*?\bfontSize\s*:\s*\d)", re.S)

def masked(source, strings=False):
    return LEX.sub(lambda m: re.sub(r"[^\n]", " ", m.group()) if strings or m.group().startswith(("//", "/*")) else m.group(), source)

def project_target(uri, path, package):
    if uri.startswith("package:" + package + "/"):
        return uri[len("package:" + package + "/"):]
    if uri.startswith(("package:", "dart:")):
        return None
    return posixpath.normpath(posixpath.join(posixpath.dirname(path), uri))

def feature_info(path):
    p = PurePosixPath(path).parts
    return (p[1], p[2]) if len(p) >= 4 and p[0] == "features" else (None, None)

def inspect(root, ui_profile):
    errors = []
    lib = root / "lib"
    pubspec = (root / "pubspec.yaml").read_text(encoding="utf-8")
    match = re.search(r"(?m)^name:\s*([a-zA-Z0-9_]+)\s*$", pubspec)
    if not match:
        return ["pubspec.yaml: missing package name"]
    package = match.group(1)
    for required in ("main.dart", "app/bootstrap.dart", "app/app.dart", "design_system/design_system.dart"):
        if not (lib / required).is_file():
            errors.append(f"lib/{required}: required foundation file is missing")
    for file in sorted(lib.rglob("*.dart")):
        path = file.relative_to(lib).as_posix()
        top = path.split("/")[0]
        feature, layer = feature_info(path)
        if top not in {"main.dart", "app", "core", "design_system", "features"} or (top == "features" and layer not in FEATURE_LAYERS):
            errors.append(f"lib/{path}: use app/core/design_system/features/<feature>/<layer>/")
        source = file.read_text(encoding="utf-8")
        plain = masked(source, strings=True)
        # main is intentionally constrained to a single bootstrap invocation.
        if path == "main.dart":
            body = DIRECTIVE.sub("", masked(source)).strip()
            if not re.fullmatch(r"(?:void|Future<void>)\s+main\s*\(\s*\)\s*(?:async\s*)?(?:=>\s*(?:await\s+)?bootstrap\s*\(\s*\)\s*;|\{\s*(?:await\s+)?bootstrap\s*\(\s*\)\s*;\s*\})", body):
                errors.append(f"lib/{path}: main must only call bootstrap()")
        if (layer in PRESENTATION or top == "app") and STYLE_LITERAL.search(plain):
            errors.append(f"lib/{path}: fixed palette, typography, radius or spacing belongs in design_system")
        for directive in DIRECTIVE.finditer(masked(source)):
            for uri in URI.findall(directive.group(1)):
                target = project_target(uri, path, package)
                target_top = target.split("/")[0] if target else ""
                target_feature, target_layer = feature_info(target or "")
                if path == "main.dart" and target != "app/bootstrap.dart":
                    errors.append(f"lib/{path}: import only app/bootstrap.dart ({uri})")
                if DESIGN_IMPORT.search(uri):
                    material = bool(MATERIAL_IMPORT.search(uri))
                    direct_material = (ui_profile in {"universal", "custom"} and material
                                       and (top == "app" or layer in PRESENTATION))
                    if ui_profile in {"universal", "custom"} and not material:
                        errors.append(f"lib/{path}: universal uses Material only; remove alternate visual UI import ({uri})")
                    elif top != "design_system" and not direct_material:
                        errors.append(f"lib/{path}: use design_system instead of platform UI library ({uri})")
                if feature and layer not in PRESENTATION and (WIDGET_IMPORT.search(uri) or DESIGN_IMPORT.search(uri)):
                    errors.append(f"lib/{path}: non-view layer must not import UI ({uri})")
                if feature and layer in PRESENTATION and DATA_IMPORT.search(uri):
                    errors.append(f"lib/{path}: view must not access storage/network directly ({uri})")
                if target and target.startswith("../"):
                    errors.append(f"lib/{path}: dependency outside lib ({uri})")
                if top in {"core", "design_system"} and target_top in {"app", "features", "main.dart"}:
                    errors.append(f"lib/{path}: shared layer must not depend on app/feature ({uri})")
                if top == "core" and target_top == "design_system":
                    errors.append(f"lib/{path}: core must not depend on UI ({uri})")
                if feature and target_top in {"app", "main.dart"}:
                    errors.append(f"lib/{path}: feature must not depend on composition root ({uri})")
                if feature and target_top == "features" and (target_feature != feature or target_layer not in DEPENDENCIES.get(layer, set())):
                    errors.append(f"lib/{path}: invalid feature/layer dependency ({uri})")
                if feature and layer not in PRESENTATION and target_top == "design_system":
                    errors.append(f"lib/{path}: non-view layer must not depend on design_system ({uri})")
                if feature and layer in PRESENTATION and target and re.match(r"core/(?:storage|network)/", target):
                    errors.append(f"lib/{path}: view must use ViewModel, not infrastructure ({uri})")
    return sorted(set(errors))

def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()

def pending_allowed(root, base):
    if not base:
        return False
    ancestor = git(root, "merge-base", base, "HEAD")
    changed = git(root, "diff", "--name-only", ancestor, "--", "lib", "test", "integration_test", "pubspec.yaml", "pubspec.lock")
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "--", "lib", "test", "integration_test", "pubspec.yaml", "pubspec.lock")
    try:
        old = json.loads(git(root, "show", f"{ancestor}:.flutter-harness/product.json"))
    except subprocess.CalledProcessError:
        old = {}
    return not changed and not untracked and old.get("status") != "active"

def verify(root, base=None):
    cfg = root / ".flutter-harness/product.json"
    if not cfg.is_file():
        return ["missing .flutter-harness/product.json"]
    settings = json.loads(cfg.read_text(encoding="utf-8"))
    if settings.get("schema") != 1 or settings.get("architecture") != "feature-mvvm":
        return ["invalid product schema or architecture"]
    if settings.get("ui_profile") not in {"universal", "custom"}:
        return ["invalid UI profile"]
    if settings.get("status") == "pending":
        return [] if pending_allowed(root, base) else ["product foundation pending; migrate and activate before application delivery"]
    if settings.get("status") != "active":
        return ["invalid product status"]
    return inspect(root, settings["ui_profile"])

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--base", help="CI-only exception for initial config-only adoption")
    args = parser.parse_args()
    try:
        errors = verify(args.project.resolve(), args.base)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print("FAIL product: " + error)
        raise SystemExit(1)
    print("PASS product conventions (visual quality requires review)")
