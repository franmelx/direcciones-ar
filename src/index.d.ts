export interface SearchInput {
  query: string;
  number?: string;
  city?: string;
  province?: string;
  postcode?: string;
}
export interface Candidate {
  id: string;
  lat: number;
  lng: number;
  label: string;
  address: {
    street: string;
    number: string;
    city: string;
    province: string;
    postcode: string;
  };
  provider: string;
  precision:
    | "address"
    | "interpolated"
    | "street"
    | "intersection"
    | "locality"
    | "region";
  confidence: "low" | "medium";
  requiresConfirmation: true;
  warnings: string[];
  attribution: { name: string; url: string };
  score: number;
}
export interface Result {
  status: "ok" | "not_found" | "unavailable";
  candidates: Candidate[];
  providers: { name: string; status: string }[];
  warnings: string[];
  requiresConfirmation: true;
}
export interface Options {
  georefUrl?: string | false;
  usigUrl?: string | false;
  photonUrl?: string | false;
  photonFallbackOnly?: boolean;
  geoapifyKey?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}
export interface Prediction extends Omit<Candidate, "lat" | "lng"> {
  lat: number | null;
  lng: number | null;
  kind: "address" | "street" | "locality";
  requiresResolution: boolean;
  searchInput: SearchInput;
}
export interface Suggestions extends Result {
  predictions: Prediction[];
}
export interface CatalogInput {
  query?: string;
  province?: string;
}
export interface CatalogResult {
  status: "ok" | "not_found" | "unavailable";
  items: {
    id: string;
    name: string;
    province?: { id: string; name: string };
    center: { lat: number; lng: number } | null;
    precision: string;
    attribution: Candidate["attribution"];
  }[];
  total?: number;
  limit?: number;
}
export function createGeocoder(options?: Options): {
  search(input: SearchInput): Promise<Result>;
  suggest(input: SearchInput): Promise<Suggestions>;
  provinces(input?: CatalogInput): Promise<CatalogResult>;
  localities(input?: CatalogInput): Promise<CatalogResult>;
  providers(): {
    providers: {
      name: string;
      enabled: boolean;
      coverage: string;
      attribution: Candidate["attribution"];
    }[];
  };
  reverse(input: { lat: number; lng: number }): Promise<Result>;
  clearCache(): void;
};
export function coordinates(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null;
export function normalizeInput(
  input: SearchInput,
): SearchInput & { street: string };
