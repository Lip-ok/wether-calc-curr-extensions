import {
  applyInput,
  formatExpression,
  formatScreen,
  initialCalculator,
} from "./calculator.js";
import {
  FALLBACK_CURRENCIES,
  convert,
  currencyLabel,
  formatMoney,
  pairDate,
  parseAmount,
  fetchMarket,
} from "./currency.js";
import { loadState, saveState } from "./storage.js";
import { extension, formatClock, formatIsoDate, formatLongDate, formatUpdated, isStale } from "./util.js";
import {
  cityFromCoordinates,
  cityLabel,
  describeWeather,
  fetchForecast,
  readPosition,
  samePlace,
  searchCities,
  temperatureText,
  weatherMarkup,
  windText,
  withDisplayUnits,
} from "./weather.js";

const $ = (id) => document.getElementById(id);

const dom = {
  date: $("date"),
  clock: $("clock"),
  citySearch: $("city-search"),
  suggestions: $("suggestions"),
  cityName: $("city-name"),
  locate: $("locate"),
  weatherStatus: $("weather-status"),
  temperature: $("temperature"),
  apparent: $("apparent"),
  weatherIcon: $("weather-icon"),
  humidity: $("humidity"),
  wind: $("wind"),
  condition: $("condition"),
  forecast: $("forecast"),
  amount: $("amount"),
  base: $("base-currency"),
  quote: $("quote-currency"),
  conversion: $("conversion"),
  rateLine: $("rate-line"),
  currencyStatus: $("currency-status"),
  favorites: $("favorites"),
  expression: $("calc-expression"),
  calcResult: $("calc-result"),
  history: $("history"),
  toast: $("toast"),
};

let state = null;
let calculator = initialCalculator();
let weatherToken = 0;
let detectToken = 0;
let currencyToken = 0;
let searchTimer = 0;
let saveTimer = 0;

init().catch((error) => {
  console.error(error);
  showToast("Не удалось открыть панель");
});

async function init() {
  state = await loadState();
  calculator = { ...initialCalculator(), ...state.calculator };
  document.documentElement.dataset.theme = state.theme;
  dom.amount.value = state.amount;
  renderClock();
  setInterval(renderClock, 1000);
  renderCalculator();
  renderHistory();
  fillCurrencySelects(state.currencyCatalog || FALLBACK_CURRENCIES);
  renderWeather(displayWeather(), { hint: state.city ? "" : "Выберите город или определите его автоматически" });
  renderCurrency();
  bindEvents();

  if (!state.city) detectCity(false);
  else refreshWeather(false);

  refreshCurrency(false);
}

