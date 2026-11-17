/** Read native question records from the durable transcript, without changing the interaction. */
export const NATIVE_TOOL = "ask_user_question";
export const NATIVE_DEFINITION_KIND = "ryuu-answered-native-question";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string";

function json(value) {
  if (typeof value !== "string") return record(value) ? value : null;
  try { const parsed = JSON.parse(value); return record(parsed) ? parsed : null; }
  catch { return null; }
}

/** Normalize only the fields the native tool forwards, or an explicit service reply. */
export function parseNativeQuestions(argumentsValue, { source = "tool" } = {}) {
  if (source !== "tool" && source !== "service") return null;
  const service = source === "service";
  const value = json(argumentsValue);
  if (!value || !Array.isArray(value.questions) || value.questions.length === 0) return null;
  const ids = new Set();
  const questions = [];
  for (const item of value.questions) {
    if (!record(item) || !string(item.id) || !string(item.question) || ids.has(item.id)) return null;
    // The tool ignores extra fields; service-owned intents have their own UI.
    if (service && item.intent !== undefined) return null;
    if ((item.header !== undefined && !string(item.header)) || (service && item.detail !== undefined && !string(item.detail))) return null;
    const multiSelect = service ? item.multiSelect : item.multi_select;
    if (multiSelect !== undefined && typeof multiSelect !== "boolean") return null;
    if (item.options !== undefined && !Array.isArray(item.options)) return null;
    const options = [];
    for (const option of item.options ?? []) {
      if (!record(option) || !string(option.label) || (option.description !== undefined && !string(option.description))) return null;
      options.push({ label: option.label, ...(option.description === undefined ? {} : { description: option.description }) });
    }
    ids.add(item.id);
    questions.push({ id: item.id, question: item.question, options,
      multiSelect: multiSelect ?? false,
      ...(item.header === undefined ? {} : { header: item.header }),
      ...(!service || item.detail === undefined ? {} : { detail: item.detail }),
    });
  }
  return questions;
}

/** A complete, unambiguous answer batch; empty selections preserve a skipped question. */
export function parseNativeAnswers(answerValue, questions) {
  const value = json(answerValue);
  if (!value || value.pending === true || !Array.isArray(questions) || !Array.isArray(value.answers)
    || value.answers.length !== questions.length) return null;
  const remaining = new Map(questions.map(question => [question.id, question]));
  const answers = [];
  for (const item of value.answers) {
    if (!record(item) || !string(item.id) || !remaining.has(item.id) || !Array.isArray(item.selected)
      || !item.selected.every(string) || (item.custom !== undefined && !string(item.custom))) return null;
    const question = remaining.get(item.id);
    const offered = new Set(question.options.map(option => option.label));
    if (new Set(item.selected).size !== item.selected.length || item.selected.some(label => !offered.has(label))) return null;
    if (!question.multiSelect && (item.selected.length > 1 || (item.selected.length > 0 && (item.custom?.trim() ?? "") !== ""))) return null;
    remaining.delete(item.id);
    answers.push({ id: item.id, selected: [...item.selected], ...(item.custom === undefined ? {} : { custom: item.custom }) });
  }
  return answers;
}

function oneText(content) {
  return Array.isArray(content) && content.length === 1 && content[0]?.type === "text" && string(content[0].text)
    ? content[0].text : null;
}

function callOf(event) {
  if (event?.type === "tool/call" && event.data?.name === NATIVE_TOOL && string(event.data.callId)) {
    return { callId: event.data.callId, questions: parseNativeQuestions(event.data.arguments) };
  }
  if ((event?.type === "tool/ptc-dispatch-start" || event?.type === "tool/ptc-dispatch")
    && event.data?.name === NATIVE_TOOL && string(event.data.subCallId)) {
    return { callId: event.data.subCallId, questions: parseNativeQuestions(event.data.arguments) };
  }
  return null;
}

function resultOf(event) {
  if (event?.type === "tool/result" && event.surfaceOp === "append" && string(event.data?.message?.source?.callId)) {
    return { callId: event.data.message.source.callId, message: event.data.message };
  }
  if (event?.type === "tool/ptc-dispatch" && event.data?.name === NATIVE_TOOL && string(event.data.subCallId)) {
    return { callId: event.data.subCallId, message: event.data };
  }
  return null;
}

