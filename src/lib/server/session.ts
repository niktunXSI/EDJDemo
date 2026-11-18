import "server-only";
import { cookies, headers } from "next/headers";
import { getIdentity, type VerifiedIdentity } from "../../../cursor/identity";
import { CSRF_COOKIE, CSRF_HEADER, DEFAULT_PERSONA_ID, PERSONA_COOKIE, SESSION_COOKIE } from "@/lib/session-constants";
import { config } from "./config";
import { sql } from "./db";
import { ApiError } from "./http";

export interface Persona {
  id: string;
  name: string;
  role: string;
  team: string;
  email: string;
}

export interface Actor {
  type: "user";
  id: string;
  name: string;
  sessionId: string;
  viewer: Viewer;
}

export interface Viewer {
  name: string;
  email: string;
  simulated: boolean;
  isAdmin: boolean;
}

/**
 * Administrators can change integration settings, view or rotate credentials, and reset demo
 * data: Cursor team admins on team apps, plus signed-in people whose verified email is listed in
 * APP_ADMIN_EMAILS. Every other viewer can use the product but not these controls.
 */
export function isAdminIdentity(identity: VerifiedIdentity, adminEmails: string[] = config.adminEmails): boolean {
  if (identity.kind !== "person") return false;
  if (identity.appVisibility === "team" && identity.teamRole === "admin") return true;
  return identity.emailVerified && identity.email !== "" && adminEmails.includes(identity.email.toLowerCase());
}

function toViewer(identity: VerifiedIdentity): Viewer {
  return {
    name: identity.name || identity.email || "Signed-in viewer",
    email: identity.email,
    simulated: identity.simulated,
    isAdmin: isAdminIdentity(identity),
  };
}

/**
 * The signed-in viewer from the hosting platform's identity gate. On a local dev server the
 * helper supplies a simulated viewer, so the UI works without sign-in there.
 */
async function requireViewer(source: Request | Headers): Promise<Viewer> {
  const identity = await getIdentity(source);
  if (!identity.verified) {
    throw new ApiError(401, "unauthenticated", "Sign in to use Client Product Insights.");
  }
  return toViewer(identity);
}

export async function listPersonas(): Promise<Persona[]> {
  return sql<Persona>("select id, name, role, team, email from team_members where is_demo_persona order by id");
}

async function resolvePersona(id: string | undefined): Promise<Persona> {
  const personas = await listPersonas();
  const persona = personas.find((p) => p.id === id) ?? personas.find((p) => p.id === DEFAULT_PERSONA_ID) ?? personas[0];
  if (!persona) throw new ApiError(500, "no_personas", "Demo personas are not seeded. Reset the demo data.");
  return persona;
}

/** For server components: the demo session established by src/proxy.ts. */
export async function getDemoSession() {
  const jar = await cookies();
  const [persona, identity] = await Promise.all([resolvePersona(jar.get(PERSONA_COOKIE)?.value), getIdentity(await headers())]);
  return {
    sessionId: jar.get(SESSION_COOKIE)?.value ?? "pending",
    persona,
    viewer: identity.verified ? toViewer(identity) : null,
  };
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/**
 * Guards UI endpoints: requires a verified viewer, the demo session cookie, and for state
 * changes a same-origin request with a double-submit CSRF token (header must equal the cpi_csrf cookie).
 */
export async function requireUiSession(request: Request): Promise<Actor> {
  const viewer = await requireViewer(request);
  const jar = parseCookies(request.headers.get("cookie"));
  const sessionId = jar[SESSION_COOKIE];
  if (!sessionId) throw new ApiError(401, "no_session", "Your demo session has expired. Reload the page.");

  if (request.method !== "GET" && request.method !== "HEAD") {
    assertSameOrigin(request);
    const csrf = request.headers.get(CSRF_HEADER);
    if (!csrf || !jar[CSRF_COOKIE] || csrf !== jar[CSRF_COOKIE]) {
      throw new ApiError(403, "csrf_failed", "The request could not be verified. Reload the page and try again.");
    }
  }
  const persona = await resolvePersona(jar[PERSONA_COOKIE]);
  return { type: "user", id: persona.id, name: persona.name, sessionId, viewer };
}

/**
 * Rejects cross-site state changes. Modern browsers send Sec-Fetch-Site, which page scripts cannot
 * set and proxies do not rewrite, so it is checked first. Behind a hosting proxy the Host header can
 * differ from the address in the browser, so the Origin fallback accepts any forwarded host name.
 */
export function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new ApiError(403, "cross_origin", "Cross-site requests are not allowed.");
    }
    return;
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>();
  for (const name of ["host", "x-forwarded-host", "x-original-host"]) {
    for (const value of request.headers.get(name)?.split(",") ?? []) {
      if (value.trim()) allowed.add(value.trim().toLowerCase());
    }
  }
  if (config.appBaseUrl) allowed.add(new URL(config.appBaseUrl).host.toLowerCase());
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new ApiError(403, "cross_origin", "Cross-origin requests are not allowed.");
  }
  if (!allowed.has(originHost)) {
    throw new ApiError(403, "cross_origin", "Cross-origin requests are not allowed.");
  }
}

export function requireAdmin(actor: Actor) {
  if (!actor.viewer.isAdmin) {
    throw new ApiError(
      403,
      "forbidden",
      "Only administrators can do this. Team admins qualify automatically; the app owner can add emails to APP_ADMIN_EMAILS.",
    );
  }
}
