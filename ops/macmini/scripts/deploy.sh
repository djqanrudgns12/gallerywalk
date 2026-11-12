#!/bin/sh
# 갤러리 운영 배포(서비스 계정 gwsvc, ADR-060) — GitHub main의 커밋 하나를 releases/<sha>로 만들어 검사한 뒤 바꿔 끼운다.
#
# 순서: 금지창·부하·잠금 확인 → main에 있는 커밋인지 확인 → npm ci + build → 사전 검사(운영 DB 사본에서 새 릴리스,
#       스키마가 같으면 이전 릴리스도 시작) → app 링크 교체 → 재시작 → 건강 확인 → 실패하면 이전 릴리스로 되돌리기.
# 안전장치: 평일 08~16시(KST)에는 우회 옵션 없이 거부(75). 다른 서비스의 포트·데몬은 건드리지 않는다.
# DB 마이그레이션은 서버가 시작할 때 스스로 한다(apps/server/src/index.ts). 새 판이 든 릴리스는 이전 코드가
# 새 스키마에서 시작을 거부하므로(db.ts migrate) 자동 되돌리기를 하지 않고 자동 배포를 멈춘다.
set -eu

usage() {
  cat <<'EOF'
사용법:
  sh ops/gw.sh deploy [--init] [40자 SHA]        (소유자, 기본은 GitHub main의 최신 커밋)
  sudo -u gwsvc -H sh deploy.sh --sha <40자 SHA> [--init]

  --sha <SHA>   배포할 커밋. GitHub main에 들어 있는 커밋만 받는다.
  --init        운영 DB(data/gallery.sqlite)가 아직 없을 때 첫 배포를 허용한다.
  --now         맥미니가 바빠도(부하·메모리 압박) 기다리지 않는다. 소유자 수동 배포 전용.
                수업 시간 금지는 그대로이고, 자동 배포에서는 쓸 수 없다.
  -h, --help    이 도움말.
종료 코드 75 = 지금은 할 수 없음(수업 시간·부하·다른 배포 중). 실패가 아니라 나중에 다시.
EOF
}

sha=""
allow_init=0
now=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
    --now) now=1; shift ;;
    --sha)
      [ $# -ge 2 ] || { echo "ERROR: --sha 뒤에 40자 SHA를 주세요" >&2; exit 1; }
      sha="$2"; shift 2 ;;
    --init) allow_init=1; shift ;;
    *) echo "ERROR: 알 수 없는 인자: $1 (금지창 우회 옵션은 없습니다. --help 참고)" >&2; exit 1 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user deploy
gw_valid_sha "$sha" || gw_die "--sha에 40자 소문자 SHA를 주세요"

if gw_is_school_hours; then
  echo "ERROR: 평일 08:00~16:00 KST(수업 시간)에는 배포하지 않습니다 (지금 $(TZ=Asia/Seoul date '+%F %T KST'))" >&2
  exit 75
fi
if [ "$now" = "1" ] && [ "${GW_AUTODEPLOY_RUN:-0}" = "1" ]; then
  gw_die "--now는 소유자 수동 배포에서만 쓸 수 있습니다"
fi
if gw_is_busy; then
  if [ "$now" = "1" ]; then
    echo "주의: 맥미니가 바쁘지만(--now) 기다리지 않고 진행합니다 ($(gw_load_summary))"
  else
    echo "ERROR: 맥미니가 바쁩니다($(gw_load_summary)) — 잠시 뒤 다시 (지금 하려면 sh ops/gw.sh deploy --now)" >&2
    exit 75
  fi
fi
if ! gw_lock deploy; then
  echo "ERROR: 다른 배포 또는 되돌리기가 진행 중입니다" >&2
  exit 75
fi
if [ "${GW_AUTODEPLOY_RUN:-0}" = "1" ] && [ -e "$GW_PAUSED_FILE" ]; then
  echo "ERROR: 자동 배포가 일시정지되어 있습니다" >&2
  exit 75
fi

[ -s "$GW_ENV_FILE" ] || gw_die "$GW_ENV_FILE 이 없습니다 — sh ops/gw.sh setup-host 를 먼저 실행하세요"
for key in $GW_REQUIRED_SECRETS; do
  grep -q "^${key}=." "$GW_ENV_FILE" || gw_die "$GW_ENV_FILE 에 $key 가 없습니다 (값은 표시하지 않음)"
done
if [ ! -f "$GW_DB_PATH" ] && [ "$allow_init" != "1" ]; then
  gw_die "운영 DB($GW_DB_PATH)가 없습니다. 첫 배포일 때만 --init 을 붙이세요"
fi

