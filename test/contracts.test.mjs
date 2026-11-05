import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSHOP_API_VERSION,
  WORKSHOP_BACKEND_API_VERSION,
  WORKSHOP_MANIFEST_VERSION,
  WORKSHOP_PERMISSION_NAMES,
  WorkshopClientError,
  applyWorkshopUiState,
  connectWorkshop,
  createRequestEnvelope,
} from "../dist/index.js";

test("exports stable v1 identities and permission names", () => {
  assert.equal(WORKSHOP_API_VERSION, "1.0.0");
  assert.equal(WORKSHOP_MANIFEST_VERSION, 1);
  assert.deepEqual(WORKSHOP_PERMISSION_NAMES, [
    "image.pick",
    "project.storage",
    "color-library.read",
    "handoff.image",
  ]);
});

test("creates a bounded protocol request envelope", () => {
  assert.deepEqual(createRequestEnvelope("req-1", "ui.getState", {}), {
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "request",
    requestId: "req-1",
    method: "ui.getState",
    payload: {},
  });
});

function createConnectedWindow(channel, posted) {
  const parent = {
    postMessage(message) {
      posted.push(message);
    },
  };
  return {
    parent,
    addEventListener(_name, listener) {
      queueMicrotask(() =>
        listener({
          source: parent,
          data: {
            type: "lumina.workshop.connect",
            sessionId: "session-1",
          },
          ports: [channel.port2],
        }),
      );
    },
    removeEventListener() {},
  };
}

test("connects only after the host transfers one MessagePort", async () => {
  const channel = new MessageChannel();
  const posted = [];
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, posted),
  });

  assert.deepEqual(posted[0], {
    type: "lumina.workshop.ready",
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    apiVersion: "1.0.0",
    events: ["ui.stateChanged"],
  });
  assert.equal(client.sessionId, "session-1");
  client.close();
  channel.port1.close();
});

test("subscribes to host UI state events without interrupting RPC", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const received = [];
  const unsubscribe = client.ui.subscribeState((state) => {
    received.push(`${state.locale}:${state.theme}`);
  });

  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "event",
    event: "ui.stateChanged",
    payload: {
      locale: "en-US",
      theme: "light",
      tokens: { "--lumina-surface": "#fff" },
    },
  });

  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: {
        locale: "zh-CN",
        theme: "dark",
        tokens: {},
      },
    });
  };
  assert.equal((await client.ui.getState()).theme, "light");
  assert.deepEqual(received, ["en-US:light"]);

  unsubscribe();
  unsubscribe();
  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "event",
    event: "ui.stateChanged",
    payload: { locale: "zh-CN", theme: "dark", tokens: {} },
  });
  await client.projects.latest();
  assert.equal((await client.ui.getState()).theme, "dark");
  assert.deepEqual(received, ["en-US:light"]);

  client.close();
  channel.port1.close();
});

test("isolates a failing UI state listener from other listeners", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const received = [];
  client.ui.subscribeState(() => {
    throw new Error("module listener failed");
  });
  client.ui.subscribeState((state) => received.push(state.theme));

  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "event",
    event: "ui.stateChanged",
    payload: { locale: "en-US", theme: "light", tokens: {} },
  });
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: null,
    });
  };
  await client.projects.latest();
  assert.deepEqual(received, ["light"]);

  assert.equal(await client.projects.latest(), null);

  client.close();
  channel.port1.close();
});

test("replays a UI event received before state subscription", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "event",
    event: "ui.stateChanged",
    payload: { locale: "en-US", theme: "light", tokens: {} },
  });
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: null,
    });
  };
  await client.projects.latest();

  const received = [];
  client.ui.subscribeState((state) => received.push(state));
  assert.deepEqual(received, [
    { locale: "en-US", theme: "light", tokens: {} },
  ]);

  client.close();
  channel.port1.close();
});

