import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { CHOICE_SERVICE, choiceRemote } from './choice-protocol.js';
import { assertChoiceOperator, createChoiceService, mountChoiceService } from './choice-service.js';

const initializers = [];
export class ChoiceRemote extends TypertRemoteService {
  static inject = ['typert', 'connection', 'agents', 'sessionQuery', 'sessionProjections', 'workspaceRegistry'];
  constructor(ctx) {
    super(ctx, CHOICE_SERVICE);
    this.choices = createChoiceService(ctx, createUserMessage);
    for (const initialize of initializers) initialize.call(this);
    ctx.typert.register({
      package: choiceRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: choiceRemote.descriptors,
    });
  }
  async get(request) {
    assertChoiceOperator(this.ctx);
    return this.choices.get(request, this.ctx.invocation.signal);
  }
  async choose(agent, request) {
    assertChoiceOperator(this.ctx);
    return this.choices.choose(agent, request, this.ctx.invocation.signal);
  }
}
for (const method of ['get', 'choose']) Remote(ChoiceRemote.prototype[method], {
  kind: 'method', name: method, static: false, private: false,
  addInitializer: initialize => initializers.push(initialize),
});

export function applyChoiceHost(ctx) {
  mountChoiceService(ctx, ChoiceRemote);
}
