import { join } from "node:path";
import { vdmClasspath } from "../scripts/src/install";

export interface ApiCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly line: string;
}

interface ProbeCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const APIS = ["ModuleInterpreter", "FlatEnvironment", "TCLocalDefinition", "Value.convertTo", "TokenValue.value", "FunctionValue.measure"] as const;

function probeChecks(value: unknown): readonly ProbeCheck[] {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array from VdmjApi.java");
  const checks: ProbeCheck[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== "object" || item === null || !("id" in item) || typeof item.id !== "string"
      || !("ok" in item) || typeof item.ok !== "boolean" || !("detail" in item) || typeof item.detail !== "string") {
      throw new Error("Invalid API result from VdmjApi.java");
    }
    checks.push({ id: item.id, ok: item.ok, detail: item.detail });
  }
  if (checks.length !== APIS.length || APIS.some((api) => checks.filter((check) => check.id === api).length !== 1)) {
    throw new Error(`Expected one result for each VDMJ API (${APIS.join(", ")}); got ${checks.map((check) => check.id).join(", ")}`);
  }
  return checks;
}

export async function vdmjApiChecks(): Promise<readonly ApiCheck[]> {
  try {
    const proc = Bun.spawn(["java", "-cp", vdmClasspath(), join(import.meta.dir, "VdmjApi.java")], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      killSignal: "SIGKILL",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0 || proc.signalCode !== null) {
      return [{
        id: "vdmj-api:probe",
        ok: false,
        line: `FAIL VdmjApi.java: ${proc.signalCode === null ? `java exited ${code}` : `java killed by ${proc.signalCode} (120s deadline)`}\n${err.trim()}${out.trim() ? `\n${out.trim()}` : ""}`,
      }];
    }
    let checks: readonly ProbeCheck[];
    try {
      const parsed: unknown = JSON.parse(out);
      checks = probeChecks(parsed);
    } catch (error) {
      throw new Error(`Invalid VdmjApi.java output: ${error instanceof Error ? error.message : String(error)}\n${out.trim()}${err.trim() ? `\n${err.trim()}` : ""}`);
    }
    return checks.map((check) => ({
      id: `vdmj-api:${check.id}`,
      ok: check.ok,
      line: check.ok ? check.detail : `FAIL ${check.id}: ${check.detail}`,
    }));
  } catch (error) {
    return [{ id: "vdmj-api:probe", ok: false, line: `FAIL VdmjApi.java: ${error instanceof Error ? error.message : String(error)}` }];
  }
}
