import assert from "node:assert/strict";
import test from "node:test";

import {
  CodeRunnerError,
  createPistonRunner,
  MAX_OUTPUT_CHARS,
  normalizeOutput,
  outputsMatch,
} from "../src/code-runner.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function runOk(stdout: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ language: "python", version: "3.10.0", run: { stdout, stderr: "", code: 0, signal: null, output: stdout, ...extra } });
}

const oneTest = [{ stdin: "", expected_stdout: "hi" }];

test("normalizeOutput: CRLF, trailing spaces and trailing blank lines", () => {
  assert.equal(normalizeOutput("a  \r\nb\t\r\n\r\n\n"), "a\nb");
  assert.ok(outputsMatch("hello \n\n", "hello"));
  assert.ok(!outputsMatch(" hello", "hello"), "leading whitespace still matters");
  assert.ok(!outputsMatch("Hello", "hello"));
});

test("runner sends the pinned language/version and limits, never client choices", async () => {
  let sent: { url: string; body: Record<string, unknown> } | null = null;
  const runner = createPistonRunner({
    pistonUrl: "http://piston.example.test/",
    fetchFn: async (input, init) => {
      sent = { url: String(input), body: JSON.parse(String(init?.body)) };
      return runOk("hi\n");
    },
  });
  const result = await runner("print('hi')", [{ name: "t1", stdin: "x", expected_stdout: "hi" }]);
  assert.equal(result.passedCount, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.results[0]?.name, "t1");
  assert.ok(sent);
  const s = sent as { url: string; body: Record<string, unknown> };
  assert.equal(s.url, "http://piston.example.test/api/v2/execute");
  assert.equal(s.body.language, "python");
  assert.equal(s.body.version, "3.10.0");
  assert.equal(s.body.stdin, "x");
  assert.equal(s.body.run_timeout, 3000);
  assert.equal(s.body.run_memory_limit, 128 * 1024 * 1024);
  assert.deepEqual(s.body.files, [{ name: "main.py", content: "print('hi')" }]);
});

test("SIGKILL is a timeout and a failure; non-zero exit fails; output is truncated", async () => {
  const replies = [
    runOk("hi", { signal: "SIGKILL", code: null }),
    runOk("hi", { code: 1, stderr: "Traceback" }),
    runOk("x".repeat(MAX_OUTPUT_CHARS + 50), { stderr: "e".repeat(MAX_OUTPUT_CHARS + 1) }),
  ];
  const runner = createPistonRunner({ pistonUrl: "http://p", fetchFn: async () => replies.shift() as Response });
  const result = await runner("code", [oneTest[0]!, oneTest[0]!, oneTest[0]!]);
  const [killed, crashed, long] = result.results;
  assert.equal(killed?.timedOut, true);
  assert.equal(killed?.passed, false);
  assert.equal(crashed?.passed, false);
  assert.equal(crashed?.exitCode, 1);
  assert.equal(crashed?.stderr, "Traceback");
  assert.equal(long?.stdout.length, MAX_OUTPUT_CHARS);
  assert.equal(long?.stderr.length, MAX_OUTPUT_CHARS);
  assert.equal(result.passedCount, 0);
});

test("not configured, unavailable, and Piston error bodies map to runner errors", async () => {
  const code = async (runner: ReturnType<typeof createPistonRunner>) => {
    try {
      await runner("c", oneTest);
      return "no error";
    } catch (error) {
      assert.ok(error instanceof CodeRunnerError);
      return error.code;
    }
  };
  assert.equal(await code(createPistonRunner({ pistonUrl: null, fetchFn: async () => runOk("hi") })), "CODE_RUNNER_NOT_CONFIGURED");
  assert.equal(
    await code(createPistonRunner({ pistonUrl: "http://p", fetchFn: async () => { throw new TypeError("fetch failed"); } })),
    "CODE_RUNNER_UNAVAILABLE",
  );
  assert.equal(
    await code(createPistonRunner({ pistonUrl: "http://p", fetchFn: async () => jsonResponse({ message: "bad" }, 400) })),
    "CODE_RUNNER_UNAVAILABLE",
  );
  assert.equal(
    await code(createPistonRunner({ pistonUrl: "http://p", fetchFn: async () => jsonResponse({ message: "runtime unknown" }) })),
    "CODE_RUNNER_UNAVAILABLE",
  );
});

test("busy cap rejects beyond the concurrent limit and frees slots afterwards", async () => {
  const releases: Array<() => void> = [];
  const runner = createPistonRunner({
    pistonUrl: "http://p",
    maxConcurrent: 2,
    fetchFn: () => new Promise<Response>((resolve) => releases.push(() => resolve(runOk("hi")))),
  });
  const first = runner("c", oneTest);
  const second = runner("c", oneTest);
  await assert.rejects(runner("c", oneTest), (error: unknown) => error instanceof CodeRunnerError && error.code === "CODE_RUNNER_BUSY");
  await new Promise((r) => setImmediate(r));
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  const third = runner("c", oneTest);
  await new Promise((r) => setImmediate(r));
  releases[2]?.();
  assert.equal((await third).passedCount, 1);
});

test("tests past the total time budget are marked not run", async () => {
  let clock = 0;
  const runner = createPistonRunner({
    pistonUrl: "http://p",
    totalBudgetMs: 10,
    now: () => clock,
    fetchFn: async () => {
      clock += 20;
      return runOk("hi");
    },
  });
  const result = await runner("c", [oneTest[0]!, oneTest[0]!]);
  assert.equal(result.results[0]?.ran, true);
  assert.equal(result.results[1]?.ran, false);
  assert.equal(result.passedCount, 1);
  assert.equal(result.totalCount, 2);
});

const pistonTestUrl = process.env.PISTON_TEST_URL;
test("real Piston: print(input()) echoes stdin", { skip: !pistonTestUrl }, async () => {
  const runner = createPistonRunner({ pistonUrl: pistonTestUrl });
  const result = await runner("print(input())", [
    { stdin: "hello\n", expected_stdout: "hello" },
    { stdin: "abc\n", expected_stdout: "wrong" },
  ]);
  assert.equal(result.results[0]?.passed, true, JSON.stringify(result.results[0]));
  assert.equal(result.results[1]?.passed, false);
  assert.equal(result.results[1]?.stdout.trim(), "abc");
});
