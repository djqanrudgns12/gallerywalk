import { mediaPath } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { consentAudience, formatDay, posterImageUrl, schoolSummary } from './posterView.ts';
import { EX_ID, EXPIRES_AT, makeView, POSTER_ID } from '../../dev/studentFixtures.ts';

describe('포스터 값', () => {
  it('포스터 그림 주소는 mediaPath(core)로, 벽용 크기가 먼저', () => {
    expect(posterImageUrl(makeView())).toBeNull();
    expect(posterImageUrl(makeView({ poster: true }))).toBe(
      mediaPath(EX_ID, POSTER_ID, { name: 'wall', ext: 'webp' }),
    );
  });

  it('학교·학급은 켰을 때만, 있는 것만 잇는다', () => {
    expect(schoolSummary(makeView())).toBeNull();
    expect(schoolSummary(makeView({ school: { schoolName: '가상초등학교', className: '5학년 2반' } }))).toBe(
      '가상초등학교 5학년 2반',
    );
    expect(schoolSummary(makeView({ school: { schoolName: null, className: '5학년 2반' } }))).toBe(
      '5학년 2반',
    );
    expect(schoolSummary(makeView({ school: { schoolName: null, className: null } }))).toBeNull();
  });

  it('날짜는 "{월} {일}" 모양', () => {
    expect(formatDay(EXPIRES_AT, 'Asia/Seoul')).toBe('12월 12일');
  });

  it('동의 문구 판: 이름표로 보이거나 공개가 하나라도 켜지면 "모두에게"', () => {
    const base = makeView().exhibition.reactions;
    expect(consentAudience(base, true)).toBe('everyone');
    expect(consentAudience(base, false)).toBe('teacher');
    const pub = makeView({ reactions: { stickerVisibility: 'PUBLIC' } }).exhibition.reactions;
    expect(consentAudience(pub, false)).toBe('everyone');
  });
});
