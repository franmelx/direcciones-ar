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
  supportingProviders?: string[];
  spreadMeters?: number;
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
  peliasUrl?: string | false;
  peliasKey?: string;
  maptilerKey?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  userAgent?: string;
  fetch?: (url: URL, init?: RequestInit) => Promise<Response>;
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
  warnings?: string[];
  total?: number;
  limit?: number;
}

export type Provider =
  | "georef"
  | "usig"
  | "geoapify"
  | "photon"
  | "pelias"
  | "maptiler";
export interface Point {
  lat: number;
  lng: number;
}
export type NormalizedInput = Required<SearchInput> & { street: string };
export type CandidateBase = Omit<
  Candidate,
  "score" | "confidence" | "warnings"
> & { provider: Provider };
export type PredictionBase = Omit<
  Prediction,
  "score" | "confidence" | "warnings"
> & { provider: Provider };
export type Unranked = CandidateBase | PredictionBase;
export type Ranked = Unranked &
  Pick<Candidate, "score" | "confidence" | "warnings">;
export type CandidateValues = Partial<
  Record<keyof Candidate["address"] | "lat" | "lng" | "label", unknown>
> & { precision?: Candidate["precision"] };
export interface Geocoder {
  search(input: SearchInput): Promise<Result>;
  suggest(input: SearchInput): Promise<Suggestions>;
  reverse(input: Point): Promise<Result>;
  provinces(input?: CatalogInput): Promise<CatalogResult>;
  localities(input?: CatalogInput): Promise<CatalogResult>;
  providers(): {
    providers: {
      name: Provider;
      enabled: boolean;
      coverage: string;
      attribution: Candidate["attribution"];
    }[];
  };
  clearCache(): void;
}
