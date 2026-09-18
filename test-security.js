const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(__dirname + '/server.js', 'utf8');

test('notification routes require a Cash Count session and CORS is origin-restricted', () => {
  assert.match(source, /app\.set\("trust proxy", 1\)/);
  assert.match(source, /app\.use\(cors\(\{ origin: allowedOrigin \}\)\)/);
  assert.match(source, /app\.post\("\/send-report", requireSession/);
  assert.match(source, /app\.post\("\/send-slack", requireSession/);
  assert.match(source, /app\.post\("\/send-photo", requireSession/);
  assert.match(source, /app\.post\("\/auth\/session", issueSession/);
  assert.match(source, /Cash Count session required/);
});

test('backend source contains no literal Telegram or Slack credential', () => {
  assert.doesNotMatch(source, /8840495574:|xoxb-/);
  assert.match(source, /process\.env\.TELEGRAM_BOT_TOKEN/);
  assert.match(source, /process\.env\.SLACK_TOKEN/);
});
