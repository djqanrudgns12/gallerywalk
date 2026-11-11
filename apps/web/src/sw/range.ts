/**
 * 전체 200 사본에서 단일 바이트 범위 응답을 만든다. 다중·깨진 문법은 null로 네트워크에 맡긴다.
 * 저장된 본문은 Fetch가 이미 content-encoding을 풀었으므로 전송 인코딩 머리는 복사하지 않는다.
 */
export const rangeResponse = async (full: Response, range: string): Promise<Response | null> => {
  if (full.status !== 200) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const startValue = match[1] ? Number(match[1]) : null;
  const endValue = match[2] ? Number(match[2]) : null;
  if (
    (startValue !== null && !Number.isSafeInteger(startValue)) ||
    (endValue !== null && !Number.isSafeInteger(endValue))
  )
    return null;
  const bytes = await full.arrayBuffer();
  const length = bytes.byteLength;
  const start = startValue ?? Math.max(0, length - (endValue ?? 0));
  const end = startValue === null ? length - 1 : Math.min(endValue ?? length - 1, length - 1);
  if (length === 0 || start >= length || end < start || (startValue === null && endValue === 0))
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${length}`,
        'Content-Length': '0',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      },
    });
  const headers = new Headers(full.headers);
  headers.delete('Content-Encoding');
  headers.delete('Transfer-Encoding');
  headers.set('Content-Range', `bytes ${start}-${end}/${length}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
};
