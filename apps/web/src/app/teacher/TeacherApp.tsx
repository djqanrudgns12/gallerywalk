/**
 * 교사 화면 자리(PLAN §7.1·§7.4, P5에서 채운다). `App.tsx`가 `React.lazy`로만 가져온다 —
 * 교사 화면·pdf.js·QR·끌어 옮기기가 학생 묶음에 들어가지 않게(PLAN §2.5). 학생 코드에서 이 파일을 가져오지 않는다.
 */
export const TeacherApp = () => <main data-testid="teacher-app" />;
