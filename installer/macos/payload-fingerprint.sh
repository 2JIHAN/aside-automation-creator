#!/bin/bash
set -euo pipefail
[ "$#" -eq 1 ] || { echo 'Usage: payload-fingerprint.sh RESOURCES_DIRECTORY' >&2; exit 2; }
cd "$1"
{
  printf '%s\n' payload/engine.mjs payload/SKILL.md
  find payload/assets/template runtime -type f
} | LC_ALL=C sort | while IFS= read -r file; do
  shasum -a 256 "$file"
done > payload-manifest.txt
shasum -a 256 payload-manifest.txt | awk '{print $1}'
