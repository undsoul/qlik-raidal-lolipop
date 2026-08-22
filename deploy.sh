#!/bin/bash
# Radial Lollipop Auto Deploy — delete old + upload new (adapted from Qlik2Review/deploy.sh)
set -e

# Token comes from the environment or the untracked .env.deploy file (same pattern as Qlik2Design).
# NEVER hardcode it here — hardcoded tokens leak into git history.
[ -f "$(dirname "$0")/.env.deploy" ] && . "$(dirname "$0")/.env.deploy"
API_TOKEN="${QLIK_API_TOKEN:?Set QLIK_API_TOKEN env var or create .env.deploy}"
TENANT="${QLIK_TENANT:?Set QLIK_TENANT env var or add it to .env.deploy}"
EXT_NAME="qlik-raidal-lolipop"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Radial Lollipop Deploy ==="

# 1. Find existing extension ID (match zip base name or qext display name)
EXT_ID=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$TENANT/api/v1/extensions?limit=100" | python3 -c "
import sys,json
data=json.load(sys.stdin)
for ext in data.get('data',[]):
    if ext.get('name') in ('$EXT_NAME','Radial Lollipop'):
        print(ext['id'])
        break
")

# 2. Delete existing
if [ -n "$EXT_ID" ]; then
    echo "Deleting old extension: $EXT_ID"
    curl -s -X DELETE -H "Authorization: Bearer $API_TOKEN" "$TENANT/api/v1/extensions/$EXT_ID" -o /dev/null
    echo "Deleted."
else
    echo "No existing extension found."
fi

# 3. Create ZIP (extension files only)
ZIP_FILE="/tmp/qlik-raidal-lolipop_deploy.zip"
rm -f "$ZIP_FILE"
cd "$DIR"
zip -r "$ZIP_FILE" . -x "*.DS_Store" -x ".git/*" -x ".claude/*" -x ".gitignore" -x "deploy.sh" -x "*.qvs" -x ".env*" > /dev/null

# Fail-closed guard: never ship an env file or an embedded API token (JWT), whatever the exclude list says.
if unzip -l "$ZIP_FILE" | grep -qE '\.env|\.pem'; then
    echo "ABORT: an .env/.pem file slipped into the deploy ZIP — refusing to upload."
    exit 1
fi
if unzip -p "$ZIP_FILE" | grep -q 'eyJhbGciOi'; then
    echo "ABORT: an embedded JWT/API token found inside the deploy ZIP contents — refusing to upload."
    exit 1
fi
echo "ZIP created: $(du -h "$ZIP_FILE" | cut -f1)"

# 4. Upload new
echo "Uploading..."
RESULT=$(curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -F "file=@$ZIP_FILE;filename=$EXT_NAME.zip" "$TENANT/api/v1/extensions")
NEW_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))" 2>/dev/null || echo "PARSE_ERROR")

if [ "$NEW_ID" = "ERROR" ] || [ "$NEW_ID" = "PARSE_ERROR" ]; then
    echo "Upload failed: $RESULT"
    exit 1
fi

echo "Deployed! New ID: $NEW_ID"
VERSION=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
echo "Version: $VERSION"
echo "=== Done ==="
