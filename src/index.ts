import { createHash } from "node:crypto";
import type {
  GeorefResponse,
  UsigResponse,
  PhotonResponse,
  GeoapifyResponse,
} from "./providers";
import type {
  Options,
  Point,
  NormalizedInput,
  Candidate,
  CandidateBase,
  PredictionBase,
  CandidateValues,
  Provider,
  Unranked,
  Ranked,
  Result,
  Suggestions,
  CatalogResult,
  Geocoder,
} from "./types";
export type * from "./types";
const present = <T>(value: T | null | undefined | false): value is T =>
  value !== null && value !== undefined && value !== false;
const record = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new GeocodingError("invalid_input");
  return raw as Record<string, unknown>;
};
const emptyInput: NormalizedInput = {
  query: "",
  street: "",
  number: "",
  city: "",
  province: "",
  postcode: "",
};
type Operation = "search" | "suggest" | "reverse";
type ExecutionInput = NormalizedInput & Partial<Point>;

export const ATTRIBUTIONS = {
  georef: {
    name: "Georef · Datos Argentina",
    url: "https://www.argentina.gob.ar/georef",
  },
  usig: {
    name: "USIG · Buenos Aires Ciudad",
    url: "https://usig.buenosaires.gob.ar/",
  },
  geoapify: {
    name: "Geoapify · © OpenStreetMap contributors",
    url: "https://www.geoapify.com/",
  },
  photon: {
    name: "© OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
  },
};
export class GeocodingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const text = (v: unknown) =>
  typeof v === "string" || typeof v === "number"
    ? String(v).trim().replace(/\s+/g, " ")
    : "";
