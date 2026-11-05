export async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Сервер ответил с ошибкой ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Превышено время ожидания ответа");
    }
    if (error instanceof Error && error.message.startsWith("Сервер ответил")) {
      throw error;
    }
    throw new Error("Нет соединения с сервером");
  } finally {
    clearTimeout(timer);
  }
}

export function isStale(timestamp, minutes) {
  if (!timestamp) return true;
  return Date.now() - timestamp >= minutes * 60 * 1000;
}

export function capitalize(text) {
  if (!text) return "";
  return text.charAt(0).toLocaleUpperCase("ru-RU") + text.slice(1);
}

export function formatClock(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatLongDate(date) {
  return capitalize(new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date));
}

export function formatUpdated(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatIsoDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function extension() {
  return typeof chrome !== "undefined" ? chrome : null;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