mkdir -p "$GW_RELEASES" "$GW_LOGS" "$GW_STATE" "$GW_DATA" "$GW_MEDIA" "$GW_TMP"
short="$(printf '%s' "$sha" | cut -c1-12)"
dest="$GW_RELEASES/$short"
log="$GW_LOGS/deploy-$short.log"
: > "$log"
say() { echo "$*" | tee -a "$log"; }

say "== 1/6 GitHub main 받기 ($short)"
export GIT_TERMINAL_PROMPT=0
[ -d "$GW_CACHE/objects" ] || git init -q --bare "$GW_CACHE"
git -C "$GW_CACHE" fetch -q --no-tags "$GW_REPO_HTTPS" "+refs/heads/$GW_DEPLOY_BRANCH:refs/deploy/main" \
  || gw_die "저장소 받기 실패 ($GW_REPO_HTTPS)"
git -C "$GW_CACHE" cat-file -e "$sha^{commit}" 2>/dev/null || gw_die "커밋이 없습니다: $sha"
git -C "$GW_CACHE" merge-base --is-ancestor "$sha" refs/deploy/main || gw_die "$GW_DEPLOY_BRANCH 에 없는 커밋은 배포하지 않습니다: $sha"

prev="$(readlink "$GW_APP" 2>/dev/null || true)"
if [ -d "$dest" ] && [ ! -f "$dest/.gw-build-ok" ] && [ "$prev" != "$dest" ]; then
  say "덜 만든 릴리스 폴더 정리: $dest"
  rm -rf "$dest"
fi
if [ ! -d "$dest" ]; then
  mkdir -p "$dest"
  git -C "$GW_CACHE" archive "$sha" | tar -x -C "$dest"
fi

say "== 2/6 의존성 설치·빌드 (로그: $GW_LOGS/build-$short.log)"
grep -Eq '^[[:space:]]*min-release-age[[:space:]]*=[[:space:]]*([7-9]|[1-9][0-9]+)' "$dest/.npmrc" 2>/dev/null \
  || gw_die ".npmrc 에 min-release-age=7(이상)이 없습니다"
if [ ! -f "$dest/.gw-build-ok" ]; then
  (
    cd "$dest"
    unset npm_config_min_release_age NPM_CONFIG_MIN_RELEASE_AGE
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 HUSKY=0 CI=1
    nice -n 10 npm ci --no-audit --no-fund
    nice -n 10 npm run build
  ) > "$GW_LOGS/build-$short.log" 2>&1 || gw_die "빌드 실패 — $GW_LOGS/build-$short.log (운영 서버·DB는 그대로)"
  [ -f "$dest/apps/server/dist/index.js" ] || gw_die "서버 빌드 산출물(apps/server/dist/index.js)이 없습니다"
  [ -f "$dest/apps/web/dist/index.html" ] || gw_die "웹 빌드 산출물(apps/web/dist/index.html)이 없습니다"
  [ "$(gw_migration_count "$dest")" -gt 0 ] || gw_die "빌드에 마이그레이션 파일이 없습니다"
  touch "$dest/.gw-build-ok"
fi

new_mig="$(gw_migration_count "$dest")"
prev_mig=0
[ -z "$prev" ] || prev_mig="$(gw_migration_count "$prev")"
schema_changed=0
[ -z "$prev" ] || [ "$new_mig" = "$prev_mig" ] || schema_changed=1
[ "$new_mig" -ge "$prev_mig" ] || gw_die "새 릴리스의 마이그레이션($new_mig)이 운영($prev_mig)보다 적습니다 — 되감긴 커밋?"

say "== 3/6 사전 검사 (운영 DB 사본, 포트 $GW_PRECHECK_PORT)"
if lsof -nP -iTCP:"$GW_PRECHECK_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: 사전 검사 포트 $GW_PRECHECK_PORT 가 쓰이는 중입니다" >&2
  exit 75
