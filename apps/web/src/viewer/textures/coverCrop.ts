/**
 * 그림을 판에 늘이지 않고 가운데를 잘라 채우는 UV 변환(CSS `object-fit: cover`와 같은 뜻).
 * 소리 명판 표지(정사각에 가까움)를 가로로 긴 명판에 걸 때 쓴다(V-23). 뒤집힌 텍스처(`ImageBitmap`, repeat.y < 0)는
 * 뒤집기를 지킨 채 자른다. three에 기대지 않는다 — 부르는 쪽이 `texture.repeat`·`offset`에 넣는다.
 */
export interface UvCrop {
  readonly repeat: readonly [number, number];
  readonly offset: readonly [number, number];
}

export const coverCrop = (
  image: { readonly w: number; readonly h: number },
  plane: { readonly w: number; readonly h: number },
  flipped: boolean,
): UvCrop => {
  const imageAspect = image.w / image.h;
  const planeAspect = plane.w / plane.h;
  // 그림이 판보다 넓으면 양옆을, 좁으면 위아래를 같은 만큼 자른다
  const sx = imageAspect > planeAspect ? planeAspect / imageAspect : 1;
  const sy = imageAspect < planeAspect ? imageAspect / planeAspect : 1;
  const ox = (1 - sx) / 2;
  return flipped
    ? { repeat: [sx, -sy], offset: [ox, 1 - (1 - sy) / 2] }
    : { repeat: [sx, sy], offset: [ox, (1 - sy) / 2] };
};
