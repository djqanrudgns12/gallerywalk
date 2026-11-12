#!/bin/sh
# 갤러리 운영 명령 입구(소유자 계정에서 실행). 실제 일은 서비스 계정 gwsvc가 한다(sudo -u gwsvc, root 아님).
# sudo(관리자 비밀번호)가 필요한 것은 setup-host·install-daemons 두 가지뿐이다. 순서는 docs/runbook.md.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd -P)"
ops="$repo/ops/macmini"
. "$ops/scripts/env.sh"

usage() {
  cat <<'EOF'
사용법: sh ops/gw.sh <명령>

  setup-host                 (sudo) 서비스 계정·폴더·sudo 위임·비밀값 준비, 1회
  install-daemons <항목...>  (sudo) server | autodeploy | tunnel 데몬 등록 (--remove로 제거)
  deploy [--init] [SHA]      GitHub main의 커밋(기본 최신)을 배포. 평일 08~16시는 거부
  rollback                   이전 릴리스로 되돌리기 (자동 배포는 멈춤)
  autodeploy <status|dry-run|retry|pause|resume|run>
  status                     데몬·건강·릴리스·자동 배포 상태
  logs [server|autodeploy|tunnel]  마지막 기록 40줄
  tunnel-create              전용 cloudflared 터널 만들기 (cloudflared tunnel login 뒤)
EOF
}

as_svc() { (cd / && sudo -u "$GW_SERVICE_USER" -H "$@"); }

# 운영 스크립트는 gwsvc가 읽을 수 있는 곳에서 돌아야 한다(소유자 홈은 700). 저장소의 지금 판을 bootstrap에 복사한다.
refresh_bootstrap() {
  sudo -n -u "$GW_SERVICE_USER" true 2>/dev/null || gw_die "sudo 위임이 없습니다 — 먼저 sh ops/gw.sh setup-host"
  tar -C "$ops" -cf - scripts cloudflared | as_svc sh -c \
    'set -e; umask 077; mkdir -p "$1"; cd "$1"; rm -rf scripts cloudflared; tar -xf -' sh "$GW_BOOTSTRAP"
}

# 운영 릴리스의 스크립트를 쓰고, 첫 배포 전에는 bootstrap 사본을 쓴다(자동 배포 plist와 같은 규칙).
svc_script() {
  if as_svc test -f "$GW_APP/ops/macmini/scripts/$1"; then echo "$GW_APP/ops/macmini/scripts/$1"; else echo "$GW_BOOTSTRAP/scripts/$1"; fi
}

cmd="${1:-}"
[ $# -eq 0 ] || shift
case "$cmd" in
  setup-host) sudo sh "$ops/scripts/setup-host.sh" "$@" ;;
  install-daemons) sudo sh "$ops/scripts/install-daemons.sh" "$@" ;;
  deploy)
    init=""; sha=""
    for a in "$@"; do
      case "$a" in --init) init="--init" ;; -*) gw_die "알 수 없는 옵션: $a" ;; *) sha="$a" ;; esac
    done
    if [ -z "$sha" ]; then
      sha="$(git ls-remote "$GW_REPO_HTTPS" "refs/heads/$GW_DEPLOY_BRANCH" | awk 'NR == 1 {print $1}')"
      echo "GitHub $GW_DEPLOY_BRANCH 최신: $sha"
    fi
    refresh_bootstrap
    # 수동 배포는 저장소의 지금 스크립트(bootstrap)로 한다 — 스크립트를 고친 커밋을 처음 올릴 때도 그 판이 쓰인다.
    as_svc sh "$GW_BOOTSTRAP/scripts/deploy.sh" --sha "$sha" $init
    ;;
  rollback) as_svc sh "$(svc_script rollback.sh)" "$@" ;;
  autodeploy)
    m="${1:-status}"
    case "$m" in status|dry-run|retry|pause|resume|run) ;; *) usage >&2; exit 1 ;; esac
    as_svc sh "$(svc_script auto-deploy.sh)" "--$m"
    ;;
  status)
    echo "== 데몬"
    for l in com.ssamuniverse.gallery com.ssamuniverse.gallery.autodeploy com.ssamuniverse.gallery.tunnel; do
      if [ -f "/Library/LaunchDaemons/$l.plist" ]; then
        st="$(launchctl print "system/$l" 2>/dev/null | awk -F'= ' '/^\tstate/ {print $2; exit}')"
        # 자동 배포는 1분마다 깨어나 확인하고 끝나므로 평소에는 not running이 정상이다.
        case "$l:$st" in
          *.autodeploy:"not running") st="대기 중 — 1분마다 깨어나 확인" ;;
          *:running) st="실행 중" ;;
        esac
        echo "$l: 설치됨 (${st:-알 수 없음})"
      else
        echo "$l: 설치 안 됨"
      fi
    done
    echo "== 건강: http://127.0.0.1:$GW_PORT/api/health → $(gw_health_code "$GW_PORT")"
    if sudo -n -u "$GW_SERVICE_USER" true 2>/dev/null; then
      echo "== 릴리스: $(as_svc cat "$GW_STATE/current-release" 2>/dev/null || echo 없음) · 직전: $(as_svc cat "$GW_STATE/previous-release" 2>/dev/null || echo 없음)"
      as_svc sh "$(svc_script auto-deploy.sh)" --status || true
    else
      echo "(sudo 위임 전 — setup-host 를 먼저)"
    fi
    echo "== 부하: $(gw_load_summary) · 수업 시간: $(gw_is_school_hours && echo 예 || echo 아니오)"
    ;;
  logs)
    which="${1:-server}"
    case "$which" in server|autodeploy|tunnel) ;; *) usage >&2; exit 1 ;; esac
    as_svc tail -n 40 "$GW_LOGS/$which.log"
    ;;
  tunnel-create) refresh_bootstrap; sh "$ops/scripts/tunnel-create.sh" "$@" ;;
  -h|--help|help|"") usage ;;
  *) usage >&2; exit 1 ;;
esac
