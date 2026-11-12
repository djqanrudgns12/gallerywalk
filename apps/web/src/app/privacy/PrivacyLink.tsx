import { copy } from '@gallery/core/copy';
import { Link } from 'react-router';
import { PRIVACY_PATH } from './path.ts';
import s from './PrivacyLink.module.css';

export interface PrivacyLinkProps {
  /**
   * 새 탭으로 연다. 포스터·동의 시트처럼 보던 흐름(별명·미리 불러오기)을 잃으면 안 되는 자리에서 쓴다.
   * 첫 화면들은 같은 탭(돌아가기로 되돌아옴).
   */
  readonly newTab?: boolean;
}

/** 화면 아래 작은 `개인정보처리방침` 링크(P6-8). 색·글꼴은 테마 변수만. */
export const PrivacyLink = ({ newTab = false }: PrivacyLinkProps) =>
  newTab ? (
    <a className={s.link} href={PRIVACY_PATH} target="_blank" rel="noopener" data-testid="privacy-link">
      {copy.privacy.link}
    </a>
  ) : (
    <Link className={s.link} to={PRIVACY_PATH} data-testid="privacy-link">
      {copy.privacy.link}
    </Link>
  );
