import { config } from '@gallery/core/config';
import { type TemplateLook, templateGeometry, templateGeometryV4 } from '@gallery/core/templates';
import type { Layout } from '@gallery/core/types';
import { useEffect, useMemo } from 'react';
import { InstancedMesh, Matrix4, type MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { blobShadowMaterial, contactShadowMaterial, lightPoolMaterial, sceneDim } from './materials.ts';

/**
 * 외관 접촉 그늘(실시간 그림자 없이, AGENTS.md §4): 건물이 광장에 떠 보이지 않게 맞닿는 곳에 흐린 그늘을 깐다(Antigravity 비평 2026-11-12).
 * - 띠(흐린 네모, 그리기 1회): 정면 날개 벽 밑, 계단 디딤판마다 안쪽 모서리(위 단 챌판이 닿는 곳), 계단 맨 아래와 광장이 닿는 곳,
 *   정문 열림 위·양옆(세운 띠 — 문 열림 치수는 Blender 현관 조각과 같은 규칙: 문 폭·높이 − 문틀).
 * - 둥근 그늘(그리기 1회): 현관 기둥 밑.
 * - 정문 안쪽 빛(그리기 1회, V-57): 문 열림 안쪽에 세운 판과 문 앞 현관 바닥에 깐 판 — 빛 웅덩이와 같은 가산 판이라 실시간
 *   조명이 아니다. 해 질 녘 광장에서 입구 안쪽이 따뜻하게 밝아 보여 시선을 끈다. 세운 판은 광장 쪽만 보인다(뒷면 그리지 않음).
 * 자리는 배치 엔진 외관(`layout.exterior`)과 템플릿 기하(계단 단·기둥)에서 계산한다. Blender 굽기에 접촉 그림자를 넣으면 지운다.
 */

export const ExteriorContact = ({
  layout,
  glow,
}: {
  layout: Layout;
  /** 정문 안쪽 빛(템플릿 `look.outdoor.entranceGlow`). 없으면 그리지 않는다 */
  glow?: TemplateLook['outdoor']['entranceGlow'] | undefined;
}) => {
  const parts = useMemo(() => {
    const x = layout.exterior;
    if (!x) return null;
    // 공간 v4(스키마 3)는 v4 외관 치수(현관 24m·계단 16단·정문 3.6m, ADR-071)로
    const v4 = layout.schemaVersion === 3;
    const e = v4
      ? templateGeometryV4[layout.templateId].base.exterior
      : templateGeometry[layout.templateId].exterior;
    const c = config().EXTERIOR_CONTACT;
    const zf = x.facadeZ;
    const zPF = zf - e.porticoD;
    const ph = e.porticoW / 2;
    const lift = c.liftM;
    const flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new Matrix4();
    const q = new Quaternion();
    const strips: Matrix4[] = [];
    const strip = (cx: number, y: number, cz: number, w: number, d: number): void => {
      strips.push(m.compose(new Vector3(cx, y + lift, cz), q, new Vector3(w, 1, d)).clone());
    };
    // 정면 날개 벽 밑(현관 양옆), 벽 앞 광장 쪽으로 번지게
    const wingW = x.halfWidth - ph;
    if (wingW > 0)
      for (const side of [1, -1])
        strip(side * (ph + wingW / 2), x.groundY, zf - c.wallDepthM / 4, wingW, c.wallDepthM);
    // 계단: 디딤판 k(위에서 0부터)의 안쪽 모서리 = 위 단 챌판 밑(k ≥ 1), 맨 아래는 광장과 첫 챌판이 닿는 곳
    for (let k = 1; k <= e.steps; k++) {
      const z = zPF - k * e.stepRunM;
      const y = k === e.steps ? x.groundY : -k * e.stepRiseM;
      strip(0, y, z - c.stepDepthM / 4, e.porticoW - c.stepInsetM * 2, c.stepDepthM);
    }
    // 정문 열림 위(상인방 밑)·양옆 차폐: 정면 벽 면 바로 안쪽에 세운 흐린 띠(광장에서 안을 볼 때 문이 깊어 보이게)
    const cfg = config();
    const casing = templateGeometry[layout.templateId].doorCasingM;
    const clearW = v4 ? cfg.LAYOUT_V4.portal.clear : cfg.DOOR_WIDTH_M - 2 * casing;
    const clearH = v4 ? cfg.LAYOUT_V4.portal.h : cfg.DOOR_HEIGHT_M - casing;
    const upright = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    const doorZ = zf + c.doorInsetM;
    strips.push(
      m
        .compose(new Vector3(0, clearH, doorZ), upright, new Vector3(clearW + c.doorSideM, 1, c.doorHeadM))
        .clone(),
    );
    for (const side of [1, -1])
      strips.push(
        m
          .compose(
            new Vector3((side * clearW) / 2, clearH / 2, doorZ),
            upright,
            new Vector3(c.doorSideM, 1, clearH),
          )
          .clone(),
      );
    const stripMat = contactShadowMaterial(sceneDim);
    stripMat.opacity = c.stripOpacity;
    const stripMesh = new InstancedMesh(flat, stripMat, strips.length);
    strips.forEach((s, i) => stripMesh.setMatrixAt(i, s));
    stripMesh.instanceMatrix.needsUpdate = true;
    stripMesh.computeBoundingSphere();
    stripMesh.renderOrder = 1;

    // 현관 기둥 밑(현관 바닥 높이 0)
    const cz = zPF + e.columnInsetM;
    const cols = e.columnXs.flatMap(cx => [cx, -cx]);
    const d = e.columnDiameterM * c.columnScale;
    const blobMat = blobShadowMaterial(c.columnOpacity);
    const blobMesh = new InstancedMesh(flat, blobMat, cols.length);
    cols.forEach((cx, i) =>
      blobMesh.setMatrixAt(i, m.compose(new Vector3(cx, lift, cz), q, new Vector3(d, 1, d))),
    );
    blobMesh.instanceMatrix.needsUpdate = true;
    blobMesh.computeBoundingSphere();
    blobMesh.renderOrder = 1;

    // 정문 안쪽 빛: [문 안쪽에 세운 판, 문 앞 현관 바닥 판]
    let glowMat: MeshBasicMaterial | null = null;
    let glowMesh: InstancedMesh | null = null;
    if (glow) {
      glowMat = lightPoolMaterial(sceneDim, { ...glow, scale: 1, lift: 0 });
      glowMesh = new InstancedMesh(flat, glowMat, 2);
      glowMesh.setMatrixAt(
        0,
        m.compose(
          new Vector3(0, clearH / 2, zf + glow.insideM),
          upright,
          new Vector3(clearW * glow.spread, 1, clearH * glow.spread),
        ),
      );
      glowMesh.setMatrixAt(
        1,
        m.compose(
          new Vector3(0, lift * 2, zf - glow.spillM / 2),
          q,
          new Vector3(clearW * glow.spread, 1, glow.spillM),
        ),
      );
      glowMesh.instanceMatrix.needsUpdate = true;
      glowMesh.computeBoundingSphere();
      glowMesh.renderOrder = 2;
    }
    return { flat, stripMat, stripMesh, blobMat, blobMesh, glowMat, glowMesh };
  }, [layout, glow]);

  useEffect(
    () => () => {
      if (!parts) return;
      parts.flat.dispose();
      parts.stripMat.dispose();
      parts.blobMat.dispose();
      parts.stripMesh.dispose();
      parts.blobMesh.dispose();
      parts.glowMat?.dispose();
      parts.glowMesh?.dispose();
    },
    [parts],
  );

  if (!parts) return null;
  return (
    <group>
      <primitive object={parts.stripMesh} />
      <primitive object={parts.blobMesh} />
      {parts.glowMesh && <primitive object={parts.glowMesh} />}
    </group>
  );
};