function bindEvents() {
  $("open-settings").addEventListener("click", openSettings);
  $("open-tab").addEventListener("click", openTab);
  $("refresh-weather").addEventListener("click", () => refreshWeather(true));
  $("locate").addEventListener("click", () => detectCity(true));
  $("refresh-currency").addEventListener("click", () => refreshCurrency(true));
  $("swap").addEventListener("click", swapCurrencies);
  $("copy-result").addEventListener("click", copyResult);
  $("calc-grid").addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]")?.dataset.key;
    if (key) pressKey(key);
  });
  dom.citySearch.addEventListener("input", onCityInput);
  dom.citySearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSuggestions();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".city-search")) hideSuggestions();
  });
  dom.amount.addEventListener("input", () => {
    state.amount = dom.amount.value;
    renderCurrency();
    queueSave();
  });
  dom.base.addEventListener("change", () => {
    state.baseCurrency = dom.base.value;
    renderCurrency();
    queueSave();
  });
  dom.quote.addEventListener("change", () => {
    state.quoteCurrency = dom.quote.value;
    renderCurrency();
    queueSave();
  });
  document.addEventListener("keydown", onKeyboard);
  extension()?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !state) return;
    if (changes.theme?.newValue && changes.theme.newValue !== state.theme) {
      state.theme = changes.theme.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = state.theme;
    }
    const unitsChanged = changes.temperatureUnit || changes.windUnit;
    if (changes.temperatureUnit) state.temperatureUnit = changes.temperatureUnit.newValue === "fahrenheit" ? "fahrenheit" : "celsius";
    if (changes.windUnit) state.windUnit = changes.windUnit.newValue === "ms" ? "ms" : "kmh";
    if (changes.weatherRefreshMinutes) state.weatherRefreshMinutes = changes.weatherRefreshMinutes.newValue;
    if (changes.currencyRefreshMinutes) state.currencyRefreshMinutes = changes.currencyRefreshMinutes.newValue;
    if (changes.favorites && JSON.stringify(changes.favorites.newValue) !== JSON.stringify(state.favorites)) {
      state.favorites = changes.favorites.newValue;
      renderCurrency();
    }
    if (changes.weatherCache) {
      state.weatherCache = changes.weatherCache.newValue;
      const weather = displayWeather();
      renderWeather(weather, {
        hint: weather ? `Обновлено ${formatUpdated(weather.fetchedAt)}` : "Нет сохранённой погоды",
      });
    }
    if (changes.ratesCache) {
      state.ratesCache = changes.ratesCache.newValue;
      renderCurrency(state.ratesCache ? "" : "Курсы ещё не загружены");
    }
    if (changes.calculator?.newValue) {
      calculator = { ...initialCalculator(), ...changes.calculator.newValue };
      state.calculator = calculator;
      renderCalculator();
    }
    if (changes.calcHistory) {
      state.calcHistory = Array.isArray(changes.calcHistory.newValue) ? changes.calcHistory.newValue : [];
      renderHistory();
    }
    if (unitsChanged) refreshWeather(true);
  });
}

function renderClock() {
  const now = new Date();
  dom.clock.textContent = formatClock(now);
  dom.date.textContent = formatLongDate(now);
}

function onCityInput() {
  window.clearTimeout(searchTimer);
  const query = dom.citySearch.value.trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  searchTimer = window.setTimeout(() => runSearch(query), 300);
}

async function runSearch(query) {
  try {
    const cities = await searchCities(query);
    if (dom.citySearch.value.trim() !== query) return;
    renderSuggestions(cities);
  } catch (error) {
    setStatus(dom.weatherStatus, error.message, "error");
  }
}

function renderSuggestions(cities) {
  dom.suggestions.replaceChildren();
  if (cities.length === 0) {
    setStatus(dom.weatherStatus, "Город не найден", "error");
    hideSuggestions();
    return;
  }
  for (const city of cities) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = city.name;
    const meta = document.createElement("small");
    const place = [city.admin1 !== city.name ? city.admin1 : "", city.country].filter(Boolean).join(", ");
    meta.textContent = place;
    button.append(meta);
    button.addEventListener("click", () => chooseCity(city));
    item.append(button);
    dom.suggestions.append(item);
  }
  dom.suggestions.classList.remove("hidden");
}

function hideSuggestions() {
  dom.suggestions.classList.add("hidden");
}

async function chooseCity(city) {
  detectToken += 1;
  hideSuggestions();
  dom.citySearch.value = "";
  state.city = city;
  await saveState({ city });
  refreshWeather(true);
}

async function detectCity(manual) {
  const token = ++detectToken;
  setStatus(dom.weatherStatus, "Определяю местоположение…", "");
  try {
    const position = await readPosition();
    if (token !== detectToken) return;
    const city = await cityFromCoordinates(position.latitude, position.longitude);
    if (token !== detectToken) return;
    state.city = city;
    await saveState({ city });
    await refreshWeather(true);
  } catch (error) {
    if (manual) setStatus(dom.weatherStatus, error.message, "error");
    else if (!state.city) setStatus(dom.weatherStatus, "Выберите город или определите его автоматически", "");
  }
}

