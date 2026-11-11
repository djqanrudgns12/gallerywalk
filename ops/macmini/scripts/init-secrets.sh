#!/bin/sh
# 운영 비밀값 만들기(서비스 계정 gwsvc) — 서버가 요구하는 HMAC 키 3개(PLAN §9.9)를 무작위 32바이트(hex)로
# secrets/app.env(600)에 넣는다. 이미 있는 키는 절대 바꾸지 않는다(바꾸면 저장된 PIN·시작 코드 확인이 깨짐).
# 값은 화면·기록에 내지 않는다.
set -eu

case "${1:-}" in
  -h|--help|help) echo "사용법: sh ops/gw.sh setup-host 가 부른다 (직접: sudo -u gwsvc -H sh init-secrets.sh)"; exit 0 ;;
  "") ;;
  *) echo "ERROR: 알 수 없는 인자: $1" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user init-secrets

mkdir -p "$GW_SECRETS"
chmod 700 "$GW_SECRETS"
touch "$GW_ENV_FILE"
chmod 600 "$GW_ENV_FILE"

added=""
for key in $GW_REQUIRED_SECRETS; do
  if grep -q "^${key}=." "$GW_ENV_FILE"; then continue; fi
  value="$(openssl rand -hex 32)"
  [ "${#value}" -eq 64 ] || gw_die "무작위 키 만들기 실패: $key"
  printf '%s=%s\n' "$key" "$value" >> "$GW_ENV_FILE"
  value=""
  added="$added $key"
done
chmod 600 "$GW_ENV_FILE"
if [ -n "$added" ]; then echo "새로 만든 키:$added (값은 표시하지 않음)"; else echo "필요한 키가 모두 있습니다 (바꾸지 않음)"; fi
