import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createLegacyDefinition, parseNativeQuestions, parseNativeAnswers, readNativeQuestionRecord } from "../lib/native-questions.js";

const questions = [{ id: "fruit", question: "想吃什么？", header: "水果",
  options: [{ label: "西瓜", description: "清爽" }, { label: "芒果", description: "甜" }, { label: "梨" }] }];
const event = (type, data, seq, surfaceOp) => ({ type, data, seq, time: seq * 1000, ...(surfaceOp ? { surfaceOp } : {}) });
const call = (callId = "call-a", batch = questions, seq = 1) => event("tool/call", { callId, name: "ask_user_question", arguments: JSON.stringify({ questions: batch }) }, seq);
const result = (callId = "call-a", answers = [{ id: "fruit", selected: ["芒果"] }], seq = 2, extras = {}) => event("tool/result", {
  message: { source: { kind: "tool", callId }, isError: false, content: [{ type: "text", text: JSON.stringify({ answers }) }], ...extras },
}, seq, "append");
const late = (callId = "call-a", batch = questions, answers = [{ id: "fruit", selected: ["芒果"] }], seq = 4) => event("user/message", {
  id: "message-reply", source: { kind: "user-question-reply", callId, outcome: "answered" },
  content: [{ type: "text", text: JSON.stringify({ kind: "answer_to_pending_question", tool: "ask_user_question", callId, questions: batch, answers }) }],
}, seq, "append");

test("single answer preserves every native tool option, description and header after replay", () => {
  const events = [call(), result()];
  const data = readNativeQuestionRecord(events, "call-a");
  assert.deepEqual(data.questions[0].options, questions[0].options);
  assert.equal(data.questions[0].header, "水果");
  assert.equal(data.questions[0].multiSelect, false);
  assert.deepEqual(data.answers, [{ id: "fruit", selected: ["芒果"] }]);
  assert.deepEqual(readNativeQuestionRecord(JSON.parse(JSON.stringify(events)), "call-a"), data);
});

test("multi-select retains selected labels together with verbatim free text", () => {
  const batch = [{ ...questions[0], multi_select: true }];
  const answers = [{ id: "fruit", selected: ["西瓜", "芒果"], custom: "  还要荔枝\n谢谢  " }];
  const data = readNativeQuestionRecord([call("call-a", batch), result("call-a", answers)], "call-a");
  assert.equal(data.questions[0].multiSelect, true);
  assert.deepEqual(data.answers, answers);
});

test("pure free-text question and custom-only single-select both retain the answer", () => {
  const batch = [{ id: "comment", question: "想补充什么？" }, ...questions];
  const answers = [{ id: "fruit", selected: [], custom: "荔枝" }, { id: "comment", selected: [], custom: "随便写" }];
  const data = readNativeQuestionRecord([call("call-a", batch), result("call-a", answers)], "call-a");
  assert.deepEqual(data.answers, answers);
  assert.deepEqual(data.questions[0].options, []);
  assert.equal(data.questions[1].options.length, 3);
});

test("skipped questions stay distinguishable from failed or pending calls", () => {
  const skipped = readNativeQuestionRecord([call(), result("call-a", [{ id: "fruit", selected: [] }])], "call-a");
  assert.deepEqual(skipped.answers[0], { id: "fruit", selected: [] });
  assert.equal(readNativeQuestionRecord([call()], "call-a"), null);
  assert.equal(readNativeQuestionRecord([call(), result("call-a", undefined, 2, { isError: true })], "call-a"), null);
  assert.equal(readNativeQuestionRecord([call(), result("call-a", undefined, 2, { content: [{ type: "text", text: '{"pending":true,"callId":"call-a"}' }] })], "call-a"), null);
});

test("same labels in unrelated calls never attach one answer to another call", () => {
  const events = [call("call-a"), call("call-b", questions, 2), result("call-b", undefined, 3)];
  assert.equal(readNativeQuestionRecord(events, "call-a"), null);
  assert.equal(readNativeQuestionRecord(events, "call-b").callId, "call-b");
});

test("a queued, ordinary, or replacement message does not settle a question", () => {
  const answer = late();
  const ordinary = { ...answer, data: { ...answer.data, source: { kind: "user" } } };
  assert.equal(readNativeQuestionRecord([call(), ordinary], "call-a"), null);
  assert.equal(readNativeQuestionRecord([call(), { ...answer, type: "queue/enqueue" }], "call-a"), null);
  assert.equal(readNativeQuestionRecord([call(), { ...answer, surfaceOp: { op: "replace" } }], "call-a"), null);
  assert.equal(readNativeQuestionRecord([call(), { ...result(), surfaceOp: { op: "replace" } }], "call-a"), null);
});

