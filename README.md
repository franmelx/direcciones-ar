# Direcciones AR

Buscador de direcciones argentinas, biblioteca Node.js y API HTTP con demo de mapa. Código gratuito bajo MIT, sin claves obligatorias y sin dependencias de ejecución. **No es una API alojada ilimitada ni garantiza ubicar cualquier puerta:** cobertura y precisión dependen de los datos disponibles. El alojamiento y proveedores adicionales pueden tener costos.

## Ejecutar

Requiere Node.js 20 o posterior.

```sh
git clone https://github.com/franmelx/direcciones-ar.git
cd direcciones-ar
npm test
npm start
```

Abrí http://127.0.0.1:3030. La demo usa Leaflet desde un CDN y teselas de OpenStreetMap; necesita conexión. La API se puede usar sin el mapa.

```sh
docker build -t direcciones-ar .
docker run --rm -p 127.0.0.1:3030:3030 direcciones-ar
```

## API v1 y autocompletado

Abrí `/docs` para probar las operaciones desde el navegador. `/openapi.json` ofrece el contrato OpenAPI 3.1 para Swagger, Postman o generadores de clientes. Las rutas sin `/v1` se mantienen como alias.

| Endpoint (GET o POST) | Uso                                                                       |
| --------------------- | ------------------------------------------------------------------------- |
| `/v1/suggest`         | Predicciones desde 3 caracteres, con localidad/provincia opcionales       |
| `/v1/search`          | Resolver calle y altura con varias fuentes                                |
| `/v1/reverse`         | Identificar dirección cercana o jurisdicción de un punto                  |
| `/v1/provinces`       | Listar provincias o filtrar por `query`                                   |
| `/v1/localities`      | Buscar localidades por `query` y `province`; devuelve hasta 20 y el total |
| `/v1/providers`       | Ver fuentes habilitadas y atribución, sin exponer claves                  |
| `/v1/health`          | Comprobar que responde el proceso                                         |

`/localities` requiere provincia o al menos 3 caracteres de búsqueda para evitar descargar un país completo. Puede incluir entidades y localidades censales con el mismo nombre pero distintos IDs. Los centros devueltos son orientativos.

### Predicciones mientras se escribe

```sh
curl http://127.0.0.1:3030/v1/suggest -H 'Content-Type: application/json' \
  -d '{"query":"Corrien","city":"CABA"}'
```

La respuesta incluye `predictions` con `kind` (`street`, `locality`, `address`), `searchInput` y `requiresResolution`. Una calle puede tener **lat/lng nulos**: todavía no hay un punto para marcar. Completá la altura y enviá `searchInput` a `/v1/search`, o volvé a pedir predicciones con la altura. `candidates` contiene únicamente resultados con coordenadas válidas.

La demo ya consulta automáticamente después de 450 ms sin escribir, cancela búsquedas anteriores, admite teclado y conserva un botón de búsqueda explícita. Para integrar otro cliente: mínimo 3 caracteres, debounce de 400–600 ms, AbortController, ignorar respuestas antiguas, limpiar la selección cuando cambia el texto y confirmar el punto antes de guardar. No consultar en cada pulsación.

```js
const { createGeocoder } = require("direcciones-ar");
const geocoder = createGeocoder();
const suggestions = await geocoder.suggest({ query: "Corrien", city: "CABA" });
const provinces = await geocoder.provinces();
const localities = await geocoder.localities({
  query: "San",
  province: "Buenos Aires",
});
```

## Búsqueda y resolución

`POST /search` con JSON (también acepta GET). Se recomienda POST para que las direcciones no aparezcan en la URL ni en registros de acceso del proxy.

```sh
curl http://127.0.0.1:3030/search -H 'Content-Type: application/json' \
  -d '{"query":"Av. Corrientes 1234","city":"CABA"}'
```

Campos: `query` (3–240 caracteres), `number`, `city`, `province`, `postcode`. Si la altura está separada, enviarla en `number`, especialmente con calles numeradas, rutas o nombres como «9 de Julio». Se admite texto separado por comas: `calle altura, localidad, provincia`. Se normalizan CABA, Capital Federal y Bs. As.; no se supone que «Buenos Aires» significa CABA. El piso/departamento se excluye del texto enviado a proveedores cuando está identificado como tal. No enviar datos personales ni referencias de entrega privadas.

