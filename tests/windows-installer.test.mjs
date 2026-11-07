import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = fileURLToPath(new URL('../install-to-aside.ps1', import.meta.url));
const cleaner = process.env.ASIDE_CLEAR_QUARANTINE;
const pwsh = [process.env.POWERSHELL_EXE, 'pwsh', 'powershell.exe'].filter(Boolean).find(exe => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0);
const options = { skip: !pwsh && 'PowerShell is not available; set POWERSHELL_EXE' };
const remote = 'https://github.com/2JIHAN/aside-automation-creator.git';
const skill = 'aside-automation-creator';
const quote = text => `'${text.replaceAll("'", "''")}'`;
function put(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
function clean(file) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/bin/bash', [cleaner, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function tree(file) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) return 'symlink';
  return lstatSync(file).isDirectory() ? Object.fromEntries(readdirSync(file).sort().map(name => [name, tree(join(file, name))])) : readFileSync(file).toString('base64');
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aside-윈도 설치 '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const aside = join(root, 'aside home');
  const repo = join(root, '공통 저장소');
  const source = join(root, 'clone payload');
  const log = join(root, 'git.jsonl');
  const wrapper = join(root, 'mock.ps1');
  for (const profile of ['0', '1', '12', 'not-numeric']) mkdirSync(join(aside, 'u', profile), { recursive: true });
  for (const [file, content] of [['SKILL.md', '---\nname: "aside-automation-creator"\n---\nfixture skill'], ['engine.mjs', '// fixture engine'], ['assets/scenarios/browser-monitor/template/marker.txt', 'template'], ['README.md', 'not installed'], ['tests/private.txt', 'not installed']]) put(join(source, file), content);
  put(wrapper, `﻿function global:git {
  $a = @($args)
  ConvertTo-Json -Compress -InputObject $a | Add-Content -LiteralPath $env:MOCK_LOG
  if ($env:MOCK_GIT_FORBIDDEN) { throw 'Git must not be called in package mode' }
  $global:LASTEXITCODE = 0
  if ($a[0] -eq 'clone') {
    if ($a -notcontains '${remote}') { $global:LASTEXITCODE = 91; return }
    $target = $a[-1]
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    if ($env:MOCK_CLONE_FAIL) { Set-Content (Join-Path $target 'partial') 'partial'; $global:LASTEXITCODE = 95; return }
    Get-ChildItem -LiteralPath $env:MOCK_SOURCE -Force | Copy-Item -Destination $target -Recurse -Force
    New-Item -ItemType Directory -Path (Join-Path $target '.git') -Force | Out-Null
    return
  }
  if ($a[0] -ne '-C') { $global:LASTEXITCODE = 92; return }
  switch ($a[2]) {
    'remote' { if ($env:MOCK_REMOTE) { $env:MOCK_REMOTE } else { '${remote}' }; return }
    'symbolic-ref' { if ($env:MOCK_BRANCH) { $env:MOCK_BRANCH } else { 'main' }; return }
    'status' { if ($env:MOCK_DIRTY) { $env:MOCK_DIRTY }; return }
    'pull' { if ($env:MOCK_PULL_FAIL) { $global:LASTEXITCODE = 96 }; return }
    default { $global:LASTEXITCODE = 93; return }
  }
}
& ${quote(installer)} @args
`);
  clean(root);
  const run = (extra = {}, explicit = true, scriptArgs = []) => {
    clean(root);
    return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', wrapper, ...(explicit ? ['-AsideHome', aside, '-Repository', repo] : []), ...scriptArgs], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ASIDE_HOME: aside, ASIDE_AUTOMATION_CREATOR_REPO: repo, MOCK_SOURCE: source, MOCK_LOG: log, MOCK_REMOTE: '', MOCK_BRANCH: '', MOCK_DIRTY: '', MOCK_CLONE_FAIL: '', ...extra },
    });
  };
  return { root, aside, repo, source, log, run, dest: n => join(aside, 'u', String(n), 'skills/user', skill) };
}
function success(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function installed(f) {
  for (const n of [0, 1, 12]) {
    assert.deepEqual(readdirSync(f.dest(n)).sort(), ['SKILL.md', 'assets']);
    assert.equal(readFileSync(join(f.dest(n), 'assets/scenarios/browser-monitor/template/marker.txt'), 'utf8'), 'template');
  }
  assert.equal(existsSync(join(f.aside, 'u/not-numeric/skills')), false);
}

test('PowerShell parses the shipped Windows installer', options, () => {
  const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', `$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(${quote(installer)}, [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`], { encoding: 'utf8' });
  success(result);
});

test('Windows installer accepts explicit paths, installs payload only and backs up old skills', options, t => {
  const f = fixture(t);
  put(join(f.dest(1), 'old.txt'), 'keep old skill');
  put(join(f.aside, 'u/0/skills/user/unrelated/SKILL.md'), 'keep unrelated');
  success(f.run({ ASIDE_HOME: join(f.root, 'wrong home'), ASIDE_AUTOMATION_CREATOR_REPO: join(f.root, 'wrong repo') }));
  installed(f);
  assert.equal(readFileSync(join(f.aside, 'u/0/skills/user/unrelated/SKILL.md'), 'utf8'), 'keep unrelated');
  const backups = join(f.aside, 'skill-backups', skill);
  const runs = readdirSync(backups);
  assert.equal(runs.length, 1);
  assert.equal(readFileSync(join(backups, runs[0], 'u1/old.txt'), 'utf8'), 'keep old skill');
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(args => args[0] === 'clone' && args.includes(remote) && args.includes('main')));
});