test("late answer restores a timed-out record, including from a partial window", () => {
  const batch = [{ ...questions[0], multiSelect: true }];
  const answer = late("call-a", batch, [{ id: "fruit", selected: ["西瓜", "梨"], custom: "冰镇" }]);
  const data = readNativeQuestionRecord([answer], "call-a");
  assert.equal(data.late, true);
  assert.equal(data.questions[0].options.length, 3);
  assert.equal(data.questions[0].multiSelect, true);
  assert.deepEqual(data.answers[0].selected, ["西瓜", "梨"]);
  const pending = result("call-a", undefined, 2, { content: [{ type: "text", text: '{"pending":true,"callId":"call-a"}' }] });
  assert.deepEqual(readNativeQuestionRecord([call("call-a", [{ ...questions[0], multi_select: true }]), pending, answer], "call-a"), data);
});

test("late reply source and payload must name the same tool call", () => {
  const answer = late();
  answer.data.source.callId = "call-b";
  assert.equal(readNativeQuestionRecord([answer], "call-b"), null);
});

test("PTC subcalls use subCallId and work when only the complete settlement is loaded", () => {
  const data = { name: "ask_user_question", callId: "run-code", subCallId: "run-code:ptc:1", arguments: { questions } };
  const start = event("tool/ptc-dispatch-start", data, 1);
  const end = event("tool/ptc-dispatch", { ...data, isError: false,
    content: [{ type: "text", text: JSON.stringify({ answers: [{ id: "fruit", selected: ["梨"] }] }) }] }, 2);
  assert.deepEqual(readNativeQuestionRecord([start, end], data.subCallId), readNativeQuestionRecord([end], data.subCallId));
  assert.equal(readNativeQuestionRecord([start, end], "run-code"), null);
});

test("malformed and ambiguous batches do not invent selections", () => {
  const normalized = parseNativeQuestions({ questions });
  for (const answers of [[], [{ id: "missing", selected: [] }], [{ id: "fruit", selected: ["not offered"] }],
    [{ id: "fruit", selected: ["西瓜", "梨"] }], [{ id: "fruit", selected: ["西瓜"], custom: "梨" }],
    [{ id: "fruit", selected: ["西瓜", "西瓜"] }], [{ id: "fruit", selected: [7] }], [{ id: "fruit", selected: [], custom: 7 }]]) {
    assert.equal(parseNativeAnswers({ answers }, normalized), null);
  }
  const two = parseNativeQuestions({ questions: [...questions, { id: "q2", question: "下一题" }] });
  assert.equal(parseNativeAnswers({ answers: [{ id: "fruit", selected: [] }, { id: "fruit", selected: [] }] }, two), null);
  assert.equal(parseNativeQuestions("not json"), null);
  assert.equal(parseNativeQuestions({ questions: [...questions, ...questions] }), null);
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], options: [{ label: 7 }] }] }), null);
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], multi_select: "invalid" }] }), null);
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], multiSelect: "invalid" }] }, { source: "service" }), null);
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], intent: { kind: "approval" } }] }, { source: "service" }), null);
  assert.equal(parseNativeQuestions({ questions }, { source: "unknown" }), null);
});

test("Session window wrappers are accepted and transient entries ignored", () => {
  const events = [{ type: "event", event: call() }, { type: "transient", event: result() }];
  assert.equal(readNativeQuestionRecord(events, "call-a"), null);
  events.push({ type: "event", event: result() });
  assert.equal(readNativeQuestionRecord(events, "call-a").questions[0].question, "想吃什么？");
});

test("history prepending reveals an orphan result only after its original question is known", () => {
  assert.equal(readNativeQuestionRecord([result()], "call-a"), null);
  assert.ok(readNativeQuestionRecord([call(), result()], "call-a"));
  const definition = createLegacyDefinition();
  assert.deepEqual(definition.match(result()), { id: "call-a", role: "update" });
});

test("Conversation reducer publishes a read-only card at settlement, and hides invalidated state", () => {
  const definition = createLegacyDefinition({ nodeKind: "test-native" });
  const location = { kind: "turn", turn: { turn: 1 } };
  const context = { id: "call-a", key: "test-key", start: { location }, current: new Map() };
  context.state = definition.start(context, { event: call(), location });
  assert.equal(definition.buildViewNode(context), null);
  context.state = definition.update(context, { event: result(), location });
  const node = definition.buildViewNode(context);
  assert.equal(node.kind, "test-native");
  assert.equal(node.anchorSeq, 2);
  assert.equal(node.visibility, "visible");
  assert.equal(node.groupTree, "turn");
  assert.equal(node.data.questions[0].options.length, 3);
  context.current.set("chat", node);
  context.state = definition.update(context, { event: result("call-a", undefined, 3, { isError: true }), location });
  assert.equal(definition.buildViewNode(context).visibility, "hidden");
});

