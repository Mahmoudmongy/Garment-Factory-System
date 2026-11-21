#!/usr/bin/env bash
# نشر التطبيق على Cloudflare Pages بأمر واحد.
#
#   export CLOUDFLARE_API_TOKEN=...
#   bash tools/deploy-cloudflare.sh
#
# التوكن لازم يكون عنده صلاحية Cloudflare Pages: Edit. مش محتاج Account ID —
# السكربت بيجيبه من التوكن نفسه لو مش متحدد.

set -u

PROJECT="${CF_PAGES_PROJECT:-garment-factory}"
BRANCH="${CF_PAGES_BRANCH:-main}"
API="https://api.cloudflare.com/client/v4"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN مش متحدد." >&2
  echo "اعمله توكن من dash.cloudflare.com → My Profile → API Tokens،" >&2
  echo "بصلاحية Account → Cloudflare Pages → Edit، وحطه في البيئة." >&2
  exit 1
fi

cf_get() {
  curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "$API$1"
}

echo "== التحقق من التوكن =="
if ! cf_get /user/tokens/verify | grep -q '"status":"active"'; then
  echo "التوكن مش صالح أو مش مفعّل." >&2
  cf_get /user/tokens/verify >&2
  exit 1
fi
echo "   التوكن شغال"

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(cf_get /accounts \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"][0]["id"] if d.get("result") else "")')
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "مش قادر أجيب Account ID من التوكن. حدده يدوي في CLOUDFLARE_ACCOUNT_ID." >&2
    exit 1
  fi
fi
export CLOUDFLARE_ACCOUNT_ID
echo "   الحساب: $CLOUDFLARE_ACCOUNT_ID"

echo "== بناء dist/ =="
npm run build || exit 1

echo "== إنشاء المشروع (لو مش موجود) =="
curl -sS -X POST "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$PROJECT\",\"production_branch\":\"$BRANCH\"}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   " + ("اتعمل" if d.get("success") else "موجود بالفعل أو مشكلة: " + str([e.get("message") for e in d.get("errors",[])])[:120]))'

echo "== الرفع =="
npx --yes wrangler@latest pages deploy dist \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-dirty=true || exit 1

URL="https://${PROJECT}.pages.dev"
echo
echo "== فحص الموقع المنشور =="
sleep 5
python3 tools/smoke_test.py "$URL"
echo
echo "الرابط: $URL"
