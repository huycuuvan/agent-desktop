import { z } from "zod";

export const adsPowerLocalActiveItemSchema = z.object({
  user_id: z.string(),
  name: z.string().optional().default(""),
  ws: z.object({
    selenium: z.string().optional().default(""),
    puppeteer: z.string(),
  }),
  debug_port: z.string().optional().default(""),
});

export const adsPowerLocalActiveResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      list: z.array(adsPowerLocalActiveItemSchema),
    })
    .optional(),
});

export type AdsPowerLocalActiveItem = z.infer<typeof adsPowerLocalActiveItemSchema>;
