import { NextResponse, type NextRequest } from "next/server";
import { CSRF_COOKIE, PERSONA_COOKIE, SESSION_COOKIE, DEFAULT_PERSONA_ID } from "@/lib/session-constants";

function token() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Establishes the clearly-labelled demo session (session id, persona, and CSRF token cookies). */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const secure = request.nextUrl.protocol === "https:";
  const maxAge = 60 * 60 * 24 * 7;
  if (!request.cookies.get(SESSION_COOKIE)) {
    response.cookies.set(SESSION_COOKIE, `demo_${token().slice(0, 20)}`, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
  }
  if (!request.cookies.get(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, token(), { httpOnly: false, sameSite: "strict", secure, path: "/", maxAge });
  }
  if (!request.cookies.get(PERSONA_COOKIE)) {
    response.cookies.set(PERSONA_COOKIE, DEFAULT_PERSONA_ID, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/v1|api/mock-receiver|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
