# Agent API reference (v1)

The Agent API is how an external automation workflow (for example a Cursor automation) discovers, claims, and reports on requests. It is JSON over HTTPS.

- **Base URL:** `https://<your deployment>/api/v1`
- **Authentication:** `Authorization: Bearer <key>` on every call (`X-API-Key: <key>` is also accepted). Use a key from `AGENT_API_KEYS`, or, when that variable is empty, the generated demo key shown on **Integrations → Connection → Agent API key**.
- **Discovery:** `GET /api/v1` (no key required) lists the endpoints.

```bash
export CPI_BASE_URL="https://insights.example.com"
export CPI_API_KEY="cpi_demo_…"
```

## Processing model

```
queued ──claim──▶ processing ──result: completed──▶ completed
   ▲                  │  └────result: failed──────▶ failed
   └── lease expires ─┘
```

1. A person queues a request; the app sends `feedback.request.queued` (see [WEBHOOKS.md](./WEBHOOKS.md)).
2. The workflow **claims** the request. The claim is a single conditional `UPDATE`, so exactly one worker receives a `claimToken`; others get `409 already_claimed`.
3. The claim holds a **lease** (default 300 s, 30–3600 s allowed). Report progress with `automation-status` to extend it. If the lease expires, the request returns to `queued` and can be claimed again; the old token stops working.
4. The workflow attaches the external issue it created and records a **result**. Results and references are idempotent per claim token.

Business status (New, Under Review, Planned, …) is owned by people in the UI. The API changes only automation fields.

## Errors

All errors share one shape:

```json
{ "error": { "code": "already_claimed", "message": "Request CPI-1033 is already being processed by another worker.", "details": { "claimedBy": "cursor-automation", "leaseExpiresAt": "…" } } }
```

| Status | Codes | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Body is not valid JSON |
| 401 | `unauthorized` | Missing or invalid API key |
| 404 | `not_found` | Unknown request |
| 409 | `already_claimed` | Another worker holds an active lease |
| 409 | `not_queued` | Nothing to claim for this request |
| 409 | `stale_claim` | Token unknown, lease expired and reclaimed, or superseded by a newer revision |
| 409 | `already_finalized` | Result already recorded with a different outcome |
| 409 | `superseded`, `job_not_processing` | Job is no longer active |
| 415 | `unsupported_media_type` | Send `Content-Type: application/json` |
| 422 | `validation_failed` | `error.details.fields` lists `{ path, message }` per field |
| 500 | `internal_error` | Unexpected; details are logged server-side (redacted) |

## Endpoints

### `GET /requests`

List requests with filters and pagination.

| Query | Example | Notes |
| --- | --- | --- |
| `q` | `transfer` | Searches IDs, titles, feedback, outcomes, households, advisors, tags |
| `status` | `new,under_review` | `new`, `under_review`, `planned`, `in_progress`, `delivered`, `declined` |
| `priority` | `critical,high` | `critical`, `high`, `medium`, `low` |
| `productArea` | `transfers_payments` | `client_portal`, `advisor_workstation`, `portfolio_reporting`, `document_center`, `account_opening`, `transfers_payments`, `mobile_experience`, `notifications` |
| `requestType` | `enhancement` | `enhancement`, `defect`, `usability`, `reporting`, `integration` |
| `automationStatus` | `queued` | `not_queued`, `queued`, `processing`, `completed`, `failed` |
| `clientId`, `advisorId` | `HH-3102` | Exact match |
| `updatedSince` | `2026-11-01T00:00:00Z` | ISO 8601 with offset |
| `sort`, `dir` | `submitted`, `desc` | `id`, `title`, `submitted`, `updated`, `priority`, `status`, `automation` |
| `page`, `pageSize` | `1`, `25` | `pageSize` max 100 |

```bash
curl -s "$CPI_BASE_URL/api/v1/requests?automationStatus=queued&pageSize=10" -H "Authorization: Bearer $CPI_API_KEY"
```

```json
{
  "data": [
    {
      "id": "CPI-1033", "revision": 1, "title": "Show household-level unrealized gains on the mobile app",
      "type": "enhancement", "productArea": "mobile_experience", "channel": "mobile", "priority": "high",
      "businessStatus": "new", "automationStatus": "queued", "tags": ["mobile", "tax-lots"],
      "submittedBy": { "advisorId": "ADV-205", "name": "Grace Lindqvist", "branch": "Bend Westside Branch" },
      "owner": null, "clientSegment": "Established", "externalReference": null,
      "submittedAt": "…", "updatedAt": "…", "isSample": false,
      "links": { "self": "…/api/v1/requests/CPI-1033", "detailUrl": "…/requests/CPI-1033" }
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "total": 1, "totalPages": 1 }
}
```

### `GET /requests/{id}`

