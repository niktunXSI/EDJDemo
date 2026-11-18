# Outbound webhook contract

Client Product Insights announces requests that people explicitly queue for automation with a signed HTTPS `POST`. The webhook is a notification only. The receiving workflow must still **claim** the request through the [Agent API](./API.md) before processing it, and delivery success never means the request was processed.

## When events are sent

| Event type | Sent when |
| --- | --- |
| `feedback.request.queued` | Someone selects **Queue for automation** (or **Re-queue**) on a request, or a new request is submitted while **Queue new submissions automatically** is on (off by default). |
| `integration.test` | Someone selects **Send test event** on the Integrations page. No action is required. |

Queueing is idempotent per request revision. Clicking **Queue for automation** repeatedly while a job for the current revision is queued or processing returns the existing job and does not create another event. Editing a request creates a new revision; queueing that revision supersedes the older job, and results posted with the older claim are rejected as stale.

## Request format

```
POST <webhook URL>
Content-Type: application/json
User-Agent: EdwardJones-ClientProductInsights-Webhooks/1.0
X-CPI-Event-Id: evt_2eb623237946404c952fe51eb013cd8b
X-CPI-Event-Type: feedback.request.queued
X-CPI-Delivery-Attempt: 1
X-CPI-Timestamp: 1795000000
X-CPI-Signature: v1=<64 hex characters>
Authorization: Bearer <token>        (only when a destination authorization token is configured)
```

The body is the event envelope. A complete example captured from the running application is in [`sample-webhook-payload.json`](./sample-webhook-payload.json).

```jsonc
{
  "id": "evt_…",                       // stable across all retries of this event; use it to deduplicate
  "type": "feedback.request.queued",
  "schemaVersion": "1.0",
  "occurredAt": "2026-11-18T20:32:47.110Z",
  "source": "edward-jones.client-product-insights",
  "environment": "demo",               // "production" when DEMO_MODE=false
  "correlationId": "cor_…",            // carry this through your logs and tickets
  "data": {
    "requestId": "CPI-1033",
    "revision": 1,                     // the revision that was queued
    "automationJobId": "job_…",
    "request": {                       // structured snapshot of that revision
      "id", "revision", "title", "type", "productArea", "channel", "priority",
      "businessStatus", "automationStatus", "tags",
      "content": { "originalFeedback", "problemStatement", "requestedOutcome",
                   "currentWorkaround", "businessImpact", "expectedBenefit" },
      "submittedBy": { "advisorId", "name", "branch", "region" },
      "owner": { "id", "name", "role", "team" } | null,
      "clientContext": { "segment", "region", "relationshipTenureYears",
                         "householdMembers", "preferredChannel" } | null,
      "relatedRequests": [{ "id", "title", "status", "priority" }],
      "submittedAt", "updatedAt"
    },
    "links": {
      "detailUrl":   "https://<app>/requests/CPI-1033",
      "apiUrl":      "https://<app>/api/v1/requests/CPI-1033",
      "activityUrl": "https://<app>/api/v1/requests/CPI-1033/activity",
      "claimUrl":    "https://<app>/api/v1/requests/CPI-1033/claim",
      "resultUrl":   "https://<app>/api/v1/requests/CPI-1033/result"
    },
    "instructions": "Claim the request through the Agent API before processing. …"
  }
}
```

**Client data minimisation.** By default `clientContext` carries only the segment, region, tenure in years, household size, and preferred channel. Household name, primary contact, and city are added only when **Include client identity in webhook payloads** is turned on. No account numbers or personal identifiers exist in the system; the submission form rejects text that looks like a Social Security number or a full account number.

## Signature

```
signed_payload = "<X-CPI-Timestamp>" + "." + "<raw request body>"
signature      = hex( HMAC_SHA256( key = signing secret, message = signed_payload ) )
header         = "X-CPI-Signature: v1=" + signature
```

- The secret is the **Webhook signing secret** on the Integrations page (or `WEBHOOK_SIGNING_SECRET`).
- Sign and verify the **exact raw bytes** of the body. Do not parse and re-serialize the JSON first.
- `X-CPI-Signature` may contain several comma-separated `v1=` values. Accept the request if any of them matches.
- Reject the request if the timestamp is more than **300 seconds** from your current time (replay protection).
- Compare signatures in constant time.

### Verification procedure

