import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createGeocoder,
  normalizeInput,
  coordinates,
  rank,
  candidate,
} from "../src";
import { createHandler } from "../src/http";
const response = (data: unknown) => new Response(JSON.stringify(data));
const fixture = (overrides: Record<string, unknown> = {}) => ({
  altura: { valor: 1234 },
  calle: { nombre: "AV CORRIENTES" },
  provincia: { id: "02", nombre: "Ciudad Autónoma de Buenos Aires" },
  localidad_censal: { nombre: "CABA" },
  ubicacion: { lat: -34.603856, lon: -58.38419 },
  ...overrides,
});
const usig = {
  altura: 1234,
  nombre_calle: "CORRIENTES AV.",
  nombre_localidad: "CABA",
  nombre_partido: "CABA",
  tipo: "calle_altura",
  coordenadas: { srid: 4326, x: "-58.384222", y: "-34.603939" },
};
test("Argentina aliases, numbered streets, dates, separated number, apartment privacy", () => {
  assert.equal(
    normalizeInput({ query: "Av. Corrientes 1234, CABA" }).province,
    "Ciudad Autónoma de Buenos Aires",
  );
  for (const query of ["9 de Julio", "Calle 12", "Ruta 3"])
    assert.equal(normalizeInput({ query }).number, "");
  assert.equal(
    normalizeInput({ query: "Calle 12", number: "400" }).number,
    "400",
  );
  assert.equal(
    normalizeInput({ query: "San Martín 123 piso 2 dpto A, Rosario, Santa Fe" })
      .query,
    "San Martín 123",
  );
  assert.equal(
    normalizeInput({ query: "San Martín", province: "Buenos Aires" }).city,
    "",
  );
  assert.equal(
    normalizeInput({ query: "Calle 12", province: "Bs. As." }).province,
    "Buenos Aires",
  );
  assert.throws(() => normalizeInput({ query: "a".repeat(241) }));
});
test("null, empty, zero, swapped and foreign coordinates are never map locations", () => {
  for (const [a, b] of [
    [null, null],
    ["", ""],
    [0, 0],
    [-58, -34],
    [false, false],
    [-20, -60],
    [Infinity, -60],
  ])
    assert.equal(coordinates(a, b), null);
  assert.deepEqual(coordinates("-54.8", "-68.3"), { lat: -54.8, lng: -68.3 });
});
test("v2 context never fabricates locality or postcode", async () => {
  const urls: string[] = [];
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) => {
      urls.push(String(url));
      return response({
        direcciones: [
          fixture({
            provincia: { nombre: "Santa Fe" },
            localidad_censal: { nombre: "Rosario" },
          }),
        ],
      });
    },
  });
  const r = await g.search({
    query: "Corrientes 1234",
    city: "Santa Fe",
    province: "Santa Fe",
    postcode: "3000",
  });
  const directionUrl = urls.find((url) => url.includes("/direcciones"));
  assert.ok(directionUrl);
  assert.match(directionUrl, /api\/v2.0\/direcciones/);
  assert.equal(new URL(directionUrl).searchParams.get("localidad"), "Santa Fe");
  assert.equal(r.candidates[0].address.city, "Rosario");
  assert.equal(r.candidates[0].address.postcode, "");
  assert.ok(r.candidates[0].warnings.includes("city_mismatch"));
  assert.equal(r.candidates[0].requiresConfirmation, true);
});
test("USIG succeeds during Georef outage and swaps x/y correctly", async () => {
  const g = createGeocoder({
    minIntervalMs: 0,
    fetch: async (url) =>
      String(url).includes("georef")
        ? new Response("", { status: 503 })
        : response({ direccionesNormalizadas: [usig] }),
  });
  const r = await g.search({ query: "Corrientes 1234", city: "CABA" });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].lat, -34.603939);
  assert.equal(r.candidates[0].precision, "interpolated");
  assert.ok(r.warnings.includes("partial_provider_failure"));
});
test("invalid coordinates and wrong province are not accepted", async () => {
  const g = createGeocoder({
    minIntervalMs: 0,
    fetch: async (url) =>
      String(url).includes("georef")
        ? response({
            direcciones: [fixture({ ubicacion: { lat: null, lon: null } })],
          })
        : response({
            direccionesNormalizadas: [
              { ...usig, coordenadas: { srid: 22185, x: 1000, y: 2000 } },
            ],
          }),
  });
  assert.equal(
    (await g.search({ query: "Corrientes 1234", city: "CABA" })).status,
    "not_found",
  );
  assert.deepEqual(
    rank(
      [
        candidate("georef", {
          lat: -34.6,
          lng: -58.4,
          street: "Mitre",
          city: "Otra",
          province: "Buenos Aires",
        }),
      ],
      normalizeInput({ query: "Mitre", province: "Mendoza" }),
    ),
    [],
  );
});
test("in-flight deduplication, bounded cache and outage recovery", async () => {
  let calls = 0,
    outage = false;
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return outage
        ? new Response("", { status: 503 })
        : response({ direcciones: [fixture()] });
    },
  });
  await Promise.all([
    g.search({ query: "Corrientes 1234" }),
    g.search({ query: "Corrientes 1234" }),
  ]);
  assert.equal(calls, 1);
  await g.search({ query: "Corrientes 1234" });
  assert.equal(calls, 1);
  g.clearCache();
  outage = true;
  assert.equal(
    (await g.search({ query: "Corrientes 1234" })).status,
    "unavailable",
  );
  outage = false;
  assert.equal((await g.search({ query: "Corrientes 1234" })).status, "ok");
  assert.equal(calls, 3);
});
test("optional Photon excludes foreign-country results and Nominatim public endpoint", async () => {
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    photonUrl: "http://provider.test",
    minIntervalMs: 0,
    fetch: async () =>
      response({
        features: [
          {
            properties: { countrycode: "CL", name: "Foreign" },
            geometry: { coordinates: [-68, -33] },
          },
          {
            properties: {
              countrycode: "AR",
              street: "Mitre",
              housenumber: "123",
              city: "Mendoza",
              state: "Mendoza",
            },
            geometry: { coordinates: [-68.84, -32.89] },
          },
        ],
      }),
  });
  const r = await g.search({ query: "Mitre 123", city: "Mendoza" });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].provider, "photon");
  assert.throws(() =>
    createGeocoder({ photonUrl: "https://nominatim.openstreetmap.org" }),
  );
});
test("reverse is a region, not a fabricated house or postcode", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async () =>
      response({
        ubicacion: {
          provincia: { id: "02", nombre: "Ciudad Autónoma de Buenos Aires" },
          departamento: { nombre: "Comuna 1" },
        },
      }),
  });
  const r = await g.reverse({ lat: -34.6, lng: -58.38 });
  assert.equal(r.candidates[0].precision, "region");
  assert.equal(r.candidates[0].address.street, "");
  assert.equal(r.candidates[0].lat, -34.6);
});
test("HTTP validation, rate limiting, no-store and no arbitrary CORS", async (t) => {
  const handler = createHandler({
    requestsPerMinute: 3,
    geocoder: createGeocoder({
      usigUrl: false,
      minIntervalMs: 0,
      fetch: async () => response({ direcciones: [] }),
    }),
  });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal(
    (
      await fetch(base + "/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
  const r = await fetch(base + "/search?query=Corrientes", {
    headers: { Origin: "https://evil.test" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await fetch(base + "/reverse?lat=&lng=")).status, 400);
  assert.equal((await fetch(base + "/search?query=Corrientes")).status, 429);
});
test("upstream timeout yields recoverable unavailable", async (t) => {
  const server = createServer((_req, res) =>
    setTimeout(() => res.end("{}"), 200),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const g = createGeocoder({
    usigUrl: false,
    georefUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    timeoutMs: 30,
    minIntervalMs: 0,
  });
  assert.equal(
    (await g.search({ query: "Corrientes 1234" })).status,
    "unavailable",
  );
});

test("Tierra del Fuego long official name matches its common name", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async () =>
      response({
        direcciones: [
          fixture({
            calle: { nombre: "SAN MARTIN" },
            provincia: {
              id: "94",
              nombre: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
            },
            localidad_censal: { nombre: "Ushuaia" },
            ubicacion: { lat: -54.807, lng: -68.307, lon: -68.307 },
          }),
        ],
      }),
  });
  const r = await g.search({
    query: "San Martin 1234",
    city: "Ushuaia",
    province: "Tierra del Fuego",
  });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].warnings.length, 0);
});

