#!/bin/sh
# 갤러리 운영 되돌리기(서비스 계정 gwsvc) — app 링크를 이전 릴리스로 바꾸고 재시작·건강 확인.
# 수업 중 사고 대응용이라 금지창에도 할 수 있다. DB는 되돌리지 않으므로, 대상 릴리스가 지금 스키마를
# 모르면(마이그레이션 수가 적으면) 서버가 시작을 거부하므로 미리 거부한다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/gw.sh rollback            (state/previous-release로)
        sudo -u gwsvc -H sh rollback.sh [--to <릴리스 폴더>]
EOF
}

target=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
    --to) [ $# -ge 2 ] || { usage >&2; exit 1; }; target="$2"; shift 2 ;;
    *) usage >&2; exit 1 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user rollback

# 배포 스크립트가 부를 때는 부모가 deploy 잠금을 쥐고 있다.
if [ "${GW_ROLLBACK_FROM_DEPLOY:-0}" != "1" ]; then
  gw_lock deploy || { echo "ERROR: 다른 배포 또는 되돌리기가 진행 중입니다" >&2; exit 75; }
fi

current="$(readlink "$GW_APP" 2>/dev/null || true)"
[ -n "$target" ] || target="$(cat "$GW_STATE/previous-release" 2>/dev/null || true)"
[ -n "$target" ] || gw_die "되돌릴 이전 릴리스 기록이 없습니다"
case "$target" in "$GW_RELEASES"/*) ;; *) gw_die "릴리스 폴더가 아닙니다: $target" ;; esac
[ -f "$target/.gw-build-ok" ] && [ -f "$target/.gw-commit" ] || gw_die "완성된 릴리스가 아닙니다: $target"
[ "$target" != "$current" ] || gw_die "이미 그 릴리스입니다: $target"

if [ -n "$current" ]; then
  cur_mig="$(gw_migration_count "$current")"
  tgt_mig="$(gw_migration_count "$target")"
  [ "$tgt_mig" -ge "$cur_mig" ] || gw_die "대상 릴리스는 스키마 $tgt_mig 판까지만 압니다(지금 DB는 $cur_mig 판). 서버가 시작을 거부하므로 되돌리지 않습니다 — 고친 커밋을 새로 배포하세요"
fi

ln -sfn "$target" "$GW_APP"
[ -z "$current" ] || { printf '%s\n' "$current" > "$GW_STATE/previous-release.tmp"; mv "$GW_STATE/previous-release.tmp" "$GW_STATE/previous-release"; }
echo "되돌리기: ${current:-(없음)} -> $target"

if [ -f "$GW_SERVER_PLIST" ]; then
  old_pid="$(gw_server_pid)"
  gw_restart_server
  gw_wait_restarted "$old_pid" || gw_die "되돌린 릴리스도 건강 확인을 통과하지 못했습니다 — sh ops/gw.sh status, 서버 기록 확인"
fi
printf 'releases/%s\n' "$(basename "$target")" > "$GW_STATE/current-release"
printf '%s %s rollback\n' "$(cat "$target/.gw-commit")" "$(date '+%F %T')" > "$GW_STATE/last-deploy"
echo "되돌리기 완료: $target"
# 손으로 되돌렸으면 다음 회차 자동 배포가 같은 커밋을 다시 올리지 않게 멈춘다.
if [ "${GW_ROLLBACK_FROM_DEPLOY:-0}" != "1" ]; then
  touch "$GW_PAUSED_FILE"
  echo "자동 배포를 멈췄습니다. 고친 커밋을 푸시한 뒤: sh ops/gw.sh autodeploy resume"
fi
