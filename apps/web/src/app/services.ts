import { config } from '@gallery/core/config';
import { createContext, useContext } from 'react';
import { createApiClient } from '../adapters/api/client.ts';
import { createHttp } from '../adapters/api/http.ts';
import { createDeviceStore } from '../adapters/deviceStore.ts';
import { createBrowserMediaCache } from '../adapters/sw/browserMediaCache.ts';
import { createTokenTools } from '../adapters/tokens.ts';
import type { ApiClient, DeviceStore, TokenTools } from '../ports/index.ts';
import type { MediaCache } from '../ports/mediaCache.ts';
import { createVisitorPrefs, type VisitorPrefs } from './student/visitorPrefs.ts';

/**
 * 기기 서비스 한 곳(P4-1): 어댑터를 여기서 한 번만 만들어 화면에 주입한다. `ui/`·`viewer/`는 `adapters/`를 가져오지 않고,
 * `app/`의 화면은 `useServices()`로 받는다(시험은 `ServicesContext`에 가짜를 넣는다).
 */
export interface AppServices {
  readonly api: ApiClient;
  readonly device: DeviceStore;
  readonly tokens: TokenTools;
  /** 고른 캐릭터·마지막 별명(포트에 칸이 생기면 `device`로 옮긴다) */
  readonly prefs: VisitorPrefs;
  /** 인앱 브라우저 판정용 */
  readonly userAgent: string;
  /** 서비스 워커(P4-8): 등록·시작·화면 복귀 알림·미리 불러오기. 시험·개발에서는 없을 수 있다 */
  readonly media?: MediaCache | undefined;
}

export const createAppServices = (): AppServices => {
  const device = createDeviceStore();
  const tokens = createTokenTools();
  const http = createHttp({ timeoutMs: config().API_TIMEOUT_MS, deviceId: () => device.deviceId() });
  return {
    api: createApiClient({ http, device, tokens }),
    device,
    tokens,
    prefs: createVisitorPrefs(),
    userAgent: globalThis.navigator?.userAgent ?? '',
    media: createBrowserMediaCache(),
  };
};

let shared: AppServices | null = null;

/** 앱 전체에서 하나(처음 부를 때 만든다) */
export const appServices = (): AppServices => (shared ??= createAppServices());

export const ServicesContext = createContext<AppServices | null>(null);

export const useServices = (): AppServices => {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesContext missing: render inside <App>');
  return services;
};
