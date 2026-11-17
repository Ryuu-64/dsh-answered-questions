import React from 'react';
const h = React.createElement;

export function Check() {
  return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', 'aria-hidden': true },
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
  const copyLabel = t(copyState === 'copied' ? 'copied' : 'copy');
  return h('section', { className: 'aq-card', 'data-aq-native': record.callId, 'aria-label': t('answered') },
    h('div', { className: 'aq-bubble' },
      h('div', { className: 'aq-meta' }, h('span', null, t('answered')),
        h('button', { type: 'button', className: 'aq-copy', onClick: copy, 'aria-label': copyLabel, title: copyLabel },
          copyState === 'copied' ? h(Check) : h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
            h('path', { d: 'M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2M3 5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', stroke: 'currentColor', strokeWidth: 1.2 })))),
      h('div', { className: 'aq-details' }, record.questions.map(question => {
        const answer = record.answers.find(item => item.id === question.id);
        return h('div', { className: 'aq-question', key: question.id, 'data-aq-question': question.id },
          h('div', { className: 'aq-heading' },
            question.header && question.header !== question.question && h('span', { className: 'aq-eyebrow' }, question.header),
            h('h3', null, question.question),
            question.detail && h('p', { className: 'aq-description' }, question.detail)),
          question.options.length > 0 && h('ul', { className: 'aq-options', 'aria-label': question.question },
            ...question.options.map((option, index) => {
              const selected = answer?.selected.includes(option.label) === true;
              return h('li', { key: index, className: 'aq-option', 'data-selected': String(selected) },
                h(Indicator, { selected, t }),
                h(OptionCopy, { label: option.label, description: option.description }));
            })),
        answer?.custom && h('p', { className: 'aq-custom' }, h('span', { className: 'aq-answer-label' }, t('custom')), answer.custom),
        !answer?.selected.length && !answer?.custom?.trim() && h('p', { className: 'aq-empty' }, t('skipped')));
      })),
      copyState === 'error' && h('p', { className: 'aq-notice', role: 'status' }, t('copyFailed'))));
}

function Indicator({ selected, t }) {
  return h('span', { className: 'aq-indicator' },
    h('span', { className: 'aq-visually-hidden' }, t(selected ? 'selected' : 'unselected')),
    selected ? h(Check) : h('span', { 'aria-hidden': true }, '•'));
}

function OptionCopy({ label, description }) {
  return h('span', { className: 'aq-option-copy' }, h('span', { className: 'aq-label' }, label),
    description && h('span', { className: 'aq-description' }, ' — ', description));
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
          h(Indicator, { selected, t }), h(OptionCopy, { label, description: option.description })),
        option.kind === 'image' && src && h('a', { className: 'aq-media', href: src, target: '_blank', rel: 'noreferrer', 'aria-label': `${t('media')}: ${label}` }, h('img', { src, alt: label, loading: 'lazy' })),
        option.kind === 'audio' && src && h('audio', { className: 'aq-media', src, controls: true, preload: 'none', 'aria-label': label }));
    }),
    h('li', { className: 'aq-option', 'data-selected': String(answered && selectedIndex === null) },
      h('button', { type: 'button', className: 'aq-pick', disabled, onClick: () => onChoose(null), 'aria-label': args.noneLabel || t('none'), 'aria-pressed': answered && selectedIndex === null, 'data-aq-pick': 'none' },
        h(Indicator, { selected: answered && selectedIndex === null, t }),
        h('span', { className: 'aq-label' }, args.noneLabel || t('none')))));
}
