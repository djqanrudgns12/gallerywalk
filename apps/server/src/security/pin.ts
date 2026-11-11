import type { KeyObject } from 'node:crypto';
import { hmacHex, hmacKey, type KeySource } from './tokens.ts';
import { WEAK_PINS } from './weakPins.ts';

/**
 * 선생님 PIN(PLAN §11.2, ADR-024). 모양(숫자 `PIN_MIN_LENGTH`~`PIN_MAX_LENGTH`자리)은 zod `PinSchema`가 먼저 본다.
 *
 * - 저장: `HMAC-SHA256(PIN_HMAC_SECRET, pin)` 소문자 16진(`exhibitions.pin_hmac`). PIN이 전역이라 HMAC 하나로 중복을 찾는다.
 * - 쉬운 PIN: 같은 숫자 반복(777777), 오름·내림 연속(234567·76543210, 9 다음 0으로 이어지는 890123도 연속),
 *   흔한 PIN 50개(`weakPins.ts`).
 */

/** 숫자 열에서 한 칸씩 나아가는 걸음(10을 법으로: +1 = 오름, 9 = 내림) */
const DIGITS = 10;
const STEP_UP = 1;
const STEP_DOWN = DIGITS - 1;

const weakSet: ReadonlySet<string> = new Set(WEAK_PINS);

export const pinHmac = (secret: KeySource | KeyObject, pin: string): string => hmacHex(hmacKey(secret), pin);

const isDigits = (pin: string): boolean => /^\d+$/.test(pin);

/** 같은 숫자만(777777) */
export const isRepeatedDigit = (pin: string): boolean => /^(\d)\1+$/.test(pin);

/** 모든 이웃 숫자의 차가 같은 방향으로 1(10을 법으로)인가 */
export const isSequential = (pin: string): boolean => {
  if (!isDigits(pin) || pin.length < 2) return false;
  const digits = [...pin].map(Number);
  const stepsAll = (step: number): boolean =>
    digits.every((d, i) => i === 0 || (d - (digits[i - 1] ?? 0) + DIGITS) % DIGITS === step);
  return stepsAll(STEP_UP) || stepsAll(STEP_DOWN);
};

export const isCommonPin = (pin: string): boolean => weakSet.has(pin);

export const isWeakPin = (pin: string): boolean =>
  isRepeatedDigit(pin) || isSequential(pin) || isCommonPin(pin);
