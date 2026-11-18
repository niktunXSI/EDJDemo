export const DISPLAY_TIME_ZONE = "America/New_York";
export const DISPLAY_TIME_ZONE_LABEL = "ET";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
});

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return `${dateTimeFormatter.format(new Date(value))} ${DISPLAY_TIME_ZONE_LABEL}`;
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return `${timeFormatter.format(new Date(value))} ${DISPLAY_TIME_ZONE_LABEL}`;
}

export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()) {
  if (!value) return "—";
  const diff = now.getTime() - new Date(value).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let text: string;
  if (abs < 45000) return future ? "in a few seconds" : "just now";
  if (minutes < 60) text = `${minutes} min`;
  else if (hours < 24) text = `${hours} hr`;
  else if (days < 30) text = `${days} day${days === 1 ? "" : "s"}`;
  else return formatDate(value);
  return future ? `in ${text}` : `${text} ago`;
}

export function tenureLabel(since: string, now: Date = new Date()) {
  const years = Math.floor((now.getTime() - new Date(since).getTime()) / (365.25 * 86400000));
  if (years < 1) return "Less than 1 year";
  return `${years} year${years === 1 ? "" : "s"}`;
}

export function initials(name: string) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}
