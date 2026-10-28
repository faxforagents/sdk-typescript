#!/bin/sh
# Regenerate src/schema.d.ts from spec/openapi.yaml with openapi-typescript. The spec is a copy of
# the public document (https://github.com/faxforagents/openapi). CI diffs the committed file against a
# fresh run and fails on drift. Provenance: fax-for-agents scripts/gen-api-types.sh (2026-10-28).
set -eu
cd "$(dirname "$0")/.."
npx openapi-typescript spec/openapi.yaml -o src/schema.d.ts --alphabetize --root-types --root-types-no-schema-prefix >/dev/null
echo "src/schema.d.ts regenerated"
