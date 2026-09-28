import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const entitiesSource = await readFile(new URL('../assets/js/data/entities.js', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../assets/js/data/client-state-repository.js', import.meta.url), 'utf8');

function createRepository({href = 'https://app.example/', initial = {}} = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = {localStorage, location: {href, pathname: new URL(href).pathname}};
  const context = {window, URL, Date, Math, Set, Map, Number, Array, Object, JSON};
  vm.runInNewContext(entitiesSource, context);
  vm.runInNewContext(repositorySource, context);
  const {ClientStateRepository} = window.RIZZOMA_CLIENT_STATE;
  const repository = new ClientStateRepository({
    entities: window.RIZZOMA_ENTITIES,
    localStorage,
    location: window.location,
    telegram: {cloud: () => null, startParam: () => ''}
  });
  return {repository, localStorage, values};
}

test('repeated referral capture preserves the same attribution and timestamp', () => {
  const {repository, values} = createRepository({href: 'https://app.example/?ref=abc123'});
  const database = repository.loadDatabase();
  repository.captureReferral(database, 1000);
  const first = values.get('rizzoma_attribution');
  repository.captureReferral(database, 2000);

  assert.equal(values.get('rizzoma_attribution'), first);
  assert.deepEqual(JSON.parse(first), {code: 'ABC123', ts: 1000});
  assert.equal(Object.keys(database.users).length, 1);
});

test('repeated skill claims do not duplicate or rewrite the compact cache', () => {
  const {repository, values} = createRepository();
  const database = repository.loadDatabase();
  repository.ensureUser(database, 'ABC123');
  repository.setMe('ABC123');

  assert.equal(repository.grantClaim(database, 3), true);
  const databaseSnapshot = values.get('rizzoma_mock_db');
  const compactSnapshot = values.get('rizzoma_claims');
  assert.equal(repository.grantClaim(database, 3), false);

  assert.equal(values.get('rizzoma_mock_db'), databaseSnapshot);
  assert.equal(values.get('rizzoma_claims'), compactSnapshot);
  assert.deepEqual(JSON.parse(compactSnapshot), {code: 'ABC123', list: [3]});
});

test('cloud-claim merging is repeatable and canonicalizes the list once', () => {
  const {repository, values} = createRepository({initial: {
    rizzoma_me: 'ABC123',
    rizzoma_mock_db: JSON.stringify({users: {ABC123: {code: 'ABC123'}}, claims: {ABC123: [4, 1]}}),
    rizzoma_claims: JSON.stringify({code: 'ABC123', list: [1, 4, 4, 99]})
  }});
  const database = repository.loadDatabase();
  repository.adoptCloudClaims(database);
  const firstSnapshot = values.get('rizzoma_mock_db');
  repository.adoptCloudClaims(database);

  assert.equal(values.get('rizzoma_mock_db'), firstSnapshot);
  assert.deepEqual(database.claims.ABC123, [1, 4]);
});

test('beta settings are normalized and stable across repeated saves', () => {
  const {repository, values} = createRepository();
  repository.saveBetaOpen([4, 1, 4]);
  const firstSnapshot = values.get('rizzoma_beta');
  repository.saveBetaOpen([1, 4]);

  assert.equal(firstSnapshot, '[1,4]');
  assert.equal(values.get('rizzoma_beta'), firstSnapshot);
});

test('malformed persisted claim shape is reset before granting a claim', () => {
  const {repository} = createRepository({initial: {
    rizzoma_me: 'ABC123',
    rizzoma_mock_db: JSON.stringify({
      users: {ABC123: {code: 'ABC123'}},
      claims: {ABC123: 'not-an-array'}
    })
  }});
  const database = repository.loadDatabase();

  assert.equal(repository.grantClaim(database, 2), true);
  assert.deepEqual(JSON.parse(JSON.stringify(database.claims.ABC123)), [2]);
});
