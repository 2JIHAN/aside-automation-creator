#!/bin/bash
set -euo pipefail
[ "$#" -eq 1 ] || { echo 'Usage: payload-fingerprint.sh RESOURCES_DIRECTORY' >&2; exit 2; }
cd "$1"
[ ! -L "payload/assets/scenarios" ] && [ -d "payload/assets/scenarios" ] && [ -z "$(find "payload/assets/scenarios" -type l -print -quit)" ] || { echo 'Refusing invalid scenarios tree.' >&2; exit 1; }
[ ! -L payload/references ] || { echo 'Refusing references symlink.' >&2; exit 1; }
if [ -e payload/references ]; then
  [ -d payload/references ] && [ -z "$(find payload/references -type l -print -quit)" ] || { echo 'Refusing invalid references tree.' >&2; exit 1; }
fi
if grep -Fq 'references/file-writing-rules.md' payload/SKILL.md; then
  [ -f payload/references/file-writing-rules.md ] || { echo 'Missing references/file-writing-rules.md.' >&2; exit 1; }
fi
{
  printf '%s\n' payload/engine.mjs payload/SKILL.md
  find payload/assets/scenarios runtime -type f ! -name .DS_Store
  if [ -d payload/references ]; then find payload/references -type f ! -name .DS_Store; fi
} | LC_ALL=C sort | while IFS= read -r file; do
  shasum -a 256 "$file"
done > payload-manifest.txt
shasum -a 256 payload-manifest.txt | awk '{print $1}'
