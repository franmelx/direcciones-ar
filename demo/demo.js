"use strict";
const form = document.querySelector("#search");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const confirmation = document.querySelector("#confirm");
const output = document.querySelector("#output");
const selection = document.querySelector("#selection");
const precision = {
  address: "Dirección de la fuente",
  interpolated: "Altura aproximada",
  street: "Calle",
  intersection: "Intersección",
  locality: "Centro de localidad",
  region: "Zona aproximada",
};
let map,
  marker,
  selected,
  controller,
  debounce,
  version = 0;
function cancelSearch() {
  version++;
  controller?.abort();
  clearTimeout(debounce);
}
if (window.L) {
  map = L.map("map").setView([-34.6, -58.38], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);
  map.on("click", (e) =>
    choose(e.latlng.lat, e.latlng.lng, "Punto elegido en el mapa"),
  );
} else
  status.textContent =
    "No se pudo cargar el mapa. Podés buscar y ver las coordenadas; recargá para volver a intentarlo.";
function choose(lat, lng, label) {
  cancelSearch();
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -56 ||
    lat > -21 ||
    lng < -74 ||
    lng > -53
  ) {
    selected = null;
    confirmation.disabled = true;
    output.textContent = "";
    status.textContent = "Elegí un punto dentro de Argentina.";
    return;
  }
  selected = { lat, lng, label };
  confirmation.disabled = false;
  output.textContent = "";
  results.replaceChildren();
  status.textContent = "Revisá el punto antes de confirmar.";
  if (map) {
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        choose(p.lat, p.lng, "Punto corregido en el mapa");
      });
    } else marker.setLatLng([lat, lng]);
  }
  selection.textContent = `${label} · ${lat.toFixed(6)}, ${lng.toFixed(6)}. Revisá el acceso antes de confirmar.`;
}
form.addEventListener("input", () => {
  cancelSearch();
  selected = null;
  confirmation.disabled = true;
  results.replaceChildren();
  output.textContent = "";
  status.textContent = "";
  selection.textContent =
    "Buscá la dirección o elegí un nuevo punto en el mapa.";
  if (marker) {
    marker.remove();
    marker = null;
  }
  if (form.elements.query.value.trim().length >= 3)
    debounce = setTimeout(() => request("suggest"), 450);
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  request("search");
});
async function request(operation) {
  cancelSearch();
  const current = new AbortController();
  controller = current;
  const requestVersion = version;
  const timeout = setTimeout(() => current.abort(), 10000);
  status.textContent = "Buscando…";
  results.replaceChildren();
  try {
    const response = await fetch("/v1/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      signal: current.signal,
    });
    const data = await response.json();
    if (requestVersion !== version) return;
    if (!response.ok) throw new Error("unavailable");
    const items = data.predictions || data.candidates;
    status.textContent = items.length
      ? "Elegí una coincidencia y revisá el marcador."
      : "No encontramos una ubicación. Agregá localidad/provincia o elegí el punto en el mapa.";
    for (const item of items) {
      const li = document.createElement("li"),
        button = document.createElement("button"),
        detail = document.createElement("small");
      button.textContent = item.label;
      detail.textContent = `${item.provider} · ${precision[item.precision] || "Ubicación orientativa"} · ${item.warnings?.length ? "revisá las diferencias con tu búsqueda" : "requiere confirmación"}`;
      button.append(detail);
      button.onclick = () => {
        if (item.requiresResolution) {
          cancelSearch();
          results.replaceChildren();
          selected = null;
          confirmation.disabled = true;
          form.elements.query.value = (item.address.street || "") + " ";
          form.elements.city.value =
            item.address.city || form.elements.city.value;
          form.elements.province.value =
            item.address.province || form.elements.province.value;
          status.textContent =
            "Predicción seleccionada. Completá calle y altura para ubicar el punto.";
          form.elements.query.focus();
          return;
        }
        choose(item.lat, item.lng, item.label);
        map?.setView(
          [item.lat, item.lng],
          ["locality", "region"].includes(item.precision) ? 12 : 17,
        );
      };
      li.append(button);
      results.append(li);
    }
  } catch {
    if (requestVersion === version)
      status.textContent =
        "El buscador no está disponible. Podés ubicar el punto en el mapa y reintentar.";
  } finally {
    clearTimeout(timeout);
  }
}
confirmation.onclick = () => {
  if (selected) {
    cancelSearch();
    output.textContent = JSON.stringify(
      { ...selected, confirmedByUser: true },
      null,
      2,
    );
  }
};

form.elements.query.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    const first = results.querySelector("button");
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
  if (e.key === "Escape") {
    cancelSearch();
    results.replaceChildren();
  }
});
results.addEventListener("keydown", (e) => {
  const buttons = [...results.querySelectorAll("button")];
  const index = buttons.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    buttons[
      Math.max(
        0,
        Math.min(buttons.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)),
      )
    ]?.focus();
  }
  if (e.key === "Escape") {
    cancelSearch();
    results.replaceChildren();
    form.elements.query.focus();
  }
});