async function refreshWeather(force) {
  if (!state.city) {
    if (force) setStatus(dom.weatherStatus, "Сначала выберите город", "error");
    return;
  }
  const units = currentUnits();
  const cached = withDisplayUnits(state.weatherCache, units);
  const fresh = cached && !cached.converted && samePlace(cached, state.city) && !isStale(cached.fetchedAt, state.weatherRefreshMinutes);
  if (!force && fresh) {
    renderWeather(cached, { hint: `Обновлено ${formatUpdated(cached.fetchedAt)}` });
    return;
  }
  if (cached && samePlace(state.weatherCache, state.city)) {
    renderWeather(cached, { hint: "Обновляю…" });
  } else {
    setStatus(dom.weatherStatus, "Обновляю…", "");
    dom.temperature.textContent = "…";
    dom.forecast.replaceChildren();
  }

  const token = ++weatherToken;
  try {
    const weather = await fetchForecast(state.city, units);
    if (token !== weatherToken) return;
    state.weatherCache = weather;
    await saveState({ weatherCache: weather });
    const placeNote = state.city?.name === "Моё местоположение" ? " Название города можно выбрать вручную." : "";
    renderWeather(weather, { hint: `Обновлено ${formatUpdated(weather.fetchedAt)}.${placeNote}` });
  } catch (error) {
    if (token !== weatherToken) return;
    const fallback = withDisplayUnits(state.weatherCache, units);
    if (fallback && samePlace(state.weatherCache, state.city)) {
      renderWeather(fallback, {
        hint: `${error.message}. Показаны сохранённые данные от ${formatUpdated(fallback.fetchedAt)}`,
        error: true,
      });
    } else {
      setStatus(dom.weatherStatus, error.message, "error");
    }
  }
}

function renderWeather(weather, meta = {}) {
  setStatus(dom.weatherStatus, meta.hint || "", meta.error ? "error" : "");
  if (!weather) return;
  const [condition] = describeWeather(weather.current.code);
  dom.temperature.textContent = temperatureText(weather.current.temperature);
  dom.apparent.textContent = `Ощущается ${temperatureText(weather.current.apparent)}`;
  dom.weatherIcon.innerHTML = weatherMarkup(weather.current.code);
  dom.humidity.textContent = Number.isFinite(weather.current.humidity) ? `${Math.round(weather.current.humidity)}%` : "—";
  dom.wind.textContent = windText(weather.current.wind, weather.windUnit);
  dom.condition.textContent = condition;
  dom.condition.title = condition;
  dom.forecast.replaceChildren();
  weather.daily.forEach((day, index) => {
    const article = document.createElement("article");
    const name = document.createElement("p");
    name.textContent = dayLabel(index, day.date);
    const icon = document.createElement("div");
    icon.innerHTML = weatherMarkup(day.code);
    const max = document.createElement("strong");
    max.textContent = temperatureText(day.max);
    const min = document.createElement("em");
    min.textContent = temperatureText(day.min);
    article.append(name, icon, max, min);
    dom.forecast.append(article);
  });
  dom.cityName.textContent = state.city ? cityLabel(state.city) : "";
}

function displayWeather() {
  if (!state.city || !samePlace(state.weatherCache, state.city)) return null;
  return withDisplayUnits(state.weatherCache, currentUnits());
}

function dayLabel(index, isoDate) {
  if (index === 0) return "Сегодня";
  if (index === 1) return "Завтра";
  const [year, month, day] = isoDate.split("-").map(Number);
  const text = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(year, month - 1, day));
  return text.replace(".", "");
}

async function refreshCurrency(force) {
  const cached = state.ratesCache;
  const fresh = cached && !isStale(cached.fetchedAt, state.currencyRefreshMinutes);
  if (!force && fresh) {
    renderCurrency();
    return;
  }
  const token = ++currencyToken;
  try {
    const market = await fetchMarket();
    if (token !== currencyToken) return;
    state.ratesCache = { fetchedAt: market.fetchedAt, date: market.date, rates: market.rates };
    state.currencyCatalog = market.currencies;
    state.catalogFetchedAt = market.fetchedAt;
    await saveState({
      ratesCache: state.ratesCache,
      currencyCatalog: market.currencies,
      catalogFetchedAt: market.fetchedAt,
    });
    fillCurrencySelects(market.currencies);
    renderCurrency();
  } catch (error) {
    if (token !== currencyToken) return;
    renderCurrency(error.message);
  }
}

