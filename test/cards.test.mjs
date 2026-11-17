import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerCard, ChoiceOptions, safeMediaUrl } from '../src/cards.js';
import { zh } from '../src/strings.js';
const t = key => zh[key];
const record = {
  callId: 'call-a', questions: [{ id: 'q', question: '晚餐吃什么？', header: '晚餐', multiSelect: true,
    options: [{ label: '米饭', description: '热米饭' }, { label: '面条', description: '清汤面' }, { label: '饺子' }] }],
  answers: [{ id: 'q', selected: ['米饭', '饺子'], custom: '少放盐\n谢谢' }],
};

test('rendering retains unselected options and captions, marks each selected option, and shows written answer', () => {
  const html = renderToStaticMarkup(React.createElement(AnswerCard, { record, t }));
  for (const text of ['晚餐吃什么？', '米饭', '热米饭', '面条', '清汤面', '饺子', '少放盐\n谢谢']) assert.ok(html.includes(text));
  assert.equal((html.match(/data-selected="true"/g) ?? []).length, 2);
  assert.equal((html.match(/data-selected="false"/g) ?? []).length, 1);
  assert.ok(html.includes('自由填写'));
  assert.equal((html.match(/role="checkbox"/g) ?? []).length, 3);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 6, 'options, written answer, and both single-page controls are disabled');
});

test('free-text-only records do not claim to be a single choice', () => {
  const data = { ...record, questions: [{ id: 'q', question: '有什么补充？', options: [], multiSelect: false }], answers: [{ id: 'q', selected: [], custom: '<script>alert(1)</script>' }] };
  const html = renderToStaticMarkup(React.createElement(AnswerCard, { record: data, t }));
  assert.ok(html.includes('自由填写'));
  assert.ok(!html.includes('单选'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('single choice retains native numbering and the selected radio state', () => {
  const [question] = record.questions;
  const html = renderToStaticMarkup(React.createElement(AnswerCard, { t, record: {
    ...record, questions: [{ ...question, multiSelect: false }], answers: [{ id: question.id, selected: ['面条'] }],
  } }));
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.ok(html.includes('aria-checked="true" aria-label="面条" disabled=""'));
  assert.ok(html.includes('class="aq-number" aria-hidden="true">2</span>'));
});

test('skipped answers are visible while all offered choices remain unselected', () => {
  const html = renderToStaticMarkup(React.createElement(AnswerCard, { record: { ...record, answers: [{ id: 'q', selected: [] }] }, t }));
  assert.ok(html.includes('这道问题当时被跳过。'));
  assert.ok(!html.includes('data-selected="true"'));
});

test('titles and options remain plain text while details use the host renderer', () => {
  const question = {
    id: 'q', question: '**题目** <b>原文</b>', multiSelect: false,
    detail: '**详细说明**', options: [{ label: '**方案** (推荐)', description: '`代码` <b>说明</b>' }],
  };
  const html = renderToStaticMarkup(React.createElement(AnswerCard, {
    record: { callId: 'formatting', questions: [question], answers: [{ id: 'q', selected: [question.options[0].label] }] },
    t, renderDetail: text => React.createElement('strong', null, text),
  }));
  assert.ok(html.includes('**题目** &lt;b&gt;原文&lt;/b&gt;'));
  assert.ok(html.includes('**方案**'));
  assert.ok(html.includes('`代码` &lt;b&gt;说明&lt;/b&gt;'));
  assert.ok(html.includes('<strong>**详细说明**</strong>'));
  assert.ok(html.includes('aria-checked="true" aria-label="**方案**"'));
  assert.ok(html.includes('class="aq-recommendation">推荐</span>'));
  const titleId = html.match(/<h2 id="([^"]+)"/)[1];
  assert.ok(html.includes(`aria-labelledby="${titleId}"`), 'the question names the review region');
  const descriptionId = html.match(/<span id="([^"]+)" class="aq-description/)[1];
  assert.ok(html.includes(`aria-describedby="${descriptionId}"`), 'the answer keeps its accessible description');
});

test('long written answers retain full text in a disabled native textarea', () => {
  const answer = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行 **原文**`).join('\n');
  const html = renderToStaticMarkup(React.createElement(AnswerCard, {
    record: { ...record, answers: [{ id: 'q', selected: [], custom: answer }] }, t,
  }));
  assert.ok(html.includes(`<textarea class="aq-field-input" aria-label="自由填写" disabled="" rows="1">${answer}</textarea>`));
  assert.ok(html.includes(`aria-hidden="true">${answer}\n</div>`));
});

test('choice selection uses index even when labels repeat, and locks submitted buttons', () => {
  const html = renderToStaticMarkup(React.createElement(ChoiceOptions, {
    args: { title: '选一个', options: [{ kind: 'text', title: '相同' }, { kind: 'text', title: '相同' }] },
    selectedIndex: 1, answered: true, disabled: true, t,
  }));
  assert.equal((html.match(/data-selected="true"/g) ?? []).length, 1);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.ok(html.includes('aria-pressed="true" data-aq-pick="1"'));
});

test('untrusted media URL schemes are rejected', () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/private', 'data:text/html;base64,abc', '//example.com/a', undefined]) assert.equal(safeMediaUrl(value), undefined);
  assert.equal(safeMediaUrl('https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(safeMediaUrl('data:image/png;base64,YQ=='), 'data:image/png;base64,YQ==');
});
