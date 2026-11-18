#!/usr/bin/env node
// Client Product Insights → GitHub Issues helper for the automation agent.
// Dependency-free (Node 18+). Every command prints one JSON object to stdout.
//
// Environment:
//   CPI_BASE_URL      Base URL of Client Product Insights, e.g. https://client-product-insights.example.com
//   CPI_API_KEY       Agent API key (sent as X-API-Key)
//   CURSOR_APP_TOKEN  Optional. Cursor API key for apps hosted behind Cursor sign-in (sent as x-cursor-app-token)
//   GITHUB_TOKEN      Token with Issues read/write on GITHUB_REPO
//   GITHUB_REPO       owner/name of the issue repository (required; no default)
//   ALLOW_PUBLIC_ISSUES  Set to "true" only when publishing synthetic demo data to a PUBLIC repository.
//                     By default the helper refuses to create issues in public repositories.
//
// Privacy: issue drafts never include the client's verbatim feedback, client or household
// identity, advisor names, or links into the internal app. Only the product problem, the requested
// change, impact, and broad context (product area, channel, priority, client segment) are used.
//   CPI_WORKER_ID     Optional worker name, default cursor-automation
//
// Commands:
//   claim   [--request CPI-1033]                       Claim a specific request, or the oldest queued one
//   draft   --request CPI-1033                         Render a structured issue draft (markdown) for review/editing
//   heartbeat --request ID --claim-token T --message M Report progress and extend the lease
//   publish --request ID --claim-token T --title "…" --body-file issue.md [--labels a,b] [--dry-run]
//   fail    --request ID --claim-token T --error "…"   Record a failure

import { readFile } from "node:fs/promises";

const AREA = {
  client_portal: "Client Portal",
  advisor_workstation: "Advisor Workstation",
  portfolio_reporting: "Portfolio Reporting",
  document_center: "Document Center",
  account_opening: "Account Opening",
  transfers_payments: "Transfers & Payments",
  mobile_experience: "Mobile Experience",
  notifications: "Notifications",
};
const LABEL_COLORS = {
  "client-request": "1d4a37",
  "priority: critical": "b42318",
  "priority: high": "b54708",
  "priority: medium": "c9a14a",
  "priority: low": "9a9ea3",
};

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function env(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) fail(`Missing environment variable ${name}.`);
  return value;
}

function fail(message, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: message, ...extra }));
  process.exit(1);
}

function print(value) {
  console.log(JSON.stringify({ ok: true, ...value }, null, 2));
}

async function cpi(method, path, body) {
  const base = env("CPI_BASE_URL").replace(/\/+$/, "");
  const headers = { "x-api-key": env("CPI_API_KEY"), accept: "application/json" };
  if (process.env.CURSOR_APP_TOKEN) headers["x-cursor-app-token"] = process.env.CURSOR_APP_TOKEN;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204) return { status: 204, data: null };
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (response.status >= 300 && response.status < 400) {
      fail("Client Product Insights redirected the request (likely a sign-in page). Set CURSOR_APP_TOKEN for apps behind Cursor sign-in.", { status: response.status });
    }
    fail(`Client Product Insights returned a non-JSON response (HTTP ${response.status}).`);
  }
  return { status: response.status, data };
}

