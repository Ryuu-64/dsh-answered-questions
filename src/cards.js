import React from 'react';
const h = React.createElement;

export function Check() {
  return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm3 8 3.2 3.2L13 4.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

export function QuestionHeader({ header, title, status }) {
  return h('header', { className: 'aq-heading' },
    h('div', { className: 'aq-heading-copy' },
      header && h('div', { className: 'aq-eyebrow' }, header),
      h('h2', { className: 'aq-title' }, title)),
    status && h('span', { className: 'aq-meta', role: 'status' }, status));
}

function Indicator({ multiple, selected, index }) {
  if (!multiple) return h('span', { className: 'aq-number', 'aria-hidden': true }, index + 1);
  return h('span', { className: 'aq-checkbox', 'data-checked': selected, 'aria-hidden': true }, selected && h(Check));
}

function OptionCopy({ label, description, recommendation }) {
  return h('span', { className: 'aq-option-copy' },
    h('span', { className: 'aq-option-line' },
      h('span', { className: 'aq-label' }, label),
      recommendation && h('span', { className: 'aq-recommendation' }, recommendation),
      description && h('span', { className: 'aq-description' }, description)));
}

const recommendedSuffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;

function ReviewOption({ option, index, selected, multiple, t }) {
  const label = option.label.replace(recommendedSuffix, '');
  return h('button', {
    type: 'button', className: 'aq-option', 'data-selected': selected, 'data-multiple': multiple,
    role: multiple ? 'checkbox' : 'radio', 'aria-checked': selected, 'aria-label': label, disabled: true,
  }, h(Indicator, { multiple, selected, index }),
  h(OptionCopy, { label, description: option.description, recommendation: label !== option.label && t('recommended') }));
}

function AnswerField({ answer, multiple, hasOptions, t }) {
  const field = h('div', {
    className: hasOptions ? 'aq-custom' : 'aq-custom aq-custom-block',
    'aria-label': t('custom'), role: 'textbox', 'aria-readonly': true,
  }, answer);
  if (!hasOptions) return field;
  return h('div', { className: 'aq-custom-row' },
    multiple ? h(Indicator, { multiple, selected: true })
      : h('span', { className: 'aq-number', 'aria-hidden': true },
        h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none' },
          h('path', { d: 'm3 10 7-7 3 3-7 7H3v-3Zm5-5 3 3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }))),
    field);
}

function Pager({ index, count, setIndex, t }) {
  const step = (delta, label, disabled) => h('button', {
    className: 'aq-icon-button', type: 'button', 'aria-label': t(label), disabled,
    onClick: () => setIndex(index + delta),
  }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, fill: 'none' },
    h('path', { d: delta < 0 ? 'm10 4-4 4 4 4' : 'm6 4 4 4-4 4', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' })));
  return h('footer', { className: 'aq-footer' }, h('div', { className: 'aq-pager' },
    step(-1, 'previous', index === 0),
    h('span', { className: 'aq-progress', 'aria-live': 'polite' }, `${index + 1} / ${count}`),
    step(1, 'next', index === count - 1)));
}

export function AnswerCard({ record, t, renderDetail }) {
  const [pageIndex, setPageIndex] = React.useState(0);
  const index = Math.min(pageIndex, record.questions.length - 1);
  const question = record.questions[index];
  const answer = record.answers.find(item => item.id === question.id);
  const hasOptions = question.options.length > 0;
  const skipped = !answer?.selected.length && !answer?.custom;
  return h('section', { className: 'aq-card', 'data-aq-native': record.callId, 'aria-label': t('answered') },
    h(QuestionHeader, { header: question.header, title: question.question, status: t('answered') }),
    h('div', { className: 'aq-body', 'data-aq-question': question.id },
      question.detail && h('div', { className: 'aq-detail' }, renderDetail?.(question.detail) ?? question.detail),
      h('div', { className: 'aq-options', role: question.multiSelect ? 'group' : 'radiogroup', 'aria-label': question.question },
        ...question.options.map((option, position) => h(ReviewOption, {
          key: position, option, index: position, multiple: question.multiSelect,
          selected: answer?.selected.includes(option.label) === true, t,
        })),
        skipped && h('p', { className: 'aq-review-note' }, t('skipped')),
        answer?.custom && h(AnswerField, { answer: answer.custom, multiple: question.multiSelect, hasOptions, t }))),
    h(Pager, { index, count: record.questions.length, setIndex: setPageIndex, t }));
}

/** Media remains a passive preview; only an explicit choice button sends an answer. */
export function safeMediaUrl(value) {
  if (typeof value !== 'string') return undefined;
  if (/^https?:\/\//iu.test(value)) return value;
  if (/^data:(?:image\/(?:png|jpeg|gif|webp)|audio\/(?:mpeg|wav|ogg));base64,/iu.test(value)) return value;
  return undefined;
}

export function ChoiceOptions({ args, media = {}, selectedIndex, answered, disabled, onChoose, t }) {
  const options = [...(args.options ?? []), { title: args.noneLabel || t('none'), kind: 'text' }];
  return h('div', { className: 'aq-options', 'aria-label': args.title || t('choose') },
    ...options.map((option, index) => {
      const isNone = index === options.length - 1;
      const id = isNone ? null : index;
      const label = option.title || option.label || `Option ${index + 1}`;
      const selected = answered && selectedIndex === id;
      const src = safeMediaUrl(media[index] ?? option.url ?? option.src ?? option.source);
      return h('div', { className: 'aq-choice-option', key: index },
        h('button', { type: 'button', className: 'aq-option aq-pick', 'data-selected': selected, disabled,
          onClick: () => onChoose(id), 'aria-label': label, 'aria-pressed': selected, 'data-aq-pick': isNone ? 'none' : index },
        h(Indicator, { index }), h(OptionCopy, { label, description: option.description })),
        option.kind === 'image' && src && h('a', { className: 'aq-media', href: src, target: '_blank', rel: 'noreferrer', 'aria-label': `${t('media')}: ${label}` }, h('img', { src, alt: label, loading: 'lazy' })),
        option.kind === 'audio' && src && h('audio', { className: 'aq-media', src, controls: true, preload: 'none', 'aria-label': label }));
    }));
}
