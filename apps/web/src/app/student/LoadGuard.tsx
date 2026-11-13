import { Component, type ReactNode } from 'react';

/**
 * 따로 받는 화면 묶음(`lazy`)을 받지 못하면(학교망이 막음·배포 뒤 옛 이름) React가 던지는 오류를 여기서 받는다
 * (G-24 HW-01). 빈 화면 대신 부른 쪽이 가벼운 화면으로 바꾸게 알리고, 이 자리는 비운다.
 */
export class LoadGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    this.props.onError();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
