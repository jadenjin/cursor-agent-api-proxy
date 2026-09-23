import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, stopServer } from "../dist/server/index.js";

test("lists live CLI models and rejects unknown models before spawning a chat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-proxy-test-"));
  const cli = join(dir, "fake-agent.mjs");
  writeFileSync(cli, `
if (process.argv.includes("--list-models")) {
  console.log("auto - Auto\\ngrok-4.7-medium-fast - Grok 4.7 Medium Fast");
} else {
  process.stdout.write(JSON.stringify({type:"system",subtype:"init",model:"Grok 4.7 Medium Fast"}) + "\\n");
  process.stdout.write(JSON.stringify({type:"result",result:"OK"}) + "\\n");
}
`);
  if (process.platform === "win32") {
    writeFileSync(join(dir, "agent.cmd"), `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
  } else {
    const { chmodSync } = await import("node:fs");
    writeFileSync(join(dir, "agent"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
    chmodSync(join(dir, "agent"), 0o755);
  }

  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${process.platform === "win32" ? ";" : ":"}${oldPath}`;
  let server;
  try {
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const modelsResponse = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(modelsResponse.status, 200);
    const models = await modelsResponse.json();
    assert.deepEqual(models.data.map((item) => item.id), ["auto", "grok-4.7-medium-fast"]);

    const chat = async (model) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Hi" }] }),
    });
    const good = await chat("openai/grok-4.7-medium-fast");
    assert.equal(good.status, 200);
    assert.equal((await good.json()).choices[0].message.content, "OK");

    const unknown = await chat("definitely-not-a-real-model");
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error.code, "model_not_found");

    const unsafe = await chat("grok-4.7-medium-fast&echo");
    assert.equal(unsafe.status, 400);
    assert.equal((await unsafe.json()).error.code, "invalid_model");
  } finally {
    if (server) await stopServer();
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
