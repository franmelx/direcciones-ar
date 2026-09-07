import type { IncomingMessage, ServerResponse } from "node:http";
import type { Options, createGeocoder } from "./index";
export function createHandler(
  options?: Options & {
    allowedOrigins?: string[];
    requestsPerMinute?: number;
    geocoder?: ReturnType<typeof createGeocoder>;
  },
): (
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) => Promise<void>;