test("city search returns an explicitly approximate center when no street point exists", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) =>
      String(url).includes("/localidades")
        ? response({
            localidades: [
              {
                nombre: "Mendoza",
                provincia: { nombre: "Mendoza" },
                centroide: { lat: -32.89, lon: -68.84 },
              },
            ],
          })
        : response({ direcciones: [] }),
  });
  const r = await g.search({ query: "Mendoza", province: "Mendoza" });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].precision, "locality");
  assert.ok(r.candidates[0].warnings.includes("approximate_area"));
  assert.equal(r.candidates[0].address.street, "");
});

test("cached addresses expire and distinct searches evict oldest entries", async () => {
  let calls = 0;
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    cacheSize: 1,
    cacheTtlMs: 20,
    fetch: async () => {
      calls++;
      return response({ direcciones: [fixture()] });
    },
  });
  await g.search({ query: "Corrientes 1234" });
  await g.search({ query: "Corrientes 1234" });
  assert.equal(calls, 1);
  await g.search({ query: "Corrientes 1235" });
  await g.search({ query: "Corrientes 1234" });
  assert.equal(calls, 3);
  await new Promise((r) => setTimeout(r, 30));
  await g.search({ query: "Corrientes 1234" });
  assert.equal(calls, 4);
  g.clearCache();
});

