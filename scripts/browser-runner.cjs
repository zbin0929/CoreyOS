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

    if (task.url) {
      await stagehand.page.goto(task.url, { timeout: 30000, waitUntil: "domcontentloaded" });
    }

    let result;

    switch (task.action) {
      case "act":
        result = await stagehand.act(task.instruction);
        break;
      case "extract":
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