test("does not let a late getState snapshot overwrite a newer event", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const received = [];
  client.ui.subscribeState((state) => received.push(state));
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "event",
      event: "ui.stateChanged",
      payload: { locale: "en-US", theme: "light", tokens: {} },
    });
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: { locale: "zh-CN", theme: "dark", tokens: {} },
    });
  };

  const state = await client.ui.getState();
  assert.deepEqual(state, {
    locale: "en-US",
    theme: "light",
    tokens: {},
  });
  assert.deepEqual(received, [state]);

  client.close();
  channel.port1.close();
});

test("applies a UI event that arrives after the getState response", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  let resolveEvent;
  const eventReceived = new Promise((resolve) => {
    resolveEvent = resolve;
  });
  const received = [];
  client.ui.subscribeState((state) => {
    received.push(state);
    resolveEvent();
  });
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: { locale: "zh-CN", theme: "dark", tokens: {} },
    });
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "event",
      event: "ui.stateChanged",
      payload: { locale: "en-US", theme: "light", tokens: {} },
    });
  };

  assert.deepEqual(await client.ui.getState(), {
    locale: "zh-CN",
    theme: "dark",
    tokens: {},
  });
  await eventReceived;
  assert.deepEqual(received, [
    { locale: "en-US", theme: "light", tokens: {} },
  ]);

  client.close();
  channel.port1.close();
});

test("ignores invalid or old-version UI events without caching them", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  for (const event of [
    {
      protocol: "lumina-workshop-rpc",
      version: 0,
      kind: "event",
      event: "ui.stateChanged",
      payload: { locale: "en-US", theme: "light", tokens: {} },
    },
    {
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "event",
      event: "ui.stateChanged",
      payload: { locale: "xx", theme: "neon", tokens: {} },
    },
  ]) {
    channel.port1.postMessage(event);
  }
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: null,
    });
  };
  assert.equal(await client.projects.latest(), null);

  const received = [];
  client.ui.subscribeState((state) => received.push(state));
  assert.deepEqual(received, []);

  client.close();
  channel.port1.close();
});

test("transfers the optional native SVG handoff buffer", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const pngBytes = new ArrayBuffer(24);
  const svgBytes = new ArrayBuffer(48);
  const received = new Promise((resolve) => {
    channel.port1.onmessage = ({ data }) => {
      channel.port1.postMessage({
        protocol: "lumina-workshop-rpc",
        version: 1,
        kind: "response",
        requestId: data.requestId,
        ok: true,
        result: { status: "completed" },
      });
      resolve(data.payload);
    };
  });

  const pending = client.handoff.image({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    projectId: "project-svg",
    pngBytes,
    svgBytes,
    pixelWidth: 1,
    pixelHeight: 1,
    recommendedWidthMm: 2.6,
    recommendedHeightMm: 2.6,
    recommendedTotalThicknessMm: 1.85,
    preserveCanvasBounds: true,
    colorLibraryId: null,
    recipeSource: {
      manifestSchemaVersion: 1,
      moduleId: "fixture.hello",
      moduleVersion: "1.0.0",
      projectSchemaVersion: "fixture/v1",
      renderSchemaVersion: "fixture-render/v1",
      payload: {},
    },
  });
  const payload = await received;
  await pending;

  assert.equal(payload.pngBytes.byteLength, 24);
  assert.equal(payload.svgBytes.byteLength, 48);
  assert.equal(payload.recommendedTotalThicknessMm, 1.85);
  assert.equal(pngBytes.byteLength, 0);
  assert.equal(svgBytes.byteLength, 0);
  client.close();
  channel.port1.close();
});

test("maps valid responses and rejects pending requests when closed", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });

  const requestReceived = new Promise((resolve) => {
    channel.port1.onmessage = ({ data }) => {
      channel.port1.postMessage({
        protocol: "lumina-workshop-rpc",
        version: 1,
        kind: "response",
        requestId: data.requestId,
        ok: true,
        result: {
          locale: "zh-CN",
          theme: "dark",
          tokens: {},
        },
      });
      resolve();
    };
  });
  const state = await client.ui.getState();
  await requestReceived;
  assert.equal(state.theme, "dark");

  channel.port1.onmessage = null;
  const pending = client.projects.latest();
  client.close();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof WorkshopClientError && error.code === "CLIENT_CLOSED",
  );
  channel.port1.close();
});

