import { fetchMarket } from "./currency.js";
import { loadState, saveState } from "./storage.js";
import { fetchForecast } from "./weather.js";

// Яндекс Браузер не реализует chrome.sidePanel, поэтому панель открывается
// через action.default_popup. Периодическое обновление идёт через alarms
// и не зависит от того, открыт ли popup.

chrome.runtime.onInstalled.addListener(() => {
  schedule().catch(() => {});
  refreshCurrency().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  schedule().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "weather-refresh") refreshWeather().catch(() => {});
  if (alarm.name === "currency-refresh") refreshCurrency().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "reschedule") return undefined;
  schedule()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function schedule() {
  const state = await loadState();
  await chrome.alarms.create("weather-refresh", {
    periodInMinutes: state.weatherRefreshMinutes,
  });
  await chrome.alarms.create("currency-refresh", {
    periodInMinutes: state.currencyRefreshMinutes,
  });
}

async function refreshWeather() {
  const state = await loadState();
  if (!state.city) return;
  const weatherCache = await fetchForecast(state.city, {
    temperature: state.temperatureUnit,
    wind: state.windUnit,
  });
  await saveState({ weatherCache });
}

async function refreshCurrency() {
  const market = await fetchMarket();
  await saveState({
    ratesCache: {
      fetchedAt: market.fetchedAt,
      date: market.date,
      rates: market.rates,
    },
    currencyCatalog: market.currencies,
    catalogFetchedAt: market.fetchedAt,
  });
}
