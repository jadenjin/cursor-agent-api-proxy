import { spawn } from "child_process";

const IS_WIN = process.platform === "win32";
const CACHE_MS = 30_000;
const MAX_OUTPUT = 1024 * 1024;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/;

let cache: { models: string[]; expires: number } | undefined;
let pending: Promise<string[]> | undefined;

/** Parse the IDs printed by `agent --list-models`, ignoring display names. */
export function parseModelList(output: string): string[] {
  const ids = new Set<string>();
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    const match = line.match(/^([a-z0-9][a-z0-9._-]*)(?:\s+(?:-|–|—)\s+.+|\s{2,}.+)?$/);
    if (match && MODEL_ID.test(match[1])) ids.add(match[1]);
  }
  return [...ids];
}

function queryModels(apiKey?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (["not-needed", "no-key", "null"].includes(env.CURSOR_API_KEY ?? "")) {
      delete env.CURSOR_API_KEY;
    }
    if (apiKey) env.CURSOR_API_KEY = apiKey;
    const child = spawn("agent", ["--list-models"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WIN,
      windowsHide: true,
      env,
    });
    const terminate = () => {
      if (IS_WIN && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill();
      }
    };
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, models?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(models!);
    };
    const timer = setTimeout(() => {
      terminate();
      finish(new Error("Cursor CLI model listing timed out"));
    }, 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT) {
        terminate();
        finish(new Error("Cursor CLI model listing is too large"));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(`Cursor CLI model listing failed (exit ${code}): ${stderr.trim().slice(0, 300)}`));
        return;
      }
      const models = parseModelList(stdout);
      if (models.length === 0) {
        finish(new Error("Cursor CLI returned no recognizable model IDs"));
        return;
      }
      finish(undefined, models);
    });
  });
}

export function getAvailableModels(apiKey?: string): Promise<string[]> {
  // Per-request credentials can expose a different catalog; never reuse the login cache.
  if (apiKey) return queryModels(apiKey);
  if (cache && cache.expires > Date.now()) return Promise.resolve(cache.models);
  if (pending) return pending;
  pending = queryModels()
    .then((models) => {
      cache = { models, expires: Date.now() + CACHE_MS };
      return models;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
