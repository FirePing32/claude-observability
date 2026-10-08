import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { mayUseApp, NOT_ALLOWED } from "./access";
import { db, schema } from "./db";

export const devPasswordLogin = process.env.NODE_ENV !== "production" && process.env.DEV_PASSWORD_LOGIN === "1";
export const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  // Local development only, so the app can be tried before a Google OAuth client exists.
  emailAndPassword: { enabled: devPasswordLogin },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  // Access control: only allowlisted leads and people they invited can sign in.
  // Checked when the account is first created and on every new sign-in session.
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          if (!(await mayUseApp(u.email))) throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
        },
      },
    },
    session: {
      create: {
        before: async (s) => {
          const [u] = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, s.userId));
          if (!u || !(await mayUseApp(u.email))) throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
