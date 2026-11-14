import { copy } from '@gallery/core/copy';
import { Link } from 'react-router';
import { PATHS } from '../routes.ts';
import s from './CheckLink.module.css';

/**
 * `학교망 점검` 링크(FIELD_PLAN HW-00): 선생님 첫 화면·수업 화면에 둔다(학생 화면에는 두지 않음).
 * 점검 화면 묶음은 가져오지 않는다 — 이 파일은 경로 글과 문구만 쓴다.
 */
export const CheckLink = () => (
  <Link className={s.link} to={PATHS.check} data-testid="check-link">
    {copy.check.link}
  </Link>
);
