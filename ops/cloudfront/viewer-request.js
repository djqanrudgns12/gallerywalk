// CloudFront Function (런타임 cloudfront-js-2.0, 이벤트: viewer request) — "쌤유 앱 공용 입구"(ADR-002, P1-8)
// 글방 배포(E3TFCRGRU1HG1Q)의 모든 cache behavior(기본 `*`, `/assets/*`, `/art/*`)에 연결한다.
// 글방 PLAN §15의 `we-viewer-request`(write 외 308, x-we-client-ip)를 이 함수 하나로 합친다 — 콘솔 반영은 P7-2.
//
// 1) 주소(Host)마다 원본과 시청자 IP 머리를 고른다. 표에 없는 주소(배포 기본 주소 등)는 글방으로 308.
// 2) 시청자가 보낸 같은 이름의 IP 머리는 모두 지우고 다시 쓴다 — 위조할 수 없다.
//    (원본은 Cloudflare WAF가 CloudFront 비밀 머리 없이는 막으므로 이 함수를 거치지 않은 요청은 원본에 닿지 못한다.)
// 3) 갤러리의 캐시할 파일은 모두 `/assets/g/` 아래라 글방 파일과 경로가 겹치지 않는다(관리형 CachingOptimized는 Host를
//    캐시 키에 넣지 않으므로 경로로 나눈다).
import cf from 'cloudfront';

var APPS = {
  'write.ssamuniverse.com': { originId: null, ipHeader: 'x-we-client-ip' },
  'gallery.ssamuniverse.com': { originId: 'origin-gallery', ipHeader: 'x-gw-viewer-ip' },
};
var FALLBACK_HOST = 'write.ssamuniverse.com';
var IP_HEADERS = ['x-we-client-ip', 'x-gw-viewer-ip'];

function serializeQuery(querystring) {
  var parts = [];
  for (var key in querystring) {
    var item = querystring[key];
    if (item.multiValue) {
      for (var i = 0; i < item.multiValue.length; i++) {
        parts.push(item.multiValue[i].value === '' ? key : key + '=' + item.multiValue[i].value);
      }
    } else {
      parts.push(item.value === '' ? key : key + '=' + item.value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  var app = APPS[host];

  if (!app) {
    return {
      statusCode: 308,
      statusDescription: 'Permanent Redirect',
      headers: {
        location: { value: 'https://' + FALLBACK_HOST + request.uri + serializeQuery(request.querystring) },
      },
    };
  }

  for (var i = 0; i < IP_HEADERS.length; i++) delete request.headers[IP_HEADERS[i]];
  request.headers[app.ipHeader] = { value: event.viewer.ip };
  if (app.originId) cf.selectRequestOriginById(app.originId);
  return request;
}
