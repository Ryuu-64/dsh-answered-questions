import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Context, Service } from '@deepseek-ai/cordis';
import { mountChoiceService } from '../lib/choice-service.js';

test('choice service registration survives activation and follows dependency teardown and reload', async t => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  let registered = 0;
  class ChoiceEndpoint extends Service {
    static inject = ['choiceFixtureDependency'];
    constructor(scope) {
      super(scope, 'choiceFixtureEndpoint');
      scope.effect(() => { registered++; return () => { registered--; }; });
    }
    get() { return 'available'; }
  }
  const provide = scope => { scope.provide('choiceFixtureDependency', {}); };
  const binding = mountChoiceService(ctx, ChoiceEndpoint);
  assert.equal(registered, 0);
  const dependency = ctx.plugin(provide);
  await dependency.await();
  await binding.await();
  await setImmediate();
  assert.equal(registered, 1, 'strict endpoint registration remains active after startup settles');
  assert.equal(ctx.choiceFixtureEndpoint.get(), 'available');
  await dependency.dispose();
  assert.equal(registered, 0);
  assert.equal(ctx.get('choiceFixtureEndpoint'), undefined);
  const replacement = ctx.plugin(provide);
  await replacement.await();
  await binding.await();
  assert.equal(registered, 1);
  assert.equal(ctx.choiceFixtureEndpoint.get(), 'available');
  await binding.dispose();
  assert.equal(registered, 0);
  assert.equal(ctx.get('choiceFixtureEndpoint'), undefined);
});
