/**
 * 함께 관람 연결의 사용자 IP와 IP 칸(PLAN §11.3). 규칙은 보안 모듈 한 곳(`security/client.ts`)에 있고, 여기서는 다시 내보내기만 한다.
 */
export {
  clientIp,
  createIpKeyer,
  createWindowLimiter,
  ipBucket,
  type IpRequest,
  type KeySource,
  type WindowLimiter,
} from '../security/client.ts';
