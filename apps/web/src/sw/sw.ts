import { createWorker } from './runtime.ts';
import { classifyRequest } from './routes.ts';
import { createExhibitionStore } from './store.ts';

/** DOM 프로젝트에 WebWorker lib 전체를 섞지 않고 진입점에서 쓰는 표면만 선언한다. */
interface LifetimeEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends LifetimeEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface MessageEvent extends LifetimeEvent {
  readonly data: unknown;
  readonly source: { readonly url?: string } | null;
  readonly ports: readonly MessagePort[];
}
interface WorkerScope {
  readonly location: Location;
  readonly caches: CacheStorage;
  readonly indexedDB: IDBFactory;
  readonly clients: { claim(): Promise<void> };
  fetch(request: Request): Promise<Response>;
  addEventListener(type: 'install' | 'activate', listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

// generateBundle가 빌드된 첫 진입 파일 목록·내용 해시로 바꾼다.
const manifest: { version: string; urls: readonly string[] } = JSON.parse('__GALLERY_SW_MANIFEST__');
const scope = globalThis as unknown as WorkerScope;
const worker = createWorker({
  origin: scope.location.origin,
  caches: scope.caches,
  store: createExhibitionStore(scope.indexedDB),
  fetch: req => scope.fetch(req),
  now: () => Date.now(),
  shellVersion: manifest.version,
  shellUrls: manifest.urls,
});

scope.addEventListener('install', event => {
  event.waitUntil(worker.install());
});
// 기존 탭이 닫힌 뒤 새 SW가 활성화된다. skipWaiting으로 관람을 끊지 않는다.
scope.addEventListener('activate', event => {
  event.waitUntil(worker.activate().then(() => scope.clients.claim()));
});
scope.addEventListener('fetch', event => {
  if (classifyRequest(event.request, scope.location.origin).kind === 'pass') return;
  event.respondWith(worker.handle(event.request, promise => event.waitUntil(promise)));
});
scope.addEventListener('message', event => {
  if (!event.source?.url || new URL(event.source.url).origin !== scope.location.origin) return;
  event.waitUntil(
    worker.message(event.data).then(reply => {
      event.ports[0]?.postMessage(reply);
    }),
  );
});
