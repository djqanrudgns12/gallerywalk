#!/bin/sh
# 갤러리 1분 하트비트(서비스 계정 gwsvc, launchd com.ssamuniverse.gallery.watch, PLAN §19, ADR-066).
# ① 맥미니 안 /api/health 200(DB 열림·디스크 여유) ② 공개 https://gallery…/api/health 200(CloudFront·터널·원본 잠금 통과)
# ③ 원본 직접 접속 403(뒷문 잠김)을 보고, 셋 다 맞을 때만 CloudWatch Gallerywalk/EndToEndOK=1을 보낸다.
# 0이거나 신호가 끊기면(맥미니 전원·회선이 죽은 경우 포함) 3분(3회) 뒤 CloudWatch 알람이 메일을 보낸다.
# AWS 자격 증명(secrets/aws-macmini-credentials)이 아직 없으면 결과만 기록한다. 비밀값은 출력하지 않는다.
set -eu

case "${1:-}" in
  -h|--help|help) echo "사용법: sh ops/gw.sh heartbeat   (launchd가 1분마다 부름)"; exit 0 ;;
  "") ;;
  *) echo "ERROR: 알 수 없는 인자: $1" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user heartbeat

GW_PUBLIC_URL="${GW_PUBLIC_URL:-https://gallery.ssamuniverse.com}"
GW_ORIGIN_URL="${GW_ORIGIN_URL:-https://$GW_ORIGIN_HOST}"
mkdir -p "$GW_STATE" "$GW_LOGS"

code_of() { curl -s -o /dev/null -m 8 -w '%{http_code}' "$1" 2>/dev/null || true; }

local_code="$(gw_health_code "$GW_PORT")"
public_code="$(code_of "$GW_PUBLIC_URL/api/health")"
origin_code="$(code_of "$GW_ORIGIN_URL/api/health")"

ok=1
problems=""
[ "$local_code" = "200" ] || { ok=0; problems="$problems 로컬=$local_code"; }
[ "$public_code" = "200" ] || { ok=0; problems="$problems 공개=$public_code"; }
[ "$origin_code" = "403" ] || { ok=0; problems="$problems 뒷문=$origin_code(403이어야 함)"; }

now="$(date '+%F %T')"
if [ "$ok" = "1" ]; then
  # 정상일 때는 바뀐 순간에만 남겨 기록을 늘리지 않는다
  [ "$(cat "$GW_STATE/heartbeat-last" 2>/dev/null || true)" = "ok" ] || echo "$now 정상으로 돌아옴(로컬·공개 200, 뒷문 403)"
  echo ok > "$GW_STATE/heartbeat-last"
else
  echo "$now 점검 실패:$problems"
  echo fail > "$GW_STATE/heartbeat-last"
fi
printf '%s %s%s\n' "$now" "$ok" "$problems" > "$GW_STATE/heartbeat-status"

creds="$GW_SECRETS/aws-macmini-credentials"
[ -s "$creds" ] || exit 0
if [ "${GW_OPS_TEST_MODE:-0}" = "1" ]; then exit 0; fi
AWS_SHARED_CREDENTIALS_FILE="$creds" AWS_CONFIG_FILE=/dev/null \
  /opt/homebrew/bin/aws cloudwatch put-metric-data --region us-east-1 --namespace Gallerywalk \
  --metric-data "MetricName=EndToEndOK,Value=$ok,Unit=Count" >/dev/null 2>&1 \
  || echo "$now CloudWatch 지표 전송 실패(EndToEndOK=$ok)"
exit 0
