import type { XhrLike } from '../adapters/api/http.ts';

/**
 * 시험용 가짜 `XMLHttpRequest`(파일 올리기 어댑터·올리기 흐름 시험). 실제 네트워크 없이 보낸 머리·`FormData`를 기록하고,
 * 시험이 진행률·응답·끊김을 차례로 일으킨다.
 */
export class FakeXhr implements XhrLike {
  method = '';
  url = '';
  readonly headers = new Map<string, string>();
  body: FormData | null = null;
  sent = false;
  aborted = false;
  status = 0;
  responseText = '';
  onload: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onabort: ((ev: unknown) => void) | null = null;
  onprogress: ((ev: unknown) => void) | null = null;
  readonly upload: XhrLike['upload'] = { onprogress: null, onload: null };

  open(method: string, url: string | URL): void {
    this.method = method;
    this.url = String(url);
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body instanceof FormData ? body : null;
    this.sent = true;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.({});
  }

  /** 보낸 바이트 알림 */
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: total > 0 });
  }

  /** 응답(본문은 JSON으로) */
  respond(status: number, body?: unknown): void {
    this.upload.onload?.({});
    this.status = status;
    this.responseText = body === undefined ? '' : JSON.stringify(body);
    this.onload?.({});
  }

  /** 연결 끊김 */
  fail(): void {
    this.onerror?.({});
  }

  /** 보낸 `meta` 칸(JSON) */
  meta(): unknown {
    const raw = this.body?.get('meta');
    return typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined;
  }

  file(): File | null {
    const f = this.body?.get('file');
    return f instanceof File ? f : null;
  }
}

/** 만든 가짜를 차례로 모으는 공장 */
export const fakeXhrFactory = () => {
  const made: FakeXhr[] = [];
  return {
    made,
    create: (): XhrLike => {
      const x = new FakeXhr();
      made.push(x);
      return x;
    },
    last: (): FakeXhr => {
      const x = made.at(-1);
      if (!x) throw new Error('no xhr yet');
      return x;
    },
  };
};

export const okEnvelopeOf = (data: unknown) => ({ data, requestId: 'req' });
export const errorEnvelopeOf = (code: string, retryable = false) => ({
  error: { code, message: 'x', retryable },
  requestId: 'req',
});
