import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4174;
const debugPort = 9223;
const pageUrl = `http://${host}:${port}/Dihor.GameKit.Dice/browser-smoke.html`;
const debugBaseUrl = `http://${host}:${debugPort}`;

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

async function waitForHttp(url, attempts = 80, delayMs = 125) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Endpoint did not become ready: ${url}. ${String(lastError)}`);
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${debugBaseUrl}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (item) => item.type === "page" && item.url.startsWith(pageUrl)
        );
        if (target?.webSocketDebuggerUrl) {
          return target.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Chrome may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error("Chrome DevTools Protocol page target did not become available.");
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open.")), {
        once: true
      });
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP command failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    });

    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP WebSocket closed before the command completed."));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Browser evaluation failed."
      );
    }

    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForSmokeResult(client) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 90_000) {
    const status = await client.evaluate(
      "document.body?.dataset.browserSmokeStatus ?? 'loading'"
    );

    if (status === "passed" || status === "failed") {
      const details = await client.evaluate(
        "document.querySelector('#browser-smoke-result')?.textContent ?? ''"
      );
      return { status, details };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const details = await client.evaluate(
    "document.querySelector('#browser-smoke-result')?.textContent ?? ''"
  );
  throw new Error(`Browser smoke tests timed out after 90000 ms. Last output:\n${details}`);
}

const browser = findBrowser();
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const userDataDir = mkdtempSync(join(tmpdir(), "dihor-dice-browser-smoke-"));
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

let browserLog = "";
let browserProcess;
let client;

try {
  await waitForHttp(pageUrl);

  browserProcess = spawn(
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
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      pageUrl
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    }
  );

  browserProcess.stdout?.on("data", (chunk) => {
    browserLog += chunk.toString();
  });
  browserProcess.stderr?.on("data", (chunk) => {
    browserLog += chunk.toString();
  });

  await waitForHttp(`${debugBaseUrl}/json/version`, 120, 125);
  const webSocketUrl = await findPageTarget();
  client = new CdpClient(webSocketUrl);
  await client.send("Runtime.enable");

  const result = await waitForSmokeResult(client);

  if (result.status !== "passed") {
    const dom = await client.evaluate("document.documentElement.outerHTML");
    throw new Error(
      [
        "Browser smoke tests reported failure.",
        result.details ? `Smoke output:\n${result.details}` : "",
        browserLog.trim() ? `Browser output:\n${browserLog}` : "",
        dom ? `DOM snapshot:\n${dom}` : ""
      ].filter(Boolean).join("\n\n")
    );
  }

  console.log("Real-browser smoke tests passed.");
  if (result.details) {
    console.log(result.details);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (browserLog.trim()) {
    console.error("\nBrowser output:\n" + browserLog);
  }
  if (serverLog.trim()) {
    console.error("\nVite output:\n" + serverLog);
  }
  process.exitCode = 1;
} finally {
  client?.close();

  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      browserProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  server.kill("SIGTERM");

  try {
    rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  } catch (error) {
    console.warn(
      "Browser smoke tests passed, but the temporary Chrome profile could not be removed:",
      error instanceof Error ? error.message : error
    );
  }
}
