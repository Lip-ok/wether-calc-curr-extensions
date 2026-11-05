import { fetchJson } from "./util.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const CONDITIONS = {
  0: ["Ясно", "clear"],
  1: ["Малооблачно", "mainly"],
  2: ["Переменная облачность", "partly"],
  3: ["Пасмурно", "overcast"],
  45: ["Туман", "fog"],
  48: ["Туман с изморозью", "fog"],
  51: ["Слабая морось", "drizzle"],
  53: ["Морось", "drizzle"],
  55: ["Сильная морось", "drizzle"],
  56: ["Ледяная морось", "drizzle"],
  57: ["Сильная ледяная морось", "drizzle"],
  61: ["Небольшой дождь", "rain"],
  63: ["Дождь", "rain"],
  65: ["Сильный дождь", "rain"],
  66: ["Ледяной дождь", "rain"],
  67: ["Сильный ледяной дождь", "rain"],
  71: ["Небольшой снег", "snow"],
  73: ["Снег", "snow"],
  75: ["Сильный снег", "snow"],
  77: ["Снежные зёрна", "snow"],
  80: ["Небольшой ливень", "showers"],
  81: ["Ливень", "showers"],
  82: ["Сильный ливень", "showers"],
  85: ["Снегопад", "snow"],
  86: ["Сильный снегопад", "snow"],
  95: ["Гроза", "thunder"],
  96: ["Гроза с градом", "thunder"],
  99: ["Сильная гроза с градом", "thunder"],
};

export function describeWeather(code) {
  return CONDITIONS[code] || ["Нет данных", "unknown"];
}

export function weatherMarkup(code) {
  const kind = describeWeather(code)[1];
  return `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">${ICON_BODIES[kind] || ICON_BODIES.unknown}</svg>`;
}

export function cityLabel(city) {
  if (!city) return "Город не выбран";
  const parts = [city.name];
  if (city.admin1 && city.admin1 !== city.name) parts.push(city.admin1);
  if (city.country) parts.push(city.country);
  return parts.filter(Boolean).join(", ");
}

