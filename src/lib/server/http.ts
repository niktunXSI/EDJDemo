import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { redact } from "./redact";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} was not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);

export function json<T>(body: T, init?: number | ResponseInit) {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(body, {
    ...responseInit,
    headers: { "Cache-Control": "no-store", ...(responseInit?.headers ?? {}) },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      error.status,
    );
  }
  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "validation_failed",
          message: "The request body failed validation.",
          details: {
            fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
          },
        },
      },
      422,
    );
  }
  console.error("[api] unhandled error:", redact(error instanceof Error ? (error.stack ?? error.message) : error, 2000));
  return json({ error: { code: "internal_error", message: "An unexpected error occurred." } }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
  }
  try {
    return await request.json();
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}

/** Wraps a route handler so thrown ApiError / ZodError values become consistent JSON errors. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function baseUrlFrom(request: Request, configured: string): string {
  if (configured) return configured;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
  if (host) return `${proto || new URL(request.url).protocol.replace(":", "")}://${host}`;
  return new URL(request.url).origin;
}
