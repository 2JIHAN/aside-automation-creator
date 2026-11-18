import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

const MAX_RECHECKS_PER_STEP = 2;

function main() {
  if (process.argv.length !== 4 && process.argv.length !== 5) {
    throw Error("사용법: node engine.mjs <account> <scenario-folder> [flow-file]");
  }
  const root = fs.realpathSync(process.argv[3]);
  const cli = process.env.ASIDE_CLI_PATH || (process.platform === "win32" ? "aside.exe" : path.join(os.homedir(), ".local/bin/aside"));
  const account = process.argv[2];
  // 흐름 파일을 생략하면 기존처럼 workflow/flow.json을 쓴다. 지정한 파일은 시나리오 폴더 안에 있어야 한다.
  const requestedFlow = path.resolve(root, process.argv[4] ?? "workflow/flow.json");
  if (!requestedFlow.startsWith(root + path.sep)) {
    throw Error("흐름 파일은 시나리오 폴더 안에 있어야 합니다.");
  }
  const flowFile = fs.realpathSync(requestedFlow);
  if (!flowFile.startsWith(root + path.sep) || !fs.lstatSync(requestedFlow).isFile()) {
    throw Error("흐름 파일은 시나리오 폴더 안의 일반 파일이어야 합니다.");
  }
  const flow = JSON.parse(fs.readFileSync(flowFile, "utf8"));
  const contextFile = path.join(root, flow.contextFile);

  const run = {
    startedAt: new Date().toISOString(),
    sessionId: null,
    flowFile: path.relative(root, flowFile),
    state: { ...flow.initialState },
    turns: [],
  };
  const folderName = run.startedAt.replace(/[:.]/g, "-") + "-" + process.pid;
  const runsRoot = path.join(root, "runs");
  if (fs.existsSync(runsRoot) && fs.lstatSync(runsRoot).isSymbolicLink()) {
    throw Error("실행 기록 폴더의 심볼릭 링크를 따라가지 않습니다.");
  }
  run.runDir = path.join(runsRoot, folderName);
  fs.mkdirSync(run.runDir, { recursive: true });

  let stepId = flow.startStep;
  let step = flow.steps[stepId];

  try {
    while (!run.finishStatus) {
      if (!Object.hasOwn(run.state, "현재턴결과")) {
        throw Error("현재턴결과 상태변수가 선언되지 않았습니다.");
      }
      if (step.stateKey && !Object.hasOwn(run.state, step.stateKey)) {
        throw Error(`선언되지 않은 상태변수입니다: ${step.stateKey}`);
      }
      const turnNumber = String(run.turns.length + 1).padStart(2, "0");
      const turn = {
        step: stepId,
        evidenceDir: `evidence/${turnNumber}-${stepId}`,
      };
      run.turns.push(turn);
      const evidenceFolder = path.join(run.runDir, turn.evidenceDir);
      fs.mkdirSync(evidenceFolder, { recursive: true });

      let prompt = "";
      if (!run.sessionId) prompt += `실행 결과 폴더: \`${run.runDir}\`\n`;
      prompt += `이번 턴 증거 폴더: \`${evidenceFolder}\`\n`;
      if (run.returnStep) prompt += `검토 복귀 대상: ${run.returnStep}\n`;
      const limitedTurn = run.turns.find(previous => previous.recheckLimit);
      if (limitedTurn) prompt += `재확인 제한 기록: ${JSON.stringify(limitedTurn.recheckLimit)}\n`;

      if (!run.sessionId) {
        prompt += `\n필수 배경지식: \`${contextFile}\`\n`;
      }

      const instructionFile = path.join(root, step.instructionFile);
      prompt += `이번 턴에서는 다음 단계만 수행하세요: \`${instructionFile}\`\n`;

      let command;
      if (!run.sessionId) {
        command = ["exec", "--account", account, "--effort", "low", prompt];
      } else {
        command = ["session", "resume", "--account", account, run.sessionId, prompt,];
      }
      const reply = spawnSync(cli, command, { encoding: "utf8" });
      if (reply.error) {
        throw Error(`Aside 실행을 시작하지 못했습니다 (${reply.error.code ?? "unknown"}).`);
      }
      if (reply.status !== 0) {
        throw Error(
          `Aside 실행 실패 (종료 코드 ${reply.status}).`,
        );
      }

      if (!run.sessionId) {
        const terminalOutput = reply.stdout + "\n" + reply.stderr;
        const sessionNotice = terminalOutput.match(
          /created new session:\s+(\w+)/,
        );
        if (!sessionNotice) throw Error("Aside 세션 ID를 확인하지 못했습니다.");
        run.sessionId = sessionNotice[1];
      }
      const text = stripVTControlCharacters(reply.stdout).trim();
      const lastLine = text.split("\n").at(-1);
      const stateLine = lastLine.match(/^상태:\s*(.+)$/);
      if (!stateLine) throw Error("마지막 줄에 상태: 값이 없습니다.");
      let value = stateLine[1];
      if (step.rememberCaller && run.returnStep && value === "재확인") {
        const completed = run.turns.filter(previous =>
          flow.steps[previous.step].rememberCaller && previous.nextStep === run.returnStep,
        ).length;
        if (completed >= MAX_RECHECKS_PER_STEP) {
          turn.recheckLimit = {
            step: run.returnStep,
            limit: MAX_RECHECKS_PER_STEP,
            completed,
            reportedValue: value,
            detail: `동일 업무 재확인 ${MAX_RECHECKS_PER_STEP}회 한도에 도달해 추가 복귀를 차단했습니다.`,
          };
          value = "해결불가";
        }
      }
      const nextState = { ...run.state, 현재턴결과: value };
      if (step.stateKey) nextState[step.stateKey] = value;
      const matches = step.next.filter(rule =>
        Object.entries(rule.when ?? {}).every(([key, expected]) => nextState[key] === expected),
      );
      if (matches.length !== 1) {
        throw Error(`다음 단계 조건이 ${matches.length}개 일치합니다.`);
      }
      const { step: destination, finishWithStatus } = matches[0];
      if (Boolean(destination) === Boolean(finishWithStatus)) {
        throw Error("다음 단계와 종료 상태 중 하나만 지정해야 합니다.");
      }
      if (finishWithStatus && typeof finishWithStatus !== "string") {
        throw Error("종료 상태는 문자열이어야 합니다.");
      }
      const nextStep = destination === "$caller" ? run.returnStep : destination;
      const target = flow.steps[nextStep];
      if (destination && !target?.instructionFile) throw Error(`다음 단계가 없습니다: ${nextStep}`);
      if (destination === "$caller" &&
          (!step.rememberCaller || target.rememberCaller || nextStep === stepId)) {
        throw Error(`복귀 대상이 잘못되었습니다: ${nextStep}`);
      }
      if (target?.rememberCaller && run.returnStep) {
        throw Error("중첩 검토 복귀는 지원하지 않습니다.");
      }

      run.state = nextState;
      turn.response = { value };
      if (step.rememberCaller) delete run.returnStep;
      if (finishWithStatus) {
        run.finishStatus = turn.finishStatus = finishWithStatus;
      } else {
        turn.nextStep = nextStep;
        if (target.rememberCaller) run.returnStep = stepId;
        stepId = nextStep;
        step = target;
      }
    }

  } catch (error) {
    run.finishStatus = "stopped";
    run.stop = { step: stepId, detail: error.message };
  }

  run.finishedAt = new Date().toISOString();
  const runFile = path.join(run.runDir, "run.json");
  fs.writeFileSync(runFile, JSON.stringify(run, null, 2) + "\n");
  if (process.platform === "darwin") {
    const cleanup = spawnSync("/bin/bash", [fileURLToPath(new URL("./clear-quarantine.sh", import.meta.url)), run.runDir], { encoding: "utf8", timeout: 30000 });
    if (cleanup.error || cleanup.status !== 0) {
      run.finishStatus = "stopped";
      const detail = "실행 결과 격리 속성 정리 실패: " + (cleanup.error?.code || cleanup.stderr.trim() || `exit ${cleanup.status}`);
      run.stop = run.stop ? { ...run.stop, detail: run.stop.detail + "\n" + detail } : { step: "cleanup", detail };
      fs.writeFileSync(runFile, JSON.stringify(run, null, 2) + "\n");
    }
  }
  console.log("ENGINE_RESULT=" + JSON.stringify(run));
  if (run.stop) {
    process.exitCode = 1;
  }
}

main();
