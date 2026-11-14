import { copy, fill } from '@gallery/core/copy';
import type { Layout } from '@gallery/core/types';
import { config } from '@gallery/core/config';
import { memo, useEffect, useMemo, type ReactElement } from 'react';
import { axoDots, axoPin, buildAxo, type AxoModel } from '../../../viewer/map/axo.ts';
import styles from './FloorPlan.module.css';

export interface FloorPlanProps {
  readonly layout: Layout | null;
  /** 보드의 전시실 차례(번호 01부터) */
  readonly roomOrder: readonly string[];
  readonly width: number;
  readonly height: number;
  /** 살펴보기 칸의 작은 "걸린 자리" 지도 */
  readonly mini?: boolean;
  readonly selectedRoomId?: string | null;
  readonly selectedArtworkId?: string | null;
  /** 끄는 작품이 놓일 전시실(보드·지도 어디서 끌든) */
  readonly dropRoomId?: string | null;
  /** 수업 탭: 전시실별 지금 관람 중 학생 수. 있으면 점을 흩고 번호 옆에 수를 적는다 */
  readonly counts?: ReadonlyMap<string, number>;
  readonly onPickRoom?: (roomId: string) => void;
  readonly onPickArtwork?: (artworkId: string) => void;
  /** 끄는 중 지도에 놓기 판정용(HT-03d): 지도 모양을 부모가 받아 둔다 */
  readonly onModel?: (model: AxoModel | null) => void;
}

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter((n): n is string => typeof n === 'string' && n.length > 0).join(' ');

/**
 * 교사 작업 화면 v3의 축측 지도(FIELD_PLAN §5.4 ③, HT-04). 배치 결과를 SVG 한 장으로 그린다. 3D 엔진은 싣지 않는다.
 * 전시실 바닥을 누르면 그 전시실, 작품 자리를 누르면 그 작품을 고른다(같은 일은 보드·번호 타일로도 할 수 있다).
 */
export const FloorPlan = memo(function FloorPlan({
  layout,
  roomOrder,
  width,
  height,
  mini = false,
  selectedRoomId = null,
  selectedArtworkId = null,
  dropRoomId = null,
  counts,
  onPickRoom,
  onPickArtwork,
  onModel,
}: FloorPlanProps): ReactElement {
  const text = copy.teacher.manage;
  const model = useMemo(
    () =>
      layout
        ? buildAxo(
            {
              map: layout.map,
              parts: layout.parts,
              frames: layout.frames,
              facadeZ: layout.exterior.facadeZ,
              roomOrder,
            },
            { width, height, mini },
          )
        : null,
    [layout, roomOrder, width, height, mini],
  );
  useEffect(() => onModel?.(model), [model, onModel]);
  const pin = useMemo(
    () => (model && selectedArtworkId ? axoPin(model, selectedArtworkId) : null),
    [model, selectedArtworkId],
  );
  const dots = useMemo(() => (model && counts ? axoDots(model, counts) : []), [model, counts]);

  if (!model) {
    return (
      <div className={styles.empty} style={{ minHeight: height }} data-testid="floor-plan" data-state="empty">
        {text.mapEmpty}
      </div>
    );
  }

  return (
    <svg
      className={cx(styles.axo, mini && styles.mini)}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={text.mapLabel}
      data-testid="floor-plan"
      data-state="ready"
      data-drop-room={dropRoomId ?? undefined}
    >
      <g className={styles.floors}>
        {model.corridor.map((points, i) => (
          <polygon key={`c${i}`} className={styles.corridor} points={points} />
        ))}
        {model.rooms.map(room =>
          room.floors.map((points, i) => (
            <polygon
              key={`${room.roomId}:${i}`}
              className={cx(
                styles.floor,
                room.roomId === selectedRoomId && styles.selected,
                room.roomId === dropRoomId && styles.drop,
                onPickRoom && styles.pickable,
              )}
              points={points}
              data-room-id={room.roomId}
              onClick={onPickRoom ? () => onPickRoom(room.roomId) : undefined}
            />
          )),
        )}
      </g>
      {model.entry && <polygon className={styles.entry} points={model.entry.arrow} />}
      {model.shapes.map((shape, i) =>
        shape.kind === 'wall' ? (
          <polygon key={i} className={styles[shape.face]} points={shape.points} />
        ) : (
          <polygon
            key={shape.artworkId}
            className={cx(
              shape.kind === 'easel' ? styles.easel : styles.art,
              shape.featured && styles.featured,
              shape.artworkId === selectedArtworkId && styles.selected,
              onPickArtwork && styles.pickable,
            )}
            points={shape.points}
            data-artwork-id={shape.artworkId}
            onClick={onPickArtwork ? () => onPickArtwork(shape.artworkId) : undefined}
          />
        ),
      )}
      {dots.map((dot, i) => (
        <circle
          key={`d${i}`}
          className={styles.dot}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          data-room-id={dot.roomId}
        />
      ))}
      {model.rooms.map(room => (
        <text
          key={room.roomId}
          className={cx(
            styles.number,
            (room.roomId === selectedRoomId || room.roomId === dropRoomId) && styles.selected,
          )}
          x={room.label.x}
          y={room.label.y}
          style={{ fontSize: room.label.size }}
        >
          {String(room.index + 1).padStart(2, '0')}
          {counts && (
            <tspan className={styles.count} dx={room.label.size * config().AXO.countGapRatio}>
              {fill(text.mapPeople, { n: counts.get(room.roomId) ?? 0 })}
            </tspan>
          )}
        </text>
      ))}
      {model.entry && (
        <text className={styles.entryLabel} x={model.entry.label.x} y={model.entry.label.y}>
          {text.mapEntry}
        </text>
      )}
      {pin && (
        <g data-testid="floor-plan-pin" data-artwork-id={selectedArtworkId ?? undefined}>
          <polygon className={styles.ring} points={pin.ring} />
          <line className={styles.stem} x1={pin.stem.x1} y1={pin.stem.y1} x2={pin.stem.x2} y2={pin.stem.y2} />
          <circle className={styles.pin} cx={pin.head.x} cy={pin.head.y} r={pin.head.r} />
        </g>
      )}
    </svg>
  );
});
