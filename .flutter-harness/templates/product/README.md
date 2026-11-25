The source templates implement the one Material 3 / feature-first MVVM
baseline. Use scripts/new-project.py to create, wire and verify a new project.
CLI adopt copies missing starter files on an existing pending project but
does not overwrite application source or perform semantic migration.

Default adaptive system light/dark themes derive colors from Ocean Blue
(#2563EB). Use stock Material controls and shared semantic roles. Avoid
creating wrappers without shared behavior. PRODUCT.md is the canonical
product policy, installed once at .flutter-harness/PRODUCT.md.
