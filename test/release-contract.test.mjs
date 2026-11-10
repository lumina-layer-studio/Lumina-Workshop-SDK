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
  assert.equal(packageValue.version, "1.1.0");
  assert.equal(packageValue.packageManager, "pnpm@10.33.2");
  assert.equal(packageValue.engines.node, ">=22");
  assert.deepEqual(packageValue.files, ["dist", "README.md", "LICENSE"]);
  assert.equal(packageValue.dependencies, undefined);
  assert.equal(packageValue.peerDependencies, undefined);
  for (const name of [
    "preinstall",
    "install",
    "postinstall",
  ]) {
    assert.equal(packageValue.scripts[name], undefined);
  }
  assert.equal(packageValue.scripts.prepare, "tsc -p tsconfig.json");
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
  // The Python backend SDK is tested, built once, and released beside it.
  assert.match(workflow, /python3 -m unittest discover -s python\/tests/);
  assert.match(workflow, /python3 python\/build_wheel\.py --output dist-package/);
  assert.match(workflow, /"\$\{wheel\}\.sha256"/);
  assert.doesNotMatch(workflow, /twine|pypi/i);
});

test("release inspects the same packed files as CI and the packed manifest", async () => {
  const members = async (path) =>
    [...(await readText(path)).matchAll(/^\s+(package\/\S+) \\$/gm)]
      .map((match) => match[1])
      .sort();
  const release = await members("../.github/workflows/release.yml");
  assert.ok(release.includes("package/dist/projectSnapshots.js"));
  assert.deepEqual(release, await members("../.github/workflows/ci.yml"));
  const workflow = await readText("../.github/workflows/release.yml");
  assert.match(workflow, /tar -xzOf "\$\{tarball\}" package\/package\.json \| node/);
});

test("python backend SDK version matches the package version", async () => {
  const pyproject = await readText("../python/pyproject.toml");
  const init = await readText("../python/src/lumina_workshop_backend/__init__.py");
  assert.match(pyproject, new RegExp(`version = "${packageValue.version}"`));
  assert.match(init, new RegExp(`__version__ = "${packageValue.version}"`));
  assert.match(pyproject, /dependencies = \[\]/);
});

test("documentation points only to the public immutable release", async () => {
  const readme = await readText("../README.md");
  const publicAsset =
    "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/" +
    "releases/download/v1.0.2/lumina-workshop-sdk-1.0.2.tgz";
  assert.match(readme, new RegExp(publicAsset.replaceAll(".", "\\.")));
  assert.doesNotMatch(readme, /v1\.0\.1|sdk-1\.0\.1/);
  assert.doesNotMatch(readme, /Lumina-studio\/releases/);
  assert.doesNotMatch(readme, /\/latest\//);
});

test("all immutable dependency examples use the 1.0.2 release identity", async () => {
  const documentation = [
    await readText("../README.md"),
    await readText("../docs/module-development.md"),
  ].join("\n");

  assert.match(documentation, /版本：`1\.0\.2`/);
  assert.match(documentation, /tag：`v1\.0\.2`/);
  assert.doesNotMatch(documentation, /v1\.0\.1|sdk-1\.0\.1/);
});

test("release identity guard accepts exactly the package version tag", async () => {
  const workflow = await readText("../.github/workflows/release.yml");
  const expectedTag = `v${packageValue.version}`;

  assert.equal(expectedTag, "v1.1.0");
  assert.match(workflow, /EXPECTED_TAG="v\$\{SDK_VERSION\}"/);
  assert.match(workflow, /GITHUB_REF_NAME.*EXPECTED_TAG/);
});

test("1.1.0 is documented as unreleased until its tagged Release exists", async () => {
  const readme = await readText("../README.md");
  assert.match(readme, /SDK 1\.1\.0: module backends \(unreleased\)/);
  assert.match(readme, /lumina-workshop-sdk-1\.1\.0\.tgz/);
  assert.match(readme, /lumina_workshop_backend-1\.1\.0-py3-none-any\.whl/);
  assert.match(readme, /not published yet/);
  // Install instructions keep pointing at the latest published release.
  assert.doesNotMatch(readme, /releases\/download\/v1\.1\.0\//);
});

test("1.1.0 documentation covers the backend contracts", async () => {
  const documentation = [
    await readText("../README.md"),
    await readText("../docs/module-development.md"),
    await readText("../docs/backend-protocol.md"),
    await readText("../python/README.md"),
  ].join("\n");
  for (const publicContract of [
    "backend.tasks",
    "manifestVersion\": 2",
    "pylock.toml",
    "LUMINA_WORKSHOP_CONTROL_FDS",
    "waitFor",
    "check_cancelled",
    "not an OS",
  ]) {
    assert.ok(documentation.includes(publicContract), publicContract);
  }
});

test("1.0.2 documentation covers its new public contracts", async () => {
  const documentation = [
    await readText("../README.md"),
    await readText("../docs/module-development.md"),
  ].join("\n");

  for (const publicContract of [
    "svgBytes",
    "recommendedTotalThicknessMm",
    "subscribeState",
    "ui.stateChanged",
  ]) {
    assert.match(documentation, new RegExp(publicContract.replace(".", "\\.")));
  }
});