1. Read the raw body and the `X-CPI-Timestamp` and `X-CPI-Signature` headers.
2. Reject if either header is missing or the timestamp is not an integer.
3. Reject if `|now - timestamp| > 300`.
4. Compute `HMAC_SHA256(secret, timestamp + "." + rawBody)` as lowercase hex.
5. Accept if it equals any `v1=` value (constant-time comparison); otherwise respond `401`.
6. Deduplicate on `X-CPI-Event-Id` (the same event can arrive more than once).
7. Respond `2xx` quickly, then do the work asynchronously.

### Node.js

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyCpiWebhook(rawBody, headers, secret, toleranceSeconds = 300) {
  const timestamp = headers["x-cpi-timestamp"];
  const provided = String(headers["x-cpi-signature"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => Buffer.from(part.slice(3), "hex"));
  if (!/^\d+$/.test(timestamp ?? "") || provided.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return provided.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
}
```

### Python

```python
import hashlib, hmac, time

def verify_cpi_webhook(raw_body: bytes, headers: dict, secret: str, tolerance: int = 300) -> bool:
    timestamp = headers.get("x-cpi-timestamp", "")
    signatures = [p.strip()[3:] for p in headers.get("x-cpi-signature", "").split(",") if p.strip().startswith("v1=")]
    if not timestamp.isdigit() or not signatures:
        return False
    if abs(time.time() - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in signatures)
```

### Test vector

Use this to check a verifier (disable the timestamp tolerance check, since the timestamp is fixed):

| Input | Value |
| --- | --- |
| Secret | `whsec_example_secret_for_docs_only_1234` |
| `X-CPI-Timestamp` | `1795000000` |
| Raw body | the exact contents of [`sample-webhook-body.min.json`](./sample-webhook-body.min.json) (2,066 bytes, no trailing newline) |
| Expected `X-CPI-Signature` | `v1=b108d810606b114ea6b62e77ec6fdf561e0dedf026f2f096e062d78cb997c606` |

```bash
printf '%s' "1795000000.$(cat docs/sample-webhook-body.min.json)" \
  | openssl dgst -sha256 -hmac 'whsec_example_secret_for_docs_only_1234' -hex
```

## Delivery, retries, and reliability

- **Durable outbox.** The queued state, the automation job, and the outbox row (`webhook_deliveries`) are written in one database transaction, so an event is never lost if the process stops before sending.
- **First attempt immediately.** The app attempts delivery right after queueing and shows the outcome on the request page and in the delivery log.
- **Timeout.** Each attempt waits up to `WEBHOOK_TIMEOUT_MS` (default 8 seconds). Redirects are not followed.
- **Retries.** Network errors, timeouts, HTTP 408, 425, 429, and 5xx are retried with exponential backoff (`WEBHOOK_RETRY_BASE_MS` × 2ⁿ, default 15s, 30s, 60s, 120s, ±20% jitter, capped at 30 minutes) up to `WEBHOOK_MAX_ATTEMPTS` (default 5). Other 4xx responses fail immediately.
- **Same event ID.** Every retry reuses the original event ID and body; only `X-CPI-Delivery-Attempt`, `X-CPI-Timestamp`, and the signature change.
- **Manual retry.** Failed deliveries can be retried from **Integrations → Delivery log**, which grants a fresh retry budget.
- **Who sends retries.** Due deliveries are processed by the in-process worker (`DELIVERY_WORKER_INLINE=true`), by `npm run worker`, by any scheduler calling `POST /api/v1/webhooks/dispatch`, and while someone has the Integrations or request page open with a pending delivery. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so running several dispatchers is safe.
- **Secrets.** The signing secret and API keys stay on the server. Error messages and response excerpts are redacted before they are stored or displayed, and signatures are never logged.
- **Webhook unavailable?** Queued requests are always discoverable with `GET /api/v1/requests?automationStatus=queued` or `POST /api/v1/automation/claim-next`.

## Mock receiver

The built-in mock receiver lets you demonstrate everything without an external endpoint:

- **Built-in mock receiver** destination: events are signed, then verified and recorded in-process. They are labeled **Mock** everywhere and counted separately from external deliveries.
- **Real HTTP round trip locally:** choose **External webhook URL** and enter `http://localhost:4317/api/mock-receiver`.
- **Simulate mock receiver outage** makes the mock respond `503` to demonstrate retries and manual retry.
