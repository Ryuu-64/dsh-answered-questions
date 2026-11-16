import test from 'node:test';
import assert from 'node:assert/strict';
import { assertChoiceOperator, createChoiceService } from '../lib/choice-service.js';
import { CHOICE_METADATA, CHOICE_SOURCE, choiceSource, choiceRemote, choiceStatusSchema, chooseSchema, getChoiceSchema } from '../lib/choice-protocol.js';

function fixture({ failSend = false, failedTool = false, unfinished = false } = {}) {
  const listeners = new Map();
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'choice-1', name: 'ask_user_choice', arguments: JSON.stringify({
      title: 'Which?', options: [{ id: 'same', kind: 'text', title: 'Same', value: 'A' }, { id: 'same', kind: 'text', title: 'Same', value: 'B' }], noneLabel: 'Neither',
    }) } },
    ...unfinished ? [] : [{ type: 'tool/result', seq: 2, surfaceOp: 'append', data: { message: { source: { callId: 'choice-1' }, isError: failedTool, content: [] } } }],
  ];
  let made = 0, disposed = 0, observed = 0;
  const agent = {
    id: 'session-1', session: { id: 'session-1', header: { id: 'session-1' } }, inbox: { nextTurn: [], nextStep: [] },
    followup(message) { if (failSend) throw new Error('admission failed'); this.inbox.nextTurn.push(message); },
  };
  const ctx = {
    on(name, callback) { const group = listeners.get(name) ?? []; group.push(callback); listeners.set(name, group); },
    agents: { get: id => id === agent.id ? agent : undefined },
    workspaceRegistry: { archivedSessionIds: [] },
    sessionQuery: { async observeSession(id, options) {
      options.signal.throwIfAborted(); observed++;
      assert.equal(options.projectionMode, 'all');
      return { header: { ...agent.session.header, id }, events: [...events], projections: { values: { inbox: {
        'next-turn': [...agent.inbox.nextTurn], 'next-step': [...agent.inbox.nextStep],
      } } }, [Symbol.dispose]() { disposed++; } };
    } },
  };
  const emit = (name, ...args) => { for (const callback of listeners.get(name) ?? []) callback(...args); };
  const makeMessage = value => ({ ...structuredClone(value), role: 'user', id: `message-${++made}` });
  const create = () => createChoiceService(ctx, makeMessage);
  const service = create(), signal = new AbortController().signal;
  const request = { sessionId: agent.id, callId: 'choice-1' };
  const choose = selectedIndex => service.choose(agent, { callId: request.callId, selectedIndex }, signal);
  function settle() {
    const message = agent.inbox.nextTurn.shift();
    emit('agent/inbox/claimed', { agent, message, turn: 2 });
    const event = { type: 'user/message', surfaceOp: 'append', seq: events.length + 1, data: message };
    events.push(event); emit('session/event', agent.session, event);
    return message;
  }
  return { ctx, agent, events, service, signal, request, choose, create, settle, emit, counts: () => ({ made, disposed, observed }) };
}

test('selects by exact option index despite duplicate labels and ids, retaining plain model-facing answer', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'not-recorded' });
  const result = await f.choose(1);
  assert.equal(result.status, 'queued');
  assert.deepEqual(f.agent.inbox.nextTurn[0].content, [{ type: 'text', text: 'B' }]);
  assert.deepEqual(f.agent.inbox.nextTurn[0].source, { kind: 'user', [CHOICE_METADATA]: { version: 1, callId: 'choice-1', selectedIndex: 1 } });
  assert.equal(f.counts().disposed, f.counts().observed);
});

test('concurrent retries admit exactly one message; changed choice is refused', async () => {
  const f = fixture();
  const receipts = await Promise.all([f.choose(0), f.choose(0), f.choose(0)]);
  assert.equal(new Set(receipts.map(value => value.messageId)).size, 1);
  assert.equal(f.agent.inbox.nextTurn.length, 1);
  await assert.rejects(f.choose(1), /different answer/);
  assert.equal(f.counts().made, 1);
});

test('durable reply survives a fresh backend, and retry after lost receipt does not resend', async () => {
  const f = fixture();
  const sent = await f.choose(1);
  f.settle();
  const restarted = f.create();
  const expected = { ...sent, status: 'answered' };
  assert.deepEqual(await restarted.get(f.request, f.signal), expected);
  assert.deepEqual(await restarted.choose(f.agent, { callId: 'choice-1', selectedIndex: 1 }, f.signal), expected);
  assert.equal(f.counts().made, 1);
});

