"""v4 외관: 24m 현관·16단 계단·날개 벽·석재 난간·열린 대문."""
import math
from geometry import Builder
from exterior import doric_column, coffers, portal as bronze_portal
from room_v4 import face, strip, crown


def spec(c):
    v=c['v4']; e=v['geometry']['base']['exterior']
    return v,e,v['geometry']['base']['modules'],e['steps']*e['stepRiseM']


def portico(c):
    v,e,names,rise=spec(c); w=e['porticoW']; d=e['porticoD']; hw=w/2; h=e['porticoCeilingY']
    b=Builder(names['portico'],('M_Stone','M_Ashlar','M_Paving','M_Bronze'))
    b.face_n([(-hw,0,0),(hw,0,0),(hw,d,0),(-hw,d,0)],'M_Paving',(0,0,1))
    for sign in (-1,1):
        x=sign*hw
        b.face_n([(x,0,-rise),(x,d,-rise),(x,d,0),(x,0,0)],'M_Ashlar',(sign,0,0))
    # 높이를 늘려 변형하는 대신 계약 높이에서 기둥 몸통·머리·프리즈를 다시 저작한다.
    shaft_top=e['signY']-.8
    for x in e['columnXs']:
        for sign in (-1,1):
            cx=sign*x; cy=e['columnInsetM']; diameter=e['columnDiameterM']
            doric_column(b,cx,cy,diameter,shaft_top)
    # 기존 홈 기둥 위에 간결한 이오니아식 소용돌이 두 개씩.
            for dx in (-diameter*.32,diameter*.32):
                b.cylinder((cx+dx,cy-diameter*.46,shaft_top+.17),(cx+dx,cy-diameter*.59,shaft_top+.17),.14,.14,16,'M_Stone')
    # 엔타블러처 앞면의 평평한 프리즈는 signY에 맞춘다.
    b.box(-hw,hw,0,1.5,shaft_top+.3,h,'M_Stone',skip=('bottom',))
    for z in (shaft_top+.3,e['signY']-.4,e['signY']+.4,h-.12):
        b.box(-hw,hw,-.08,0,z,z+.08,'M_Stone',skip=('back',))
    for sign in (-1,1):
        x0,x1=(hw-.5,hw) if sign==1 else (-hw,-hw+.5)
        b.box(x0,x1,1.5,d,h-.2,h,'M_Stone',skip=('top',))
    coffers(b,-hw+.5,hw-.5,1.5,d,h,8,2,.12,.2)
    apex=h+hw*math.tan(math.radians(13))
    for y,toward in ((0,(0,-1,0)),(d,(0,1,0))):
        b.face_n([(-hw,y,h),(hw,y,h),(0,y,apex)],'M_Stone',toward)
    for sign in (-1,1):
        x=sign*hw
        b.face_n([(x,0,h),(0,0,apex),(0,d,apex),(x,d,h)],'M_Stone',(sign,0,1))
        b.beam((x,0,h+.04),(0,0,apex+.04),.12,.14,'M_Stone')
    p=v['layout']['portal']; a=p['clear']/2
    for x0,x1 in ((-hw,-a),(a,hw)):
        b.face_n([(x0,d,0),(x1,d,0),(x1,d,h),(x0,d,h)],'M_Ashlar',(0,-1,0))
    b.face_n([(-a,d,p['h']),(a,d,p['h']),(a,d,h),(-a,d,h)],'M_Ashlar',(0,-1,0))
    bronze_portal(b,d,a,p['h'])
    return b.finish()


def stairs(c):
    v,e,names,rise=spec(c); hw=e['porticoW']/2; run=e['stepRunM']; step=e['stepRiseM']
    b=Builder(names['stairs'],('M_Stone','M_Glass'))
    for k in range(e['steps']):
        y0,y1=-(k+1)*run,-k*run; z=-k*step
        b.face_n([(-hw,y0,z),(hw,y0,z),(hw,y1,z),(-hw,y1,z)],'M_Stone',(0,0,1))
        b.face_n([(-hw,y0,z-step),(hw,y0,z-step),(hw,y0,z),(-hw,y0,z)],'M_Stone',(0,-1,0))
        # 디딤판 아래 띠: 앞면과 겹치지 않는 얕은 돌출.
        b.box(-hw+.45,hw-.45,y0-.002,y0,z-.045,z-.025,'M_Glass',skip=('back',))
        for x0,x1 in ((-hw,-hw+.38),(hw-.38,hw)):
            b.box(x0,x1,y0,y1,-rise,z+1.2,'M_Stone',skip=('bottom',))
    return b.finish()


