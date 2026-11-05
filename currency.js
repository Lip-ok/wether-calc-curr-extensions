import { fetchJson } from "./util.js";

const API = "https://api.frankfurter.dev/v2";

export const RU_NAMES = {
  AUD: "Австралийский доллар",
  BRL: "Бразильский реал",
  BYN: "Белорусский рубль",
  CAD: "Канадский доллар",
  CHF: "Швейцарский франк",
  CNY: "Китайский юань",
  CZK: "Чешская крона",
  DKK: "Датская крона",
  EUR: "Евро",
  GBP: "Фунт стерлингов",
  HUF: "Венгерский форинт",
  INR: "Индийская рупия",
  JPY: "Японская иена",
  KRW: "Южнокорейская вона",
  KZT: "Казахстанский тенге",
  NOK: "Норвежская крона",
  PLN: "Польский злотый",
  RUB: "Российский рубль",
  SEK: "Шведская крона",
  TRY: "Турецкая лира",
  UAH: "Украинская гривна",
  USD: "Доллар США",
};

export const FALLBACK_CURRENCIES = Object.entries(RU_NAMES).map(([iso_code, name]) => ({
  iso_code,
  name,
  symbol: null,
}));

export async function fetchMarket() {
  const [catalog, rates] = await Promise.all([
    fetchJson(`${API}/currencies`),
    fetchJson(`${API}/rates?base=EUR`),
  ]);

  if (!Array.isArray(catalog) || !Array.isArray(rates)) {
    throw new Error("Сервер курсов вернул неожиданный ответ");
  }

  const currencies = catalog
    .filter((item) => item?.iso_code && item.iso_numeric)
    .map((item) => ({
      iso_code: item.iso_code,
      name: item.name || item.iso_code,
      symbol: item.symbol || null,
    }))
    .sort((a, b) => a.iso_code.localeCompare(b.iso_code));

  const known = new Set(currencies.map((item) => item.iso_code));
  const rateMap = { EUR: { rate: 1, date: "" } };
  let latest = "";

  for (const row of rates) {
    if (!row || typeof row.rate !== "number" || !known.has(row.quote)) continue;
    const previous = rateMap[row.quote];
    if (!previous || String(row.date) > String(previous.date)) {
      rateMap[row.quote] = { rate: row.rate, date: row.date };
    }
    if (String(row.date) > latest) latest = row.date;
  }
  rateMap.EUR.date = latest;

  const available = currencies.filter((item) => item.iso_code === "EUR" || rateMap[item.iso_code]);
  return {
    fetchedAt: Date.now(),
    date: latest,
    rates: rateMap,
    currencies: available,
  };
}

export function convert(amount, from, to, rates) {
  if (!Number.isFinite(amount)) throw new Error("Введите корректную сумму");
  if (amount < 0 || amount > 1e12) throw new Error("Сумма вне допустимого диапазона");
  if (from === to) return amount;
  const fromRate = rateOf(rates, from);
  const toRate = rateOf(rates, to);
  if (fromRate === null || toRate === null) {
    throw new Error(`Нет курса для пары ${from}/${to}`);
  }
  return amount * (toRate / fromRate);
}

export function pairDate(from, to, rates) {
  const dates = [rates?.[from]?.date, rates?.[to]?.date].filter(Boolean).sort();
  return dates[0] || "";
}

export function currencyName(code, catalog) {
  if (RU_NAMES[code]) return RU_NAMES[code];
  const found = catalog?.find((item) => item.iso_code === code);
  return found?.name || code;
}

export function currencyLabel(code, catalog) {
  return `${code} · ${currencyName(code, catalog)}`;
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  let digits = 2;
  if (absolute > 0 && absolute < 0.01) digits = 6;
  else if (absolute < 1) digits = 4;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

export function parseAmount(raw) {
  const normalized = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "" || normalized === ".") return 0;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value > 1e12) return null;
  return value;
}

function rateOf(rates, code) {
  if (code === "EUR") return rates?.EUR?.rate ?? 1;
  const rate = rates?.[code]?.rate;
  return typeof rate === "number" && rate > 0 ? rate : null;
}
