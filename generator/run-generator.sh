#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

version="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cache_root="${CUSTOM_ALLOY_BUILDER_CACHE_ROOT:-$HOME/.cache/custom-alloy-builder}"
clone_dir="$cache_root/src/alloy-$version"
out_dir="$repo_root/schemas/$version"

mkdir -p "$(dirname "$clone_dir")"
if [[ ! -d "$clone_dir/.git" ]]; then
  git clone --depth 1 --branch "$version" https://github.com/grafana/alloy "$clone_dir"
fi

rm -rf "$clone_dir/schemagen"
mkdir -p "$clone_dir/schemagen"
cp "$script_dir"/*.go "$clone_dir/schemagen/"

(cd "$clone_dir" && go run -p "${GO_BUILD_PARALLELISM:-1}" ./schemagen -version "$version" -out "$out_dir")

go_version="$(awk '$1 == "go" { print $2; exit }' "$clone_dir/go.mod")"
build_image_tag="$(grep -RhoE 'grafana/alloy-build-image:[^ @]+' "$clone_dir/Dockerfile" "$clone_dir/.github" 2>/dev/null | head -n 1 | sed 's|^grafana/alloy-build-image:||')"

mkdir -p "$repo_root/schemas"
python3 - "$repo_root/schemas/versions.json" "$version" "$go_version" "$build_image_tag" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
version, go_version, build_image_tag = sys.argv[2:5]
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {"versions": []}
versions = data.setdefault("versions", [])
entry = {
    "version": version,
    "goVersion": go_version,
    "buildImageTag": build_image_tag,
    "alwaysIncludePkgs": [],
}
for i, existing in enumerate(versions):
    if existing.get("version") == version:
        versions[i] = entry
        break
else:
    versions.append(entry)
versions.sort(key=lambda item: item["version"])
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
PY
