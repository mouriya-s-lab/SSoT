import assert from "node:assert/strict";
import { join } from "node:path";

const BASE = join(import.meta.dir, "..", "base");
const SSOT = join(import.meta.dir, "..", "..", "scripts", "ssot.ts");

interface EvalProbe {
  readonly code: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function runEval(args: readonly string[]): Promise<EvalProbe> {
  const proc = Bun.spawn(["bun", SSOT, "eval", BASE, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  assert.equal(stderr.trim(), "", `unexpected stderr: ${stderr}`);
  return { code, payload: JSON.parse(stdout) as Readonly<Record<string, unknown>> };
}

export async function verifyEvalCommand(): Promise<number> {
  // 1. 合法谓词求得 false：value，退出码 0
  const predicateFalse = await runEval([
    "shop_ledger",
    'pre_record(mk_token("o1"), 5, mk_Ledger({mk_token("o1") |-> 3}, {}))',
  ]);
  assert.equal(predicateFalse.code, 0);
  assert.equal(predicateFalse.payload.kind, "value");
  assert.equal(predicateFalse.payload.text, "false");

  // 2. 动态状态不变式被违反（VDMJ 4079）：error，退出码 1
  const invariantRejected = await runEval([
    "shop_ledger",
    'mk_Ledger({|->}, {mk_token("o1")})',
  ]);
  assert.equal(invariantRejected.code, 1);
  assert.equal(invariantRejected.payload.kind, "error");
  assert.equal(invariantRejected.payload.number, 4079);

  // 3. 记录构造字段数不匹配（静态类型错误 3128）：invalidExpression，退出码 2
  const badArity = await runEval(["shop_ledger", "mk_Ledger({|->})"]);
  assert.equal(badArity.code, 2);
  assert.equal(badArity.payload.kind, "invalidExpression");
  assert.equal(badArity.payload.number, 3128);

  // 4. 实参静态类型不匹配（3061）：invalidExpression，退出码 2
  const badArgType = await runEval([
    "shop_ledger",
    "pre_record(123, 5, mk_Ledger({|->}, {}))",
  ]);
  assert.equal(badArgType.code, 2);
  assert.equal(badArgType.payload.kind, "invalidExpression");
  assert.equal(badArgType.payload.number, 3061);

  // 5. 语法错误：invalidExpression，退出码 2
  const syntaxError = await runEval(["shop_ledger", "mk_Ledger("]);
  assert.equal(syntaxError.code, 2);
  assert.equal(syntaxError.payload.kind, "invalidExpression");

  // 6. 未知模块：invalidExpression，退出码 2
  const unknownModule = await runEval(["no_such_module", "1 + 1"]);
  assert.equal(unknownModule.code, 2);
  assert.equal(unknownModule.payload.kind, "invalidExpression");

  return 6;
}
