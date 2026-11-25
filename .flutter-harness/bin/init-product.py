#!/usr/bin/env python3
"""Copy the reusable design-system starter without overwriting any source."""
import argparse
from pathlib import Path

def install(project, template):
    if not (project / "pubspec.yaml").is_file():
        raise ValueError("Expected a Flutter project with pubspec.yaml")
    if not template.is_dir():
        raise ValueError(f"Missing starter: {template}")
    for source in sorted(template.glob("lib/**/*.dart.template")):
        path = project / source.relative_to(template).with_suffix("")
        if path.exists():
            print(f"Preserved {path.relative_to(project)}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Created {path.relative_to(project)}")
    print("Wire the design system in app/, resolve SDK-compatible dependencies, and activate product.json after migration.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--template", type=Path)
    args = parser.parse_args()
    try:
        install(args.project, args.template or args.project / ".flutter-harness/templates/product")
    except (OSError, ValueError) as error:
        parser.exit(1, f"ERROR: {error}\n")
