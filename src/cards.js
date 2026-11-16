import React from 'react';
const h = React.createElement;

export function Check() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm3 8 3.2 3.2L13 4.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

export function questionText(record, t) {
  return record.questions.map(question => {
    const answer = record.answers.find(item => item.id === question.id);
    return [question.header, question.question, question.detail,
      ...question.options.map(option => `${answer?.selected.includes(option.label) ? '[x]' : '[ ]'} ${option.label}${option.description ? ` — ${option.description}` : ''}`),
      answer?.custom ? `${t('custom')}: ${answer.custom}` : null,
      !answer?.selected.length && !answer?.custom?.trim() ? t('skipped') : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export function AnswerCard({ record, t }) {
  const [copyState, setCopyState] = React.useState('idle');
  const timer = React.useRef();
  React.useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(questionText(record, t));
      setCopyState('copied');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopyState('idle'), 2000);
    } catch { setCopyState('error'); }
  }
  return h('section', { className: 'aq-card', 'data-aq-native': record.callId, 'aria-label': t('answered') },
    h('div', { className: 'aq-meta' }, h('span', null, t('answered')),
      h('button', { type: 'button', className: 'aq-copy', onClick: copy, 'aria-label': t('copy') }, t(copyState === 'copied' ? 'copied' : 'copy'))),
    ...record.questions.map(question => {
      const answer = record.answers.find(item => item.id === question.id);
      return h('div', { className: 'aq-question', key: question.id, 'data-aq-question': question.id },
        h('div', { className: 'aq-heading' },
          question.header && h('span', { className: 'aq-eyebrow' }, question.header),
          h('h3', null, question.question),
          question.detail && h('p', { className: 'aq-description' }, question.detail),
          question.header !== t(question.options.length === 0 ? 'custom' : question.multiSelect ? 'multiple' : 'single') &&
            h('span', { className: 'aq-mode' }, t(question.options.length === 0 ? 'custom' : question.multiSelect ? 'multiple' : 'single'))),
        h('ul', { className: 'aq-options', 'aria-label': question.question },
          ...question.options.map((option, index) => {
            const selected = answer?.selected.includes(option.label) === true;
            return h('li', { key: index, className: 'aq-option', 'data-selected': String(selected) },
              h(Indicator, { selected, multiple: question.multiSelect, index, t }),
              h('div', { className: 'aq-option-copy' }, h('span', { className: 'aq-label' }, option.label),
                option.description && h('p', { className: 'aq-description' }, option.description)),
              selected && h('span', { className: 'aq-selected-label' }, t('selected')));
          })),
        answer?.custom && h('div', { className: 'aq-custom' }, h('span', { className: 'aq-eyebrow' }, t('custom')), h('p', null, answer.custom)),
        !answer?.selected.length && !answer?.custom?.trim() && h('p', { className: 'aq-empty' }, t('skipped')));
    }),
    copyState === 'error' && h('p', { className: 'aq-notice', role: 'status' }, t('copyFailed')));
}

export function Indicator({ selected, multiple, index, t }) {
  return h('span', { className: `aq-indicator${multiple ? ' aq-checkbox' : ''}`, 'aria-label': t(selected ? 'selected' : 'unselected') }, selected ? h(Check) : multiple ? null : index + 1);
}

/** Media remains a passive preview; only an explicit choice button sends an answer. */
export function safeMediaUrl(value) {
  if (typeof value !== 'string') return undefined;
  if (/^https?:\/\//iu.test(value)) return value;
  if (/^data:(?:image\/(?:png|jpeg|gif|webp)|audio\/(?:mpeg|wav|ogg));base64,/iu.test(value)) return value;
  return undefined;
}

export function ChoiceOptions({ args, media = {}, selectedIndex, answered, disabled, onChoose, t }) {
  const options = args.options ?? [];
  return h('ul', { className: 'aq-options', 'aria-label': args.title || t('choose') },
    ...options.map((option, index) => {
      const label = option.title || option.label || `Option ${index + 1}`;
      const selected = answered && selectedIndex === index;
      const src = safeMediaUrl(media[index] ?? option.url ?? option.src ?? option.source);
      return h('li', { className: 'aq-option aq-choice-option', key: index, 'data-selected': String(selected) },
        h('button', { type: 'button', className: 'aq-pick', disabled, onClick: () => onChoose(index), 'aria-label': label, 'aria-pressed': selected, 'data-aq-pick': index },
          h(Indicator, { selected, multiple: false, index, t }),
          h('span', { className: 'aq-option-copy' }, h('span', { className: 'aq-label' }, label),
            option.description && h('span', { className: 'aq-description' }, option.description)),
          selected && h('span', { className: 'aq-selected-label' }, t('selected'))),
        option.kind === 'image' && src && h('a', { className: 'aq-media', href: src, target: '_blank', rel: 'noreferrer', 'aria-label': `${t('media')}: ${label}` }, h('img', { src, alt: label, loading: 'lazy' })),
        option.kind === 'audio' && src && h('audio', { className: 'aq-media', src, controls: true, preload: 'none', 'aria-label': label }));
    }),
    h('li', { className: 'aq-option', 'data-selected': String(answered && selectedIndex === null) },
      h('button', { type: 'button', className: 'aq-pick', disabled, onClick: () => onChoose(null), 'aria-label': args.noneLabel || t('none'), 'aria-pressed': answered && selectedIndex === null, 'data-aq-pick': 'none' },
        h(Indicator, { selected: answered && selectedIndex === null, index: options.length, t }),
        h('span', { className: 'aq-label' }, args.noneLabel || t('none')))));
}
