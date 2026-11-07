import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, chmodSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = fileURLToPath(new URL('../install-to-aside.sh', import.meta.url));
const cleaner = process.env.ASIDE_CLEAR_QUARANTINE;
const darwin = process.platform === 'darwin';
const url = 'https://github.com/2JIHAN/aside-automation-creator.git';
const skill = 'aside-automation-creator';
const payload = '---\nname: "aside-automation-creator"\n---\nFixture skill\n';

function put(path, text) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function clean(path) {
  if (!darwin || !existsSync(cleaner)) return;
  const result = spawnSync('/bin/bash', [cleaner, path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aside-installer-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const aside = join(home, '.aside');
  const repo = join(root, 'source');
  const source = join(root, 'clone-payload');
  const bin = join(root, 'bin');
  const log = join(root, 'git.log');
  const triggers = join(root, 'runtime.log');
  for (const n of [0, 1, 2]) mkdirSync(join(aside, 'u', String(n)), { recursive: true });
  put(join(source, 'SKILL.md'), payload);
  put(join(source, 'engine.mjs'), '// shared engine fixture\n');
  put(join(source, 'assets', 'scenarios', 'browser-monitor', 'template', 'marker.txt'), 'template marker\n');
  put(join(source, 'README.md'), 'must not be installed\n');
  put(join(source, 'install-to-aside.sh'), 'must not be installed\n');
  put(join(source, 'tests', 'private.txt'), 'must not be installed\n');
  put(join(bin, 'git'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
if [ "$1" = clone ]; then
  [ "$#" = 6 ] && [ "$2" = --branch ] && [ "$3" = main ] && [ "$4" = --single-branch ] && [ "$5" = '${url}' ] || exit 90
  case "$6" in
    "$ASIDE_AUTOMATION_CREATOR_REPO"|"$ASIDE_HOME"/.automation-creator-install.*/repository) ;;
    *) exit 91 ;;
  esac
  mkdir -p "$6"
  if [ -n "\${FAKE_CLONE_FAIL:-}" ]; then echo partial > "$6/partial"; exit 95; fi
  cp -R "$FAKE_SOURCE/." "$6/"
  mkdir "$6/.git"
  exit 0
fi
if [ "$1" = -C ]; then
  [ "$2" = "$ASIDE_AUTOMATION_CREATOR_REPO" ] || exit 92
  shift 2
  case "$*" in
    'remote get-url origin') printf '%s\\n' "\${FAKE_REMOTE:-${url}}" ;;
    'symbolic-ref --short HEAD') printf '%s\\n' "\${FAKE_BRANCH:-main}" ;;
    'status --porcelain') printf '%s' "\${FAKE_DIRTY:-}" ;;
    'pull --ff-only') : ;;
    *) exit 93 ;;
  esac
  exit
