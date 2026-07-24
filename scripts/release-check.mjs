#!/usr/bin/env node
// Production release preflight for gate A in docs/GO_LIVE.md.
//
// Probes a running deployment and reports pass/fail per check. Exits non-zero if any hard check
// fails, so it can gate an invite round in CI or from a laptop. It only reads: nothing here mutates
// production state.
//
//   npm run release:check -- --base-url https://bloopy.example --phase 1
//   ADMIN_API_KEY=... npm run release:check -- --base-url https://bloopy.example
//
// Without ADMIN_API_KEY the queue and runtime-control checks are reported as skipped rather than
// passed, because "not checked" and "healthy" must never look the same on a release checklist.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "apps/server/package.json"), "utf8"));
const migrationFiles = readdirSync(join(root, "apps/server/migrations")).filter((file) => file.endsWith(".sql")).sort();

function parseArgs(argv) {
  const args = { baseUrl: process.env.BLOOPY_BASE_URL ?? "", phase: "1", expectVersion: pkg.version, timeoutMs: 10_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = inline ?? argv[index + 1];
    const consume = () => { if (inline === undefined) index += 1; return value; };
    if (flag === "--base-url") args.baseUrl = consume();
    else if (flag === "--phase") args.phase = consume();
    else if (flag === "--expect-version") args.expectVersion = consume();
    else if (flag === "--timeout-ms") args.timeoutMs = Number(consume());
  }
  return args;
}

// The flag state each rollout phase is allowed to run with, from docs/GO_LIVE.md. Anything else is a
// configuration the human verification gates have not covered yet.
const PHASE_CONTROLS = {
  1: { telegramIngress: true, outbox: true, degraded: false, managedFleet: false, botToBot: false },
  2: { telegramIngress: true, outbox: true, degraded: false, managedFleet: true, botToBot: false },
  3: { telegramIngress: true, outbox: true, degraded: false, managedFleet: true, botToBot: true }
};

const results = [];
const record = (status, name, detail) => { results.push({ status, name, detail }); };
const pass = (name, detail) => record("PASS", name, detail);
const fail = (name, detail) => record("FAIL", name, detail);
const warn = (name, detail) => record("WARN", name, detail);
const skip = (name, detail) => record("SKIP", name, detail);

