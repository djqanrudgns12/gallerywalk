#!/bin/sh
# 갤러리 launchd 시스템 데몬 설치·제거(관리자 권한). com.ssamuniverse.gallery* 네 개만 다룬다 —
# 쌤유니버스의 다른 com.ssamuniverse.* 데몬, net.rollinthunder.*, com.ssamwrite.*는 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/gw.sh install-daemons <server|autodeploy|tunnel|watch ...>
        sh ops/gw.sh install-daemons --remove <server|autodeploy|tunnel|watch ...>

  server      com.ssamuniverse.gallery            운영 서버 127.0.0.1:4520 (KeepAlive)
  autodeploy  com.ssamuniverse.gallery.autodeploy 1분마다 main 확인·CI 통과 커밋 배포 (첫 배포 뒤)
  tunnel      com.ssamuniverse.gallery.tunnel     전용 cloudflared 터널 (메트릭 20243, tunnel-create 뒤)
  watch       com.ssamuniverse.gallery.watch      1분 하트비트(로컬·공개·뒷문 점검 → CloudWatch)
EOF
}

case "${1:-}" in -h|--help|help|"") usage; [ $# -eq 0 ] && exit 1 || exit 0 ;; esac
die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || die "관리자 권한이 필요합니다: sh ops/gw.sh install-daemons $*"

svc=gwsvc
id "$svc" >/dev/null 2>&1 || die "서비스 계정 $svc 가 없습니다 — sh ops/gw.sh setup-host 먼저"
gw_home="/Users/$svc/gallery-server"
src="$(cd "$(dirname "$0")/../launchd" && pwd -P)"

remove=0
if [ "${1:-}" = "--remove" ]; then remove=1; shift; fi
[ $# -gt 0 ] || die "항목을 주세요: server | autodeploy | tunnel | watch"
for name in "$@"; do
  case "$name" in server|autodeploy|tunnel|watch) ;; *) die "알 수 없는 항목: '$name'" ;; esac
done

label_of() {
  case "$1" in
    server) echo com.ssamuniverse.gallery ;;
    autodeploy) echo com.ssamuniverse.gallery.autodeploy ;;
    tunnel) echo com.ssamuniverse.gallery.tunnel ;;
    watch) echo com.ssamuniverse.gallery.watch ;;
  esac
}

if [ "$remove" = "0" ]; then
  for name in "$@"; do
    case "$name" in
      server)
        [ -s "$gw_home/secrets/app.env" ] || die "secrets/app.env 가 없습니다 — setup-host 먼저"
        [ -f "$gw_home/app/apps/server/dist/index.js" ] || die "배포된 앱이 없습니다 — sh ops/gw.sh deploy --init 먼저" ;;
      autodeploy|watch)
        [ -f "$gw_home/app/.gw-commit" ] || die "첫 배포 전입니다 — sh ops/gw.sh deploy --init 먼저" ;;
      tunnel)
        [ -s "$gw_home/cloudflared/config.yml" ] || die "cloudflared/config.yml 이 없습니다 — sh ops/gw.sh tunnel-create 먼저" ;;
    esac
  done
fi

for name in "$@"; do
  label="$(label_of "$name")"
  plist="/Library/LaunchDaemons/$label.plist"
  if [ "$remove" = "1" ]; then
    launchctl bootout system "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "제거: $label"
    continue
  fi
  template="$src/$label.plist"
  [ -f "$template" ] || die "템플릿이 없습니다: $template"
  sed "s/__GW_USER__/$svc/g" "$template" > "$plist.tmp"
  chown root:wheel "$plist.tmp"
  chmod 644 "$plist.tmp"
  plutil -lint "$plist.tmp" >/dev/null || { rm -f "$plist.tmp"; die "plist 검사 실패: $label"; }
  launchctl bootout system "$plist" >/dev/null 2>&1 || true
  mv "$plist.tmp" "$plist"
  launchctl bootstrap system "$plist"
  echo "설치: $label ($svc)"
done
launchctl list | grep 'com\.ssamuniverse\.gallery' || true