test("autocomplete returns a street prediction without inventing coordinates", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async () =>
      response({
        calles: [
          {
            nombre: "AV CORRIENTES",
            provincia: { id: "02", nombre: "Ciudad Autónoma de Buenos Aires" },
            localidad: { nombre: "San Nicolás" },
          },
        ],
      }),
  });
  const result = await g.suggest({ query: "Corrien", city: "CABA" });
  assert.equal(result.status, "ok");
  assert.equal(result.predictions[0].kind, "street");
  assert.equal(result.predictions[0].lat, null);
  assert.equal(result.predictions[0].requiresResolution, true);
  assert.equal(result.predictions[0].searchInput.query, "AV CORRIENTES");
  assert.equal(result.candidates.length, 0);
});
test("USIG can autocomplete a street even without a geocoded point", async () => {
  const g = createGeocoder({
    georefUrl: false,
    minIntervalMs: 0,
    fetch: async () =>
      response({
        direccionesNormalizadas: [{ ...usig, altura: null, coordenadas: null }],
      }),
  });
  const result = await g.suggest({ query: "Corri", city: "CABA" });
  assert.equal(result.predictions[0].provider, "usig");
  assert.equal(result.predictions[0].requiresResolution, true);
  assert.equal(result.predictions[0].lng, null);
});
test("AMBA entity ID disambiguates the identically named census locality", async () => {
  let locality;
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) => {
      if (url.pathname.endsWith("/localidades"))
        return response({
          localidades: [
            { id: "06568010", nombre: "Morón" },
            { id: "0656801004", nombre: "Morón" },
          ],
        });
      locality = url.searchParams.get("localidad");
      return response({
        direcciones: [
          fixture({
            provincia: { id: "06", nombre: "Buenos Aires" },
            localidad: { nombre: "Morón" },
            localidad_censal: { nombre: "Morón" },
          }),
        ],
      });
    },
  });
  const r = await g.search({
    query: "Corrientes 1234",
    city: "Morón",
    province: "Buenos Aires",
  });
  assert.equal(locality, "0656801004");
  assert.equal(r.status, "ok");
  assert.equal(r.candidates[0].address.city, "Morón");
});
test("another street is not an address resolution, including predictions with a height", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async () =>
      response({
        direcciones: [fixture({ calle: { nombre: "JUAN B JUSTO" } })],
      }),
  });
  for (const method of ["search", "suggest"] as const) {
    const r = await g[method]({ query: "San Juan 1234", city: "CABA" });
    assert.equal(r.status, "not_found");
    assert.equal(r.candidates.length, 0);
  }
});
test("Geoapify uses real autocomplete/search/reverse endpoints, Argentina filter and private operator key", async () => {
  const urls: URL[] = [];
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    geoapifyKey: "synthetic-provider-key",
    minIntervalMs: 0,
    fetch: async (url) => {
      urls.push(url);
      return response({
        results: [
          {
            country_code: "ar",
            street: "Corrientes",
            housenumber: "1234",
            city: "CABA",
            state: "Capital Federal",
            lat: -34.6,
            lon: -58.38,
            result_type: "building",
            formatted: "Corrientes 1234, CABA",
          },
          {
            country_code: "cl",
            street: "Corrientes",
            housenumber: "1234",
            lat: -34,
            lon: -71,
          },
        ],
      });
    },
  });
  assert.equal(
    (await g.suggest({ query: "Corrientes 1234", city: "CABA" })).predictions
      .length,
    1,
  );
  assert.equal(
    (await g.search({ query: "Corrientes 1234", city: "CABA" })).candidates[0]
      .provider,
    "geoapify",
  );
  await g.reverse({ lat: -34.6, lng: -58.38 });
  assert.deepEqual(
    urls.map((u) => u.pathname),
    ["/v1/geocode/autocomplete", "/v1/geocode/search", "/v1/geocode/reverse"],
  );
  assert.equal(urls[0].searchParams.get("filter"), "countrycode:ar");
  assert.equal(urls[0].searchParams.get("apiKey"), "synthetic-provider-key");
  assert.doesNotMatch(JSON.stringify(g.providers()), /synthetic-provider-key/);
  assert.equal(
    createGeocoder()
      .providers()
      .providers.find((p) => p.name === "geoapify")?.enabled,
    false,
  );
});
test("versioned API, interactive docs, OpenAPI, catalogs and CORS are usable", async (t) => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) =>
      response(
        url.pathname.endsWith("/provincias")
          ? {
              provincias: [
                {
                  id: "06",
                  nombre: "Buenos Aires",
                  centroide: { lat: -36, lng: -60, lon: -60 },
                },
              ],
              total: 1,
            }
          : url.pathname.endsWith("/localidades")
            ? { localidades: [], total: 0 }
            : { calles: [] },
      ),
  });
  const server = createServer(
    createHandler({ geocoder: g, allowedOrigins: ["https://app.test"] }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const spec = await (await fetch(base + "/openapi.json")).json();
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/v1/suggest"].post);
  assert.ok(spec.paths["/v1/reverse"].get);
  assert.match(await (await fetch(base + "/docs")).text(), /Enviar POST/);
  const provinces = await (await fetch(base + "/v1/provinces")).json();
  assert.equal(provinces.items[0].id, "06");
  assert.equal((await fetch(base + "/v1/localities")).status, 400);
  const r = await fetch(base + "/v1/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.test" },
    body: JSON.stringify({ query: "Corrien", city: "CABA" }),
  });
  assert.equal(r.status, 200);
  assert.equal(
    r.headers.get("Access-Control-Allow-Origin"),
    "https://app.test",
  );
  assert.deepEqual((await r.json()).predictions, []);
  assert.equal(
    (
      await fetch(base + "/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "a".repeat(3000) }),
      })
    ).status,
    413,
  );
});

