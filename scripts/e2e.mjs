// Real official DSH Web, real input, isolated profile and deterministic loopback model.
// Usage: node scripts/e2e.mjs --runtime <directory containing node_modules> --playwright <playwright/index.mjs>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFixtureModel } from './fixture-model.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, input) => index % 2 ? all : [...all, [value.replace(/^--/, ''), input[index + 1]]], []));
assert.ok(args.runtime && args.playwright, '--runtime and --playwright are required');
const runtime = path.resolve(args.runtime);
const { chromium } = await import(pathToFileURL(path.resolve(args.playwright)));
const version = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))).version;
await fs.mkdir(path.join(root, '.qa'), { recursive: true });
const run = await fs.mkdtemp(path.join(root, '.qa', `${version}-`));
const home = path.join(run, 'home');
const workspace = path.join(run, 'workspace');
const profile = path.join(home, 'profiles/web');
const modelPort = Number(args['base-port'] ?? 45271), webPort = modelPort + 1, bridgePort = modelPort + 2;
assert.ok(Number.isInteger(modelPort) && modelPort >= 1024 && bridgePort <= 65535, 'valid --base-port');
for (const directory of [profile, workspace, path.join(profile, 'node_modules/@ryuu-64'), path.join(profile, 'node_modules/@machine202502')]) await fs.mkdir(directory, { recursive: true });
const installed = path.join(profile, 'node_modules/@ryuu-64/dsh-answered-questions');
await fs.mkdir(installed, { recursive: true });
for (const name of ['lib', 'locale', 'package.json', 'cordis.patch.yml']) await fs.cp(path.join(root, name), path.join(installed, name), { recursive: true });
await fs.symlink(path.join(runtime, 'node_modules/@deepseek-ai'), path.join(profile, 'node_modules/@deepseek-ai'), 'junction');
await fs.symlink(path.resolve(args.choice ?? path.join(runtime, 'node_modules/@machine202502/dsh-choice')), path.join(profile, 'node_modules/@machine202502/dsh-choice'), 'junction');
await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'aq-isolated-web', private: true, dependencies: { '@ryuu-64/dsh-answered-questions': 'file:' + root, '@machine202502/dsh-choice': '0.1.2' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@machine202502/dsh-choice', '@ryuu-64/dsh-answered-questions'] } } }));
await fs.writeFile(path.join(profile, 'cordis.yml'), '[]\n');
await fs.writeFile(path.join(profile, 'cordis.patch.yml'), `- id: llm-pi-ai\n  config:\n    providers:\n      aq-fixture:\n        api: openai-completions\n        apiKeyEnv: DSH_AQ_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${modelPort}/v1\n        models:\n          - id: fixture\n- id: agent-default-model\n  config:\n    provider: aq-fixture\n    model: fixture\n- id: locale\n  config:\n    preference: zh\n- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 2026-09-28.1\n- id: choice\n  config:\n    bridgePort: ${bridgePort}\n`);
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('DSH_') || /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) delete env[key];
Object.assign(env, { DSH_HOME: home, DSH_AGENTS_HOME: path.join(run, 'agents'), LOCALAPPDATA: path.join(run, 'appdata'), DSH_TELEMETRY_DISABLED: '1', DSH_AQ_FIXTURE_KEY: 'local-fixture-only' });
const model = await startFixtureModel(modelPort);
let logs = '';
function startDsh() {
  const child = spawn(process.execPath, [path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', String(webPort)], { cwd: workspace, env, windowsHide: true });
  child.stdout.on('data', data => logs += data);
  child.stderr.on('data', data => logs += data);
  return child;
}
let server = startDsh();
const report = { version, node: process.version, run: path.relative(root, run), pluginSha256: createHash('sha256').update(await fs.readFile(path.join(installed, 'lib/client.js'))).digest('hex'), origin: `http://127.0.0.1:${webPort}`, authorization: 'repair-authorized', isolation: 'ephemeral Playwright context and empty DSH profile', viewports: [{ width: 1280, height: 900 }], capabilities: { input: 'supported', screenshot: 'supported', dom: 'supported', console: 'supported', network: 'supported', accessibility: 'unknown', trace: 'unsupported', performance: 'unknown' }, scenarios: [], errors: [] };
report.hostFiles = {};
for (const file of (await fs.readdir(path.join(installed, 'lib'))).filter(name => name.endsWith('.js') && name !== 'client.js')) report.hostFiles[file] = createHash('sha256').update(await fs.readFile(path.join(installed, 'lib', file))).digest('hex');
let browser, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => String(value).replace(/([?&]token=)[^\s&]+/g, '$1[redacted]').replace(/(Bearer\s+)[^\s]+/g, '$1[redacted]');
try {
  let url;
  for (let i = 0; i < 120; i++) {
    url = logs.match(new RegExp(`http://127\\.0\\.0\\.1:${webPort}/\\?token=[^\\s]+`))?.[0];
    if (url) break;
    if (server.exitCode !== null) throw new Error(`DSH exited (${server.exitCode})`);
    await sleep(500);
  }
  assert.ok(url, 'DSH local startup URL');
  browser = await chromium.launch({ headless: true, executablePath: args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', env });
  const context = await browser.newContext({ viewport: report.viewports[0], locale: 'zh-CN', colorScheme: 'dark' });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('response', async response => {
    if (!response.url().startsWith(report.origin)) return;
    const pathname = new URL(response.url()).pathname;
    if (!['GET', 'HEAD'].includes(response.request().method())) (report.rpc ??= []).push({ path: pathname, status: response.status(), type: response.headers()['content-type'] });
    if (!response.headers()['content-type']?.includes('json')) return;
    const body = await response.text().catch(() => '');
    if (response.status() >= 400 || /"ok"\s*:\s*false|"error"\s*:/.test(body)) {
      report.errors.push({ path: new URL(response.url()).pathname, status: response.status(), body: redact(body).slice(0,1800) });
    }
  });
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const text = String(payload);
    if (/gateway\/|"error"\s*:|"errorCode"\s*:/.test(text)) report.errors.push(redact(text).slice(0,1800));
  }));
  await page.goto(url);
  await page.waitForTimeout(1500);
  for (const name of ['继续', 'Continue', '稍后配置', 'Configure later', '关闭', 'Close']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 1 && await button.isVisible()) await button.click();
  }
  await fs.writeFile(path.join(run, 'initial.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: path.join(run, 'initial.png') });
  if (args.mode === 'inspect') {
    console.log(JSON.stringify({ run: report.run, version, body: (await page.locator('body').innerText()).slice(-1800) }));
  } else {
    const send = async mode => {
      const composer = page.locator('[contenteditable="true"]').last();
      await composer.fill(`AQ_TEST_${mode}`);
      await composer.press('Enter');
    };
    const checkNative = async (mode, selected, custom) => {
      const card = page.locator(`[data-aq-native="call_aq_${mode}"]`);
      await card.waitFor({ timeout: 30000 });
      assert.equal(await card.count(), 1, 'one full card per answer');
      const expectedOptions = { single: 3, multi: 3, free: 2, skip: 2 }[mode];
      assert.equal(await card.locator('.aq-option').count(), expectedOptions, 'all original options stay visible');
      assert.equal(await card.locator('.aq-option[data-selected="true"]').count(), selected);
      if (custom) assert.ok((await card.innerText()).includes(custom));
      const before = await card.innerText();
      await page.reload();
      await card.waitFor();
      assert.equal(await card.innerText(), before);
      await card.screenshot({ path: path.join(run, `${mode}.png`) });
      report.scenarios.push({ id: `AQ-${mode}`, status: 'pass', allOptions: expectedOptions, selected, custom: Boolean(custom), refresh: true, evidence: `${mode}.png` });
    };
    if (args.mode !== 'choice') {
    await send('single');
    await page.getByRole('radio', { name: '产品经理', exact: true }).click();
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await checkNative('single', 1);
    await send('multi');
    await page.getByRole('checkbox', { name: '西瓜', exact: true }).click();
    await page.getByRole('checkbox', { name: '芒果', exact: true }).click();
    await page.getByPlaceholder('输入你的答案', { exact: true }).fill('再带一点草莓');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await checkNative('multi', 2, '再带一点草莓');
    await send('free');
    await page.getByPlaceholder('输入你的答案', { exact: true }).fill('只填写这段自定义回答');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await checkNative('free', 0, '只填写这段自定义回答');
    await send('skip');
    await page.getByRole('button', { name: '跳过', exact: true }).click();
    await checkNative('skip', 0);
    }
    await send('choice');
    const choice = page.locator('[data-aq-choice="call_aq_choice"]');
    await choice.waitFor();
    await choice.locator('[data-aq-pick="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-aq-choice="call_aq_choice"] .aq-option[data-selected="true"]'));
    await page.reload();
    await choice.waitFor();
    assert.equal(await choice.locator('.aq-option[data-selected="true"]').count(), 1);
    assert.equal(await choice.locator('.aq-option').count(), 4, 'three offered options and none choice remain');
    assert.equal(await choice.locator('[data-aq-pick]:not([disabled])').count(), 0, 'submitted card cannot be answered twice');
    await choice.screenshot({ path: path.join(run, 'choice.png') });
    report.scenarios.push({ id: 'AQ-choice', status: 'pass', refresh: true, evidence: 'choice.png' });
    if (args.restart === 'true') {
      await choice.getByText('已回答', { exact: true }).waitFor();
      const previousLogs = logs.length;
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await exited;
      server = startDsh();
      let freshUrl;
      for (let i = 0; i < 120; i++) {
        freshUrl = logs.slice(previousLogs).match(new RegExp(`http://127\\.0\\.0\\.1:${webPort}/\\?token=[^\\s]+`))?.[0];
        if (freshUrl) break;
        if (server.exitCode !== null) throw new Error('DSH exited during restart');
        await sleep(500);
      }
      assert.ok(freshUrl, 'restarted DSH provides local startup URL');
      const previousUrl = new URL(page.url());
      previousUrl.searchParams.delete('token');
      const conversationPath = previousUrl.pathname + previousUrl.search + previousUrl.hash;
      await page.goto(freshUrl);
      if (conversationPath !== '/') await page.goto(report.origin + conversationPath);
      await choice.waitFor();
      await choice.getByText('已回答', { exact: true }).waitFor();
      assert.equal(await choice.locator('.aq-option[data-selected="true"]').count(), 1);
      assert.equal(await choice.locator('[data-aq-pick]:not([disabled])').count(), 0);
      report.scenarios.push({ id: 'AQ-host-restart', status: 'pass', assertion: 'saved choice restored after terminating and restarting isolated DSH host' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    report.viewports.push({ width: 390, height: 844 });
    await choice.scrollIntoViewIfNeeded();
    const bounds = await choice.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'choice fits narrow viewport');
    await page.screenshot({ path: path.join(run, 'narrow.png') });
    report.scenarios.push({ id: 'AQ-narrow', status: 'pass', evidence: 'narrow.png' });
    const darkBackground = await choice.evaluate(element => getComputedStyle(element).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(200);
    const lightBackground = await choice.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(lightBackground, darkBackground, 'card follows native light/dark theme');
    await page.screenshot({ path: path.join(run, 'light.png') });
    report.scenarios.push({ id: 'AQ-light', status: 'pass', evidence: 'light.png', darkBackground, lightBackground });
  }
} catch (error) {
  report.failure = redact(error.stack);
  if (page) {
    await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(run, 'failure.txt'), await page.locator('body').innerText()).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(run, 'server.log'), redact(logs));
  await fs.writeFile(path.join(run, 'report.json'), JSON.stringify({ ...report, modelRequests: model.requests }, null, 2));
  await browser?.close();
  server.kill();
  model.server.close();
  console.log(JSON.stringify({ run: report.run, version, scenarios: report.scenarios, failure: report.failure }));
}
