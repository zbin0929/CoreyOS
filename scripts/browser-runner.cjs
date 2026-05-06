// Stagehand bridge for the workflow engine's `browser` step.
//
// Spawned by the Rust executor as a subprocess; receives the task as
// a single JSON arg and writes a single JSON line to stdout:
//   { ok: true, data: <result> }    on success
//   { ok: false, error: "<msg>" }   on failure (also stderr-logged)
//
// Updated 2026-05-06 for Stagehand v3 API:
//   - v2 exposed `stagehand.page` directly; v3 moved it to
//     `stagehand.context.pages()[0]` (CDP engine refactor).
//   - v3 `extract(instruction)` without a schema returns the default
//     pageText shape; passing a string without schema in v2 returned
//     free-form text. We pin to the no-schema form so the runner
//     stays generic across action types.
const { Stagehand } = require("@browserbasehq/stagehand");
const path = require("path");
const os = require("os");
const fs = require("fs");

async function run() {
  const taskJson = process.argv[2];
  if (!taskJson) {
    console.error("Usage: browser-runner '<json task>'");
    process.exit(1);
  }

  const task = JSON.parse(taskJson);

  const apiKey =
    process.env.BROWSER_LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.ZHIPU_API_KEY ||
    "";

  const modelName = process.env.BROWSER_LLM_MODEL || "openai/gpt-4o-mini";
  const modelBase = process.env.BROWSER_LLM_BASE_URL;

  const launchOpts = {
    headless: true,
  };

  if (task.profile) {
    const profilesDir = path.join(os.homedir(), ".hermes", "browser-profiles");
    fs.mkdirSync(profilesDir, { recursive: true });
    launchOpts.userDataDir = path.join(profilesDir, task.profile);
    launchOpts.preserveUserDataDir = true;
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    model: {
      modelName,
      ...(apiKey && { modelApiKey: apiKey }),
      ...(modelBase && { clientOptions: { baseURL: modelBase } }),
    },
    localBrowserLaunchOptions: launchOpts,
  });

  try {
    await stagehand.init();

    // v3: `stagehand.page` is undefined; the CDP engine exposes pages
    // via the underlying playwright context. We grab the first page
    // (the one Stagehand opens on init) and reuse it for goto +
    // subsequent actions. If a future task wants multi-tab support,
    // hook a `task.tab_index` here.
    const page = stagehand.context.pages()[0];

    if (task.url) {
      await page.goto(task.url, { timeout: 30000, waitUntil: "domcontentloaded" });
    }

    let result;

    switch (task.action) {
      case "act":
        result = await stagehand.act(task.instruction);
        break;
      case "extract":
        // v3 with no schema falls back to `pageTextSchema` which
        // returns `{ pageText: string }`. Callers that need
        // structured data should use `agent` (LLM-driven multi-step)
        // or extend this runner with a `task.schema` JSON-Schema
        // input that we deserialise into Zod.
        result = await stagehand.extract(task.instruction);
        break;
      case "observe":
        result = await stagehand.observe(task.instruction);
        break;
      case "agent": {
        const agent = stagehand.agent();
        result = await agent.execute(task.instruction);
        break;
      }
      default:
        throw new Error("Unknown action: " + task.action);
    }

    console.log(JSON.stringify({ ok: true, data: result }));
  } catch (e) {
    console.log(
      JSON.stringify({ ok: false, error: e.message || String(e) })
    );
  } finally {
    await stagehand.close();
  }
}

run().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});