export function temperatureText(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)}°`;
}

export function windText(value, unit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "ms") return `${value.toFixed(1)} м/с`;
  return `${Math.round(value)} км/ч`;
}

export async function searchCities(query) {
  const name = query.trim();
  if (name.length < 2) return [];
  const url = new URL(GEO_URL);
  url.searchParams.set("name", name.slice(0, 80));
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "ru");
  url.searchParams.set("format", "json");
  const data = await fetchJson(url);
  if (!Array.isArray(data.results)) return [];
  return data.results.map(toCity);
}

export async function cityFromCoordinates(latitude, longitude) {
  assertCoords(latitude, longitude);
  const url = new URL(REVERSE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "ru");
  try {
    const data = await fetchJson(url);
    const name = data.city || data.locality || data.principalSubdivision || "Моё местоположение";
    return {
      id: null,
      name,
      country: data.countryName || "",
      admin1: data.principalSubdivision && data.principalSubdivision !== name ? data.principalSubdivision : "",
      latitude,
      longitude,
      timezone: null,
    };
  } catch {
    return {
      id: null,
      name: "Моё местоположение",
      country: "",
      admin1: "",
      latitude,
      longitude,
      timezone: null,
    };
  }
}

export function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Геолокация недоступна в этом браузере"));
      return;
    }
    const timer = setTimeout(() => reject(new Error(geolocationMessage({ code: 3 }))), 9000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        clearTimeout(timer);
        reject(new Error(geolocationMessage(error)));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

export async function fetchForecast(city, units) {
  assertCoords(city.latitude, city.longitude);
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(city.latitude));
  url.searchParams.set("longitude", String(city.longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("temperature_unit", units.temperature === "fahrenheit" ? "fahrenheit" : "celsius");
  url.searchParams.set("wind_speed_unit", units.wind === "ms" ? "ms" : "kmh");

  const data = await fetchJson(url);
  if (!data.current || !data.daily) throw new Error("Сервер погоды вернул неполные данные");

  const daily = [];
  const dates = data.daily.time || [];
  for (let index = 0; index < dates.length; index += 1) {
    daily.push({
      date: dates[index],
      code: data.daily.weather_code?.[index] ?? -1,
      max: data.daily.temperature_2m_max?.[index],
      min: data.daily.temperature_2m_min?.[index],
    });
  }

  return {
    fetchedAt: Date.now(),
    latitude: city.latitude,
    longitude: city.longitude,
    temperatureUnit: units.temperature,
    windUnit: units.wind,
    current: {
      temperature: data.current.temperature_2m,
      apparent: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      wind: data.current.wind_speed_10m,
      code: data.current.weather_code,
    },
    daily,
  };
}

export function samePlace(cache, city) {
  if (!cache || !city) return false;
  return Math.abs(cache.latitude - city.latitude) < 0.05
    && Math.abs(cache.longitude - city.longitude) < 0.05;
}

export function withDisplayUnits(cache, units) {
  if (!cache) return null;
  if (cache.temperatureUnit === units.temperature && cache.windUnit === units.wind) return cache;

  const temperature = (value) => convertTemperature(value, cache.temperatureUnit, units.temperature);
  const wind = (value) => convertWind(value, cache.windUnit, units.wind);
  return {
    ...cache,
    temperatureUnit: units.temperature,
    windUnit: units.wind,
    converted: true,
    current: {
      ...cache.current,
      temperature: temperature(cache.current.temperature),
      apparent: temperature(cache.current.apparent),
      wind: wind(cache.current.wind),
    },
    daily: cache.daily.map((day) => ({
      ...day,
      max: temperature(day.max),
      min: temperature(day.min),
    })),
  };
}

function toCity(result) {
  return {
    id: result.id ?? null,
    name: result.name,
    country: result.country || "",
    admin1: result.admin1 || "",
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone || null,
  };
}

function assertCoords(latitude, longitude) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Некорректная широта");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Некорректная долгота");
  }
}

function convertTemperature(value, from, to) {
  if (!Number.isFinite(value) || from === to) return value;
  if (from === "celsius" && to === "fahrenheit") return value * 9 / 5 + 32;
  if (from === "fahrenheit" && to === "celsius") return (value - 32) * 5 / 9;
  return value;
}

function convertWind(value, from, to) {
  if (!Number.isFinite(value) || from === to) return value;
  if (from === "kmh" && to === "ms") return value / 3.6;
  if (from === "ms" && to === "kmh") return value * 3.6;
  return value;
}

function geolocationMessage(error) {
  if (error?.code === 1) return "Разрешите доступ к геолокации или выберите город вручную";
  if (error?.code === 3) return "Не удалось определить местоположение: истекло время ожидания";
  return "Не удалось определить местоположение";
}

const cloud = `<g fill="#D5DCEA"><circle cx="13" cy="18" r="6"/><circle cx="20" cy="16.5" r="5"/><rect x="8" y="16" width="16" height="7" rx="3.5"/></g>`;
const sun = `<circle cx="12" cy="12" r="5" fill="#F0B429"/>`;

const ICON_BODIES = {
  clear: `<circle cx="16" cy="16" r="6" fill="#F0B429"/><g stroke="#F0B429" stroke-width="2" stroke-linecap="round"><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M24.5 7.5l-2 2M9.5 22.5l-2 2"/></g>`,
  mainly: `${sun}${cloud}`,
  partly: `${sun}${cloud}`,
  overcast: `<g fill="#C5CDDA"><circle cx="12" cy="18" r="6"/><circle cx="20" cy="16" r="6"/><rect x="7" y="16" width="18" height="8" rx="4"/></g>`,
  fog: `<g stroke="#C5CDDA" stroke-width="2" stroke-linecap="round"><path d="M7 12h18M6 16h20M8 20h16"/></g>`,
  drizzle: `${cloud}<g stroke="#6C8CFF" stroke-width="1.8" stroke-linecap="round"><path d="M12 25.5v2M18 25.5v2"/></g>`,
  rain: `${cloud}<g stroke="#6C8CFF" stroke-width="1.8" stroke-linecap="round"><path d="M11 26l-1 3M16 26l-1 3M21 26l-1 3"/></g>`,
  showers: `${cloud}<g stroke="#6C8CFF" stroke-width="2" stroke-linecap="round"><path d="M12 26l-1.2 3.2M17 26l-1.2 3.2M22 26l-1.2 3.2"/></g>`,
  snow: `${cloud}<g fill="#E7EEF8"><circle cx="12" cy="27" r="1.2"/><circle cx="17" cy="28" r="1.2"/><circle cx="22" cy="27" r="1.2"/></g>`,
  thunder: `${cloud}<path d="M15 24l-2 4h3l-1.5 4 5-6h-3l1.5-2z" fill="#F0C14A"/>`,
  unknown: `<circle cx="16" cy="16" r="8" fill="none" stroke="#9299A8" stroke-width="2"/><path d="M16 11v6" stroke="#9299A8" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="21" r="1.2" fill="#9299A8"/>`,
};