def facade(c):
    v,e,names,rise=spec(c); h=rise+v['layout']['hall']['h']+c['config']['MODULE_UNIT_M']; w=c['config']['MODULE_UNIT_M']
    b=Builder(names['facadeWall2'],('M_Ashlar','M_Stone','M_Bronze'),uv_origin=(0,0,rise))
    face(b,0,w,0,h,'M_Ashlar')
    for z in (rise-.2,rise+1.2,h-.4): strip(b,0,w,z,.2,.14,'M_Stone')
    # 현수막 고정구만 둔다. 글판은 별도 사인 렌더러가 소유한다.
    for z in (rise+5,rise+8):
        b.box(w/2-.035,w/2+.035,-.35,0,z,z+.06,'M_Bronze')
    return b.finish()


def end(c):
    v,e,names,rise=spec(c); h=rise+v['layout']['hall']['h']+c['config']['MODULE_UNIT_M']
    b=Builder(names['facadeEnd'],('M_Stone',),uv_origin=(0,0,rise))
    b.box(-.16,.16,-.16,.16,0,h,'M_Stone',skip=('top','bottom'))
    for z in (rise-.2,rise+1.2,h-.4):
        b.box(-.23,.23,-.23,.23,z,z+.2,'M_Stone')
    return b.finish()


def balustrade(c):
    v,e,names,rise=spec(c); w=c['config']['MODULE_UNIT_M']
    b=Builder(names['hedge2'],('M_Stone','M_Hedge'))
    b.box(0,w,0,.3,0,.13,'M_Stone',skip=('bottom',))
    b.box(0,w,-.025,.325,.78,.9,'M_Stone')
    for x in (.58,.94,1.3,1.66):
        b.lathe([(.075,.13),(.095,.20),(.06,.3),(.055,.63),(.085,.7),(.09,.78)],12,'M_Stone',center=(x,.15),cap_bottom=True,cap_top=True)
    # 기둥은 시작 쪽 하나만 둔다. 이웃 2m 조각과의 중복을 막는다.
    b.box(0,.3,-.025,.325,.13,.78,'M_Stone')
    b.lathe([(.1,.9),(.12,.95),(.17,1.15),(.18,1.2),(.13,1.2),(.11,1.0)],16,'M_Stone',center=(.20,.15),cap_bottom=True)
    b.lathe([(.02,1.06),(.13,1.2),(.13,1.29),(.07,1.36),(.001,1.38)],12,'M_Hedge',center=(.20,.15),cap_top=True)
    return b.finish()


def gate(c):
    v,e,names,rise=spec(c); w=v['layout']['gate']['w']; hw=w/2
    b=Builder(v['geometry']['modules']['gate'],('M_Stone','M_Iron','M_Glass'))
    for sign in (-1,1):
        x=sign*(hw-.3)
        b.box(x-.3,x+.3,-.3,.3,0,2.8,'M_Stone',skip=('bottom',))
        b.box(x-.3,x+.3,-.34,.34,2.8,2.95,'M_Stone')
        b.box(x-.13,x+.13,-.13,.13,3.03,3.45,'M_Glass')
        b.box(x-.18,x+.18,-.18,.18,2.95,3.03,'M_Iron')
        b.box(x-.18,x+.18,-.18,.18,3.45,3.53,'M_Iron')
        # 문짝은 광장 안쪽으로 90도 열려서 문기둥 사이 통행 폭을 보존한다.
        gx=sign*(hw-.65)
        for z in (.2,1.0,2.2): b.beam((gx,0,z),(gx,-hw,z),.055,.055,'M_Iron')
        for i in range(9):
            y=-hw*i/8
            b.cylinder((gx,y,.2),(gx,y,2.35),.018,.018,8,'M_Iron')
            b.cylinder((gx,y,2.35),(gx,y,2.45),.05,0,8,'M_Iron')
    return b.finish()


def modules(c):
    return [portico(c),stairs(c),facade(c),end(c),balustrade(c),gate(c)]