test('Windows installer uses environment overrides and updates clean source without runtime execution', options, t => {
  const f = fixture(t);
  success(f.run({}, false));
  success(f.run({}, false));
  installed(f);
  assert.match(readFileSync(f.log, 'utf8'), /pull/);
  assert.equal(existsSync(join(f.aside, 'routines')), false);
});

for (const [name, env] of [['wrong remote', { MOCK_REMOTE: 'https://invalid.example/other.git' }], ['wrong branch', { MOCK_BRANCH: 'topic' }]]) {
  test(`Windows installer rejects ${name} before changing profiles`, options, t => {
    const f = fixture(t);
    mkdirSync(join(f.repo, '.git'), { recursive: true });
    const before = tree(join(f.aside, 'u'));
    const result = f.run(env);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(tree(join(f.aside, 'u')), before);
    assert.doesNotMatch(readFileSync(f.log, 'utf8'), /clone|pull/);
  });
}

test('Windows installer stages dirty source before preserving the original as a backup', options, t => {
  const f = fixture(t);
  success(f.run());
  put(join(f.repo, 'engine.mjs'), '// local changes');
  put(join(f.repo, 'untracked.txt'), 'keep me');
  const before = tree(f.repo);
  success(f.run({ MOCK_DIRTY: ' M engine.mjs\n?? untracked.txt' }));
  const backups = readdirSync(f.root).filter(name => name.startsWith('공통 저장소.backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(tree(join(f.root, backups[0])), before);
  assert.equal(readFileSync(join(f.repo, 'engine.mjs'), 'utf8'), '// fixture engine');
  installed(f);
});

for (const reason of ['clone failure', 'invalid staged payload']) {
  test(`Windows installer preserves dirty source and profiles after ${reason}`, options, t => {
    const f = fixture(t);
    success(f.run());
    put(join(f.repo, 'engine.mjs'), '// keep local work');
    const beforeRepo = tree(f.repo);
    const beforeProfiles = tree(join(f.aside, 'u'));
    if (reason === 'invalid staged payload') rmSync(join(f.source, 'engine.mjs'));
    const result = f.run({ MOCK_DIRTY: ' M engine.mjs', ...(reason === 'clone failure' ? { MOCK_CLONE_FAIL: '1' } : {}) });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(tree(f.repo), beforeRepo);
    assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
    assert.deepEqual(readdirSync(f.root).filter(name => name.includes('.backup-')), []);
    assert.deepEqual(readdirSync(f.aside).filter(name => name.startsWith('.automation-creator-install.')), []);
  });
}

test('Windows installer rejects a reparse-point skill parent without following it', options, t => {
  const f = fixture(t);
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  try { symlinkSync(outside, join(f.aside, 'u/12/skills'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Creating a Windows reparse point requires permission'); throw error; }
  const before = tree(join(f.aside, 'u'));
  const result = f.run();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(tree(join(f.aside, 'u')), before);
  assert.deepEqual(readdirSync(outside), []);
});

for (const name of ['unrelated source directory', 'no numeric profiles']) {
  test(`Windows installer refuses ${name} without cloning or changing profiles`, options, t => {
    const f = fixture(t);
    if (name === 'unrelated source directory') mkdirSync(f.repo);
    else for (const n of [0, 1, 12]) rmSync(join(f.aside, 'u', String(n)), { recursive: true });
    const before = tree(join(f.aside, 'u'));
    assert.notEqual(f.run().status, 0);
    assert.deepEqual(tree(join(f.aside, 'u')), before);
    if (existsSync(f.log)) assert.doesNotMatch(readFileSync(f.log, 'utf8'), /clone|pull/);
  });
}

test('Windows installer checks native Git pull failure before profile writes', options, t => {
  const f = fixture(t);
  success(f.run());
  const before = tree(join(f.aside, 'u'));
  const result = f.run({ MOCK_PULL_FAIL: '1' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(tree(join(f.aside, 'u')), before);
});


test('Windows package installer copies bundled runtime and installs only skill payload without Git', options, t => {
  const f = fixture(t);
  put(join(f.source, 'runtime/node.exe'), 'bundled Node fixture');
  const beforeSource = tree(f.source);
  success(f.run({ MOCK_GIT_FORBIDDEN: '1' }, true, ['-SourceDirectory', f.source]));
  assert.equal(existsSync(f.log), false, 'package mode must never invoke Git');
  assert.deepEqual(tree(f.repo), beforeSource);
  assert.deepEqual(tree(f.source), beforeSource);
  assert.equal(readFileSync(join(f.repo, 'runtime/node.exe'), 'utf8'), 'bundled Node fixture');
  installed(f);
  assert.equal(existsSync(join(f.aside, 'routines')), false);
});

test('Windows package reinstall preserves the entire previous source, whether clean or locally modified', options, t => {
  for (const modified of [false, true]) {
    const f = fixture(t);
    put(join(f.source, 'runtime/node.exe'), 'old bundled Node');
    success(f.run({ MOCK_GIT_FORBIDDEN: '1' }, true, ['-SourceDirectory', f.source]));
    if (modified) {
      put(join(f.repo, 'engine.mjs'), '// local engine changes');
      put(join(f.repo, 'untracked.txt'), 'preserve local file');
    }
    const before = tree(f.repo);
    put(join(f.source, 'runtime/node.exe'), 'new bundled Node');
    put(join(f.source, 'engine.mjs'), '// new package engine');
    success(f.run({ MOCK_GIT_FORBIDDEN: '1' }, true, ['-SourceDirectory', f.source]));
    const backups = readdirSync(f.root).filter(name => name.startsWith('공통 저장소.backup-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(tree(join(f.root, backups[0])), before);
    assert.deepEqual(tree(f.repo), tree(f.source));
    assert.equal(existsSync(f.log), false);
    installed(f);
  }
});

test('Windows package installer preserves existing data on invalid payload or unrelated destination', options, t => {
  for (const reason of ['invalid payload', 'unrelated destination']) {
    const f = fixture(t);
    if (reason === 'invalid payload') {
      success(f.run({ MOCK_GIT_FORBIDDEN: '1' }, true, ['-SourceDirectory', f.source]));
      put(join(f.repo, 'local.txt'), 'keep existing package changes');
      rmSync(join(f.source, 'engine.mjs'));
    } else put(join(f.repo, 'valuable.txt'), 'unrelated directory must survive');
    const beforeRepo = tree(f.repo);
    const beforeProfiles = tree(join(f.aside, 'u'));
    const result = f.run({ MOCK_GIT_FORBIDDEN: '1' }, true, ['-SourceDirectory', f.source]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(tree(f.repo), beforeRepo);
    assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
    assert.equal(existsSync(f.log), false);
    assert.deepEqual(readdirSync(f.root).filter(name => name.includes('.backup-')), []);
    assert.deepEqual(readdirSync(f.aside).filter(name => name.startsWith('.automation-creator-install.')), []);
  }
});

for (const mode of ['git', 'package']) {
  test(`Windows ${mode} copies references to shared source and every temporary profile`, options, t => {
    const f = fixture(t);
    put(join(f.source, 'SKILL.md'), '---\nname: "aside-automation-creator"\n---\nRead references/file-writing-rules.md\n');
    put(join(f.source, 'references/file-writing-rules.md'), 'fixture contract');
    put(join(f.source, 'references/nested/extra.md'), 'fixture extra');
    const args = mode === 'package' ? ['-SourceDirectory', f.source] : [];
    success(f.run({}, true, args));
    for (const dest of [f.repo, ...[0, 1, 12].map(f.dest)]) {
      assert.equal(readFileSync(join(dest, 'references/file-writing-rules.md'), 'utf8'), 'fixture contract');
      assert.equal(readFileSync(join(dest, 'references/nested/extra.md'), 'utf8'), 'fixture extra');
    }
  });
  for (const invalid of ['missing contract', 'linked root', 'linked child']) {
    test(`Windows ${mode} refuses references ${invalid} before profile writes`, options, t => {
      const f = fixture(t);
      put(join(f.source, 'SKILL.md'), '---\nname: "aside-automation-creator"\n---\nRead references/file-writing-rules.md\n');
      const outside = join(f.root, 'outside');
      put(join(outside, 'file-writing-rules.md'), 'outside unchanged');
      if (invalid !== 'missing contract') {
        const link = invalid === 'linked root' ? join(f.source, 'references') : join(f.source, 'references/nested');
        if (invalid === 'linked child') put(join(f.source, 'references/file-writing-rules.md'), 'fixture contract');
        try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
        catch (error) { if (error.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return; } throw error; }
      }
      const beforeProfiles = tree(join(f.aside, 'u')), beforeOutside = tree(outside);
      const result = f.run({}, true, mode === 'package' ? ['-SourceDirectory', f.source] : []);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(tree(join(f.aside, 'u')), beforeProfiles);
      assert.deepEqual(tree(outside), beforeOutside);
    });
  }
}

test('Windows package recursively includes basic, index and arbitrary future scenario types', options, t => {
  const f=fixture(t);
  const additions=['assets/scenarios/index.md','assets/scenarios/basic/template/workflow/flow.json','assets/scenarios/future-type/guide.md','assets/scenarios/future-type/template/new.txt','assets/scenarios/future-type/examples/new.md'];
  for(const file of additions) put(join(f.source,file),'content '+file);
  put(join(f.source,'runtime/node.exe'),'bundled fixture');
  success(f.run({MOCK_GIT_FORBIDDEN:'1'}, true, ['-SourceDirectory', f.source]));
  assert.equal(existsSync(f.log),false);
  for(const file of additions) for(const dest of [f.repo,...[0,1,12].map(f.dest)]) assert.equal(readFileSync(join(dest,file),'utf8'),'content '+file);
});

for (const baseline of ['released', 'missing', 'unknown']) {
  test('Windows legacy cleanup preserves modified and added files with ' + baseline + ' baseline', options, t => {
    const f = fixture(t);

    if (baseline !== 'missing') put(join(f.source, 'references/legacy-template-sha256.tsv'), baseline === 'released' ? "1977dda405ee9e4e0dad1dcd031ab57af1fe298de98ee99f91640b08cfe199be\tassets/template/workflow/flow.json\n228d2e9459173ac0509a3e53b10ecfe621cf61962f24cae0d54f15af707e5771\tassets/template/.gitignore\n732689ce7f0172c293bd178fd7d1057cc3c9b481233bf2b66e896b332e2783ba\tassets/template/memory.md\n7b8b38a85d3b2c610f73162f1abd8bce399ed7b6cb0549c9936817fe9f6164cd\tassets/template/workflow/steps/close-tabs.md\n81c19b4fdb6b7995667733f33739223ff4a7d5c5c8a869f680239d8a453e057e\tassets/template/install.sh\n8af253339907afc6630516a63cfe4e2c741183c1f3881e3afae4b9fe41ad7733\tassets/template/workflow/steps/work.md\n8e8134c51e92bfb941d11d2feb5cb2183dfa6526994018e19e844e44324a0507\tassets/template/run.sh\n9feaaf1601e181c1627640c68506a0178ada5f81b3ec2ce62fa5d5ac2cb68577\tassets/template/install.ps1\nb404ea3345660e5846547ce282efae59b8a7082baf4a9a821f481903c645216f\tassets/template/uninstall.sh\nd02afdbee617e40e5a29752c1269575f0b58a4be5b343e9ac5254da426cf16bb\tassets/template/uninstall.ps1\nd9509e20121bcce84bff2af32f05e1ca726da71d5023d0282ffe26a814d98d71\tassets/template/workflow/steps/review.md\ndc23083081e5031f492e626bd2810408656c665ef6a3d2e84651953d565b48f8\tassets/template/tests/scenario.test.mjs\nf37283f64303a6c676a41dd66fd666e31c6c8d28ccda5e5fff93998ea62cada8\tassets/template/workflow/steps/learn.md\nfa5b38c3484f93d38ee6a7072a6bcd8c086b7d0e124f3c1f3375e6b61743c7b1\tassets/template/workflow/context.md\nfb61c02b4c019cbbe7cd5f12743b7fef1c90063e77af6fc64105e24b3b2e3a24\tassets/template/workflow/steps/notify.md\nff415f1dde48bc6259a3043c9d45b977e34d7ec53fcf06b42b1feb1fbaca5d4f\tassets/template/run.ps1\n" : '0'.repeat(64) + '\tassets/template/.gitignore\n');
    const run = () => f.run({}, true, ['-SourceDirectory', f.source]);
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
