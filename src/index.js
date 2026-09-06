'use strict';
const { createHash } = require('node:crypto');
const ATTRIBUTIONS = {
  georef: { name: 'Georef · Datos Argentina', url: 'https://www.argentina.gob.ar/georef' },
  usig: { name: 'USIG · Buenos Aires Ciudad', url: 'https://usig.buenosaires.gob.ar/' },
  photon: { name: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
};
class GeocodingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const text = v => typeof v === 'string' || typeof v === 'number' ? String(v).trim().replace(/\s+/g, ' ') : '';
const fold = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const comparable = v => fold(v).replace(/\b(av|avenida|calle)\.?\b/g, ' ').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
const isCaba = v => /^(caba|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|02)$/.test(fold(v));
function provinceName(v) { if (fold(v).startsWith('tierra del fuego') || fold(v) === 'tdf' || text(v) === '94') return 'Tierra del Fuego'; return isCaba(v) ? 'Ciudad Autónoma de Buenos Aires' : /^(bs\.?\s?as\.?|pcia\.? de buenos aires|06)$/i.test(text(v)) ? 'Buenos Aires' : text(v); }
function coordinates(lat, lng) {
  if (![lat, lng].every(v => (typeof v === 'number' || typeof v === 'string') && text(v) !== '' && Number.isFinite(Number(v)))) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  // Continental Argentina/Tierra del Fuego envelope; not a political border test.
  return point.lat >= -56 && point.lat <= -21 && point.lng >= -74 && point.lng <= -53 ? point : null;
}
function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new GeocodingError('invalid_input');
  const query = text(raw.query || raw.street);
  if (query.length < 3 || query.length > 240) throw new GeocodingError('invalid_query');
  for (const key of ['number', 'city', 'province', 'postcode']) if (text(raw[key]).length > 100) throw new GeocodingError('invalid_context');
  // Apartment/floor is delivery information, not useful to upstream geocoders.
  const parts = query.replace(/\b(?:piso|dpto\.?|depto\.?|departamento|unidad funcional)\s+[\w-]+/gi, '').split(',').map(text).filter(Boolean);
  let street = parts.shift() || '';
  let number = text(raw.number);
  const parsed = street.match(/^(.+?)\s+(\d{1,6}(?:\s*bis)?)$/i);
  // Do not interpret a street called “Calle 12”, “Ruta 3” or “9 de Julio” as a door number.
  if (parsed && !/^(calle|ruta(?: nacional| provincial)?|rn|rp|avenida|av\.?)$/i.test(parsed[1])) {
    street = parsed[1];
    if (!number) number = parsed[2];
  }
  parts.splice(0, parts.length, ...parts.filter(p => fold(p) !== 'argentina'));
  let city = text(raw.city) || (parts.length ? parts[0] : '');
  let province = provinceName(raw.province || (parts.length > 1 ? parts.at(-1) : ''));
  if (isCaba(city) || isCaba(province) || /^C\d{4}/i.test(text(raw.postcode))) {
    city = 'Ciudad Autónoma de Buenos Aires'; province = city;
  }
  return { street, number, city, province, postcode: text(raw.postcode).toUpperCase(), query: [street, number].filter(Boolean).join(' ') };
}
function candidate(provider, values) {
  const point = coordinates(values.lat, values.lng);
  if (!point) return null;
  const address = Object.fromEntries(['street', 'number', 'city', 'province', 'postcode'].map(k => [k, text(values[k])]));
  address.province = provinceName(address.province);
  const label = text(values.label) || [...new Set([[address.street, address.number].filter(Boolean).join(' '), address.city, address.province].filter(Boolean))].join(', ');
  if (!label) return null;
  return { id: `${provider}:${createHash('sha256').update(`${label}|${point.lat}|${point.lng}`).digest('hex').slice(0, 16)}`, ...point, label, address, provider,
    precision: values.precision || (address.number ? 'interpolated' : address.street ? 'street' : 'locality'),
    requiresConfirmation: true, attribution: ATTRIBUTIONS[provider] };
}
function rank(results, input) {
  const ranked = results.filter(Boolean).map(result => {
    const warnings = [];
    const a = result.address;
    let score = result.precision === 'address' ? 35 : result.precision === 'interpolated' ? 25 : 0;
    if (result.precision === 'locality' || result.precision === 'region') warnings.push('approximate_area');
    if (input.number && a.number !== input.number) warnings.push('number_mismatch');
    else if (input.number) score += 25;
    if (comparable(input.street) === comparable(a.street)) score += 25;
    else if (a.street && comparable(a.street).includes(comparable(input.street))) { score += 10; warnings.push('street_partial_match'); }
    else if (a.street) warnings.push('street_mismatch');
    for (const key of ['city', 'province']) {
      if (!input[key]) continue;
      const expected = comparable(provinceName(input[key]));
      const actual = comparable(provinceName(a[key]));
      if (actual === expected || (isCaba(input[key]) && isCaba(a[key]))) score += 15;
      else warnings.push(`${key}_mismatch`);
    }
    return { ...result, score, confidence: warnings.length ? 'low' : score >= 75 ? 'medium' : 'low', warnings };
  }).filter(r => !r.warnings.includes('province_mismatch') || !r.address.province).sort((a, b) => b.score - a.score);
  const unique = [];
  for (const r of ranked) {
    if (unique.some(u => comparable(u.address.street) === comparable(r.address.street) && u.address.number === r.address.number && Math.abs(u.lat-r.lat) < .0002 && Math.abs(u.lng-r.lng) < .0002)) continue;
    unique.push(r);
  }
  return unique.slice(0, 8);
}
function createGeocoder(options = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  const minIntervalMs = options.minIntervalMs ?? 600;
  const cache = new Map(); const pending = new Map(); const gates = new Map();
  const evict = key => { clearTimeout(cache.get(key)?.timer); cache.delete(key); };
  const georefUrl = options.georefUrl === false ? null : options.georefUrl || 'https://apis.datos.gob.ar/georef/api/v2.0';
  const usigUrl = options.usigUrl === false ? null : options.usigUrl || 'https://servicios.usig.buenosaires.gob.ar/normalizar/';
  const photonUrl = options.photonUrl || null; // Own installation or explicitly permitted provider.
  for (const endpoint of [georefUrl, usigUrl, photonUrl].filter(Boolean)) {
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hostname === 'nominatim.openstreetmap.org') throw new GeocodingError('invalid_provider');
  }
  async function json(provider, base, path, params) {
    const deadline = Date.now() + timeoutMs;
    const gate = gates.get(provider) || { next: 0, waiting: 0 };
    if (gate.waiting >= 12) throw new GeocodingError('provider_busy', 503);
    const delay = Math.max(0, gate.next - Date.now());
    if (delay >= timeoutMs) throw new GeocodingError('provider_busy', 503);
    gate.next = Date.now() + delay + minIntervalMs; gate.waiting++; gates.set(provider, gate);
    try {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const url = new URL(`${base.replace(/\/$/, '')}${path}`);
      for (const [key, value] of Object.entries(params)) if (value !== '') url.searchParams.set(key, String(value));
      const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': options.userAgent || 'direcciones-ar/0.1 (https://github.com/franmelx/direcciones-ar)' }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), redirect: 'error' });
      if (!response.ok) throw new GeocodingError('provider_unavailable', 503);
      // Limit upstream data as well as input. Addresses are not logged.
      if (Number(response.headers.get('content-length') || 0) > 1048576) throw new GeocodingError('provider_response_too_large', 503);
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) throw new GeocodingError('provider_response_too_large', 503); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { gate.waiting--; }
  }
  async function georef(input) {
    const province = isCaba(input.province) ? '02' : input.province;
    const data = await json('georef', georefUrl, '/direcciones', { direccion: input.query, provincia: province, localidad_censal: isCaba(input.city) ? '' : input.city, max: 20 });
    if (!Array.isArray(data.direcciones)) throw new GeocodingError('provider_invalid', 503);
    return data.direcciones.map(d => candidate('georef', { lat: d.ubicacion?.lat, lng: d.ubicacion?.lon, street: d.calle?.nombre, number: d.altura?.valor,
      city: d.provincia?.id === '02' ? 'Ciudad Autónoma de Buenos Aires' : d.localidad_censal?.nombre || d.localidad?.nombre, province: d.provincia?.nombre, label: d.nomenclatura,
      precision: d.calle_cruce_1?.nombre ? 'intersection' : d.altura?.valor ? 'interpolated' : 'street' }));
  }
  async function usig(input) {
    const locality = isCaba(input.city) || isCaba(input.province) ? 'CABA' : input.city;
    const data = await json('usig', usigUrl, '/', { direccion: [input.query, locality].filter(Boolean).join(', '), geocodificar: 'TRUE', srid: 4326, maxOptions: 10 });
    if (!Array.isArray(data.direccionesNormalizadas)) throw new GeocodingError('provider_invalid', 503);
    return data.direccionesNormalizadas.map(d => {
      if (Number(d.coordenadas?.srid) !== 4326) return null;
      return candidate('usig', { lat: d.coordenadas?.y, lng: d.coordenadas?.x, street: d.nombre_calle, number: d.altura,
        city: d.nombre_localidad || d.nombre_partido, province: isCaba(d.nombre_partido) ? 'Ciudad Autónoma de Buenos Aires' : 'Buenos Aires', label: d.direccion,
        precision: d.tipo === 'calle_y_calle' ? 'intersection' : 'interpolated' });
    });
  }
  function photonCandidates(data) {
    if (!Array.isArray(data.features)) throw new GeocodingError('provider_invalid', 503);
    return data.features.filter(f => fold(f.properties?.countrycode) === 'ar').map(f => {
      const p = f.properties;
      return candidate('photon', { lat: f.geometry?.coordinates?.[1], lng: f.geometry?.coordinates?.[0], street: p.street, number: p.housenumber, city: p.city || p.town || p.district, province: p.state, postcode: p.postcode, label: p.street ? '' : p.name, precision: p.housenumber ? 'address' : p.street ? 'street' : 'locality' });
    });
  }
  async function execute(kind, input) {
    const tasks = [];
    if (kind === 'search') {
      if (georefUrl) tasks.push(['georef', () => georef(input)]);
      if (georefUrl && !input.number) tasks.push(['georef_localities', async () => {
        const data = await json('georef', georefUrl, '/localidades_censales', { nombre: input.city || input.street, provincia: isCaba(input.province) ? '02' : input.province, max: 5 });
        if (!Array.isArray(data.localidades_censales)) throw new GeocodingError('provider_invalid', 503);
        return data.localidades_censales.map(d => candidate('georef', { lat: d.centroide?.lat, lng: d.centroide?.lon, city: d.nombre, province: d.provincia?.nombre, precision: 'locality' }));
      }]);
      if (usigUrl && (isCaba(input.province) || fold(input.province) === 'buenos aires' || isCaba(input.city))) tasks.push(['usig', () => usig(input)]);
      if (photonUrl) tasks.push(['photon', async () => photonCandidates(await json('photon', photonUrl, '/api', { q: [input.query, input.city, input.province, 'Argentina'].filter(Boolean).join(', '), limit: 10 }))]);
    } else {
      if (georefUrl) tasks.push(['georef', async () => {
        const data = await json('georef', georefUrl, '/ubicacion', { lat: input.lat, lon: input.lng });
        if (!data.ubicacion) throw new GeocodingError('provider_invalid', 503);
        const u = data.ubicacion;
        if (!u.provincia?.id) return [];
        return [candidate('georef', { ...input, city: u.localidad_censal?.nombre || u.departamento?.nombre, province: u.provincia.nombre, precision: 'region' })];
      }]);
      if (photonUrl) tasks.push(['photon', async () => photonCandidates(await json('photon', photonUrl, '/reverse', { lat: input.lat, lon: input.lng, limit: 3 }))]);
    }
    const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
    const providers = tasks.map(([name], i) => ({ name, status: settled[i].status === 'fulfilled' ? 'ok' : 'unavailable' }));
    const found = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(Boolean);
    const candidates = kind === 'search' ? rank(found, input) : found.map(r => ({ ...r, confidence: 'low', warnings: ['confirm_pin'], score: r.precision === 'region' ? 0 : 10 })).sort((a,b) => b.score-a.score);
    const unavailable = !tasks.length || providers.every(p => p.status !== 'ok');
    return { status: candidates.length ? 'ok' : unavailable ? 'unavailable' : 'not_found', candidates, providers, requiresConfirmation: true,
      warnings: [...(providers.some(p => p.status !== 'ok') ? ['partial_provider_failure'] : []), ...(!candidates.length ? ['select_on_map'] : [])] };
  }
  async function cached(kind, input) {
    const key = createHash('sha256').update(JSON.stringify([kind, input])).digest('hex');
    const entry = cache.get(key); if (entry && entry.expires > Date.now()) return structuredClone(entry.value);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (pending.size >= 32) throw new GeocodingError('service_busy', 503);
    const request = execute(kind, input).then(value => {
      if (value.status !== 'unavailable' && !value.warnings.includes('partial_provider_failure')) {
        if (cache.size >= (options.cacheSize ?? 300)) evict(cache.keys().next().value);
        evict(key);
        const ttl = options.cacheTtlMs ?? 300000;
        const timer = setTimeout(() => cache.delete(key), ttl);
        timer.unref();
        cache.set(key, { value, expires: Date.now() + ttl, timer });
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request); return structuredClone(await request);
  }
  return {
    search: raw => cached('search', normalizeInput(raw)),
    reverse: raw => { const point = coordinates(raw?.lat, raw?.lng); if (!point) throw new GeocodingError('invalid_coordinates'); return cached('reverse', point); },
    clearCache: () => { for (const key of cache.keys()) evict(key); },
  };
}
module.exports = { createGeocoder, normalizeInput, coordinates, rank, candidate, GeocodingError, ATTRIBUTIONS };
