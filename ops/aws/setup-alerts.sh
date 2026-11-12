#!/bin/sh
# 갤러리 감시 알림 AWS 설정(소유자 계정, aws login --profile we 뒤, ADR-066). 다시 실행해도 안전하다.
#  1) IAM 사용자 gw-macmini + 인라인 정책(cloudwatch:PutMetricData, 이름 공간 Gallerywalk만)
#  2) 접근 키 — gwsvc secrets/aws-macmini-credentials(600)가 없을 때만 만들어 그 파일로 바로 넣는다(화면에 내지 않음)
#  3) 알림 주제: --topic-arn으로 받은 기존 주제를 쓰거나, 없으면 gw-alerts를 만들고 메일을 구독(확인 메일이 감)
#  4) CloudWatch 알람 gw-heartbeat-missing: Gallerywalk/EndToEndOK 최솟값 < 1이 1분 × 3회 또는 신호 없음 → 알림
# --dry-run은 읽기만 하고 할 일을 보여 준다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/aws/setup-alerts.sh (--email <받을 메일> | --topic-arn <기존 SNS 주제 ARN>) [--dry-run]
환경: AWS_PROFILE(기본 we), 지역 us-east-1
EOF
}

email=""; topic=""; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --email) [ $# -ge 2 ] || { usage >&2; exit 1; }; email="$2"; shift 2 ;;
    --topic-arn) [ $# -ge 2 ] || { usage >&2; exit 1; }; topic="$2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) usage >&2; exit 1 ;;
  esac
done
[ -n "$email" ] || [ -n "$topic" ] || { usage >&2; exit 1; }
[ -z "$email" ] || [ -z "$topic" ] || { echo "ERROR: --email과 --topic-arn 중 하나만" >&2; exit 1; }
case "$email" in ""|*@*.*) ;; *) echo "ERROR: 메일 주소 형식이 아닙니다" >&2; exit 1 ;; esac
case "$topic" in ""|arn:aws:sns:us-east-1:*) ;; *) echo "ERROR: us-east-1 SNS 주제 ARN이 아닙니다" >&2; exit 1 ;; esac

export AWS_PROFILE="${AWS_PROFILE:-we}" AWS_REGION=us-east-1 AWS_PAGER=""
svc=gwsvc
creds="/Users/$svc/gallery-server/secrets/aws-macmini-credentials"
user=gw-macmini
alarm=gw-heartbeat-missing
die() { echo "ERROR: $*" >&2; exit 1; }
# 미리 보기 문구는 표준 오류로 낸다 — 부르는 쪽의 `>/dev/null`에 삼켜지지 않게
do_() { if [ "$dry" = "1" ]; then echo "  (할 일) $*" >&2; else "$@"; fi; }
case "$(id -un)" in root|gwsvc|clsvc|rtsvc|wesvc) die "소유자 계정에서 실행하세요" ;; esac
cd /

account="$(aws sts get-caller-identity --query Account --output text)" || die "aws login --profile $AWS_PROFILE 먼저"
echo "== 계정 $account (프로필 $AWS_PROFILE)"

echo "== 무료 한도 확인(사용자 지정 지표·알람 수)"
alarms="$(aws cloudwatch describe-alarms --query 'length(MetricAlarms)' --output text)"
metrics="$(aws cloudwatch list-metrics --query 'Metrics[?!starts_with(Namespace, `AWS/`)].[Namespace,MetricName]' --output text | sort -u | grep -c . || true)"
echo "  알람 $alarms개, 사용자 지정 지표 $metrics개 (무료 한도 각 10개) — 이번에 각 1개를 더함"
[ "$alarms" -lt 10 ] || die "알람이 이미 10개라 무료 한도를 넘습니다"

echo "== 1. IAM 사용자 $user (지표 쓰기 전용)"
if aws iam get-user --user-name "$user" >/dev/null 2>&1; then echo "  이미 있음"; else do_ aws iam create-user --user-name "$user" --tags Key=app,Value=gallerywalk >/dev/null; fi
policy='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"cloudwatch:PutMetricData","Resource":"*","Condition":{"StringEquals":{"cloudwatch:namespace":"Gallerywalk"}}}]}'
do_ aws iam put-user-policy --user-name "$user" --policy-name gw-put-metric --policy-document "$policy"

echo "== 2. 접근 키 → gwsvc $creds"
sudo -n -u "$svc" true 2>/dev/null || die "sudo 위임이 없습니다 — sh ops/gw.sh setup-host 먼저"
if sudo -n -u "$svc" test -s "$creds"; then
  echo "  이미 있음(바꾸지 않음)"
else
  nkeys="$(aws iam list-access-keys --user-name "$user" --query 'length(AccessKeyMetadata)' --output text 2>/dev/null || echo 0)"
  [ "$nkeys" -lt 2 ] || die "$user 의 키가 이미 2개입니다 — 쓰지 않는 키를 정리한 뒤 다시"
  if [ "$dry" = "1" ]; then
    echo "  (할 일) 접근 키 만들어 $creds(600)에 바로 넣기"
  else
    # 키 원문은 변수와 파이프로만 지나가고 화면·파일(소유자 쪽)에는 남지 않는다.
    aws iam create-access-key --user-name "$user" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
      | awk '{ printf "[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n", $1, $2 }' \
      | sudo -u "$svc" -H sh -c 'umask 077; cat > "$1.tmp" && mv "$1.tmp" "$1"' sh "$creds"
    sudo -n -u "$svc" test -s "$creds" || die "자격 증명 파일 쓰기 실패"
    echo "  넣음(값은 표시하지 않음)"
  fi
fi

echo "== 3. 알림 주제"
if [ -z "$topic" ]; then
  topic="$(aws sns list-topics --query "Topics[?ends_with(TopicArn, ':gw-alerts')].TopicArn | [0]" --output text)"
  if [ "$topic" = "None" ] || [ -z "$topic" ]; then
    if [ "$dry" = "1" ]; then topic="arn:aws:sns:us-east-1:$account:gw-alerts"; echo "  (할 일) 주제 gw-alerts 만들기"
    else topic="$(aws sns create-topic --name gw-alerts --tags Key=app,Value=gallerywalk --query TopicArn --output text)"; fi
  fi
  subs="$(aws sns list-subscriptions-by-topic --topic-arn "$topic" --query "Subscriptions[?Endpoint=='$email'] | length(@)" --output text 2>/dev/null || echo 0)"
  if [ "$subs" = "0" ]; then do_ aws sns subscribe --topic-arn "$topic" --protocol email --notification-endpoint "$email" >/dev/null; echo "  메일 구독 요청 — 받은편지함의 확인 링크를 눌러야 알림이 온다"; else echo "  이미 구독 중"; fi
fi
echo "  주제: ${topic##*:}"

echo "== 4. 알람 $alarm"
do_ aws cloudwatch put-metric-alarm --alarm-name "$alarm" \
  --alarm-description "갤러리 하트비트(로컬·공개·뒷문)가 3분 동안 실패하거나 끊김 — sh ops/gw.sh status" \
  --namespace Gallerywalk --metric-name EndToEndOK --statistic Minimum --period 60 \
  --evaluation-periods 3 --datapoints-to-alarm 3 --threshold 1 --comparison-operator LessThanThreshold \
  --treat-missing-data breaching --alarm-actions "$topic" --ok-actions "$topic"

echo "== 끝"
echo "확인: sh ops/gw.sh heartbeat → 1~2분 뒤 aws cloudwatch describe-alarms --alarm-names $alarm --query 'MetricAlarms[0].StateValue'"