test("public Photon only backs up unresolved complete addresses, never partial typing", async () => {
  const calls: URL[] = [];
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    photonUrl: "https://photon.komoot.io",
    minIntervalMs: 0,
    fetch: async (url) => {
      calls.push(url);
      return response({
        features: [
          {
            properties: {
              countrycode: "AR",
              street: "Mitre",
              housenumber: "123",
            },
            geometry: { coordinates: [-58.4, -34.6] },
          },
        ],
      });
    },
  });
  assert.equal((await g.suggest({ query: "Mit" })).status, "unavailable");
  assert.equal(calls.length, 0);
  assert.equal((await g.search({ query: "Mitre 123" })).status, "ok");
  assert.equal(calls.length, 1);
  const complete = createGeocoder({
    photonUrl: "https://photon.komoot.io",
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) => {
      assert.ok(!url.hostname.includes("photon"));
      return response({ direcciones: [fixture()] });
    },
  });
  assert.equal(
    (await complete.search({ query: "Corrientes 1234", city: "CABA" })).status,
    "ok",
  );
});

test("missing entity cartography falls back to the same named census locality", async () => {
  const g = createGeocoder({
    usigUrl: false,
    minIntervalMs: 0,
    fetch: async (url) => {
      if (url.pathname.endsWith("/localidades"))
        return response({
          localidades: [
            { id: "06568010", nombre: "Morón" },
            { id: "0656801004", nombre: "Morón" },
          ],
        });
      if (url.searchParams.has("localidad"))
        return response({ direcciones: [] });
      assert.equal(url.searchParams.get("localidad_censal"), "06568010");
      return response({
        direcciones: [
          fixture({
            provincia: { id: "06", nombre: "Buenos Aires" },
            localidad: { nombre: null },
            localidad_censal: { nombre: "Morón" },
          }),
        ],
      });
    },
  });
  assert.equal(
    (
      await g.search({
        query: "Corrientes 1234",
        city: "Morón",
        province: "Buenos Aires",
      })
    ).candidates[0].address.city,
    "Morón",
  );
});

