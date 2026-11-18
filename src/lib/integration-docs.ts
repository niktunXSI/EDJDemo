export function curlExamples(baseUrl: string, requestId: string) {
  return `# Configure once
export CPI_BASE_URL="${baseUrl}"
export CPI_API_KEY="<Agent API key from Integrations → Connection>"

# 1. Discover queued work (works even if webhook delivery is unavailable)
curl -s "$CPI_BASE_URL/api/v1/requests?automationStatus=queued&pageSize=10" \\
  -H "Authorization: Bearer $CPI_API_KEY"

# 2. Read the latest revision and its activity history
curl -s "$CPI_BASE_URL/api/v1/requests/${requestId}" -H "Authorization: Bearer $CPI_API_KEY"
curl -s "$CPI_BASE_URL/api/v1/requests/${requestId}/activity" -H "Authorization: Bearer $CPI_API_KEY"

# 3. Claim it (atomic; a second worker receives 409 already_claimed)
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/${requestId}/claim" \\
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \\
  -d '{"workerId":"cursor-automation","leaseSeconds":600}'
# → { "data": { "claimToken": "clm_…", "leaseExpiresAt": "…", "job": { … } } }

# 4. Report progress (also extends the lease)
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/${requestId}/automation-status" \\
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \\
  -d '{"claimToken":"clm_…","status":"processing","message":"Drafting engineering ticket","leaseSeconds":600}'

# 5. Attach the issue your workflow created (idempotent)
curl -s -X PUT "$CPI_BASE_URL/api/v1/requests/${requestId}/external-reference" \\
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \\
  -d '{"claimToken":"clm_…","issueKey":"CPI-123","issueUrl":"https://your-org.atlassian.net/browse/CPI-123","system":"jira"}'

# 6. Record the outcome (idempotent; replays return "replayed": true)
curl -s -X POST "$CPI_BASE_URL/api/v1/requests/${requestId}/result" \\
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \\
  -d '{"claimToken":"clm_…","outcome":"completed","summary":"Created CPI-123 with acceptance criteria."}'
# Failures: {"claimToken":"clm_…","outcome":"failed","summary":"Could not create ticket","error":"Project not found"}

# Alternative to steps 1 and 3: claim the oldest queued request (204 when the queue is empty)
curl -s -X POST "$CPI_BASE_URL/api/v1/automation/claim-next" \\
  -H "Authorization: Bearer $CPI_API_KEY" -H "Content-Type: application/json" \\
  -d '{"workerId":"cursor-automation"}'`;
}

export const NODE_VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody must be the exact bytes received (do not re-serialize parsed JSON).
export function verifyCpiWebhook(rawBody, headers, secret, toleranceSeconds = 300) {
  const timestamp = headers["x-cpi-timestamp"];
  const provided = String(headers["x-cpi-signature"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => Buffer.from(part.slice(3), "hex"));
  if (!/^\\d+$/.test(timestamp ?? "") || provided.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false; // replay protection

  const expected = createHmac("sha256", secret).update(\`\${timestamp}.\${rawBody}\`, "utf8").digest();
  return provided.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
}`;

export const PYTHON_VERIFY_SNIPPET = `import hashlib, hmac, time

def verify_cpi_webhook(raw_body: bytes, headers: dict, secret: str, tolerance: int = 300) -> bool:
    timestamp = headers.get("x-cpi-timestamp", "")
    signatures = [p.strip()[3:] for p in headers.get("x-cpi-signature", "").split(",") if p.strip().startswith("v1=")]
    if not timestamp.isdigit() or not signatures:
        return False
    if abs(time.time() - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in signatures)`;

export const SIGNATURE_HEADERS = `POST <your webhook URL>
Content-Type: application/json
User-Agent: EdwardJones-ClientProductInsights-Webhooks/1.0
X-CPI-Event-Id: evt_3f6c…            (stable across retries — use it to deduplicate)
X-CPI-Event-Type: feedback.request.queued
X-CPI-Delivery-Attempt: 1
X-CPI-Timestamp: 1795036800          (Unix seconds)
X-CPI-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`;
