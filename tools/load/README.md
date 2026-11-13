# 동시 입장 부하 도구 (V-31)

기본은 **네트워크와 파일 쓰기가 없는 dry-run**이다. 대상은 원문 주소 `http://127.0.0.1:4521`만 허용한다. 운영 4520·공개 주소·다른 앱은 허용하지 않는다. 새 의존성을 쓰지 않는다.

```bash
node --conditions=@gallery/source tools/load/admission.mjs --clients 21
node --conditions=@gallery/source tools/load/admission.mjs --clients 30
```

실측은 사용자가 고른 **합성 그림이 있는 개발 전시**에만 한다. 이번 F9에서는 실행하지 않는다. 아래 `123456`은 예시이며 실제 합성 전시 입장 코드로 바꾼다. 21대와 30대는 차례로 실행한다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 560 -- node --conditions=@gallery/source tools/load/admission.mjs --clients 21 --entry-code 123456 --execute
```

각 기기는 동시에 공개 전시 조회 → 방문자 등록 → 웹소켓 hello를 보낸다. 첫 관의 썸네일·벽용·소리·배경음악은 기기 안에서 차례로 받는다. 모든 연결이 준비되면 기본 10초간 `LIVE_POSE_HZ`에 맞춰 위치를 보내고, 모든 기기가 다른 기기 전부와 위치 방송을 받았는지 확인한다. `--duration-seconds`로 시간을 정하며 상한은 `LIVE_IDLE_TIMEOUT_SEC`이다. HTTP·소켓 재시도는 하지 않는다. 만든 연결만 정리한다.

기록은 `.local/perf/admission-load.jsonl`이다. HTTP 조회·등록·미디어와 소켓 연결의 p50·p95·오류율·본문 바이트, 함께 관람 수와 수신 방송 수를 남긴다. 토큰·별명·입장 코드·원본 응답은 쓰지 않는다. 요청 실패도 지연 분포에 포함한다. `passed:false`면 종료값 1이다.

이 도구의 성공은 서버 프로토콜 부하를 확인한다. 공유 학교 와이파이·CDN·태블릿 21대의 그리기·입장 후 4초는 사용자 실측(P7-3·U-05·U-16)으로 따로 확인한다. 빈 CDN·데운 CDN 측정도 미실행이다.

관련 시험:

```bash
node --conditions=@gallery/source --test tools/load/admission.test.mjs tests/e2e/support/receivedBytes.test.mjs
```

운영 웹 빌드 e2e(V-30·V-34): 4521·4522가 사용 중이면 기존 서버를 건드리지 않고 중단한다. `npm run build` 1회 뒤 개발 서버가 `WEB_DIR=apps/web/dist`를 제공한다. 별도 `.local/prod-e2e/` 합성 DB·미디어를 사용하고 테스트가 소유한 서버만 Playwright가 정리한다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 560 -- node tests/e2e/support/run-prod.mjs
```

같은 산출물을 의도적으로 재사용할 때만 `--skip-build`를 붙인다. 빌드 지문은 `sw.js` SHA-256으로 기록한다. 첫 받기는 새 context에서 HTTP 캐시를 끄고 SW 자체 수신까지 합산하며, 입장 완료 전에 시작한 응답은 끝까지 세는 보수적 상계다. SW가 페이지에 돌려준 응답은 중복 계산하지 않는다. 응답 머리·음악·입장까지 받은 웹소켓 본문도 6MB 단언에 포함한다. 수치 확인 실패·미완료 요청은 성공으로 처리하지 않는다. 기록은 `.local/perf/prod-first-receive.jsonl`, 캡처는 `.local/screens/prod/`에 남긴다. 학교망 4초 목표는 단언하지 않는다.
