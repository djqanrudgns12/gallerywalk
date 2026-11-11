#!/bin/sh
# 우리들의 아트 갤러리 운영 스크립트 공통 환경(ADR-060, PLAN §19) — 경로·포트·잠금·수업 시간 금지창·부하 판정.
# 다른 스크립트가 `. "$here/env.sh"`로 불러 쓴다. 직접 실행하면 설정 요약만 보여 준다.
# 안전장치: 맥미니에서 함께 도는 쌤유니버스(clsvc)·rollingthunder(rtsvc)·글방(wesvc)의 계정·포트·데몬을 건드리지 않는다.
set -eu

gw_env_usage() {
  cat <<'EOF'
사용법: sh ops/macmini/scripts/env.sh [--help]

갤러리 운영 스크립트가 함께 쓰는 환경 설정입니다.
  서비스 계정 : gwsvc (clsvc·rtsvc·wesvc·root 사용 금지)
  서버 루트   : /Users/gwsvc/gallery-server
  운영 포트   : 127.0.0.1:4520 (배포 사전 검사 4523, 개발 4521·4522는 쓰지 않음)
  터널 메트릭 : 127.0.0.1:20243
  배포 금지창 : Asia/Seoul 월~금 08:00~15:59
  부하 기준   : 1분 부하가 코어 수 x 0.75를 넘거나 메모리 압박이 정상이 아니면 미룬다
EOF
}

if [ "$(basename "$0")" = "env.sh" ]; then
  case "${1:-}" in
    -h|--help|help|"") gw_env_usage; exit 0 ;;
    *) echo "ERROR: env.sh는 다른 스크립트에서 불러 씁니다 (--help 참고)" >&2; exit 1 ;;
  esac
fi

GW_SERVICE_USER="${GW_SERVICE_USER:-gwsvc}"
GW_HOME="${GW_HOME:-/Users/$GW_SERVICE_USER/gallery-server}"
GW_APP="$GW_HOME/app"
GW_RELEASES="$GW_HOME/releases"
GW_DATA="$GW_HOME/data"
GW_MEDIA="$GW_HOME/media"
GW_TMP="$GW_HOME/tmp"
GW_DB_PATH="$GW_DATA/gallery.sqlite"
GW_SECRETS="$GW_HOME/secrets"
GW_ENV_FILE="$GW_SECRETS/app.env"
GW_CLOUDFLARED="$GW_HOME/cloudflared"
GW_LOGS="$GW_HOME/logs"
GW_STATE="$GW_HOME/state"
GW_CACHE="$GW_HOME/repo-cache"
GW_BOOTSTRAP="$GW_HOME/bootstrap"
GW_PAUSED_FILE="$GW_HOME/AUTO_DEPLOY_PAUSED"

GW_PORT="${GW_PORT:-4520}"
GW_PRECHECK_PORT="${GW_PRECHECK_PORT:-4523}"
GW_TUNNEL_METRICS_PORT="${GW_TUNNEL_METRICS_PORT:-20243}"
GW_ORIGIN_HOST="${GW_ORIGIN_HOST:-origin-gallery.ssamuniverse.com}"
GW_TUNNEL_NAME="${GW_TUNNEL_NAME:-gallerywalk}"
GW_RELEASES_KEEP="${GW_RELEASES_KEEP:-3}"
GW_GITHUB_REPO="${GW_GITHUB_REPO:-djqanrudgns12/gallerywalk}"
GW_REPO_HTTPS="${GW_REPO_HTTPS:-https://github.com/$GW_GITHUB_REPO.git}"
GW_DEPLOY_BRANCH="${GW_DEPLOY_BRANCH:-main}"
GW_AUTODEPLOY_REQUIRE_CI="${GW_AUTODEPLOY_REQUIRE_CI:-1}"
GW_LOAD_MAX_RATIO="${GW_LOAD_MAX_RATIO:-0.75}"
GW_SERVER_LABEL="com.ssamuniverse.gallery"
GW_SERVER_PLIST="/Library/LaunchDaemons/$GW_SERVER_LABEL.plist"
GW_REQUIRED_SECRETS="PIN_HMAC_SECRET RATE_KEY_SECRET START_CODE_HMAC"

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="/opt/homebrew/opt/node@24/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)"

umask 077

GW_LOCK_DIR=""
GW_TMP_DIR=""

gw_die() {
  echo "ERROR: $*" >&2
  exit 1
}

# 시험(GW_OPS_TEST_MODE=1)은 격리된 GW_HOME에서만 계정 검사를 푼다. 운영 경로에서는 반드시 gwsvc.
gw_require_service_user() {
  if [ "${GW_OPS_TEST_MODE:-0}" = "1" ]; then
    [ "$GW_HOME" != "/Users/$GW_SERVICE_USER/gallery-server" ] || gw_die "시험은 격리된 GW_HOME에서만 실행하세요"
    return 0
  fi
  [ "$(id -un)" = "$GW_SERVICE_USER" ] || gw_die "$GW_SERVICE_USER 계정으로 실행해야 합니다: sh ops/gw.sh $1"
}

