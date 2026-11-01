---
name: utilities-weather
description: Look up current weather and forecasts for a place, with the Open-Meteo attribution.
---

# Weather

Weather comes from Open-Meteo over the network, so each call asks for permission unless the user has allowed `utilities_weather_*`.

## Pick the place

- A clear place name, such as "Amsterdam", or coordinates such as `"52.37,4.89"`, can go straight into `location`.
- For a name that several places share, such as "Springfield", call `utilities_weather_geocode` first, show the matches, and then use the chosen coordinates. Pass `country` (for example `US`) to narrow the search.

## Choose the tool

- Now: `utilities_weather_current`.
- The next days: `utilities_weather_daily` (`days`, up to 16).
- The next hours: `utilities_weather_hourly` (`hours`, up to 384).
- A quick outlook: `utilities_weather_summary` gives a headline and counts of wet, hot or windy days.
- Planning around weather: `utilities_weather_demand_signal` gives daily values with flags such as `rain_likely` or `hot_day`. The flags are fixed thresholds, not predictions.

Missing readings are `null`; say a value is unavailable rather than inventing one. Units are in the result.

## Attribution and terms

Every result includes `attribution`. When you show weather data, credit it: "Weather data by Open-Meteo.com (CC BY 4.0)".

Without a key, the free tier is for non-commercial use only and is rate-limited. For commercial use, the user adds an Open-Meteo API key: run `/connect` and choose Open-Meteo. `utilities_status` shows which tier is in use and whether the key works.