const fold = (v: unknown) =>
  text(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const comparable = (v: unknown) =>
  fold(v)
    .replace(/\b(av|avenida|calle)\.?\b/g, " ")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const isCaba = (v: unknown) =>
  /^(caba|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|02)$/.test(
    fold(v),
  );
function provinceName(v: unknown) {
  if (
    fold(v).startsWith("tierra del fuego") ||
    fold(v) === "tdf" ||
    text(v) === "94"
  )
    return "Tierra del Fuego";
  return isCaba(v)
    ? "Ciudad Autónoma de Buenos Aires"
    : /^(bs\.?\s?as\.?|pcia\.? de buenos aires|06)$/i.test(text(v))
      ? "Buenos Aires"
      : text(v);
}
export function coordinates(lat: unknown, lng: unknown): Point | null {
  if (
    ![lat, lng].every(
      (v) =>
        (typeof v === "number" || typeof v === "string") &&
        text(v) !== "" &&
        Number.isFinite(Number(v)),
    )
  )
    return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  // Continental Argentina/Tierra del Fuego envelope; not a political border test.
  return point.lat >= -56 &&
    point.lat <= -21 &&
    point.lng >= -74 &&
    point.lng <= -53
    ? point
    : null;
}
export function normalizeInput(value: unknown): NormalizedInput {
  const raw = record(value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new GeocodingError("invalid_input");
  const query = text(raw.query || raw.street);
  if (query.length < 3 || query.length > 240)
    throw new GeocodingError("invalid_query");
  for (const key of ["number", "city", "province", "postcode"])
    if (text(raw[key]).length > 100)
      throw new GeocodingError("invalid_context");
  // Apartment/floor is delivery information, not useful to upstream geocoders.
  const parts = query
    .replace(
      /\b(?:piso|dpto\.?|depto\.?|departamento|unidad funcional)\s+[\w-]+/gi,
      "",
    )
    .split(",")
    .map(text)
    .filter(Boolean);
  let street = parts.shift() || "";
  let number = text(raw.number);
  const parsed = street.match(/^(.+?)\s+(\d{1,6}(?:\s*bis)?)$/i);
  // Do not interpret a street called “Calle 12”, “Ruta 3” or “9 de Julio” as a door number.
  if (
    parsed &&
    !/^(calle|ruta(?: nacional| provincial)?|rn|rp|avenida|av\.?)$/i.test(
      parsed[1],
    )
  ) {
    street = parsed[1];
    if (!number) number = parsed[2];
  }
  parts.splice(
    0,
    parts.length,
    ...parts.filter((p) => fold(p) !== "argentina"),
  );
  let city = text(raw.city) || (parts.length ? parts[0] : "");
  let province = provinceName(
    raw.province || (parts.length > 1 ? parts.at(-1) : ""),
  );
  if (isCaba(city) || isCaba(province) || /^C\d{4}/i.test(text(raw.postcode))) {
    city = "Ciudad Autónoma de Buenos Aires";
    province = city;
  }
  return {
    street,
    number,
    city,
    province,
    postcode: text(raw.postcode).toUpperCase(),
    query: [street, number].filter(Boolean).join(" "),
  };
}
export function candidate(
  provider: Provider,
  values: CandidateValues,
): CandidateBase | null {
  const point = coordinates(values.lat, values.lng);
  if (!point) return null;
  const address = Object.fromEntries(
    (["street", "number", "city", "province", "postcode"] as const).map((k) => [
      k,
      text(values[k]),
    ]),
  ) as Candidate["address"];
  address.province = provinceName(address.province);
  const label =
    text(values.label) ||
    [
      ...new Set(
        [
          [address.street, address.number].filter(Boolean).join(" "),
          address.city,
          address.province,
        ].filter(Boolean),
      ),
    ].join(", ");
  if (!label) return null;
  return {
    id: `${provider}:${createHash("sha256").update(`${label}|${point.lat}|${point.lng}`).digest("hex").slice(0, 16)}`,
    ...point,
    label,
    address,
    provider,
    precision:
      values.precision ||
      (address.number
        ? "interpolated"
        : address.street
          ? "street"
          : "locality"),
    requiresConfirmation: true,
    attribution: ATTRIBUTIONS[provider],
  };
}
function prediction(
  provider: Provider,
  values: CandidateValues,
): PredictionBase | null {
  const located = candidate(provider, values);
  const address =
    located?.address ||
    (Object.fromEntries(
      (["street", "number", "city", "province", "postcode"] as const).map(
        (k) => [
          k,
          k === "province" ? provinceName(values[k]) : text(values[k]),
        ],
      ),
    ) as Candidate["address"]);
  const label =
    located?.label ||
    text(values.label) ||
    [
      ...new Set(
        [
          [address.street, address.number].filter(Boolean).join(" "),
          address.city,
          address.province,
        ].filter(Boolean),
      ),
    ].join(", ");
  if (!label) return null;
  return {
    ...(located || {
      id: `${provider}:${createHash("sha256").update(label).digest("hex").slice(0, 16)}`,
      lat: null,
      lng: null,
      label,
      address,
      provider,
      precision: address.street ? "street" : "locality",
      attribution: ATTRIBUTIONS[provider],
      requiresConfirmation: true,
    }),
    kind:
      address.number && located
        ? "address"
        : address.street
          ? "street"
          : "locality",
    requiresResolution: !located || !address.number,
    searchInput: {
      query: address.street || address.city,
      number: address.number,
      city: address.city,
      province: address.province,
      postcode: address.postcode,
    },
  };
}
export function rank(
  results: (Unranked | null)[],
  input: NormalizedInput,
): Ranked[] {
  const ranked = results
    .filter(present)
    .map((result) => {
      const warnings: string[] = [];
      const a = result.address;
      let score =
        result.precision === "address"
          ? 35
          : result.precision === "interpolated"
            ? 25
            : 0;
      if (result.precision === "locality" || result.precision === "region")
        warnings.push("approximate_area");
      if (input.number && a.number !== input.number)
        warnings.push("number_mismatch");
      else if (input.number) score += 25;
      if (comparable(input.street) === comparable(a.street)) score += 25;
      else if (
        a.street &&
        comparable(a.street).includes(comparable(input.street))
      ) {
        score += 10;
        warnings.push("street_partial_match");
      } else if (a.street) warnings.push("street_mismatch");
      for (const key of ["city", "province"] as const) {
        if (!input[key]) continue;
        const expected = comparable(provinceName(input[key]));
        const actual = comparable(provinceName(a[key]));
        if (actual === expected || (isCaba(input[key]) && isCaba(a[key])))
          score += 15;
        else warnings.push(`${key}_mismatch`);
      }
      return {
        ...result,
        score,
        confidence: (warnings.length
          ? "low"
          : score >= 75
            ? "medium"
            : "low") as Candidate["confidence"],
        warnings,
      };
    })
    .filter(
      (r) => !r.warnings.includes("province_mismatch") || !r.address.province,
    )
    .sort((a, b) => b.score - a.score);
  const unique: Ranked[] = [];
  for (const r of ranked) {
    if (
      unique.some(
        (u) =>
          comparable(u.address.street) === comparable(r.address.street) &&
          u.address.number === r.address.number &&
          comparable(u.address.city) === comparable(r.address.city) &&
          comparable(u.address.province) === comparable(r.address.province) &&
          u.lat !== null &&
          r.lat !== null &&
          Math.abs(u.lat - r.lat) < 0.0002 &&
          u.lng !== null &&
          r.lng !== null &&
          Math.abs(u.lng - r.lng) < 0.0002,
      )
    )
      continue;
    unique.push(r);
  }
  return unique.slice(0, 8);
}
export function createGeocoder(options: Options = {}): Geocoder {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  const minIntervalMs = options.minIntervalMs ?? 600;
  const cache = new Map<
    string,
    {
      value: Result | CatalogResult;
      expires: number;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const pending = new Map<string, Promise<Result | CatalogResult>>();
  const gates = new Map<string, { next: number; waiting: number }>();
  const evict = (key: string | undefined) => {
    if (key === undefined) return;
    clearTimeout(cache.get(key)?.timer);
    cache.delete(key);
  };
  const georefUrl =
    options.georefUrl === false
      ? null
      : options.georefUrl || "https://apis.datos.gob.ar/georef/api/v2.0";
  const usigUrl =
    options.usigUrl === false
      ? null
      : options.usigUrl ||
        "https://servicios.usig.buenosaires.gob.ar/normalizar/";
  const geoapifyKey = options.geoapifyKey || null;
  const photonUrl = options.photonUrl || null; // Own installation or explicitly permitted provider.
  const publicPhoton =
    photonUrl && new URL(photonUrl).hostname === "photon.komoot.io";
  const photonFallbackOnly =
    options.photonFallbackOnly ?? Boolean(publicPhoton);
  let photonDay = -1,
    photonCalls = 0;
  for (const endpoint of [georefUrl, usigUrl, photonUrl].filter(present)) {
    const url = new URL(endpoint);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname === "nominatim.openstreetmap.org"
    )
      throw new GeocodingError("invalid_provider");
  }
  async function json<T>(
    provider: Provider,
    base: string | null,
    path: string,
    params: Record<string, string | number | null | undefined>,
  ): Promise<T> {
    if (!base) throw new GeocodingError("provider_unavailable", 503);
    const deadline = Date.now() + timeoutMs;
    const gate = gates.get(provider) || { next: 0, waiting: 0 };
    if (gate.waiting >= 12) throw new GeocodingError("provider_busy", 503);
    const delay = Math.max(0, gate.next - Date.now());
    if (delay >= timeoutMs) throw new GeocodingError("provider_busy", 503);
    gate.next = Date.now() + delay + minIntervalMs;
    gate.waiting++;
    gates.set(provider, gate);
    try {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const url = new URL(`${base.replace(/\/$/, "")}${path}`);
      for (const [key, value] of Object.entries(params))
        if (value !== "" && value != null)
          url.searchParams.set(key, String(value));
      if (provider === "photon" && publicPhoton) {
        const day = Math.floor(Date.now() / 86400000);
        if (day !== photonDay) {
          photonDay = day;
          photonCalls = 0;
        }
        if (photonCalls >= 200)
          throw new GeocodingError("provider_budget_exhausted", 503);
        photonCalls++;
      }
      const response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            options.userAgent ||
            "direcciones-ar/0.3 (https://github.com/franmelx/direcciones-ar)",
        },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        redirect: "error",
      });
      if (!response.ok) throw new GeocodingError("provider_unavailable", 503);
      // Limit upstream data as well as input. Addresses are not logged.
      if (Number(response.headers.get("content-length") || 0) > 1048576)
        throw new GeocodingError("provider_response_too_large", 503);
      if (!response.body) throw new GeocodingError("provider_invalid", 503);
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1048576)
            throw new GeocodingError("provider_response_too_large", 503);
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } finally {
      gate.waiting--;
    }
  }
  async function localityContext(input: NormalizedInput) {
    if (!input.city || isCaba(input.city)) return { locality: "", census: "" };
    // Some names identify both a census locality (8-digit ID) and an entity
    // (10-digit ID). Streets reference the entity; a name alone can resolve wrong.
    const context = { query: input.city, province: input.province };
    const data = await cached("localities", context, () =>
      catalog("localities", context),
    );
    const matches = data.items.filter(
      (item) => fold(item.name) === fold(input.city),
    );
    const longest = Math.max(
      0,
      ...matches.map((item) => String(item.id).length),
    );
    const specific = matches.filter(
      (item) => String(item.id).length === longest,
    );
    return {
      locality: specific.length === 1 ? specific[0].id : input.city,
      census: matches.find((item) => String(item.id).length === 8)?.id || "",
    };
  }
  async function georef(input: NormalizedInput) {
    const province = isCaba(input.province) ? "02" : input.province;
    const context = await localityContext(input);
    let data = await json<GeorefResponse>("georef", georefUrl, "/direcciones", {
      direccion: input.query,
      provincia: province,
      localidad: context.locality,
      max: 20,
    });
    if (
      context.census &&
      Array.isArray(data.direcciones) &&
      !data.direcciones.some((d) =>
        coordinates(d.ubicacion?.lat, d.ubicacion?.lon),
      )
    ) {
      data = await json<GeorefResponse>("georef", georefUrl, "/direcciones", {
        direccion: input.query,
        provincia: province,
        localidad_censal: context.census,
        max: 20,
      });
    }
    if (!Array.isArray(data.direcciones))
      throw new GeocodingError("provider_invalid", 503);
    return data.direcciones.map((d) =>
      candidate("georef", {
        lat: d.ubicacion?.lat,
        lng: d.ubicacion?.lon,
        street: d.calle?.nombre,
        number: d.altura?.valor,
        city:
          d.provincia?.id === "02"
            ? "Ciudad Autónoma de Buenos Aires"
            : d.localidad?.nombre || d.localidad_censal?.nombre,
        province: d.provincia?.nombre,
        label: d.nomenclatura,
        precision: d.calle_cruce_1?.nombre
          ? "intersection"
          : d.altura?.valor
            ? "interpolated"
            : "street",
      }),
    );
  }
  async function usig(input: NormalizedInput, suggestions = false) {
    const locality =
      isCaba(input.city) || isCaba(input.province) ? "CABA" : input.city;
    const data = await json<UsigResponse>("usig", usigUrl, "/", {
      direccion: [input.query, locality].filter(Boolean).join(", "),
      geocodificar: "TRUE",
      srid: 4326,
      maxOptions: 10,
    });
    if (!Array.isArray(data.direccionesNormalizadas))
      throw new GeocodingError("provider_invalid", 503);
    return data.direccionesNormalizadas.map((d) => {
      const wgs84 = Number(d.coordenadas?.srid) === 4326;
      if (!wgs84 && !suggestions) return null;
      return (suggestions ? prediction : candidate)("usig", {
        lat: wgs84 ? d.coordenadas?.y : null,
        lng: wgs84 ? d.coordenadas?.x : null,
        street: d.nombre_calle,
        number: d.altura,
        city: d.nombre_localidad || d.nombre_partido,
        province: isCaba(d.nombre_partido)
          ? "Ciudad Autónoma de Buenos Aires"
          : "Buenos Aires",
        label: d.direccion,
        precision: d.tipo === "calle_y_calle" ? "intersection" : "interpolated",
      });
    });
  }
  function photonCandidates(data: PhotonResponse) {
    if (!Array.isArray(data.features))
      throw new GeocodingError("provider_invalid", 503);
    return data.features
      .filter((f) => fold(f.properties?.countrycode) === "ar")
      .map((f) => {
        const p = f.properties;
        return candidate("photon", {
          lat: f.geometry?.coordinates?.[1],
          lng: f.geometry?.coordinates?.[0],
          street: p.street,
          number: p.housenumber,
          city: p.city || p.town || p.district,
          province: p.state,
          postcode: p.postcode,
          label: p.street ? "" : p.name,
          precision: p.housenumber
            ? "address"
            : p.street
              ? "street"
              : "locality",
        });
      });
  }
  async function georefStreets(input: NormalizedInput) {
    const context = await localityContext(input);
    const province = isCaba(input.province) ? "02" : input.province;
    let data = await json<GeorefResponse>("georef", georefUrl, "/calles", {
      nombre: input.street,
      provincia: province,
      localidad: context.locality,
      max: 12,
    });
    if (context.census && Array.isArray(data.calles) && !data.calles.length) {
      data = await json<GeorefResponse>("georef", georefUrl, "/calles", {
        nombre: input.street,
        provincia: province,
        localidad_censal: context.census,
        max: 12,
      });
    }
    if (!Array.isArray(data.calles))
      throw new GeocodingError("provider_invalid", 503);
    return data.calles.map((d) =>
      prediction("georef", {
        label: d.nomenclatura,
        street: d.nombre,
        city:
          d.provincia?.id === "02"
            ? "Ciudad Autónoma de Buenos Aires"
            : d.localidad?.nombre || d.localidad_censal?.nombre,
        province: d.provincia?.nombre,
      }),
    );
  }
  async function geoapify(kind: Operation, input: ExecutionInput) {
    const reverse = kind === "reverse";
    const params = {
      apiKey: geoapifyKey,
      format: "json",
      lang: "es",
      limit: 8,
      ...(reverse
        ? { lat: input.lat, lon: input.lng }
        : {
            text: [input.query, input.city, input.province, "Argentina"]
              .filter(Boolean)
              .join(", "),
            filter: "countrycode:ar",
          }),
    };
    const data = await json<GeoapifyResponse>(
      "geoapify",
      "https://api.geoapify.com/v1/geocode",
      kind === "suggest" ? "/autocomplete" : reverse ? "/reverse" : "/search",
      params,
    );
    if (!Array.isArray(data.results))
      throw new GeocodingError("provider_invalid", 503);
    return data.results
      .filter((d) => fold(d.country_code) === "ar")
      .map((d) =>
        candidate("geoapify", {
          lat: d.lat,
          lng: d.lon,
          street: d.street,
          number: d.housenumber,
          city: d.city || d.town || d.village,
          province: d.state,
          postcode: d.postcode,
          label: d.formatted,
          precision:
            d.result_type === "building" && d.housenumber
              ? "address"
              : d.street
                ? d.housenumber
                  ? "interpolated"
                  : "street"
                : "locality",
        }),
      );
  }
  async function catalog(
    kind: "provinces" | "localities",
    input: { query: string; province: string },
  ): Promise<CatalogResult> {
    if (!georefUrl) return { status: "unavailable", items: [] };
    const key = kind === "provinces" ? "provincias" : "localidades";
    try {
      const data = await json<GeorefResponse>("georef", georefUrl, "/" + key, {
        nombre: input.query,
        ...(kind === "localities"
          ? { provincia: isCaba(input.province) ? "02" : input.province }
          : {}),
        orden: "nombre",
        max: kind === "provinces" ? 24 : 20,
      });
      if (!Array.isArray(data[key]))
        throw new GeocodingError("provider_invalid", 503);
      return {
        status: data[key].length ? "ok" : "not_found",
        items: data[key].map((d) => ({
          id: d.id,
          name: d.nombre,
          ...(d.provincia
            ? {
                province: {
                  id: text(d.provincia.id),
                  name: provinceName(d.provincia.nombre),
                },
              }
            : {}),
          center: coordinates(d.centroide?.lat, d.centroide?.lon),
          precision: kind === "provinces" ? "region" : "locality",
          attribution: ATTRIBUTIONS.georef,
        })),
        total: data.total,
        limit: kind === "provinces" ? 24 : 20,
      };
    } catch {
      return {
        status: "unavailable",
        items: [],
        warnings: ["provider_unavailable"],
      };
    }
  }
  async function execute(
    kind: Operation,
    input: ExecutionInput,
  ): Promise<Result & { predictions?: Suggestions["predictions"] }> {
    const tasks: [string, () => Promise<(Unranked | null)[]>][] = [];
    if (kind === "search" || kind === "suggest") {
      if (georefUrl)
        tasks.push([
          "georef",
          () =>
            kind === "suggest" && !input.number
              ? georefStreets(input)
              : georef(input),
        ]);
      if (georefUrl && !input.number && (kind === "search" || !input.city))
        tasks.push([
          "georef_localities",
          async () => {
            const data = await json<GeorefResponse>(
              "georef",
              georefUrl,
              "/localidades",
              {
                nombre: input.city || input.street,
                provincia: isCaba(input.province) ? "02" : input.province,
                max: 5,
              },
            );
            if (!Array.isArray(data.localidades))
              throw new GeocodingError("provider_invalid", 503);
            return data.localidades.map((d) =>
              candidate("georef", {
                lat: d.centroide?.lat,
                lng: d.centroide?.lon,
                city: d.nombre,
                province: d.provincia?.nombre,
                precision: "locality",
              }),
            );
          },
        ]);
      if (
        usigUrl &&
        (isCaba(input.province) ||
          fold(input.province) === "buenos aires" ||
          isCaba(input.city))
      )
        tasks.push(["usig", () => usig(input, kind === "suggest")]);
      if (photonUrl && !photonFallbackOnly)
        tasks.push([
          "photon",
          async () =>
            photonCandidates(
              await json<PhotonResponse>("photon", photonUrl, "/api", {
                q: [input.query, input.city, input.province, "Argentina"]
                  .filter(Boolean)
                  .join(", "),
                limit: 10,
              }),
            ),
        ]);
    } else {
      if (georefUrl)
        tasks.push([
          "georef",
          async () => {
            const data = await json<GeorefResponse>(
              "georef",
              georefUrl,
              "/ubicacion",
              {
                lat: input.lat,
                lon: input.lng,
              },
            );
            if (!data.ubicacion)
              throw new GeocodingError("provider_invalid", 503);
            const u = data.ubicacion;
            if (!u.provincia?.id) return [];
            return [
              candidate("georef", {
                ...input,
                city: u.localidad_censal?.nombre || u.departamento?.nombre,
                province: u.provincia.nombre,
                precision: "region",
              }),
            ];
          },
        ]);
      if (photonUrl && !photonFallbackOnly)
        tasks.push([
          "photon",
          async () =>
            photonCandidates(
              await json<PhotonResponse>("photon", photonUrl, "/reverse", {
                lat: input.lat,
                lon: input.lng,
                limit: 3,
              }),
            ),
        ]);
    }
    if (geoapifyKey) tasks.push(["geoapify", () => geoapify(kind, input)]);
    const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
    // Public demo is an opt-in fallback for completed addresses and reverse lookups.
    // Partial autocomplete never consumes its budget; own instances can serve all requests.
    const primary = settled
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter(present);
    const adequate =
      kind === "reverse"
        ? primary.some((r) => r.precision === "address")
        : rank(primary, input).some(
            (r) =>
              coordinates(r.lat, r.lng) &&
              r.address.number === input.number &&
              !r.warnings.length,
          );
    if (
      photonUrl &&
      photonFallbackOnly &&
      !adequate &&
      (kind === "reverse" || input.number)
    ) {
      const run = () =>
        json<PhotonResponse>(
          "photon",
          photonUrl,
          kind === "reverse" ? "/reverse" : "/api",
          kind === "reverse"
            ? { lat: input.lat, lon: input.lng, limit: 3 }
            : {
                q: [input.query, input.city, input.province, "Argentina"]
                  .filter(Boolean)
                  .join(", "),
                limit: 10,
              },
        ).then(photonCandidates);
      tasks.push(["photon", run]);
      settled.push(...(await Promise.allSettled([run()])));
    }
    const providers = tasks.map(([name], i) => ({
      name,
      status: settled[i].status === "fulfilled" ? "ok" : "unavailable",
    }));
    const found = settled
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter(present);
    const candidates =
      kind === "search" || kind === "suggest"
        ? rank(found, input).filter(
            (r) => !input.number || !r.warnings.includes("street_mismatch"),
          )
        : found
            .map((r) => ({
              ...r,
              confidence: "low" as const,
              warnings: ["confirm_pin"],
              score: r.precision === "region" ? 0 : 10,
            }))
            .sort((a, b) => b.score - a.score);
    const unavailable =
      !tasks.length || providers.every((p) => p.status !== "ok");
    return {
      ...(kind === "suggest"
        ? {
            predictions: candidates.map((r) => ({
              ...r,
              ...prediction(r.provider, {
                ...r.address,
                lat: r.lat,
                lng: r.lng,
                label: r.label,
                precision: r.precision,
              })!,
            })),
          }
        : {}),
      status: candidates.length
        ? "ok"
        : unavailable
          ? "unavailable"
          : "not_found",
      candidates: candidates.filter(
        (r): r is Ranked & Candidate => coordinates(r.lat, r.lng) !== null,
      ),
      providers,
      requiresConfirmation: true,
      warnings: [
        ...(providers.some((p) => p.status !== "ok")
          ? ["partial_provider_failure"]
          : []),
        ...(!candidates.length ? ["select_on_map"] : []),
      ],
    };
  }
  async function cached<T extends Result | CatalogResult>(
    kind: string,
    input: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = createHash("sha256")
      .update(JSON.stringify([kind, input]))
      .digest("hex");
    const entry = cache.get(key);
    if (entry && entry.expires > Date.now())
      return structuredClone(entry.value) as T;
    if (pending.has(key)) return structuredClone(await pending.get(key)) as T;
    if (pending.size >= 32) throw new GeocodingError("service_busy", 503);
    const request = run()
      .then((value) => {
        if (
          value.status !== "unavailable" &&
          !value.warnings?.includes("partial_provider_failure")
        ) {
          if (cache.size >= (options.cacheSize ?? 300))
            evict(cache.keys().next().value);
          evict(key);
          const ttl = options.cacheTtlMs ?? 300000;
          const timer = setTimeout(() => cache.delete(key), ttl);
          timer.unref();
          cache.set(key, { value, expires: Date.now() + ttl, timer });
        }
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return structuredClone(await request);
  }
  return {
    search: (raw) => {
      const input = normalizeInput(raw);
      return cached("search", input, () => execute("search", input));
    },
    suggest: async (raw) => {
      const input = normalizeInput(raw);
      const result = await cached("suggest", input, () =>
        execute("suggest", input),
      );
      return { ...result, predictions: result.predictions ?? [] };
    },
    provinces: (raw = {}) => {
      const input = normalizeCatalog(raw);
      return cached("provinces", input, () => catalog("provinces", input));
    },
    localities: (raw = {}) => {
      const input = normalizeCatalog(raw);
      if (!input.province && input.query.length < 3)
        throw new GeocodingError("locality_context_required");
      return cached("localities", input, () => catalog("localities", input));
    },
    providers: () => ({
      providers: (
        [
          ["georef", Boolean(georefUrl), "Argentina"],
          ["usig", Boolean(usigUrl), "CABA y AMBA"],
          ["photon", Boolean(photonUrl), "Según instancia configurada"],
          ["geoapify", Boolean(geoapifyKey), "Argentina"],
        ] satisfies [Provider, boolean, string][]
      ).map(([name, enabled, coverage]) => ({
        name,
        enabled,
        coverage,
        attribution: ATTRIBUTIONS[name],
      })),
    }),
    reverse: (raw) => {
      const point = coordinates(raw?.lat, raw?.lng);
      if (!point) throw new GeocodingError("invalid_coordinates");
      return cached("reverse", point, () =>
        execute("reverse", { ...emptyInput, ...point }),
      );
    },
    clearCache: () => {
      for (const key of cache.keys()) evict(key);
    },
  };
}
function normalizeCatalog(value: unknown) {
  const raw = record(value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new GeocodingError("invalid_input");
  const query = text(raw.query);
  const province = provinceName(raw.province);
  if (query.length > 100 || province.length > 100)
    throw new GeocodingError("invalid_context");
  return { query, province };
}