fi
exit 94
`);
  chmodSync(join(bin, 'git'), 0o755);
  for (const command of ['aside', 'node', 'npm', 'npx', 'osascript', 'open', 'launchctl', 'curl', 'wget']) {
    put(join(bin, command), '#!/bin/bash\nprintf "%s\\n" "$0 $*" >> "$FAKE_RUNTIME_LOG"\nexit 99\n');
    chmodSync(join(bin, command), 0o755);
  }
  clean(root);
  const dest = n => join(aside, 'u', String(n), 'skills', 'user', skill);
  const run = (extra = {}, args = []) => spawnSync('/bin/bash', [installer, ...args], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, HOME: home, ASIDE_HOME: aside, ASIDE_AUTOMATION_CREATOR_REPO: repo,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, FAKE_SOURCE: source, FAKE_GIT_LOG: log,
      FAKE_RUNTIME_LOG: triggers, ...extra },
  });
  t.after(() => assert.equal(existsSync(triggers), false, 'installer must not launch runtime or network commands'));
  return { root, home, aside, repo, source, bin, log, dest, run };
}

function success(result) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

function installed(f, n) {
  assert.deepEqual(readdirSync(f.dest(n)).sort(), ['SKILL.md', 'assets']);
  assert.equal(readFileSync(join(f.dest(n), 'SKILL.md'), 'utf8'), payload);
  assert.equal(readFileSync(join(f.dest(n), 'assets/scenarios/browser-monitor/template/marker.txt'), 'utf8'), 'template marker\n');
}

function tree(path) {
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) return { link: readlinkSync(path) };
  if (!lstatSync(path).isDirectory()) return readFileSync(path).toString('base64');
  return Object.fromEntries(readdirSync(path).sort().map(name => [name, tree(join(path, name))]));
}

test('clone installs payload only to every numeric profile, including signed-out profiles, without running it', t => {
  const f = fixture(t);
  put(join(f.aside, 'u/0/account.json'), '{"signedIn":true}');
  mkdirSync(join(f.aside, 'u/not-an-account'), { recursive: true });
  put(join(f.aside, 'u/1/skills/user/other/SKILL.md'), 'unrelated');
  success(f.run());
  for (const n of [0, 1, 2]) installed(f, n);
  assert.equal(existsSync(join(f.aside, 'u/not-an-account/skills')), false);
  assert.equal(readFileSync(join(f.aside, 'u/1/skills/user/other/SKILL.md'), 'utf8'), 'unrelated');
  assert.match(readFileSync(f.log, 'utf8'), /^clone --branch main --single-branch /);
});

test('existing skill is backed up outside skill trees; rerun pulls and preserves identical destinations; new account receives skill', t => {
  const f = fixture(t);
  put(join(f.dest(1), 'old.txt'), 'old skill');
  success(f.run());
  const backups = join(f.aside, 'skill-backups', skill);
  const runs = readdirSync(backups);
  assert.equal(runs.length, 1);
  assert.equal(readFileSync(join(backups, runs[0], 'u1/old.txt'), 'utf8'), 'old skill');
  const before = statSync(f.dest(0)).ino;
  const second = f.run();
  success(second);
  assert.match(second.stdout, /이미 최신 3개/);
  assert.equal(statSync(f.dest(0)).ino, before);
  assert.deepEqual(readdirSync(backups), runs);
  assert.match(readFileSync(f.log, 'utf8'), /pull --ff-only/);
  mkdirSync(join(f.aside, 'u/3'));
  success(f.run());
  installed(f, 3);
});

for (const [name, prepare, env, message] of [
  ['unknown source path', f => mkdirSync(f.repo), {}, /다른 폴더/],
  ['wrong remote', f => mkdirSync(join(f.repo, '.git'), { recursive: true }), { FAKE_REMOTE: 'https://invalid.example/repo' }, /주소가 다릅니다/],
  ['non-main source', f => mkdirSync(join(f.repo, '.git'), { recursive: true }), { FAKE_BRANCH: 'topic' }, /main 브랜치/],
  ['no numeric accounts', f => { for (const n of [0, 1, 2]) rmSync(join(f.aside, 'u', String(n)), { recursive: true }); }, {}, /설치할 Aside 계정/],
]) {
  test(`${name} fails before profile writes`, t => {
    const f = fixture(t);
    prepare(f);
    const before = tree(join(f.aside, 'u'));
    const result = f.run(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.deepEqual(tree(join(f.aside, 'u')), before);
    if (existsSync(f.log)) assert.doesNotMatch(readFileSync(f.log, 'utf8'), /pull|clone/);
  });
}

test('destination symlink is backed up without following or modifying its target', t => {
  const f = fixture(t);
  const outside = join(f.root, 'outside');
  put(join(outside, 'sentinel'), 'keep');
  mkdirSync(resolve(f.dest(0), '..'), { recursive: true });
  symlinkSync(outside, f.dest(0));
  success(f.run());
  installed(f, 0);
  assert.deepEqual(readdirSync(outside), ['sentinel']);
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'keep');
  const base = join(f.aside, 'skill-backups', skill);
  const backup = join(base, readdirSync(base)[0], 'u0');
  assert.equal(lstatSync(backup).isSymbolicLink(), true);
  assert.equal(readlinkSync(backup), outside);
});

for (const parent of ['skills', 'skills/user']) {
  test(`symlink ${parent} parent refuses before any profile is installed`, t => {
    const f = fixture(t);
    const outside = join(f.root, 'outside');
    mkdirSync(outside);
    const link = join(f.aside, 'u/2', parent);
    mkdirSync(resolve(link, '..'), { recursive: true });
    symlinkSync(outside, link);
    const before = tree(join(f.aside, 'u'));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /심볼릭 링크/);
    assert.deepEqual(tree(join(f.aside, 'u')), before);
    assert.deepEqual(readdirSync(outside), []);
    assert.equal(existsSync(f.log), false);
  });
}

test('Darwin clears quarantine from copied readonly payload while preserving mode and other attributes', { skip: !darwin }, t => {
  const f = fixture(t);
  const marker = join(f.source, 'assets/scenarios/browser-monitor/template/marker.txt');
  for (const [name, value] of [['com.apple.quarantine', '0081;00000000;Aside;'], ['test.aside.preserve', 'keep']]) {
    const result = spawnSync('/usr/bin/xattr', ['-w', name, value, marker], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  chmodSync(marker, 0o444);
  const rootSkill = join(f.source, 'SKILL.md');
  const tagged = spawnSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Aside;', rootSkill], { encoding: 'utf8' });
  assert.equal(tagged.status, 0, tagged.stderr);
  chmodSync(rootSkill, 0o444);
  success(f.run());
  for (const n of [0, 1, 2]) {
    const copied = join(f.dest(n), 'assets/scenarios/browser-monitor/template/marker.txt');
    assert.equal(statSync(copied).mode & 0o777, 0o444);
    const installedSkill = join(f.dest(n), 'SKILL.md');
    assert.equal(statSync(installedSkill).mode & 0o777, 0o444);
    const rootAttrs = spawnSync('/usr/bin/xattr', [installedSkill], { encoding: 'utf8' });
    assert.equal(rootAttrs.status, 0, rootAttrs.stderr);
    assert.doesNotMatch(rootAttrs.stdout, /com.apple.quarantine/);
    const attrs = spawnSync('/usr/bin/xattr', [copied], { encoding: 'utf8' });
    assert.equal(attrs.status, 0, attrs.stderr);
    assert.doesNotMatch(attrs.stdout, /com.apple.quarantine/);
    const preserved = spawnSync('/usr/bin/xattr', ['-p', 'test.aside.preserve', copied], { encoding: 'utf8' });
    assert.equal(preserved.status, 0, preserved.stderr);
    assert.equal(preserved.stdout.trim(), 'keep');
  }
});

test('missing shared engine refuses before installing any profile', t => {
  const f = fixture(t);
  rmSync(join(f.source, 'engine.mjs'));
  const before = tree(join(f.aside, 'u'));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /공통 엔진이 없습니다/);
  assert.deepEqual(tree(join(f.aside, 'u')), before);
});

test('dirty source is renamed intact and replaced with a fresh clone', t => {
  const f = fixture(t);
  success(f.run());
  put(join(f.repo, 'engine.mjs'), '// local development\n');
  put(join(f.repo, 'untracked.txt'), 'keep untracked work\n');
  put(join(f.repo, '.git/local-state'), 'keep git state\n');
  rmSync(join(f.repo, 'assets/scenarios/browser-monitor/template/marker.txt'));
  const before = tree(f.repo);
  const result = f.run({ FAKE_DIRTY: ' M engine.mjs\n D assets/scenarios/browser-monitor/template/marker.txt\n?? untracked.txt\n' });
  success(result);
  const backups = readdirSync(f.root).filter(name => name.startsWith('source.backup-'));
  assert.equal(backups.length, 1);
  const backup = join(f.root, backups[0]);
  assert.match(backups[0], /^source\.backup-\d{8}-\d{6}-\d+$/);
  assert.deepEqual(tree(backup), before);
  assert.equal(readFileSync(join(f.repo, 'engine.mjs'), 'utf8'), '// shared engine fixture\n');
  assert.equal(existsSync(join(f.repo, 'untracked.txt')), false);
  assert.match(result.stdout, /로컬 수정 저장소 백업:/);
  assert.ok(result.stdout.includes(backup));
  assert.doesNotMatch(readFileSync(f.log, 'utf8'), /pull --ff-only/);
  for (const n of [0, 1, 2]) installed(f, n);
});

for (const reason of ['clone failure', 'invalid payload']) {
  test(`dirty source remains untouched on ${reason}`, t => {
    const f = fixture(t);
    success(f.run());
    put(join(f.repo, 'engine.mjs'), '// local work must survive\n');
    const beforeRepo = tree(f.repo);
    const beforeProfiles = tree(join(f.aside, 'u'));
    if (reason === 'invalid payload') rmSync(join(f.source, 'engine.mjs'));
    const result = f.run({ FAKE_DIRTY: ' M engine.mjs\n', ...(reason === 'clone failure' ? { FAKE_CLONE_FAIL: '1' } : {}) });
    assert.notEqual(result.status, 0);
    assert.deepEqual(tree(f.repo), beforeRepo);
    assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
    assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith('source.backup-')), []);
    assert.deepEqual(readdirSync(f.aside).filter(name => name.startsWith('.automation-creator-install.')), []);
  });
}

test('failed promotion restores the original dirty source before profile writes', t => {
  const f = fixture(t);
  success(f.run());
  put(join(f.repo, 'engine.mjs'), '// keep local source\n');
  const beforeRepo = tree(f.repo);
  const beforeProfiles = tree(join(f.aside, 'u'));
  put(join(f.bin, 'mv'), `#!/bin/bash
