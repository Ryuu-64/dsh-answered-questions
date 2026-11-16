import { CHOICE_METADATA, choiceMarkerSchema, choiceSource, chooseSchema, getChoiceSchema } from './choice-protocol.js';
import { choiceReply, inspectChoice } from './choice-state.js';

/** A Cordis plugin Fiber is not an effect disposer; the injection callback returns void. */
export function mountChoiceService(ctx, ServiceClass) {
  return ctx.inject(ServiceClass.inject, scope => { scope.plugin(ServiceClass); });
}

export function assertChoiceOperator(ctx) {
  if (!ctx.invocation || ctx.invocation.peer?.principal?.kind !== 'owner') {
    throw new Error('Only the authenticated host operator can read or submit choices');
  }
  ctx.invocation.signal.throwIfAborted();
}

export function createChoiceService(ctx, makeMessage) {
  const locks = new Map();
  const pending = new WeakMap();
  const mapFor = agent => {
    let map = pending.get(agent);
    if (!map) { map = new Map(); pending.set(agent, map); }
    return map;
  };
  const queued = (agent, callId) => {
    if (!agent) return null;
    for (const message of [...(agent.inbox?.nextTurn ?? []), ...(agent.inbox?.nextStep ?? [])]) {
      const reply = choiceReply(message, callId);
      if (reply) return { ...reply, status: 'queued' };
    }
    const reply = pending.get(agent)?.get(callId);
    return reply ? { status: 'queued', selectedIndex: reply.selectedIndex, messageId: reply.messageId } : null;
  };
  const release = (agent, message) => {
    const source = choiceSource(message?.source);
    const record = source && pending.get(agent)?.get(source.callId);
    if (record?.messageId === message?.id) pending.get(agent).delete(source.callId);
  };
  ctx.on('agent/inbox/discarded', ({ agent, message }) => release(agent, message), { global: true });
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const reply = choiceReply(message);
    if (reply) mapFor(agent).set(choiceSource(message.source).callId, { ...reply, turn });
  }, { global: true });
  ctx.on('session/event', (session, event) => {
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    if (event.type === 'user/message') release(agent, event.data);
    else if (event.type === 'turn/end') {
      for (const [callId, reply] of pending.get(agent) ?? []) {
        if (reply.turn === event.data?.turn) pending.get(agent).delete(callId);
      }
    }
  }, { global: true });

  const assertSession = (header, sessionId) => {
    if (header?.id !== sessionId || header.origin === 'subagent') throw new Error('Choice must belong to an ordinary chat');
  };
  const read = async (sessionId, callId, signal) => {
    const observation = await ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'all' });
    try {
      signal.throwIfAborted();
      assertSession(observation.header, sessionId);
      const info = inspectChoice(observation.events, callId);
      const inbox = observation.projections?.values?.inbox;
      if (!inbox || !Array.isArray(inbox['next-turn']) || !Array.isArray(inbox['next-step'])) {
        throw new Error('Choice queue state is unavailable');
      }
      const storedQueue = [...inbox['next-turn'], ...inbox['next-step']]
        .map(message => choiceReply(message, callId)).find(Boolean);
      return { ...info, queued: storedQueue ? { ...storedQueue, status: 'queued' } : null };
    } finally { observation[Symbol.dispose](); }
  };
  const serialized = async (key, run) => {
    const operation = (locks.get(key) ?? Promise.resolve()).then(run);
    const barrier = operation.then(() => undefined, () => undefined);
    locks.set(key, barrier);
    try { return await operation; } finally { if (locks.get(key) === barrier) locks.delete(key); }
  };
  const keyOf = (sessionId, callId) => JSON.stringify([sessionId, callId]);
  const available = info => info.result?.status === 'ready';
  const archived = sessionId => new Set(ctx.workspaceRegistry.archivedSessionIds).has(sessionId);
  return {
    async get(request, signal) {
      const { sessionId, callId } = getChoiceSchema.parse(request);
      return serialized(keyOf(sessionId, callId), async () => {
        const info = await read(sessionId, callId, signal);
        if (info.reply) return info.reply;
        const queue = queued(ctx.agents.get(sessionId), callId) ?? info.queued;
        return queue ?? { status: available(info) ? 'not-recorded' : 'unavailable' };
      });
    },
    async choose(agent, request, signal) {
      const { callId, selectedIndex } = chooseSchema.parse(request);
      const sessionId = String(agent?.id ?? '');
      return serialized(keyOf(sessionId, callId), async () => {
        signal.throwIfAborted();
        if (!agent || ctx.agents.get(sessionId) !== agent) throw new Error('Choice chat is no longer active');
        assertSession(agent.session?.header, sessionId);
        if (archived(sessionId)) throw new Error('Restore this chat before answering its choice');
        const info = await read(sessionId, callId, signal);
        if (selectedIndex !== null && selectedIndex >= info.args.options.length) throw new Error('Selected option was not offered');
        const previous = info.reply ?? queued(agent, callId) ?? info.queued;
        if (previous) {
          if (previous.selectedIndex !== selectedIndex) throw new Error('This choice already has a different answer');
          return previous;
        }
        if (!available(info)) throw new Error('Choice card is not ready or its tool failed');
        signal.throwIfAborted();
        if (ctx.agents.get(sessionId) !== agent || archived(sessionId)) {
          throw new Error('Choice chat changed before the answer could be submitted');
        }
        const option = selectedIndex === null ? null : info.args.options[selectedIndex];
        const value = option ? option.value ?? option.title : info.args.noneLabel;
        const message = makeMessage({
          source: { kind: 'user', [CHOICE_METADATA]: choiceMarkerSchema.parse({ version: 1, callId, selectedIndex }) },
          content: [{ type: 'text', text: value || option?.title || '—' }],
        });
        const receipt = { status: 'queued', selectedIndex, messageId: message.id };
        mapFor(agent).set(callId, receipt);
        try {
          // Queue delivery preserves the original nonblocking tool's next-turn behavior.
          await agent.followup(message);
        } catch (error) {
          const stillInInbox = [...(agent.inbox?.nextTurn ?? []), ...(agent.inbox?.nextStep ?? [])].some(item => item.id === message.id);
          if (!stillInInbox && pending.get(agent)?.get(callId)?.turn === undefined) release(agent, message);
          throw error;
        }
        return receipt;
      });
    },
  };
}
