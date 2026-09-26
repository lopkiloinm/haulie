import type { NextRequest } from "next/server";
import { unseal, type Session } from "./protocol";

export const secure = process.env.NODE_ENV === "production";
const prefix = secure ? "__Host-" : "";
export const pendingCookie = `${prefix}haulie-world-pending`;
export const sessionCookie = `${prefix}haulie-world-session`;
export const cookieOptions = {
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
};

export function worldConfig() {
  return {
    clientId: process.env.WORLD_SANDBOX_CLIENT_ID || "",
    secret: process.env.WORLD_SANDBOX_CLIENT_SECRET || "",
    sessionKey: process.env.WORLD_SANDBOX_SESSION_SECRET || "",
    origin: process.env.WORLD_SANDBOX_ORIGIN || "https://haulie-chi.vercel.app",
  };
}

export function worldReady() {
  const c = worldConfig();
  return !!(c.clientId && c.secret && c.sessionKey.length >= 32);
}

export async function readWorldSession(request: NextRequest): Promise<Session> {
  return (
    (await unseal<Session>(
      request.cookies.get(sessionCookie)?.value,
      worldConfig().sessionKey,
      "session",
    )) || { jobs: {} }
  );
}
