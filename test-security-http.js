const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

process.env.CASH_COUNT_FRONTEND_ORIGIN = 'https://cash-count.example.test';
process.env.CASH_COUNT_PIN_HASH_SALT = 'test-only-salt';
process.env.CASH_COUNT_TELLER_PIN_HASHES = JSON.stringify([{
  hash: crypto.scryptSync('1234', process.env.CASH_COUNT_PIN_HASH_SALT, 32).toString('hex'),
  name: 'Test Teller', branches: ['Alphaland']
}]);
const { app, resetAuthState } = require('./server');

test('notification routes reject unauthenticated requests and PIN attempts are rate-limited', async () => {
  resetAuthState();
  for (const path of ['/send-report', '/send-slack', '/send-photo']) assert.equal((await request(app).post(path).send({})).status, 401, path);
  for (let i = 0; i < 5; i++) assert.equal((await request(app).post('/auth/session').send({ pin: '0000' })).status, 401);
  assert.equal((await request(app).post('/auth/session').send({ pin: '0000' })).status, 429);
});

test('valid PIN creates a session and branch authorization is enforced', async () => {
  resetAuthState();
  const auth = await request(app).post('/auth/session').send({ pin: '1234' });
  assert.equal(auth.status, 200);
  assert.equal(auth.body.ok, true);
  const token = auth.body.token;
  assert.equal((await request(app).post('/send-slack').set('Authorization', `Bearer ${token}`).send({ branch: 'Solaire', message: 'x' })).status, 403);
  assert.equal((await request(app).post('/send-slack').set('Authorization', `Bearer ${token}`).send({ branch: 'Alphaland', message: 'x' })).status, 200);
});