test("public Photon budget stops upstream requests while leaving a recoverable response", async () => {
  let calls = 0;
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    photonUrl: "https://photon.komoot.io",
    minIntervalMs: 0,
    fetch: async () => {
      calls++;
      return response({ features: [] });
    },
  });
  for (let i = 1; i <= 200; i++)
    await g.search({ query: "Mitre", number: String(i) });
  const result = await g.search({ query: "Mitre", number: "201" });
  assert.equal(calls, 200);
  assert.equal(result.status, "unavailable");
  assert.ok(result.warnings.includes("select_on_map"));
});

test("package version and generated entry points match the implementation", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
    main: string;
    types: string;
  };
  const { version } = await import("../src/version");
  assert.equal(pkg.version, version);
  assert.equal(pkg.main, "dist/index.js");
  assert.equal(pkg.types, "dist/index.d.ts");
  assert.match(readFileSync(pkg.types, "utf8"), /createGeocoder/);
});

test("Pelias provides typed autocomplete, search and reverse with country filtering and private keys", async () => {
  const calls: URL[] = [];
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    peliasUrl: "https://pelias.test",
    peliasKey: "synthetic-key",
    minIntervalMs: 0,
    fetch: async (url) => {
      calls.push(url);
      return response({
        features: [
          {
            properties: {
              country_a: "ARG",
              street: "Corrientes",
              housenumber: "1234",
              locality: "CABA",
              region: "CABA",
              label: "Corrientes 1234, CABA",
              accuracy: "point",
            },
            geometry: { coordinates: [-58.38, -34.6] },
          },
          {
            properties: { country_a: "CHL", label: "Foreign" },
            geometry: { coordinates: [-58.38, -34.6] },
          },
        ],
      });
    },
  });
  assert.equal(
    (await g.suggest({ query: "Corrientes 1234", city: "CABA" })).predictions
      .length,
    1,
  );
  assert.equal(
    (await g.search({ query: "Corrientes 1234", city: "CABA" })).candidates[0]
      .precision,
    "address",
  );
  assert.equal(
    (await g.reverse({ lat: -34.6, lng: -58.38 })).candidates.length,
    1,
  );
  assert.deepEqual(
    calls.map((c) => c.pathname),
    ["/v1/autocomplete", "/v1/search", "/v1/reverse"],
  );
  assert.equal(calls[0].searchParams.get("boundary.country"), "ARG");
  assert.equal(calls[2].searchParams.get("point.lon"), "-58.38");
  assert.doesNotMatch(JSON.stringify(g.providers()), /synthetic-key/);
});

