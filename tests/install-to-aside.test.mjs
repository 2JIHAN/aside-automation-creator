import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, chmodSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = fileURLToPath(new URL('../install-to-aside.sh', import.meta.url));
const cleaner = '/Users/seesoong/.aside/u/0/skills/user/quarantine-free-files/scripts/clear-quarantine.sh';
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
  put(join(source, 'assets', 'template', 'marker.txt'), 'template marker\n');
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
  assert.equal(readFileSync(join(f.dest(n), 'assets/template/marker.txt'), 'utf8'), 'template marker\n');
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
  const marker = join(f.source, 'assets/template/marker.txt');
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
    const copied = join(f.dest(n), 'assets/template/marker.txt');
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
  rmSync(join(f.repo, 'assets/template/marker.txt'));
  const before = tree(f.repo);
  const result = f.run({ FAKE_DIRTY: ' M engine.mjs\n D assets/template/marker.txt\n?? untracked.txt\n' });
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
});

test('package engine-only update backs up only engine and leaves profiles and runtime unchanged', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  const node = identity(join(f.repo, 'runtime/node'));
  const profiles = [0,1,2].map(n => identity(join(f.dest(n), 'SKILL.md')));
  put(join(f.source, 'engine.mjs'), '// new engine\n');
  const result=packageRun(f); success(result);
  const backups=repoBackups(f); assert.equal(backups.length,1);
  assert.match(backups[0], /^source\.backup-\d{8}-\d{6}-\d+$/);
  assert.deepEqual(files(join(f.root,backups[0])), ['engine.mjs']);
  assert.equal(readFileSync(join(f.root,backups[0],'engine.mjs'),'utf8'),'// shared engine fixture\n');
  assert.deepEqual(identity(join(f.repo,'runtime/node')),node);
  assert.deepEqual([0,1,2].map(n => identity(join(f.dest(n),'SKILL.md'))),profiles);
  assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  assert.match(result.stdout,/공용 파일: 업데이트 1개, 건너뜀 6개/);
  assert.match(result.stdout,/프로필 파일: 업데이트 0개, 건너뜀 6개/);
});

test('package template-only update backs up just changed template in shared source and each profile', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  put(join(f.source,'assets/template/marker.txt'),'new template\n');
  const result=packageRun(f); success(result);
  assert.deepEqual(files(join(f.root,repoBackups(f)[0])),['assets/template/marker.txt']);
  const base=join(f.aside,'skill-backups',skill);
  assert.deepEqual(files(join(base,readdirSync(base)[0])),[0,1,2].map(n=>'u'+n+'/assets/template/marker.txt'));
  for (const n of [0,1,2]) assert.equal(readFileSync(join(f.dest(n),'assets/template/marker.txt'),'utf8'),'new template\n');
  assert.match(result.stdout,/프로필 파일: 업데이트 3개, 건너뜀 3개/);
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

test('package mode-only change updates and backs up only that file', t => {
  const f=fixture(t); packageSource(f); success(packageRun(f));
  chmodSync(join(f.source,'engine.mjs'),0o444); success(packageRun(f));
  assert.equal(statSync(join(f.repo,'engine.mjs')).mode & 0o777,0o444);
  assert.deepEqual(files(join(f.root,repoBackups(f)[0])),['engine.mjs']);
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
    const dest=target==='shared' ? join(f.repo,'engine.mjs') : join(f.dest(0),'assets/template/marker.txt');
    const original=readFileSync(dest,'utf8'), before=identity(dest);
    put(join(f.source,target==='shared' ? 'engine.mjs' : 'assets/template/marker.txt'),'replacement\n');
    put(join(f.bin,'mv'),'#!/bin/bash\nfor arg in "$@"; do [ "$arg" != "'+dest+'" ] || exit 97; done\nexec /bin/mv "$@"\n');
    chmodSync(join(f.bin,'mv'),0o755); clean(join(f.bin,'mv'));
    const result=packageRun(f); assert.notEqual(result.status,0);
    assert.match(result.stderr,/기존 파일을 유지/); assert.doesNotMatch(result.stdout,/완료: 설치/);
    assert.equal(readFileSync(dest,'utf8'),original); assert.deepEqual(identity(dest),before);
    const base=join(f.aside,'skill-backups',skill);
    const backup=target==='shared' ? join(f.root,repoBackups(f)[0],'engine.mjs') : join(base,readdirSync(base)[0],'u0/assets/template/marker.txt');
    assert.equal(readFileSync(backup,'utf8'),original);
    assert.ok(!files(f.repo).some(p=>p.includes('.automation-creator-file.')));
    assert.ok(!files(f.dest(0)).some(p=>p.includes('.automation-creator-file.')));
  });
}

for (const area of ['shared', 'profile']) {
  test('package refuses nested '+area+' destination symlink ancestors without target writes', t => {
    const f=fixture(t); packageSource(f); success(packageRun(f));
    const outside=join(f.root,'outside'); put(join(outside,'marker.txt'),'keep');
    const parent=area==='shared' ? join(f.repo,'assets/template') : join(f.dest(0),'assets/template');
    rmSync(parent,{recursive:true}); symlinkSync(outside,parent);
    const before=tree(outside); const result=packageRun(f);
    assert.notEqual(result.status,0); assert.match(result.stderr,/심볼릭 링크/);
    assert.deepEqual(tree(outside),before); assert.deepEqual(repoBackups(f),[]);
    assert.equal(existsSync(join(f.aside,'skill-backups')),false);
  });
}

test('package profile root symlink is backed up as link without target changes', t => {
  const f=fixture(t); packageSource(f);
  const outside=join(f.root,'outside'); put(join(outside,'sentinel'),'keep');
  mkdirSync(resolve(f.dest(0),'..'),{recursive:true}); symlinkSync(outside,f.dest(0));
  success(packageRun(f)); installed(f,0);
  assert.deepEqual(readdirSync(outside),['sentinel']);
  const base=join(f.aside,'skill-backups',skill), backup=join(base,readdirSync(base)[0],'u0');
  assert.equal(lstatSync(backup).isSymbolicLink(),true); assert.equal(readlinkSync(backup),outside);
});

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
