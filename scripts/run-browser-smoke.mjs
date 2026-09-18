import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4174;
const pageUrl = `http://${host}:${port}/Dihor.GameKit.Dice/browser-smoke.html`;

function findBrowser() {
  const explicit = process.env.CHROME_BIN?.trim();
  if (explicit) {
    return explicit;
  }

  const fileCandidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser"
        ];

  for (const candidate of fileCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const commandCandidates = process.platform === "win32"
    ? ["chrome", "msedge", "chromium"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

  for (const candidate of commandCandidates) {
    const check = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32"
    });

    if (check.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "No Chrome/Chromium browser found. Set CHROME_BIN to a Chrome, Chromium or Edge executable."
  );
}

async function waitForServer(url) {
  let lastError;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error(`Vite browser-smoke server did not become ready: ${String(lastError)}`);
}

const browser = findBrowser();
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(
  process.execPath,
  [
    viteBin,
    "--config",
    "vite.demo.config.ts",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort"
  ],
  {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let serverLog = "";
server.stdout?.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr?.on("data", (chunk) => {
  serverLog += chunk.toString();
});

try {
  await waitForServer(pageUrl);

  const browserRun = spawnSync(
    browser,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--dump-dom",
      pageUrl
    ],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32",
      timeout: 120000
    }
  );

  const dom = browserRun.stdout ?? "";
  const stderr = browserRun.stderr ?? "";

  if (browserRun.error) {
    throw browserRun.error;
  }

  if (browserRun.status !== 0) {
    throw new Error(
      `Browser process exited with code ${browserRun.status}.\n${stderr}\n${dom}`
    );
  }

  if (!dom.includes('data-browser-smoke-status="passed"')) {
    throw new Error(
      [
        "Browser smoke tests did not report success.",
        stderr ? `Browser stderr:\n${stderr}` : "",
        `DOM snapshot:\n${dom}`
      ].filter(Boolean).join("\n\n")
    );
  }

  const resultMatch = /<pre id="browser-smoke-result">([\s\S]*?)<\/pre>/.exec(dom);
  console.log("Real-browser smoke tests passed.");
  if (resultMatch?.[1]) {
    console.log(resultMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (serverLog.trim()) {
    console.error("\nVite output:\n" + serverLog);
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
