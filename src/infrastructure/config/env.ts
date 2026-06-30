import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADSPOWER_API_BASE_URL: z.string().url().default("http://local.adspower.net:50325"),
  ADSPOWER_API_KEY: z.string().optional(),
  WATCH_PROVIDER_CODE: z.string().min(1).default("QKA"),
  GOOGLE_ADS_DATE_MODE: z.enum(["TODAY", "YESTERDAY", "LAST_2_DAYS", "AUTO"]).default("AUTO"),
  GOOGLE_ADS_ACTION_DELAY_MS: z.coerce.number().int().positive().default(2000),
  GOOGLE_ADS_TABLE_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  GOOGLE_ADS_SETTLE_DELAY_MS: z.coerce.number().int().positive().default(5000),
  GOOGLE_ADS_STABLE_CHECKS: z.coerce.number().int().positive().default(3),
  GOOGLE_ADS_STABLE_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_CREDENTIALS_PATH: z.string().optional(),
  GOOGLE_SHEETS_TAB_NAME: z.string().min(1).default("Campaigns"),
  AGENT_SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AGENT_SCAN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
  AGENT_RUN_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_NOTIFICATIONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GMAIL_WEB_INTAKE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEFAULT_ADSPOWER_PROFILE_ID: z.string().optional(),
  GMAIL_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  GMAIL_ACCEPT_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  GMAIL_ACCEPT_PAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  GMAIL_ACCEPT_SETTLE_DELAY_MS: z.coerce.number().int().positive().default(3000),
  GMAIL_CAMPAIGNS_PAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  GMAIL_CAMPAIGNS_SETTLE_DELAY_MS: z.coerce.number().int().positive().default(5000),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