test("continues requesting UI snapshots from a host that sends no events", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  let requestCount = 0;
  channel.port1.onmessage = ({ data }) => {
    requestCount += 1;
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: {
        locale: requestCount === 1 ? "zh-CN" : "en-US",
        theme: requestCount === 1 ? "dark" : "light",
        tokens: {},
      },
    });
  };

  assert.equal((await client.ui.getState()).theme, "dark");
  assert.equal((await client.ui.getState()).theme, "light");
  assert.equal(requestCount, 2);

  client.close();
  channel.port1.close();
});

test("rejects getState after close even when an event was cached", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "event",
    event: "ui.stateChanged",
    payload: { locale: "en-US", theme: "light", tokens: {} },
  });
  channel.port1.onmessage = ({ data }) => {
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: null,
    });
  };
  await client.projects.latest();
  client.close();

  await assert.rejects(
    client.ui.getState(),
    (error) =>
      error instanceof WorkshopClientError && error.code === "CLIENT_CLOSED",
  );
  channel.port1.close();
});

test("allows five minutes for a native image picker request", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let observedDelay = null;
  globalThis.setTimeout = (_callback, delay) => {
    observedDelay = delay;
    return { fake: true };
  };
  globalThis.clearTimeout = () => {};

  try {
    const pending = client.image.pick();
    const closed = assert.rejects(
      pending,
      (error) =>
        error instanceof WorkshopClientError &&
        error.code === "CLIENT_CLOSED",
    );
    assert.equal(observedDelay, 300_000);
    client.close();
    await closed;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    client.close();
    channel.port1.close();
  }
});

test("ignores one late response for a locally timed-out request", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  const originalSetTimeout = globalThis.setTimeout;
  let observedDelay = null;
  let resolveImageRequest;
  const imageRequest = new Promise((resolve) => {
    resolveImageRequest = resolve;
  });
  channel.port1.onmessage = ({ data }) => resolveImageRequest(data);
  globalThis.setTimeout = (callback, delay, ...args) => {
    observedDelay = delay;
    return originalSetTimeout(callback, 0, ...args);
  };

  try {
    const pending = client.image.pick();
    const timedOut = assert.rejects(
      pending,
      (error) =>
        error instanceof WorkshopClientError &&
        error.code === "REQUEST_TIMEOUT",
    );
    const request = await imageRequest;
    await timedOut;
    assert.equal(observedDelay, 300_000);
    globalThis.setTimeout = originalSetTimeout;

    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: request.requestId,
      ok: true,
      result: null,
    });
    await new Promise((resolve) => originalSetTimeout(resolve, 0));

    channel.port1.onmessage = ({ data }) => {
      channel.port1.postMessage({
        protocol: "lumina-workshop-rpc",
        version: 1,
        kind: "response",
        requestId: data.requestId,
        ok: true,
        result: {
          locale: "zh-CN",
          theme: "dark",
          tokens: {},
        },
      });
    };
    const state = await client.ui.getState();
    assert.equal(state.theme, "dark");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    client.close();
    channel.port1.close();
  }
});

test("times out a handshake that is not transferred by the parent", async () => {
  let removed = false;
  const parent = { postMessage() {} };
  await assert.rejects(
    connectWorkshop({
      moduleId: "fixture.hello",
      moduleVersion: "1.0.0",
      handshakeTimeoutMs: 10,
      windowObject: {
        parent,
        addEventListener() {},
        removeEventListener() {
          removed = true;
        },
      },
    }),
    (error) =>
      error instanceof WorkshopClientError &&
      error.code === "HANDSHAKE_TIMEOUT",
  );
  assert.equal(removed, true);
});

