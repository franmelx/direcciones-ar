interface InventoryStreet {
  id: string;
  nombre: string;
  altura: { inicio: { izquierda: number }; fin: { izquierda: number } };
  localidad?: { nombre: string };
  localidad_censal?: { nombre: string };
}
interface Inventory {
  calles?: InventoryStreet[];
}
// Opt-in live test. Official street inventory + random height within its range.
// No customers or actual delivery records. A height can lack a real building.
import { createGeocoder } from "../src";
const seed = Number(process.env.AMBA_SEED || 20260906);
let state = seed >>> 0;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
};
const places = [
  "CABA",
  "San Justo",
  "Morón",
  "Ramos Mejía",
  "Vicente López",
  "San Isidro",
  "San Fernando",
  "Tigre",
  "General San Martín",
  "Avellaneda",
  "Lanús",
  "Lomas de Zamora",
  "Quilmes",
  "Berazategui",
  "Florencio Varela",
  "Adrogué",
  "Monte Grande",
  "José C. Paz",
  "San Miguel",
  "Merlo",
  "Moreno",
];
const geocoder = createGeocoder({
  geoapifyKey: process.env.GEOAPIFY_API_KEY,
  photonUrl: process.env.PHOTON_URL,
});
(async () => {
  const cases = [];
  for (const city of places) {
    const localities =
      city === "CABA"
        ? null
        : await geocoder.localities({ query: city, province: "Buenos Aires" });
    const matching = (localities?.items || []).sort(
      (a, b) => String(b.id).length - String(a.id).length,
    );
    const localityId = matching[0]?.id || city;
    const params = new URLSearchParams({
      provincia: city === "CABA" ? "02" : "06",
      max: "30",
      orden: "nombre",
      ...(city === "CABA" ? {} : { localidad: localityId }),
    });
    let streets: InventoryStreet[];
    try {
      const response = await fetch(
        "https://apis.datos.gob.ar/georef/api/v2.0/calles?" + params,
        {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "direcciones-ar/0.3 public coverage test" },
        },
      );
      if (!response.ok) throw new Error();
      let data = (await response.json()) as Inventory;
      if (!data.calles?.length) {
        const census = matching.find((item) => String(item.id).length === 8);
        if (census) {
          params.delete("localidad");
          params.set("localidad_censal", census.id);
          await new Promise((r) => setTimeout(r, 650));
          const fallback = await fetch(
            "https://apis.datos.gob.ar/georef/api/v2.0/calles?" + params,
            { signal: AbortSignal.timeout(10000) },
          );
          data = (await fallback.json()) as Inventory;
        }
      }
      streets =
        data.calles?.filter(
          (s) =>
            Number(s.altura?.fin?.izquierda) >
            Number(s.altura?.inicio?.izquierda),
        ) || [];
    } catch {
      cases.push({ city, status: "inventory_unavailable" });
      continue;
    }
    if (!streets.length) {
      cases.push({ city, status: "inventory_empty" });
      continue;
    }
    const street = streets[Math.floor(random() * streets.length)];
    const low = Number(street.altura.inicio.izquierda),
      high = Number(street.altura.fin.izquierda);
    const number = Math.max(
      2,
      2 * Math.floor((low + random() * (high - low)) / 2),
    );
    const input = {
      query: street.nombre,
      number: String(number),
      city:
        city === "CABA"
          ? "CABA"
          : street.localidad?.nombre || street.localidad_censal?.nombre || city,
      province: city === "CABA" ? "CABA" : "Buenos Aires",
    };
    const started = Date.now();
    const result = await geocoder.search(input);
    const candidates = result.candidates.map((c) => ({
      label: c.label,
      provider: c.provider,
      precision: c.precision,
      lat: c.lat,
      lng: c.lng,
      warnings: c.warnings,
      address: c.address,
    }));
    const row = {
      requestedArea: city,
      input,
      streetId: street.id,
      sourceRange: { low, high },
      status: result.status,
      elapsedMs: Date.now() - started,
      providers: result.providers,
      candidates,
    };
    cases.push(row);
    console.error(
      city + ": " + result.status + " (" + candidates.length + " candidatos)",
    );
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  const evaluated = cases.filter((c) => "input" in c);
  const report = {
    date: new Date().toISOString(),
    seed,
    method:
      "Una calle aleatoria entre las primeras 30 del nomenclador oficial por localidad, altura aleatoria dentro del rango. Muestra de conveniencia, no representativa; sin verificación física de puerta. Errores de inventario se informan por separado.",
    summary: {
      attempted: cases.length,
      evaluated: evaluated.length,
      withCandidates: evaluated.filter((c) => c.status === "ok").length,
      notFound: evaluated.filter((c) => c.status === "not_found").length,
      unavailable: evaluated.filter((c) => c.status === "unavailable").length,
      topWithWarnings: evaluated.filter((c) => c.candidates[0]?.warnings.length)
        .length,
    },
    cases,
  };
  console.log(JSON.stringify(report, null, 2));
})().catch(() => {
  console.error("No se pudo completar la prueba");
  process.exitCode = 1;
});
