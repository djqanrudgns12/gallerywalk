"""v4 전시실 조각과 공용 굽기 실행기. 치수는 contract.json의 v4에서 읽는다.

실행: Blender -b --factory-startup --python-exit-code 1 -P room_v4.py -- --out <폴더>
원본·노출·검수 그림은 .local에 남기며, 앱 반영은 pipeline/build.mjs --v4가 맡는다.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as bake
import geometry
import textures
from geometry import Builder


def face(b, x0, x1, z0, z1, slot):
    if x1 > x0 and z1 > z0:
        b.face_n([(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)], slot, (0, -1, 0))


def strip(b, x0, x1, z, height, depth, slot):
    b.box(x0, x1, -depth, 0, z, z + height, slot, skip=('back',))


def crown(b, x0, x1, h, slot):
    b.prism_x([(0, h - .22), (-.025, h - .20), (-.08, h - .12),
               (-.14, h - .05), (-.14, h), (0, h)], x0, x1, slot, caps=False)


def surround(b, w, clear, h, slot):
    """세 단 테는 맑은 열림 바깥·벽 앞에만 둔다. 두께 면과 구분한다."""
    a, z = (w - clear) / 2, h
    band = min(a / 3, .065)
    for i in range(3):
        outer = a - band * (i + 1)
        inner = a - band * i
        depth = .045 + i * .025
        b.box(outer, inner, -depth, 0, 0, z + band * i, slot, skip=('back', 'bottom'))
        b.box(w - inner, w - outer, -depth, 0, 0, z + band * i, slot, skip=('back', 'bottom'))
        b.box(outer, w - outer, -depth, 0, z + band * i, z + band * (i + 1), slot, skip=('back',))


def reveal(b, w, clear, h, depth, side_slot, floor_slot):
    """벽 뒤(+Y)에만 통로 네 면. 두 번째 방의 안쪽 면까지 한 조각이 소유한다."""
    a, d = (w - clear) / 2, depth
    b.face_n([(a, 0, 0), (a, d, 0), (a, d, h), (a, 0, h)], side_slot, (1, 0, 0))
    b.face_n([(w-a, 0, 0), (w-a, d, 0), (w-a, d, h), (w-a, 0, h)], side_slot, (-1, 0, 0))
    b.face_n([(a, 0, h), (w-a, 0, h), (w-a, d, h), (a, d, h)], side_slot, (0, 0, -1))
    b.face_n([(a, 0, 0), (w-a, 0, 0), (w-a, d, 0), (a, d, 0)], floor_slot, (0, 0, 1))


def wall(c, key, width):
    v = c['v4']; h = v['layout']['roomHeight']
    b = Builder(v['geometry']['modules'][key], ('M_Plaster', 'M_Panel', 'M_Brass', 'M_Glass'))
    face(b, 0, width, 1.1, h, 'M_Plaster')
    strip(b, 0, width, 0, 1.1, .025, 'M_Panel')
    for i in range(int(width)):
        b.box(i + .09, i + .91, -.042, -.025, .2, .98, 'M_Panel', skip=('back',))
    strip(b, 0, width, 0, .16, .055, 'M_Panel')
    strip(b, 0, width, 1.08, .06, .065, 'M_Brass')
    crown(b, 0, width, h, 'M_Plaster')
    # 코브의 빛 출처와 레일. 실제 조명은 굽기 때만 만든다.
    strip(b, 0, width, h - .23, .025, .085, 'M_Glass')
    b.box(0, width, -.65, -.60, h - .24, h - .18, 'M_Brass')
    for i in range(int(width / c['config']['MODULE_UNIT_M'])):
        x = (i + .5) * c['config']['MODULE_UNIT_M']
        b.cylinder((x, -.625, h-.24), (x, -.46, h-.45), .075, .09, 12, 'M_Brass')
        b.cylinder((x, -.46, h-.45), (x, -.45, h-.465), .075, .075, 12, 'M_Glass')
    return b.finish()


def doorway(c, key, opening, depth):
    v = c['v4']; h = v['layout']['roomHeight']
    w, clear, dh = opening['w'], opening['clear'], opening['h']
    b = Builder(v['geometry']['modules'][key], ('M_Plaster', 'M_Panel', 'M_Brass', 'M_Stone'))
    a = (w-clear)/2
    for x0, x1 in ((0, a), (w-a, w)):
        face(b, x0, x1, 0, 1.1, 'M_Panel')
        face(b, x0, x1, 1.1, h, 'M_Plaster')
    face(b, a, w-a, dh, h, 'M_Plaster')
    crown(b, 0, w, h, 'M_Plaster')
    surround(b, w, clear, dh, 'M_Brass')
    if depth:
        reveal(b, w, clear, dh, depth, 'M_Stone', 'M_Panel')
    return b.finish()


def corner(c):
    v = c['v4']; h = v['layout']['roomHeight']
    b = Builder(v['geometry']['modules']['roomCornerIn'], ('M_Panel', 'M_Plaster'))
    b.box(0, .08, -.08, 0, 0, 1.15, 'M_Panel', skip=('back', 'bottom'))
    b.box(0, .08, -.08, 0, 1.15, h, 'M_Plaster', skip=('back', 'top'))
    return b.finish()


def ceiling(c):
    v = c['v4']; h = v['layout']['roomHeight']; t = c['geometry']['tileM']
    b = Builder(v['geometry']['modules']['roomCeiling'], ('M_Ceiling',))
    b.face_n([(0, 0, h+.12), (t, 0, h+.12), (t, -t, h+.12), (0, -t, h+.12)], 'M_Ceiling', (0,0,-1))
    for x0, x1, y0, y1 in ((0,t,-.08,0),(0,t,-t,-t+.08),(0,.08,-t+.08,-.08),(t-.08,t,-t+.08,-.08)):
        b.box(x0,x1,y0,y1,h,h+.12,'M_Ceiling',skip=('top',))
    return b.finish()


def modules(c):
    l = c['v4']['layout']; u = c['config']['MODULE_UNIT_M']; t = c['config']['WALL_THICKNESS_M']
    return [wall(c, 'roomWall4', u*2), wall(c, 'roomWall2', u), corner(c), ceiling(c),
            doorway(c, 'roomPortal', l['portal'], t),
            doorway(c, 'enfiladeDoor', l['enfilade'], t+l['roomGap']),
            doorway(c, 'enfiladeFrame', l['enfilade'], 0)]


def albedos(out):
    """PRD_V2 §3 팔레트. v3의 주기 질감을 공유하고 이 묶음의 기본색만 바꾼다."""
    palette = {'M_Plaster': '#1E1C1A', 'M_Panel': '#3A2E25', 'M_Ceiling': '#292622',
               'M_Stone': '#E9E1D3', 'M_Ashlar': '#E9E1D3', 'M_Marble': '#E9E1D3',
               'M_Floor': '#E9E1D3', 'M_Paving': '#B9AE9C', 'M_Bronze': '#6E5A3C', 'M_Hedge': '#3E4A35'}
    result = {}
    for slot, value in palette.items():
        arr = textures.MAKERS[slot](1024)
        rgb = np.array([int(value[i:i+2],16)/255 for i in (1,3,5)], dtype=np.float32)
        arr = np.clip(arr / np.maximum(arr.mean(axis=(0,1)), .001) * rgb, 0, 1)
        result[slot] = bake.save_image(slot + '_v4', arr, os.path.join(out,'textures',slot+'.png'))
    return result


def context(c, obj, bundle):
    """이웃·바닥·천장·맞은편 벽을 포함한 조명틀. 양옆 길이·레일 리듬은 v3와 같다."""
    v = c['v4']; l = v['layout']; e = v['geometry']['base']['exterior']
    if bundle == 'exterior-v4':
        bake.sky_world()
        z = -e['steps']*e['stepRiseM'] if obj.name in (v['geometry']['base']['modules']['portico'],v['geometry']['base']['modules']['stairs']) else 0
        made = [bake.ground(z, half=60), bake.sun_from((0,-1))]
        if obj.name == v['geometry']['base']['modules']['facadeWall2']:
            made += bake.linked_copies(obj, [(x,0) for x in (-8,-6,-4,-2,2,4,6,8)])
        return made
    bake.interior_world()
    h = l['roomHeight'] if bundle == 'core-v4' else l['hall']['h']
    depth = l['room']['S']['d'] if bundle == 'core-v4' else l['hall']['w']
    ceiling_piece = 'ceiling' in obj.name or 'skylight' in obj.name
    width = c['config']['MODULE_UNIT_M'] * (2 if obj.name.endswith('_4m') else 1)
    side = bake.CONTEXT_SIDE_M
    x0, x1 = -side, width+side
    made = [bake.ground(0, half=depth*2),
            bake.plane('맞은편',[(x0,-depth,0),(x0,-depth,h),(x1,-depth,h),(x1,-depth,0)],'M_Plaster')]
    if not ceiling_piece:
        made.append(bake.plane('천장',[(x0,0,h),(x0,-depth,h),(x1,-depth,h),(x1,0,h)],'M_Ceiling'))
    if 'wall_' in obj.name:
        made += bake.linked_copies(obj, [(s*width*i,0) for i in range(1,math.ceil(side/width)+1) for s in (-1,1)])
    else:
        for a,b in ((x0,0),(width,x1)):
            made.append(bake.plane('이웃벽',[(a,0,0),(b,0,0),(b,0,h),(a,0,h)],'M_Plaster'))
    lamp = bake.laylight(x0,x1,-depth+1,-1)
    lamp.location.z = h-.14
    made.append(lamp)
    if bundle == 'core-v4':
        made.append(bake.plane('코브빛',[(x0,-.1,h-.28),(x1,-.1,h-.28),(x1,-.16,h-.28),(x0,-.16,h-.28)],'M_Plaster',emission=bake.LAYLIGHT_RADIANCE))
    if 'portal' in obj.name or 'door' in obj.name or 'entrance' in obj.name:
        d = c['config']['WALL_THICKNESS_M'] + l['roomGap'] + 1
        made.append(bake.plane('문바깥빛',[(0,d,0),(width,d,0),(width,d,h),(0,d,h)],'M_Plaster',emission=bake.OUTSIDE_RADIANCE))
    return made


def previews(objs, bundle, out):
    """구운 기본색×빛으로 조각 비교판 두 장. 런타임·조립 검수와는 별도다."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.render.resolution_x = 1800; scene.render.resolution_y = 1200; scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    old = {o: o.matrix_world.copy() for o in objs}
    # 내보내기 뒤 복제 재질로만 바꿔 검수 장면에 구운 빛을 보인다.
    for obj in objs:
        for i, material in enumerate(list(obj.data.materials)):
            mat = material.copy(); obj.data.materials[i] = mat
            nt = mat.node_tree; bsdf = nt.nodes.get('Principled BSDF')
            em = nt.nodes.new('ShaderNodeEmission')
            base = bsdf.inputs['Base Color']
            group = next((n for n in nt.nodes if n.type == 'GROUP' and n.node_tree.name == 'glTF Material Output'),None)
            if base.is_linked:
                base_node = base.links[0].from_socket
                if group:
                    mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
                    nt.links.new(base_node,mix.inputs[1]); nt.links.new(group.inputs['Occlusion'].links[0].from_socket,mix.inputs[2])
                    nt.links.new(mix.outputs[0],em.inputs['Color'])
                else:
                    nt.links.new(base_node,em.inputs['Color'])
            else:
                em.inputs['Color'].default_value=bsdf.inputs['Emission Color'].default_value if mat.name.startswith('M_Glass') else base.default_value
            em.inputs['Strength'].default_value=1.4
            nt.links.new(em.outputs[0],nt.nodes.get('Material Output').inputs['Surface'])
    columns = {'core-v4': 4, 'hall-v4': 5, 'exterior-v4': 3}[bundle]
    sizes=[]
    for obj in objs:
        if 'ceiling' in obj.name or 'skylight' in obj.name or 'floor' in obj.name:
            obj.rotation_euler.x=math.pi/2 if 'floor' in obj.name else -math.pi/2
        bpy.context.view_layer.update()
        bb=[obj.matrix_world@Vector(v) for v in obj.bound_box]
        sizes.append([max(p[k] for p in bb)-min(p[k] for p in bb) for k in range(3)])
    cell_x=max(s[0] for s in sizes)+1.5
    cell_z=max(s[2] for s in sizes)+1.5
    points=[]
    for i,obj in enumerate(objs):
        obj.hide_render=False
        # 실제 크기로 칸 간격을 정해 정면에서도 작은 조각을 읽을 수 있게 둔다.
        if 'ceiling' in obj.name or 'skylight' in obj.name or 'floor' in obj.name:
            obj.rotation_euler.x=math.pi/2 if 'floor' in obj.name else -math.pi/2
        bpy.context.view_layer.update()
        bb=[obj.matrix_world@Vector(v) for v in obj.bound_box]
        mn=Vector(tuple(min(p[k] for p in bb) for k in range(3)))
        obj.location += Vector(((i%columns)*cell_x,0,(i//columns)*cell_z))-mn
        bpy.context.view_layer.update()
        points.extend(obj.matrix_world@Vector(v) for v in obj.bound_box)
    low=Vector(tuple(min(p[k] for p in points) for k in range(3)))
    high=Vector(tuple(max(p[k] for p in points) for k in range(3)))
    center=(low+high)/2
    data=bpy.data.cameras.new('검수카메라'); cam=bpy.data.objects.new('검수카메라',data)
    scene.collection.objects.link(cam); scene.camera=cam; data.type='ORTHO'
    os.makedirs(out,exist_ok=True)
    for tag,direction in (('front',Vector((0,-1,.08))),('45',Vector((1,-1,.65)).normalized())):
        cam.location=center+direction*180
        cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.view_layer.update()
        local=[cam.matrix_world.inverted()@p for p in points]
        data.ortho_scale=max((max(p.x for p in local)-min(p.x for p in local)),(max(p.y for p in local)-min(p.y for p in local))*1.5)*1.12
        scene.render.filepath=os.path.join(out,f'{bundle}-{tag}.png')
        bpy.ops.render.render(write_still=True)
    bake.remove([cam])
    for obj,matrix in old.items(): obj.matrix_world=matrix


def main():
    from hall_v4 import modules as hall_modules
    from exterior_v4 import modules as exterior_modules
    argv=sys.argv[sys.argv.index('--')+1:]
    p=argparse.ArgumentParser(); p.add_argument('--out',required=True); p.add_argument('--review',required=True); p.add_argument('--review-only',action='store_true'); p.add_argument('--only',default='core-v4,hall-v4,exterior-v4'); p.add_argument('--skip-review',action='store_true')
    args=p.parse_args(argv); out=os.path.abspath(args.out)
    with open(os.path.join(out,'contract.json'),encoding='utf-8') as f: c=json.load(f)
    bake.setup_scene()
    if args.review_only:
        with open(os.path.join(out,'manifest-v4.json'),encoding='utf-8') as f: manifest=json.load(f)
        albedo={file[:-4]:bpy.data.images.load(os.path.join(out,'textures',file)) for file in os.listdir(os.path.join(out,'textures')) if file.endswith('.png')}
        for bundle,sec in manifest['bundles'].items():
            bpy.ops.import_scene.gltf(filepath=os.path.join(out,'modern-history-'+bundle+'.glb'))
            objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
            for obj in objs:
                info=sec['modules'][obj.name]
                lm=bpy.data.images.load(os.path.join(out,'lightmaps',obj.name+'.png')) if info['lightmap'] else None
                if lm: lm.colorspace_settings.name='Non-Color'
                slots=[m.name.split('__')[0] for m in obj.data.materials]
                mats=[bake.export_material(s,obj.name,albedo,lm) for s in slots]
                if obj.name == c['v4']['geometry']['modules']['hallSkylight']:
                    for mat in mats:
                        if mat.name.startswith('M_Glass'):
                            mat.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(.80,.88,1.0,1.0)
                bake.assign(obj,mats)
            previews(objs,bundle,args.review)
            bake.remove(objs)
        print('[v4] 기존 원본으로 검수 렌더 완료',flush=True)
        return
    albedo=albedos(out)
    manifest={'template':'modern-history','baked':True,'samples':512,'bundles':{}}
    selected=set(args.only.split(','))
    if not selected <= {'core-v4','hall-v4','exterior-v4'}: raise ValueError('알 수 없는 v4 묶음')
    if selected != {'core-v4','hall-v4','exterior-v4'}:
        with open(os.path.join(out,'manifest-v4.json'),encoding='utf-8') as f: manifest=json.load(f)
    interior_gain=manifest.get('bundles',{}).get('core-v4',{}).get('exposure',{}).get('gain')
    for bundle,make in (('core-v4',modules),('hall-v4',hall_modules),('exterior-v4',exterior_modules)):
        if bundle not in selected: continue
        objs=make(c); raw={}; sec={'modules':{}}
        for obj in objs:
            slots=bake.slot_names(obj)
            lm='floor' not in obj.name
            size=2048 if 'portico' in obj.name else (1024 if obj.name.endswith('_4m') or 'stairs' in obj.name else 512)
            sec['modules'][obj.name]={'slots':slots,'triangles':bake.triangles(obj),'lightmap':lm,'lightmapPx':size}
            if lm: bake.set_uv1_smart(obj,bake.EXT_LM_MARGIN[size]) if bundle=='exterior-v4' else bake.set_uv1(obj)
        for obj in objs:
            info=sec['modules'][obj.name]
            if not info['lightmap']: continue
            for other in objs: other.hide_render=other!=obj
            bake.assign(obj,[bake.gray_material(s,bpy.data.images.new('굽기대상',4,4)) for s in info['slots']])
            ctx=context(c,obj,bundle)
            samples=512*(bake.CEILING_SAMPLES_X if 'ceiling' in obj.name else 1)
            print(f'[v4] 굽기 {obj.name}: {info["lightmapPx"]}px / {samples} 표본',flush=True)
            raw[obj.name]=bake.bake_light(obj,info['lightmapPx'],samples,color=bundle=='exterior-v4',ao=bake.EXTERIOR_AO if bundle=='exterior-v4' else bake.INTERIOR_AO)
            bake.remove(ctx); obj.location=(0,0,0)
            # 완성한 빛 배열은 디스크에도 남겨 굽기 증거를 보존한다.
            np.save(os.path.join(out,obj.name+'.npy'),raw[obj.name])
        if bundle=='core-v4' or bundle=='exterior-v4':
            key='roomWall4' if bundle=='core-v4' else 'facadeWall2'
            names=c['v4']['geometry']['modules'] if bundle=='core-v4' else c['v4']['geometry']['base']['modules']
            refobj=next(o for o in objs if o.name==names[key]); at=bake.uv1_sampler(refobj)
            base=0 if bundle=='core-v4' else c['v4']['geometry']['base']['exterior']['steps']*c['v4']['geometry']['base']['exterior']['stepRiseM']
            ref=float(np.mean([bake.sample(raw[refobj.name],at((x,0,z+base))) for x in np.linspace(.4,1.6,9) for z in np.linspace(1.3,2.3,9)]))
            gain=-math.log(1-bake.EXPOSURE_REF_OUT)/max(ref,1e-9)
            if bundle=='core-v4': interior_gain=gain
        else:
            gain=interior_gain
        sec['exposure']={'gain':gain,'curve':'1-exp(-gain*x)'}
        for obj in objs:
            info=sec['modules'][obj.name]; lm=None
            if info['lightmap']:
                arr=1-np.exp(-gain*np.maximum(raw[obj.name],0))
                lm=bake.save_image('LM_'+obj.name,arr,os.path.join(out,'lightmaps',obj.name+'.png'),non_color=True)
                info['lightmapMean']=float(arr.mean())
            mats=[bake.export_material(s,obj.name,albedo,lm) for s in info['slots']]
            if obj.name == c['v4']['geometry']['modules']['hallSkylight']:
                for mat in mats:
                    if mat.name.startswith('M_Glass'):
                        mat.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(.80,.88,1.0,1.0)
            bake.assign(obj,mats); obj.hide_render=False
            obj['v4_baked']=True; obj['v4_gain']=gain; obj['v4_bundle']=bundle
            info['bounds']=bake.bounds_of(obj)
        for obj in bpy.context.scene.objects: obj.select_set(obj in objs)
        bpy.ops.export_scene.gltf(filepath=os.path.join(out,'modern-history-'+bundle+'.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_lights=False,export_cameras=False)
        manifest['bundles'][bundle]=sec
        with open(os.path.join(out,'manifest-v4.json'),'w',encoding='utf-8') as f: json.dump(manifest,f,ensure_ascii=False,indent=2)
        if not args.skip_review: previews(objs,bundle,args.review)
        bake.remove(objs)
    print('[v4] 선택한 조각 굽기 완료',flush=True)


if __name__=='__main__': main()
