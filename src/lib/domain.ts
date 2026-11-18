export const REQUEST_STATUSES = ["new", "under_review", "planned", "in_progress", "delivered", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const AUTOMATION_STATUSES = ["not_queued", "queued", "processing", "completed", "failed"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REQUEST_TYPES = ["enhancement", "defect", "usability", "reporting", "integration"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const CHANNELS = ["advisor_desktop", "client_web", "mobile", "operations"] as const;
export type Channel = (typeof CHANNELS)[number];

export const PRODUCT_AREAS = [
  "client_portal",
  "advisor_workstation",
  "portfolio_reporting",
  "document_center",
  "account_opening",
  "transfers_payments",
  "mobile_experience",
  "notifications",
] as const;
export type ProductArea = (typeof PRODUCT_AREAS)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  under_review: "Under Review",
  planned: "Planned",
  in_progress: "In Progress",
  delivered: "Delivered",
  declined: "Declined",
};

export const AUTOMATION_LABELS: Record<AutomationStatus, string> = {
  not_queued: "Not Queued",
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const TYPE_LABELS: Record<RequestType, string> = {
  enhancement: "Enhancement",
  defect: "Defect",
  usability: "Usability feedback",
  reporting: "Reporting need",
  integration: "Integration request",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  advisor_desktop: "Advisor desktop",
  client_web: "Client web",
  mobile: "Mobile",
  operations: "Operations",
};

export const PRODUCT_AREA_LABELS: Record<ProductArea, string> = {
  client_portal: "Client Portal",
  advisor_workstation: "Advisor Workstation",
  portfolio_reporting: "Portfolio Reporting",
  document_center: "Document Center",
  account_opening: "Account Opening",
  transfers_payments: "Transfers & Payments",
  mobile_experience: "Mobile Experience",
  notifications: "Notifications & Communications",
};

export const SEGMENTS = ["Emerging", "Established", "Preferred", "Private Client"] as const;

export const WEBHOOK_EVENT_TYPES = {
  requestQueued: "feedback.request.queued",
  test: "integration.test",
} as const;

export const WEBHOOK_SCHEMA_VERSION = "1.0";

export const DELIVERY_STATUSES = ["pending", "sending", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const JOB_STATUSES = ["queued", "processing", "completed", "failed", "superseded"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function labelFor<T extends string>(labels: Record<T, string>, value: string): string {
  return (labels as Record<string, string>)[value] ?? value;
}

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
