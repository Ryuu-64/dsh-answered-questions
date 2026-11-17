import React from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { AnswerCard, ChoiceOptions, QuestionHeader } from './cards.js';
import { zh, en } from './strings.js';
import styles from './styles.css';
import { createLegacyDefinition, NATIVE_DEFINITION_KIND, parseNativeQuestions, parseNativeAnswers } from '../lib/native-questions.js';
import { choiceDefinition } from '../lib/choice-state.js';
import { choiceRemote, CHOICE_SERVICE, choiceSource } from '../lib/choice-protocol.js';
const h = React.createElement;
const NS = 'answeredQuestions';
const nativeNodeKind = 'ryuu-answered-question';
const nodeKey = (kind, id) => `${kind.length}:${kind}${id}`;

export const inject = ['slots', 'uiConversation', 'locale'];

function renderDetail(text, t) {
  return h(MarkdownText, { text, labels: {
    code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode'), toolbarLabels: {
      codeLabel: t('codeBlock'), wrapLabel: t('wrapCode'), unwrapLabel: t('unwrapCode'),
    } },
    footnotes: t('footnotes'),
  } });
}

function NativeView({ node, t }) {
  return h(AnswerCard, { record: node.data, t, renderDetail: text => renderDetail(text, t) });
}

/** Retain the stock reply when the earlier question is outside the loaded history. */
function StockReplyView(props) {
  const { node, t } = props;
  const data = node.data;
  const nodes = props.useChat(snapshot => snapshot.nodes);
  const source = nodes.source(nodeKey(NATIVE_DEFINITION_KIND, data.callId));
  const fullNode = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const questions = parseNativeQuestions(data.text, { source: 'service' });
  const answers = questions && parseNativeAnswers(data.text, questions);
  if (fullNode?.visibility === 'visible') return null;
  if (questions && answers) return h(NativeView, { node: { data: { ...data, questions, answers } }, t });
  return h('section', { className: 'aq-card', 'data-aq-native-fallback': data.callId, 'aria-label': t('answered') },
    h('div', { className: 'aq-body' }, data.questions?.length ? data.questions.map(question => {
        const answer = data.answers?.find(item => item.id === question.id);
        return h('div', { className: 'aq-question', key: question.id },
          h(QuestionHeader, { header: question.header, title: question.question, status: t('answered') }),
          h('p', { className: 'aq-review-note' }, [...(answer?.selected ?? []), answer?.custom].filter(Boolean).join(', ') || t('skipped')));
      }) : h('p', { className: 'aq-review-note' }, data.text)));
}

function ChoiceView({ node, sessionId, t, remoteSource, useProjection, useSession }) {
  const data = node.data;
  const inboxKey = useProjection('inbox', inbox => [...(inbox?.['next-step'] ?? []), ...(inbox?.['next-turn'] ?? [])]
    .filter(message => choiceSource(message.source)?.callId === data.callId)
    .map(message => message.id).join(','));
  const running = useSession(snapshot => snapshot.running);
  const api = React.useSyncExternalStore(remoteSource.subscribe, remoteSource.getSnapshot, remoteSource.getSnapshot);
  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [attempt, retry] = React.useReducer(value => value + 1, 0);
  const inFlight = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => {
    let active = true;
    if (!api || data.status !== 'ready') return () => { active = false; };
    setLoading(true);
    api.get({ sessionId, callId: data.callId }).then(value => {
      if (active) { setStatus(value); setError(previous => previous === 'checkFailed' || value.status === 'answered' || value.status === 'queued' ? null : previous); }
    })
      .catch(() => { if (active) setError('checkFailed'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, sessionId, data.callId, data.status, attempt, inboxKey, running]);
  const effective = data.status === 'answered' ? data : status;
  const answered = effective?.status === 'answered' || effective?.status === 'queued';
  const unavailable = data.status === 'failed' || effective?.status === 'unavailable';
  const canChoose = Boolean(api) && data.status === 'ready' && !loading && !busy && !answered && !unavailable && error !== 'checkFailed';
  async function choose(selectedIndex) {
    if (!canChoose || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await api.choose(sessionId, { callId: data.callId, selectedIndex });
      if (alive.current) setStatus(value);
    } catch { if (alive.current) { setError('failed'); retry(); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const stateLabel = answered ? effective.status === 'queued' ? 'queued' : 'answered'
    : unavailable || !api ? 'unavailable' : busy ? 'saving' : loading ? 'checking' : 'noRecord';
  return h('section', { className: 'aq-card', 'data-aq-choice': data.callId, 'aria-label': data.args?.title || t('choose') },
    h(QuestionHeader, { header: data.args?.subtitle, title: data.args?.title || t('choose'), status: t(stateLabel) }),
    h('div', { className: 'aq-body' },
      data.args && h(ChoiceOptions, { args: data.args, media: data.media, selectedIndex: effective?.selectedIndex, answered, disabled: !canChoose, onChoose: choose, t }),
      error && h('p', { className: 'aq-review-note', role: 'alert' }, t(error), ' ',
        h('button', { type: 'button', className: 'aq-retry', onClick: retry }, t('retry')))));
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'answered-questions: copy');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.dshAnsweredQuestions = '';
    style.textContent = styles;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'answered-questions: styles');
  const hasLateReply = ctx.uiConversation.events.entries().some(definition => definition.kind === 'user-question-reply');
  ctx.uiConversation.events.register(createLegacyDefinition({ nodeKind: nativeNodeKind, includeLateReplies: !hasLateReply }));
  ctx.uiConversation.events.register(choiceDefinition);
  let api = null;
  const listeners = new Set();
  const remoteSource = {
    getSnapshot: () => api,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  ctx.inject(['remote'], async scope => {
    await scope.remote.$mount(choiceRemote);
    scope.inject([`remote.${CHOICE_SERVICE}`], remoteScope => {
      remoteScope.effect(() => {
        const remote = remoteScope.remote[CHOICE_SERVICE];
        const unwrap = result => {
          if (result?.ok !== true) throw new Error('Choice request failed');
          return result.value;
        };
        api = {
          get: async request => unwrap(await remote.get(request)),
          choose: async (sessionId, request) => unwrap(await remote.choose(sessionId, request)),
        };
        for (const listener of listeners) listener();
        return () => { api = null; for (const listener of listeners) listener(); };
      });
    });
  });
  ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({ name: 'conversation.chat.node', key: nativeNodeKind, locale: NS }, NativeView);
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'question-reply', priority: -100, locale: NS }, StockReplyView);
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'aq-choice', locale: NS }, props => h(ChoiceView, { ...props, key: `${props.sessionId}:${props.node.data.callId}`, remoteSource }));
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'choice-board', priority: -100 }, () => null);
  });
}
