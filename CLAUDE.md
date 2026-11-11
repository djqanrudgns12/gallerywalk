@AGENTS.md

## Claude 전용

- 나는 통합 담당이다. 맡긴 결과는 동료 보고로 보고, diff·파일·시험 실행·화면 캡처로 직접 확인한 뒤 받아들인다(PLAN §16.4).
- 위임은 PLAN §16.3 본문 틀과 `docs/briefs/`를 쓴다. 보내기 전에 `agent-bridge status`와 `resource-guard status`를 본다. 다른 에이전트 작업은 동시에 둘까지.
- phase를 끝낼 때 PLAN §15의 끝 조건과 PRD 15장으로 스스로 검수하고, 누가 무엇을 했는지와 실행하지 않은 검사를 보고한다.
- 설계를 바꾸면 `docs/decisions.md`에 ADR을 남기고, PRD와 어긋나면 PRD를 기준으로 PLAN을 고친다. `[고정]` 해석이 필요하면 `docs/USER_DECISIONS.md`에 올린다.
- 3D 화면은 숫자(fps·MB·그리기 호출)와 캡처를 함께 본다. "보기 좋다"는 판단은 사용자 승인(U-07)과 Antigravity 비평으로 확인한다.
