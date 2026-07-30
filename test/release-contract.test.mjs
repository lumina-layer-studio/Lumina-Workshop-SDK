import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageValue = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const readText = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("publishes an exact dependency-free public package identity", () => {
  assert.equal(packageValue.name, "@lumina/workshop-sdk");
  assert.equal(packageValue.version, "1.0.1");
  assert.equal(packageValue.packageManager, "pnpm@10.33.2");
  assert.equal(packageValue.engines.node, ">=22");
  assert.deepEqual(packageValue.files, ["dist", "README.md", "LICENSE"]);
  assert.equal(packageValue.dependencies, undefined);
  assert.equal(packageValue.peerDependencies, undefined);
  for (const name of [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
  ]) {
    assert.equal(packageValue.scripts[name], undefined);
  }
});

test("release workflow is tag-only, pinned, and immutable", async () => {
  const workflow = await readText("../.github/workflows/release.yml");
  for (const action of [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  ]) {
    assert.match(workflow, new RegExp(action));
  }
  assert.match(workflow, /tags:\s*\n\s+- "v\*"/);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /branches:/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run pack:release/);
  assert.match(workflow, /git diff --exit-code/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /npm publish/);
  assert.doesNotMatch(workflow, /--latest/);
  assert.doesNotMatch(workflow.toLowerCase(), /\/latest\//);
});

test("documentation points only to the public immutable release", async () => {
  const readme = await readText("../README.md");
  const publicAsset =
    "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/" +
    "releases/download/v1.0.1/lumina-workshop-sdk-1.0.1.tgz";
  assert.match(readme, new RegExp(publicAsset.replaceAll(".", "\\.")));
  assert.doesNotMatch(readme, /Lumina-studio\/releases/);
  assert.doesNotMatch(readme, /\/latest\//);
});