# 다른 서비스 계정·포트를 쓰도록 바꾸는 실수를 시작 단계에서 막는다.
gw_assert_safe_service() {
  case "$GW_SERVICE_USER" in
    gwsvc) ;;
    clsvc|rtsvc|wesvc|root|"") gw_die "허용되지 않는 서비스 계정입니다: '$GW_SERVICE_USER' (gwsvc 전용)" ;;
    *[!a-z0-9_-]*) gw_die "서비스 계정 이름 형식이 잘못되었습니다: '$GW_SERVICE_USER'" ;;
  esac
  for p in "$GW_PORT" "$GW_PRECHECK_PORT"; do
    case "$p" in
      3000|8000|20241|20242|4380|4390|4460|4461|4462|4521|4522|5173)
        gw_die "포트 $p 는 다른 서비스나 개발 서버가 씁니다 (운영 4520, 사전 검사 4523)" ;;
    esac
  done
  [ "$GW_PORT" != "$GW_PRECHECK_PORT" ] || gw_die "운영 포트와 사전 검사 포트가 같습니다"
  case "$GW_TUNNEL_METRICS_PORT" in
    20241|20242|3000|8000|4390|4460|4520) gw_die "터널 메트릭 포트 $GW_TUNNEL_METRICS_PORT 는 다른 서비스와 겹칩니다 (20243)" ;;
  esac
}

gw_assert_safe_service

gw_cleanup_all() {
  if [ -n "${GW_TMP_DIR:-}" ] && [ -d "$GW_TMP_DIR" ]; then rm -rf "$GW_TMP_DIR"; fi
  if [ -n "${GW_LOCK_DIR:-}" ] && [ -d "$GW_LOCK_DIR" ]; then rm -rf "$GW_LOCK_DIR"; fi
}

gw_register_exit_trap() {
  trap 'gw_cleanup_all' EXIT
  trap 'exit 130' INT TERM HUP
}

gw_mktemp_dir() {
  mkdir -p "$GW_TMP"
  GW_TMP_DIR="$(mktemp -d "$GW_TMP/ops.XXXXXX")"
  gw_register_exit_trap
}

# 원자적 디렉터리 잠금(mkdir). 죽은 PID나 180분 넘은 잠금은 회수한다.
gw_lock() {
  lock_target="$GW_STATE/$1.lock"
  mkdir -p "$GW_STATE"
  if ! mkdir "$lock_target" 2>/dev/null; then
    holder="$(cat "$lock_target/pid" 2>/dev/null || true)"
    fresh="$(find "$lock_target" -maxdepth 0 -mmin -180 2>/dev/null || true)"
    if [ -n "$holder" ] && [ -n "$fresh" ] && kill -0 "$holder" 2>/dev/null; then
      return 1
    fi
    rm -rf "$lock_target"
    mkdir "$lock_target" 2>/dev/null || return 1
  fi
  echo "$$" > "$lock_target/pid"
  GW_LOCK_DIR="$lock_target"
  gw_register_exit_trap
  return 0
}

# 한국 시각 평일(월~금) 08:00~15:59이면 0(금지창). PLAN §19, AGENTS.md §2.
gw_is_school_hours() {
  kst_now="${GW_TEST_KST_DOW_HOUR:-$(TZ=Asia/Seoul date '+%u:%H')}"
  case "$kst_now" in
    [1-5]:08|[1-5]:09|[1-5]:1[0-5]) return 0 ;;
    *) return 1 ;;
  esac
}

# 맥미니가 바쁘면 0: 1분 부하 > 코어 수 x 비율, 또는 커널 메모리 압박이 정상(1)이 아님(2 경고·4 위험).
# 서비스 계정은 소유자 홈(700)의 resource-guard를 볼 수 없어 그 기준 중 계정과 무관하게 읽히는 두 가지를 직접 쓴다.
gw_is_busy() {
  if [ -n "${GW_TEST_LOAD:-}" ]; then
    load1="$GW_TEST_LOAD"
  else
    load1="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
  fi
  ncpu="${GW_TEST_NCPU:-$(sysctl -n hw.ncpu 2>/dev/null || echo 1)}"
  pressure="${GW_TEST_PRESSURE:-$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 1)}"
  [ "$pressure" = "1" ] || return 0
  awk -v l="${load1:-0}" -v n="$ncpu" -v r="$GW_LOAD_MAX_RATIO" 'BEGIN { exit !(l > n * r) }'
}

gw_load_summary() {
  printf '1분 부하 %s / 코어 %s, 메모리 압박 %s' "$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')" \
    "$(sysctl -n hw.ncpu 2>/dev/null)" "$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)"
}

gw_valid_sha() {
  [ "${#1}" -eq 40 ] || return 1
  case "$1" in *[!0-9a-f]*) return 1 ;; esac
}

# 릴리스 폴더의 마이그레이션 수(= 그 코드가 아는 가장 새 스키마 판, 판은 1..n 빈틈없음)
gw_migration_count() {
  ls "$1/apps/server/dist/store/migrations" 2>/dev/null | grep -c '\.sql$' || true
}

gw_server_pid() {
  pgrep -u "$GW_SERVICE_USER" -f "$GW_APP/apps/server/dist/index.js" 2>/dev/null | head -n 1 || true
}

# gwsvc의 운영 서버(4520)에만 SIGTERM을 보낸다. launchd KeepAlive가 app 링크의 새 릴리스로 다시 띄운다.
gw_restart_server() {
  [ "$(id -un)" = "$GW_SERVICE_USER" ] || gw_die "서버 재시작은 $GW_SERVICE_USER 계정에서만 할 수 있습니다"
  pkill -TERM -u "$GW_SERVICE_USER" -f "$GW_APP/apps/server/dist/index.js" 2>/dev/null || true
}

gw_health_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null || true
}

# 재시작 뒤 새 프로세스(이전 PID와 다름)가 /api/health 200을 낼 때까지 최대 60초.
gw_wait_restarted() {
  old_pid="$1"
  i=0
  while [ "$i" -lt 30 ]; do
    sleep 2
    pid="$(gw_server_pid)"
    if [ -n "$pid" ] && [ "$pid" != "$old_pid" ] && [ "$(gw_health_code "$GW_PORT")" = "200" ]; then
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}
