import assert from "node:assert/strict";
import test from "node:test";
import { parseModelList } from "../dist/subprocess/models.js";
import { extractModel } from "../dist/adapter/openai-to-cli.js";

test("parses current CLI IDs and ignores display names and headings", () => {
  const output = [
    "Available models:",
    "  auto - Auto",
    "  \x1b[32mgrok-4.7-medium-fast\x1b[0m - Grok 4.7 Medium Fast",
    "  - composer-2 - Composer 2",
    "  grok-4.7-medium-fast - duplicate",
  ].join("\r\n");
  assert.deepEqual(parseModelList(output), ["auto", "grok-4.7-medium-fast", "composer-2"]);
});

test("preserves new model IDs instead of silently falling back to auto", () => {
  assert.equal(extractModel("grok-4.7-medium-fast"), "grok-4.7-medium-fast");
  assert.equal(extractModel("openai/grok-4.7-medium-fast"), "grok-4.7-medium-fast");
  assert.equal(extractModel("cursor/grok-4.7-medium-fast"), "grok-4.7-medium-fast");
  assert.equal(extractModel("does-not-exist"), "does-not-exist");
});