function renderCurrency(errorMessage = "") {
  const catalog = state.currencyCatalog || FALLBACK_CURRENCIES;
  const rates = state.ratesCache?.rates;
  const amount = parseAmount(state.amount);
  dom.favorites.replaceChildren();

  if (amount === null) {
    dom.conversion.textContent = "—";
    dom.rateLine.textContent = "";
    setStatus(dom.currencyStatus, "Введите корректную сумму", "error");
    return;
  }
  if (!rates) {
    dom.conversion.textContent = "—";
    dom.rateLine.textContent = "";
    setStatus(dom.currencyStatus, errorMessage || "Курсы ещё не загружены", errorMessage ? "error" : "");
    renderFavoriteChips(catalog, null);
    return;
  }

  try {
    const value = convert(amount, state.baseCurrency, state.quoteCurrency, rates);
    const unit = convert(1, state.baseCurrency, state.quoteCurrency, rates);
    const date = pairDate(state.baseCurrency, state.quoteCurrency, rates);
    dom.conversion.textContent = `${formatMoney(value)} ${state.quoteCurrency}`;
    dom.rateLine.textContent = `1 ${state.baseCurrency} = ${formatMoney(unit)} ${state.quoteCurrency}`;
    const stale = isStale(state.ratesCache.fetchedAt, state.currencyRefreshMinutes);
    const prefix = errorMessage
      ? `${errorMessage}. Показан сохранённый курс`
      : (stale ? "Показан сохранённый курс" : "Курс актуален");
    const when = date ? formatIsoDate(date) : formatUpdated(state.ratesCache.fetchedAt);
    setStatus(dom.currencyStatus, `${prefix}: ${when}`, errorMessage ? "error" : (stale ? "" : "ok"));
  } catch (error) {
    dom.conversion.textContent = "—";
    dom.rateLine.textContent = "";
    setStatus(dom.currencyStatus, error.message, "error");
  }
  renderFavoriteChips(catalog, rates);
}

function renderFavoriteChips(catalog, rates) {
  for (const code of state.favorites) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = code;
    const small = document.createElement("small");
    if (rates) {
      try {
        small.textContent = formatMoney(convert(1, state.baseCurrency, code, rates));
      } catch {
        small.textContent = "—";
      }
    }
    button.append(small);
    if (code === state.quoteCurrency) button.classList.add("active");
    button.addEventListener("click", () => {
      state.quoteCurrency = code;
      dom.quote.value = code;
      renderCurrency();
      queueSave();
    });
    item.append(button);
    dom.favorites.append(item);
  }
  if (!catalog) return;
}

function fillCurrencySelects(catalog) {
  const list = catalog?.length ? catalog : FALLBACK_CURRENCIES;
  const selectedBase = state.baseCurrency;
  const selectedQuote = state.quoteCurrency;
  fillSelect(dom.base, list, selectedBase);
  fillSelect(dom.quote, list, selectedQuote);
  state.baseCurrency = dom.base.value;
  state.quoteCurrency = dom.quote.value;
}

function fillSelect(select, catalog, selected) {
  const previous = select.value;
  select.replaceChildren();
  const codes = new Set(catalog.map((item) => item.iso_code));
  const items = codes.has(selected) || !selected ? catalog : [{ iso_code: selected, name: selected }, ...catalog];
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.iso_code;
    option.textContent = currencyLabel(item.iso_code, catalog);
    select.append(option);
  }
  const target = selected || previous;
  if ([...select.options].some((option) => option.value === target)) select.value = target;
}

