import assert from 'node:assert/strict';
import test from 'node:test';
import { connectWorkshop } from '../dist/index.js';

async function importHost(t) {
  const channel = new MessageChannel();
  const messages = [];
  let importedRequest;
  const received = new Promise(resolve => { importedRequest = resolve; });
  channel.port1.onmessage = ({ data }) => {
    messages.push(data);
    if (data.method === 'material.import') importedRequest(data);
    else if (data.kind === 'request') respond(data.requestId, null);
  };
  const parent = { postMessage() {} };
  const client = await connectWorkshop({
    moduleId: 'fixture.import', moduleVersion: '1.0.0',
    features: ['materials.import'],
    windowObject: {
      parent,
      addEventListener(_type, listener) {
        queueMicrotask(() => listener({ source: parent,
          data: { type: 'lumina.workshop.connect', sessionId: 'import-test' },
          ports: [channel.port2] }));
      },
      removeEventListener() {},
    },
  });
  t.after(() => { client.close(); channel.port1.close(); });
  const control = (requestId, action) => channel.port1.postMessage({
    protocol: 'lumina-workshop-rpc', version: 1, kind: 'control', requestId, action,
  });
  function respond(requestId, result) {
    channel.port1.postMessage({ protocol: 'lumina-workshop-rpc', version: 1,
      kind: 'response', requestId, ok: true, result });
  }
  // Two request/response turns flush both directions of this real MessagePort.
  async function barrier() { await client.lifecycle.ready(); await client.lifecycle.ready(); }
  const portClosed = new Promise(resolve => channel.port1.addEventListener('close', resolve, { once: true }));
  const clientPortClosed = new Promise(resolve => channel.port2.addEventListener('close', resolve, { once: true }));
  return { client, messages, received, control, respond, barrier, portClosed,
    clientPortClosed, closeHost: () => channel.port1.close() };
}

function startImport(client) {
  return client.materials.import({ archiveBytes: new ArrayBuffer(1), fileName: 'sample.zip' });
}

test('expired confirmation cancels the host and cannot commit a late confirmation', async t => {
  const host = await importHost(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = startImport(host.client);
  const rejected = assert.rejects(pending, error => error.code === 'REQUEST_TIMEOUT' && error.retryable);
  const request = await host.received;
  t.mock.timers.tick(300_000);
  await rejected;
  await host.barrier();
  assert.equal(host.messages.filter(message => message.action === 'material-import-cancel').length, 1);
  host.control(request.requestId, 'material-import-prepared');
  host.respond(request.requestId, { status: 'cancelled' });
  await host.barrier();
  assert.deepEqual(host.messages.filter(message => message.kind === 'control'), [{
    protocol: 'lumina-workshop-rpc', version: 1, kind: 'control',
    requestId: request.requestId, action: 'material-import-cancel',
  }]);
});

test('accepted confirmation commits once and waits beyond the confirmation deadline for upload', async t => {
  const host = await importHost(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = startImport(host.client);
  // Observe early errors without creating an unhandled rejection on the old code.
  let failure;
  pending.catch(error => { failure = error; });
  const request = await host.received;
  t.mock.timers.tick(299_999);
  host.control(request.requestId, 'material-import-prepared');
  host.control(request.requestId, 'material-import-prepared');
  await host.barrier();
  t.mock.timers.tick(600_000);
  assert.equal(failure, undefined);
  assert.deepEqual(host.messages.filter(message => message.kind === 'control').map(message => message.action),
    ['material-import-commit']);
  const result = { status: 'imported', materials: [{ directoryName: 'example', name: 'Example' }] };
  host.respond(request.requestId, result);
  assert.deepEqual(await pending, result);
});

test('closing a pending client cancels the confirmation before closing the port', async t => {
  const host = await importHost(t);
  const pending = startImport(host.client);
  const rejected = assert.rejects(pending, error => error.code === 'CLIENT_CLOSED' && !error.retryable);
  const request = await host.received;
  host.client.close();
  await rejected;
  await host.portClosed;
  assert.ok(host.messages.some(message => message.requestId === request.requestId &&
    message.action === 'material-import-cancel'));
});

test('host disconnection settles a committed import without suggesting a retry', async t => {
  const host = await importHost(t);
  const pending = startImport(host.client);
  let failure;
  pending.catch(error => { failure = error; });
  const request = await host.received;
  host.control(request.requestId, 'material-import-prepared');
  await host.barrier();
  host.closeHost();
  await host.clientPortClosed;
  assert.equal(failure?.code, 'CONNECTION_CLOSED');
  assert.equal(failure.retryable, false);
});
