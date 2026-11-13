#!/bin/sh
# 푸시 자동 배포(ADR-060) — launchd가 1분마다 gwsvc로 부른다. GitHub main을 끌어와(pull) 확인하고,
# CI(verify)를 통과한 새 커밋이면 deploy.sh로 배포한다. 맥미니는 들어오는 연결을 열지 않는다(웹훅·러너 없음).
# 운영 중인(건강 확인을 통과한) 릴리스의 이 스크립트가 돈다 — 검증 전 새 커밋의 배포 로직을 먼저 실행하지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/gw.sh autodeploy <status|dry-run|retry|pause|resume|run>
  status   운영 SHA·마지막 상태·실패 기록
  dry-run  조건·CI만 확인하고 배포 예정 커밋을 보여 줌(배포·기록 없음)
  retry    같은 커밋의 실패·CI 기록을 지우고 한 번 확인
  pause    멈춤(AUTO_DEPLOY_PAUSED)
  resume   다시 켬
  run      한 번 확인·배포(launchd 기본)
EOF
}

mode="${1:---run}"
case "$mode" in -h|--help|help) usage; exit 0 ;; esac
[ $# -le 1 ] || { usage >&2; exit 1; }
case "$mode" in --status|--dry-run|--retry|--pause|--resume|--run) ;; *) usage >&2; exit 1 ;; esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
cd /
gw_require_service_user autodeploy

failed_file="$GW_STATE/autodeploy-failed"
status_file="$GW_STATE/autodeploy-status"
ci_file="$GW_STATE/autodeploy-ci"

if [ "$mode" = "--status" ]; then
  echo "운영 SHA: $(cat "$GW_APP/.gw-commit" 2>/dev/null || echo 없음)"
  echo "자동 배포: $(cat "$status_file" 2>/dev/null || echo 기록 없음)"
  [ ! -e "$GW_PAUSED_FILE" ] || echo "일시정지 중: AUTO_DEPLOY_PAUSED"
  [ ! -s "$failed_file" ] || echo "실패 기록: $(cat "$failed_file")"
  exit 0
fi
mkdir -p "$GW_STATE" "$GW_LOGS"
case "$mode" in
  --pause) touch "$GW_PAUSED_FILE"; echo "자동 배포를 멈췄습니다"; exit 0 ;;
  --resume) rm -f "$GW_PAUSED_FILE"; echo "자동 배포를 켰습니다(다음 회차부터)"; exit 0 ;;
esac

status() {
  if [ "$mode" = "--dry-run" ]; then
    printf '%s\n' "$*"
  else
    printf '%s %s\n' "$(date '+%F %T')" "$*" > "$status_file.tmp"
    mv "$status_file.tmp" "$status_file"
  fi
}
wait_for() { status "$*"; exit 0; }

gw_lock autodeploy || { echo "다른 자동 배포 회차가 진행 중입니다"; exit 0; }
[ "$mode" != "--retry" ] || rm -f "$failed_file" "$ci_file"
[ ! -e "$GW_PAUSED_FILE" ] || wait_for "일시정지 중(AUTO_DEPLOY_PAUSED)"
[ -f "$GW_APP/.gw-commit" ] || wait_for "첫 배포 전 — sh ops/gw.sh deploy --init"
current="$(cat "$GW_APP/.gw-commit")"
gw_valid_sha "$current" || wait_for "운영 SHA 기록이 잘못되었습니다 — 수동 확인"
if [ -d "$GW_STATE/deploy.lock" ]; then
  holder="$(cat "$GW_STATE/deploy.lock/pid" 2>/dev/null || true)"
  if [ -z "$holder" ] || kill -0 "$holder" 2>/dev/null; then wait_for "다른 배포 또는 되돌리기가 진행 중"; fi
fi

export GIT_TERMINAL_PROMPT=0
git check-ref-format "refs/heads/$GW_DEPLOY_BRANCH" >/dev/null 2>&1 || gw_die "배포 브랜치 이름이 올바르지 않습니다"
remote_line="$(git ls-remote --exit-code "$GW_REPO_HTTPS" "refs/heads/$GW_DEPLOY_BRANCH" 2>/dev/null)" \
  || wait_for "원격 저장소 확인 실패 — 다음 회차에"
remote="$(printf '%s\n' "$remote_line" | awk 'NR == 1 {print $1}')"
gw_valid_sha "$remote" || wait_for "원격 SHA 확인 실패 — 다음 회차에"
short="$(printf '%s' "$remote" | cut -c1-8)"
[ "$remote" != "$current" ] || wait_for "최신 상태($short)"

fail_count=0
if [ -s "$failed_file" ]; then
  read -r failed_sha failed_count _rest < "$failed_file" || true
  if [ "${failed_sha:-}" = "$remote" ]; then
    case "${failed_count:-}" in 1|2) fail_count="$failed_count" ;; esac
  fi
fi
[ "$fail_count" -lt 2 ] || wait_for "중단: $short 실패 2회 — 고친 커밋을 푸시하거나 autodeploy retry"

[ -d "$GW_CACHE/objects" ] || git init -q --bare "$GW_CACHE"
git -C "$GW_CACHE" fetch -q --no-tags "$GW_REPO_HTTPS" "+refs/heads/$GW_DEPLOY_BRANCH:refs/autodeploy/candidate" 2>/dev/null \
  || wait_for "저장소 받기 실패 — 다음 회차에"
fetched="$(git -C "$GW_CACHE" rev-parse refs/autodeploy/candidate)"
[ "$fetched" = "$remote" ] || wait_for "확인 중 새 푸시 — 다음 회차에"
git -C "$GW_CACHE" cat-file -e "$current^{commit}" 2>/dev/null || wait_for "운영 커밋이 캐시에 없습니다 — 수동 배포 확인"