function lateReplyOf(event) {
  if (event?.type !== "user/message" || event.surfaceOp !== "append") return null;
  const source = event.data?.source;
  if (source?.kind !== "user-question-reply" || source.outcome !== "answered" || !string(source.callId)) return null;
  const text = oneText(event.data.content);
  const value = json(text);
  if (!value || value.kind !== "answer_to_pending_question" || value.tool !== NATIVE_TOOL || value.callId !== source.callId) return null;
  return { callId: source.callId, questions: parseNativeQuestions(value, { source: "service" }), value, text };
}

function settled(questions, answers, event, callId, text, late = false) {
  return { callId, outcome: "answered", questions, answers, text, time: event.time, seq: event.seq, late };
}

/**
 * Reconstruct one answered call from a loaded Session window. Unloaded/malformed
 * evidence returns null, so the caller can keep the host's ordinary fallback.
 * Accepts raw events or the SessionEventWindow.entries wrappers.
 */
export function readNativeQuestionRecord(events, callId) {
  if (!Array.isArray(events) || !string(callId)) return null;
  let state = { questions: null, reply: null };
  for (const entry of events) {
    if (entry?.type === "transient") continue;
    const event = entry?.type === "event" ? entry.event : entry;
    const call = callOf(event);
    const result = resultOf(event);
    const late = lateReplyOf(event);
    if (call?.callId !== callId && result?.callId !== callId && late?.callId !== callId) continue;
    state = advance(state, event, callId);
  }
  return state.reply;
}

function advance(state, event, callId) {
  let questions = state.questions;
  let reply = state.reply;
  const call = callOf(event);
  if (call?.callId === callId) questions = call.questions;
  const result = resultOf(event);
  if (result?.callId === callId) {
    const text = oneText(result.message.content);
    const answers = questions && result.message.isError !== true && text !== null ? parseNativeAnswers(text, questions) : null;
    reply = answers ? settled(questions, answers, event, callId, text) : null;
  }
  const late = lateReplyOf(event);
  if (late?.callId === callId) {
    // The native Host echoes its full question batch in an admitted late reply.
    // That record remains useful when the earlier call is outside the loaded page.
    const original = questions ?? late.questions;
    const answers = original ? parseNativeAnswers(late.value, original) : null;
    reply = answers ? settled(original, answers, event, callId, late.text, true) : null;
    questions = original;
  }
  return { questions, reply };
}

/**
 * Conversation extension for hosts without the stock answered-user-question
 * definition. Matching is call-id scoped; orphan result updates survive a
 * later history prepend under the host's ordinary Conversation lifecycle.
 */
export function createLegacyDefinition({ kind = NATIVE_DEFINITION_KIND, nodeKind = "ryuu-answered-question", includeLateReplies = true } = {}) {
  return {
    kind,
    target: "chat",
    match(event) {
      const call = callOf(event);
      if (call) return { id: call.callId, role: "start" };
      const result = resultOf(event);
      if (result) return { id: result.callId, role: "update" };
      const late = includeLateReplies ? lateReplyOf(event) : null;
      return late ? { id: late.callId, role: "start" } : null;
    },
    start(context, match) {
      const next = advance({ questions: null, reply: null }, match.event, context.id);
      return { ...next, replyLocation: next.reply ? match.location : null };
    },
    update(context, match) {
      const next = advance(context.state, match.event, context.id);
      return { ...next, replyLocation: next.reply !== context.state.reply ? match.location : context.state.replyLocation };
    },
    buildViewNode(context) {
      const reply = context.state?.reply;
      if (!reply) {
        const previous = context.current?.get("chat");
        return previous ? { ...previous, visibility: "hidden" } : null;
      }
      const location = context.state.replyLocation ?? context.start?.location ?? { kind: "unresolved" };
      return {
        key: context.key, id: context.id, kind: nodeKind, target: "chat", anchorSeq: reply.seq,
        location, groupTree: reply.late ? (location.kind === "step" && location.step.step === 1 ? "exchange" : "input") : "turn",
        visibility: "visible", data: reply,
      };
    },
  };
}