`POST /reverse` con `{"lat":-34.6037,"lng":-58.3816}`. Georef identifica jurisdicciones, **no una puerta**. Photon configurado puede aportar una dirección cercana; el consumidor debe conservar el punto elegido por la persona. `GET /health` comprueba que el proceso responde, no la disponibilidad de proveedores.

Respuesta:

- `status`: `ok`, `not_found` o `unavailable` (HTTP 503). Un resultado vacío no se transforma en coordenadas 0,0.
- `candidates`: etiqueta, latitud/longitud WGS84, dirección desglosada, proveedor, atribución, `precision`, `confidence`, `warnings` y `requiresConfirmation: true`.
- `precision`: `address` (objeto con altura en fuente), `interpolated` (posición estimada en calle), `street`, `intersection`, `locality` o `region`. Ninguna implica verificación física de una puerta.
- `confidence`: heurística conservadora `low`/`medium`, **no una probabilidad**. Coincidencias con otra localidad se señalan; con otra provincia declarada se descartan. No se reemplaza la ciudad de la fuente por la que escribió el usuario ni se inventa un código postal.
- `providers`: estado individual. Se conservan resultados disponibles si falla otra fuente.

Un cliente debe cancelar búsquedas antiguas, invalidar el punto cuando cambia el texto, mostrar localidad/provincia y permitir corregir y confirmar el marcador. No elegir automáticamente el primer resultado para un envío.

## Biblioteca

También se puede instalar desde un checkout local (`npm install /ruta/direcciones-ar`) o desde un commit de GitHub. El nombre del paquete no implica publicación en npm.

```js
const { createGeocoder } = require("direcciones-ar");
const geocoder = createGeocoder();
const result = await geocoder.search({
  query: "Av. Corrientes",
  number: "1234",
  city: "CABA",
});
```

Exporta tipos TypeScript. Se puede inyectar `fetch` para pruebas o adaptadores. Endpoints configurables únicamente por el operador, nunca por parámetros del cliente.

## Fuentes y límites

