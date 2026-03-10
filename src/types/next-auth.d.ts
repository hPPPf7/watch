import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      auth_provider?: string | null;
      auth_provider_account_id?: string | null;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      user_metadata?: {
        full_name?: string | null;
        name?: string | null;
        preferred_username?: string | null;
        avatar_url?: string | null;
        picture?: string | null;
        avatar?: string | null;
      };
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    app_user_id?: string;
    account_deleted?: boolean;
    profile_sync_pending?: boolean;
    auth_provider?: string | null;
    auth_provider_account_id?: string | null;
    user_metadata?: {
      full_name?: string | null;
      name?: string | null;
      preferred_username?: string | null;
      avatar_url?: string | null;
      picture?: string | null;
      avatar?: string | null;
    };
  }
}