fi
gw_mktemp_dir
mkdir -p "$GW_TMP_DIR/data" "$GW_TMP_DIR/media" "$GW_TMP_DIR/tmp"
if [ -f "$GW_DB_PATH" ]; then
  # 온라인 백업 API로 일관된 사본을 만든다(WAL 포함). 사본은 이 스크립트가 끝나면 지운다.
  (cd "$dest/apps/server" && "$NODE_BIN" --input-type=module -e '
    import Database from "better-sqlite3";
    const src = new Database(process.argv[1], { readonly: true, fileMustExist: true });
    await src.backup(process.argv[2]);
    src.close();
  ' "$GW_DB_PATH" "$GW_TMP_DIR/data/gallery.sqlite") >> "$log" 2>&1 || gw_die "운영 DB 사본 만들기 실패"
fi

precheck_boot() {
  rel="$1"
  label="$2"
  (
    cd "$rel/apps/server"
    exec env -i HOME="$HOME" PATH="$PATH" NODE_ENV=production PORT="$GW_PRECHECK_PORT" \
      DATA_DIR="$GW_TMP_DIR/data" MEDIA_DIR="$GW_TMP_DIR/media" TMP_DIR="$GW_TMP_DIR/tmp" \
      WEB_DIR="$rel/apps/web/dist" \
      "$NODE_BIN" --env-file="$GW_ENV_FILE" dist/index.js
  ) >> "$log" 2>&1 &
  boot_pid=$!
  ok=0
  i=0
  while [ "$i" -lt 30 ]; do
    sleep 1
    kill -0 "$boot_pid" 2>/dev/null || break
    if [ "$(gw_health_code "$GW_PRECHECK_PORT")" = "200" ]; then ok=1; break; fi
    i=$((i + 1))
  done
  kill -TERM "$boot_pid" 2>/dev/null || true
  j=0
  while kill -0 "$boot_pid" 2>/dev/null && [ "$j" -lt 10 ]; do sleep 1; j=$((j + 1)); done
  kill -KILL "$boot_pid" 2>/dev/null || true
  wait "$boot_pid" 2>/dev/null || true
  [ "$ok" = "1" ] || { tail -n 15 "$log" >&2; gw_die "사전 검사 실패: $label 이(가) 시작하지 못했습니다 (운영은 그대로)"; }
  say "사전 검사 통과: $label"
}

precheck_boot "$dest" "새 릴리스 $short"
if [ -n "$prev" ] && [ -f "$prev/apps/server/dist/index.js" ]; then
  if [ "$schema_changed" = "0" ]; then
    precheck_boot "$prev" "이전 릴리스(같은 스키마)"
  else
    say "스키마가 $prev_mig → $new_mig 판으로 바뀝니다. 실패해도 자동으로 되돌릴 수 없어 자동 배포를 멈추게 됩니다"
  fi
fi

say "== 4/6 app 링크 바꾸기"
printf '%s\n' "$sha" > "$dest/.gw-commit.tmp"
mv "$dest/.gw-commit.tmp" "$dest/.gw-commit"
if [ -n "$prev" ] && [ "$prev" != "$dest" ]; then
  printf '%s\n' "$prev" > "$GW_STATE/previous-release.tmp"
  mv "$GW_STATE/previous-release.tmp" "$GW_STATE/previous-release"
fi
ln -sfn "$dest" "$GW_APP"
say "릴리스: ${prev:-(없음)} -> $dest"

finish() {
  printf 'releases/%s\n' "$short" > "$GW_STATE/current-release"
  printf '%s %s\n' "$sha" "$(date '+%F %T')" > "$GW_STATE/last-deploy"
  keep_prev="$(cat "$GW_STATE/previous-release" 2>/dev/null || true)"
  ls -1t "$GW_RELEASES" 2>/dev/null | tail -n +"$((GW_RELEASES_KEEP + 1))" | while IFS= read -r old; do
    [ -n "$old" ] || continue
    [ "$GW_RELEASES/$old" = "$dest" ] && continue
    [ "$GW_RELEASES/$old" = "$keep_prev" ] && continue
    rm -rf "${GW_RELEASES:?}/$old"
  done
  ls -1t "$GW_LOGS"/build-*.log "$GW_LOGS"/deploy-*.log 2>/dev/null | tail -n +21 | while IFS= read -r old; do rm -f "$old"; done
}

if [ ! -f "$GW_SERVER_PLIST" ]; then
  say "== 5/6 서버 데몬이 아직 없습니다 — 설치하면 이 릴리스로 시작합니다"
  finish
  echo "다음: sh ops/gw.sh install-daemons server"
  exit 0
fi

say "== 5/6 서버 재시작"
old_pid="$(gw_server_pid)"
gw_restart_server

say "== 6/6 건강 확인 (최대 60초)"
if gw_wait_restarted "$old_pid"; then
  finish
  say "배포 완료: releases/$short"
  exit 0
fi

echo "건강 확인 실패 — 서버 기록: $GW_DATA/logs/" >&2
if [ "$schema_changed" = "0" ] && [ -n "$prev" ] && [ "$prev" != "$dest" ] && [ -d "$prev" ]; then
  GW_ROLLBACK_FROM_DEPLOY=1 sh "$here/rollback.sh" --to "$prev" || true
  gw_die "새 릴리스($short)가 건강 확인을 통과하지 못해 이전 릴리스로 되돌렸습니다"
fi
touch "$GW_PAUSED_FILE"
gw_die "새 릴리스($short) 건강 확인 실패. 스키마가 바뀌었거나 이전 릴리스가 없어 자동으로 되돌리지 못했습니다. 자동 배포를 멈췄습니다 — docs/runbook.md '배포 실패'"
