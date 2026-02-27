import { NextResponse } from "next/server";
import { auth } from "@/auth";

const protectedRoutes = ["/account", "/friends", "/calendar"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const needsAuth = protectedRoutes.some((route) => pathname.startsWith(route));
  if (!needsAuth) return NextResponse.next();
  if (req.auth) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
