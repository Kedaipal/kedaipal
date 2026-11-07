import { z } from "zod";

/**
 * Server-side env vars. Validated at module load — fails fast on misconfiguration.
 * Add new vars here as features land.
 */
const serverEnvSchema = z.object({
	CONVEX_URL: z.string().url().optional(),
	CONVEX_DEPLOYMENT: z.string().optional(),
	CLERK_SECRET_KEY: z.string().optional(),
	SITE_URL: z.string().url().optional(),
	WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
	WHATSAPP_ACCESS_TOKEN: z.string().optional(),
	WHATSAPP_VERIFY_TOKEN: z.string().optional(),
});

/**
 * A blank env var means UNSET, not "the empty string".
 *
 * `.env.local.example` deliberately ships several of these keys empty so local
 * traffic stays out of the production analytics projects, and Vite inlines that
 * as `""`. Without this, `z.string().url()` rejects the empty string and the
 * whole module throws at import — taking the entire app down over an unset
 * optional. Falsy-checked consumers (`if (!id) return`) are unaffected.
 */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? undefined : value,
		schema.optional(),
	);
}

/**
 * Client-side env vars. Must be prefixed VITE_ to be exposed to the browser.
 */
const clientEnvSchema = z.object({
	VITE_CONVEX_URL: z.string().url().optional(),
	VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
	VITE_GA_MEASUREMENT_ID: optionalEnv(z.string()),
	VITE_CLARITY_PROJECT_ID: optionalEnv(z.string()),
	VITE_POSTHOG_KEY: optionalEnv(z.string()),
	VITE_POSTHOG_HOST: optionalEnv(z.string().url()),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export const serverEnv: ServerEnv = serverEnvSchema.parse({
	CONVEX_URL: process.env.CONVEX_URL,
	CONVEX_DEPLOYMENT: process.env.CONVEX_DEPLOYMENT,
	CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
	SITE_URL: process.env.SITE_URL,
	WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
	WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
	WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
});

export const clientEnv: ClientEnv = clientEnvSchema.parse({
	VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
	VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
	VITE_GA_MEASUREMENT_ID: import.meta.env.VITE_GA_MEASUREMENT_ID,
	VITE_CLARITY_PROJECT_ID: import.meta.env.VITE_CLARITY_PROJECT_ID,
	VITE_POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY,
	VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
});
