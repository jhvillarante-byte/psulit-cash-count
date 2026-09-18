const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ScratchCount = require("./scratch-count.js");

const complete = {
  scratch_go_banana: "68",
  scratch_red_hot_7: "147",
  scratch_go_for_gold: "0",
};

test("Alphaland accepts explicit whole-number counts including zero", () => {
  assert.deepEqual(ScratchCount.validate("Alphaland", true, complete), {
    valid: true,
    values: {
      scratch_go_banana: 68,
      scratch_red_hot_7: 147,
      scratch_go_for_gold: 0,
    },
    errors: {},
  });
});

test("Alphaland rejects every blank field instead of treating it as zero", () => {
  for (const key of Object.keys(complete)) {
    const result = ScratchCount.validate("Alphaland", true, { ...complete, [key]: "" });
    assert.equal(result.valid, false);
    assert.match(result.errors[key], /Required/);
  }
});

test("Alphaland rejects negatives and decimals", () => {
  for (const invalid of ["-1", "1.5", "2,000", "abc"])
    assert.equal(ScratchCount.validate("Alphaland", true, { ...complete, scratch_go_banana: invalid }).valid, false);
});

test("unselected Scratch and all Solaire counts are hidden, optional, and unreported", () => {
  assert.deepEqual(ScratchCount.validate("Alphaland", false, {}), { valid: true, values: null, errors: {} });
  assert.deepEqual(ScratchCount.validate("Solaire", true, {}), { valid: true, values: null, errors: {} });
  assert.equal(ScratchCount.formatReport("Alphaland", false, complete, true), "");
  assert.equal(ScratchCount.formatReport("Solaire", true, complete, true), "");
});

test("Alphaland Opening and Closing both require and render the stable locked-report format", () => {
  const expected = [
    "🎟️ *SCRATCH IT — PHYSICAL COUNT*",
    "Go Banana: 68 pcs",
    "Red Hot 7: 147 pcs",
    "Go For Gold: 0 pcs",
  ].join("\n");
  for (const cashCountType of ["Opening", "Closing"]) {
    const result = ScratchCount.validate("Alphaland", true, complete);
    assert.equal(result.valid, true, `${cashCountType} should accept complete physical counts`);
    assert.equal(ScratchCount.formatReport("Alphaland", true, result.values, true), expected);
  }
});

test("LottoMatik wallet is required when selected in either branch", () => {
  assert.equal(ScratchCount.validateLottomatik("Alphaland", true, "").valid, false);
  assert.deepEqual(ScratchCount.validateLottomatik("Alphaland", true, "0.00"), { valid: true, value: 0, error: "" });
  assert.deepEqual(ScratchCount.validateLottomatik("Alphaland", false, ""), { valid: true, value: null, error: "" });
  assert.equal(ScratchCount.validateLottomatik("Solaire", true, "").valid, false);
  assert.deepEqual(ScratchCount.validateLottomatik("Alphaland", true, "10,150.00"), { valid: true, value: 10150, error: "" });
});

test("LottoMatik rejects negative, malformed, and over-precision balances", () => {
  for (const invalid of ["-1", "1.234", "1,50.00", "PHP 10", "abc"])
    assert.equal(ScratchCount.validateLottomatik("Alphaland", true, invalid).valid, false);
});

test("LottoMatik has a stable control-balance report independent of physical cash", () => {
  assert.equal(
    ScratchCount.formatLottomatikReport("Alphaland", true, 10150, true),
    "🎰 *LOTTOMATIK*\nWallet Balance: ₱10,150.00"
  );
  assert.equal(ScratchCount.formatLottomatikReport("Alphaland", false, 10150, true), "");
});

test("LottoMatik physical cash validates denominations and totals independently of wallet", () => {
  const raw = Object.fromEntries(ScratchCount.LOTTOMATIK_DENOMS.map(d => [`lottomatik_cash_${d}`, "0"]));
  raw.lottomatik_cash_1000 = "2";
  raw.lottomatik_cash_50 = "3";
  const result = ScratchCount.validateLottomatikCash("Solaire", true, raw);
  assert.equal(result.valid, true);
  assert.equal(result.total, 2150);
  const blank = ScratchCount.validateLottomatikCash("Solaire", true, { ...raw, lottomatik_cash_1: "" });
  assert.equal(blank.valid, true);
  assert.equal(blank.values.lottomatik_cash_1, 0);
  assert.equal(ScratchCount.validateLottomatikCash("Alphaland", false, {}).total, 0);
  assert.match(ScratchCount.formatLottomatikCashReport("Solaire", true, result.values, true), /Total LottoMatik: ₱2,150\.00/);
});

