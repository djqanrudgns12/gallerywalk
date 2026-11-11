import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { bakeSkinned } from './peerBody.ts';

/**
 * 뿌리 뼈(원점) + 팔 뼈(위로 1m). 꼭짓점 0·1은 팔 뼈에 온전히, 2는 반반, 3은 뿌리에.
 * 메시는 옮겨 둔 무리 안에 있고 바인드 행렬도 단위가 아니다 — 세 가지가 모두 계산에 들어가게.
 */
const rig = () => {
  const root = new Bone();
  const arm = new Bone();
  arm.position.set(0, 1, 0);
  root.add(arm);
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute([0, 1.5, 0, 0.2, 1.8, 0, 0, 1.2, 0.1, 0.3, 0.2, 0], 3),
  );
  g.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0.25, 0.75], 2));
  g.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute(
    'skinWeight',
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4),
  );
  g.setIndex([0, 1, 2, 2, 1, 3]);
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial());
  mesh.position.set(0.4, 0, -0.3);
  mesh.add(root);
  const holder = new Group();
  holder.position.set(2, 0.5, 1);
  holder.add(mesh);
  holder.updateMatrixWorld(true);
  mesh.bind(new Skeleton([root, arm]));
  return { holder, mesh, arm };
};

describe('bakeSkinned', () => {
  it('굳힌 꼭짓점이 three.js의 스킨 계산(getVertexPosition)과 같은 자리 — 무리·메시 자리까지', () => {
    const { holder, mesh, arm } = rig();
    arm.rotation.z = Math.PI / 2;
    holder.updateMatrixWorld(true);
    const baked = bakeSkinned(mesh);
    const pos = baked.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const want = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
      const got = new Vector3().fromBufferAttribute(pos, i);
      expect(got.distanceTo(want)).toBeLessThan(1e-5);
    }
  });

  it('법선도 뼈 회전을 따른다(팔 뼈 90° → 위(+Y) 법선이 −X)', () => {
    const { holder, mesh, arm } = rig();
    arm.rotation.z = Math.PI / 2;
    holder.updateMatrixWorld(true);
    const n = bakeSkinned(mesh).getAttribute('normal');
    expect(n.getX(0)).toBeCloseTo(-1, 5);
    expect(n.getY(0)).toBeCloseTo(0, 5);
    // 뿌리 뼈에만 붙은 꼭짓점의 법선은 그대로
    expect(n.getZ(3)).toBeCloseTo(1, 5);
  });

  it('쉼 자세면 바인드 때 자리 그대로, UV·삼각형 순서는 바뀌지 않는다', () => {
    const { mesh } = rig();
    const baked = bakeSkinned(mesh);
    const pos = baked.getAttribute('position');
    const src = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const want = new Vector3().fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
      expect(new Vector3().fromBufferAttribute(pos, i).distanceTo(want)).toBeLessThan(1e-5);
    }
    expect([...baked.getAttribute('uv').array]).toEqual([...mesh.geometry.getAttribute('uv').array]);
    expect([...baked.getIndex()!.array]).toEqual([0, 1, 2, 2, 1, 3]);
    expect(baked.getAttribute('skinIndex')).toBeUndefined();
  });
});
