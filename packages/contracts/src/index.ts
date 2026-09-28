import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });
const telegramUser = z.object({
  id: z.string().regex(/^\d+$/),
  username: z.string().max(64).nullable(),
  firstName: z.string().min(1).max(128),
  lastName: z.string().max(128).nullable()
}).strict();

export const ReferralCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/);

export const TelegramRegistrationRequestSchema = z.object({
  initData: z.string().min(1).max(8_192),
  referralCode: ReferralCodeSchema.optional()
}).strict();

export const BotRegistrationRequestSchema = z.object({
  telegramUser,
  referralCode: ReferralCodeSchema.optional()
}).strict();

export const RegistrationSchema = z.object({
  created: z.boolean(),
  source: z.enum(['mini_app', 'bot']),
  referralCode: z.string().regex(/^[A-Z0-9]{6}$/),
  referredByCode: z.string().regex(/^[A-Z0-9]{6}$/).nullable(),
  registeredAt: isoDateTime
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  telegramUserId: z.string().regex(/^\d+$/),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable()
});

export const AuthResponseSchema = z.object({
  expiresAt: isoDateTime,
  user: UserSchema,
  registration: RegistrationSchema
});

export const BotRegistrationResponseSchema = z.object({
  user: UserSchema,
  registration: RegistrationSchema
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    requestId: z.string().uuid()
  })
});

export type TelegramRegistrationRequest = z.infer<typeof TelegramRegistrationRequestSchema>;
export type BotRegistrationRequest = z.infer<typeof BotRegistrationRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type BotRegistrationResponse = z.infer<typeof BotRegistrationResponseSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
export type User = z.infer<typeof UserSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
