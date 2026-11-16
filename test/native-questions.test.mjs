import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyDefinition, parseNativeQuestions, parseNativeAnswers, readNativeQuestionRecord } from "../lib/native-questions.js";

const questions = [{ id: "fruit", question: "想吃什么？", header: "水果", detail: "选一项，也可以自己填写。",
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

test("single answer preserves every original option, description, header and detail after replay", () => {
  const events = [call(), result()];
  const data = readNativeQuestionRecord(events, "call-a");
  assert.deepEqual(data.questions[0].options, questions[0].options);
  assert.equal(data.questions[0].detail, questions[0].detail);
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
  assert.deepEqual(readNativeQuestionRecord([call("call-a", batch), pending, answer], "call-a"), data);
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
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], multiSelect: true, multi_select: false }] }), null);
  assert.equal(parseNativeQuestions({ questions: [{ ...questions[0], intent: { kind: "approval" } }] }), null);
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