test("fails closed when the host sends a duplicate response", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });

  let firstRequestId = "";
  channel.port1.onmessage = ({ data }) => {
    firstRequestId ||= data.requestId;
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: null,
    });
  };
  await client.projects.latest();

  channel.port1.onmessage = null;
  const pending = client.projects.latest();
  channel.port1.postMessage({
    protocol: "lumina-workshop-rpc",
    version: 1,
    kind: "response",
    requestId: firstRequestId,
    ok: true,
    result: null,
  });
  await assert.rejects(
    pending,
    (error) =>
      error instanceof WorkshopClientError &&
      error.code === "DUPLICATE_RESPONSE",
  );
  channel.port1.close();
});

test("requests backend tasks with API 1.1.0 and keeps 1.0.0 otherwise", async () => {
  const channel = new MessageChannel();
  const posted = [];
  const client = await connectWorkshop({
    moduleId: "fixture.backend",
    moduleVersion: "1.0.0",
    features: ["backend.tasks", "not-a-feature"],
    windowObject: createConnectedWindow(channel, posted),
  });
  assert.deepEqual(posted[0], {
    type: "lumina.workshop.ready",
    moduleId: "fixture.backend",
    moduleVersion: "1.0.0",
    apiVersion: "1.1.0",
    events: ["ui.stateChanged"],
    features: ["backend.tasks"],
  });
  assert.equal(WORKSHOP_BACKEND_API_VERSION, "1.1.0");
  assert.ok(client.features.has("backend.tasks"));
  client.close();
  channel.port1.close();
});

test("backend methods require the requested feature", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.hello",
    moduleVersion: "1.0.0",
    windowObject: createConnectedWindow(channel, []),
  });
  await assert.rejects(
    client.backend.list(),
    (error) =>
      error instanceof WorkshopClientError &&
      error.code === "FEATURE_NOT_REQUESTED",
  );
  client.close();
  channel.port1.close();
});

test("submits backend inputs by transfer and waits for a terminal task", async () => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.backend",
    moduleVersion: "1.0.0",
    features: ["backend.tasks"],
    windowObject: createConnectedWindow(channel, []),
  });
  const received = [];
  let polls = 0;
  channel.port1.onmessage = ({ data }) => {
    received.push(data);
    let result;
    if (data.method === "backend.submit") {
      result = { taskId: "a".repeat(32), status: "queued" };
    } else if (data.method === "backend.get") {
      polls += 1;
      result = {
        taskId: data.payload.taskId,
        status: polls < 2 ? "running" : "succeeded",
        progress: { completed: polls, total: 2, phase: "work" },
      };
    }
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result,
    });
  };
  const bytes = new ArrayBuffer(16);
  const task = await client.backend.submit({
    operation: "alpha-invert",
    params: {},
    inputs: [{ name: "image", fileName: "in.png", mimeType: "image/png", bytes }],
    idempotencyKey: "upload-1",
  });
  assert.equal(bytes.byteLength, 0);
  assert.equal(received[0].payload.inputs[0].bytes.byteLength, 16);
  const progress = [];
  const finished = await client.backend.waitFor(task.taskId, {
    intervalMs: 1,
    onProgress: (value) => progress.push(value.status),
  });
  assert.equal(finished.status, "succeeded");
  assert.deepEqual(progress, ["running", "succeeded"]);
  client.close();
  channel.port1.close();
});

test("transfers a buffer shared by several backend inputs once", async (t) => {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.backend",
    moduleVersion: "1.0.0",
    features: ["backend.tasks"],
    windowObject: createConnectedWindow(channel, []),
  });
  // An open port keeps the test process alive; close it even on failure.
  t.after(() => {
    client.close();
    channel.port1.close();
  });
  let received;
  channel.port1.onmessage = ({ data }) => {
    received = data;
    channel.port1.postMessage({
      protocol: "lumina-workshop-rpc",
      version: 1,
      kind: "response",
      requestId: data.requestId,
      ok: true,
      result: { taskId: "a".repeat(32), status: "queued" },
    });
  };
  const bytes = new ArrayBuffer(16);
  const task = await client.backend.submit({
    operation: "compare",
    params: {},
    inputs: [
      { name: "left", fileName: "image.png", mimeType: "image/png", bytes },
      { name: "right", fileName: "image.png", mimeType: "image/png", bytes },
    ],
  });
  assert.equal(task.status, "queued");
  assert.equal(bytes.byteLength, 0);
  const [left, right] = received.payload.inputs;
  assert.equal(left.bytes.byteLength, 16);
  assert.equal(left.bytes, right.bytes);
});