async function probe(baseUrl, path, timeoutMs, headers = {}) {
  const response = await fetch(new URL(path, baseUrl), { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON bodies are reported as text */ }
  return { status: response.status, body, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    console.error("release-check: --base-url https://your-deployment is required (or set BLOOPY_BASE_URL)");
    process.exitCode = 2;
    return;
  }
  const expected = PHASE_CONTROLS[args.phase];
  if (!expected) {
    console.error(`release-check: --phase must be one of ${Object.keys(PHASE_CONTROLS).join(", ")}`);
    process.exitCode = 2;
    return;
  }

  if (!args.baseUrl.startsWith("https://")) warn("transport", `base URL is not https (${args.baseUrl}); Telegram will not deliver webhooks to it`);
  else pass("transport", "base URL is https");

  // --- liveness and readiness ---------------------------------------------------------------
  try {
    const live = await probe(args.baseUrl, "/livez", args.timeoutMs);
    if (live.status === 200 && live.body?.ok) pass("/livez", "200 ok");
    else fail("/livez", `expected 200 ok, got ${live.status} ${live.text.slice(0, 120)}`);
  } catch (error) { fail("/livez", `unreachable: ${error.message}`); }

  let ready = null;
  try {
    ready = await probe(args.baseUrl, "/readyz", args.timeoutMs);
    if (ready.status === 200 && ready.body?.ready === true) pass("/readyz", "ready");
    else fail("/readyz", `expected 200 ready:true, got ${ready.status} ${ready.text.slice(0, 200)}`);
    if (ready.body?.migrationsReady === true) pass("migrations applied", "readiness reports migrationsReady");
    else fail("migrations applied", `migrationsReady is ${JSON.stringify(ready.body?.migrationsReady)}`);
    if (ready.body?.degraded === true) fail("degraded mode", "deployment is in read-only degraded mode");
    else pass("degraded mode", "mutations are enabled");
  } catch (error) { fail("/readyz", `unreachable: ${error.message}`); }

  // --- version ------------------------------------------------------------------------------
  try {
    const health = await probe(args.baseUrl, "/health", args.timeoutMs);
    if (health.status !== 200) fail("/health", `expected 200, got ${health.status}`);
    else if (health.body?.version === args.expectVersion) pass("version", `serving ${health.body.version}`);
    else fail("version", `expected ${args.expectVersion}, deployment is serving ${health.body?.version ?? "unknown"}`);
  } catch (error) { fail("/health", `unreachable: ${error.message}`); }

  // --- admin surface: queues, controls, migrations --------------------------------------------
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    skip("runtime controls", "set ADMIN_API_KEY to verify flags, queue health and applied migrations");
    skip("queue health", "set ADMIN_API_KEY to verify failed updates, uncertain delivery and dead letters");
    skip("migration ledger", "set ADMIN_API_KEY to compare applied migrations against this checkout");
  } else {
    try {
      const metrics = await probe(args.baseUrl, "/api/admin/metrics", args.timeoutMs, { "x-admin-key": adminKey });
      if (metrics.status === 401) {
        fail("runtime controls", "admin key rejected");
      } else if (metrics.status !== 200 || !metrics.body) {
        fail("runtime controls", `expected 200 JSON, got ${metrics.status} ${metrics.text.slice(0, 120)}`);
      } else {
        const controls = metrics.body.controls ?? {};
        const wrong = Object.entries(expected).filter(([key, want]) => controls[key] !== want).map(([key, want]) => `${key}=${controls[key]} (phase ${args.phase} expects ${want})`);
        if (wrong.length) fail("runtime controls", wrong.join("; "));
        else pass("runtime controls", `phase ${args.phase} flag set is correct`);

        const byStatus = (rows) => Object.fromEntries((rows ?? []).map((row) => [row.status, Number(row.count)]));
        const outbox = byStatus(metrics.body.outbox);
        const updates = byStatus(metrics.body.telegramUpdates);
        const problems = [];
        for (const [label, count] of [["failed updates", updates.failed], ["uncertain deliveries", outbox.uncertain], ["dead letters", outbox.dead_letter], ["failed deliveries", outbox.failed]]) {
          if (Number(count ?? 0) > 0) problems.push(`${count} ${label}`);
        }
        // A backlog is a symptom, not a failure on its own; readiness already fails on a real one.
        const backlog = Number(updates.received ?? 0) + Number(updates.retryable ?? 0) + Number(outbox.pending ?? 0) + Number(outbox.retryable ?? 0);
        if (problems.length) fail("queue health", `${problems.join(", ")} — investigate before inviting testers`);
        else pass("queue health", `no failed, uncertain or dead-lettered work (backlog ${backlog})`);

        const applied = metrics.body.migrations ?? {};
        const latestInRepo = migrationFiles[migrationFiles.length - 1];
        if (Number(applied.applied) === migrationFiles.length && applied.latest === latestInRepo) pass("migration ledger", `${applied.applied} applied, latest ${applied.latest}`);
        else fail("migration ledger", `deployment has ${applied.applied} migrations (latest ${applied.latest}); this checkout has ${migrationFiles.length} (latest ${latestInRepo})`);
      }
    } catch (error) { fail("runtime controls", `admin metrics unreachable: ${error.message}`); }
  }

  // --- public surfaces that must not require auth ---------------------------------------------
  try {
    const share = await probe(args.baseUrl, "/share/c/deadbeefdeadbeef", args.timeoutMs);
    if (share.status === 404) pass("share surface", "unknown share tokens return 404");
    else fail("share surface", `expected 404 for an unknown token, got ${share.status}`);
  } catch (error) { warn("share surface", `not reachable: ${error.message}`); }

  // --- the Mini App must not be authenticated-by-accident --------------------------------------
  try {
    const app = await probe(args.baseUrl, "/", args.timeoutMs);
    if (app.status === 200 && app.text.includes("Bloopy Network")) pass("mini app", "static shell is served");
    else fail("mini app", `expected the Mini App shell, got ${app.status}`);
  } catch (error) { fail("mini app", `unreachable: ${error.message}`); }

  const width = Math.max(...results.map((entry) => entry.name.length));
  console.log(`\nBloopy release preflight — ${args.baseUrl} (phase ${args.phase}, expecting ${args.expectVersion})\n`);
  for (const entry of results) console.log(`  ${entry.status.padEnd(4)}  ${entry.name.padEnd(width)}  ${entry.detail}`);
  const failed = results.filter((entry) => entry.status === "FAIL");
  const skipped = results.filter((entry) => entry.status === "SKIP");
  console.log(`\n  ${results.filter((entry) => entry.status === "PASS").length} passed, ${failed.length} failed, ${results.filter((entry) => entry.status === "WARN").length} warnings, ${skipped.length} skipped\n`);
  if (failed.length) {
    console.log("  Do not invite testers while any check is failing. See docs/GO_LIVE.md.\n");
    process.exitCode = 1;
  } else if (skipped.length) {
    console.log("  Preflight passed, but skipped checks are unverified — re-run with ADMIN_API_KEY before a release sign-off.\n");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
