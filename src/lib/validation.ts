import { z } from "zod";
import { AUTOMATION_STATUSES, CHANNELS, PRIORITIES, PRODUCT_AREAS, REQUEST_STATUSES, REQUEST_TYPES } from "./domain";

// Rejects content that looks like a Social Security number or a full account number.
const SENSITIVE_PATTERNS = [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{9,17}\b/];
const noSensitiveData = (value: string) => !SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
const SENSITIVE_MESSAGE =
  "Remove Social Security numbers or full account numbers. Refer to accounts by type or last four digits only.";

const text = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine(noSensitiveData, SENSITIVE_MESSAGE);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine(noSensitiveData, SENSITIVE_MESSAGE)
    .default("");

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Tags must be at least 2 characters.")
  .max(32, "Tags must be 32 characters or fewer.")
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Tags may contain lowercase letters, numbers, and hyphens.");

export const tagsSchema = z
  .array(tag)
  .max(8, "Use at most 8 tags.")
  .transform((tags) => [...new Set(tags)]);

export const createRequestSchema = z.object({
  title: text(8, 140, "Title"),
  requestType: z.enum(REQUEST_TYPES, "Choose a request type."),
  clientId: z.string().trim().min(1).nullable().default(null),
  advisorId: z.string().trim().min(1, "Choose the submitting advisor."),
  productArea: z.enum(PRODUCT_AREAS, "Choose a product area."),
  channel: z.enum(CHANNELS, "Choose the affected channel."),
  priority: z.enum(PRIORITIES, "Choose a priority.").default("medium"),
  originalFeedback: text(20, 4000, "Detailed feedback"),
  problemStatement: optionalText(2000, "Problem statement"),
  requestedOutcome: text(10, 2000, "Requested outcome"),
  currentWorkaround: optionalText(2000, "Current workaround"),
  businessImpact: text(10, 2000, "Business impact"),
  expectedBenefit: optionalText(2000, "Expected benefit"),
  tags: tagsSchema.default([]),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const updateRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    title: text(8, 140, "Title").optional(),
    requestType: z.enum(REQUEST_TYPES).optional(),
    clientId: z.string().trim().min(1).nullable().optional(),
    advisorId: z.string().trim().min(1).optional(),
    productArea: z.enum(PRODUCT_AREAS).optional(),
    channel: z.enum(CHANNELS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(REQUEST_STATUSES).optional(),
    ownerId: z.string().trim().min(1).nullable().optional(),
    originalFeedback: text(20, 4000, "Original feedback").optional(),
    problemStatement: optionalText(2000, "Problem statement").optional(),
    requestedOutcome: text(10, 2000, "Requested outcome").optional(),
    currentWorkaround: optionalText(2000, "Current workaround").optional(),
    businessImpact: text(10, 2000, "Business impact").optional(),
    expectedBenefit: optionalText(2000, "Expected benefit").optional(),
    tags: tagsSchema.optional(),
    statusReason: z.string().trim().max(500).optional(),
  })
  .strict();
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;

export const noteSchema = z.object({
  body: text(2, 4000, "Note"),
});

export const queueSchema = z.object({
  force: z.boolean().optional().default(false),
});

const leaseSeconds = z.number().int().min(30).max(3600).optional();
const workerId = z.string().trim().min(1).max(120);

export const claimSchema = z.object({
  workerId,
  leaseSeconds,
});

export const automationStatusSchema = z.object({
  claimToken: z.string().min(10),
  status: z.literal("processing"),
  message: z.string().trim().max(500).optional(),
  leaseSeconds,
});

const issueKey = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, "Issue keys look like PROJ-123.");
const issueUrl = z
  .string()
  .trim()
  .url("Provide a valid URL.")
  .max(500)
  .refine((u) => /^https:\/\//i.test(u), "Issue URLs must use https.");

export const externalReferenceSchema = z.object({
  claimToken: z.string().min(10),
  issueKey,
  issueUrl,
  system: z.string().trim().min(2).max(40).default("jira"),
});

export const resultSchema = z
  .object({
    claimToken: z.string().min(10),
    outcome: z.enum(["completed", "failed"]),
    summary: z.string().trim().min(1).max(2000),
    error: z.string().trim().max(2000).optional(),
    externalIssue: z.object({ key: issueKey, url: issueUrl, system: z.string().trim().min(2).max(40).default("jira") }).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.outcome !== "failed" || (v.error && v.error.length > 0), {
    message: "Provide an error description when the outcome is failed.",
    path: ["error"],
  });

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.array(z.enum(REQUEST_STATUSES)).optional(),
  priority: z.array(z.enum(PRIORITIES)).optional(),
  productArea: z.array(z.enum(PRODUCT_AREAS)).optional(),
  requestType: z.array(z.enum(REQUEST_TYPES)).optional(),
  automationStatus: z.array(z.enum(AUTOMATION_STATUSES)).optional(),
  clientId: z.string().trim().optional(),
  advisorId: z.string().trim().optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(["id", "title", "submitted", "updated", "priority", "status", "automation"]).default("submitted"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    destination: z.enum(["mock", "external"]).optional(),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\//i.test(v), "Webhook URLs must start with https:// (or http:// for localhost).")
      .optional(),
    secret: z
      .string()
      .trim()
      .min(16, "Signing secrets must be at least 16 characters.")
      .max(200)
      .optional(),
    autoQueue: z.boolean().optional(),
    includeClientIdentity: z.boolean().optional(),
    mockFailureMode: z.boolean().optional(),
  })
  .strict();

/** Parses list filters from URL search params (repeatable or comma-separated values). */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const multi = (key: string) => {
    const values = params.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    return values.length ? values : undefined;
  };
  return listQuerySchema.parse({
    q: params.get("q") || undefined,
    status: multi("status"),
    priority: multi("priority"),
    productArea: multi("productArea"),
    requestType: multi("requestType") ?? multi("type"),
    automationStatus: multi("automationStatus"),
    clientId: params.get("clientId") || undefined,
    advisorId: params.get("advisorId") || undefined,
    updatedSince: params.get("updatedSince") || undefined,
    sort: params.get("sort") || undefined,
    dir: params.get("dir") || undefined,
    page: params.get("page") || undefined,
    pageSize: params.get("pageSize") || undefined,
  });
}
