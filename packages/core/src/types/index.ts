/**
 * 서버·화면이 함께 쓰는 타입과 zod 스키마(P2-1, PLAN §3). 바깥 입력(HTTP·기기 저장·파일 메타데이터)은 여기 스키마로 검사한다.
 * 도메인 코드(`domain/**`)는 여기서 **타입만** 가져온다(`import type`) — 도메인은 zod를 실행하지 않는다.
 */

export * from './common.ts';
export * from './text.ts';
export * from './settings.ts';
export * from './media.ts';
export * from './layout.ts';
export * from './artwork.ts';
export * from './room.ts';
export * from './reaction.ts';
export * from './exhibition.ts';
export * from './api.ts';
export * from './live.ts';
export * from './diag.ts';

/** 화면 크기(CSS px). 줌에서 작품이 차지할 수 있는 영역(캡션 자리를 뺀 것). */
export interface Viewport {
  readonly w: number;
  readonly h: number;
}

/** 쪽 계획기가 쓰는 그림 분석값(PLAN §5.4). 좌표는 저장된 줌·띠 이미지의 "내용 px" 기준. 전송 모양은 `ImageAnalysisWire`. */
export interface ImageAnalysis {
  /** 원해상도에서 찾은 글 줄 간격(내용 px). 못 찾으면 null */
  readonly linePitchPx: number | null;
  /** 자기상관 봉우리의 신뢰도(0~1) */
  readonly linePitchConfidence: number;
  /** 긴 축 방향 활동량(0~255)을 `profileBinPx` 칸으로 묶은 배열. 쪽 경계 다듬기용 */
  readonly lineProfile: Uint8Array | null;
  readonly profileBinPx: number;
  /** 가장자리 평균 밝기(0~1). 매트 밝은/어두운 고르기 */
  readonly edgeLuma: number;
}