The latest revision as a structured snapshot (same shape as the webhook's `data.request`), plus automation state, job history, and the external reference.

```bash
curl -s "$CPI_BASE_URL/api/v1/requests/CPI-1033" -H "Authorization: Bearer $CPI_API_KEY"
```

```json
{
  "data": {
    "request": { "id": "CPI-1033", "revision": 1, "title": "…", "content": { "originalFeedback": "…", "requestedOutcome": "…" }, "…": "…" },
    "automation": {
      "status": "queued", "summary": null, "updatedAt": "…",
      "currentJob": { "id": "job_…", "revision": 1, "eventId": "evt_…", "correlationId": "cor_…", "status": "queued", "claimedBy": null, "leaseExpiresAt": null },
      "history": [ … ]
    },
    "externalReference": null,
    "links": { "self": "…", "detailUrl": "…", "activity": "…", "claim": "…", "automationStatus": "…", "externalReference": "…", "result": "…" }
  }
}
```

### `GET /requests/{id}/activity`

Activity history, newest first: submissions, status, priority and owner changes, notes, queueing, webhook outcomes, claims, results, and external references.

```bash
curl -s "$CPI_BASE_URL/api/v1/requests/CPI-1033/activity" -H "Authorization: Bearer $CPI_API_KEY"
```

### `POST /requests/{id}/claim`

| Field | Type | Required |
| --- | --- | --- |
| `workerId` | string (1–120) | yes |
| `leaseSeconds` | integer 30–3600 | no (default `AUTOMATION_LEASE_SECONDS`, 300) |

```bash
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/CPI-1033/claim" \
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"workerId":"cursor-automation","leaseSeconds":600}'
```

```json
{ "data": { "claimToken": "clm_…", "leaseExpiresAt": "2026-11-18T20:42:48.379Z", "job": { "id": "job_…", "revision": 1, "status": "processing", "claimedBy": "cursor-automation", "…": "…" } } }
```

Keep the `claimToken`; every later call for this job requires it.

### `POST /automation/claim-next`

Claims the oldest queued request across the system. Same body as `claim`. Returns `200` with the claim, or `204 No Content` when nothing is queued.

### `POST /requests/{id}/automation-status`

Progress update and lease renewal while processing.

```bash
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/CPI-1033/automation-status" \
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"claimToken":"clm_…","status":"processing","message":"Drafting engineering ticket","leaseSeconds":600}'
```

`status` must be `processing` (terminal states are set with `result`). A changed `message` is added to the activity timeline.

### `PUT /requests/{id}/external-reference`

Attach the issue your workflow created. Idempotent: sending the same key and URL again returns `"changed": false`.

| Field | Rules |
| --- | --- |
| `claimToken` | required |
| `issueKey` | like `PROJ-123` |
| `issueUrl` | `https://` URL |
| `system` | optional, default `jira` |

```bash
curl -s -X PUT "$CPI_BASE_URL/api/v1/requests/CPI-1033/external-reference" \
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"claimToken":"clm_…","issueKey":"MOBILE-482","issueUrl":"https://your-org.atlassian.net/browse/MOBILE-482"}'
```

### `POST /requests/{id}/result`

Record the outcome. Replaying the same outcome with the same token returns `200` with `"replayed": true`; a different outcome returns `409 already_finalized`. Results for a superseded revision or with a reclaimed token return `409 stale_claim`.

| Field | Rules |
| --- | --- |
| `claimToken` | required |
| `outcome` | `completed` or `failed` |
| `summary` | required, up to 2,000 characters |
| `error` | required when `outcome` is `failed` |
| `externalIssue` | optional `{ "key", "url", "system" }`, same rules as above |
| `details` | optional object, stored with the job |

```bash
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/CPI-1033/result" \
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"claimToken":"clm_…","outcome":"completed","summary":"Created MOBILE-482 with acceptance criteria.","externalIssue":{"key":"MOBILE-482","url":"https://your-org.atlassian.net/browse/MOBILE-482"}}'

curl -s -X POST "$CPI_BASE_URL/api/v1/requests/CPI-1033/result" \
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \
  -d '{"claimToken":"clm_…","outcome":"failed","summary":"Could not create the ticket","error":"Target project not found"}'
```

The response includes `currentRevision` and `revisionChangedSinceQueued`, so the workflow can tell whether the request was edited while it was being processed.

### `POST /webhooks/dispatch`

Processes due webhook deliveries and returns expired leases to the queue. Intended for `npm run worker` or a scheduler (cron) on serverless hosting.

```bash
curl -s -X POST "$CPI_BASE_URL/api/v1/webhooks/dispatch" -H "Authorization: Bearer $CPI_API_KEY"
# { "data": { "leasesReleased": 0, "processed": 1, "delivered": 1, "failed": 0, "rescheduled": 0, "paused": false } }
```
