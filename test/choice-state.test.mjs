import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOICE_METADATA, CHOICE_SOURCE } from '../lib/choice-protocol.js';
import { choiceDefinition, choiceReply, choiceResult, inspectChoice, normalizeChoiceArgs } from '../lib/choice-state.js';

const args = { title: 'Pick a route', options: [{ kind: 'text', title: 'Left' }, { kind: 'image', title: 'Right', src: 'https://example.com/picture.png' }] };
const call = { seq: 10, type: 'tool/call', data: { name: 'ask_user_choice', callId: 'a', arguments: JSON.stringify(args) } };
const result = { seq: 11, type: 'tool/result', surfaceOp: 'append', data: { message: { source: { callId: 'a' }, content: [{ type: 'text', text: '[media:[{"index":1,"url":"https://example.com/resolved.png"}]]' }] } } };
const reply = { seq: 20, type: 'user/message', surfaceOp: 'append', data: { id: 'reply-a', source: { kind: 'user', [CHOICE_METADATA]: { version: 1, callId: 'a', selectedIndex: 1 } } } };

test('argument normalization preserves all option descriptions and multimedia; invalid input fails closed', () => {
  const normalized = normalizeChoiceArgs(JSON.stringify(args));
  assert.equal(normalized.options.length, 2);
  assert.equal(normalized.options[1].src, args.options[1].src);
  assert.equal(normalizeChoiceArgs('{bad'), null);
  assert.equal(normalizeChoiceArgs({ options: [{ kind: 'text' }] }), null);
  assert.equal(normalizeChoiceArgs({ options: [{ kind: 'text' }, { kind: 'script' }] }), null);
});

test('display remains ready until exact tagged reply; replay retains all choices and the selected index', () => {
  const context = { id: 'a', key: 'aq-choice:a', start: { location: { kind: 'session' } }, state: undefined };
  context.state = choiceDefinition.start(context, { event: call });
  assert.equal(context.state.status, 'preparing');
  context.state = choiceDefinition.update(context, { event: result });
  assert.equal(context.state.status, 'ready');
  context.state = choiceDefinition.update(context, { event: reply });
  const node = choiceDefinition.buildViewNode(context);
  assert.equal(node.data.selectedIndex, 1);
  assert.equal(node.data.status, 'answered');
  assert.equal(node.data.args.options.length, 2);
  assert.equal(node.data.media[1], 'https://example.com/resolved.png');
  assert.equal(node.anchorSeq, 10);
  assert.equal(node.key, 'aq-choice:a');
  assert.equal(node.groupTree, 'turn');
});

test('model-only replacement copies cannot create or overwrite a visible answer', () => {
  assert.equal(choiceDefinition.match({ ...reply, surfaceOp: 'replace' }), null);
  assert.equal(choiceDefinition.match({ ...result, surfaceOp: 'replace' }), null);
  const inspected = inspectChoice([call, result, { ...result, surfaceOp: 'replace', data: { message: { ...result.data.message, isError: true } } }, { ...reply, surfaceOp: 'replace' }], 'a');
  assert.equal(inspected.result.status, 'ready');
  assert.equal(inspected.reply, null);
});

test('late answer from another call and equal ordinary text do not select this card', () => {
  assert.equal(choiceReply(reply.data, 'another-call'), null);
  assert.equal(choiceDefinition.match({ type: 'user/message', surfaceOp: 'append', data: { id: 'ordinary', source: { kind: 'user' }, content: [{ type: 'text', text: 'Right' }] } }), null);
  const context = { state: choiceDefinition.start({}, { event: call }) };
  assert.equal(choiceDefinition.update(context, { event: { ...reply, data: { ...reply.data, source: { kind: 'user', [CHOICE_METADATA]: { ...reply.data.source[CHOICE_METADATA], callId: 'other' } } } } }), context.state);
});

test('old plugin-owned source markers still resolve without interpreting ordinary text', () => {
  const legacy = { ...reply.data, source: { kind: CHOICE_SOURCE, ...reply.data.source[CHOICE_METADATA] } };
  assert.deepEqual(choiceReply(legacy, 'a'), { status: 'answered', selectedIndex: 1, messageId: 'reply-a' });
});

test('result errors, bad media and unsafe protocols do not produce playable resources', () => {
  assert.equal(choiceResult({ ...result, data: { message: { isError: true } } }).status, 'failed');
  assert.deepEqual(choiceResult({ data: { message: { content: [{ type: 'text', text: '[media:[{"index":0,"url":"javascript:alert(1)"}]]' }] } } }).media, {});
  assert.deepEqual(choiceResult({ data: { message: { content: [{ type: 'text', text: '[media:[broken]]' }] } } }).media, {});
});

test('history cannot silently reuse a call id, including a malformed original', () => {
  assert.throws(() => inspectChoice([call, call], 'a'), /ambiguous/);
  assert.throws(() => inspectChoice([{ ...call, data: { ...call.data, arguments: '{}' } }, call], 'a'), /ambiguous/);
  assert.throws(() => inspectChoice([{ ...call, data: { ...call.data, name: 'other' } }], 'a'), /another tool/);
});
