"use strict";
const { createGeocoder } = require("../src");
// Small opt-in evaluation permitted by Photon's reasonable-use demo policy.
const g = createGeocoder({
  photonUrl: process.env.PHOTON_URL,
  geoapifyKey: process.env.GEOAPIFY_API_KEY,
  minIntervalMs: 1200,
});
const streets = [
  ["San Justo", "Balbastro", 3000, 5500],
  ["Morón", "Almirante Brown", 100, 1200],
  ["Ramos Mejía", "Avenida de Mayo", 100, 1000],
  ["Vicente López", "Avenida Maipú", 100, 3000],
  ["San Isidro", "9 de Julio", 100, 700],
  ["San Fernando", "Constitución", 100, 2000],
  ["Tigre", "Cazón", 100, 1500],
  ["General San Martín", "Belgrano", 2000, 4000],
  ["Avellaneda", "Güemes", 100, 1000],
  ["Lanús", "Hipólito Yrigoyen", 3000, 4500],
  ["Lomas de Zamora", "Manuel Castro", 100, 700],
  ["Quilmes", "Alberdi", 100, 1000],
  ["Berazategui", "Calle 14", 100, 1000],
  ["Florencio Varela", "25 de Mayo", 2000, 3000],
  ["Adrogué", "Rosales", 1000, 1600],
  ["Monte Grande", "Vicente López", 100, 600],
  ["José C. Paz", "Gaspar Campos", 3000, 6500],
  ["San Miguel", "Sarmiento", 1000, 2000],
  ["Merlo", "Avenida del Libertador", 100, 1000],
  ["Moreno", "Bartolomé Mitre", 100, 1800],
];
let seed = 20260906;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
(async () => {
  const cases = [];
  for (const [city, street, min, max] of streets) {
    const input = {
      query: street,
      number: String(Math.floor((min + random() * (max - min)) / 2) * 2),
      city,
      province: "Buenos Aires",
    };
    const start = Date.now();
    const r = await g.search(input);
    cases.push({
      input,
      status: r.status,
      elapsedMs: Date.now() - start,
      providers: r.providers,
      candidates: r.candidates,
    });
    console.error(city, r.status, r.candidates[0]?.provider || "");
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(
    JSON.stringify(
      {
        date: new Date().toISOString(),
        seed: 20260906,
        photonEnabled: Boolean(process.env.PHOTON_URL),
        method:
          "Alturas aleatorias en 20 calles conocidas de AMBA; alturas y puertas no verificadas. Georef, USIG y fuentes opcionales configuradas; sin verificación física de puerta. Sin domicilios de clientes.",
        summary: {
          evaluated: cases.length,
          withCandidates: cases.filter((c) => c.status === "ok").length,
          notFound: cases.filter((c) => c.status === "not_found").length,
          unavailable: cases.filter((c) => c.status === "unavailable").length,
          topWithWarnings: cases.filter((c) => c.candidates[0]?.warnings.length)
            .length,
        },
        cases,
      },
      null,
      2,
    ),
  );
})().catch(() => {
  console.error("No se pudo completar la prueba");
  process.exitCode = 1;
});
