// Provider payloads are untrusted JSON. Adapters check arrays, country/SRID and coordinates before returning candidates.
interface Named {
  id?: string;
  nombre?: string;
}
interface GeorefItem {
  id: string;
  nombre: string;
  nomenclatura?: string;
  ubicacion?: { lat?: unknown; lon?: unknown };
  centroide?: { lat?: unknown; lon?: unknown };
  calle?: Named;
  calle_cruce_1?: Named;
  altura?: { valor?: string | number };
  provincia?: Named;
  localidad?: Named;
  localidad_censal?: Named;
  departamento?: Named;
}
export interface GeorefResponse {
  direcciones?: GeorefItem[];
  calles?: GeorefItem[];
  localidades?: GeorefItem[];
  provincias?: GeorefItem[];
  ubicacion?: GeorefItem;
  total?: number;
}
export interface UsigResponse {
  direccionesNormalizadas?: {
    coordenadas?: { srid?: unknown; x?: unknown; y?: unknown };
    nombre_calle?: string;
    altura?: string | number;
    nombre_localidad?: string;
    nombre_partido?: string;
    direccion?: string;
    tipo?: string;
  }[];
}
export interface PhotonResponse {
  features?: {
    geometry?: { coordinates?: unknown[] };
    properties: {
      countrycode?: string;
      street?: string;
      housenumber?: string;
      city?: string;
      town?: string;
      district?: string;
      state?: string;
      postcode?: string;
      name?: string;
    };
  }[];
}
export interface GeoapifyResponse {
  results?: {
    country_code?: string;
    lat?: unknown;
    lon?: unknown;
    street?: string;
    housenumber?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    formatted?: string;
    result_type?: string;
  }[];
}

export interface PeliasResponse {
  features?: {
    geometry?: { coordinates?: unknown[] };
    properties: {
      country_a?: string;
      street?: string;
      housenumber?: string;
      locality?: string;
      localadmin?: string;
      region?: string;
      postalcode?: string;
      label?: string;
      layer?: string;
      accuracy?: string;
    };
  }[];
}
interface MapTilerContext {
  id?: string;
  text?: string;
  country_code?: string;
}
export interface MapTilerResponse {
  features?: {
    geometry?: { coordinates?: unknown[] };
    center?: unknown[];
    text?: string;
    address?: string;
    place_name?: string;
    place_type?: string[];
    properties?: { country_code?: string };
    context?: MapTilerContext[];
  }[];
}
