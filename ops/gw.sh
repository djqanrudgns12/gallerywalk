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
  deploy [--init] [--now] [SHA]  GitHub main의 커밋(기본 최신)을 배포. 시간 제한 없음(2026-11-13 사용자 결정)
                             --now: 맥미니가 바빠도 기다리지 않음(수동 전용)
  rollback                   이전 릴리스로 되돌리기 (자동 배포는 멈춤)
  autodeploy <status|dry-run|retry|pause|resume|run>
  status                     데몬·건강·릴리스·자동 배포 상태
  logs [server|autodeploy|tunnel|watch]  마지막 기록 40줄
  tunnel-create              전용 cloudflared 터널 만들기 (cloudflared tunnel login 뒤)
  origin-secret              원본 잠금 값(64자)을 만들거나 그대로 두고 클립보드로 복사(화면에 안 냄)
  start-code [--status]      전시 만들기 시작 코드(숫자 6~32자리)를 숨김 입력으로 받아 HMAC만 저장
  heartbeat                  하트비트 한 번 돌려 보기(로컬·공개·뒷문 점검)
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
    init=""; now=""; sha=""
    for a in "$@"; do
      case "$a" in --init) init="--init" ;; --now) now="--now" ;; -*) gw_die "알 수 없는 옵션: $a" ;; *) sha="$a" ;; esac
    done
    if [ -z "$sha" ]; then
      sha="$(git ls-remote "$GW_REPO_HTTPS" "refs/heads/$GW_DEPLOY_BRANCH" | awk 'NR == 1 {print $1}')"
      echo "GitHub $GW_DEPLOY_BRANCH 최신: $sha"
    fi
    refresh_bootstrap
    # 수동 배포는 저장소의 지금 스크립트(bootstrap)로 한다 — 스크립트를 고친 커밋을 처음 올릴 때도 그 판이 쓰인다.
    as_svc sh "$GW_BOOTSTRAP/scripts/deploy.sh" --sha "$sha" $init $now
    ;;
  rollback) as_svc sh "$(svc_script rollback.sh)" "$@" ;;
  autodeploy)
    m="${1:-status}"
    case "$m" in status|dry-run|retry|pause|resume|run) ;; *) usage >&2; exit 1 ;; esac
    as_svc sh "$(svc_script auto-deploy.sh)" "--$m"
    ;;
  status)
    echo "== 데몬"
    for l in com.ssamuniverse.gallery com.ssamuniverse.gallery.autodeploy com.ssamuniverse.gallery.tunnel com.ssamuniverse.gallery.watch; do
      if [ -f "/Library/LaunchDaemons/$l.plist" ]; then
        st="$(launchctl print "system/$l" 2>/dev/null | awk -F'= ' '/^\tstate/ {print $2; exit}')"
        # 자동 배포는 1분마다 깨어나 확인하고 끝나므로 평소에는 not running이 정상이다.
        case "$l:$st" in
          *.autodeploy:"not running"|*.watch:"not running") st="대기 중 — 1분마다 깨어나 확인" ;;
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
      echo "하트비트: $(as_svc cat "$GW_STATE/heartbeat-status" 2>/dev/null || echo 기록 없음) · AWS 감시 자격 증명: $(as_svc test -s "$GW_SECRETS/aws-macmini-credentials" && echo 있음 || echo 없음)"
    else
      echo "(sudo 위임 전 — setup-host 를 먼저)"
    fi
    echo "== 부하: $(gw_load_summary) · 수업 시간: $(gw_is_school_hours && echo 예 || echo 아니오)"
    ;;
  logs)
    which="${1:-server}"
    case "$which" in server|autodeploy|tunnel|watch) ;; *) usage >&2; exit 1 ;; esac
    as_svc tail -n 40 "$GW_LOGS/$which.log"
    ;;
  heartbeat) refresh_bootstrap; as_svc sh "$GW_BOOTSTRAP/scripts/heartbeat.sh" ;;
  tunnel-create) refresh_bootstrap; sh "$ops/scripts/tunnel-create.sh" "$@" ;;
  start-code)
    refresh_bootstrap
    if [ "${1:-}" = "--status" ]; then
      as_svc sh "$GW_BOOTSTRAP/scripts/start-code.sh" --status
      exit 0
    fi
    [ $# -eq 0 ] || gw_die "코드는 인자로 받지 않습니다(ps·기록에 남음) — sh ops/gw.sh start-code 로 숨김 입력"
    if [ -t 0 ]; then
      # 화면에 보이지 않게 두 번 받는다. 중간에 끊겨도 입력 표시는 되살린다.
      trap 'stty echo 2>/dev/null || true' EXIT INT TERM
      printf '새 시작 코드(숫자 6~32자리, 화면에 안 보임): '
      stty -echo; IFS= read -r c1; stty echo; echo
      printf '한 번 더: '
      stty -echo; IFS= read -r c2; stty echo; echo
      [ "$c1" = "$c2" ] || { c1=""; c2=""; gw_die "두 번 입력한 코드가 다릅니다"; }
      c2=""
    else
      IFS= read -r c1 || true
    fi
    printf '%s\n' "$c1" | as_svc sh "$GW_BOOTSTRAP/scripts/start-code.sh"
    c1=""
    ;;
  origin-secret)
    # CloudFront 원본 머리(x-gw-origin-auth)와 Cloudflare WAF 식(gw-origin-lock)에만 들어가는 값. 서버는 몰라도 된다.
    # 소유자 전용 폴더에 두고, 화면·기록에는 내지 않고 클립보드로만 건넨다. 있으면 바꾸지 않는다.
    case "$(id -un)" in root|gwsvc|clsvc|rtsvc|wesvc) gw_die "소유자 계정에서 실행하세요" ;; esac
    admin="$HOME/.gallerywalk-admin"
    file="$admin/cloudfront-origin-secret"
    (umask 077; mkdir -p "$admin")
    chmod 700 "$admin"
    if [ ! -s "$file" ]; then
      (umask 077; openssl rand -hex 32 > "$file.tmp")
      [ "$(tr -d '\n' < "$file.tmp" | wc -c | tr -d ' ')" = "64" ] || { rm -f "$file.tmp"; gw_die "값 만들기 실패"; }
      mv "$file.tmp" "$file"
      echo "새 원본 잠금 값을 만들었습니다: $file (600)"
    else
      echo "기존 원본 잠금 값을 그대로 씁니다: $file"
    fi
    chmod 600 "$file"
    tr -d '\n' < "$file" | pbcopy
    echo "클립보드에 복사했습니다(64자, 화면에는 표시하지 않음). 붙여 넣은 뒤 다른 것을 복사해 지우세요."
    ;;
  -h|--help|help|"") usage ;;
  *) usage >&2; exit 1 ;;
esac
