import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function readJson(req, res) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 10_000) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Search request is too large.' }));
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid request.')); }
    });
    req.on('error', reject);
  });
}

function decodeHtml(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec))).trim();
}

async function searchWeb(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.slice(0, 300))}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 DPIntelligence/1.0', 'Accept': 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Web search is temporarily unavailable. Try again in a moment.');
  const html = await response.text();
  const links = [...html.matchAll(/<a\b(?=[^>]*\bclass="[^"]*result__a)[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const results = [];
  for (let i = 0; i < links.length && results.length < 6; i++) {
    let href = links[i][1].replace(/&amp;/g, '&');
    try {
      const parsed = new URL(href.startsWith('//') ? `https:${href}` : href);
      const destination = parsed.searchParams.get('uddg');
      if (destination) href = destination;
      const safeUrl = new URL(href);
      if (!['http:', 'https:'].includes(safeUrl.protocol) || safeUrl.hostname.includes('duckduckgo.com')) continue;
    } catch { continue; }
    const nextLinkStart = links[i].index + links[i][0].length;
    const nextResultStart = html.indexOf('result__a', nextLinkStart);
    const region = html.slice(nextLinkStart, nextResultStart > -1 ? nextResultStart : nextLinkStart + 2500);
    const snippetMatch = region.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    results.push({ title: decodeHtml(links[i][2]), url: href, snippet: decodeHtml(snippetMatch?.[1] || '') });
  }
  return results;
}

async function searchImages(query) {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [key, value] of Object.entries({
    action: 'query', generator: 'search', gsrsearch: query.slice(0, 180), gsrnamespace: '6', gsrwhat: 'text',
    gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800', format: 'json', formatversion: '2'
  })) api.searchParams.set(key, value);
  const response = await fetch(api, { headers: { 'User-Agent': 'DPIntelligence/1.0 (local personal assistant)', 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Image search is temporarily unavailable.');
  const data = await response.json();
  const pages = Array.isArray(data.query?.pages) ? data.query.pages : Object.values(data.query?.pages || {});
  const images = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.mime?.startsWith('image/') || !info.thumburl || !info.descriptionurl) continue;
    try {
      const thumbnail = new URL(info.thumburl);
      const source = new URL(info.descriptionurl);
      if (thumbnail.hostname !== 'upload.wikimedia.org' || source.hostname !== 'commons.wikimedia.org') continue;
      images.push({ title: decodeHtml(page.title.replace(/^File:/i, '').replace(/_/g, ' ')), thumbnail: thumbnail.href, source: source.href });
    } catch { continue; }
    if (images.length >= 4) break;
  }
  return images;
}

const weatherCodes = new Map([
  [0, 'Clear sky'], [1, 'Mainly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [45, 'Fog'], [48, 'Depositing rime fog'],
  [51, 'Light drizzle'], [53, 'Moderate drizzle'], [55, 'Dense drizzle'], [56, 'Light freezing drizzle'], [57, 'Dense freezing drizzle'],
  [61, 'Light rain'], [63, 'Moderate rain'], [65, 'Heavy rain'], [66, 'Light freezing rain'], [67, 'Heavy freezing rain'],
  [71, 'Light snow'], [73, 'Moderate snow'], [75, 'Heavy snow'], [77, 'Snow grains'], [80, 'Light rain showers'], [81, 'Moderate rain showers'], [82, 'Violent rain showers'],
  [85, 'Light snow showers'], [86, 'Heavy snow showers'], [95, 'Thunderstorm'], [96, 'Thunderstorm with light hail'], [99, 'Thunderstorm with heavy hail']
]);

async function weatherFor(location) {
  const query = location.trim().slice(0, 120);
  if (!query) throw new Error('Tell me a city or country to check its weather.');
  const geocode = async name => {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', name);
    url.searchParams.set('count', '10');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Location search is temporarily unavailable.');
    return (await response.json()).results || [];
  };
  // Check exact country names alongside place lookup so country-only requests use the capital.
  const countryLookup = (async () => {
    const url = new URL(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}`);
    url.searchParams.set('fields', 'name,capital,cca2');
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const countries = await response.json();
      return countries.find(item => item.name?.common?.toLowerCase() === query.toLowerCase()) || null;
    } catch { return null; }
  })();
  const [places, country] = await Promise.all([geocode(query), countryLookup]);
  let place;
  if (country?.capital?.[0]) {
    const capitals = await geocode(`${country.capital[0]}, ${country.name.common}`);
    place = capitals.find(item => item.feature_code === 'PPLC') || capitals[0];
  }
  if (!place) {
    place = places.find(item => item.feature_code === 'PPLC') || places[0];
  }
  if (!place) throw new Error(`I couldn't identify “${query}”. Try a city or country name.`);
  const forecast = new URL('https://api.open-meteo.com/v1/forecast');
  forecast.searchParams.set('latitude', String(place.latitude));
  forecast.searchParams.set('longitude', String(place.longitude));
  forecast.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m');
  forecast.searchParams.set('temperature_unit', 'celsius');
  forecast.searchParams.set('wind_speed_unit', 'kmh');
  forecast.searchParams.set('timezone', 'auto');
  const response = await fetch(forecast, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Current weather is temporarily unavailable. Please try again shortly.');
  const data = await response.json();
  const current = data.current;
  if (!current || !Number.isFinite(current.temperature_2m)) throw new Error('Weather data was unavailable for that location.');
  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    localTime: current.time,
    temperatureC: current.temperature_2m,
    temperatureF: Math.round((current.temperature_2m * 9 / 5 + 32) * 10) / 10,
    feelsLikeC: current.apparent_temperature,
    feelsLikeF: Math.round((current.apparent_temperature * 9 / 5 + 32) * 10) / 10,
    humidityPercent: current.relative_humidity_2m,
    precipitationMm: current.precipitation,
    windKmh: current.wind_speed_10m,
    condition: weatherCodes.get(current.weather_code) || 'Unspecified conditions',
    isDay: Boolean(current.is_day),
    source: 'Open-Meteo'
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/weather') {
    (async () => {
      try {
        const { location } = await readJson(req, res);
        if (res.writableEnded) return;
        if (typeof location !== 'string') throw new Error('Enter a city or country for the weather lookup.');
        const weather = await weatherFor(location);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ weather }));
      } catch (error) {
        if (res.writableEnded) return;
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message || 'Could not retrieve current weather.' }));
      }
    })();
    return;
  }
  if (req.method === 'POST' && req.url === '/api/search') {
    (async () => {
      try {
        const { query } = await readJson(req, res);
        if (res.writableEnded) return;
        if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a question to search the web.');
        const results = await searchWeb(query.trim());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ results }));
      } catch (error) {
        if (res.writableEnded) return;
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message || 'Could not reach the AI service.' }));
      }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/images') {
    (async () => {
      try {
        const { query } = await readJson(req, res);
        if (res.writableEnded) return;
        if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a question to find related images.');
        const images = await searchImages(query.trim());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ images }));
      } catch (error) {
        if (res.writableEnded) return;
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message || 'Could not search for images.' }));
      }
    })();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const safe = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\]*\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, safe));
    res.writeHead(200, { 'Content-Type': types[extname(safe)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  }
});

server.listen(port, host, () => console.log(`DP Intelligence is ready on ${host}:${port}`));
