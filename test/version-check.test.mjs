import assert from "node:assert/strict";
import test from "node:test";
import { comparePluginVersions, PluginVersionChecker } from "../server/version-check.mjs";

function response(version) {
  return {
    ok: true,
    text: async () => JSON.stringify({ name: "ielts-writing-quiz", version }),
  };
}

test("compares semantic versions while ignoring cachebuster metadata", () => {
  assert.equal(comparePluginVersions("0.2.1+codex.remote", "0.2.1+codex.local"), 0);
  assert.equal(comparePluginVersions("0.3.0", "0.2.9"), 1);
  assert.equal(comparePluginVersions("0.2.0", "0.2.1"), -1);
  assert.equal(comparePluginVersions("development", "0.2.1"), null);
});

test("reports current, update available, and local ahead states", async () => {
  const current = new PluginVersionChecker({
    localVersion: "0.2.1",
    fetchImpl: async () => response("0.2.1+codex.published"),
  });
  assert.equal((await current.check()).status, "current");

  const behind = new PluginVersionChecker({
    localVersion: "0.2.1",
    fetchImpl: async () => response("0.3.0"),
  });
  assert.equal((await behind.check()).status, "update_available");

  const ahead = new PluginVersionChecker({
    localVersion: "0.3.0",
    fetchImpl: async () => response("0.2.1"),
  });
  assert.equal((await ahead.check()).status, "local_ahead");
});

test("caches a successful check and supports an explicit refresh", async () => {
  let calls = 0;
  const requestedUrls = [];
  const checker = new PluginVersionChecker({
    localVersion: "0.2.1",
    fetchImpl: async (url) => {
      calls += 1;
      requestedUrls.push(url);
      return response("0.2.1");
    },
    now: () => new Date("2026-09-03T00:00:00.000Z"),
  });

  assert.equal((await checker.check()).cached, false);
  assert.equal((await checker.check()).cached, true);
  assert.equal(calls, 1);
  assert.equal((await checker.check({ force: true })).cached, false);
  assert.equal(calls, 2);
  assert.ok(requestedUrls.every((url) => new URL(url).searchParams.get("checked_at") === "1788393600000"));
});

test("degrades gracefully when GitHub is unavailable or invalid", async () => {
  const offline = new PluginVersionChecker({
    localVersion: "0.2.1",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  const unavailable = await offline.check();
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.remoteVersion, null);

  const invalid = new PluginVersionChecker({
    localVersion: "0.2.1",
    fetchImpl: async () => ({ ok: true, text: async () => "{}" }),
  });
  assert.equal((await invalid.check()).status, "unavailable");
});
