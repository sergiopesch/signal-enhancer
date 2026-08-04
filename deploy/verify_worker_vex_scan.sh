#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 <sbom.spdx.json> <vex.openvex.json> <report.json>" >&2
  exit 64
fi

sbom_path="$1"
vex_path="$2"
report_path="$3"
target_cve="CVE-2026-7210"
target_purl="pkg:generic/python@3.12.13"
grype_image="anchore/grype:v0.110.0@sha256:af65fbc0c664691067788fe95ff88760b435543e45595eb2ca6f102fc476fbe1"
audit_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/signal-enhancer-vex.XXXXXX")"
cache_dir="${RUNNER_TEMP:-/tmp}/signal-enhancer-grype-v0.110.0"
baseline_path="$audit_dir/baseline.json"
mismatch_vex_path="$audit_dir/mismatch.openvex.json"
mismatch_vex_container_path="/audit/mismatch.openvex.json"
mismatch_report_path="$audit_dir/mismatch.json"
trap 'rm -rf "$audit_dir"' EXIT
mkdir -p "$cache_dir"

for required_path in "$sbom_path" "$vex_path"; do
  if [[ ! -f "$required_path" ]]; then
    echo "required VEX scan input is missing: $required_path" >&2
    exit 66
  fi
done

scan() {
  docker run \
    --rm \
    --platform linux/amd64 \
    --volume "$PWD:/work:ro" \
    --workdir /work \
    --volume "$cache_dir:/cache" \
    --volume "$audit_dir:/audit:ro" \
    --env GRYPE_DB_CACHE_DIR=/cache \
    "$grype_image" "$@"
}

python3 - "$vex_path" "$mismatch_vex_path" "$target_cve" "$target_purl" <<'PY'
import copy
import json
import sys

source_path, output_path, target_cve, target_purl = sys.argv[1:]
with open(source_path, encoding="utf-8") as source:
    document = json.load(source)
candidate = copy.deepcopy(document)
matches = [
    product
    for statement in candidate.get("statements", [])
    if statement.get("vulnerability", {}).get("name") == target_cve
    for product in statement.get("products", [])
    if product.get("@id") == target_purl
]
if len(matches) != 1:
    raise SystemExit("expected exactly one mismatch-test VEX product")
matches[0]["@id"] = target_purl.replace("@3.12.13", "@3.12.12")
with open(output_path, "w", encoding="utf-8") as output:
    json.dump(candidate, output, indent=2)
    output.write("\n")
PY

scan "sbom:$sbom_path" --only-fixed=false --output json > "$baseline_path"
scan "sbom:$sbom_path" \
  --vex "$vex_path" \
  --only-fixed=false \
  --fail-on high \
  --output json > "$report_path"
scan "sbom:$sbom_path" \
  --vex "$mismatch_vex_container_path" \
  --only-fixed=false \
  --output json > "$mismatch_report_path"

python3 deploy/verify_worker_vex_results.py \
  --baseline "$baseline_path" \
  --vexed "$report_path" \
  --mismatch "$mismatch_report_path" \
  --vex "$vex_path" \
  --target-cve "$target_cve" \
  --target-purl "$target_purl"
