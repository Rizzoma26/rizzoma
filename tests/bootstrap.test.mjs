import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../docker/bootstrap.js', import.meta.url), 'utf8');

async function runBootstrap(fetch) {
  const location = {
    search: '?mode=admin',
    hash: '#tgWebAppData=synthetic',
    replaced: null,
    replace(value) { this.replaced = value; }
  };
  const status = {textContent: ''};
  const window = {Telegram: {WebApp: {
    initData: 'start_param=ref_ABC123&hash=synthetic',
    initDataUnsafe: {user: {id: 42}, start_param: 'ref_ABC123'}
  }}};
  vm.runInNewContext(source, {
    window,
    document: {getElementById: () => status},
    location,
    fetch,
    URLSearchParams,
    console
  });
  for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
  return {location, status};
}

test('bootstrap reuses a session for the current Telegram account', async () => {
  const calls = [];
  const {location} = await runBootstrap(async (url, options = {}) => {
    calls.push({url, options});
    if (url === '/api/v1/session') return {status: 204};
    if (url === '/api/v1/me') return {
      ok: true,
      json: async () => ({telegramUserId: '42'})
    };
    throw new Error('registration must not run');
  });

  assert.equal(location.replaced, '/app.html?mode=admin#tgWebAppData=synthetic');
  assert.deepEqual(calls.map(call => call.url), ['/api/v1/session', '/api/v1/me']);
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'));
});

test('bootstrap registers when an existing session belongs to another account', async () => {
  const calls = [];
  const {location} = await runBootstrap(async (url, options = {}) => {
    calls.push({url, options});
    if (url === '/api/v1/session') return {status: 204};
    if (url === '/api/v1/me') return {
      ok: true,
      json: async () => ({telegramUserId: '41'})
    };
    if (url === '/api/v1/registrations/telegram') return {ok: true};
    throw new Error('unexpected request');
  });

  const exchange = calls.find(call => call.url === '/api/v1/registrations/telegram');
  assert.equal(exchange.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(exchange.options.body), {
    initData: 'start_param=ref_ABC123&hash=synthetic', referralCode: 'ABC123'
  });
  assert.equal(location.replaced, '/app.html?mode=admin#tgWebAppData=synthetic');
});
