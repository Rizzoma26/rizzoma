import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../registration.js', import.meta.url), 'utf8');

function runRegistration(fetch) {
  const events = [];
  const window = {
    RIZZOMA_CONFIG: {registrationApiBase: 'https://app.example'},
    Telegram: {WebApp: {
      initData: 'signed-init-data',
      initDataUnsafe: {start_param: 'ref_abc123', user: {id: 42}}
    }},
    dispatchEvent(event) { events.push(event); }
  };
  class TestCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  vm.runInNewContext(source, {
    window,
    URL,
    location: {href: 'https://app.example/app.html'},
    fetch,
    CustomEvent: TestCustomEvent,
    console
  });
  return {registration: window.RIZZOMA_REGISTRATION, events};
}

test('reuses the bootstrap session instead of creating a second session', async () => {
  const calls = [];
  const {registration, events} = runRegistration(async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/api/v1/session')) return {status: 204};
    if (url.endsWith('/api/v1/me')) return {
      ok: true,
      json: async () => ({userId: 'user-uuid', telegramUserId: '42'})
    };
    throw new Error('unexpected registration request');
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await registration)), {
    user: {id: 'user-uuid', telegramUserId: '42'}, registration: null
  });
  assert.deepEqual(calls.map(call => call.url), [
    'https://app.example/api/v1/session',
    'https://app.example/api/v1/me'
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'rizzoma:registered');
});

test('registers once when there is no existing session', async () => {
  const calls = [];
  const {registration} = runRegistration(async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/api/v1/session')) return {status: 401};
    if (url.endsWith('/api/v1/registrations/telegram')) return {
      ok: true,
      json: async () => ({user: {id: 'user-uuid'}, registration: {created: true}})
    };
    throw new Error('unexpected request');
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await registration)), {
    user: {id: 'user-uuid'}, registration: {created: true}
  });
  const posts = calls.filter(call => call.url.endsWith('/api/v1/registrations/telegram'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    initData: 'signed-init-data', referralCode: 'ABC123'
  });
});

test('does not reuse a session that belongs to another Telegram account', async () => {
  const calls = [];
  const {registration} = runRegistration(async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/api/v1/session')) return {status: 204};
    if (url.endsWith('/api/v1/me')) return {
      ok: true,
      json: async () => ({userId: 'other-user', telegramUserId: '41'})
    };
    if (url.endsWith('/api/v1/registrations/telegram')) return {
      ok: true,
      json: async () => ({user: {id: 'current-user'}, registration: {created: false}})
    };
    throw new Error('unexpected request');
  });

  assert.equal(JSON.parse(JSON.stringify(await registration)).user.id, 'current-user');
  assert.equal(calls.filter(call => call.url.endsWith('/api/v1/registrations/telegram')).length, 1);
});
