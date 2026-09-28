export type RegistrationSource = 'mini_app' | 'bot';

export interface UserRecord {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  status: 'active' | 'blocked' | 'deleted';
}

export interface RegistrationRecord {
  user: UserRecord;
  created: boolean;
  source: RegistrationSource;
  referralCode: string;
  referredByCode: string | null;
  registeredAt: string;
}