- [Georef V2](https://www.argentina.gob.ar/georef/documentacion-y-recursos-georef-v21): cobertura nacional. Usa `/direcciones`, `/calles`, `/ubicacion` y `/localidades` (centros aproximados de localidades cuando no se indicó altura). Algunas calles o alturas no tienen coordenadas. Fuente y condiciones de datos propias de Georef.
- [USIG](https://servicios.usig.buenosaires.gob.ar/normalizar): refuerzo para consultas explícitas de CABA/Buenos Aires. La cobertura real es CABA/AMBA; devuelve WGS84. No se extiende artificialmente al resto del país.
- [Photon](https://github.com/komoot/photon): opcional mediante `PHOTON_URL` para una instancia propia o un proveedor cuyo uso esté autorizado. Usa GeoJSON y descarta resultados con país diferente de AR. Por defecto está desactivado. Si se configura `https://photon.komoot.io`, su política permite uso moderado: esta biblioteca lo limita automáticamente a respaldo de consultas con altura e inversas, máximo 200 consultas diarias por proceso. Las predicciones parciales no lo consultan. Ese límite es una precaución propia, no una cuota garantizada del proveedor; varias réplicas requieren un presupuesto compartido. Para crecer, usar una instancia propia o un proveedor con capacidad acordada. Los datos de OpenStreetMap tienen su propia [licencia ODbL](https://www.openstreetmap.org/copyright); MIT cubre nuestro código, no relicencia datos ajenos.
- [Geoapify](https://apidocs.geoapify.com/docs/geocoding/): opcional con `GEOAPIFY_API_KEY`, para búsqueda, predicciones e inversa; filtro Argentina y descarte de otros países. Requiere cuenta propia, cuotas y condiciones del proveedor. La clave se conserva en el servidor; no se expone en respuestas.
- **No utiliza el servidor público de Nominatim**: su [política](https://operations.osmfoundation.org/policies/nominatim/) prohíbe autocompletado y usarlo como base de servicios genéricos de geocodificación. Si extendés proveedores, respetá sus condiciones.
- La demo muestra atribución de fuentes y de teselas. Para producción con mayor tráfico, configurá un proveedor de mapas apropiado y respetá la [política de teselas](https://operations.osmfoundation.org/policies/tiles/). No precarga ni descarga mapas masivamente.

Georef y USIG están habilitados por defecto. Photon y Geoapify solo se consultan cuando el operador los configura; no se promete cobertura adicional de un proveedor inactivo. En AMBA se distingue localidad de localidad censal: primero se resuelve el ID de la entidad y, si falta cartografía asociada, se consulta la localidad censal homónima conservando la localidad real de cada resultado. Se descartan calles diferentes al resolver alturas; esto prioriza evitar ubicaciones equivocadas y puede dejar consultas sin coincidencia.

Por defecto: máximo 40 solicitudes/minuto por conexión IP, cola limitada, separación de 600 ms entre inicios por proveedor, timeout de 6 segundos por consulta de proveedor, máximo 32 búsquedas simultáneas distintas y caché en memoria de 300 entradas durante 5 minutos. Las solicitudes idénticas en curso se comparten. No se cachean fallos de proveedores. Las claves de caché son hashes; sus valores incluyen direcciones hasta vencer o reiniciar el proceso. No se escriben direcciones, coordenadas ni datos de usuarios a disco. La API no guarda pedidos, cuentas ni historial.

Estos límites son por proceso: al escalar réplicas necesitás límites/cache compartidos o instancias propias. No se confía en `X-Forwarded-For` proporcionado por el cliente. Detrás de un proxy se comparte el límite de su IP; configurá límites en el borde. Los endpoints públicos pueden cambiar o interrumpirse, no ofrecen SLA de esta biblioteca. Para cargas grandes, instalá los proveedores/datos propios. El rango geográfico validado cubre Argentina continental y Tierra del Fuego y solo sirve para detectar coordenadas absurdas, no para certificar fronteras.

## Configuración del servidor

| Variable           | Predeterminado                                                                  |
| ------------------ | ------------------------------------------------------------------------------- |
| `HOST`             | `127.0.0.1` (Docker: `0.0.0.0`)                                                 |
| `PORT`             | `3030`                                                                          |
| `GEOREF_URL`       | `https://apis.datos.gob.ar/georef/api/v2.0`                                     |
| `USIG_URL`         | `https://servicios.usig.buenosaires.gob.ar/normalizar/`; `disabled` para apagar |
| `PHOTON_URL`       | Sin configurar                                                                  |
| `GEOAPIFY_API_KEY` | Sin configurar                                                                  |
| `ALLOWED_ORIGINS`  | Sin CORS entre orígenes; lista separada por comas                               |

La API no tiene autenticación de aplicación. Si exponés una instancia, agregá HTTPS, límites globales y autenticación según el uso. No habilites CORS abierto por defecto. El código funciona localmente sin tocar bases de datos.

## Contribuir

Ejecutá `npm test`. Agregá casos sintéticos que reproduzcan el fallo, con proveedor simulado. No incluir domicilios de clientes, claves, logs de consultas ni bases de datos. Son útiles casos de localidades homónimas, calles numeradas, intersecciones, barrios sin nomenclatura y parajes rurales. Una prueba de coincidencia no demuestra precisión nacional; el proyecto es una primera versión y necesita evaluación con direcciones públicas verificadas de distintas provincias.

## Prueba real y reproducible del AMBA

```sh
npm run --silent test:amba > amba.json
# PHOTON_URL=https://photon.komoot.io npm run --silent test:amba > amba-con-respaldo.json
# npm run --silent test:amba:inventory > inventario-amba.json
```

Es una prueba **optativa con consultas reales**, no forma parte de `npm test`. Sortea alturas en 20 calles de distintas localidades del AMBA con semilla fija. La variante `test:amba:inventory` elige calles de un subconjunto del nomenclador oficial en 21 zonas, con semilla configurable mediante `AMBA_SEED`. Registra semilla, fuente, tiempos, fallos y advertencias sin usar clientes ni pedidos. Una altura sorteada puede no tener edificio; la muestra no es representativa y no demuestra precisión de puerta. El script limita la frecuencia. Los errores del inventario se informan aparte de las consultas sin coincidencia.

Informe de la muestra ejecutada: [AMBA, 6 de septiembre de 2026](reports/amba-2026-09-06.md).
