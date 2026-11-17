// Deterministic local model for real DSH UI acceptance. No external model calls.
import http from 'node:http';

export const scenarios = {
  single: { name: 'ask_user_question', arguments: { questions: [{ id: 'role', header: '单选', question: '你希望先体验哪个角色？', multi_select: false, options: [
    { label: '产品经理', description: '做方案、开会、推进项目。' },
    { label: '设计师', description: '设计页面和交互。' },
    { label: '工程师', description: '开发和维护功能。' },
  ] }] } },
  multi: { name: 'ask_user_question', arguments: { questions: [{ id: 'fruit', header: '多选', question: '这次想带哪些水果？', multi_select: true, options: [
    { label: '西瓜', description: '夏日解渴的瓜果。' },
    { label: '芒果', description: '热带香甜的水果。' },
    { label: '苹果', description: '适合随身携带。' },
  ] }] } },
  free: { name: 'ask_user_question', arguments: { questions: [{ id: 'note', header: '自由填写', question: '还有什么想补充的？', multi_select: false, options: [
    { label: '没有补充', description: '直接继续。' },
    { label: '稍后再说', description: '保留这个问题。' },
  ] }] } },
  skip: { name: 'ask_user_question', arguments: { questions: [{ id: 'skip', header: '跳过', question: '今天需要安排提醒吗？', multi_select: false, options: [
    { label: '上午', description: '在上午安排。' }, { label: '下午', description: '在下午安排。' },
  ] }] } },
  batch: { name: 'ask_user_question', arguments: { questions: [
    { id: 'meal', question: '午餐吃什么？', multi_select: false, options: [{ label: '米饭' }, { label: '面条' }] },
    { id: 'drink', question: '喝点什么？', multi_select: false, options: [{ label: '白水' }, { label: '绿茶' }] },
  ] } },
  choice: { name: 'ask_user_choice', arguments: { title: '你要从哪条路进城？', subtitle: '选择一条路线继续。', options: [
    { id: 'gate', kind: 'text', title: '走正门', description: '路最短，但要经过守卫盘查。', value: 'gate' },
    { id: 'river', kind: 'text', title: '绕到河边', description: '沿河找一条隐蔽的小路。', value: 'river' },
    { id: 'alley', kind: 'text', title: '穿过旧巷', description: '可以避开守卫，但巷子很暗。', value: 'alley' },
  ], noneLabel: '再想想' } },
};

export function startFixtureModel(port = 45271) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture', object: 'model' }] }));
      return;
    }
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const input = JSON.parse(Buffer.concat(chunks));
      const messages = input.messages ?? [];
      const userIndex = messages.findLastIndex(message => message.role === 'user' && /AQ_TEST_(single|multi|free|skip|batch|choice)/.test(JSON.stringify(message.content)));
      const text = JSON.stringify(messages[userIndex]?.content) ?? '';
      const mode = /AQ_TEST_(single|multi|free|skip|batch|choice)/.exec(text)?.[1];
      const scenario = scenarios[mode];
      const asked = messages.slice(userIndex + 1).some(message => message.tool_calls?.some(call => call.function?.name === scenario?.name));
      const available = input.tools?.some(tool => tool.function?.name === scenario?.name);
      const payload = scenario && available && !asked
        ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_aq_${mode}`, type: 'function', function: { name: scenario.name, arguments: JSON.stringify(scenario.arguments) } }] }
        : { role: 'assistant', content: '已收到你的回答。' };
      const finish = payload.tool_calls ? 'tool_calls' : 'stop';
      requests.push({ mode, available: Boolean(available), asked, finish, keys: Object.keys(input), tools: input.tools?.map(tool => tool.function?.name), functions: input.functions?.map(tool => tool.name) });
      const base = { id: 'chatcmpl-aq-fixture', model: input.model, created: Math.floor(Date.now() / 1000) };
      if (!input.stream) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: payload, finish_reason: finish }] }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const [delta, reason] of [[payload, null], [{}, finish]]) res.write('data: ' + JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: reason }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      }
    } catch { res.writeHead(500).end('Fixture request could not be parsed'); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, requests })));
}
