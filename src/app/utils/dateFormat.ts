import { format } from "date-fns";
import type { Language } from "../i18n";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDisplayDate(value: DateInput, language: Language): string {
  const date = toDate(value);
  if (!date) return "";
  return format(date, language === "zh" ? "yyyy-MM-dd" : "MMM d, yyyy");
}

export function formatDisplayDateTime(value: DateInput, language: Language): string {
  const date = toDate(value);
  if (!date) return "";
  return format(date, language === "zh" ? "yyyy-MM-dd HH:mm" : "MMM d, yyyy h:mm a");
}

export function formatDisplayMonthDay(value: DateInput, language: Language): string {
  const date = toDate(value);
  if (!date) return "";
  return format(date, language === "zh" ? "yyyy-MM-dd" : "MMM d");
}

export function formatDisplayTime(value: DateInput, language: Language): string {
  const date = toDate(value);
  if (!date) return "";
  return format(date, language === "zh" ? "HH:mm" : "h:mm a");
}