case "$1" in
  "$ASIDE_HOME"/.automation-creator-install.*/repository) exit 97 ;;
esac
exec /bin/mv "$@"
`);
  chmodSync(join(f.bin, 'mv'), 0o755);
  clean(join(f.bin, 'mv'));
  const result = f.run({ FAKE_DIRTY: ' M engine.mjs\n' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /기존 저장소를 복원/);
  assert.deepEqual(tree(f.repo), beforeRepo);
  assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
  assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith('source.backup-')), []);
});

function packageSource(f) {
  put(join(f.source, 'runtime/node'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(f.source, 'runtime/node'), 0o755);
  clean(f.source);
}

function packageRun(f) { return f.run({}, ['--source-directory', f.source]); }
function repoBackups(f) { return readdirSync(f.root).filter(n => n.startsWith('source.backup-')); }
function files(path, prefix = '') {
  return readdirSync(path).sort().flatMap(name => {
    const relative = prefix + name, full = join(path, name);
    return lstatSync(full).isDirectory() ? files(full, relative + '/') : [relative];
  });
}
function identity(path) {
  const st = statSync(path); return [st.ino, st.mtimeMs, st.mode];
}
function copySpy(f) {
  const log = join(f.root, 'copies.log');
  put(join(f.bin, 'cp'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "'+log+'"\nexec /bin/cp "$@"\n');
  chmodSync(join(f.bin, 'cp'), 0o755); clean(join(f.bin, 'cp')); return log;
}

test('package identical rerun copies zero files, preserves inodes/mtimes and user files, and creates no backup', t => {
  const f = fixture(t); packageSource(f);
  put(join(f.dest(1), 'local.txt'), 'keep profile');
  success(packageRun(f));
  assert.deepEqual(readdirSync(f.repo).sort(), ['.aside-automation-creator-package', 'README.md', 'SKILL.md', 'assets', 'engine.mjs', 'install-to-aside.sh', 'runtime']);
  put(join(f.repo, 'local.txt'), 'keep repo');
  const paths = [f.repo, ...files(f.repo).map(p => join(f.repo, p)), ...[0,1,2].flatMap(n => [f.dest(n), ...files(f.dest(n)).map(p => join(f.dest(n), p))])];
  const before = paths.map(identity); const log = copySpy(f);
  const second = packageRun(f); success(second);
  assert.match(second.stdout, /공용 파일: 업데이트 0개, 건너뜀 7개/);
  assert.match(second.stdout, /프로필 파일: 업데이트 0개, 건너뜀 6개/);
  assert.match(second.stdout, /이미 최신 3개/);
  assert.equal(existsSync(log), false);
  assert.deepEqual(paths.map(identity), before);
  assert.deepEqual(repoBackups(f), []);
  assert.equal(existsSync(join(f.aside, 'skill-backups')), false);
  assert.equal(existsSync(f.log), false);
  noPackageDebris(f);
});

test('package engine-only update leaves no backup and leaves profiles and runtime unchanged', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  const node = identity(join(f.repo, 'runtime/node'));
  const profiles = [0,1,2].map(n => identity(join(f.dest(n), 'SKILL.md')));
  put(join(f.source, 'engine.mjs'), '// new engine\n');
  const result=packageRun(f); success(result);
  assert.deepEqual(repoBackups(f), []);
  assert.equal(readFileSync(join(f.repo,'engine.mjs'),'utf8'),'// new engine\n');
  assert.deepEqual(identity(join(f.repo,'runtime/node')),node);
  assert.deepEqual([0,1,2].map(n => identity(join(f.dest(n),'SKILL.md'))),profiles);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  assert.match(result.stdout,/공용 파일: 업데이트 1개, 건너뜀 6개/);
  assert.match(result.stdout,/프로필 파일: 업데이트 0개, 건너뜀 6개/);
  noPackageDebris(f);
});

test('package template-only update changes shared source and profiles without permanent backups', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  put(join(f.source,'assets/scenarios/browser-monitor/template/marker.txt'),'new template\n');
  const result=packageRun(f); success(result);
  assert.deepEqual(repoBackups(f), []);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  assert.equal(readFileSync(join(f.repo,'assets/scenarios/browser-monitor/template/marker.txt'),'utf8'),'new template\n');
  for (const n of [0,1,2]) assert.equal(readFileSync(join(f.dest(n),'assets/scenarios/browser-monitor/template/marker.txt'),'utf8'),'new template\n');
  assert.match(result.stdout,/프로필 파일: 업데이트 3개, 건너뜀 3개/);
  noPackageDebris(f);
});

test('package profiles exclude README, decorative assets and runtime, preserving old extras untouched', t => {
  const f=fixture(t); packageSource(f);
  put(join(f.source,'assets/readme/logo.png'),'new logo');
  put(join(f.dest(0),'assets/readme/logo.png'),'old logo');
  put(join(f.dest(0),'README.md'),'old readme');
  const logo=identity(join(f.dest(0),'assets/readme/logo.png'));
  success(packageRun(f));
  assert.equal(readFileSync(join(f.repo,'assets/readme/logo.png'),'utf8'),'new logo');
  assert.equal(readFileSync(join(f.dest(0),'assets/readme/logo.png'),'utf8'),'old logo');
  assert.deepEqual(identity(join(f.dest(0),'assets/readme/logo.png')),logo);
  assert.equal(readFileSync(join(f.dest(0),'README.md'),'utf8'),'old readme');
  installed(f,1); installed(f,2);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
});

test('package new profile receives skill without copying shared Node again', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  mkdirSync(join(f.aside,'u/3')); const log=copySpy(f);
  const node=identity(join(f.repo,'runtime/node')); const result=packageRun(f); success(result);
  installed(f,3); assert.deepEqual(identity(join(f.repo,'runtime/node')),node);
  const copies=readFileSync(log,'utf8').trim().split('\n');
  assert.equal(copies.length,2); assert.ok(copies.every(line => !line.includes(join(f.repo, 'runtime/node'))), copies.join('\n'));
  assert.deepEqual(repoBackups(f),[]);
});

test('package mode-only change updates without permanent backups', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  chmodSync(join(f.source,'engine.mjs'),0o444); success(packageRun(f));
  assert.equal(statSync(join(f.repo,'engine.mjs')).mode & 0o777,0o444);
  assert.deepEqual(repoBackups(f),[]);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
});

for (const kind of ['wrong origin', 'unrelated', 'symlink runtime', 'nested runtime symlink', 'symlink root', 'missing engine']) {
  test('source package refuses ' + kind + ' without changing existing files', t => {
    const f=fixture(t); packageSource(f);
    if (kind === 'wrong origin') put(join(f.repo,'.git/config'), '[remote "origin"]\n url = https://example.invalid/other\n');
    if (kind === 'unrelated') put(join(f.repo,'sentinel'), 'keep');
    if (kind === 'symlink runtime') { rmSync(join(f.source,'runtime'),{recursive:true}); symlinkSync(f.bin,join(f.source,'runtime')); }
    if (kind === 'nested runtime symlink') { symlinkSync(join(f.source,'SKILL.md'),join(f.source,'runtime/nested-link')); }
    if (kind === 'symlink root') { rmSync(join(f.source,'README.md')); symlinkSync(join(f.source,'SKILL.md'),join(f.source,'README.md')); }
    if (kind === 'missing engine') rmSync(join(f.source,'engine.mjs'));
    const repo=tree(f.repo), profiles=tree(join(f.aside,'u'));
    assert.notEqual(f.run({},['--source-directory',f.source]).status,0);
    assert.deepEqual(tree(f.repo),repo); assert.deepEqual(tree(join(f.aside,'u')),profiles);
    assert.equal(existsSync(f.log),false);
  });
}

test('source package recognizes expected local Git origin without invoking Git', t => {
  const f=fixture(t); packageSource(f);
  put(join(f.repo,'.git/config'), '[remote "origin"]\n\turl = '+url+'\n');
  put(join(f.repo,'local.txt'),'keep local work');
  const before=tree(f.repo);
  success(f.run({},['--source-directory',f.source])); assert.equal(existsSync(f.log),false);
  const backups=repoBackups(f); assert.equal(backups.length,1);
  assert.deepEqual(tree(join(f.root,backups[0])),before);
});

for (const target of ['shared', 'profile']) {
  test('package failed per-file promotion keeps old '+target+' file intact and signals failure', t => {
    const f=fixture(t); packageSource(f); success(packageRun(f));
    const dest=target==='shared' ? join(f.repo,'engine.mjs') : join(f.dest(0),'assets/scenarios/browser-monitor/template/marker.txt');
    const original=readFileSync(dest,'utf8'), before=identity(dest);
    put(join(f.source,target==='shared' ? 'engine.mjs' : 'assets/scenarios/browser-monitor/template/marker.txt'),'replacement\n');
    put(join(f.bin,'mv'),'#!/bin/bash\nfor arg in "$@"; do [ "$arg" != "'+dest+'" ] || exit 97; done\nexec /bin/mv "$@"\n');
    chmodSync(join(f.bin,'mv'),0o755); clean(join(f.bin,'mv'));
    const result=packageRun(f); assert.notEqual(result.status,0);
    assert.match(result.stderr,/기존 파일을 복원/); assert.doesNotMatch(result.stdout,/완료: 설치/);
    assert.equal(readFileSync(dest,'utf8'),original); assert.deepEqual(identity(dest),before);
    assert.deepEqual(repoBackups(f),[]);
    assert.equal(existsSync(join(f.aside,'skill-backups')),false);
    assert.ok(!files(f.repo).some(p=>p.includes('.automation-creator-file.')));
    assert.ok(!files(f.dest(0)).some(p=>p.includes('.automation-creator-file.')));
  });
}

for (const area of ['shared', 'profile']) {
  test('package refuses nested '+area+' destination symlink ancestors without target writes', t => {
    const f=fixture(t); packageSource(f); success(packageRun(f));
    const outside=join(f.root,'outside'); put(join(outside,'marker.txt'),'keep');
    const parent=area==='shared' ? join(f.repo,'assets/scenarios/browser-monitor/template') : join(f.dest(0),'assets/scenarios/browser-monitor/template');
    rmSync(parent,{recursive:true}); symlinkSync(outside,parent);
    const before=tree(outside); const result=packageRun(f);
    assert.notEqual(result.status,0); assert.match(result.stderr,/심볼릭 링크/);
    assert.deepEqual(tree(outside),before); assert.deepEqual(repoBackups(f),[]);
    assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  });
}

for (const kind of ['symlink', 'file']) {
  test('package refuses profile root '+kind+' without discarding old content', t => {
    const f=fixture(t); packageSource(f);
    const outside=join(f.root,'outside'); put(join(outside,'sentinel'),'keep');
    mkdirSync(resolve(f.dest(0),'..'),{recursive:true});
    if (kind==='symlink') symlinkSync(outside,f.dest(0)); else put(f.dest(0),'keep old root');
    const before=tree(join(f.aside,'u'));
    const result=packageRun(f); assert.notEqual(result.status,0);
    assert.deepEqual(tree(join(f.aside,'u')),before);
    assert.deepEqual(readdirSync(outside),['sentinel']);
    assert.deepEqual(repoBackups(f),[]);
    assert.equal(existsSync(join(f.aside,'skill-backups')),false);
    assert.equal(existsSync(f.repo),false);
  });
}

test('source package refuses symlink ancestors of repository without outside writes or backups', t => {
  const f=fixture(t); packageSource(f);
  const outside=join(f.root,'outside'), externalRepo=join(outside,'share/aside-automation-creator');
  put(join(externalRepo,'.aside-automation-creator-package'),url+'\n');
  put(join(externalRepo,'local.txt'),'keep owned repo');
  put(join(outside,'bin/aside'),'keep CLI');
  symlinkSync(outside,join(f.home,'.local'));
  const before=tree(outside), profiles=tree(join(f.aside,'u'));
  const result=f.run({ASIDE_AUTOMATION_CREATOR_REPO:join(f.home,'.local/share/aside-automation-creator')},['--source-directory',f.source]);
  assert.notEqual(result.status,0); assert.match(result.stderr,/상위 경로가 심볼릭 링크/);
  assert.deepEqual(tree(outside),before); assert.deepEqual(tree(join(f.aside,'u')),profiles);
  assert.equal(existsSync(f.log),false);
});


test('Darwin package clears only touched copies, preserving modes and unrelated attributes', {skip: !darwin}, t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  const engine=join(f.source,'engine.mjs'), node=join(f.repo,'runtime/node');
  put(engine,'// tagged replacement\n');
  for (const [file,name,value] of [
    [engine,'com.apple.quarantine','0081;00000000;Aside;'],
    [engine,'test.aside.preserve','keep'],
    [node,'com.apple.quarantine','0081;00000000;Aside;'],
  ]) assert.equal(spawnSync('/usr/bin/xattr',['-w',name,value,file]).status,0);
  chmodSync(engine,0o444); const before=identity(node);
  success(packageRun(f));
  const dest=join(f.repo,'engine.mjs');
  assert.equal(statSync(dest).mode & 0o777,0o444);
  assert.doesNotMatch(spawnSync('/usr/bin/xattr',[dest],{encoding:'utf8'}).stdout,/com.apple.quarantine/);
  assert.equal(spawnSync('/usr/bin/xattr',['-p','test.aside.preserve',dest],{encoding:'utf8'}).stdout.trim(),'keep');
  assert.match(spawnSync('/usr/bin/xattr',[node],{encoding:'utf8'}).stdout,/com.apple.quarantine/);
  assert.deepEqual(identity(node),before);
});

function moveShim(f, body) {
  put(join(f.bin,'mv'), '#!/bin/bash\n'+body+'\nexec /bin/mv "$@"\n');
  chmodSync(join(f.bin,'mv'),0o755); clean(join(f.bin,'mv'));
}
function noPackageDebris(f) {
  assert.deepEqual(repoBackups(f),[]);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  assert.deepEqual(readdirSync(f.aside).filter(n=>n.startsWith('.automation-creator-install.')),[]);
}

for (const action of ['failure','noop','wrong mode']) {
  test('late package promotion '+action+' restores all earlier files and removes transaction additions', t => {
    const f=fixture(t); packageSource(f); success(packageRun(f));
    put(join(f.repo,'unknown.txt'),'keep repo'); put(join(f.dest(1),'unknown.txt'),'keep profile');
    const repo=tree(f.repo), profiles=tree(join(f.aside,'u'));
    const originalMode=statSync(join(f.repo,'engine.mjs')).mode;
    put(join(f.source,'engine.mjs'),'changed engine\n'); chmodSync(join(f.source,'engine.mjs'),0o444);
    put(join(f.source,'SKILL.md'),payload+'changed skill\n');
    put(join(f.source,'assets/scenarios/browser-monitor/template/new/nested.txt'),'new file\n');
    put(join(f.source,'assets/scenarios/browser-monitor/template/marker.txt'),'changed template\n');
    const dest=join(f.dest(2),'assets/scenarios/browser-monitor/template/marker.txt');
    const flag=join(f.root,'injected');
    const effect=action==='failure' ? 'exit 97' : action==='noop' ? 'exit 0' : '/bin/mv "$@"; chmod 600 "'+dest+'"; exit 0';
    moveShim(f,'if [ "${!#}" = "'+dest+'" ] && [ ! -e "'+flag+'" ]; then touch "'+flag+'"; '+effect+'; fi');
    const result=packageRun(f); assert.notEqual(result.status,0,result.stdout);
    assert.doesNotMatch(result.stdout,/완료: 설치/);
    assert.deepEqual(tree(f.repo),repo); assert.deepEqual(tree(join(f.aside,'u')),profiles);
    assert.equal(statSync(join(f.repo,'engine.mjs')).mode,originalMode);
    noPackageDebris(f);
  });
}

test('first package install failure removes only transaction files and empty directories', t => {
  const f=fixture(t); packageSource(f);
  put(join(f.dest(1),'unknown.txt'),'keep profile');
  const profiles=tree(join(f.aside,'u'));
  const dest=join(f.dest(2),'assets/scenarios/browser-monitor/template/marker.txt');
  moveShim(f,'[ "${!#}" != "'+dest+'" ] || exit 97');
  const result=packageRun(f); assert.notEqual(result.status,0);
  assert.doesNotMatch(result.stdout,/완료: 설치/);
  assert.equal(existsSync(f.repo),false);
  assert.deepEqual(tree(join(f.aside,'u')),profiles); noPackageDebris(f);
});

test('rollback failure retains recovery copies and reports their location', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  const engine=join(f.repo,'engine.mjs'), dest=join(f.dest(2),'assets/scenarios/browser-monitor/template/marker.txt');
  put(join(f.source,'engine.mjs'),'changed engine\n');
  put(join(f.source,'assets/scenarios/browser-monitor/template/marker.txt'),'changed template\n');
  const flag=join(f.root,'injected');
  moveShim(f,'if [ "${!#}" = "'+dest+'" ]; then touch "'+flag+'"; exit 97; fi\nif [ -e "'+flag+'" ] && [ "${!#}" = "'+engine+'" ]; then exit 98; fi');
  const result=packageRun(f); assert.notEqual(result.status,0);
  assert.match(result.stderr,/복원 실패.*복구 파일을 보존/);
  const work=readdirSync(f.aside).filter(n=>n.startsWith('.automation-creator-install.'));
  assert.equal(work.length,1);
  assert.ok(files(join(f.aside,work[0])).some(p=>p.startsWith('rollback-')));
  assert.deepEqual(repoBackups(f),[]); assert.equal(existsSync(join(f.aside,'skill-backups')),false);
});

test('failed install preserves unrelated files introduced inside new transaction directories', t => {
  const f=fixture(t); packageSource(f);
  const dest=join(f.dest(2),'assets/scenarios/browser-monitor/template/marker.txt');
  const userFile=join(f.dest(2),'assets/scenarios/browser-monitor/template/user-note.txt');
  moveShim(f,'if [ "${!#}" = "'+dest+'" ]; then printf "keep new user file" > "'+userFile+'"; exit 97; fi');
  const result=packageRun(f); assert.notEqual(result.status,0);
  assert.equal(existsSync(f.repo),false);
  assert.equal(readFileSync(userFile,'utf8'),'keep new user file');
  assert.deepEqual(files(f.dest(2)),['assets/scenarios/browser-monitor/template/user-note.txt']);
  for (const n of [0,1]) assert.equal(existsSync(f.dest(n)),false);
  noPackageDebris(f);
});

test('failed install never removes a destination created by another writer', t => {
  const f=fixture(t); packageSource(f);
  const dest=join(f.repo,'engine.mjs');
  moveShim(f,'if [ "${!#}" = "'+dest+'" ]; then printf "other writer" > "'+dest+'"; exit 97; fi');
  const result=packageRun(f); assert.notEqual(result.status,0);
  assert.equal(readFileSync(dest,'utf8'),'other writer');
  assert.match(result.stderr,/복원 실패.*복구 파일을 보존/);
  assert.equal(existsSync(join(f.repo,'SKILL.md')),false);
  assert.deepEqual(repoBackups(f),[]);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
});

for (const mode of ['git', 'package']) {
  test(`${mode} copies references to the shared source and every temporary profile`, t => {
    const f = fixture(t);
    if (mode === 'package') packageSource(f);
    put(join(f.source, 'SKILL.md'), payload + '\nRead references/file-writing-rules.md\n');
    put(join(f.source, 'references/file-writing-rules.md'), 'fixture contract\n');
    put(join(f.source, 'references/nested/extra.md'), 'fixture extra\n');
    clean(f.source);
    success(mode === 'package' ? packageRun(f) : f.run());
    for (const dest of [f.repo, ...[0, 1, 2].map(f.dest)]) {
      assert.equal(readFileSync(join(dest, 'references/file-writing-rules.md'), 'utf8'), 'fixture contract\n');
      assert.equal(readFileSync(join(dest, 'references/nested/extra.md'), 'utf8'), 'fixture extra\n');
    }
  });
  for (const invalid of ['missing contract', 'linked root', 'linked child', 'broken root']) {
    test(`${mode} refuses references ${invalid} before writing profiles`, t => {
      const f = fixture(t);
      if (mode === 'package') packageSource(f);
      put(join(f.source, 'SKILL.md'), payload + '\nRead references/file-writing-rules.md\n');
      const outside = join(f.root, 'outside');
      put(join(outside, 'file-writing-rules.md'), 'outside unchanged\n');
      if (invalid === 'linked root') symlinkSync(outside, join(f.source, 'references'));
      if (invalid === 'broken root') symlinkSync(join(f.root, 'missing'), join(f.source, 'references'));
      if (invalid === 'linked child') {
        put(join(f.source, 'references/file-writing-rules.md'), 'fixture contract\n');
        symlinkSync(outside, join(f.source, 'references/nested'));
      }
      clean(f.source);
      const beforeProfiles = tree(join(f.aside, 'u')), beforeOutside = tree(outside);
      const result = mode === 'package' ? packageRun(f) : f.run();
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
      assert.deepEqual(tree(outside), beforeOutside);
    });
  }
}

for (const invalid of [false, 'missing contract', 'linked root', 'linked child']) {
  test(`macOS build payload ${invalid || 'includes references'} without downloading or running an app`, { skip: !darwin }, t => {
    const f = fixture(t);
    const build = readFileSync(new URL('../installer/macos/build.sh', import.meta.url), 'utf8');
    const prefix = build.substring(0, build.indexOf('SPARKLE_VERSION='));
    assert.ok(prefix.includes('/payload/'), 'execute the real payload staging prefix');
    const script = join(f.source, 'installer/macos/build.sh');
    put(script, prefix + '\n/bin/cp -R "$RES/payload" "$OUT/staged-payload"\n');
    put(join(f.source, 'installer/macos/bootstrap.sh'), '# fixture\n');
    put(join(f.source, 'installer/macos/adopt-app.sh'), '# fixture\n');
    put(join(f.source, 'SKILL.md'), payload + '\nRead references/file-writing-rules.md\n');
    if (invalid !== 'missing contract') {
      put(join(f.source, 'references/file-writing-rules.md'), 'fixture contract\n');
      put(join(f.source, 'references/nested/extra.md'), 'fixture extra\n');
    }
    const outside = join(f.root, 'outside');
    put(join(outside, 'file-writing-rules.md'), 'outside unchanged\n');
    if (invalid === 'linked root') {
      rmSync(join(f.source, 'references'), { recursive: true });
      symlinkSync(outside, join(f.source, 'references'));
    }
    if (invalid === 'linked child') symlinkSync(outside, join(f.source, 'references/link'));
    clean(f.source);
    const out = join(f.root, 'build-output');
    const result = spawnSync('/bin/bash', [script, '--build', out], { encoding: 'utf8', timeout: 20000 });
    if (invalid) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(out, 'staged-payload')), false);
    } else {
      success(result);
      assert.equal(readFileSync(join(out, 'staged-payload/references/file-writing-rules.md'), 'utf8'), 'fixture contract\n');
      assert.equal(readFileSync(join(out, 'staged-payload/references/nested/extra.md'), 'utf8'), 'fixture extra\n');
      clean(out);
    }
    assert.equal(readFileSync(join(outside, 'file-writing-rules.md'), 'utf8'), 'outside unchanged\n');
  });
}

test('package installs all scenario types, index, guides and future additions without fixed type names', t => {
  const f=fixture(t); packageSource(f);
  const additions=['assets/scenarios/index.md','assets/scenarios/basic/template/workflow/flow.json','assets/scenarios/basic/guide.md','assets/scenarios/future-type/guide.md','assets/scenarios/future-type/template/new.txt','assets/scenarios/future-type/examples/new.md'];
  for(const file of additions) put(join(f.source,file),'content '+file);
  success(packageRun(f));
  for(const file of additions) for(const dest of [f.repo,...[0,1,2].map(f.dest)]) assert.equal(readFileSync(join(dest,file),'utf8'),'content '+file);
  put(join(f.source,'assets/scenarios/another-type/template/new.txt'),'later type');
  success(packageRun(f));
  for(const dest of [f.repo,...[0,1,2].map(f.dest)]) assert.equal(readFileSync(join(dest,'assets/scenarios/another-type/template/new.txt'),'utf8'),'later type');
  assert.deepEqual(repoBackups(f),[]); noPackageDebris(f);
});

for (const baseline of ['released', 'missing', 'unknown']) {
  test('legacy cleanup preserves modified and added files with ' + baseline + ' baseline', t => {
    const f = fixture(t);
    packageSource(f);
    if (baseline !== 'missing') put(join(f.source, 'references/legacy-template-sha256.tsv'), baseline === 'released' ? "1977dda405ee9e4e0dad1dcd031ab57af1fe298de98ee99f91640b08cfe199be\tassets/template/workflow/flow.json\n228d2e9459173ac0509a3e53b10ecfe621cf61962f24cae0d54f15af707e5771\tassets/template/.gitignore\n732689ce7f0172c293bd178fd7d1057cc3c9b481233bf2b66e896b332e2783ba\tassets/template/memory.md\n7b8b38a85d3b2c610f73162f1abd8bce399ed7b6cb0549c9936817fe9f6164cd\tassets/template/workflow/steps/close-tabs.md\n81c19b4fdb6b7995667733f33739223ff4a7d5c5c8a869f680239d8a453e057e\tassets/template/install.sh\n8af253339907afc6630516a63cfe4e2c741183c1f3881e3afae4b9fe41ad7733\tassets/template/workflow/steps/work.md\n8e8134c51e92bfb941d11d2feb5cb2183dfa6526994018e19e844e44324a0507\tassets/template/run.sh\n9feaaf1601e181c1627640c68506a0178ada5f81b3ec2ce62fa5d5ac2cb68577\tassets/template/install.ps1\nb404ea3345660e5846547ce282efae59b8a7082baf4a9a821f481903c645216f\tassets/template/uninstall.sh\nd02afdbee617e40e5a29752c1269575f0b58a4be5b343e9ac5254da426cf16bb\tassets/template/uninstall.ps1\nd9509e20121bcce84bff2af32f05e1ca726da71d5023d0282ffe26a814d98d71\tassets/template/workflow/steps/review.md\ndc23083081e5031f492e626bd2810408656c665ef6a3d2e84651953d565b48f8\tassets/template/tests/scenario.test.mjs\nf37283f64303a6c676a41dd66fd666e31c6c8d28ccda5e5fff93998ea62cada8\tassets/template/workflow/steps/learn.md\nfa5b38c3484f93d38ee6a7072a6bcd8c086b7d0e124f3c1f3375e6b61743c7b1\tassets/template/workflow/context.md\nfb61c02b4c019cbbe7cd5f12743b7fef1c90063e77af6fc64105e24b3b2e3a24\tassets/template/workflow/steps/notify.md\nff415f1dde48bc6259a3043c9d45b977e34d7ec53fcf06b42b1feb1fbaca5d4f\tassets/template/run.ps1\n" : '0'.repeat(64) + '\tassets/template/.gitignore\n');
    const run = () => packageRun(f);
    success(run());
    for (const dest of [f.repo, f.dest(0)]) {
      put(join(dest, 'assets/template/.gitignore'), 'runtime/\n.DS_Store\n');
      put(join(dest, 'assets/template/memory.md'), 'user modified');
      put(join(dest, 'assets/template/custom.txt'), 'user added');
    }
    success(run());
    for (const dest of [f.repo, f.dest(0)]) {
      assert.equal(existsSync(join(dest, 'assets/template/.gitignore')), baseline !== 'released');
      assert.equal(readFileSync(join(dest, 'assets/template/memory.md'), 'utf8'), 'user modified');
      assert.equal(readFileSync(join(dest, 'assets/template/custom.txt'), 'utf8'), 'user added');
    }
  });
}

for (const link of ['leaf', 'ancestor']) {
  test('legacy cleanup never follows ' + link + ' symlinks', t => {
    const f = fixture(t); packageSource(f);
    put(join(f.source, 'references/legacy-template-sha256.tsv'), "1977dda405ee9e4e0dad1dcd031ab57af1fe298de98ee99f91640b08cfe199be\tassets/template/workflow/flow.json\n228d2e9459173ac0509a3e53b10ecfe621cf61962f24cae0d54f15af707e5771\tassets/template/.gitignore\n732689ce7f0172c293bd178fd7d1057cc3c9b481233bf2b66e896b332e2783ba\tassets/template/memory.md\n7b8b38a85d3b2c610f73162f1abd8bce399ed7b6cb0549c9936817fe9f6164cd\tassets/template/workflow/steps/close-tabs.md\n81c19b4fdb6b7995667733f33739223ff4a7d5c5c8a869f680239d8a453e057e\tassets/template/install.sh\n8af253339907afc6630516a63cfe4e2c741183c1f3881e3afae4b9fe41ad7733\tassets/template/workflow/steps/work.md\n8e8134c51e92bfb941d11d2feb5cb2183dfa6526994018e19e844e44324a0507\tassets/template/run.sh\n9feaaf1601e181c1627640c68506a0178ada5f81b3ec2ce62fa5d5ac2cb68577\tassets/template/install.ps1\nb404ea3345660e5846547ce282efae59b8a7082baf4a9a821f481903c645216f\tassets/template/uninstall.sh\nd02afdbee617e40e5a29752c1269575f0b58a4be5b343e9ac5254da426cf16bb\tassets/template/uninstall.ps1\nd9509e20121bcce84bff2af32f05e1ca726da71d5023d0282ffe26a814d98d71\tassets/template/workflow/steps/review.md\ndc23083081e5031f492e626bd2810408656c665ef6a3d2e84651953d565b48f8\tassets/template/tests/scenario.test.mjs\nf37283f64303a6c676a41dd66fd666e31c6c8d28ccda5e5fff93998ea62cada8\tassets/template/workflow/steps/learn.md\nfa5b38c3484f93d38ee6a7072a6bcd8c086b7d0e124f3c1f3375e6b61743c7b1\tassets/template/workflow/context.md\nfb61c02b4c019cbbe7cd5f12743b7fef1c90063e77af6fc64105e24b3b2e3a24\tassets/template/workflow/steps/notify.md\nff415f1dde48bc6259a3043c9d45b977e34d7ec53fcf06b42b1feb1fbaca5d4f\tassets/template/run.ps1\n");
    success(packageRun(f));
    const outside = join(f.root, 'outside');
    put(join(outside, '.gitignore'), 'runtime/\n.DS_Store\n');
    for (const dest of [f.repo, f.dest(0)]) {
      if (link === 'ancestor') symlinkSync(outside, join(dest, 'assets/template'));
      else { mkdirSync(join(dest, 'assets/template'), {recursive:true}); symlinkSync(join(outside, '.gitignore'), join(dest, 'assets/template/.gitignore')); }
    }
    success(packageRun(f));
    assert.equal(readFileSync(join(outside, '.gitignore'), 'utf8'), 'runtime/\n.DS_Store\n');
    for (const dest of [f.repo, f.dest(0)]) assert.ok(lstatSync(join(dest, 'assets/template', ...(link === 'leaf' ? ['.gitignore'] : []))).isSymbolicLink());
  });
}

test('Git replacement keeps legacy user files in shared and profile active destinations', t => {
  const f = fixture(t);
  success(f.run());
  for (const dest of [f.repo, f.dest(0)]) {
    put(join(dest, 'assets/template/memory.md'), 'modified legacy memory');
    put(join(dest, 'assets/template/added.txt'), 'added legacy content');
  }
  success(f.run({ FAKE_DIRTY: ' M engine.mjs\n' }));
  for (const dest of [f.repo, f.dest(0)]) {
    assert.equal(readFileSync(join(dest, 'assets/template/memory.md'), 'utf8'), 'modified legacy memory');
    assert.equal(readFileSync(join(dest, 'assets/template/added.txt'), 'utf8'), 'added legacy content');
  }
});
