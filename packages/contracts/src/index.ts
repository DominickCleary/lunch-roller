import { z } from 'zod';

export const id = z.uuid();
export const name = z.string().trim().min(1).max(100);
export const participantSelection = z.object({ participantId: id });
export const participant = z.object({ id, name, active: z.boolean() });
export const place = z.object({
  id,
  name,
  active: z.boolean(),
  logWeight: z.number().finite(),
});
export const createParticipant = z.object({ name });
export const updateParticipant = z.object({
  name: name.optional(),
  active: z.boolean().optional(),
});
export const createPlace = z.object({ name });
export const updatePlace = z.object({
  name: name.optional(),
  active: z.boolean().optional(),
});
export const attendanceRequest = z.object({ drawId: id });
export const purchaseRequest = z.object({
  placeId: id,
  action: z.enum(['boost', 'reduce']),
});
export const schedule = z.object({
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Duplicate weekdays'),
});
export const defaultSchedule = {
  timezone: 'Europe/Dublin',
  time: '11:30',
  weekdays: [1, 2, 3, 4, 5],
} satisfies z.infer<typeof schedule>;
export const draw = z.object({
  id,
  localDate: z.iso.date(),
  placeId: id,
  placeName: name,
  drawnAt: z.iso.datetime(),
});
export const todayResponse = z.object({
  localDate: z.iso.date(),
  schedule,
  status: z.enum(['pending', 'drawn', 'no-options', 'not-scheduled']),
  result: draw.nullable(),
  odds: z.array(
    z.object({ placeId: id, name, probability: z.number().min(0).max(1) }),
  ),
});
export const walletResponse = z.object({
  balance: z.number().int().nonnegative(),
});
export const attendanceResponse = z.object({
  drawId: id,
  awardedTokens: z.number().int(),
  balance: z.number().int().nonnegative(),
});
export const purchaseResponse = z.object({
  place,
  spentTokens: z.number().int().positive(),
  balance: z.number().int().nonnegative(),
});
export const adminLogin = z.object({ password: z.string().min(1).max(1024) });
export const tokenCorrection = z.object({
  participantId: id,
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
});
export const pushSubscription = z.object({
  endpoint: z.url().startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export const healthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['ok', 'unavailable']),
  service: z.literal('web'),
});
export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type TodayResponse = z.infer<typeof todayResponse>;
export type PurchaseRequest = z.infer<typeof purchaseRequest>;
export type Schedule = z.infer<typeof schedule>;