test("LottoMatik carry-forward preserves denomination quantities and wallet independently", () => {
  const cash = Object.fromEntries(ScratchCount.LOTTOMATIK_DENOMS.map(d => [`lottomatik_cash_${d}`, 0]));
  cash.lottomatik_cash_1000 = 2;
  cash.lottomatik_cash_20 = 3;
  const saved = ScratchCount.buildLottomatikCarryRecord(cash, 10150);
  assert.equal(saved.cashTotal, 2060);
  const loaded = ScratchCount.normalizeLottomatikCarryRecord(saved);
  assert.deepEqual(loaded.cash, saved.cash);
  assert.equal(loaded.cashTotal, 2060);
  assert.equal(loaded.wallet, 10150);
  const legacy = ScratchCount.normalizeLottomatikCarryRecord("10150.00");
  assert.equal(legacy.wallet, 10150);
  assert.equal(legacy.cash, null);
});

test("HTML integrates branch-specific fields without altering cash-total functions", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /id="scratch-physical-section" style="display:none/);
  assert.match(html, /ScratchCount\.isRequired\(state\.branch, isOtherSelected\("scratch"\)\)/);
  assert.match(html, /validateScratchAndContinue\(\)/);
  assert.match(html, /ScratchCount\.formatReport\(state\.branch/);
  assert.doesNotMatch(html, /getTotal\([^)]*scratch_/);
  assert.doesNotMatch(html, /getOtherTotal\([^)]*scratch_go_/);
  assert.doesNotMatch(html, /getOtherTotal\([^)]*lottomatik/);
  assert.doesNotMatch(html, /other-btn-opex|other-section-opex|other-opex-/i);
  assert.match(html, /Solaire: \["hive","lottomatik"\]/);
  assert.match(html, /Alphaland: \["hive","juanpay","scratch","lottomatik"\]/);
  assert.match(html, /id="lottomatik-wallet-balance"/);
  assert.match(html, /id="lottomatik_cash_1000"/);
  assert.match(html, /TOTAL LOTTOMATIK/);
  assert.doesNotMatch(html, /LottoMatik Cash on Hand/);
  assert.match(html, /psulit_lottomatik_/);
  assert.match(html, /saveLottomatikCarryForward\(\)/);
  assert.match(html, /loadLottomatikCarryForward\(\)/);
});

test("Opening and Closing allow Scratch and LottoMatik together without entering cash totals", () => {
  for (const cashCountType of ["Opening", "Closing"]) {
    assert.equal(ScratchCount.validate("Alphaland", true, complete).valid, true, cashCountType);
    assert.equal(ScratchCount.validateLottomatik("Alphaland", true, "10150.00").valid, true, cashCountType);
    const cash = Object.fromEntries(ScratchCount.LOTTOMATIK_DENOMS.map(d => [`lottomatik_cash_${d}`, "0"]));
    assert.equal(ScratchCount.validateLottomatikCash("Alphaland", true, cash).valid, true, cashCountType);
  }
});

test("Cash Count ships the ScratchCount module and guards module-load failure", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.equal(fs.existsSync(path.join(__dirname, "scratch-count.js")), true);
  assert.match(html, /<script src="scratch-count\.js"><\/script>/);
  assert.match(html, /Cash Count module failed to load/);
  assert.match(html, /typeof ScratchCount !== "undefined"/);
});

test("Cash Count skips unselected Scratch/LottoMatik validation and focuses invalid fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /if\(!isOtherSelected\("scratch"\)\) return \{ valid: true/);
  assert.match(html, /if\(!isOtherSelected\("lottomatik"\)\) return \{ valid: true/);
  assert.match(html, /switchOtherTab\("scratch"\)/);
  assert.match(html, /switchOtherTab\("lottomatik"\)/);
  assert.match(html, /scrollIntoView\(\{behavior:"smooth"/);
});

test("missing ScratchCount module returns a visible validation error instead of throwing", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: "", style: {}, textContent: "", children: [], checked: false,
      classList: { contains: name => id === "other-btn-lottomatik" && name === "selected", add() {}, remove() {} },
      querySelectorAll: () => [], appendChild() {}, scrollIntoView() {}, addEventListener() {}
    });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => element("created") },
    window: { addEventListener() {}, scrollTo() {} },
    console, fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout, clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  context.globalThis = context;
  vm.runInNewContext(inline, context);
  assert.doesNotThrow(() => context.validateLottomatikCash());
  assert.match(context.validateLottomatikCash().errors.module, /module failed to load/i);
});

test("frontend notification calls use the authenticated backend bridge without credentials", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /Authorization.*Bearer.*state\.sessionToken/);
  assert.match(html, /fetch\(`\$\{BACKEND\}\/send-report`/);
  assert.doesNotMatch(html, /api\.telegram\.org\/bot/);
  assert.doesNotMatch(html, /xoxb-|8840495574:/);
});
