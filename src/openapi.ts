type Schema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};
import { version } from "./version";
const string = { type: "string", maxLength: 100 };
const search = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 3, maxLength: 240 },
    number: string,
    city: string,
    province: string,
    postcode: string,
  },
  additionalProperties: false,
};
const reverse = {
  type: "object",
  required: ["lat", "lng"],
  properties: {
    lat: { type: "number", minimum: -56, maximum: -21 },
    lng: { type: "number", minimum: -74, maximum: -53 },
  },
  additionalProperties: false,
};
const catalog = {
  type: "object",
  properties: { query: string, province: string },
  additionalProperties: false,
};
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const json = (schema: unknown) => ({ "application/json": { schema } });
const examples: Record<string, unknown> = {
  suggest: { query: "Corrien", city: "CABA" },
  search: { query: "Av. Corrientes", number: "1234", city: "CABA" },
  reverse: { lat: -34.603856, lng: -58.38419 },
  provinces: {},
  localities: { query: "San", province: "Buenos Aires" },
};
const operations: Record<
  string,
  [string, Schema & { properties: Record<string, unknown> }, string]
> = {
  suggest: [
    "Predicciones de calles, localidades y direcciones",
    search,
    "Suggestions",
  ],
  search: [
    "Resolver una dirección y comparar ubicaciones candidatas",
    search,
    "Result",
  ],
  reverse: [
    "Identificar dirección o zona del punto elegido",
    reverse,
    "Result",
  ],
  provinces: [
    "Listar hasta 24 provincias, opcionalmente por nombre",
    catalog,
    "Catalog",
  ],
  localities: [
    "Buscar hasta 20 localidades; requiere provincia o query de 3 caracteres",
    catalog,
    "Catalog",
  ],
};
const paths: Record<string, unknown> = {};
for (const [name, [summary, input, output]] of Object.entries(operations)) {
  const responses: Record<number, unknown> = {
    200: {
      description: "Resultado; puede ser not_found",
      content: json(ref(output)),
    },
  };
  for (const status of [400, 413, 415, 429, 503] as const)
    responses[status] = {
      description: {
        400: "Entrada inválida",
        413: "Máximo 2048 bytes",
        415: "Requiere application/json",
        429: "Límite de solicitudes",
        503: "Proveedores o servicio no disponibles",
      }[status],
      content: json({ oneOf: [ref("Error"), ref(output)] }),
    };
  paths["/v1/" + name] = {
    get: {
      summary,
      operationId: name + "Get",
      parameters: Object.entries(input.properties).map(([key, schema]) => ({
        name: key,
        in: "query",
        required: input.required?.includes(key) || false,
        schema,
      })),
      responses,
    },
    post: {
      summary,
      operationId: name,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: input, example: examples[name] },
        },
      },
      responses,
    },
  };
}
paths["/v1/health"] = {
  get: {
    summary: "Estado del proceso, no de las fuentes",
    operationId: "health",
    responses: {
      200: {
        description: "Proceso disponible",
        content: json({
          type: "object",
          properties: { status: { const: "ok" }, version: { type: "string" } },
        }),
      },
    },
  },
};
paths["/v1/providers"] = {
  get: {
    summary: "Fuentes habilitadas y atribución; nunca claves",
    operationId: "providers",
    responses: {
      200: {
        description: "Configuración pública",
        content: json({
          type: "object",
          properties: {
            providers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: string,
                  enabled: { type: "boolean" },
                  coverage: string,
                  attribution: ref("Attribution"),
                },
              },
            },
          },
        }),
      },
    },
  },
};
export const spec = {
  openapi: "3.1.0",
  info: {
    title: "Direcciones AR",
    version,
    description:
      "Geocodificación argentina y predicciones. POST evita direcciones en URLs. Los resultados requieren revisión del marcador. Las rutas sin /v1 se mantienen como alias.",
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [{ url: "." }],
  paths,
  components: {
    schemas: {
      Attribution: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string", format: "uri" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
      Candidate: {
        type: "object",
        properties: {
          id: string,
          lat: { type: "number" },
          lng: { type: "number" },
          label: { type: "string" },
          address: {
            type: "object",
            properties: Object.fromEntries(
              ["street", "number", "city", "province", "postcode"].map(
                (key) => [key, { type: "string" }],
              ),
            ),
          },
          provider: string,
          precision: {
            enum: [
              "address",
              "interpolated",
              "street",
              "intersection",
              "locality",
              "region",
            ],
          },
          confidence: { enum: ["low", "medium"] },
          warnings: { type: "array", items: string },
          requiresConfirmation: { const: true },
          attribution: ref("Attribution"),
          score: {
            type: "number",
            description: "Puntaje heurístico, no probabilidad",
          },
        },
      },
      Prediction: {
        type: "object",
        description:
          "Mismos campos que Candidate, con lat/lng nulos cuando solo se conoce la calle. No marcar un punto si requiresResolution es true.",
        properties: {
          id: string,
          label: { type: "string" },
          kind: { enum: ["address", "street", "locality"] },
          lat: { type: ["number", "null"] },
          lng: { type: ["number", "null"] },
          requiresResolution: { type: "boolean" },
          searchInput: search,
          address: { type: "object" },
          provider: string,
          precision: string,
          warnings: { type: "array", items: string },
          attribution: ref("Attribution"),
        },
      },
      Result: {
        type: "object",
        properties: {
          status: { enum: ["ok", "not_found", "unavailable"] },
          candidates: { type: "array", items: ref("Candidate") },
          providers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: string,
                status: { enum: ["ok", "unavailable"] },
              },
            },
          },
          requiresConfirmation: { const: true },
          warnings: { type: "array", items: string },
        },
      },
      Suggestions: {
        allOf: [
          ref("Result"),
          {
            type: "object",
            properties: {
              predictions: { type: "array", items: ref("Prediction") },
            },
          },
        ],
      },
      Catalog: {
        type: "object",
        properties: {
          status: { enum: ["ok", "not_found", "unavailable"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: string,
                name: string,
                province: {
                  type: "object",
                  properties: { id: string, name: string },
                },
                center: { oneOf: [reverse, { type: "null" }] },
                precision: { enum: ["locality", "region"] },
                attribution: ref("Attribution"),
              },
            },
          },
          total: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
  },
};
export const docs = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>API Direcciones AR</title><style>body{font:16px system-ui;max-width:900px;margin:30px auto;padding:20px;color:#183449}textarea,select,button{font:inherit;padding:12px;box-sizing:border-box}textarea{display:block;width:100%;height:160px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f5f8;padding:20px}button{cursor:pointer}a{color:#176e85}</style><h1>API Direcciones AR ${version}</h1><p>Autocompletado, búsqueda, geocodificación inversa, provincias y localidades. <a href="openapi.json">Descargar OpenAPI 3.1</a></p><p>Predicciones desde 3 caracteres. Si <code>requiresResolution</code> es verdadero, completá la altura y consultá <code>search</code>. Confirmá el marcador antes de usarlo para entregar un pedido.</p><label>Operación <select id="operation">${Object.entries(
  operations,
)
  .map(
    ([name, [title]]) => `<option value="${name}">${name} — ${title}</option>`,
  )
  .join(
    "",
  )}</select></label><label for="body"><p>Cuerpo JSON de prueba (sin datos personales)</p></label><textarea id="body"></textarea><button id="send">Enviar POST</button><p id="status" role="status"></p><pre id="result"></pre><p><a href="providers">Fuentes configuradas</a> · <a href="https://github.com/franmelx/direcciones-ar">Código MIT</a></p><script>const examples=${JSON.stringify(examples)};const operation=document.querySelector('#operation'),body=document.querySelector('#body');const example=()=>body.value=JSON.stringify(examples[operation.value],null,2);operation.onchange=example;example();document.querySelector('#send').onclick=async()=>{const status=document.querySelector('#status');try{JSON.parse(body.value);status.textContent='Consultando…';const r=await fetch(operation.value,{method:'POST',headers:{'Content-Type':'application/json'},body:body.value,signal:AbortSignal.timeout(12000)});status.textContent='HTTP '+r.status;document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2);}catch{status.textContent='Revisá el JSON o reintentá la conexión.';}};</script></html>`;
