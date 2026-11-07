import assert from "node:assert/strict";
import test from "node:test";
import { createProjectSnapshotEndpoint } from "../dist/projectSnapshots.js";

function harness() {
  const responses = [];
  const endpoint = createProjectSnapshotEndpoint((value) => responses.push(value));
  let id = 0;
  return { endpoint, responses, async request(operation, payload) {
    const requestId = `request-${++id}`;
    endpoint.receive({ protocol: "lumina-workshop-project", version: 1, kind: "request", requestId, operation, payload });
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = responses.find((value) => value.requestId === requestId);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Missing snapshot response");
  } };
}

test("captures live unsaved state and prepares without committing", async () => {
  const { endpoint, request, responses } = harness();
  let editor = { cells: [1, 2], selected: 1 };
  endpoint.api.register({ capture: () => ({ schemaVersion: "beads/1", state: structuredClone(editor) }), prepare: (snapshot) => structuredClone(snapshot.state), commit: async (prepared) => { editor = prepared; } });
  editor.cells.push(3);
  endpoint.api.changed();
  assert.equal(responses[0].kind, "changed");
  assert.deepEqual((await request("capture")).result.state.cells, [1, 2, 3]);
  const prepared = await request("prepare", { schemaVersion: "beads/1", state: { cells: [9], selected: 0 } });
  assert.deepEqual(editor.cells, [1, 2, 3]);
  assert.equal((await request("commit", prepared.result)).ok, true);
  assert.deepEqual(editor.cells, [9]);
  assert.equal((await request("commit", prepared.result)).ok, false);
});

test("discard and handler replacement invalidate prepared state", async () => {
  const { endpoint, request } = harness();
  let commits = 0;
  const handler = { capture: () => ({ schemaVersion: "1", state: {} }), prepare: () => ({}), commit: () => { commits++; } };
  const unregister = endpoint.api.register(handler);
  const prepared = await request("prepare", { schemaVersion: "1", state: {} });
  await request("discard", prepared.result);
  assert.equal((await request("commit", prepared.result)).ok, false);
  const next = await request("prepare", { schemaVersion: "1", state: {} });
  unregister();
  endpoint.api.register(handler);
  assert.equal((await request("commit", next.result)).ok, false);
  assert.equal(commits, 0);
});

test("errors are returned without mutating the editor or swallowing normal RPC", async () => {
  const { endpoint, request } = harness();
  assert.equal(endpoint.receive({ type: "response" }), false);
  assert.equal((await request("capture")).ok, false);
  endpoint.api.register({ capture() { throw new Error("Image recognition is still running"); }, prepare() { throw new Error("Unsupported schema"); }, commit() { assert.fail(); } });
  assert.match((await request("capture")).error, /still running/);
  assert.match((await request("prepare", { schemaVersion: "99", state: {} })).error, /Unsupported schema/);
});
