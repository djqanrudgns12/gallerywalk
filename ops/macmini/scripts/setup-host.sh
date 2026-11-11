#!/bin/sh
# 맥미니 호스트 준비(관리자 권한 1회, 다시 실행해도 안전) — 전용 계정 gwsvc·sudo 위임·서버 폴더·
# Time Machine 제외(30일 삭제 약속, ADR-003)·로그 회전·비밀값을 준비한다.
# 안전장치: 쌤유니버스(clsvc)·rollingthunder(rtsvc)·글방(wesvc)·Colima·방화벽·FileVault는 건드리지 않는다.
set -eu

case "${1:-}" in
  -h|--help|help)
    cat <<'EOF'
사용법: sh ops/gw.sh setup-host   (= sudo sh ops/macmini/scripts/setup-host.sh)

전용 서비스 계정(gwsvc, 비관리자·숨김), sudo 위임(/etc/sudoers.d/gallerywalk, 소유자 → gwsvc만),
서버 폴더(/Users/gwsvc/gallery-server, 700), Time Machine 제외, 로그 회전, 운영 비밀값을 준비합니다.
기존 데이터·비밀값은 덮어쓰지 않습니다.
EOF
    exit 0 ;;
  "") ;;
  *) echo "ERROR: 알 수 없는 인자: $* (--help 참고)" >&2; exit 1 ;;
esac

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

[ "$(id -u)" = "0" ] || die "관리자 권한이 필요합니다: sh ops/gw.sh setup-host"
owner="${SUDO_USER:-}"
[ -n "$owner" ] || die "SUDO_USER가 없습니다 — 소유자 계정에서 sudo로 실행하세요"
case "$owner" in root|clsvc|rtsvc|wesvc|gwsvc) die "소유자 계정에서 실행하세요 (지금 SUDO_USER=$owner)" ;; esac

svc=gwsvc
svc_home="/Users/$svc"
gw_home="$svc_home/gallery-server"
here="$(cd "$(dirname "$0")" && pwd -P)"
ops_root="$(cd "$here/.." && pwd -P)"
tool_path="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
as_svc() { sudo -u "$svc" -H env PATH="$tool_path" "$@"; }
cd /

step "0. 도구 확인 (설치·업그레이드는 하지 않음)"
node_bin="/opt/homebrew/opt/node@24/bin/node"
[ -x "$node_bin" ] || node_bin="$(PATH="$tool_path" command -v node 2>/dev/null || true)"
[ -n "$node_bin" ] && [ -x "$node_bin" ] || die "Node 24가 없습니다"
[ "$("$node_bin" -p 'process.versions.node.split(".")[0]')" = "24" ] || die "Node 24가 필요합니다 (지금 $("$node_bin" -v))"
for tool in npm git openssl curl plutil tmutil lsof; do
  PATH="$tool_path" command -v "$tool" >/dev/null 2>&1 || die "도구가 없습니다: $tool"
done
echo "Node $("$node_bin" -v) · git · openssl · tmutil 확인"

step "1. 전용 서비스 계정 $svc (비관리자·숨김)"
if id "$svc" >/dev/null 2>&1; then
  echo "이미 있음: $svc"
else
  sysadminctl -addUser "$svc" -fullName "Gallery Service" -shell /usr/bin/false \
    -home "$svc_home" -password "$(openssl rand -base64 33)" >/dev/null 2>&1 || die "계정 만들기 실패: $svc"
  createhomedir -c -u "$svc" >/dev/null 2>&1 || true
  echo "계정 만듦: $svc (비밀번호는 무작위로 만들고 버림)"
fi
dscl . -create "/Users/$svc" IsHidden 1
if dseditgroup -o checkmember -m "$svc" admin >/dev/null 2>&1; then
  die "$svc 가 admin 그룹에 있습니다 — 중단"
fi
[ -d "$svc_home" ] || mkdir -p "$svc_home"
chown "$svc":staff "$svc_home"
chmod 700 "$svc_home"

step "2. sudo 위임 ($owner → $svc 만, root 아님)"
sudoers=/etc/sudoers.d/gallerywalk
printf '# gallerywalk: 소유자가 서비스 계정(%s)으로만 운영 명령 실행 (root 아님)\n%s ALL=(%s) NOPASSWD: ALL\n' \
  "$svc" "$owner" "$svc" > "$sudoers.tmp"
visudo -cf "$sudoers.tmp" >/dev/null || { rm -f "$sudoers.tmp"; die "sudoers 문법 검사 실패"; }
chown root:wheel "$sudoers.tmp"
chmod 440 "$sudoers.tmp"
mv "$sudoers.tmp" "$sudoers"
echo "등록: $sudoers"

step "3. 서버 폴더 $gw_home (700)"
for sub in "" data media tmp secrets cloudflared logs state releases bootstrap; do
  as_svc mkdir -p "$gw_home/$sub"
  as_svc chmod 700 "$gw_home/$sub"
done
rm -rf "$gw_home/bootstrap/scripts" "$gw_home/bootstrap/cloudflared"
cp -R "$ops_root/scripts" "$gw_home/bootstrap/scripts"
cp -R "$ops_root/cloudflared" "$gw_home/bootstrap/cloudflared"
chown -R "$svc":staff "$gw_home/bootstrap"
chmod -R u=rwX,go= "$gw_home/bootstrap"
echo "폴더·bootstrap 스크립트 준비"

step "4. Time Machine 제외 (백업하지 않음 — 30일 삭제 약속)"
tmutil addexclusion -p "$gw_home"
tm="$(tmutil isexcluded "$gw_home")"
echo "$tm"
case "$tm" in *"[Excluded]"*) ;; *) die "Time Machine 제외 확인 실패" ;; esac

step "5. 로그 회전 (/etc/newsyslog.d/gallerywalk.conf — 날마다·7개·10MB)"
cat > /etc/newsyslog.d/gallerywalk.conf.tmp <<EOF
# gallerywalk 운영 스크립트·launchd 로그 회전 (앱 기록은 서버가 DATA_DIR/logs에서 직접 돌린다)
# logfilename                          [owner:group] mode count size(KB) when flags
$gw_home/logs/*.log                    $svc:staff    600  7     10240    24   GNZ
EOF
chown root:wheel /etc/newsyslog.d/gallerywalk.conf.tmp
chmod 644 /etc/newsyslog.d/gallerywalk.conf.tmp
mv /etc/newsyslog.d/gallerywalk.conf.tmp /etc/newsyslog.d/gallerywalk.conf
echo "등록: /etc/newsyslog.d/gallerywalk.conf"

step "6. 운영 비밀값 (있으면 그대로)"
as_svc sh "$gw_home/bootstrap/scripts/init-secrets.sh"

step "완료"
echo "다음 (평일 16시 이후): sh ops/gw.sh deploy --init"