test('none is separate from option zero and is replayable', async () => {
  const f = fixture();
  await f.choose(null);
  const message = f.settle();
  assert.deepEqual(message.content, [{ type: 'text', text: 'Neither' }]);
  assert.equal((await f.service.get(f.request, f.signal)).selectedIndex, null);
});

test('ordinary messages that happen to equal an option are never interpreted as picks', async () => {
  const f = fixture();
  f.events.push({ type: 'user/message', surfaceOp: 'append', data: { id: 'ordinary', source: { kind: 'user' }, content: [{ type: 'text', text: 'B' }] } });
  assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'not-recorded' });
});

test('read failure, tool failure, unfinished tool and unoffered choice never send', async () => {
  for (const options of [{ failedTool: true }, { unfinished: true }]) {
    const f = fixture(options);
    assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'unavailable' });
    await assert.rejects(f.choose(0), /not ready/);
    assert.equal(f.counts().made, 0);
  }
  const f = fixture();
  await assert.rejects(f.choose(3), /not offered/);
  f.ctx.sessionQuery.observeSession = async () => { throw new Error('storage failed'); };
  await assert.rejects(f.choose(0), /storage failed/);
  assert.equal(f.counts().made, 0);
});

test('failed admission does not leave a successful reply or block a later successful attempt', async () => {
  const f = fixture({ failSend: true });
  await assert.rejects(f.choose(0), /admission failed/);
  assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'not-recorded' });
  f.agent.followup = message => f.agent.inbox.nextTurn.push(message);
  assert.equal((await f.choose(1)).selectedIndex, 1);
});

test('exception after insertion is surfaced, but a retry cannot duplicate the queued message', async () => {
  const f = fixture();
  f.agent.followup = message => { f.agent.inbox.nextTurn.push(message); throw new Error('observer failed'); };
  await assert.rejects(f.choose(0), /observer failed/);
  assert.equal((await f.service.get(f.request, f.signal)).status, 'queued');
  await f.choose(0);
  assert.equal(f.counts().made, 1);
});

test('claimed message remains reserved until admission; discarded or failed claimed queue unlocks the card', async () => {
  const f = fixture();
  await f.choose(0);
  const message = f.agent.inbox.nextTurn.shift();
  f.emit('agent/inbox/claimed', { agent: f.agent, message, turn: 2 });
  assert.equal((await f.service.get(f.request, f.signal)).status, 'queued');
  await f.choose(0);
  assert.equal(f.counts().made, 1);
  f.emit('session/event', f.agent.session, { type: 'turn/end', data: { turn: 2 } });
  assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'not-recorded' });
  await f.choose(1);
  const second = f.agent.inbox.nextTurn.shift();
  f.emit('agent/inbox/discarded', { agent: f.agent, message: second });
  assert.deepEqual(await f.service.get(f.request, f.signal), { status: 'not-recorded' });
});

test('old queued answer restored in the inbox prevents a duplicate after backend recreation', async () => {
  const f = fixture();
  await f.choose(1);
  const restarted = f.create();
  assert.equal((await restarted.get(f.request, f.signal)).status, 'queued');
  await restarted.choose(f.agent, { callId: 'choice-1', selectedIndex: 1 }, f.signal);
  assert.equal(f.counts().made, 1);
});

test('a cold chat reads its persisted canonical inbox projection without resuming an agent', async () => {
  const f = fixture();
  const sent = await f.choose(1);
  f.ctx.agents.get = () => undefined;
  const restarted = f.create();
  assert.deepEqual(await restarted.get(f.request, f.signal), sent);
  assert.equal(f.counts().made, 1);
  assert.equal(f.counts().observed, f.counts().disposed);
});

test('missing canonical queue projection fails closed instead of treating a saved choice as unanswered', async () => {
  const f = fixture();
  const observe = f.ctx.sessionQuery.observeSession;
  f.ctx.sessionQuery.observeSession = async (...args) => {
    const observation = await observe(...args);
    delete observation.projections;
    return observation;
  };
  await assert.rejects(f.choose(0), /queue state is unavailable/);
  assert.equal(f.counts().made, 0);
  assert.equal(f.counts().observed, f.counts().disposed);
});

