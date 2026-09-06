export interface SearchInput { query: string; number?: string; city?: string; province?: string; postcode?: string }
export interface Candidate {
 id: string; lat: number; lng: number; label: string;
 address: { street: string; number: string; city: string; province: string; postcode: string };
 provider: string; precision: 'address' | 'interpolated' | 'street' | 'intersection' | 'locality' | 'region';
 confidence: 'low' | 'medium'; requiresConfirmation: true; warnings: string[];
 attribution: { name: string; url: string }; score: number;
}
export interface Result { status: 'ok' | 'not_found' | 'unavailable'; candidates: Candidate[]; providers: { name: string; status: string }[]; warnings: string[]; requiresConfirmation: true }
export interface Options { georefUrl?: string | false; usigUrl?: string | false; photonUrl?: string; timeoutMs?: number; minIntervalMs?: number; cacheSize?: number; cacheTtlMs?: number; userAgent?: string; fetch?: typeof fetch }
export function createGeocoder(options?: Options): { search(input: SearchInput): Promise<Result>; reverse(input: { lat: number; lng: number }): Promise<Result>; clearCache(): void };
export function coordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | null;
export function normalizeInput(input: SearchInput): SearchInput & { street: string };
