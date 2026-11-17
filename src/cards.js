import React from 'react';
const h = React.createElement;

export function Check() {
  return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm3 8 3.2 3.2L13 4.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

export function QuestionHeader({ header, title, status }) {
  return h('header', { className: 'aq-heading' },
    (header !== undefined || title !== undefined) && h('div', { className: 'aq-heading-copy' },
      header !== undefined && h('div', { className: 'aq-eyebrow' }, header),
      title !== undefined && h('h2', { className: 'aq-title' }, title)),
    status && h('span', { className: 'aq-meta', role: 'status' }, status));
}

function Indicator({ multiple, selected, index }) {
  if (!multiple) return h('span', { className: 'aq-number', 'aria-hidden': true }, index + 1);
  return h('span', { className: 'aq-checkbox', 'data-checked': selected, 'aria-hidden': true }, selected && h(Check));
}

function OptionCopy({ label, description, recommendation, native = false, descriptionId }) {
  return h('span', { className: `aq-option-copy${native ? ' aq-native-copy' : ''}` },
    h('span', { className: 'aq-option-line' },
      h('span', { className: 'aq-label' }, label),
      recommendation && h('span', { className: 'aq-recommendation' }, recommendation),
      !native && description && h('span', { className: 'aq-description' }, description)),
    native && description && h('span', { id: descriptionId, className: 'aq-description aq-description-preview' }, description));
}

const recommendedSuffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;

function CopyToggle({ expanded, targetId, className, onClick, t }) {
  const label = t(expanded ? 'collapseText' : 'expandText');
  return h('button', {
    type: 'button', className: `aq-icon-button aq-copy-toggle ${className}`,
    title: label, 'aria-label': label, 'aria-expanded': expanded,
    'aria-controls': targetId, 'aria-describedby': targetId, onClick,
  }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, fill: 'none' },
    h('path', { d: expanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' })));
}

function ReviewOption({ option, index, selected, multiple, expanded, descriptionId, onToggle, t }) {
  const label = option.label.replace(recommendedSuffix, '');
  const hasDescription = option.description !== undefined && option.description.trim() !== '';
  return h('div', {
    className: `aq-option-row${selected && !multiple ? ' aq-option-row-selected' : ''}`,
    'data-expanded': expanded || undefined,
  }, h('button', {
    type: 'button', className: 'aq-option', 'data-selected': selected, 'data-multiple': multiple,
    role: multiple ? 'checkbox' : 'radio', 'aria-checked': selected, 'aria-label': label, disabled: true,
    'aria-describedby': hasDescription ? descriptionId : undefined,
  }, h(Indicator, { multiple, selected, index }),
  h(OptionCopy, { label, native: true, description: hasDescription ? option.description : undefined, descriptionId,
    recommendation: label !== option.label && t('recommended') })),
  hasDescription && h(CopyToggle, { expanded, targetId: descriptionId, className: 'aq-description-toggle', onClick: onToggle, t }));
}

function AnswerField({ answer, multiple, hasOptions, t }) {
  const field = h('div', {
    className: `aq-custom aq-field ${hasOptions ? 'aq-custom-inline' : 'aq-custom-block'}`,
  }, h('div', { className: 'aq-field-mirror', 'aria-hidden': true }, `${answer}\n`),
  h('textarea', { className: 'aq-field-input', 'aria-label': t('custom'), value: answer, disabled: true, rows: 1 }));
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
  const [expandedCopy, setExpandedCopy] = React.useState({ index: 0, copies: new Set() });
  const answerSurface = React.useRef(null);
  const idPrefix = React.useId();
  const index = Math.min(pageIndex, record.questions.length - 1);
  const expanded = expandedCopy.index === index ? expandedCopy.copies : new Set();
  const question = record.questions[index];
  const answer = record.answers.find(item => item.id === question.id);
  const hasOptions = question.options.length > 0;
  const skipped = !answer?.selected.length && !answer?.custom;
  const titleId = `${idPrefix}-question-${index}`;
  const toggleCopy = key => setExpandedCopy(current => {
    const copies = new Set(current.index === index ? current.copies : []);
    if (copies.has(key)) copies.delete(key); else copies.add(key);
    return { index, copies };
  });
  const changePage = nextIndex => {
    if (answerSurface.current) answerSurface.current.scrollTop = 0;
    setExpandedCopy({ index: nextIndex, copies: new Set() });
    setPageIndex(nextIndex);
  };
  return h('section', { className: 'aq-card', 'data-aq-native': record.callId, 'aria-labelledby': titleId },
    h(QuestionHeader, { header: question.header, status: t('answered') }),
    h('div', { className: 'aq-body', 'data-aq-question': question.id, ref: answerSurface },
      h('div', { className: 'aq-question-title', 'data-expanded': expanded.has('question') || undefined },
        h('h2', { id: titleId, className: 'aq-title aq-title-preview' }, question.question),
        h(CopyToggle, { expanded: expanded.has('question'), targetId: titleId,
          className: 'aq-question-toggle', onClick: () => toggleCopy('question'), t })),
      question.detail && h('div', { className: 'aq-detail' }, renderDetail?.(question.detail) ?? question.detail),
      h('div', { className: 'aq-options', role: question.multiSelect ? 'group' : 'radiogroup', 'aria-label': question.question },
        ...question.options.map((option, position) => h(ReviewOption, {
          key: position, option, index: position, multiple: question.multiSelect,
          selected: answer?.selected.includes(option.label) === true,
          expanded: expanded.has(position), descriptionId: `${titleId}-option-${position}-description`,
          onToggle: () => toggleCopy(position), t,
        })),
        skipped && h('p', { className: 'aq-review-note' }, t('skipped')),
        answer?.custom && h(AnswerField, { answer: answer.custom, multiple: question.multiSelect, hasOptions, t }))),
    h(Pager, { index, count: record.questions.length, setIndex: changePage, t }));
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