test("late reply uses its admitting turn and can be delegated to the host's existing renderer", () => {
  const definition = createLegacyDefinition();
  const location = { kind: "step", step: { step: 1 }, turn: { turn: 2 } };
  const context = { id: "call-a", key: "test-key", start: { location }, current: new Map() };
  context.state = definition.start(context, { event: late(), location });
  assert.equal(definition.buildViewNode(context).groupTree, "exchange");
  assert.equal(definition.buildViewNode(context).location.turn.turn, 2);
  assert.equal(createLegacyDefinition({ includeLateReplies: false }).match(late()), null);
});

// Verified against both legacy and timed execute() in official dsh-tool-ask-user
// 0.2.1-rc.3 and 0.2.2-rc.3. These extra properties are allowed by its schema,
// but only multi_select is forwarded to the native question service.
const toolContractCases = [
  { name: "camel-case flag", extra: { multiSelect: true }, multiple: false },
  { name: "supporting detail", extra: { detail: "**Not shown by the native tool**" }, multiple: false },
  { name: "intent", extra: { intent: { kind: "plan-review" } }, multiple: false },
  { name: "conflicting flags", extra: { multi_select: true, multiSelect: false }, multiple: true },
  { name: "untyped extras", extra: { multi_select: true, multiSelect: "ignored", detail: 7 }, multiple: true },
];

test("official tool extensions do not change the card the user actually answered", () => {
  for (const { name, extra, multiple } of toolContractCases) {
    const question = { id: "q", question: "Which?", options: [{ label: "A" }, { label: "B" }], ...extra };
    const restored = readNativeQuestionRecord([call("call-a", [question]), result("call-a", [{ id: "q", selected: ["A"] }])], "call-a");
    assert.deepEqual(restored?.questions, [{ id: "q", question: "Which?", options: question.options, multiSelect: multiple }], name);
    assert.deepEqual(restored.answers, [{ id: "q", selected: ["A"] }], name);
  }
});

test("service replies preserve detail and read only the service multiSelect field", () => {
  const question = { id: "q", question: "Which?", options: [{ label: "A" }, { label: "B" }],
    detail: "**Service-owned detail**", multiSelect: true, multi_select: false };
  const parsed = parseNativeQuestions({ questions: [question] }, { source: "service" });
  assert.deepEqual(parsed, [{ id: "q", question: "Which?", options: question.options, detail: question.detail, multiSelect: true }]);
  const answers = [{ id: "q", selected: ["A", "B"], custom: "  unchanged\n  " }];
  const restored = readNativeQuestionRecord([late("call-a", [question], answers)], "call-a");
  assert.deepEqual(restored?.questions, parsed);
  assert.deepEqual(restored?.answers, answers);
  assert.equal(parseNativeQuestions({ questions: [{ ...question, intent: { kind: "plan-review" } }] }, { source: "service" }), null);
});

test("late replies use the same tool question format with or without the earlier call loaded", () => {
  const raw = { id: "q", question: "Which?", options: [{ label: "A" }], multiSelect: true, detail: "Ignored tool property" };
  const service = { id: "q", question: "Which?", options: raw.options };
  const reply = late("call-a", [service], [{ id: "q", selected: ["A"] }]);
  assert.deepEqual(readNativeQuestionRecord([call("call-a", [raw]), reply], "call-a"), readNativeQuestionRecord([reply], "call-a"));
});

// Optional live contract probe without adding host dependencies to this plugin.
// Supply a JSON array of existing DSH install roots in this environment variable.
for (const runtime of JSON.parse(process.env.DSH_NATIVE_CONTRACT_RUNTIMES ?? "[]")) {
  test(`official tool execute contract: ${runtime}`, async () => {
    const { apply } = await import(pathToFileURL(`${runtime}/node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js`));
    for (const mode of ["legacy", "timed"]) {
      let definition;
      let request;
      const ask = async value => {
        request = value;
        return { answers: value.questions.map(question => ({ id: question.id, selected: ["A"] })) };
      };
      apply({ tools: { register(value) { definition = value; } }, userQuestions: { ask, askTimed: ask } }, { mode, timeout: -1 });
      for (const { name, extra } of toolContractCases) {
        const batch = [{ id: "q", question: "Which?", options: [{ label: "A" }, { label: "B" }], ...extra }];
        const actual = await definition.execute({ questions: batch }, { callId: "call-a", signal: new AbortController().signal });
        const restored = readNativeQuestionRecord([call("call-a", batch), result("call-a", actual.answers)], "call-a");
        assert.deepEqual(restored?.questions, request.questions.map(question => ({ ...question, options: question.options ?? [], multiSelect: question.multiSelect ?? false })), `${mode}: ${name}`);
        assert.deepEqual(restored?.answers, actual.answers, `${mode}: ${name}`);
      }
    }
  });
}