test('human choice metadata is strict, keeps genuine user classification, and reads previous markers', () => {
  const marker = { version: 1, callId: 'c', selectedIndex: null };
  assert.deepEqual(choiceSource({ kind: 'user', [CHOICE_METADATA]: marker }), marker);
  assert.deepEqual(choiceSource({ kind: CHOICE_SOURCE, ...marker }), marker);
  for (const source of [
    { kind: 'model', [CHOICE_METADATA]: marker },
    { kind: 'user', [CHOICE_METADATA]: { ...marker, selectedIndex: '0' } },
    { kind: 'user', [CHOICE_METADATA]: { ...marker, version: 2 } },
    { kind: 'user', [CHOICE_METADATA]: { ...marker, injected: true } },
    { kind: 'user', [CHOICE_METADATA]: { ...marker, callId: '' } },
  ]) assert.equal(choiceSource(source), null);
});

test('archived, delegated, stale agent and aborted requests cannot submit', async () => {
  const f = fixture();
  f.ctx.workspaceRegistry.archivedSessionIds = [f.agent.id];
  await assert.rejects(f.choose(0), /Restore/);
  f.ctx.workspaceRegistry.archivedSessionIds = [];
  f.agent.session.header.origin = 'subagent';
  await assert.rejects(f.choose(0), /ordinary chat/);
  delete f.agent.session.header.origin;
  await assert.rejects(f.service.choose({ ...f.agent }, { callId: 'choice-1', selectedIndex: 0 }, f.signal), /no longer active/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(f.service.choose(f.agent, { callId: 'choice-1', selectedIndex: 0 }, controller.signal), /cancelled/);
  assert.equal(f.counts().made, 0);
});

test('observation is released even when durable content is invalid', async () => {
  const f = fixture();
  f.events[0].data.name = 'another_tool';
  await assert.rejects(f.choose(0), /another tool/);
  assert.equal(f.counts().disposed, 1);
});

test('owner verification uses the current DSH principal contract and rejects other or missing identities', () => {
  const signal = new AbortController().signal;
  assert.throws(() => assertChoiceOperator({}), /operator/);
  for (const principal of [undefined, {}, { kind: 'agent' }, { kind: 'shared' }]) {
    assert.throws(() => assertChoiceOperator({ invocation: { peer: { principal }, signal } }), /operator/);
  }
  assertChoiceOperator({ invocation: { peer: { principal: { kind: 'owner' } }, signal } });
  const aborted = new AbortController(); aborted.abort(new Error('cancelled'));
  assert.throws(() => assertChoiceOperator({ invocation: { peer: { principal: { kind: 'owner' } }, signal: aborted.signal } }), /cancelled/);
});

test('wire schemas reject coercion, extra fields and incomplete success receipts', () => {
  for (const selectedIndex of [-1, 8, '0', 1.5, undefined]) assert.throws(() => chooseSchema.parse({ callId: 'c', selectedIndex }));
  assert.throws(() => getChoiceSchema.parse({ sessionId: '', callId: 'c' }));
  assert.throws(() => chooseSchema.parse({ callId: 'c', selectedIndex: 0, text: 'injected' }));
  assert.throws(() => choiceStatusSchema.parse({ status: 'answered' }));
  assert.throws(() => choiceStatusSchema.parse({ status: 'not-recorded', selectedIndex: null }));
});

test('choice agent lookup matches the official DSH agent provider contract', () => {
  // AgentRegistry registers this wire identity; Gateway rejects a plugin-owned
  // alias even when its parser accepts the same strings (0.2.1/0.2.2 RC3).
  const provider = { wire: 'agentId', wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId' };
  const choose = choiceRemote.descriptors.find(item => item.method === 'choose');
  const parameter = choose.parameters.find(item => item.source === 'lookup');
  assert.equal(parameter.lookup, 'agent');
  assert.equal(parameter.wire, provider.wire);
  assert.equal(parameter.codec.typeSymbol, provider.wireTypeSymbol);
  assert.deepEqual(choose.scope, { context: 'agent', wire: provider.wire });
  const requests = choiceRemote.descriptors.map(method => method.parameters.find(item => item.name === 'request').codec);
  assert.equal(new Set(requests.map(request => request.typeSymbol)).size, 2);
});