test("MapTiler separates autocomplete and reverse, preserves approximate precision and rejects foreign results", async () => {
  const calls: URL[] = [];
  const g = createGeocoder({
    georefUrl: false,
    usigUrl: false,
    maptilerKey: "synthetic-key",
    minIntervalMs: 0,
    fetch: async (url) => {
      calls.push(url);
      return response({
        features: [
          {
            text: "Corrientes",
            address: "1234",
            place_name: "Corrientes 1234, CABA",
            place_type: ["address"],
            center: [-58.38, -34.6],
            context: [
              { id: "municipality.1", text: "CABA" },
              { id: "region.1", text: "CABA" },
              { id: "country.1", country_code: "ar" },
            ],
          },
          {
            text: "Foreign",
            place_type: ["address"],
            center: [-58.38, -34.6],
            properties: { country_code: "cl" },
          },
        ],
      });
    },
  });
  assert.equal(
    (await g.suggest({ query: "Corrientes 1234", city: "CABA" })).predictions
      .length,
    1,
  );
  assert.equal(
    (await g.search({ query: "Corrientes 1234", city: "CABA" })).candidates[0]
      .precision,
    "interpolated",
  );
  assert.equal(
    (await g.reverse({ lat: -34.6, lng: -58.38 })).candidates.length,
    1,
  );
  assert.equal(calls[0].searchParams.get("autocomplete"), "true");
  assert.equal(calls[1].searchParams.get("autocomplete"), "false");
  assert.equal(calls[0].searchParams.get("country"), "ar");
  assert.match(decodeURIComponent(calls[2].pathname), /-58.38,-34.6/);
  assert.doesNotMatch(JSON.stringify(g.providers()), /synthetic-key/);
});

test("Turf comparison reports agreement and disagreement without averaging or claiming a verified door", () => {
  const address = {
    street: "Corrientes",
    number: "1234",
    city: "CABA",
    province: "CABA",
    lat: -34.6,
    lng: -58.38,
  };
  const close = rank(
    [
      candidate("georef", address),
      candidate("usig", { ...address, lng: -58.3799 }),
    ],
    normalizeInput({ query: "Corrientes 1234", city: "CABA" }),
  );
  assert.equal(close[0].supportingProviders?.length, 2);
  assert.equal(close[0].lat, address.lat);
  assert.equal(close[0].requiresConfirmation, true);
  const far = rank(
    [
      candidate("georef", address),
      candidate("usig", { ...address, lng: -58.4 }),
    ],
    normalizeInput({ query: "Corrientes 1234", city: "CABA" }),
  );
  assert.ok(
    far.every(
      (c) =>
        c.warnings.includes("providers_disagree") && c.confidence === "low",
    ),
  );
  const unrelated = rank(
    [
      candidate("georef", address),
      candidate("usig", { ...address, number: "1250", lng: -58.4 }),
    ],
    normalizeInput({ query: "Corrientes 1234", city: "CABA" }),
  );
  assert.ok(unrelated.every((c) => !c.warnings.includes("providers_disagree")));
});
