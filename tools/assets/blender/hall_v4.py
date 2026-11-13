"""v4 메인홀: 석회암 벽·대리석 포털·벽기둥·격자 천장·천창·바닥."""
from geometry import Builder
from room_v4 import face, strip, crown, surround, reveal


def wall(c, key, width):
    v=c['v4']; h=v['layout']['hall']['h']
    b=Builder(v['geometry']['modules'][key],('M_Ashlar','M_Marble','M_Stone'))
    face(b,0,width,1.2,h,'M_Ashlar')
    strip(b,0,width,0,1.2,.035,'M_Marble')
    strip(b,0,width,0,.16,.065,'M_Stone')
    strip(b,0,width,1.17,.08,.07,'M_Stone')
    strip(b,0,width,4.6,.13,.12,'M_Stone')
    crown(b,0,width,9.4,'M_Stone')
    return b.finish()


def portal(c,key):
    v=c['v4']; p=v['layout']['portal']; h=v['layout']['hall']['h']
    w,clear,dh=p['w'],p['clear'],p['h']; a=(w-clear)/2
    trim='M_Bronze' if key=='hallEntrance' else 'M_Marble'
    b=Builder(v['geometry']['modules'][key],('M_Ashlar',trim,'M_Stone'))
    face(b,0,a,0,h,'M_Ashlar'); face(b,w-a,w,0,h,'M_Ashlar'); face(b,a,w-a,dh,h,'M_Ashlar')
    surround(b,w,clear,dh,trim)
    if key == 'hallEntrance':
        reveal(b,w,clear,dh,c['config']['WALL_THICKNESS_M'],'M_Stone','M_Stone')
    strip(b,0,w,dh+.2,.22,.12,'M_Stone')
    # 레터링은 사인 렌더러가 그린다. 받이만 두며 벽 뒤 두께 면은 만들지 않는다.
    strip(b,.1,w-.1,v['layout']['portalLetteringY']-.25,.5,v['geometry']['base']['fixtures']['wallOffsetM']/2,'M_Stone')
    crown(b,0,w,9.4,'M_Stone')
    return b.finish()


def pilaster(c):
    v=c['v4']; h=v['layout']['hall']['h']
    b=Builder(v['geometry']['modules']['hallPilaster'],('M_Stone','M_Brass','M_Glass'))
    b.box(-.3,.3,-.25,0,0,.28,'M_Stone',skip=('back','bottom'))
    b.box(-.24,.24,-.18,0,.28,h-.6,'M_Stone',skip=('back','top','bottom'))
    for x in (-.15,0,.15):
        b.box(x-.025,x+.025,-.2,-.18,.4,h-.75,'M_Stone',skip=('back','top','bottom'))
    b.box(-.3,.3,-.25,0,h-.6,h,'M_Stone',skip=('back','top'))
    b.box(-.1,.1,-.23,-.18,h-1.35,h-.66,'M_Brass',skip=('back',))
    b.box(-.065,.065,-.25,-.23,h-1.25,h-.76,'M_Glass',skip=('back',))
    return b.finish()


def corner(c):
    v=c['v4']; h=v['layout']['hall']['h']
    b=Builder(v['geometry']['modules']['hallCornerIn'],('M_Stone',))
    b.box(0,.12,-.12,0,0,h,'M_Stone',skip=('back','bottom','top'))
    return b.finish()


def ceiling(c, skylight=False):
    v=c['v4']; h=v['layout']['hall']['h']; t=c['geometry']['tileM']
    key='hallSkylight' if skylight else 'hallCeiling'
    slots=('M_Glass','M_Iron') if skylight else ('M_Stone','M_Ceiling')
    b=Builder(v['geometry']['modules'][key],slots)
    rim=.1
    if skylight:
        b.face_n([(rim,-rim,h+.3),(t-rim,-rim,h+.3),(t-rim,-t+rim,h+.3),(rim,-t+rim,h+.3)],'M_Glass',(0,0,-1))
        b.box(t/2-.025,t/2+.025,-t+rim,-rim,h+.2,h+.3,'M_Iron',skip=('top',))
        b.box(rim,t-rim,-t/2-.025,-t/2+.025,h+.2,h+.3,'M_Iron',skip=('top',))
    else:
        b.face_n([(rim,-rim,h+.3),(t-rim,-rim,h+.3),(t-rim,-t+rim,h+.3),(rim,-t+rim,h+.3)],'M_Ceiling',(0,0,-1))
    material='M_Iron' if skylight else 'M_Stone'
    for x0,x1,y0,y1 in ((0,t,-rim,0),(0,t,-t,-t+rim),(0,rim,-t+rim,-rim),(t-rim,t,-t+rim,-rim)):
        b.box(x0,x1,y0,y1,h,h+.3,material,skip=('top',))
    return b.finish()


def floor(c):
    v=c['v4']; t=c['geometry']['tileM']; rim=.06
    b=Builder(v['geometry']['modules']['hallFloor'],('M_Floor','M_Bronze'))
    # 서로 겹치지 않는 다섯 면. 같은 칸을 이어 붙이면 축·베이 띠가 연결된다.
    for x0,x1,y0,y1,slot in ((rim,t-rim,-t+rim,-rim,'M_Floor'),(0,t,-rim,0,'M_Bronze'),(0,t,-t,-t+rim,'M_Bronze'),(0,rim,-t+rim,-rim,'M_Bronze'),(t-rim,t,-t+rim,-rim,'M_Bronze')):
        b.face_n([(x0,y0,0),(x1,y0,0),(x1,y1,0),(x0,y1,0)],slot,(0,0,1))
    return b.finish()


def modules(c):
    u=c['config']['MODULE_UNIT_M']
    return [wall(c,'hallWall4',u*2),wall(c,'hallWall2',u),corner(c),portal(c,'hallPortal'),
            portal(c,'hallEntrance'),pilaster(c),ceiling(c),ceiling(c,True),floor(c)]
