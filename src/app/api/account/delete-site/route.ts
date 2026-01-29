import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROJECT_ID = "watch";

export async function POST(request: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(token);

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = userData.user.id;

  const deletes = await Promise.all([
    supabaseAdmin
      .from("watch_history_shares")
      .delete()
      .eq("project_id", PROJECT_ID)
      .or(`owner_id.eq.${userId},target_user_id.eq.${userId}`),
    supabaseAdmin
      .from("watch_history")
      .delete()
      .eq("project_id", PROJECT_ID)
      .eq("user_id", userId),
    supabaseAdmin
      .from("watchlist_items")
      .delete()
      .eq("project_id", PROJECT_ID)
      .eq("user_id", userId),
    supabaseAdmin
      .from("friend_requests")
      .delete()
      .eq("project_id", PROJECT_ID)
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
    supabaseAdmin
      .from("friends")
      .delete()
      .eq("project_id", PROJECT_ID)
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`),
  ]);

  const failed = deletes.find((result) => result.error);
  if (failed?.error) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
