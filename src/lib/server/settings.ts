import "server-only";
import { config } from "./config";
import { sql, type Queryable } from "./db";
import { ApiError } from "./http";
import { maskSecret, registerSecret, sanitizeUrl } from "./redact";
import { generateApiKey, generateSigningSecret } from "./seed";

interface ConfigRow {
  enabled: boolean;
  destination: "mock" | "external";
  url: string | null;
  secret: string | null;
  auto_queue: boolean;
  include_client_identity: boolean;
  mock_failure_mode: boolean;
  agent_api_key: string | null;
  updated_at: Date;
  updated_by: string | null;
}

export interface IntegrationSettings {
  enabled: boolean;
  destination: "mock" | "external";
  url: string;
  urlSource: "environment" | "database" | "none";
  secret: string;
  secretSource: "environment" | "database";
  autoQueue: boolean;
  includeClientIdentity: boolean;
  mockFailureMode: boolean;
  storedApiKey: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type PublicIntegrationSettings = Omit<IntegrationSettings, "secret" | "storedApiKey" | "url"> & {
  url: string;
  displayUrl: string | null;
  maskedSecret: string | null;
  maskedApiKey: string | null;
  apiKeySource: "environment" | "database";
  envApiKeyCount: number;
};

export async function getSettings(q: Queryable = { query: sql }): Promise<IntegrationSettings> {
  const [row] = await q.query<ConfigRow>("select * from webhook_config where id = 1");
  if (!row) throw new ApiError(500, "not_configured", "Integration settings are missing.");
  const envUrl = config.envWebhookUrl;
  const envSecret = config.envWebhookSecret;
  const secret = envSecret || row.secret || "";
  registerSecret(secret);
  registerSecret(row.agent_api_key);
  config.envApiKeys.forEach(registerSecret);
  return {
    enabled: row.enabled,
    destination: row.destination,
    url: envUrl || row.url || "",
    urlSource: envUrl ? "environment" : row.url ? "database" : "none",
    secret,
    secretSource: envSecret ? "environment" : "database",
    autoQueue: row.auto_queue,
    includeClientIdentity: row.include_client_identity,
    mockFailureMode: row.mock_failure_mode,
    storedApiKey: row.agent_api_key,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
  };
}

export function toPublicSettings(s: IntegrationSettings): PublicIntegrationSettings {
  return {
    enabled: s.enabled,
    destination: s.destination,
    url: s.urlSource === "environment" ? "" : s.url,
    displayUrl: sanitizeUrl(s.url),
    urlSource: s.urlSource,
    maskedSecret: maskSecret(s.secret),
    secretSource: s.secretSource,
    autoQueue: s.autoQueue,
    includeClientIdentity: s.includeClientIdentity,
    mockFailureMode: s.mockFailureMode,
    maskedApiKey: config.envApiKeys.length ? null : maskSecret(s.storedApiKey),
    apiKeySource: config.envApiKeys.length ? "environment" : "database",
    envApiKeyCount: config.envApiKeys.length,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

const BLOCKED_HOSTS = new Set(["169.254.169.254", "metadata.google.internal", "metadata", "100.100.100.200"]);

export function validateWebhookUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(422, "invalid_webhook_url", "Enter a valid webhook URL.");
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (isLocal || process.env.WEBHOOK_ALLOW_HTTP === "true"))) {
    throw new ApiError(422, "invalid_webhook_url", "Webhook URLs must use https:// (http:// is allowed only for localhost).");
  }
  if (BLOCKED_HOSTS.has(host)) {
    throw new ApiError(422, "invalid_webhook_url", "That host is not allowed as a webhook destination.");
  }
  if (url.username || url.password) {
    throw new ApiError(422, "invalid_webhook_url", "Do not embed credentials in the webhook URL; payloads are signed instead.");
  }
}

export interface SettingsPatch {
  enabled?: boolean;
  destination?: "mock" | "external";
  url?: string;
  secret?: string;
  autoQueue?: boolean;
  includeClientIdentity?: boolean;
  mockFailureMode?: boolean;
}

export async function updateSettings(patch: SettingsPatch, actor: string) {
  const current = await getSettings();
  if (patch.url !== undefined && patch.url !== "") validateWebhookUrl(patch.url);
  if (patch.secret !== undefined && current.secretSource === "environment") {
    throw new ApiError(409, "managed_by_environment", "The signing secret is set by WEBHOOK_SIGNING_SECRET and cannot be changed here.");
  }
  const nextDestination = patch.destination ?? current.destination;
  const nextUrl = patch.url !== undefined ? patch.url : current.url;
  if (nextDestination === "external" && !nextUrl) {
    throw new ApiError(422, "webhook_url_required", "Enter a webhook URL before switching to an external destination.");
  }
  await sql(
    `update webhook_config set
       enabled = coalesce($1, enabled),
       destination = coalesce($2, destination),
       url = case when $3::boolean then nullif($4, '') else url end,
       secret = coalesce($5, secret),
       auto_queue = coalesce($6, auto_queue),
       include_client_identity = coalesce($7, include_client_identity),
       mock_failure_mode = coalesce($8, mock_failure_mode),
       updated_at = now(),
       updated_by = $9
     where id = 1`,
    [
      patch.enabled ?? null,
      patch.destination ?? null,
      patch.url !== undefined,
      patch.url ?? "",
      patch.secret ?? null,
      patch.autoQueue ?? null,
      patch.includeClientIdentity ?? null,
      patch.mockFailureMode ?? null,
      actor,
    ],
  );
  return getSettings();
}

export async function rotateCredential(which: "secret" | "apiKey", actor: string) {
  const current = await getSettings();
  if (which === "secret") {
    if (current.secretSource === "environment") {
      throw new ApiError(409, "managed_by_environment", "The signing secret is managed by WEBHOOK_SIGNING_SECRET.");
    }
    await sql("update webhook_config set secret = $1, updated_at = now(), updated_by = $2 where id = 1", [generateSigningSecret(), actor]);
  } else {
    if (config.envApiKeys.length) {
      throw new ApiError(409, "managed_by_environment", "Agent API keys are managed by AGENT_API_KEYS.");
    }
    await sql("update webhook_config set agent_api_key = $1, updated_at = now(), updated_by = $2 where id = 1", [generateApiKey(), actor]);
  }
  return getSettings();
}

export async function revealCredential(which: "secret" | "apiKey") {
  const s = await getSettings();
  if (which === "secret") {
    if (s.secretSource === "environment") {
      throw new ApiError(409, "managed_by_environment", "The signing secret is managed by WEBHOOK_SIGNING_SECRET and is not shown in the UI.");
    }
    return s.secret;
  }
  if (config.envApiKeys.length) {
    throw new ApiError(409, "managed_by_environment", "Agent API keys are managed by AGENT_API_KEYS and are not shown in the UI.");
  }
  return s.storedApiKey ?? "";
}
