import { config } from '@gallery/core/config';
import { DEFAULT_MOOD, MOOD_IDS, type MoodId, templateMoods } from '@gallery/core/templates';
import {
  BODY_KEYS,
  bodyOf,
  buildOf,
  type CharacterId,
  CharacterIdSchema,
  type CharacterKey,
  isDocentId,
} from '@gallery/core/types';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import '../src/ui/tokens.css';
import '../src/ui/themes/modern-history.css';
import { Character } from '../src/viewer/scene/Character.tsx';
import type { CharacterHandle } from '../src/viewer/scene/CharacterFigure.tsx';
import { Stage } from '../src/viewer/scene/Stage.tsx';
import s from '../src/app/visit/walkUi.module.css';

/**
 * `/dev/characters` — 캐릭터 4종 검수(규격 `tools/assets/spec/characters.md` §5, U-07).
 * 같은 빛 아래 나란히 세워 정면·옆·뒤와 동작을 본다. 검수 화면이라 늘 다시 그린다(관람 화면은 `demand`).
 * `?clip=idle|walk|run`(동작), `?angle=0|90|180|270`(돌린 각, 0 = 정면), `?spin=1`(천천히 돎),
 * `?place=hall|plaza`(실내·광장 빛), `?mood=a|b|c|d`(실내 분위기 시안), `?focus=student-f` 등(그 캐릭터 얼굴 가까이),
 * `?wave=1`(4초마다 손 흔들기).
 */

const params = new URLSearchParams(window.location.search);
const moodParam = params.get('mood');
const MOOD: MoodId = (MOOD_IDS as readonly string[]).includes(moodParam ?? '')
  ? (moodParam as MoodId)
  : DEFAULT_MOOD;
const LOOK = templateMoods['modern-history'][MOOD];
const INDOOR = params.get('place') === 'plaza' ? 0 : 1;
const CLIP = params.get('clip');
const ANGLE = (Number(params.get('angle') ?? 0) * Math.PI) / 180;
const SPIN = params.get('spin') === '1';
const WAVE = params.get('wave') === '1';
/** `?wave=1`일 때 손 흔들기 간격(s) */
const WAVE_EVERY_SEC = 4;
/**
 * `?try=<캐릭터 ID>&src=<glb 주소>`: 저장소에 넣기 전 시험 파일(예: Tripo 최적화본 `/@fs/…/.local/art/m4/opt/student-m-01.glb`)을
 * 같은 몸 틀의 지금 파일 옆에 세워 비교한다(M4-5 시험 검수). 없으면 몸 틀 4종
 */
const tryParam = params.get('try') ?? '';
/** 도슨트는 `Character`의 캐릭터 ID가 아니므로 그 몸 틀로 세우고 파일만 시험본으로(키·몸 연출은 몸 틀 것) */
const TRY: CharacterKey | undefined = isDocentId(tryParam)
  ? tryParam
  : CharacterIdSchema.safeParse(tryParam).data;
const TRY_SRC = params.get('src') ?? undefined;
interface Entry {
  /** 줄에서 부르는 이름(`?focus=`) */
  readonly key: CharacterKey;
  readonly character: CharacterId;
  readonly src?: string | undefined;
}
const ENTRIES: readonly Entry[] =
  TRY && TRY_SRC
    ? [
        { key: bodyOf(TRY), character: bodyOf(TRY) },
        { key: TRY, character: isDocentId(TRY) ? bodyOf(TRY) : TRY, src: TRY_SRC },
      ]
    : BODY_KEYS.map(k => ({ key: k, character: k }));
const IDS = ENTRIES.map(e => e.key);
const FOCUS = IDS.indexOf(params.get('focus') as CharacterKey);
/** 나란히 선 간격(m) */
const GAP = 0.9;
/** 천천히 돎(라디안/초) */
const SPIN_RAD_S = 0.6;

const speedOf = (): number => {
  const c = config();
  return CLIP === 'run' ? c.CHAR_RUN_MPS : CLIP === 'walk' ? c.CHAR_WALK_MPS : 0;
};

const Lineup = () => {
  const refs = useRef<(CharacterHandle | null)[]>([]);
  const camera = useThree(st => st.camera);
  useEffect(() => {
    if (FOCUS < 0) {
      camera.position.set(0, 0.95, 2.9);
      camera.lookAt(0, 0.72, 0);
      return;
    }
    // 얼굴 가까이: 키의 0.85 높이를 0.9m 앞에서
    const id = IDS[FOCUS]!;
    const h = config().CHAR_HEIGHT_M[buildOf(id)];
    const x = (FOCUS - (IDS.length - 1) / 2) * GAP;
    camera.position.set(x, h * 0.86, 0.9);
    camera.lookAt(x, h * 0.84, 0);
  }, [camera]);
  useFrame(({ clock }) => {
    const yaw = ANGLE + (SPIN ? clock.elapsedTime * SPIN_RAD_S : 0);
    refs.current.forEach((h, i) => {
      if (!h) return;
      h.pose.x = (i - (IDS.length - 1) / 2) * GAP;
      h.pose.z = 0;
      h.pose.yaw = yaw;
      h.pose.speed = speedOf();
      if (WAVE) h.pose.wave = Math.floor(clock.elapsedTime / WAVE_EVERY_SEC);
    });
  });
  return (
    <>
      {ENTRIES.map((e, i) => (
        <Character
          key={`${e.key}:${i}`}
          character={e.character}
          src={e.src}
          ref={h => {
            refs.current[i] = h;
          }}
        />
      ))}
    </>
  );
};

export const CharactersDev = () => (
  <div className={s.stage} data-theme="modern-history">
    <div className={s.canvasWrap}>
      <Canvas
        frameloop="always"
        dpr={Math.min(window.devicePixelRatio || 1, 2)}
        gl={{ antialias: true, alpha: false, stencil: false }}
        camera={{ fov: config().VFOV_DEG, near: 0.05, far: 60 }}
      >
        <Stage look={LOOK} indoor={INDOOR} />
        <Lineup />
      </Canvas>
    </div>
  </div>
);