record_failure() {
  reason="$1"
  if [ "$2" = "final" ]; then count=2; else count=$((fail_count + 1)); fi
  [ "$mode" != "--dry-run" ] || wait_for "배포 거부: $reason"
  printf '%s %s %s\n' "$remote" "$count" "$reason" > "$failed_file.tmp"
  mv "$failed_file.tmp" "$failed_file"
  if [ "$count" -ge 2 ]; then status "중단: $short — $reason"; else status "실패 1회: $short — $reason (다음 회차에 다시)"; fi
}

if ! git -C "$GW_CACHE" merge-base --is-ancestor "$current" "$remote"; then
  record_failure "운영 커밋의 후손이 아님(강제 푸시·되감기) — 수동 배포 확인" final
  exit 0
fi

case "$GW_AUTODEPLOY_REQUIRE_CI" in 0|1) ;; *) gw_die "GW_AUTODEPLOY_REQUIRE_CI는 0 또는 1" ;; esac
if [ "$GW_AUTODEPLOY_REQUIRE_CI" = "1" ]; then
  now="$(date +%s)"
  ci_sha=""; ci_at=0; ci_result=pending
  [ ! -s "$ci_file" ] || read -r ci_sha ci_at ci_result < "$ci_file" || true
  case "$ci_at" in *[!0-9]*|"") ci_at=0 ;; esac
  # GitHub 익명 API 한도(시간당 60회, 같은 IP의 다른 앱과 나눔)를 지키려고 같은 SHA는 180초 간격으로만 묻는다.
  if [ "$ci_sha" != "$remote" ] || [ "$((now - ci_at))" -ge 180 ]; then
    ci_result=pending
    gw_mktemp_dir
    ci_json="$GW_TMP_DIR/check-runs.json"
    ci_ok=0
    if [ "${GW_OPS_TEST_MODE:-0}" = "1" ] && [ -n "${GW_AUTODEPLOY_CI_CMD:-}" ]; then
      if sh "$GW_AUTODEPLOY_CI_CMD" "$remote" > "$ci_json"; then ci_ok=1; fi
    elif curl -fsS --max-time 10 -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      "https://api.github.com/repos/$GW_GITHUB_REPO/commits/$remote/check-runs?check_name=verify" > "$ci_json" 2>/dev/null; then
      ci_ok=1
    fi
    if [ "$ci_ok" = "1" ]; then
      ci_result="$("$NODE_BIN" --input-type=module - "$ci_json" "$remote" <<'mjs'
import { readFileSync } from 'node:fs';
try {
  const body = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const runs = Array.isArray(body.check_runs)
    ? body.check_runs.filter(r => r && r.name === 'verify' && r.head_sha === process.argv[3] && r.app?.slug === 'github-actions')
    : [];
  runs.sort((a, b) => Number(b.id) - Number(a.id));
  const run = runs[0];
  const conclusion = run?.status === 'completed' ? run.conclusion : null;
  console.log(['success', 'failure', 'cancelled', 'timed_out'].includes(conclusion) ? conclusion : 'pending');
} catch {
  console.log('pending');
}
mjs
)"
    fi
    printf '%s %s %s\n' "$remote" "$now" "$ci_result" > "$ci_file.tmp"
    mv "$ci_file.tmp" "$ci_file"
  fi
  case "$ci_result" in
    success) ;;
    failure|cancelled|timed_out) record_failure "CI verify: $ci_result" final; exit 0 ;;
    *) wait_for "CI 기다리는 중($short)" ;;
  esac
fi

if [ "$mode" = "--dry-run" ]; then
  printf '배포 예정: %s → %s\n' "$current" "$remote"
  git -C "$GW_CACHE" log --max-count=20 --format='- %h %s' "$current..$remote"
  git -C "$GW_CACHE" diff --name-status "$current" "$remote" -- apps/server/src/store/migrations
  exit 0
fi
[ ! -e "$GW_PAUSED_FILE" ] || wait_for "일시정지 중(AUTO_DEPLOY_PAUSED)"
[ "$(cat "$GW_APP/.gw-commit" 2>/dev/null || true)" = "$current" ] || wait_for "운영 커밋이 바뀜 — 다음 회차에"

out="$GW_LOGS/autodeploy-run-$short.log"
status "배포 중: $short"
rc=0
if [ "${GW_OPS_TEST_MODE:-0}" = "1" ] && [ -n "${GW_AUTODEPLOY_DEPLOY_CMD:-}" ]; then
  GW_AUTODEPLOY_RUN=1 sh "$GW_AUTODEPLOY_DEPLOY_CMD" --sha "$remote" > "$out" 2>&1 || rc=$?
else
  GW_AUTODEPLOY_RUN=1 sh "$here/deploy.sh" --sha "$remote" > "$out" 2>&1 || rc=$?
fi
case "$rc" in
  0) rm -f "$failed_file"; status "최신 상태($short) — 자동 배포 완료"; echo "자동 배포 완료: $remote" ;;
  75) status "배포 대기($(sed -n 's/^ERROR: //p' "$out" | tail -n 1)) — 다음 회차에" ;;
  *)
    reason="$(sed -n 's/^ERROR: //p' "$out" | tail -n 1)"
    record_failure "${reason:-배포 실패($rc) — $out}" retry
    ;;
esac
ls -1t "$GW_LOGS"/autodeploy-run-*.log 2>/dev/null | tail -n +21 | while IFS= read -r old; do rm -f "$old"; done
exit 0
