import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * 운영 스크립트 정책 시험(ADR-060). 실제 계정·launchd·네트워크 없이 격리된 GW_HOME에서
 * 금지창·부하·계정 보호와 자동 배포 구조(pull 방식, self-hosted 러너 없음)를 확인한다.
 */

const here = new URL('.', import.meta.url).pathname;
const scripts = join(here, 'scripts');
const repoRoot = join(here, '../..');
const home = mkdtempSync(join(tmpdir(), 'gw-ops-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const SHA = 'a'.repeat(40);

const sh = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('/bin/sh', args, {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, GW_OPS_TEST_MODE: '1', GW_HOME: home, ...env },
  });

const probe = (expr: string, env: Record<string, string> = {}) =>
  sh(['-c', `. "${scripts}/env.sh"; if ${expr}; then echo yes; else echo no; fi`], env);

describe('운영 스크립트', () => {
  it('모든 셸 스크립트가 sh 문법 검사를 통과한다', () => {
    const files = [...readdirSync(scripts).map(f => join(scripts, f)), join(repoRoot, 'ops/gw.sh')].filter(
      f => f.endsWith('.sh'),
    );
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const r = spawnSync('/bin/sh', ['-n', file], { encoding: 'utf8' });
      expect(r.status, `${file}: ${r.stderr}`).toBe(0);
    }
  });

  it('셸 변수 바로 뒤에 한글을 붙이지 않는다(문자 설정에 따라 변수 이름으로 읽혀 unbound variable)', () => {
    const files = [
      ...readdirSync(scripts).map(f => join(scripts, f)),
      join(repoRoot, 'ops/gw.sh'),
      ...readdirSync(join(repoRoot, 'ops/aws')).map(f => join(repoRoot, 'ops/aws', f)),
    ].filter(f => f.endsWith('.sh'));
    for (const file of files) {
      const bad = readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/.test(line));
      expect(bad, file).toEqual([]);
    }
  });

  it.each([
    ['1:08', 'yes'],
    ['3:12', 'yes'],
    ['5:15', 'yes'],
    ['5:16', 'no'],
    ['1:07', 'no'],
    ['6:10', 'no'],
    ['7:09', 'no'],
  ])('KST %s 는 수업 시간 금지창인가 → %s', (dowHour, expected) => {
    expect(probe('gw_is_school_hours', { GW_TEST_KST_DOW_HOUR: dowHour }).stdout.trim()).toBe(expected);
  });

  it('1분 부하가 코어 x 0.75를 넘거나 메모리 압박이 위험(4)이면 바쁘다', () => {
    const calm = { GW_TEST_NCPU: '8', GW_TEST_PRESSURE: '1' };
    expect(probe('gw_is_busy', { ...calm, GW_TEST_LOAD: '6.1' }).stdout.trim()).toBe('yes');
    expect(probe('gw_is_busy', { ...calm, GW_TEST_LOAD: '5.9' }).stdout.trim()).toBe('no');
    // 경고(2)는 기다리지 않는다(사용자 결정 2026-11-12)
    expect(probe('gw_is_busy', { ...calm, GW_TEST_LOAD: '0.5', GW_TEST_PRESSURE: '2' }).stdout.trim()).toBe(
      'no',
    );
    expect(probe('gw_is_busy', { ...calm, GW_TEST_LOAD: '0.5', GW_TEST_PRESSURE: '4' }).stdout.trim()).toBe(
      'yes',
    );
  });

  it('다른 서비스 계정·포트로 바꾸면 시작을 거부한다', () => {
    for (const env of [
      { GW_SERVICE_USER: 'rtsvc' },
      { GW_SERVICE_USER: 'wesvc' },
      { GW_PORT: '4460' },
      { GW_PRECHECK_PORT: '4521' },
      { GW_TUNNEL_METRICS_PORT: '20242' },
    ]) {
      expect(probe('true', env).status, JSON.stringify(env)).not.toBe(0);
    }
  });

  it('배포는 수업 시간에 우회 없이 75로 거부한다', () => {
    const r = sh([join(scripts, 'deploy.sh'), '--sha', SHA], { GW_TEST_KST_DOW_HOUR: '2:10' });
    expect(r.status).toBe(75);
    expect(r.stderr).toContain('수업 시간');
    expect(sh([join(scripts, 'deploy.sh'), '--force', '--sha', SHA]).status).toBe(1);
  });

  it('배포는 맥미니가 바쁘면 75로 미룬다', () => {
    const r = sh([join(scripts, 'deploy.sh'), '--sha', SHA], {
      GW_TEST_KST_DOW_HOUR: '6:10',
      GW_TEST_LOAD: '100',
      GW_TEST_NCPU: '4',
    });
    expect(r.status).toBe(75);
  });

  it('--now는 바쁨만 건너뛰고, 수업 시간과 자동 배포에서는 통하지 않는다', () => {
    const busy = { GW_TEST_KST_DOW_HOUR: '6:10', GW_TEST_LOAD: '100', GW_TEST_NCPU: '4' };
    // 바쁨을 지나 다음 관문(비밀값 파일 없음)에서 멈추면 바쁨 판정을 건너뛴 것이다
    const passed = sh([join(scripts, 'deploy.sh'), '--now', '--sha', SHA], busy);
    expect(passed.status).toBe(1);
    expect(passed.stdout).toContain('기다리지 않고');
    expect(passed.stderr).toContain('app.env');
    expect(
      sh([join(scripts, 'deploy.sh'), '--now', '--sha', SHA], { GW_TEST_KST_DOW_HOUR: '2:10' }).status,
    ).toBe(75);
    const auto = sh([join(scripts, 'deploy.sh'), '--now', '--sha', SHA], { ...busy, GW_AUTODEPLOY_RUN: '1' });
    expect(auto.status).toBe(1);
    expect(auto.stderr).toContain('수동 배포에서만');
  });

  it('시작 코드는 명령줄 인자로 받지 않는다(ps·기록에 남으므로)', () => {
    const r = sh([join(scripts, 'start-code.sh'), '482913']);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain('저장했습니다');
  });

  it('자동 배포는 수업 시간에 아무것도 받지 않고 기다린다', () => {
    const r = sh([join(scripts, 'auto-deploy.sh'), '--run'], { GW_TEST_KST_DOW_HOUR: '4:09' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(home, 'state/autodeploy-status'), 'utf8')).toContain('수업 시간');
  });

  it('자동 배포는 pull 방식이고 CI verify를 기다린다', () => {
    const auto = readFileSync(join(scripts, 'auto-deploy.sh'), 'utf8');
    expect(auto).toContain('git ls-remote');
    expect(auto).toContain('merge-base --is-ancestor');
    expect(auto).toContain('check_name=verify');
    // 주석(설명 문장)은 빼고 실제 설정만 본다
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(ci).not.toMatch(/self-hosted/);
    expect(ci).toMatch(/runs-on: macos-/);
    expect(ci).toMatch(/^ {2}verify:/m);
    expect(ci).toMatch(/contents: read/);
  });

  it('launchd 설정은 갤러리 라벨·gwsvc·정해진 포트만 쓴다', () => {
    const dir = join(here, 'launchd');
    const files = readdirSync(dir);
    expect(files.sort()).toEqual([
      'com.ssamuniverse.gallery.autodeploy.plist',
      'com.ssamuniverse.gallery.plist',
      'com.ssamuniverse.gallery.tunnel.plist',
      'com.ssamuniverse.gallery.watch.plist',
    ]);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text).toContain(`<string>${f.replace(/\.plist$/, '')}</string>`);
      expect(text).toContain('<key>UserName</key><string>__GW_USER__</string>');
      expect(text).not.toMatch(/SECRET|HMAC=/);
      if (process.platform === 'darwin') {
        const lint = spawnSync('/usr/bin/plutil', ['-lint', join(dir, f)], { encoding: 'utf8' });
        expect(lint.status, lint.stdout).toBe(0);
      }
    }
    expect(readFileSync(join(dir, 'com.ssamuniverse.gallery.plist'), 'utf8')).toContain(
      '<string>4520</string>',
    );
    expect(readFileSync(join(dir, 'com.ssamuniverse.gallery.autodeploy.plist'), 'utf8')).toContain(
      '<key>StartInterval</key><integer>60</integer>',
    );
    expect(readFileSync(join(dir, 'com.ssamuniverse.gallery.tunnel.plist'), 'utf8')).toContain(
      '127.0.0.1:20243',
    );
  });
});