async function github(method, path, body) {
  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "client-product-insights-automation",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const repo = () => env("GITHUB_REPO");

async function assertRepositoryAllowed() {
  const res = await github("GET", `/repos/${repo()}`);
  if (res.status !== 200) fail(`Could not read repository ${repo()} (HTTP ${res.status}).`, { github: res.data?.message });
  if (res.data.private !== true && process.env.ALLOW_PUBLIC_ISSUES !== "true") {
    fail(
      `Refusing to publish to ${repo()} because it is public. Make the repository private, or set ALLOW_PUBLIC_ISSUES=true only for synthetic demo data.`,
      { public: true },
    );
  }
  return { isPublic: res.data.private !== true };
}
const marker = (id) => `<!-- cpi-request: ${id} -->`;
const revisionMarker = (id, revision) => `<!-- cpi-revision: ${id} r${revision} -->`;

function labelsFor(request) {
  return [
    "client-request",
    `priority: ${request.priority.code}`,
    `area: ${AREA[request.productArea.code] ?? request.productArea.label}`,
    `type: ${request.type.code}`,
  ];
}

async function ensureLabels(names) {
  for (const name of names) {
    const existing = await github("GET", `/repos/${repo()}/labels/${encodeURIComponent(name)}`);
    if (existing.status === 200) continue;
    const color = LABEL_COLORS[name] ?? (name.startsWith("area:") ? "6f8fb3" : name.startsWith("type:") ? "5e9a7a" : "ededed");
    const created = await github("POST", `/repos/${repo()}/labels`, { name, color });
    if (created.status !== 201 && created.status !== 422) {
      fail(`Could not create label "${name}" (HTTP ${created.status}).`, { github: created.data?.message });
    }
  }
}

async function findExistingIssue(requestId) {
  for (let page = 1; page <= 10; page++) {
    const res = await github("GET", `/repos/${repo()}/issues?labels=client-request&state=all&per_page=100&page=${page}`);
    if (res.status !== 200) fail(`Could not list issues in ${repo()} (HTTP ${res.status}).`, { github: res.data?.message });
    const match = res.data.find((issue) => !issue.pull_request && (issue.body ?? "").includes(marker(requestId)));
    if (match) return match;
    if (res.data.length < 100) return null;
  }
  return null;
}

function renderDraft(detail) {
  const r = detail.request;
  const c = r.content;
  const ctx = r.clientContext;
  const section = (title, text, empty) => `## ${title}\n\n${text?.trim() ? text.trim() : `_${empty}_`}\n`;
  return [
    `## Summary\n\n${c.problemStatement?.trim() || c.requestedOutcome}\n`,
    section("Problem", c.problemStatement, "Describe the product problem in your own words, without client details."),
    section("Proposed change", c.requestedOutcome, "Not provided"),
    section("Current workaround", c.currentWorkaround, "None recorded"),
    section("Business impact", c.businessImpact, "Not provided"),
    section("Expected benefit", c.expectedBenefit, "Not provided"),
    `## Acceptance criteria\n\n- [ ] The proposed change is available in the ${r.channel.label.toLowerCase()} channel for ${r.productArea.label}.\n- [ ] The current workaround is no longer needed.\n`,
    `## Context\n\n| Field | Value |\n| --- | --- |\n| Request | ${r.id} (revision ${r.revision}) |\n| Product area | ${r.productArea.label} |\n| Channel | ${r.channel.label} |\n| Type | ${r.type.label} |\n| Priority | ${r.priority.label} |\n| Client segment | ${ctx ? ctx.segment : "Advisor-originated"} |\n| Related requests | ${r.relatedRequests.length ? r.relatedRequests.map((x) => x.id).join(", ") : "None"} |\n`,
  ].join("\n");
}

function footer(detail) {
  const r = detail.request;
  return `\n---\n<sub>Created by the Client Product Insights automation from ${r.id} revision ${r.revision}.</sub>\n\n${marker(r.id)}\n${revisionMarker(r.id, r.revision)}\n`;
}

async function getDetail(requestId) {
  const res = await cpi("GET", `/requests/${encodeURIComponent(requestId)}`);
  if (res.status !== 200) fail(`Could not read ${requestId} (HTTP ${res.status}).`, { api: res.data?.error });
  return res.data.data;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  const worker = process.env.CPI_WORKER_ID?.trim() || "cursor-automation";

  if (command === "claim") {
    const body = { workerId: worker, leaseSeconds: 900 };
    const res = opts.request
      ? await cpi("POST", `/requests/${encodeURIComponent(opts.request)}/claim`, body)
      : await cpi("POST", "/automation/claim-next", body);
    if (res.status === 204) return print({ status: "empty", message: "No queued requests." });
    if (res.status === 409) return print({ status: "unavailable", reason: res.data?.error?.code, message: res.data?.error?.message });
    if (res.status !== 200) fail(`Claim failed (HTTP ${res.status}).`, { api: res.data?.error });
    const claim = res.data.data;
    const detail = await getDetail(claim.job.requestId);
    return print({
      status: "claimed",
      requestId: claim.job.requestId,
      revision: claim.job.revision,
      claimToken: claim.claimToken,
      leaseExpiresAt: claim.leaseExpiresAt,
      correlationId: claim.job.correlationId,
      request: detail.request,
      links: detail.links,
    });
  }

  if (command === "draft") {
    if (!opts.request) fail("--request is required.");
    const detail = await getDetail(opts.request);
    return print({ requestId: detail.request.id, suggestedTitle: detail.request.title, labels: labelsFor(detail.request), body: renderDraft(detail) });
  }

  if (command === "heartbeat") {
    if (!opts.request || !opts["claim-token"]) fail("--request and --claim-token are required.");
    const res = await cpi("POST", `/requests/${encodeURIComponent(opts.request)}/automation-status`, {
      claimToken: opts["claim-token"],
      status: "processing",
      message: String(opts.message ?? "Working on the GitHub issue"),
      leaseSeconds: 900,
    });
    if (res.status !== 200) fail(`Status update failed (HTTP ${res.status}).`, { api: res.data?.error });
    return print({ status: "updated" });
  }

  if (command === "publish") {
    const id = opts.request;
    const token = opts["claim-token"];
    if (!id || !token || !opts.title || !opts["body-file"]) fail("--request, --claim-token, --title and --body-file are required.");
    const detail = await getDetail(id);
    const labels = opts.labels ? String(opts.labels).split(",").map((l) => l.trim()).filter(Boolean) : labelsFor(detail.request);
    if (!labels.includes("client-request")) labels.unshift("client-request");
    const body = `${(await readFile(String(opts["body-file"]), "utf8")).trim()}\n${footer(detail)}`;
    const title = String(opts.title).slice(0, 240);

    if (opts["dry-run"]) return print({ status: "dry-run", repo: repo(), title, labels, body });

    await assertRepositoryAllowed();
    await ensureLabels(labels);
    let issue = await findExistingIssue(detail.request.id);
    let created = false;
    if (issue) {
      const revMarker = revisionMarker(detail.request.id, detail.request.revision);
      const existingComments = await github("GET", `/repos/${repo()}/issues/${issue.number}/comments?per_page=100`);
      const alreadyPosted =
        (issue.body ?? "").includes(revMarker) ||
        (existingComments.status === 200 && existingComments.data.some((c) => (c.body ?? "").includes(revMarker)));
      if (!alreadyPosted) {
        await github("POST", `/repos/${repo()}/issues/${issue.number}/comments`, {
          body: `Client Product Insights re-queued ${detail.request.id} at revision ${detail.request.revision}. Updated details:\n\n${body}`,
        });
      }
    } else {
      const res = await github("POST", `/repos/${repo()}/issues`, { title, body, labels });
      if (res.status !== 201) fail(`GitHub issue creation failed (HTTP ${res.status}).`, { github: res.data?.message });
      issue = res.data;
      created = true;
    }

    const issueKey = `${repo()}#${issue.number}`;
    const ref = await cpi("PUT", `/requests/${encodeURIComponent(id)}/external-reference`, {
      claimToken: token,
      issueKey,
      issueUrl: issue.html_url,
      system: "github",
    });
    if (ref.status !== 200) fail(`Issue ${issueKey} exists but attaching it failed (HTTP ${ref.status}).`, { api: ref.data?.error, issueUrl: issue.html_url });
    const result = await cpi("POST", `/requests/${encodeURIComponent(id)}/result`, {
      claimToken: token,
      outcome: "completed",
      summary: `${created ? "Created" : "Updated"} GitHub issue ${issueKey}: ${title}`,
      externalIssue: { key: issueKey, url: issue.html_url, system: "github" },
      details: { labels, created },
    });
    if (result.status !== 200) fail(`Issue ${issueKey} exists but recording the result failed (HTTP ${result.status}).`, { api: result.data?.error, issueUrl: issue.html_url });
    return print({ status: created ? "created" : "updated", issueKey, issueUrl: issue.html_url, requestId: id });
  }

  if (command === "fail") {
    if (!opts.request || !opts["claim-token"] || !opts.error) fail("--request, --claim-token and --error are required.");
    const res = await cpi("POST", `/requests/${encodeURIComponent(opts.request)}/result`, {
      claimToken: opts["claim-token"],
      outcome: "failed",
      summary: "Could not create the GitHub issue",
      error: String(opts.error).slice(0, 2000),
    });
    if (res.status !== 200) fail(`Recording the failure failed (HTTP ${res.status}).`, { api: res.data?.error });
    return print({ status: "failed-recorded" });
  }

  fail("Usage: node automation/cpi-github.mjs <claim|draft|heartbeat|publish|fail> [options]");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
