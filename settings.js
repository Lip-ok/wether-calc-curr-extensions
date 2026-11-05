import {
  FALLBACK_CURRENCIES,
  currencyLabel,
  fetchMarket,
} from "./currency.js";
import { loadState, saveState } from "./storage.js";
import { extension, isStale } from "./util.js";

const $ = (id) => document.getElementById(id);
let state = await loadState();
let catalog = state.currencyCatalog?.length ? state.currencyCatalog : FALLBACK_CURRENCIES;

document.documentElement.dataset.theme = state.theme;
$("version").textContent = extension()?.runtime?.getManifest
  ? `Версия ${extension().runtime.getManifest().version}`
  : "Локальный просмотр";
$("note").textContent = "Яндекс Браузер не поддерживает боковую панель chrome.sidePanel. Расширение открывается окном по иконке, а кнопка «Открыть во вкладке» оставляет панель на экране.";

applyForm();
renderFavorites();
bind();
refreshCatalog();

function bind() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => persist({ theme: button.dataset.themeChoice }));
  });
  $("weather-interval").addEventListener("change", (event) => {
    persist({ weatherRefreshMinutes: Number(event.target.value) }, { reschedule: true });
  });
  $("currency-interval").addEventListener("change", (event) => {
    persist({ currencyRefreshMinutes: Number(event.target.value) }, { reschedule: true });
  });
  $("temperature-unit").addEventListener("change", (event) => {
    persist({ temperatureUnit: event.target.value });
  });
  $("wind-unit").addEventListener("change", (event) => {
    persist({ windUnit: event.target.value });
  });
  $("add-favorite").addEventListener("click", addFavorite);
  $("clear-history").addEventListener("click", () => {
    persist({
      calcHistory: [],
      calculator: { expression: "", result: "0", error: "", justEvaluated: false },
    }, { toast: "История очищена" });
  });
  $("clear-weather").addEventListener("click", () => {
    persist({ weatherCache: null }, { toast: "Кэш погоды сброшен" });
  });
  $("clear-rates").addEventListener("click", () => {
    persist({ ratesCache: null }, { toast: "Кэш курсов сброшен" });
  });
}

function applyForm() {
  $("weather-interval").value = String(state.weatherRefreshMinutes);
  $("currency-interval").value = String(state.currencyRefreshMinutes);
  $("temperature-unit").value = state.temperatureUnit;
  $("wind-unit").value = state.windUnit;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === state.theme;
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
}

async function persist(partial, { reschedule = false, toast = "Сохранено" } = {}) {
  state = await saveState(partial);
  document.documentElement.dataset.theme = state.theme;
  applyForm();
  renderFavorites();
  if (reschedule) notifyBackground();
  if (toast) showToast(toast);
}

function addFavorite() {
  const code = $("add-currency").value;
  if (!code || state.favorites.includes(code)) return;
  if (state.favorites.length >= 8) {
    showToast("Можно сохранить только 8 валют");
    return;
  }
  persist({ favorites: [...state.favorites, code] });
}

function renderFavorites() {
  const list = $("favorite-list");
  list.replaceChildren();
  for (const code of state.favorites) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = currencyLabel(code, catalog);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Убрать";
    remove.addEventListener("click", () => {
      persist({ favorites: state.favorites.filter((itemCode) => itemCode !== code) });
    });
    item.append(name, remove);
    list.append(item);
  }

  const select = $("add-currency");
  const current = select.value;
  select.replaceChildren();
  for (const item of catalog) {
    if (state.favorites.includes(item.iso_code)) continue;
    const option = document.createElement("option");
    option.value = item.iso_code;
    option.textContent = currencyLabel(item.iso_code, catalog);
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  $("add-favorite").disabled = select.options.length === 0 || state.favorites.length >= 8;
}

async function refreshCatalog() {
  if (state.currencyCatalog?.length && !isStale(state.catalogFetchedAt, 7 * 24 * 60)) return;
  try {
    const market = await fetchMarket();
    catalog = market.currencies;
    state = await saveState({
      currencyCatalog: market.currencies,
      catalogFetchedAt: market.fetchedAt,
      ratesCache: { fetchedAt: market.fetchedAt, date: market.date, rates: market.rates },
    });
    renderFavorites();
  } catch {
    catalog = state.currencyCatalog?.length ? state.currencyCatalog : FALLBACK_CURRENCIES;
  }
}

function notifyBackground() {
  const runtime = extension()?.runtime;
  if (!runtime?.sendMessage) return;
  runtime.sendMessage({ type: "reschedule" }).catch(() => {});
}

let toastTimer = 0;
function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 1600);
}
