#!/bin/sh
# 갤러리 전용 cloudflared 터널 만들기(소유자 계정, 1회) — Cloudflare 계정에 터널 'gallerywalk'를 만들고
# 자격 증명을 gwsvc의 cloudflared/(600)로 옮겨 config.yml을 쓴다.
# DNS 연결(origin-gallery)은 하지 않는다: Cloudflare WAF 규칙(원본 비밀 머리 없으면 403)을 먼저 건 뒤
# docs/runbook.md 순서대로 따로 한다. 그 전까지는 바깥에서 이 터널로 들어올 주소가 없다.
set -eu

case "${1:-}" in
  -h|--help|help) echo "사용법: sh ops/gw.sh tunnel-create   (먼저 cloudflared tunnel login 이 되어 있어야 함)"; exit 0 ;;
  "") ;;
  *) echo "ERROR: 알 수 없는 인자: $1" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
case "$(id -un)" in root|gwsvc|clsvc|rtsvc|wesvc) gw_die "소유자 계정에서 실행하세요" ;; esac
command -v cloudflared >/dev/null 2>&1 || gw_die "cloudflared가 없습니다"
[ -s "$HOME/.cloudflared/cert.pem" ] || gw_die "Cloudflare 로그인이 필요합니다: cloudflared tunnel login (브라우저에서 ssamuniverse.com 선택)"
sudo -n -u "$GW_SERVICE_USER" true 2>/dev/null || gw_die "sudo 위임이 없습니다 — sh ops/gw.sh setup-host 먼저"

id_of() { cloudflared tunnel list --name "$GW_TUNNEL_NAME" --output json 2>/dev/null | "$NODE_BIN" -e '
  let s = ""; process.stdin.on("data", c => (s += c)).on("end", () => {
    try { const t = JSON.parse(s).find(x => x.name === process.argv[1] && !x.deleted_at); if (t) console.log(t.id); } catch {}
  });' "$GW_TUNNEL_NAME"; }

tid="$(id_of)"
if [ -z "$tid" ]; then
  cloudflared tunnel create "$GW_TUNNEL_NAME" >/dev/null
  tid="$(id_of)"
  echo "터널 만듦: $GW_TUNNEL_NAME ($tid)"
else
  echo "이미 있음: $GW_TUNNEL_NAME ($tid)"
fi
case "$tid" in *[!0-9a-f-]*|"") gw_die "터널 ID를 읽지 못했습니다" ;; esac

creds="$HOME/.cloudflared/$tid.json"
[ -s "$creds" ] || gw_die "자격 증명 파일이 이 기기에 없습니다($creds). 다른 기기에서 만든 터널이면 그 파일을 옮기세요"

cd /
sudo -u "$GW_SERVICE_USER" -H sh -c 'umask 077; cat > "$1"' sh "$GW_CLOUDFLARED/$tid.json" < "$creds"
sed -e "s/__TUNNEL_ID__/$tid/g" -e "s/__GW_USER__/$GW_SERVICE_USER/g" "$here/../cloudflared/config.template.yml" \
  | sudo -u "$GW_SERVICE_USER" -H sh -c 'umask 077; cat > "$1"' sh "$GW_CLOUDFLARED/config.yml"
rm -f "$creds"
echo "gwsvc로 옮김: $GW_CLOUDFLARED/config.yml, $tid.json (소유자 사본은 지움)"
echo "다음: Cloudflare WAF 규칙 → sh ops/gw.sh install-daemons tunnel → DNS 연결 (docs/runbook.md)"
