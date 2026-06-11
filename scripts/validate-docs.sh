#!/usr/bin/env bash
# Pre-commit guard: when staged changes touch docs/**/*.md, run `lore validate`
# for every doc type so bad frontmatter never lands. Skips quietly if lore
# isn't built (don't block commits on tooling).
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

# Only run when doc markdown is staged.
staged=$(git diff --cached --name-only --diff-filter=ACMR -- 'docs/**/*.md' 'docs/*.md')
[ -z "$staged" ] && exit 0

LORE_CLI="${LORE_CLI:-$HOME/dev/lore/packages/cli/dist/cli/index.js}"
if [ ! -f "$LORE_CLI" ]; then
  echo "validate-docs: lore CLI not found at $LORE_CLI — skipping doc validation" >&2
  exit 0
fi

types_dir="docs/.lore/types"
[ -d "$types_dir" ] || exit 0

failed=0
for schema in "$types_dir"/*.yaml; do
  [ -e "$schema" ] || continue
  type_name=$(basename "$schema")
  type_name=${type_name%.schema.yaml}
  type_name=${type_name%.yaml}
  if ! out=$(cd docs && node "$LORE_CLI" validate "$type_name" 2>&1); then
    echo "✗ lore validate $type_name failed:" >&2
    echo "$out" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "Doc validation failed — fix the frontmatter above (schemas in docs/.lore/types/) and retry." >&2
  exit 1
fi
exit 0