function swapCurrencies() {
  const base = state.baseCurrency;
  state.baseCurrency = state.quoteCurrency;
  state.quoteCurrency = base;
  dom.base.value = state.baseCurrency;
  dom.quote.value = state.quoteCurrency;
  $("swap").classList.add("turned");
  window.setTimeout(() => $("swap").classList.remove("turned"), 250);
  renderCurrency();
  queueSave();
}

function pressKey(key) {
  const next = applyInput(calculator, key);
  if (next.historyEntry) {
    state.calcHistory = pushHistory(state.calcHistory, next.historyEntry);
    renderHistory();
  }
  const { historyEntry, ...rest } = next;
  calculator = rest;
  state.calculator = calculator;
  renderCalculator();
  queueSave();
}

function renderCalculator() {
  dom.expression.textContent = formatExpression(calculator.expression);
  if (calculator.error) {
    dom.calcResult.textContent = calculator.error;
    dom.calcResult.classList.add("error");
    return;
  }
  dom.calcResult.classList.remove("error");
  const screen = calculator.justEvaluated ? calculator.result : calculator.result;
  dom.calcResult.textContent = formatScreen(screen);
}

function renderHistory() {
  dom.history.replaceChildren();
  for (const entry of state.calcHistory) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.append(document.createTextNode(formatExpression(entry.expression)));
    const result = document.createElement("span");
    result.textContent = formatScreen(entry.result);
    button.append(result);
    button.addEventListener("click", () => {
      calculator = {
        expression: entry.expression,
        result: entry.result,
        error: "",
        justEvaluated: true,
      };
      state.calculator = calculator;
      renderCalculator();
      queueSave();
    });
    item.append(button);
    dom.history.append(item);
  }
  $("history-block").classList.toggle("hidden", state.calcHistory.length === 0);
}

function onKeyboard(event) {
  if (event.target.closest("input, textarea, select")) return;
  const map = {
    Enter: "=",
    Escape: "clear",
    Backspace: "back",
    Delete: "clear",
    ",": ".",
    c: "clear",
    C: "clear",
  };
  const key = map[event.key] || event.key;
  const allowed = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "+", "-", "*", "/", "%", "(", ")", "=", "clear", "back"]);
  if (!allowed.has(key)) return;
  event.preventDefault();
  pressKey(key);
}

async function copyResult() {
  if (calculator.error) return;
  const value = calculator.justEvaluated ? calculator.result : calculator.result;
  try {
    await navigator.clipboard.writeText(value);
    showToast("Результат скопирован");
  } catch {
    showToast("Не удалось скопировать");
  }
}

function pushHistory(history, entry) {
  const rest = history.filter((item) => item.expression !== entry.expression || item.result !== entry.result);
  return [{ ...entry, at: Date.now() }, ...rest].slice(0, 15);
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveState({
      city: state.city,
      favorites: state.favorites,
      baseCurrency: state.baseCurrency,
      quoteCurrency: state.quoteCurrency,
      amount: state.amount,
      calculator: state.calculator,
      calcHistory: state.calcHistory,
    }).catch(() => {});
  }, 150);
}

function currentUnits() {
  return { temperature: state.temperatureUnit, wind: state.windUnit };
}

function setStatus(node, text, kind) {
  node.textContent = text;
  node.classList.toggle("error", kind === "error");
  node.classList.toggle("ok", kind === "ok");
}

function openSettings() {
  const runtime = extension()?.runtime;
  if (runtime?.openOptionsPage) {
    runtime.openOptionsPage();
    return;
  }
  location.href = "settings.html";
}

function openTab() {
  const api = extension();
  const url = api?.runtime?.getURL ? api.runtime.getURL("popup.html") : "popup.html";
  if (api?.tabs?.create) api.tabs.create({ url });
  else window.open(url, "_blank");
}

let toastTimer = 0;
function showToast(text) {
  dom.toast.textContent = text;
  dom.toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.add("hidden"), 1800);
}
