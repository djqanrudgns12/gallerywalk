#!/bin/sh
# 전시 만들기 시작 코드 저장(서비스 계정 gwsvc, ADR-048, PLAN §11.3·U-17).
# 표준 입력 첫 줄의 숫자 코드를 받아 HMAC(START_CODE_HMAC, 코드)만 운영 DB meta.start_code_hmac에 넣는다.
# 원문은 저장·표시·기록하지 않고, 명령줄 인자로도 받지 않는다(ps에 보이므로). 서버 재시작은 필요 없다.
# 비밀값 해석은 서버와 같은 loadEnv(dist/env.js)를 써서 어긋날 수 없게 한다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/gw.sh start-code          (소유자, 숨김 입력 두 번)
        sh ops/gw.sh start-code --status (저장돼 있는지만)
        printf '%s\n' <코드> | sudo -u gwsvc -H sh start-code.sh   (표준 입력으로만)
코드: 숫자 6~32자리. 바꾸면 새 코드부터 맞고, 이미 코드를 맞힌 기기는 계속 묻지 않는다.
EOF
}

mode=set
case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  --status) mode=status ;;
  "") ;;
  *) usage >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user start-code

server_dir="$GW_APP/apps/server"
[ -f "$server_dir/dist/security/startCode.js" ] || gw_die "배포된 릴리스가 없습니다 — sh ops/gw.sh deploy --init 먼저"
[ -f "$GW_DB_PATH" ] || gw_die "운영 DB가 없습니다 — 서버를 한 번 시작한 뒤 다시"
[ -s "$GW_ENV_FILE" ] || gw_die "$GW_ENV_FILE 이 없습니다"

code=""
if [ "$mode" = "set" ]; then
  IFS= read -r code || true
  case "$code" in
    *[!0-9]*|"") gw_die "시작 코드는 숫자만 받습니다" ;;
  esac
  [ "${#code}" -ge 6 ] && [ "${#code}" -le 32 ] || gw_die "시작 코드는 6~32자리 숫자여야 합니다"
fi

cd "$server_dir"
printf '%s\n' "$code" | env -i HOME="$HOME" PATH="$PATH" NODE_ENV=production PORT="$GW_PORT" \
  DATA_DIR="$GW_DATA" MEDIA_DIR="$GW_MEDIA" TMP_DIR="$GW_TMP" GW_MODE="$mode" \
  "$NODE_BIN" --env-file="$GW_ENV_FILE" --input-type=module -e '
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dist = p => pathToFileURL(join(process.cwd(), "dist", p)).href;
const { loadEnv } = await import(dist("env.js"));
const { openDb } = await import(dist("store/db.js"));
const { storeStartCode, readStartCodeDigest, startCodeMatches } = await import(dist("security/startCode.js"));
const env = loadEnv(process.env);
const db = openDb(join(env.dataDir, "gallery.sqlite"), { busyTimeoutMs: 5000 });
try {
  if (process.env.GW_MODE === "status") {
    console.log(readStartCodeDigest(db) === null ? "시작 코드: 없음 (지금은 누구도 전시를 만들 수 없음)" : "시작 코드: 저장돼 있음");
  } else {
    const code = readFileSync(0, "utf8").split("\n")[0];
    storeStartCode(db, env.secrets.startCodeHmac, code);
    // 서버가 확인하는 길(startCodeMatches)로 다시 맞춰 본다
    if (!startCodeMatches(env.secrets.startCodeHmac, readStartCodeDigest(db), code)) throw new Error("저장 뒤 확인 실패");
    console.log("시작 코드를 저장했습니다 (원문은 저장·표시하지 않음, 서버 재시작 필요 없음)");
  }
} finally {
  db.close();
}
'
code=""
