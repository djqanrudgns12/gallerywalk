import { copy } from '@gallery/core/copy';
import { useEffect, useRef, useState } from 'react';
import type { TeacherCharacter } from '../../../ports/index.ts';
import { TeacherCharacterDialog } from '../../../ui/patterns/teacher/index.ts';
import { useServices } from '../../services.ts';

const noop = (): void => undefined;

/**
 * 선생님 캐릭터 고르기(V-04, PRD 15.8): 고른 값은 이 기기에 기억한다(`device.setTeacherCharacter`) — 자동 투어·3D 미리 보기·
 * 함께 관람이 읽는다. 머리 위 이름표는 서버가 늘 "선생님"으로 정하므로(`copy.live.teacher`) 대화 상자의 이름 칸은 숨긴다.
 * 교사 첫 화면과 관리 `···` 메뉴가 함께 쓴다. Esc·`닫기`는 기억하지 않고 닫는다.
 */
export const TeacherCharacterPicker = ({
  onClose,
  onSaved,
}: {
  readonly onClose: () => void;
  readonly onSaved?: (character: TeacherCharacter) => void;
}) => {
  const { device } = useServices();
  const [character, setCharacter] = useState<TeacherCharacter>(() => device.teacherCharacter());
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const t = copy.teacher;
  return (
    <TeacherCharacterDialog
      showName={false}
      character={character}
      onCharacterChange={setCharacter}
      displayName=""
      onDisplayNameChange={noop}
      onSave={() => {
        device.setTeacherCharacter(character);
        onSaved?.(character);
        onClose();
      }}
      onClose={onClose}
      title={t.characterTitle}
      subtitle={t.characterSub}
      maleLabel={t.teacherMale}
      femaleLabel={t.teacherFemale}
      saveLabel={t.characterSave}
      cancelLabel={t.cancel}
    />
  );
};
