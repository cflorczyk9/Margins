import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelemetry } from "../src/telemetry.js";

function makeFakeFetch() {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };
  fn.calls = calls;
  return fn;
}

function makeFailingFetch() {
  return async () => {
    throw new Error("network unreachable");
  };
}

test("telemetry disabled by default when no consent + no env override", () => {
  const t = createTelemetry({ consent: null });
  assert.equal(t.enabled, false);
});

test("telemetry enabled when consent.enabled === true", () => {
  const t = createTelemetry({ consent: { enabled: true } });
  assert.equal(t.enabled, true);
});

test("env override MARGINS_TELEMETRY=off forces disabled", () => {
  const previous = process.env.MARGINS_TELEMETRY;
  process.env.MARGINS_TELEMETRY = "off";
  try {
    const t = createTelemetry({ consent: { enabled: true } });
    assert.equal(t.enabled, false);
  } finally {
    if (previous === undefined) delete process.env.MARGINS_TELEMETRY;
    else process.env.MARGINS_TELEMETRY = previous;
  }
});

test("env override MARGINS_TELEMETRY=on forces enabled", () => {
  const previous = process.env.MARGINS_TELEMETRY;
  process.env.MARGINS_TELEMETRY = "on";
  try {
    const t = createTelemetry({ consent: null });
    assert.equal(t.enabled, true);
  } finally {
    if (previous === undefined) delete process.env.MARGINS_TELEMETRY;
    else process.env.MARGINS_TELEMETRY = previous;
  }
});

test("postEvent makes no network call when disabled", async () => {
  const fakeFetch = makeFakeFetch();
  const t = createTelemetry({ consent: { enabled: false }, fetch: fakeFetch });
  const result = await t.postEvent("/tool/search_vault");
  assert.equal(result.sent, false);
  assert.equal(fakeFetch.calls.length, 0);
});

test("postEvent fires correct GoatCounter URL when enabled", async () => {
  const fakeFetch = makeFakeFetch();
  const t = createTelemetry({
    consent: { enabled: true, endpoint: "https://test.goatcounter.com" },
    fetch: fakeFetch
  });
  const result = await t.postEvent("/tool/search_vault");
  assert.equal(result.sent, true);
  assert.equal(fakeFetch.calls.length, 1);
  assert.equal(
    fakeFetch.calls[0].url,
    "https://test.goatcounter.com/count?p=%2Ftool%2Fsearch_vault"
  );
});

test("postEvent silently survives network failure", async () => {
  const t = createTelemetry({
    consent: { enabled: true },
    fetch: makeFailingFetch()
  });
  const result = await t.postEvent("/tool/anything");
  assert.equal(result.sent, false);
  assert.equal(result.reason, "network");
});

test("fireAndForget never throws even on network failure", async () => {
  const t = createTelemetry({
    consent: { enabled: true },
    fetch: makeFailingFetch()
  });
  // Should not throw or reject any unhandled promises.
  t.fireAndForget("/tool/throws");
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(true);
});
