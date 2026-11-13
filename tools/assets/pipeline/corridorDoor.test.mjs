import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { addCorridorDoor } from './corridorDoor.mjs';

test('회랑 문틀은 원래 구운 표면·UV를 보존하고 두께 면만 제거한다', () => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 0, -0.3]))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType('VEC2')
    .setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
    .setBuffer(buffer);
  const material = doc.createMaterial('구운 재질');
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('TEXCOORD_1', uv)
    .setIndices(indices)
    .setMaterial(material);
  const source = doc.createNode('mh_wall_door_2m').setMesh(doc.createMesh().addPrimitive(prim));
  doc.createScene().addChild(source);
  const manifest = { modules: { mh_wall_door_2m: { triangles: 2, lightmap: true, lightmapMean: 0.6 } } };
  assert.equal(addCorridorDoor(doc, manifest), true);
  const door = doc
    .getRoot()
    .listNodes()
    .find(n => n.getName() === 'mh_corridor_door_2m');
  const part = door.getMesh().listPrimitives()[0];
  assert.equal(part.getIndices().getCount(), 3);
  assert.equal(part.getAttribute('POSITION').getCount(), 3);
  assert.equal(part.getAttribute('POSITION').getMin([])[2], 0);
  assert.deepEqual([...part.getAttribute('TEXCOORD_1').getArray()], [0, 0, 1, 0, 1, 1]);
  assert.equal(part.getMaterial(), material);
  assert.equal(manifest.modules.mh_corridor_door_2m.lightmapMean, 0.6);
  assert.equal(prim.getIndices().getCount(), 6);
  assert.equal(prim.getAttribute('POSITION').getCount(), 4);
  assert.equal(addCorridorDoor(doc, manifest), false);
});
