# Cursor automation: client requests → GitHub issues

Every new feedback request submitted in Client Product Insights becomes a structured GitHub issue in the repository you configure (`GITHUB_REPO`). The issue key and link appear on the request page.

**Privacy by default.** Issues contain only the product problem, the requested change, its impact, and broad context (request ID, product area, channel, priority, client segment). The helper never copies the client's verbatim feedback, client or household identity, advisor names, or links into the app. It also refuses to publish to a **public** repository unless `ALLOW_PUBLIC_ISSUES=true` is set, which is intended only for demos running on synthetic data like this one. For real client feedback, use a private repository.

```
Submit feedback ──▶ auto-queued ──▶ signed webhook ──▶ Cursor automation (webhook trigger)
                                                        │
                    request page ◀── result + issue link ┤  agent runs automation/cpi-github.mjs:
                                                        │  claim → draft → write issue → publish
                                                        ▼
                                            GitHub issue in GITHUB_REPO
```

A 15-minute schedule trigger on the same automation is a backstop: if a webhook is ever missed, the next scheduled run claims whatever is still queued.

## What was verified

- The helper (`automation/cpi-github.mjs`) was tested end to end against the app: claim, empty-queue handling, progress update, draft, label creation, issue creation, duplicate protection on repeat, and the issue link written back to the request.
- A live test against the issue repository showed that Cursor's built-in GitHub app token can read the repository but **cannot create issues or labels** (`Resource not accessible by integration`). The automation therefore needs its own `GITHUB_TOKEN`.
- Cursor documents webhook, schedule, GitHub, Slack, and Linear triggers. It does not document a GitHub "issue opened" trigger, the webhook trigger's authentication, or whether the webhook body reaches the agent. Cursor staff describe `Authorization: Bearer <key>` for webhook triggers, so the app can send that header (Destination authorization token). The prompt works whether or not the payload reaches the agent.

## Step 1: GitHub token

Create a fine-grained personal access token at **GitHub → Settings → Developer settings → Fine-grained tokens**:

- **Repository access:** only your issue repository
- **Permissions:** Issues — Read and write; Metadata — Read-only

## Step 2: Publish the app and set its secrets

Publish Client Product Insights (private or team). In the app's secrets (Cursor → your app → Secrets), set:

| Secret | Value |
| --- | --- |
| `APP_ADMIN_EMAILS` | Your Cursor sign-in email (comma-separate several). Admins can change integration settings, view credentials, and reset demo data. Team admins qualify automatically. |
| `AGENT_API_KEYS` | A long random value, e.g. from `openssl rand -base64 36`. The automation uses it as `CPI_API_KEY`. |
| `AUTO_QUEUE_NEW_REQUESTS` | `true` so every new submission is queued and announced immediately. |
| `WEBHOOK_URL` | The automation's webhook URL (from Step 3). Setting it switches the destination to External. |
| `WEBHOOK_BEARER_TOKEN` | The automation webhook's API key (from Step 3). Sent as `Authorization: Bearer …`. |
| `WEBHOOK_SIGNING_SECRET` | Optional. 32+ random characters; otherwise one is generated and an admin can reveal it on the Integrations page. |

Instead of the last three secrets, an admin can enter the same values on **Integrations → Connection** (Webhook URL, Destination authorization token, Queue new submissions automatically).

## Step 3: Create the automation

At [cursor.com/automations](https://cursor.com/automations) (or in the Agents Window), create a new automation:

| Setting | Value |
| --- | --- |
| Name | Client requests → GitHub issues |
| Repository | `niktunXSI/EDJDemo`, branch `main` (it contains the helper) |
| Trigger 1 | **Webhook**. After saving, copy the webhook URL and API key into the app (Step 2). |
| Trigger 2 | **Schedule**, every 15 minutes (`*/15 * * * *`) as a backstop |
| Tools | No extra tools needed. Turn off pull request creation. |
| Run as | Your account, or a service account that can read the secrets below |
| Prompt | The full contents of [`automation/PROMPT.md`](../automation/PROMPT.md) |

Add these secrets so the agent receives them as environment variables (Cloud Agents → Secrets, scoped to EDJDemo or to the automation's environment). Mark them as runtime secrets so they are redacted in transcripts.

| Secret | Value |
| --- | --- |
| `CPI_BASE_URL` | The published app's address, e.g. `https://client-product-insights-….cursor.app` |
| `CPI_API_KEY` | The same value as the app's `AGENT_API_KEYS` |
| `CURSOR_APP_TOKEN` | A Cursor API key that can open the app (Dashboard → API keys). It passes the app's sign-in gate via `x-cursor-app-token`. For team apps, a team admin must enable "Allow API keys opening apps". |
| `GITHUB_TOKEN` | The token from Step 1 |
| `GITHUB_REPO` | Your issue repository, as `owner/name` |
| `ALLOW_PUBLIC_ISSUES` | Only if that repository is public and the app holds synthetic demo data: `true`. Leave unset for real data. |

If your team restricts Cloud Agent network access, allow the app's host and `api.github.com`.

## Step 4: Test it

1. On the Integrations page, select **Send test event**. The delivery log should show HTTP 200 from the automation's webhook, and a run should start in Cursor. With no queued requests, it finishes quickly with "No queued requests".
2. Submit a new request. It shows **Queued**, the webhook delivers, and within a minute or two the request shows **Processing**, then **Completed** with an `owner/repo#N` link.
3. In the issue repository, the issue carries the labels `client-request`, `priority: …`, `area: …`, and `type: …`.

## Checking the setup

`node automation/cpi-github.mjs doctor` is read-only. It reports whether every secret is set, whether the app's Agent API is reachable through the sign-in gate, and whether the GitHub repository is reachable, writable, and allowed (public repositories need `ALLOW_PUBLIC_ISSUES=true`).

## Running the helper manually

```bash
export CPI_BASE_URL=https://… CPI_API_KEY=… CURSOR_APP_TOKEN=… GITHUB_TOKEN=… GITHUB_REPO=owner/name
node automation/cpi-github.mjs claim                      # claim the oldest queued request
node automation/cpi-github.mjs draft --request CPI-1033   # structured markdown draft
node automation/cpi-github.mjs publish --request CPI-1033 --claim-token clm_… --title "…" --body-file issue.md [--dry-run]
node automation/cpi-github.mjs fail --request CPI-1033 --claim-token clm_… --error "…"
```

## Guarantees

- **One issue per request.** Claims are atomic, and `publish` looks for an existing issue carrying the request's marker before creating one. A re-queued revision adds a comment to the existing issue instead.
- **Nothing is lost.** If the webhook fails, the delivery is retried with backoff, and the scheduled run picks up anything still queued. Expired leases return requests to the queue.
- **Privacy.** Webhook payloads exclude client identity by default. Issue drafts exclude verbatim feedback, names, and internal links, and public repositories require an explicit opt-in.
