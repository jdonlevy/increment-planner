import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Allow the auth page and all API routes through
  if (pathname.startsWith("/auth") || pathname.startsWith("/api")) {
    return NextResponse.next();
  }
  const auth = req.cookies.get("planner_auth")?.value;
  if (auth !== "true") {
    const url = req.nextUrl.clone();
    url.pathname = "/auth";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
