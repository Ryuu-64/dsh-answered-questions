import assert from 'node:assert/strict';
import path from 'node:path';

// Exercise the official composer and the saved card with the same submitted data.
export async function checkNativeParity({ page, run, report }) {
  const send = async mode => {
    const composer = page.locator('[contenteditable="true"]').last();
    await composer.fill(`AQ_TEST_${mode}`);
    await composer.press('Enter');
  };
  const sampleField = async field => field.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      tag: element.tagName, height: element.getBoundingClientRect().height,
      value: 'value' in element ? element.value : element.textContent,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      disabled: element.disabled === true,
      fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding,
      whiteSpace: style.whiteSpace, overflowY: style.overflowY,
    };
  });
  await send('formatting');
  const native = page.locator('[data-question-key]');
  await native.getByRole('radio', { name: '方案 **甲**', exact: true }).waitFor();
  const title = await native.locator('h2').innerText();
  assert.ok(title.includes('**加粗**'));
  assert.equal(await native.locator('h2 strong, h2 code, h2 b').count(), 0);
  const nativeDetailCount = await native.locator('strong').count();
  await native.getByRole('button', { name: '提交', exact: true }).click();
  const saved = page.locator('[data-aq-native="call_aq_formatting"]');
  await saved.waitFor();
  assert.equal(await saved.locator('h2').innerText(), title);
  assert.equal(await saved.locator('h2 strong, h2 code, h2 b').count(), 0);
  const savedDetailCount = await saved.locator('.aq-detail strong').count();
  assert.equal(await saved.getByRole('radio', { name: '方案 **甲**', checked: true, disabled: true }).count(), 1);
  assert.equal(await saved.locator('.aq-recommendation').innerText(), '推荐');
  assert.equal(await saved.locator('.aq-description').innerText(), '保留 `代码` 和 <b>原文</b>');
  assert.equal(await page.evaluate(() => window.aqInjected), undefined);
  await saved.screenshot({ path: path.join(run, 'formatting.png') });
  report.scenarios.push({ id: 'AQ-native-formatting', status: savedDetailCount === nativeDetailCount ? 'pass' : 'fail', nativeDetailCount, savedDetailCount, evidence: 'formatting.png' });

  const longAnswer = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行：保留换行和 **原样文字**。`).join('\n');
  for (const mode of ['longinline', 'longblock']) {
    await send(mode);
    const input = native.getByPlaceholder('输入你的答案', { exact: true });
    await input.fill(longAnswer);
    const before = await sampleField(input);
    await native.screenshot({ path: path.join(run, `${mode}-native.png`) });
    await native.getByRole('button', { name: '提交', exact: true }).click();
    const card = page.locator(`[data-aq-native="call_aq_${mode}"]`);
    await card.waitFor();
    const field = card.getByRole('textbox');
    const after = await sampleField(field);
    await card.screenshot({ path: path.join(run, `${mode}-saved.png`) });
    const differences = Object.keys(before).filter(key => key !== 'disabled' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    report.scenarios.push({ id: `AQ-native-${mode}`, status: differences.length || !after.disabled ? 'fail' : 'pass', before, after, differences, evidence: [`${mode}-native.png`, `${mode}-saved.png`] });
    await field.hover();
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, `[data-aq-native="call_aq_${mode}"] textarea`);
    await page.reload();
    await card.waitFor();
    assert.equal((await sampleField(card.getByRole('textbox'))).value, longAnswer, 'full answer survives reload');
  }
  await send('longdescription');
  await native.getByRole('checkbox', { name: '乙', exact: true }).click();
  await native.getByRole('button', { name: '提交', exact: true }).click();
  const described = page.locator('[data-aq-native="call_aq_longdescription"]');
  await described.waitFor();
  const description = described.locator('.aq-description');
  const collapsedHeight = await description.evaluate(element => element.clientHeight);
  const fullText = await description.textContent();
  await described.locator('.aq-description-toggle').click();
  assert.ok(await description.evaluate(element => element.clientHeight) > collapsedHeight, 'description expands without editing the answer');
  assert.equal(await description.textContent(), fullText);
  assert.equal(await described.getByRole('checkbox', { name: '乙', checked: true }).count(), 1);
  await described.locator('.aq-description-toggle').click();
  report.scenarios.push({ id: 'AQ-native-description', status: 'pass' });
  for (const [mode, role] of [['extensions', 'radio'], ['conflicting', 'checkbox']]) {
    await send(mode);
    await native.getByRole(role, { name: '甲', exact: true }).click();
    await native.getByRole('button', { name: '提交', exact: true }).click();
    const card = page.locator(`[data-aq-native="call_aq_${mode}"]`);
    await card.waitFor();
    assert.equal(await card.getByRole(role, { checked: true, disabled: true }).count(), 1);
    assert.equal(await card.locator('.aq-detail').count(), 0);
    report.scenarios.push({ id: `AQ-native-${mode}`, status: 'pass' });
  }
  await send('longheading');
  await native.getByRole('radio', { name: '继续', exact: true }).click();
  await native.getByRole('radio', { name: '确定', exact: true }).click();
  await native.getByRole('button', { name: '提交', exact: true }).click();
  const longCard = page.locator('[data-aq-native="call_aq_longheading"]');
  await longCard.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const body = longCard.locator('.aq-body');
  assert.ok(await body.evaluate(element => element.clientHeight > 100), 'long title leaves room for options on narrow screen');
  await longCard.getByRole('button', { name: /展开.*问题|展开.*题目|展开/ }).click();
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await body.evaluate(element => element.scrollTop > 0), 'expanded title is scrollable');
  await longCard.getByRole('button', { name: '下一题', exact: true }).click();
  await longCard.getByRole('radio', { name: '确定', checked: true }).waitFor();
  assert.equal(await body.evaluate(element => element.scrollTop), 0, 'next question starts at top');
  await longCard.getByRole('button', { name: '上一题', exact: true }).click();
  assert.equal(await longCard.locator('[aria-expanded="true"]').count(), 0, 'question returns to preview');
  await longCard.screenshot({ path: path.join(run, 'longheading-narrow.png') });
  report.scenarios.push({ id: 'AQ-native-longheading', status: 'pass', evidence: 'longheading-narrow.png' });
  assert.ok(report.scenarios.every(scenario => scenario.status === 'pass'), 'saved cards match official formatting and answer fields');
}
