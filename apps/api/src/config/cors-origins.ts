import { z } from 'zod';

const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const originSchema = z
  .string()
  .url()
  .refine((origin) => {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin
    );
  }, 'CORS origins must be HTTP(S) origins without a path.');

export function getAllowedCorsOrigins(
  configuredOrigins = process.env.CORS_ORIGINS,
): string[] {
  if (configuredOrigins === undefined) {
    return defaultCorsOrigins;
  }

  const origins = configuredOrigins.split(',').map((origin) => origin.trim());

  return z
    .array(originSchema)
    .min(1)
    .parse(origins)
    .filter(
      (origin, index, allOrigins) => allOrigins.indexOf(origin) === index,
    );
}