// A host whose backend.get answers after `delayMs` with "running" until
// poll `finishOnPoll`; `answered` lists when each answer was sent.
async function connectPollingHost(t) {
  const channel = new MessageChannel();
  const client = await connectWorkshop({
    moduleId: "fixture.backend",
    moduleVersion: "1.0.0",
    features: ["backend.tasks"],
    windowObject: createConnectedWindow(channel, []),
  });
  const host = { polls: 0, finishOnPoll: Infinity, delayMs: 0, answered: [] };
  const timers = new Set();
  // An open port or timer keeps the test process alive; clear them even on failure.
  t.after(() => {
    timers.forEach(clearTimeout);
    client.close();
    channel.port1.close();
  });
  channel.port1.onmessage = ({ data }) => {
    host.polls += 1;
    const status = host.polls >= host.finishOnPoll ? "succeeded" : "running";
    const timer = setTimeout(() => {
      timers.delete(timer);
      channel.port1.postMessage({
        protocol: "lumina-workshop-rpc",
        version: 1,
        kind: "response",
        requestId: data.requestId,
        ok: true,
        result: { taskId: data.payload.taskId, status },
      });
      host.answered.push(Date.now());
    }, host.delayMs);
    timers.add(timer);
  };
  return { client, host };
}

const isWaitTimeout = (error) =>
  error instanceof WorkshopClientError && error.code === "WAIT_TIMEOUT" && error.retryable;

test("waitFor ends at its time limit even when the interval is longer", async (t) => {
  const { client, host } = await connectPollingHost(t);
  let started = Date.now();
  await assert.rejects(
    client.backend.waitFor("a".repeat(32), { timeoutMs: 100, intervalMs: 2_000 }),
    isWaitTimeout,
  );
  assert.ok(Date.now() - started < 1_000, `waited ${Date.now() - started} ms`);

  // A task that ends within the limit is returned.
  host.polls = 0;
  host.finishOnPoll = 3;
  started = Date.now();
  const finished = await client.backend.waitFor("a".repeat(32), {
    timeoutMs: 1_000,
    intervalMs: 20,
  });
  assert.equal(finished.status, "succeeded");
  assert.ok(Date.now() - started < 1_000, `waited ${Date.now() - started} ms`);
});

test("waitFor does not outlast its time limit for a slow status request", async (t) => {
  const { client, host } = await connectPollingHost(t);
  host.delayMs = 1_000;
  host.finishOnPoll = 1;
  const started = Date.now();
  await assert.rejects(
    client.backend.waitFor("a".repeat(32), { timeoutMs: 100, intervalMs: 20 }),
    isWaitTimeout,
  );
  assert.ok(Date.now() - started < 700, `waited ${Date.now() - started} ms`);

  // The late answer is discarded and the connection keeps working.
  while (host.answered.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  host.delayMs = 0;
  const task = await client.backend.get("a".repeat(32));
  assert.equal(task.status, "succeeded");
});

test("applies only public Lumina theme tokens", () => {
  const values = new Map();
  const root = {
    lang: "",
    dataset: {},
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
    },
  };

  applyWorkshopUiState(
    {
      locale: "en-US",
      theme: "light",
      tokens: {
        "--lumina-surface": "#fff",
        "--private-secret": "blocked",
        color: "red",
      },
    },
    root,
  );

  assert.equal(root.lang, "en-US");
  assert.equal(root.dataset.theme, "light");
  assert.deepEqual([...values], [["--lumina-surface", "#fff"]]);
});
