import { z } from "zod";

/** No arguments — the market brief is parameter-free. */
export const GetMarketBriefSchema = z.object({});

/** No arguments — the catalogue is free and parameter-free. */
export const GetCatalogSchema = z.object({});

export const GetEventRiskSchema = z.object({
  /** Window in days, 1-90. Default 7. */
  days: z.number().int().min(1).max(90).optional().default(7),
  /** Only events of at least this importance (1-3). Default 1 = everything. */
  minImportance: z.number().int().min(1).max(3).optional().default(1),
});

export type GetEventRiskArgs = z.infer<typeof GetEventRiskSchema>;
