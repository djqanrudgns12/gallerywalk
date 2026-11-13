import { compactPrimitive, getBounds } from '@gltf-transform/functions';

/**
 * Blender 문 조각의 구운 앞면은 그대로 쓰고, 반대편 문과 겹치는 두께 면·문턱만 뺀다.
 * 원본 UV·구운 재질을 공유하므로 벽 밝기 이음새를 바꾸거나 전체를 다시 굽지 않는다.
 * 최적화 전 Blender 원본(지역 좌표 m)에서만 부른다.
 */
export const addCorridorDoor = (doc, manifest) => {
  const name = 'mh_corridor_door_2m';
  if (
    doc
      .getRoot()
      .listNodes()
      .some(n => n.getName() === name)
  )
    return false;
  const source = doc
    .getRoot()
    .listNodes()
    .find(n => n.getName() === 'mh_wall_door_2m');
  if (!source?.getMesh()) throw new Error('Blender 원본에 문 조각이 없습니다');
  const mesh = doc.createMesh(name);
  let triangles = 0;
  for (const prim of source.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const indices = prim.getIndices();
    if (!pos || !indices) throw new Error('문 조각은 위치와 삼각형 인덱스가 있어야 합니다');
    const kept = [];
    const point = [];
    for (let i = 0; i < indices.getCount(); i += 3) {
      const face = [indices.getScalar(i), indices.getScalar(i + 1), indices.getScalar(i + 2)];
      if (face.every(index => pos.getElement(index, point)[2] >= -0.001)) kept.push(...face);
    }
    if (kept.length === 0) continue;
    const copy = prim
      .clone()
      .setIndices(
        doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(indices.getBuffer()),
      );
    compactPrimitive(copy);
    mesh.addPrimitive(copy);
    triangles += kept.length / 3;
  }
  if (triangles === 0) throw new Error('회랑 문틀 앞면이 남지 않았습니다');
  const node = doc.createNode(name).setMesh(mesh).setMatrix(source.getMatrix());
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('Blender 원본 장면이 없습니다');
  scene.addChild(node);
  manifest.modules[name] = {
    ...manifest.modules.mh_wall_door_2m,
    triangles,
    bounds: getBounds(node),
    derivedFrom: 'mh_wall_door_2m',
  };
  return true;
};
