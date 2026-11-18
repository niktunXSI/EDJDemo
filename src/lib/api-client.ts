import { CSRF_COOKIE, CSRF_HEADER } from "./session-constants";

export interface FieldError {
  path: string;
  message: string;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fields: FieldError[] = [],
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

/** Calls an internal UI endpoint with the demo session's CSRF token and normalised errors. */
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        [CSRF_HEADER]: readCookie(CSRF_COOKIE),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("The server could not be reached. Check your connection and try again.", 0, "network_error");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiClientError(
      error.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error.code ?? "unknown_error",
      error.details?.fields ?? [],
      error.details,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
