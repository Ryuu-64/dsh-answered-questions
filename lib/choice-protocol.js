export const CHOICE_SOURCE = 'dsh-answered-questions-choice';
export const CHOICE_SERVICE = 'answeredQuestionsChoices';
export const CHOICE_METADATA = 'dshAnsweredQuestions';

const fail = () => { throw new TypeError('Invalid choice request or response'); };
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : fail();
const index = value => value === null || (Number.isInteger(value) && value >= 0 && value < 8) ? value : fail();
const object = (value, keys, required = keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail();
  return value;
};
export const choiceMarkerSchema = { parse(value) {
  object(value, ['version', 'callId', 'selectedIndex']);
  if (value.version !== 1) fail();
  return { version: 1, callId: identity(value.callId), selectedIndex: index(value.selectedIndex) };
} };

/** Human-source metadata keeps the host's ordinary user bubble and exchange grouping. */
export function choiceSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const marker = source.kind === 'user' ? source[CHOICE_METADATA]
    : source.kind === CHOICE_SOURCE ? { version: source.version, callId: source.callId, selectedIndex: source.selectedIndex } : null;
  try { return choiceMarkerSchema.parse(marker); } catch { return null; }
}
export const getChoiceSchema = { parse(value) {
  object(value, ['sessionId', 'callId']);
  return { sessionId: identity(value.sessionId), callId: identity(value.callId) };
} };
export const chooseSchema = { parse(value) {
  object(value, ['callId', 'selectedIndex']);
  return { callId: identity(value.callId), selectedIndex: index(value.selectedIndex) };
} };
export const choiceStatusSchema = { parse(value) {
  object(value, ['status', 'selectedIndex', 'messageId'], ['status']);
  if (!['not-recorded', 'queued', 'answered', 'unavailable'].includes(value.status)) fail();
  if (value.status === 'queued' || value.status === 'answered') {
    return { status: value.status, selectedIndex: index(value.selectedIndex), messageId: identity(value.messageId) };
  }
  if (Object.hasOwn(value, 'selectedIndex') || Object.hasOwn(value, 'messageId')) fail();
  return { status: value.status };
} };
const codec = (name, schema) => ({ mode: 'strict', typeSymbol: `@ryuu-64/dsh-answered-questions:${name}`, create: () => schema });
const parameter = (method, name, schema) => ({ name, wire: name, source: 'json', codec: codec(`${CHOICE_SERVICE}.${method}:${name}`, schema) });
const identitySchema = { parse: identity };

export const choiceRemote = {
  package: '@ryuu-64/dsh-answered-questions',
  descriptors: ['get', 'choose'].map(method => ({
    id: `@ryuu-64/dsh-answered-questions:${CHOICE_SERVICE}.${method}`,
    service: CHOICE_SERVICE, namespace: CHOICE_SERVICE, method,
    invocation: { kind: 'direct' },
    ...(method === 'choose' ? { scope: { context: 'agent', wire: 'agentId' } } : {}),
    parameters: method === 'get' ? [parameter(method, 'request', getChoiceSchema)] : [
      { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: {
        mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: () => identitySchema,
      } },
      parameter(method, 'request', chooseSchema),
    ],
    result: codec('choiceStatus', choiceStatusSchema),
  })),
};
