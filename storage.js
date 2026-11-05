import { clampNumber } from "./util.js";

export const STORAGE_KEYS = [
  "theme",
  "temperatureUnit",
  "windUnit",
  "weatherRefreshMinutes",
  "currencyRefreshMinutes",
  "city",
  "favorites",
  "baseCurrency",
  "quoteCurrency",
  "amount",
  "calculator",
  "calcHistory",
  "weatherCache",
  "ratesCache",
  "currencyCatalog",
  "catalogFetchedAt",
];

export const DEFAULTS = {
  theme: "dark",
  temperatureUnit: "celsius",
  windUnit: "kmh",
  weatherRefreshMinutes: 15,
  currencyRefreshMinutes: 60,
  city: null,
  favorites: ["USD", "EUR", "RUB", "GBP", "CHF", "CNY", "PLN"],
  baseCurrency: "RUB",
  quoteCurrency: "USD",
  amount: "1000",
  calculator: { expression: "", result: "0", error: "", justEvaluated: false },
  calcHistory: [],
  weatherCache: null,
  ratesCache: null,
  currencyCatalog: null,
  catalogFetchedAt: 0,
};

const LOCAL_KEY = "smartDashboardState";

export async function loadState() {
  const stored = await readAll();
  return normalize(stored);
}

export async function saveState(partial) {
  const next = {};
  for (const [key, value] of Object.entries(partial)) {
    if (STORAGE_KEYS.includes(key)) next[key] = value;
  }
  await writePartial(next);
  return loadState();
}

function normalize(stored) {
  const state = { ...DEFAULTS, ...stored };
  state.theme = state.theme === "light" ? "light" : "dark";
  state.temperatureUnit = state.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius";
  state.windUnit = state.windUnit === "ms" ? "ms" : "kmh";
  state.weatherRefreshMinutes = allowed(state.weatherRefreshMinutes, [15, 30, 60, 120], 15);
  state.currencyRefreshMinutes = allowed(state.currencyRefreshMinutes, [60, 180, 360, 720, 1440], 60);
  state.favorites = normalizeCodes(state.favorites, DEFAULTS.favorites);
  state.baseCurrency = normalizeCode(state.baseCurrency, "RUB");
  state.quoteCurrency = normalizeCode(state.quoteCurrency, "USD");
  state.amount = typeof state.amount === "string" ? state.amount : DEFAULTS.amount;
  state.city = normalizeCity(state.city);
  state.calculator = normalizeCalculator(state.calculator);
  state.calcHistory = Array.isArray(state.calcHistory)
    ? state.calcHistory.filter(isHistoryItem).slice(0, 15)
    : [];
  state.catalogFetchedAt = clampNumber(state.catalogFetchedAt, 0, Date.now() + 60_000, 0);
  return state;
}

function normalizeCodes(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const codes = [];
  for (const item of value) {
    const code = normalizeCode(item, "");
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes.slice(0, 8);
}

function normalizeCode(value, fallback) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function normalizeCity(city) {
  if (!city || typeof city !== "object") return null;
  const latitude = Number(city.latitude);
  const longitude = Number(city.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!city.name) return null;
  return {
    id: city.id ?? null,
    name: String(city.name).slice(0, 80),
    country: String(city.country || "").slice(0, 80),
    admin1: String(city.admin1 || "").slice(0, 80),
    latitude,
    longitude,
    timezone: city.timezone ? String(city.timezone).slice(0, 80) : null,
  };
}

function normalizeCalculator(value) {
  if (!value || typeof value !== "object") return { ...DEFAULTS.calculator };
  return {
    expression: typeof value.expression === "string" ? value.expression.slice(0, 48) : "",
    result: typeof value.result === "string" ? value.result.slice(0, 32) : "0",
    error: typeof value.error === "string" ? value.error.slice(0, 80) : "",
    justEvaluated: Boolean(value.justEvaluated),
  };
}

function isHistoryItem(item) {
  return item
    && typeof item.expression === "string"
    && typeof item.result === "string";
}

function allowed(value, options, fallback) {
  const number = Number(value);
  return options.includes(number) ? number : fallback;
}

async function readAll() {
  if (hasChromeStorage()) return chrome.storage.local.get(STORAGE_KEYS);
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
  } catch {
    return {};
  }
}

async function writePartial(partial) {
  if (hasChromeStorage()) {
    await chrome.storage.local.set(partial);
    return;
  }
  const current = await readAll();
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...current, ...partial }));
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
