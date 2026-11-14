// 오래된 학교 기기에 없는 실행 기능(⑥ no-new-runtime-api 견본)
export const lastOf = (xs: readonly number[]): number | undefined => xs.at(-1);
export const has = (o: object, k: string): boolean => Object.hasOwn(o, k);
