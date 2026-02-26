import { auth } from "@/auth";

export async function resolveUserIdFromRequest(request: Request) {
  const authSession = await auth();
  if (authSession?.user?.id) {
    return authSession.user.id;
  }
  void request;
  return null;
}
