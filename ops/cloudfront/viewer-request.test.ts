import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 공용 입구 함수 단위 시험(P1-8). CloudFront 런타임의 `import cf from 'cloudfront'`를 가짜로 바꿔 Node에서 돌린다.
 * 콘솔의 함수 시험(Test function)은 P7-2에서 같은 표로 한 번 더 한다.
 */

interface Header {
  value: string;
}
interface CfRequest {
  uri: string;
  querystring: Record<string, { value: string; multiValue?: { value: string }[] }>;
  headers: Record<string, Header | undefined>;
}
type CfResult = CfRequest | { statusCode: number; headers: Record<string, Header> };

const load = () => {
  const source = readFileSync(new URL('./viewer-request.js', import.meta.url), 'utf8').replace(
    "import cf from 'cloudfront';",
    '',
  );
  const selected: string[] = [];
  const cf = { selectRequestOriginById: (id: string) => selected.push(id) };
  const handler = new Function('cf', `${source}\nreturn handler;`)(cf) as (event: unknown) => CfResult;
  return { handler, selected };
};

const event = (host: string, extra: Record<string, Header> = {}, uri = '/assets/g/app.js') => ({
  viewer: { ip: '203.0.113.7' },
  request: { uri, querystring: { v: { value: '1' } }, headers: { host: { value: host }, ...extra } },
});

describe('쌤유 앱 공용 입구 함수', () => {
  it('gallery 주소는 갤러리 원본으로 보내고 시청자 IP를 x-gw-viewer-ip로 넣는다', () => {
    const { handler, selected } = load();
    const out = handler(event('gallery.ssamuniverse.com')) as CfRequest;
    expect(selected).toEqual(['origin-gallery']);
    expect(out.headers['x-gw-viewer-ip']?.value).toBe('203.0.113.7');
    expect(out.headers['x-we-client-ip']).toBeUndefined();
  });

  it('write 주소는 기본 원본 그대로, 시청자 IP는 x-we-client-ip로', () => {
    const { handler, selected } = load();
    const out = handler(event('write.ssamuniverse.com')) as CfRequest;
    expect(selected).toEqual([]);
    expect(out.headers['x-we-client-ip']?.value).toBe('203.0.113.7');
    expect(out.headers['x-gw-viewer-ip']).toBeUndefined();
    // 운영 중인 we-viewer-request와 같게 원래 주소도 넣는다
    expect(out.headers['x-we-forwarded-host']?.value).toBe('write.ssamuniverse.com');
  });

  it('시청자가 꾸며 보낸 x-we-forwarded-host는 덮어쓰거나(write) 지운다(gallery)', () => {
    const { handler } = load();
    const fake = { 'x-we-forwarded-host': { value: 'evil.example' } };
    const w = handler(event('write.ssamuniverse.com', fake)) as CfRequest;
    expect(w.headers['x-we-forwarded-host']?.value).toBe('write.ssamuniverse.com');
    const g = handler(event('gallery.ssamuniverse.com', fake)) as CfRequest;
    expect(g.headers['x-we-forwarded-host']).toBeUndefined();
  });

  it('시청자가 꾸며 보낸 IP 머리는 덮어쓰고, 다른 앱의 머리는 지운다', () => {
    const { handler } = load();
    const out = handler(
      event('gallery.ssamuniverse.com', {
        'x-gw-viewer-ip': { value: '10.0.0.1' },
        'x-we-client-ip': { value: '10.0.0.2' },
      }),
    ) as CfRequest;
    expect(out.headers['x-gw-viewer-ip']?.value).toBe('203.0.113.7');
    expect(out.headers['x-we-client-ip']).toBeUndefined();
  });

  it('주소는 대소문자를 가리지 않는다', () => {
    const { handler, selected } = load();
    handler(event('Gallery.SsamUniverse.com'));
    expect(selected).toEqual(['origin-gallery']);
  });

  it('표에 없는 주소(배포 기본 주소 등)는 글방으로 308, 경로·쿼리 유지', () => {
    const { handler, selected } = load();
    const out = handler(event('d123.cloudfront.net', {}, '/t')) as {
      statusCode: number;
      headers: Record<string, Header>;
    };
    expect(out.statusCode).toBe(308);
    expect(out.headers['location']?.value).toBe('https://write.ssamuniverse.com/t?v=1');
    expect(selected).toEqual([]);
  });
});
