import { createHmac } from 'node:crypto';
import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { isCommonPin, isRepeatedDigit, isSequential, isWeakPin, pinHmac } from '../../src/security/pin.ts';
import { WEAK_PINS } from '../../src/security/weakPins.ts';
import { randomKey, randomStrongPin } from './support.ts';

/** 쉬운 PIN·PIN HMAC(PLAN §11.2, ADR-024). 예시 PIN은 모두 가상 값이다. */

describe('쉬운 PIN', () => {
  it.each(['000000', '777777', '4444444', '99999999'])('같은 숫자 반복: %s', pin => {
    expect(isRepeatedDigit(pin)).toBe(true);
    expect(isWeakPin(pin)).toBe(true);
  });

  it.each(['234567', '345678', '0123456', '76543210', '9876543', '890123', '2109876'])(
    '오름·내림 연속(9 다음 0 포함): %s',
    pin => {
      expect(isSequential(pin)).toBe(true);
      expect(isWeakPin(pin)).toBe(true);
    },
  );

  it('흔한 PIN 목록: 50개, 6~8자리 숫자, 중복 없음, 반복·연속 규칙과 겹치지 않음, 모두 쉬움', () => {
    expect(WEAK_PINS).toHaveLength(50);
    expect(new Set(WEAK_PINS).size).toBe(WEAK_PINS.length);
    for (const pin of WEAK_PINS) {
      expect(pin).toMatch(/^\d+$/);
      expect(pin.length).toBeGreaterThanOrEqual(config().PIN_MIN_LENGTH);
      expect(pin.length).toBeLessThanOrEqual(config().PIN_MAX_LENGTH);
      expect(isRepeatedDigit(pin) || isSequential(pin)).toBe(false);
      expect(isCommonPin(pin)).toBe(true);
      expect(isWeakPin(pin)).toBe(true);
    }
  });

  it.each(['482910', '306182', '5820417', '93017452', '24681357'])('쉽지 않은 가상 PIN: %s', pin => {
    expect(isRepeatedDigit(pin)).toBe(false);
    expect(isSequential(pin)).toBe(false);
    expect(isCommonPin(pin)).toBe(false);
    expect(isWeakPin(pin)).toBe(false);
  });

  it('한 자리만 어긋나면 연속이 아니다', () => {
    expect(isSequential('234568')).toBe(false);
    expect(isSequential('765421')).toBe(false);
    expect(isSequential('123432')).toBe(false);
  });
});

describe('PIN HMAC', () => {
  it('HMAC-SHA256 소문자 16진: 같은 비밀·같은 PIN이면 같고, 비밀이나 PIN이 다르면 다르다', () => {
    const secret = randomKey();
    const pin = randomStrongPin();
    const digest = pinHmac(secret, pin);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(createHmac('sha256', secret.bytes()).update(pin).digest('hex'));
    expect(pinHmac(secret, pin)).toBe(digest);
    expect(pinHmac(randomKey(), pin)).not.toBe(digest);
    let other = randomStrongPin();
    while (other === pin) other = randomStrongPin();
    expect(pinHmac(secret, other)).not.toBe(digest);
    expect(digest).not.toContain(pin);
  });
});
