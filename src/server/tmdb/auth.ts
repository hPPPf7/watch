import { auth } from "@/auth";

export async function getOptionalTmdbUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
