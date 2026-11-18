import { describe, expect, it } from "vitest";
import { isAdminIdentity } from "@/lib/server/session";
import type { VerifiedIdentity } from "../cursor/identity";

const base = {
  verified: true as const,
  simulated: false,
  token: "",
  sub: "user:1",
  name: "Viewer",
  idp: { provider: "cursor" as const, sub: "1" },
  stage: "production" as const,
  expiresAt: new Date(),
  claims: {},
};

const person = (extra: Record<string, unknown>) =>
  ({ ...base, kind: "person", userId: 1, email: "viewer@example.com", emailVerified: true, ...extra }) as unknown as VerifiedIdentity;

describe("administrator rules", () => {
  it("admits team admins and refuses team members", () => {
    expect(isAdminIdentity(person({ appVisibility: "team", teamId: 1, teamRole: "admin" }), [])).toBe(true);
    expect(isAdminIdentity(person({ appVisibility: "team", teamId: 1, teamRole: "member" }), [])).toBe(false);
  });

  it("admits private-app viewers only when their verified email is allowlisted", () => {
    expect(isAdminIdentity(person({ appVisibility: "private" }), [])).toBe(false);
    expect(isAdminIdentity(person({ appVisibility: "private" }), ["viewer@example.com"])).toBe(true);
    expect(isAdminIdentity(person({ appVisibility: "private", emailVerified: false }), ["viewer@example.com"])).toBe(false);
  });

  it("never treats API keys as administrators", () => {
    const key = { ...base, kind: "key", email: "", emailVerified: false, ownerUserId: 1, appVisibility: "private" } as unknown as VerifiedIdentity;
    expect(isAdminIdentity(key, ["viewer@example.com"])).toBe(false);
  });
});
