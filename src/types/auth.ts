export type LegacySession = {
  user: {
    id: string;
    auth_provider?: string | null;
    auth_provider_account_id?: string | null;
    email?: string | null;
    user_metadata?: {
      full_name?: string | null;
      name?: string | null;
      preferred_username?: string | null;
      avatar_url?: string | null;
      picture?: string | null;
      avatar?: string | null;
    };
  };
};

