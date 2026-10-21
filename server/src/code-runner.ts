// Runs student Python code against a code exercise's tests through a Piston execution API
// (https://github.com/engineer-man/piston). The language and version are pinned here, never taken
// from the client. Piston itself is the sandbox; this module only bounds what we send and keep.

export const PYTHON_LANGUAGE = "python";
export const PYTHON_VERSION = "3.10.0";

export const MAX_CODE_CHARS = 20_000;
export const MAX_IO_CHARS = 4_000;
export const MAX_OUTPUT_CHARS = 4_000;
export const MAX_TESTS = 10;
export const MAX_CONCURRENT_EXECUTIONS = 4;
const RUN_TIMEOUT_MS = 3_000;
const COMPILE_TIMEOUT_MS = 10_000;
const RUN_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
// nginx's default proxy_read_timeout is 60s; stop starting new tests well before it.
const TOTAL_BUDGET_MS = 45_000;

export interface CodeTest {
  name?: string | undefined;
  stdin: string;
  expected_stdout: string;
}

export interface CodeTestResult {
  name: string | null;
  passed: boolean;
  ran: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export interface CodeRunResult {
  results: CodeTestResult[];
  passedCount: number;
  totalCount: number;
}

export type RunCode = (code: string, tests: readonly CodeTest[]) => Promise<CodeRunResult>;

export type CodeRunnerErrorCode = "CODE_RUNNER_NOT_CONFIGURED" | "CODE_RUNNER_UNAVAILABLE" | "CODE_RUNNER_BUSY";

export class CodeRunnerError extends Error {
  constructor(readonly code: CodeRunnerErrorCode) {
    super(code);
    this.name = "CodeRunnerError";
  }
}

/** CRLF to LF, trailing whitespace off every line, trailing blank lines dropped. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

export function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  return text.length > max ? text.slice(0, max) : text;
}

interface PistonRun {
  stdout?: unknown;
  stderr?: unknown;
  code?: unknown;
  signal?: unknown;
}

type FetchFn = typeof fetch;

export interface PistonRunnerOptions {
  pistonUrl: string | null | undefined;
  fetchFn?: FetchFn;
  maxConcurrent?: number;
  now?: () => number;
  totalBudgetMs?: number;
}

/**
 * A RunCode backed by Piston. The concurrency cap is per runner instance (one per process in
 * practice): a full runner rejects with CODE_RUNNER_BUSY instead of queueing, so a burst cannot
 * pile up requests behind the gateway's read timeout.
 */
export function createPistonRunner(options: PistonRunnerOptions): RunCode {
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_EXECUTIONS;
  const now = options.now ?? Date.now;
  const totalBudgetMs = options.totalBudgetMs ?? TOTAL_BUDGET_MS;
  const baseUrl = options.pistonUrl ? options.pistonUrl.replace(/\/+$/, "") : null;
  let active = 0;

  async function execute(code: string, stdin: string): Promise<PistonRun> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/api/v2/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: PYTHON_LANGUAGE,
          version: PYTHON_VERSION,
          files: [{ name: "main.py", content: code }],
          stdin,
          run_timeout: RUN_TIMEOUT_MS,
          compile_timeout: COMPILE_TIMEOUT_MS,
          run_memory_limit: RUN_MEMORY_LIMIT_BYTES,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CodeRunnerError("CODE_RUNNER_UNAVAILABLE");
    }
    if (!response.ok) throw new CodeRunnerError("CODE_RUNNER_UNAVAILABLE");
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CodeRunnerError("CODE_RUNNER_UNAVAILABLE");
    }
    const run = (body as { run?: unknown } | null)?.run;
    // Piston sometimes answers 200 with only {message} for a rejected job.
    if (!run || typeof run !== "object") throw new CodeRunnerError("CODE_RUNNER_UNAVAILABLE");
    return run as PistonRun;
  }

  return async (code, tests) => {
    if (!baseUrl) throw new CodeRunnerError("CODE_RUNNER_NOT_CONFIGURED");
    if (active >= maxConcurrent) throw new CodeRunnerError("CODE_RUNNER_BUSY");
    active += 1;
    try {
      const started = now();
      const results: CodeTestResult[] = [];
      for (const test of tests) {
        const name = test.name ?? null;
        if (now() - started > totalBudgetMs) {
          results.push({ name, passed: false, ran: false, stdout: "", stderr: "", exitCode: null, signal: null, timedOut: false });
          continue;
        }
        const run = await execute(code, test.stdin);
        const stdout = typeof run.stdout === "string" ? run.stdout : "";
        const stderr = typeof run.stderr === "string" ? run.stderr : "";
        const exitCode = typeof run.code === "number" ? run.code : null;
        const signal = typeof run.signal === "string" ? run.signal : null;
        const timedOut = signal === "SIGKILL";
        const passed = !timedOut && exitCode === 0 && outputsMatch(stdout, test.expected_stdout);
        results.push({ name, passed, ran: true, stdout: truncate(stdout), stderr: truncate(stderr), exitCode, signal, timedOut });
      }
      return { results, passedCount: results.filter((r) => r.passed).length, totalCount: results.length };
    } finally {
      active -= 1;
    }
  };
}
