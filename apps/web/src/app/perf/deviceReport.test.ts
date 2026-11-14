import { DeviceReportSchema, DiagBodySchema } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { browserOf, deviceBasics, gpuOf, osMajorOf, platformOf, quantile } from './deviceReport.ts';
import { VisitProbe } from './visitProbe.ts';

/** 학교에서 흔한 기기의 UA(공개된 형식 견본) */
const UA = {
  galaxyTabSamsung:
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36',
  galaxyTabChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iPadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  kakao:
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.3',
  whale:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.21 Safari/537.36',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
} as const;

describe('기기 갈래(ADR-070)', () => {
  it('플랫폼·OS 판·브라우저', () => {
    expect(platformOf(UA.galaxyTabSamsung, 5)).toBe('android');
    expect(osMajorOf(UA.galaxyTabSamsung, 'android')).toBe(13);
    expect(browserOf(UA.galaxyTabSamsung)).toBe('samsung');
    expect(browserOf(UA.galaxyTabChrome)).toBe('chrome');
    // iPadOS는 데스크톱 Safari처럼 보인다 — 터치로 iOS, 판은 Version/
    expect(platformOf(UA.iPadDesktop, 5)).toBe('ios');
    expect(platformOf(UA.iPadDesktop, 0)).toBe('desktop');
    expect(osMajorOf(UA.iPadDesktop, 'ios')).toBe(17);
    expect(osMajorOf(UA.iPhone, 'ios')).toBe(16);
    expect(browserOf(UA.iPhone)).toBe('safari');
    expect(browserOf(UA.kakao)).toBe('inapp');
    expect(browserOf(UA.whale)).toBe('whale');
    expect(platformOf(UA.winChrome, 0)).toBe('desktop');
    expect(osMajorOf(UA.winChrome, 'desktop')).toBeNull();
  });

  it('GPU 이름은 갈래로만', () => {
    expect(gpuOf('Mali-G52 MC2')).toBe('mali');
    expect(gpuOf('Adreno (TM) 619')).toBe('adreno');
    expect(gpuOf('Apple GPU')).toBe('apple');
    expect(gpuOf('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('intel');
    expect(gpuOf('SwiftShader Device (Subzero)')).toBe('software');
    expect(gpuOf('')).toBe('unknown');
  });

  it('기기 갈래: 터치 없음 = 데스크톱, 짧은 변 600px 미만 = 휴대폰', () => {
    const tab = deviceBasics({ userAgent: UA.galaxyTabSamsung, maxTouchPoints: 5, deviceMemory: 4 }, 800);
    expect(tab).toEqual({
      platform: 'android',
      osMajor: 13,
      browser: 'samsung',
      device: 'tablet',
      memGb: 4,
      net: null,
    });
    expect(deviceBasics({ userAgent: UA.iPhone, maxTouchPoints: 5 }, 390).device).toBe('phone');
    expect(
      deviceBasics({ userAgent: UA.winChrome, maxTouchPoints: 0, connection: { effectiveType: '4g' } }, 1080),
    ).toMatchObject({ device: 'desktop', net: '4g' });
  });

  it('분위', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(quantile([10], 0.1)).toBe(10);
  });
});

describe('VisitProbe 보고', () => {
  it('관람 한 번의 보고가 서버 스키마를 지나고, 원문 식별값이 없다', () => {
    let now = 0;
    const basics = deviceBasics({ userAgent: UA.galaxyTabSamsung, maxTouchPoints: 5 }, 800);
    const probe = new VisitProbe(basics, () => now);
    probe.gpu('Mali-G52 MC2');
    probe.tier('LOW');
    now = 1200;
    probe.mark('poster');
    now = 9800;
    probe.mark('ready');
    now = 12_000;
    probe.mark('enter');
    for (let i = 0; i < 120; i++) {
      now += 33;
      probe.frame(33);
    }
    probe.frame(800); // 멈춘 뒤 첫 프레임 — 이어 그린 프레임으로 세지 않음
    for (const ms of [40, 60, 90, 300]) probe.input(ms);
    probe.input(99_999); // 화면이 숨은 동안 — 버림
    probe.live('live');
    probe.liveMessage(512, 7);
    now += 60_000;
    const report = probe.report('3d', null);
    expect(DeviceReportSchema.safeParse(report).success).toBe(true);
    expect(DiagBodySchema.safeParse({ kind: 'report', report }).success).toBe(true);
    expect(report).toMatchObject({
      platform: 'android',
      browser: 'samsung',
      gpu: 'mali',
      tierStart: 'LOW',
      posterMs: 1200,
      readyMs: 9800,
      enterMs: 12_000,
      inputCount: 4,
      inputP95Ms: 300,
      liveOk: true,
      peersMax: 7,
    });
    expect(report.fpsP50).toBeCloseTo(30.3, 1);
    expect(report.frameP95Ms).toBe(33);
    const text = JSON.stringify(report);
    expect(text).not.toContain('SamsungBrowser');
    expect(text).not.toContain('Mali-G52');
  });

  it('아무것도 재지 못한 보고도 스키마를 지난다(포스터에서 떠남)', () => {
    const probe = new VisitProbe(deviceBasics({ userAgent: '', maxTouchPoints: 0 }, 0), () => 500);
    probe.mark('poster');
    const report = probe.report('3d', 'ready_timeout');
    expect(DeviceReportSchema.safeParse(report).success).toBe(true);
    expect(report.firstFrameMs).toBeNull();
    expect(report.fpsP50).toBeNull();
  });
});
