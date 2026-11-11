-- 0001 첫 판 (PLAN §10.2). STRICT 표, ID는 UUID 문자열, 시각은 UTC 밀리초, 상태값은 대문자 + CHECK.
-- 바뀔 수 있는 길이·개수 한도는 여기에 넣지 않는다(zod·config.ts, PLAN §10.1).
-- 마이그레이션은 앞으로만 간다. 이 파일은 한 번 배포한 뒤로 고치지 않고 다음 판을 새 파일로 더한다(store/db.ts).

CREATE TABLE exhibitions (
  id TEXT PRIMARY KEY,
  entry_code TEXT NOT NULL UNIQUE,                 -- 숫자 6자리 (ADR-023)
  pin_hmac TEXT NOT NULL UNIQUE,                   -- HMAC-SHA256 (G-17)
  title TEXT NOT NULL, subtitle TEXT,
  template_id TEXT NOT NULL,
  poster_asset_id TEXT,
  school_name TEXT, class_name TEXT, show_school INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL,                     -- reactions·tour (zod: ExhibitionSettings)
  status TEXT NOT NULL CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  retention_days INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,                  -- 교사 편집 충돌 확인
  create_hash TEXT NOT NULL,                       -- 같은 ID로 다시 만들기 확인(멱등)
  content_version INTEGER NOT NULL DEFAULT 1,
  settings_version INTEGER NOT NULL DEFAULT 1,
  layout_version INTEGER NOT NULL DEFAULT 0,
  layout_dirty INTEGER NOT NULL DEFAULT 1,
  deleting INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  opened_at INTEGER, closed_at INTEGER
) STRICT;
CREATE INDEX exhibitions_expires ON exhibitions(expires_at);

CREATE TABLE teacher_sessions (                    -- 선생님 링크(LINK)와 PIN 세션(PIN) 토큰
  token_hash TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('LINK','PIN')),
  created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
) STRICT;

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('IMAGE','PAGE','AUDIO','POSTER','COVER')),
  width INTEGER, height INTEGER, duration_ms INTEGER,
  variants_json TEXT NOT NULL,                     -- [{name, ext, w, h, bytes}]
  analysis_json TEXT,                              -- 그림·쪽 = 그림 분석값, 소리·배경음악 = 소리 분석값
  bytes_total INTEGER NOT NULL,
  content_hash TEXT NOT NULL,                      -- 받은 파일 SHA-256 (중복 검사)
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX assets_hash ON assets(exhibition_id, content_hash);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL, intro TEXT,
  bgm_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  rev INTEGER NOT NULL DEFAULT 1, create_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (id, exhibition_id)                       -- 복합 외래키 대상
) STRICT;

CREATE TABLE artworks (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '', author TEXT, caption_short TEXT, description_long TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('IMAGE','PDF','TEXT','AUDIO','VIDEO')),          -- VIDEO는 예약 (G-23)
  form TEXT NOT NULL CHECK (form IN ('PANORAMA','LANDSCAPE','SQUARE','PORTRAIT','TALL','MULTIPAGE','TEXTCARD','SOUND')),
  form_override TEXT,
  text_heavy INTEGER NOT NULL DEFAULT 0, text_heavy_override INTEGER,
  featured INTEGER NOT NULL DEFAULT 0,
  page_mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (page_mode IN ('AUTO','SINGLE')),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','HIDDEN','PUBLISHED','FAILED')),
  source_asset_id TEXT REFERENCES assets(id),
  page_count INTEGER, text_body TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  fail_code TEXT,                                  -- FAILED 사유(오류 코드, 카드에 한 줄, §9.4-6)
  deleted_at INTEGER,
  rev INTEGER NOT NULL DEFAULT 1, create_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (id, exhibition_id),
  FOREIGN KEY (room_id, exhibition_id) REFERENCES rooms(id, exhibition_id)   -- 다른 전시의 전시실로 못 감
) STRICT;
CREATE INDEX artworks_room ON artworks(room_id, ord) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX artworks_one_featured ON artworks(room_id) WHERE featured = 1 AND deleted_at IS NULL;

CREATE TABLE artwork_pages (                       -- PDF·여러 쪽 작품의 쪽
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id),
  PRIMARY KEY (artwork_id, idx)
) STRICT;

CREATE TABLE layouts (                             -- 최근 2판만 남김
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, algo_version INTEGER NOT NULL, hash TEXT NOT NULL,
  data_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (exhibition_id, version)
) STRICT;

CREATE TABLE visitors (
  token_hash TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  nickname TEXT, nickname_norm TEXT,
  consent_version TEXT, consent_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (token_hash, exhibition_id)
) STRICT;

CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  artwork_id TEXT NOT NULL,
  visitor_token_hash TEXT NOT NULL,
  sticker TEXT CHECK (sticker IN ('MOVED','LEARNED','GREAT','CURIOUS')),
  memo TEXT,
  score_fact INTEGER CHECK (score_fact BETWEEN 1 AND 3),
  score_delivery INTEGER CHECK (score_delivery BETWEEN 1 AND 3),
  hidden INTEGER NOT NULL DEFAULT 0, public_selected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (artwork_id, visitor_token_hash),          -- 기기 1대 = 작품 1개에 반응 1개 (G-07)
  FOREIGN KEY (artwork_id, exhibition_id) REFERENCES artworks(id, exhibition_id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_token_hash, exhibition_id) REFERENCES visitors(token_hash, exhibition_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE rate_buckets (
  key TEXT PRIMARY KEY,                             -- '{종류}:{HMAC(기기 또는 IP)}' 또는 'global:{종류}'
  window_start INTEGER NOT NULL, count INTEGER NOT NULL, locked_until INTEGER
) STRICT;

CREATE TABLE teacher_devices (                     -- 시작 코드를 맞힌 기기 (ADR-048)
  device_hash TEXT PRIMARY KEY, registered_at INTEGER NOT NULL
) STRICT;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
