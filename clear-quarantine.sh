#!/bin/bash
# Trusted caller supplies this execution's canonical output directory, not a security sandbox.
set -euo pipefail
[ "$#" -eq 1 ] || { echo 'Usage: clear-quarantine.sh OUTPUT_DIRECTORY' >&2; exit 2; }
root="$1"
case "$root" in /*) ;; *) echo 'Output directory must be absolute.' >&2; exit 2 ;; esac
[ "$root" != / ] && [ -d "$root" ] && [ ! -L "$root" ] || { echo "Invalid output directory: $root" >&2; exit 1; }
[ "$(cd "$root" && pwd -P)" = "$root" ] || { echo 'Output directory must not traverse a symlink.' >&2; exit 1; }
manifest=$(mktemp "$root/.quarantine-paths.XXXXXX")
trap 'rm -f "$manifest"' EXIT
# A process substitution would hide find's failure from the caller.
find "$root" \( -type d -o -type f -o -type l \) -print0 > "$manifest" || exit 1
while IFS= read -r -d '' file; do
  if [ ! -L "$file" ] && [ -f "$file" ] && [ "$(/usr/bin/stat -f %l "$file")" -gt 1 ]; then
    echo "Refusing shared hardlink: $file" >&2; exit 1
  fi
done < "$manifest"
while IFS= read -r -d '' file; do
  attrs=$(/usr/bin/xattr -s "$file") || exit 1
  if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then
    /usr/bin/xattr -s -d com.apple.quarantine "$file" 2>/dev/null || true
  fi
  attrs=$(/usr/bin/xattr -s "$file") || exit 1
  if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then
    echo "Quarantine remains: $file" >&2; exit 1
  fi
done < "$manifest"
