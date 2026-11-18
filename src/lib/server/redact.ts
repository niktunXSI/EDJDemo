const SECRET_PATTERNS: RegExp[] = [
  /whsec_[A-Za-z0-9_-]+/g,
  /cpi_(live|demo)_[A-Za-z0-9_-]+/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(signature[=:]\s*)[a-f0-9]{16,}/gi,
  /(v1=)[a-f0-9]{16,}/gi,
  /([?&](?:token|key|secret|sig|signature|api_key|apikey)=)[^&\s]+/gi,
  /(\/\/[^/\s:@]+:)[^@\s/]+@/g,
];

const knownSecrets = new Set<string>();

/** Registers a runtime secret value so it is masked wherever redact() runs. */
export function registerSecret(value: string | null | undefined) {
  if (value && value.length >= 8) knownSecrets.add(value);
}

export function redact(input: unknown, maxLength = 500): string {
  let text = typeof input === "string" ? input : input instanceof Error ? input.message : JSON.stringify(input);
  if (!text) return "";
  for (const secret of knownSecrets) {
    text = text.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Shows only the last four characters of a secret. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  const prefix = value.startsWith("whsec_") ? "whsec_" : value.startsWith("cpi_demo_") ? "cpi_demo_" : "";
  return `${prefix}${"•".repeat(10)}${tail}`;
}

/** Strips credentials and query strings from a URL for display. */
export function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    const hadQuery = url.search !== "";
    url.search = "";
    url.hash = "";
    return `${url.toString()}${hadQuery ? "?…" : ""}`;
  } catch {
    return "[invalid URL]";
  }
}
