import { choiceSource } from './choice-protocol.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : undefined;

export function normalizeChoiceArgs(input) {
  let args = input;
  try { if (typeof args === 'string') args = JSON.parse(args); } catch { return null; }
  if (!isRecord(args) || !Array.isArray(args.options) || args.options.length < 2 || args.options.length > 8) return null;
  if (args.options.some(option => !isRecord(option) || !['text', 'image', 'audio'].includes(option.kind))) return null;
  return {
    title: text(args.title) ?? '', subtitle: text(args.subtitle) ?? '', noneLabel: text(args.noneLabel) || '—',
    options: args.options.map((option, index) => ({
      id: text(option.id) ?? `option-${index + 1}`, kind: option.kind,
      title: text(option.title) ?? text(option.id) ?? `Option ${index + 1}`,
      ...(text(option.description) === undefined ? {} : { description: option.description }),
      ...(text(option.value) === undefined ? {} : { value: option.value }),
      ...(text(option.src) === undefined ? {} : { src: option.src }),
    })),
  };
}

export function choiceResult(event) {
  const message = event?.data?.message;
  if (message?.isError === true || event?.data?.isError === true) return { status: 'failed', media: {} };
  const output = (Array.isArray(message?.content) ? message.content : [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  const media = {};
  const match = /\[media:(\[[\s\S]*\])\]/.exec(output);
  if (match) {
    try {
      for (const item of JSON.parse(match[1])) {
        if (Number.isInteger(item?.index) && item.index >= 0 && item.index < 8 && typeof item.url === 'string'
          && /^https?:\/\//i.test(item.url)) media[item.index] = item.url;
      }
    } catch { /* A malformed media map does not change the submitted choice identity. */ }
  }
  return { status: 'ready', media };
}

export function choiceReply(message, callId) {
  const source = choiceSource(message?.source);
  if (!source || (callId !== undefined && source.callId !== callId) || typeof message.id !== 'string') return null;
  const selectedIndex = source.selectedIndex;
  if (selectedIndex !== null && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= 8)) return null;
  return { status: 'answered', selectedIndex, messageId: message.id };
}

export const choiceDefinition = {
  kind: 'aq-choice', target: 'chat',
  match(event) {
    if (event?.type === 'tool/call' && event.data?.name === 'ask_user_choice' && typeof event.data.callId === 'string') {
      return { id: event.data.callId, role: 'start' };
    }
    if (event?.type === 'tool/result' && event.surfaceOp === 'append' && typeof event.data?.message?.source?.callId === 'string') {
      return { id: event.data.message.source.callId, role: 'update' };
    }
    if (event?.type === 'user/message' && event.surfaceOp === 'append' && choiceReply(event.data)) return { id: choiceSource(event.data.source).callId, role: 'update' };
    return null;
  },
  start(_context, match) {
    const args = normalizeChoiceArgs(match.event.data.arguments);
    return { callId: match.id ?? match.event.data.callId, args, media: {}, status: args ? 'preparing' : 'failed', seq: match.event.seq };
  },
  update(context, match) {
    const state = context.state;
    if (!state) return state;
    if (match.event.type === 'tool/result') {
      const result = choiceResult(match.event);
      return { ...state, ...result, status: state.status === 'answered' ? 'answered' : state.args ? result.status : 'failed' };
    }
    const reply = choiceReply(match.event.data, state.callId);
    if (!reply || (reply.selectedIndex !== null && reply.selectedIndex >= (state.args?.options.length ?? 0))) return state;
    return { ...state, ...reply };
  },
  buildViewNode(context) {
    const state = context.state;
    if (!state) return null;
    return {
      key: context.key, kind: 'aq-choice', id: context.id, target: 'chat', groupTree: 'turn',
      anchorSeq: state.seq, location: context.start?.location ?? context.location ?? { kind: 'unresolved' },
      visibility: 'visible', data: state,
    };
  },
};

export function inspectChoice(events, callId) {
  let args = null, result = null, reply = null, seenCall = false;
  for (const event of events) {
    if (event.type === 'tool/call' && event.data?.callId === callId) {
      if (event.data.name !== 'ask_user_choice' || seenCall) throw new Error('Choice identity is ambiguous or belongs to another tool');
      seenCall = true;
      args = normalizeChoiceArgs(event.data.arguments);
    } else if (event.type === 'tool/result' && event.surfaceOp === 'append' && event.data?.message?.source?.callId === callId) result = choiceResult(event);
    else if (event.type === 'user/message' && event.surfaceOp === 'append') reply ??= choiceReply(event.data, callId);
  }
  if (!args) throw new Error('Choice card was not found or its options are invalid');
  if (reply && reply.selectedIndex !== null && reply.selectedIndex >= args.options.length) throw new Error('Stored choice is invalid');
  return { args, result, reply };
}
