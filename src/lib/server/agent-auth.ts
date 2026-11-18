import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { ApiError } from "./http";
import { getSettings } from "./settings";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export interface AgentPrincipal {
  keySource: "environment" | "database";
}

/**
 * Authenticates Agent API calls. Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 * When AGENT_API_KEYS is set, only those keys are accepted; otherwise the demo key generated
 * at first boot (visible on the Integrations page) is used.
 */
export async function requireAgent(request: Request): Promise<AgentPrincipal> {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key")?.trim() ?? "");
  if (!presented) {
    throw new ApiError(401, "unauthorized", "Provide an API key with the Authorization: Bearer header.");
  }
  const envKeys = config.envApiKeys;
  const candidates: { key: string; source: AgentPrincipal["keySource"] }[] = envKeys.length
    ? envKeys.map((key) => ({ key, source: "environment" as const }))
    : [];
  if (!envKeys.length) {
    const stored = (await getSettings()).storedApiKey;
    if (stored) candidates.push({ key: stored, source: "database" });
  }
  const presentedDigest = digest(presented);
  let match: AgentPrincipal | null = null;
  for (const candidate of candidates) {
    if (timingSafeEqual(presentedDigest, digest(candidate.key))) match = { keySource: candidate.source };
  }
  if (!match) throw new ApiError(401, "unauthorized", "The API key is not valid.");
  return match;
}
