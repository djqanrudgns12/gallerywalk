-- P3-6 정리 조회·참조 확인용 인덱스. 기존 표와 행은 바꾸지 않는다.
CREATE INDEX exhibitions_deleting ON exhibitions(id) WHERE deleting = 1;
CREATE INDEX artworks_deleted ON artworks(deleted_at, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX assets_created ON assets(created_at, id);
CREATE INDEX artworks_source_asset ON artworks(source_asset_id) WHERE source_asset_id IS NOT NULL;
CREATE INDEX artwork_pages_asset ON artwork_pages(asset_id);
CREATE INDEX exhibitions_poster_asset ON exhibitions(poster_asset_id) WHERE poster_asset_id IS NOT NULL;
CREATE INDEX rooms_bgm_asset ON rooms(bgm_asset_id) WHERE bgm_asset_id IS NOT NULL;
