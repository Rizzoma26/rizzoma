import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL must use PostgreSQL'
  ),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  BOT_TOKEN: z.string().min(20),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  ALLOWED_ORIGINS: z.string().min(1),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0)
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  poolMax: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  botToken: string;
  telegramAuthMaxAgeSeconds: number;
  sessionTtlSeconds: number;
  allowedOrigins: Set<string>;
  trustProxyHops: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.parse(environment);
  const origins = parsed.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.some((origin) => origin === '*' || !/^https?:\/\//.test(origin))) {
    throw new Error('ALLOWED_ORIGINS must contain exact http(s) origins; wildcards are forbidden');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    poolMax: parsed.PG_POOL_MAX,
    connectionTimeoutMs: parsed.PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: parsed.PG_IDLE_TIMEOUT_MS,
    botToken: parsed.BOT_TOKEN,
    telegramAuthMaxAgeSeconds: parsed.TELEGRAM_AUTH_MAX_AGE_SECONDS,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    allowedOrigins: new Set(origins),
    trustProxyHops: parsed.TRUST_PROXY_HOPS
  };
}
