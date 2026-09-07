// Delyva courier booking — Convex functions (ClickUp 86eyjpv6z).
//
// Pure client mechanics live in convex/lib/delyva.ts. This module owns:
//  - the network client (fetch against api.delyva.app),
//  - the single-key connect flow (validate via GET /user + GET /customer,
//    store encrypted, auto-subscribe webhooks),
//  - dispatch (quote → pick service → draft + process) on the SAME
//    reserve → commit/release invariant as Lalamove,
//  - webhook context + the idempotent event handler.
// See docs/delivery-delyva.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import {
	buildCreateOrderBody,
	buildDelyvaHeaders,
	buildInstantQuoteBody,
	classifyDelyvaFailure,
	decryptDelyvaCredentials,
	DELYVA_BASE_URL,
	DELYVA_WEBHOOK_EVENTS,
	type DelyvaAddress,
	type DelyvaContact,
	type DelyvaCredentials,
	type DelyvaInventoryLine,
	type DelyvaItemType,
	type DelyvaService,
	isFailedDeliveryAttempt,
	normalizeDelyvaStatus,
	parseDelyvaErrorMessage,
	parseCompanyResponse,
	countActiveDelyvaServices,
	parseInstantQuoteResponse,
	parseOrderResponse,
	resolveDelyvaCredentials,
} from "./lib/delyva";
import { isActiveJobStatus } from "./lib/deliveryJobs";
import { encryptSecret } from "./lib/credentialCrypto";
import { postcodeRule, SG_STATE_LABEL } from "./lib/address";
import { isColdItemType } from "./lib/liveQuote";
import { DEFAULT_COUNTRY, type Country } from "./lib/country";
import {
	type CartWeightItem,
	delyvaBookingAllowed,
	summarizeCartWeight,
} from "./lib/delivery";
import { findCourier } from "./lib/couriers";
import { requireRetailerAccess, logAdminAction } from "./lib/auth";
import type { RetailerAccess } from "./lib/auth";
import { applyStatusTransition, resolveSharedOrder } from "./orders";
import {
	assertPlanFeature,
	assertSubscriptionActive,
} from "./subscriptions";

type DelyvaConfig = NonNullable<Doc<"retailers">["delyva"]>;

/** Non-2xx Delyva response. `body` is the raw text — mapped to seller copy
 * at the dispatch boundary, logged elsewhere. Never contains our key. */
export class DelyvaApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
	) {
		super(`Delyva API ${status}: ${body.slice(0, 300)}`);
		this.name = "DelyvaApiError";
	}
}

/** Authenticated fetch against the Delyva API. The single decrypt-at-use
 * choke point (86eyn25gk posture, mirroring callLalamove). */
async function callDelyva(
	credentials: DelyvaCredentials,
	method: "GET" | "POST" | "DELETE" | "PATCH",
	path: string,
	body?: Record<string, unknown>,
	idempotencyKey?: string,
): Promise<unknown> {
	const live = await decryptDelyvaCredentials(credentials);
	const res = await fetch(`${DELYVA_BASE_URL}${path}`, {
		method,
		headers: {
			...buildDelyvaHeaders(live.apiKey),
			...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const text = await res.text();
	if (!res.ok) throw new DelyvaApiError(res.status, text);
	return text ? JSON.parse(text) : {};
}

/** Bare-key client for the connect probe — before any credentials exist. */
async function callDelyvaWithKey(
	plainApiKey: string,
	method: "GET" | "POST" | "DELETE",
	path: string,
	body?: Record<string, unknown>,
): Promise<unknown> {
	const res = await fetch(`${DELYVA_BASE_URL}${path}`, {
		method,
		headers: buildDelyvaHeaders(plainApiKey),
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const text = await res.text();
	if (!res.ok) throw new DelyvaApiError(res.status, text);
	return text ? JSON.parse(text) : {};
}

const itemTypeValidator = v.union(
	v.literal("PARCEL"),
	v.literal("CHILLED"),
	v.literal("FROZEN"),
);

const pickupAddressValidator = v.object({
	address1: v.string(),
	address2: v.optional(v.string()),
	city: v.string(),
	state: v.string(),
	postcode: v.string(),
});

// ---------------------------------------------------------------------------
// Connect / disconnect / settings
// ---------------------------------------------------------------------------

/** Resolve the target store for a settings-flavoured call: explicit
 * `retailerId` = admin act-as, absent = the caller's own store. Mirrors
 * retailers.updateSettings. */
async function resolveStoreAccess(
	ctx: QueryCtx,
	retailerId: Id<"retailers"> | undefined,
): Promise<RetailerAccess> {
	if (retailerId) return requireRetailerAccess(ctx, retailerId);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const own = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.first();
	if (!own) throw new ConvexError("No store found");
	return { retailer: own, actingAsAdmin: false, userId: identity.subject };
}

/** Everything the connect action needs to know before touching the network. */
export const getConnectContext = internalQuery({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		| { ok: false; message: string }
		| {
				ok: true;
				retailerId: Id<"retailers">;
				actingAsAdmin: boolean;
				country: Country;
		  }
	> => {
		const access = await resolveStoreAccess(ctx, retailerId);
		const country = access.retailer.country ?? DEFAULT_COUNTRY;
		if (!delyvaBookingAllowed(country)) {
			return {
				ok: false,
				// Both MY and SG are served now (z8r3fdbqmc), so this is the guard
				// for a country we haven't opened yet — worded without naming one.
				message:
					"Delyva courier booking isn't available in your store's country yet — arrange your own courier and record the tracking number on the order.",
			};
		}
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, access.retailer._id);
			// Pro gate on CONNECTING (the enable moment); disconnecting stays
			// un-gated — downgrade never traps (house posture).
			await assertPlanFeature(ctx, access.retailer._id, "delivery");
		}
		return {
			ok: true,
			retailerId: access.retailer._id,
			actingAsAdmin: access.actingAsAdmin,
			country,
		};
	},
});

export const storeConnection = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		// Already `enc.v1.`-encrypted by the connect action — no plaintext
		// credential ever passes through the mutation log.
		apiKey: v.string(),
		apiSecret: v.optional(v.string()),
		apiKeyHint: v.string(),
		customerId: v.number(),
		companyId: v.optional(v.string()),
		accountName: v.optional(v.string()),
		isDemo: v.optional(v.boolean()),
		companyCode: v.optional(v.string()),
		// The pickup address on the seller's Delyva PROFILE, imported at
		// connect so the seller doesn't retype what Delyva already knows.
		// Fill-if-unset only: an address the seller already saved here wins —
		// they may have deliberately corrected what Delyva holds.
		importedPickupAddress: v.optional(pickupAddressValidator),
	},
	handler: async (ctx, args) => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return;
		const prev = retailer.delyva as DelyvaConfig | undefined;
		await ctx.db.patch(args.retailerId, {
			delyva: {
				// A fresh key connects ENABLED — connecting is the enable gesture
				// (one less switch to discover); updateSettings can pause later.
				enabled: true,
				apiKey: args.apiKey,
				apiSecret: args.apiSecret,
				apiKeyHint: args.apiKeyHint,
				customerId: args.customerId,
				companyId: args.companyId,
				accountName: args.accountName,
				isDemo: args.isDemo,
				companyCode: args.companyCode,
				// Pickup address + parcel-type default survive a key rotation.
				defaultItemType: prev?.defaultItemType,
				pickupAddress: prev?.pickupAddress ?? args.importedPickupAddress,
				connectedAt: prev?.connectedAt ?? Date.now(),
				// Re-stamped by markWebhooksSubscribed once the subscribe pass
				// after this save succeeds; a rotation resets it honestly.
				webhooksSubscribedAt: undefined,
			},
			updatedAt: Date.now(),
		});
	},
});

export const markWebhooksSubscribed = internalMutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const retailer = await ctx.db.get(retailerId);
		const config = retailer?.delyva as DelyvaConfig | undefined;
		if (!retailer || !config) return;
		await ctx.db.patch(retailerId, {
			delyva: { ...config, webhooksSubscribedAt: Date.now() },
			updatedAt: Date.now(),
		});
	},
});

/** Register our webhook URL for every event we consume — idempotent (lists
 * first, creates only what's missing). Throws on failure; callers decide how
 * loud to be. */
async function subscribeWebhooks(
	plainApiKey: string,
	siteUrl: string,
): Promise<void> {
	const url = `${siteUrl}/webhook/delyva`;
	const listing = (await callDelyvaWithKey(plainApiKey, "GET", "/webhook")) as {
		data?: Array<{ id?: string; event?: string; url?: string }>;
	};
	const existing = new Set(
		(listing.data ?? [])
			.filter((w) => w.url === url && typeof w.event === "string")
			.map((w) => w.event as string),
	);
	for (const event of DELYVA_WEBHOOK_EVENTS) {
		if (existing.has(event)) continue;
		await callDelyvaWithKey(plainApiKey, "POST", "/webhook", { event, url });
	}
}

/**
 * Connect a seller's Delyva account from ONE pasted API key (locked decision
 * 27 Aug — deviates from the ticket's two-field AC on purpose):
 *  1. GET /user validates the key and yields the webhook HMAC secret,
 *  2. GET /customer yields the integer customerId quote/order payloads need,
 *  3. both secrets are encrypted here (action = crypto.subtle) and stored,
 *  4. our webhook URL is auto-subscribed — zero portal steps for the seller.
 */
export const connect = action({
	args: {
		retailerId: v.optional(v.id("retailers")),
		apiKey: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| { ok: false; message: string }
		| {
				ok: true;
				accountName?: string;
				webhooksSubscribed: boolean;
				isDemo?: boolean;
		  }
	> => {
		const context = await ctx.runQuery(internal.delyva.getConnectContext, {
			retailerId: args.retailerId,
		});
		if (!context.ok) return context;
		const apiKey = args.apiKey.trim();
		if (!apiKey) {
			return { ok: false, message: "Paste your Delyva API key first." };
		}

		let apiSecret: string | undefined;
		let companyId: string | undefined;
		let customerId: number | undefined;
		let accountName: string | undefined;
		let isDemo: boolean | undefined;
		let companyCode: string | undefined;
		let importedPickupAddress:
			| {
					address1: string;
					address2?: string;
					city: string;
					state: string;
					postcode: string;
			  }
			| undefined;
		try {
			const user = (await callDelyvaWithKey(apiKey, "GET", "/user")) as {
				data?: { apiSecret?: unknown; companyId?: unknown; name?: unknown };
			};
			apiSecret =
				typeof user.data?.apiSecret === "string" && user.data.apiSecret
					? user.data.apiSecret
					: undefined;
			companyId =
				typeof user.data?.companyId === "string" && user.data.companyId
					? user.data.companyId
					: undefined;
			const customer = (await callDelyvaWithKey(apiKey, "GET", "/customer")) as {
				data?: {
					id?: unknown;
					name?: unknown;
					unitNo?: unknown;
					address1?: unknown;
					address2?: unknown;
					city?: unknown;
					state?: unknown;
					postcode?: unknown;
				};
			};
			customerId =
				typeof customer.data?.id === "number" ? customer.data.id : undefined;
			accountName =
				typeof customer.data?.name === "string" && customer.data.name
					? customer.data.name
					: undefined;
			// The profile's pickup address, imported so the seller doesn't retype
			// what Delyva already knows (verified live: unitNo/address1/address2
			// are split on their side — recompose into our address1 + unit line).
			// PREFILL, not truth: it stays editable, and an address the seller
			// already saved with us always wins (storeConnection fill-if-unset) —
			// a real account was seen holding a stale postcode.
			const str = (v: unknown) =>
				typeof v === "string" && v.trim() ? v.trim() : undefined;
			const profile = customer.data ?? {};
			const line1 = [str(profile.unitNo), str(profile.address1)]
				.filter(Boolean)
				.join(" ");
			const profilePostcode = str(profile.postcode);
			const rule = postcodeRule(context.country);
			if (line1 && profilePostcode && rule.pattern.test(profilePostcode)) {
				importedPickupAddress =
					context.country === "SG"
						? {
								address1: line1,
								address2: str(profile.address2),
								city: SG_STATE_LABEL,
								state: SG_STATE_LABEL,
								postcode: profilePostcode,
							}
						: str(profile.city) && str(profile.state)
							? {
									address1: line1,
									address2: str(profile.address2),
									// biome-ignore lint/style/noNonNullAssertion: guarded above
									city: str(profile.city)!,
									// biome-ignore lint/style/noNonNullAssertion: guarded above
									state: str(profile.state)!,
									postcode: profilePostcode,
								}
							: undefined;
			}
			// Which Delyva WORLD this key lives in. Their demo environment
			// shares the production API host and issues no key prefix, so the
			// company record is the only tell — `code: "demo"` /
			// `websiteUrl: demo.delyva.app`. Non-fatal: an unreadable company
			// leaves `isDemo` unset, which every surface renders as "unknown"
			// rather than a false all-clear.
			if (companyId) {
				try {
					const company = parseCompanyResponse(
						await callDelyvaWithKey(
							apiKey,
							"GET",
							`/company/${encodeURIComponent(companyId)}`,
						),
					);
					isDemo = company.isDemo;
					companyCode = company.code;
				} catch (err) {
					console.warn("[delyva] company lookup failed — env unknown", {
						message: err instanceof Error ? err.message : String(err),
					});
				}
			}
		} catch (err) {
			if (err instanceof DelyvaApiError && err.status === 401) {
				return {
					ok: false,
					message:
						"Delyva didn't recognise this API key. Copy it again from the Delyva app → Settings → API Integrations.",
				};
			}
			console.warn("[delyva] connect probe failed", {
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				message:
					"Couldn't reach Delyva to check the key. Please try again in a moment.",
			};
		}
		if (customerId === undefined) {
			return {
				ok: false,
				message:
					"This key authenticated, but Delyva returned no customer profile for it. Check the key belongs to your seller account, or contact Delyva support.",
			};
		}

		await ctx.runMutation(internal.delyva.storeConnection, {
			retailerId: context.retailerId,
			apiKey: await encryptSecret(apiKey),
			apiSecret: apiSecret ? await encryptSecret(apiSecret) : undefined,
			apiKeyHint: apiKey.slice(-4),
			customerId,
			companyId,
			accountName,
			isDemo,
			companyCode,
			importedPickupAddress,
		});

		// Webhooks: best-effort — a subscribe failure must not fail the connect
		// (bookings work without it; status just won't flow). The unset
		// `webhooksSubscribedAt` is the honest signal the settings card reads.
		let webhooksSubscribed = false;
		const siteUrl = process.env.CONVEX_SITE_URL;
		if (!siteUrl) {
			console.error(
				"delyva.connect: CONVEX_SITE_URL unset — cannot subscribe webhooks",
			);
		} else {
			try {
				await subscribeWebhooks(apiKey, siteUrl);
				await ctx.runMutation(internal.delyva.markWebhooksSubscribed, {
					retailerId: context.retailerId,
				});
				webhooksSubscribed = true;
			} catch (err) {
				console.warn("[delyva] webhook subscribe failed", {
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return { ok: true, accountName, webhooksSubscribed, isDemo };
	},
});

/** Re-run the webhook subscription for an already-connected account (the
 * settings card's retry when `webhooksSubscribedAt` is unset). */
export const resubscribeWebhooks = action({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		args,
	): Promise<{ ok: boolean; message?: string }> => {
		const target = await ctx.runQuery(internal.delyva.getAccountContext, {
			retailerId: args.retailerId,
		});
		if (!target) return { ok: false, message: "Connect Delyva first." };
		const siteUrl = process.env.CONVEX_SITE_URL;
		if (!siteUrl) {
			return { ok: false, message: "Webhook URL unavailable — contact support." };
		}
		try {
			const live = await decryptDelyvaCredentials(target.credentials);
			await subscribeWebhooks(live.apiKey, siteUrl);
			await ctx.runMutation(internal.delyva.markWebhooksSubscribed, {
				retailerId: target.retailerId,
			});
			return { ok: true };
		} catch (err) {
			console.warn("[delyva] webhook resubscribe failed", {
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				message: "Couldn't register the webhook with Delyva. Try again shortly.",
			};
		}
	},
});

/** Owner/admin + stored credentials, for account-level actions. */
export const getAccountContext = internalQuery({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		retailerId: Id<"retailers">;
		credentials: DelyvaCredentials;
		actingAsAdmin: boolean;
		companyId?: string;
		/** True when the demo-vs-live lookup never ran for this row (connected
		 * before detection existed, or the lookup failed) — the signal that
		 * refreshEnvironment has something to heal. */
		environmentUnknown: boolean;
	} | null> => {
		const access = await resolveStoreAccess(ctx, retailerId);
		const config = access.retailer.delyva as DelyvaConfig | undefined;
		const credentials = resolveDelyvaCredentials(config);
		if (!credentials) return null;
		return {
			retailerId: access.retailer._id,
			credentials,
			actingAsAdmin: access.actingAsAdmin,
			companyId: config?.companyId,
			environmentUnknown: config?.isDemo === undefined,
		};
	},
});

export const stampEnvironment = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		isDemo: v.boolean(),
		companyCode: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const retailer = await ctx.db.get(args.retailerId);
		const config = retailer?.delyva as DelyvaConfig | undefined;
		// Only heal a still-unstamped row — a later reconnect's fresh stamp must
		// never be overwritten by a slow in-flight lookup.
		if (!retailer || !config || config.isDemo !== undefined) return;
		await ctx.db.patch(args.retailerId, {
			delyva: {
				...config,
				isDemo: args.isDemo,
				companyCode: args.companyCode,
			},
			updatedAt: Date.now(),
		});
	},
});

/**
 * Lazily stamp demo-vs-live on a connection made BEFORE detection existed
 * (isDemo undefined renders as "unknown" — honest, but it hides the one
 * warning that matters on a demo key). Fired once by the settings card on
 * mount and piggybacked on prepareBooking, so every legacy row heals on the
 * next visit to either surface. Failure is silent: the row simply stays
 * unknown until a retry.
 */
export const getEnvironmentHealContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		credentials: DelyvaCredentials;
		companyId: string;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		const config = retailer?.delyva as DelyvaConfig | undefined;
		const credentials = resolveDelyvaCredentials(config);
		if (!credentials || !config?.companyId || config.isDemo !== undefined)
			return null;
		return { credentials, companyId: config.companyId };
	},
});

/** The scheduled twin of refreshEnvironment — runs with no user identity
 * (prepareBooking schedules it), so it resolves the retailer directly. */
export const refreshEnvironmentBySystem = internalAction({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const target = await ctx.runQuery(
			internal.delyva.getEnvironmentHealContext,
			{ retailerId },
		);
		if (!target) return;
		try {
			const live = await decryptDelyvaCredentials(target.credentials);
			const company = parseCompanyResponse(
				await callDelyvaWithKey(
					live.apiKey,
					"GET",
					`/company/${encodeURIComponent(target.companyId)}`,
				),
			);
			await ctx.runMutation(internal.delyva.stampEnvironment, {
				retailerId,
				isDemo: company.isDemo,
				companyCode: company.code,
			});
		} catch (err) {
			console.warn("[delyva] scheduled environment refresh failed", {
				message: err instanceof Error ? err.message : String(err),
			});
		}
	},
});

export const refreshEnvironment = action({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, args): Promise<{ ok: boolean }> => {
		const target = await ctx.runQuery(internal.delyva.getAccountContext, {
			retailerId: args.retailerId,
		});
		if (!target || !target.environmentUnknown || !target.companyId) {
			return { ok: false };
		}
		try {
			const live = await decryptDelyvaCredentials(target.credentials);
			const company = parseCompanyResponse(
				await callDelyvaWithKey(
					live.apiKey,
					"GET",
					`/company/${encodeURIComponent(target.companyId)}`,
				),
			);
			await ctx.runMutation(internal.delyva.stampEnvironment, {
				retailerId: target.retailerId,
				isDemo: company.isDemo,
				companyCode: company.code,
			});
			return { ok: true };
		} catch (err) {
			console.warn("[delyva] environment refresh failed", {
				message: err instanceof Error ? err.message : String(err),
			});
			return { ok: false };
		}
	},
});

export const clearConnection = internalMutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const retailer = await ctx.db.get(retailerId);
		const config = retailer?.delyva as DelyvaConfig | undefined;
		if (!retailer || !config) return;
		// Keep the seller's own setup (pickup address, parcel-type default) so
		// a reconnect is one key-paste, not a re-setup; drop everything the old
		// key owned.
		await ctx.db.patch(retailerId, {
			delyva: {
				enabled: false,
				defaultItemType: config.defaultItemType,
				pickupAddress: config.pickupAddress,
			},
			updatedAt: Date.now(),
		});
	},
});

/** Disconnect: best-effort webhook cleanup at Delyva, then clear the stored
 * credentials. Always allowed (downgrade never traps). */
export const disconnect = action({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, args): Promise<{ ok: true }> => {
		const target = await ctx.runQuery(internal.delyva.getAccountContext, {
			retailerId: args.retailerId,
		});
		if (target) {
			const siteUrl = process.env.CONVEX_SITE_URL;
			if (siteUrl) {
				try {
					const live = await decryptDelyvaCredentials(target.credentials);
					const url = `${siteUrl}/webhook/delyva`;
					const listing = (await callDelyvaWithKey(
						live.apiKey,
						"GET",
						"/webhook",
					)) as { data?: Array<{ id?: string; url?: string }> };
					for (const hook of listing.data ?? []) {
						if (hook.url === url && typeof hook.id === "string") {
							await callDelyvaWithKey(
								live.apiKey,
								"DELETE",
								`/webhook/${encodeURIComponent(hook.id)}`,
							);
						}
					}
				} catch (err) {
					// The key may already be revoked — clearing our side still stands.
					console.warn("[delyva] webhook cleanup on disconnect failed", {
						message: err instanceof Error ? err.message : String(err),
					});
				}
			}
			await ctx.runMutation(internal.delyva.clearConnection, {
				retailerId: target.retailerId,
			});
		}
		return { ok: true };
	},
});

/** Non-credential Delyva settings (settings card): pause/resume, the store's
 * parcel-type default, the structured pickup address. Credentials only ever
 * move through connect/disconnect. */
export const updateSettings = mutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		enabled: v.optional(v.boolean()),
		defaultItemType: v.optional(itemTypeValidator),
		// null clears; undefined = no change.
		pickupAddress: v.optional(v.union(pickupAddressValidator, v.null())),
	},
	handler: async (ctx, args): Promise<{ ok: true }> => {
		const access = await resolveStoreAccess(ctx, args.retailerId);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, access.retailer._id);
		const prev = access.retailer.delyva as DelyvaConfig | undefined;
		if (!prev) throw new ConvexError("Connect your Delyva account first.");
		if (args.enabled === true && !access.actingAsAdmin) {
			// Same gate as connect — re-enabling after a downgrade is the moment
			// this needs to hold. Disabling stays free.
			await assertPlanFeature(ctx, access.retailer._id, "delivery");
		}
		const pickupAddress =
			args.pickupAddress === undefined
				? prev.pickupAddress
				: args.pickupAddress === null
					? undefined
					: {
							address1: args.pickupAddress.address1.trim(),
							address2: args.pickupAddress.address2?.trim() || undefined,
							city: args.pickupAddress.city.trim(),
							state: args.pickupAddress.state.trim(),
							postcode: args.pickupAddress.postcode.trim(),
						};
		// The postcode rule is the store country's, taken from the one place that
		// owns it (convex/lib/address.ts) — Singapore's postal codes are SIX
		// digits, and a hardcoded 5 here is what made this feature MY-shaped.
		const country = access.retailer.country ?? DEFAULT_COUNTRY;
		const postcode = postcodeRule(country);
		if (
			pickupAddress &&
			(!pickupAddress.address1 ||
				!pickupAddress.city ||
				!pickupAddress.state ||
				!postcode.pattern.test(pickupAddress.postcode))
		) {
			throw new ConvexError(
				country === "SG"
					? "The pickup address needs a street address, city and a 6-digit postal code."
					: "The pickup address needs a street address, city, state and a 5-digit postcode.",
			);
		}
		await ctx.db.patch(access.retailer._id, {
			delyva: {
				...prev,
				enabled: args.enabled ?? prev.enabled,
				defaultItemType: args.defaultItemType ?? prev.defaultItemType,
				pickupAddress,
			},
			updatedAt: Date.now(),
		});
		await logAdminAction(
			ctx,
			access,
			"delyva.updateSettings",
			access.retailer._id,
		);
		return { ok: true };
	},
});

/** Secret-free settings summary for the fulfilment card. Owner-or-admin. */
export type DelyvaSummary = {
	connected: boolean;
	enabled: boolean;
	apiKeyHint?: string;
	accountName?: string;
	/** True = the key belongs to Delyva's DEMO environment (play money, no
	 * courier ever dispatched). Undefined = connected before we looked, or the
	 * lookup failed — render as "unknown", never as live. */
	isDemo?: boolean;
	companyCode?: string;
	defaultItemType: DelyvaItemType;
	pickupAddress?: {
		address1: string;
		address2?: string;
		city: string;
		state: string;
		postcode: string;
	};
	connectedAt?: number;
	webhooksSubscribed: boolean;
	countryAllowed: boolean;
};

export const getSettings = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, args): Promise<DelyvaSummary> => {
		const access = await resolveStoreAccess(ctx, args.retailerId);
		const config = access.retailer.delyva as DelyvaConfig | undefined;
		const connected = resolveDelyvaCredentials(config) !== null;
		return {
			connected,
			enabled: config?.enabled === true,
			apiKeyHint: config?.apiKeyHint,
			accountName: config?.accountName,
			isDemo: config?.isDemo,
			companyCode: config?.companyCode,
			defaultItemType: config?.defaultItemType ?? "PARCEL",
			pickupAddress: config?.pickupAddress,
			connectedAt: config?.connectedAt,
			webhooksSubscribed: config?.webhooksSubscribedAt !== undefined,
			countryAllowed: delyvaBookingAllowed(
				access.retailer.country ?? DEFAULT_COUNTRY,
			),
		};
	},
});

// ---------------------------------------------------------------------------
// Dispatch — quote, book, cancel
// ---------------------------------------------------------------------------

/** Why the Book button is disabled for this order (null = live). */
export type DelyvaDispatchBlock =
	| "country_unsupported"
	| "not_delivery"
	| "bad_status"
	| "job_active"
	| "not_connected"
	| "disabled"
	| "plan_gated"
	| "no_pickup_address"
	| "no_address";

/** Ceiling for a seller-typed parcel weight (kg) — a typo guard, matching
 * DELIVERY_BAND_KG_MAX's posture. */
export const WEIGHT_OVERRIDE_MAX_KG = 1_000;

function formatBuyerAddress(
	address: NonNullable<Doc<"orders">["deliveryAddress"]>,
	country: Country,
): DelyvaAddress {
	return {
		address1: address.line1,
		address2: address.line2,
		city: address.city,
		state: address.state,
		postcode: address.postcode,
		// The store's country, never a literal — Delyva takes SG addresses
		// unchanged (verified 2 Sep 2026) and an "MY" stamp on a Singapore
		// parcel is how a quote silently returns nothing.
		country,
	};
}

/** The order's parcel weight through the SAME summariser the weight/zone
 * pricing uses, with the weight-mode snapshot as a fallback for orders whose
 * variants have since been deleted. */
async function resolveOrderWeightKg(
	ctx: QueryCtx,
	order: Doc<"orders">,
): Promise<
	| { kind: "ok"; kg: number }
	| { kind: "custom_item" | "missing_weights"; snapshotKg?: number }
> {
	const items: CartWeightItem[] = await Promise.all(
		order.items.map(async (item): Promise<CartWeightItem> => {
			const variant = item.variantId ? await ctx.db.get(item.variantId) : null;
			return {
				parcelWeightG: variant?.parcelWeightG ?? 0,
				quantity: item.quantity,
				isCustom: variant?.isCustom === true,
			};
		}),
	);
	const summary = summarizeCartWeight(items);
	if (summary.kind === "ok") return { kind: "ok", kg: summary.grams / 1000 };
	return {
		kind: summary.kind,
		snapshotKg: order.deliverySnapshot?.chargeableKg,
	};
}

type DelyvaDispatchContext =
	| { ok: false; reason: DelyvaDispatchBlock | "not_found"; message?: string }
	| {
			ok: true;
			orderId: Id<"orders">;
			retailerId: Id<"retailers">;
			shortId: string;
			credentials: DelyvaCredentials;
			customerId: number;
			origin: DelyvaAddress & DelyvaContact;
			destination: DelyvaAddress & DelyvaContact;
			inventory: DelyvaInventoryLine[];
			/** Auto-resolved cart weight (kg); null = unresolvable without a
			 * seller-typed override (weightIssue says why). */
			computedWeightKg: number | null;
			weightIssue: "custom_item" | "missing_weights" | null;
			defaultItemType: DelyvaItemType;
			buyerPaidFee: number;
			currency: string;
			note?: string;
			/** The demo-vs-live lookup never ran for this row — prepareBooking
			 * schedules the heal so the badge appears without a reconnect. */
			environmentUnknown: boolean;
	  };

function dispatchBlockReason(args: {
	order: Doc<"orders">;
	retailer: Doc<"retailers">;
	activeJob: Doc<"deliveryJobs"> | undefined;
	credentials: DelyvaCredentials | null;
	planOk: boolean;
}): DelyvaDispatchBlock | null {
	const { order, retailer, activeJob, credentials, planOk } = args;
	const config = retailer.delyva as DelyvaConfig | undefined;
	// Country first — every reason below names a fix; outside Malaysia there
	// is none to name (the Lalamove 86eyqgujv lesson).
	if (!delyvaBookingAllowed(retailer.country ?? DEFAULT_COUNTRY))
		return "country_unsupported";
	if (order.deliveryMethod !== "delivery") return "not_delivery";
	// Same eligible window as Lalamove: a pending order never ships itself,
	// shipped/delivered orders are already on their way.
	if (order.status !== "confirmed" && order.status !== "packed")
		return "bad_status";
	if (activeJob) return "job_active";
	if (!credentials) return "not_connected";
	if (!config?.enabled) return "disabled";
	if (!planOk) return "plan_gated";
	if (!config.pickupAddress) return "no_pickup_address";
	if (!order.deliveryAddress) return "no_address";
	return null;
}

/**
 * Auth + full eligibility + payload assembly for one Delyva booking attempt.
 * INTERNAL — resolved credentials ride back to the calling action and must
 * never reach a client (the public surface is getDispatchState below).
 */
export const getDispatchContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<DelyvaDispatchContext> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return { ok: false, reason: "not_found" };

		const identity = await ctx.auth.getUserIdentity();
		const actingAsAdmin =
			identity !== null && retailer.userId !== identity.subject;
		let planOk = true;
		if (!actingAsAdmin) {
			try {
				await assertPlanFeature(ctx, retailer._id, "delivery");
			} catch {
				planOk = false;
			}
		}

		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));
		const config = retailer.delyva as DelyvaConfig | undefined;
		const credentials = resolveDelyvaCredentials(config);

		const blocked = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			credentials,
			planOk,
		});
		if (blocked) return { ok: false, reason: blocked };
		if (!credentials || !config?.pickupAddress || !order.deliveryAddress)
			return { ok: false, reason: "not_connected" }; // restated for types

		const weight = await resolveOrderWeightKg(ctx, order);
		const storeCountry = retailer.country ?? DEFAULT_COUNTRY;
		const buyerAddress = formatBuyerAddress(order.deliveryAddress, storeCountry);
		const buyerPhone = (order.customer.waPhone ?? "").replace(/\D/g, "");
		const sellerPhone = (retailer.waPhone ?? "").replace(/\D/g, "");
		const inventory: DelyvaInventoryLine[] = await Promise.all(
			order.items.map(async (item): Promise<DelyvaInventoryLine> => {
				const variant = item.variantId
					? await ctx.db.get(item.variantId)
					: null;
				return {
					name: item.variantLabel
						? `${item.name} (${item.variantLabel})`
						: item.name,
					quantity: item.quantity,
					priceSen: item.price,
					weightKg: (variant?.parcelWeightG ?? 0) / 1000,
				};
			}),
		);
		const noteParts = [
			order.deliveryAddress.notes,
			order.customerNote,
		].filter((p): p is string => !!p && p.trim().length > 0);
		return {
			ok: true,
			orderId: order._id,
			retailerId: retailer._id,
			shortId: order.shortId,
			credentials,
			customerId: credentials.customerId,
			origin: {
				...config.pickupAddress,
				country: storeCountry,
				name: retailer.storeName,
				phone: sellerPhone,
				email: retailer.notifyEmail || undefined,
			},
			destination: {
				...buyerAddress,
				name: order.customer.name ?? "Customer",
				phone: buyerPhone || sellerPhone,
			},
			inventory,
			computedWeightKg: weight.kind === "ok" ? weight.kg : null,
			weightIssue: weight.kind === "ok" ? null : weight.kind,
			defaultItemType: config.defaultItemType ?? "PARCEL",
			buyerPaidFee: order.deliveryFee ?? 0,
			currency: order.currency,
			note: noteParts.length ? noteParts.join(" · ") : undefined,
			environmentUnknown: config.isDemo === undefined,
		};
	},
});

/** Validate a seller-typed weight override (kg). */
function resolveWeightKg(
	context: Extract<DelyvaDispatchContext, { ok: true }>,
	override: number | undefined,
):
	| { ok: true; kg: number }
	| { ok: false; message: string } {
	if (override !== undefined) {
		if (
			!Number.isFinite(override) ||
			override <= 0 ||
			override > WEIGHT_OVERRIDE_MAX_KG
		) {
			return {
				ok: false,
				message: "Enter the packed weight in kg (e.g. 2.5).",
			};
		}
		return { ok: true, kg: override };
	}
	if (context.computedWeightKg !== null)
		return { ok: true, kg: context.computedWeightKg };
	return {
		ok: false,
		message:
			context.weightIssue === "custom_item"
				? "This order has a custom line, so its weight isn't known — enter the packed weight to get quotes."
				: "Some items on this order have no parcel weight set — enter the packed weight to get quotes (or add weights in Products).",
	};
}

/** Map a Delyva API failure to seller-facing copy. */
function friendlyBookingError(err: unknown): string {
	if (err instanceof DelyvaApiError) {
		const detail = parseDelyvaErrorMessage(err.body);
		switch (classifyDelyvaFailure(err.body)) {
			case "credit":
				return `Your Delyva account doesn't have enough credit${detail ? ` (Delyva says: “${detail}”)` : ""}. Top up in the Delyva app, then book again — nothing was booked and your buyer wasn't notified.`;
			case "not_activated":
				return "Delyva hasn't activated your pickup address for this parcel type yet (cold chain needs a one-time activation). We can chase it with Delyva — nothing was booked.";
			case "no_service":
				return "That courier can't take this parcel any more — get a fresh quote and pick another courier.";
			default:
				return detail
					? `Delyva couldn't process the booking: ${detail}`
					: "Delyva couldn't process the booking right now. Please try again in a moment.";
		}
	}
	return "Delyva couldn't process the booking right now. Please try again in a moment.";
}

/**
 * Step 1 of the two-tap dispatch: live-quote the parcel and hand back the
 * courier SERVICE LIST (Delyva's quotes are indicative and not id-bound —
 * unlike Lalamove there is no 5-minute quotation to hold; confirm re-prices
 * at create). An EMPTY list is a normal answer the card must render.
 */
export const prepareBooking = action({
	args: {
		shortId: v.string(),
		// Per-order parcel-type override (dialog pills); omitted → the store
		// default from settings.
		itemType: v.optional(itemTypeValidator),
		// Seller-typed packed weight (kg) — required when the cart weight can't
		// be derived (custom line / missing product weights), allowed always
		// (the seller knows the real packed weight best).
		weightKgOverride: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| {
				ok: false;
				reason: DelyvaDispatchBlock | "not_found" | "no_weight" | "quote_failed";
				message?: string;
		  }
		| {
				ok: true;
				services: DelyvaService[];
				weightKg: number;
				itemType: DelyvaItemType;
				buyerPaidFee: number;
				/** Only set when `services` is empty: whether the ACCOUNT has any
				 * courier switched on at all. true = nothing is connected, so no
				 * address would ever quote; false = the account has couriers, none
				 * of which covers this shipment. undefined = the extra lookup
				 * failed, so the card stays with its generic wording. */
				accountHasNoCouriers?: boolean;
				/** Only set when a CHILLED/FROZEN quote came back empty: true means
				 * the identical route quotes fine as an ordinary parcel, so this is
				 * a cold-chain gap on the Delyva account rather than anything about
				 * the address. undefined = we couldn't tell. */
				coldChainUnavailable?: boolean;
		  }
	> => {
		const context = await ctx.runQuery(internal.delyva.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		// Heal an un-stamped demo/live badge in passing (see refreshEnvironment)
		// — scheduled, so a slow company lookup never delays the quote.
		if (context.environmentUnknown) {
			await ctx.scheduler.runAfter(0, internal.delyva.refreshEnvironmentBySystem, {
				retailerId: context.retailerId,
			});
		}
		const weight = resolveWeightKg(context, args.weightKgOverride);
		if (!weight.ok)
			return { ok: false, reason: "no_weight", message: weight.message };
		const itemType = args.itemType ?? context.defaultItemType;
		try {
			const quoteBody = (forItemType: DelyvaItemType) =>
				buildInstantQuoteBody({
					customerId: context.customerId,
					origin: {
						address1: context.origin.address1,
						address2: context.origin.address2,
						city: context.origin.city,
						state: context.origin.state,
						postcode: context.origin.postcode,
						country: context.origin.country,
					},
					destination: {
						address1: context.destination.address1,
						address2: context.destination.address2,
						city: context.destination.city,
						state: context.destination.state,
						postcode: context.destination.postcode,
						country: context.destination.country,
					},
					weightKg: weight.kg,
					itemType: forItemType,
				});
			const response = await callDelyva(
				context.credentials,
				"POST",
				"/service/instantQuote",
				quoteBody(itemType),
			);
			const services = parseInstantQuoteResponse(response).sort(
				(a, b) => a.price - b.price,
			);
			// An empty list is ambiguous — "no courier for THIS parcel" and "this
			// account has no couriers at all" look identical here, and only the
			// second is something the seller can go and fix. One extra GET, on
			// the empty path only, tells them apart. It must never turn a
			// successful quote into a failure, so a throw just leaves the flag
			// unset and the card keeps its generic wording.
			let accountHasNoCouriers: boolean | undefined;
			let coldChainUnavailable: boolean | undefined;
			if (services.length === 0) {
				try {
					const active = countActiveDelyvaServices(
						await callDelyva(context.credentials, "GET", "/service"),
					);
					accountHasNoCouriers = active === null ? undefined : active === 0;
				} catch {
					accountHasNoCouriers = undefined;
				}
				// Cold chain is the ICP's whole reason for being here (frozen and
				// kuih sellers), and it fails in a way that reads as an address
				// problem: Delyva filters by item type SERVER-side, so a chilled
				// quote on an account with no cold-chain service returns exactly
				// what an out-of-range address returns — nothing. Re-quoting the
				// same route as an ordinary parcel separates them: couriers here
				// means the route is fine and the gap is the cold chain, which is
				// a thing Delyva support can switch on. Quotes cost nothing, and
				// this only runs on the already-empty path.
				if (itemType !== "PARCEL" && accountHasNoCouriers !== true) {
					try {
						const asParcel = parseInstantQuoteResponse(
							await callDelyva(
								context.credentials,
								"POST",
								"/service/instantQuote",
								quoteBody("PARCEL"),
							),
						);
						coldChainUnavailable = asParcel.length > 0;
					} catch {
						coldChainUnavailable = undefined;
					}
				}
			}
			return {
				ok: true,
				services,
				weightKg: weight.kg,
				itemType,
				buyerPaidFee: context.buyerPaidFee,
				accountHasNoCouriers,
				coldChainUnavailable,
			};
		} catch (err) {
			console.warn("[delyva] dispatch quote failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: "quote_failed",
				message: friendlyBookingError(err),
			};
		}
	},
});

/** How long an uncommitted reservation may exist before the sweeper flags it. */
const RESERVATION_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Atomically claim the order's one-active-job slot BEFORE the external POST —
 * the same invariant as Lalamove's reserveBooking, and it counts JOBS FROM
 * EITHER PROVIDER: one order never has a rider and a courier racing for it.
 */
export const reserveBooking = internalMutation({
	args: {
		orderId: v.id("orders"),
		retailerId: v.id("retailers"),
		serviceCode: v.string(),
		serviceName: v.string(),
		itemType: itemTypeValidator,
	},
	handler: async (ctx, args): Promise<Id<"deliveryJobs">> => {
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();
		if (jobs.some((j) => isActiveJobStatus(j.status))) {
			throw new ConvexError(
				"A delivery booking is already in progress for this order",
			);
		}
		const now = Date.now();
		const jobId = await ctx.db.insert("deliveryJobs", {
			orderId: args.orderId,
			retailerId: args.retailerId,
			provider: "delyva",
			status: "assigning",
			costActual: 0, // real figure patched at commit (never client-supplied)
			quotationId: args.serviceCode,
			vehicleType: args.serviceCode,
			serviceName: args.serviceName,
			itemType: args.itemType,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			RESERVATION_EXPIRY_MS,
			internal.delyva.expireStaleReservation,
			{ jobId },
		);
		return jobId;
	},
});

export const commitBooking = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		providerOrderId: v.string(),
		costActual: v.number(),
		awb: v.optional(v.string()),
		statusCode: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;
		const now = Date.now();
		await ctx.db.patch(args.jobId, {
			providerOrderId: args.providerOrderId,
			status: normalizeDelyvaStatus(args.statusCode) ?? "assigning",
			costActual: args.costActual,
			awb: args.awb,
			// A commit that lost a race against its own expiry sweep revives the
			// row — the booking DOES exist at Delyva either way.
			failureReason: undefined,
			updatedAt: now,
		});
		if (args.awb) await mirrorAwbOntoOrder(ctx, job, args.awb);
	},
});

/** Write the AWB into the buyer-visible manual-courier fields (86eyehvk4) —
 * fill-if-unset, so a seller's own manual entry is never overwritten. The
 * tracking URL comes from the courier registry when the service name matches
 * a known courier, else Delyva's own public tracking page. */
async function mirrorAwbOntoOrder(
	ctx: MutationCtx,
	job: Doc<"deliveryJobs">,
	awb: string,
): Promise<void> {
	const order = await ctx.db.get(job.orderId);
	if (!order) return;
	if (order.trackingNo) return; // seller already recorded a shipment by hand
	const courierName = job.serviceName ?? "Delyva";
	const registry = findCourier(courierName);
	const trackingUrl = registry?.buildTrackingUrl
		? registry.buildTrackingUrl(awb)
		: `https://my.delyva.app/customer/strack?trackingNo=${encodeURIComponent(awb)}`;
	await ctx.db.patch(order._id, {
		courierName,
		trackingNo: awb,
		...(order.carrierTrackingUrl ? {} : { carrierTrackingUrl: trackingUrl }),
		updatedAt: Date.now(),
	});
}

export const releaseReservation = internalMutation({
	args: { jobId: v.id("deliveryJobs"), reason: v.string() },
	handler: async (ctx, { jobId, reason }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.providerOrderId !== undefined) return;
		await ctx.db.patch(jobId, {
			status: "canceled",
			failureReason: reason,
			updatedAt: Date.now(),
		});
	},
});

export const expireStaleReservation = internalMutation({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.providerOrderId !== undefined) return; // committed
		if (job.status !== "assigning") return; // already released
		await ctx.db.patch(jobId, {
			status: "expired",
			failureReason:
				"Booking never confirmed — check your Delyva app before rebooking",
			updatedAt: Date.now(),
		});
	},
});

/**
 * Step 2: book the picked service. Create a DRAFT order (idempotency-key =
 * the reservation id, so a network retry can never double-create), then
 * process it with the serviceCode — the two-step shape Delyva's own plugin
 * uses. A failed process cancels the draft best-effort so the seller's Delyva
 * dashboard doesn't fill with orphans.
 */
export const confirmBooking = action({
	args: {
		shortId: v.string(),
		serviceCode: v.string(),
		serviceName: v.string(),
		itemType: v.optional(itemTypeValidator),
		weightKgOverride: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| {
				ok: false;
				reason:
					| DelyvaDispatchBlock
					| "not_found"
					| "no_weight"
					| "booking_failed";
				message?: string;
		  }
		| { ok: true; providerOrderId: string; costActual: number; awb?: string }
	> => {
		const context = await ctx.runQuery(internal.delyva.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		const weight = resolveWeightKg(context, args.weightKgOverride);
		if (!weight.ok)
			return { ok: false, reason: "no_weight", message: weight.message };
		const itemType = args.itemType ?? context.defaultItemType;

		let jobId: Id<"deliveryJobs">;
		try {
			jobId = await ctx.runMutation(internal.delyva.reserveBooking, {
				orderId: context.orderId,
				retailerId: context.retailerId,
				serviceCode: args.serviceCode,
				serviceName: args.serviceName,
				itemType,
			});
		} catch {
			return {
				ok: false,
				reason: "job_active",
				message: "A delivery booking is already in progress for this order.",
			};
		}

		let delyvaOrderId: string | undefined;
		try {
			const created = await callDelyva(
				context.credentials,
				"POST",
				"/order",
				buildCreateOrderBody({
					customerId: context.customerId,
					origin: context.origin,
					destination: context.destination,
					inventory: context.inventory,
					weightKg: weight.kg,
					itemType,
					currency: context.currency,
					referenceNo: context.shortId,
					note: context.note,
				}),
				`kp-${jobId}`,
			);
			delyvaOrderId = parseOrderResponse(created).delyvaOrderId;
			const processed = await callDelyva(
				context.credentials,
				"POST",
				"/order/process",
				{ orderId: delyvaOrderId, serviceCode: args.serviceCode, skipQueue: true },
			);
			// Price + consignment number: prefer the process response; fetch the
			// order when it doesn't carry them (their response shapes vary).
			let parsed = parseOrderResponse(processed);
			if (parsed.price === undefined || parsed.consignmentNo === undefined) {
				try {
					const fetched = await callDelyva(
						context.credentials,
						"GET",
						`/order/${encodeURIComponent(delyvaOrderId)}`,
					);
					const full = parseOrderResponse(fetched);
					parsed = {
						...full,
						price: full.price ?? parsed.price,
						consignmentNo: full.consignmentNo ?? parsed.consignmentNo,
					};
				} catch {
					// Non-fatal: the order.created webhook delivers the AWB anyway.
				}
			}
			await ctx.runMutation(internal.delyva.commitBooking, {
				jobId,
				providerOrderId: delyvaOrderId,
				costActual: parsed.price ?? 0,
				awb: parsed.consignmentNo,
				statusCode: parsed.statusCode,
			});
			return {
				ok: true,
				providerOrderId: delyvaOrderId,
				costActual: parsed.price ?? 0,
				awb: parsed.consignmentNo,
			};
		} catch (err) {
			console.warn("[delyva] booking failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			const message = friendlyBookingError(err);
			// A draft that was created but never processed is an orphan in the
			// seller's Delyva dashboard — cancel it best-effort.
			if (delyvaOrderId) {
				try {
					await callDelyva(
						context.credentials,
						"POST",
						`/order/${encodeURIComponent(delyvaOrderId)}/cancel`,
						{},
					);
				} catch {
					// Leaving a draft behind is annoying, not dangerous.
				}
			}
			await ctx.runMutation(internal.delyva.releaseReservation, {
				jobId,
				reason: message,
			});
			return { ok: false, reason: "booking_failed", message };
		}
	},
});

export const cancelBooking = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{ ok: boolean; message?: string }> => {
		const target = await ctx.runQuery(internal.delyva.getCancelContext, {
			shortId,
		});
		if (!target) return { ok: false, message: "No active booking to cancel." };
		try {
			await callDelyva(
				target.credentials,
				"POST",
				`/order/${encodeURIComponent(target.providerOrderId)}/cancel`,
				{},
			);
		} catch (err) {
			console.warn("[delyva] cancel failed", {
				shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				message:
					"Delyva couldn't cancel this booking — the courier may already have it. Check your Delyva app or contact their support.",
			};
		}
		await ctx.runMutation(internal.delyva.markJobCancelled, {
			jobId: target.jobId,
		});
		return { ok: true };
	},
});

export const getCancelContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		jobId: Id<"deliveryJobs">;
		providerOrderId: string;
		credentials: DelyvaCredentials;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const active = jobs.find(
			(j) => j.provider === "delyva" && isActiveJobStatus(j.status),
		);
		if (!active || active.providerOrderId === undefined) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const credentials = resolveDelyvaCredentials(
			retailer?.delyva as DelyvaConfig | undefined,
		);
		if (!credentials) return null;
		return {
			jobId: active._id,
			providerOrderId: active.providerOrderId,
			credentials,
		};
	},
});

export const markJobCancelled = internalMutation({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || !isActiveJobStatus(job.status)) return;
		await ctx.db.patch(jobId, {
			status: "canceled",
			failureReason: "Cancelled by you",
			updatedAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Webhook — context + idempotent event application
// ---------------------------------------------------------------------------

export const getWebhookContext = internalQuery({
	args: { delyvaOrderId: v.string() },
	handler: async (
		ctx,
		{ delyvaOrderId },
	): Promise<{
		jobId: Id<"deliveryJobs">;
		/** Stored (possibly encrypted) webhook secret — decrypt at the route. */
		apiSecret: string | null;
		/** The retailer's Delyva customer id, for the payload cross-check. */
		customerId: number | null;
	} | null> => {
		const job = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_provider_order", (q) =>
				q.eq("provider", "delyva").eq("providerOrderId", delyvaOrderId),
			)
			.unique();
		if (!job) return null;
		const retailer = await ctx.db.get(job.retailerId);
		const config = retailer?.delyva as DelyvaConfig | undefined;
		return {
			jobId: job._id,
			apiSecret: config?.apiSecret?.trim() || null,
			customerId: config?.customerId ?? null,
		};
	},
});

/** Order statuses that may auto-advance from a courier event — identical to
 * the Lalamove rule: a pending order never ships itself. */
const SHIPPABLE_FROM = new Set(["confirmed", "packed"]);
const DELIVERABLE_FROM = new Set(["confirmed", "packed", "shipped"]);

/**
 * Apply one verified webhook event to its job (and possibly its order).
 * Same contract as the Lalamove handler: idempotent, out-of-order safe via
 * `lastEventAt`, job follows provider truth, ORDER never regresses.
 */
export const applyWebhookEvent = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		statusCode: v.optional(v.number()),
		consignmentNo: v.optional(v.string()),
		statusText: v.optional(v.string()),
		eventAt: v.number(),
	},
	handler: async (ctx, { jobId, statusCode, consignmentNo, statusText, eventAt }) => {
		const job = await ctx.db.get(jobId);
		if (!job) return;
		const now = Date.now();
		const stale = job.lastEventAt !== undefined && eventAt < job.lastEventAt;

		// The AWB fills in whenever we first see it — even from a stale event
		// (a gap-filling write, mirroring the Lalamove shareLink posture).
		if (consignmentNo && !job.awb) {
			await ctx.db.patch(jobId, { awb: consignmentNo, updatedAt: now });
			await mirrorAwbOntoOrder(ctx, job, consignmentNo);
		}

		if (statusCode === undefined) return;

		// Failed delivery ATTEMPT (650): the parcel is still with the courier
		// (retry or return follows) — surface it without changing job status,
		// and never twice for the same event time.
		if (isFailedDeliveryAttempt(statusCode)) {
			if (!stale) {
				await ctx.db.patch(jobId, {
					failureReason:
						statusText ?? "Delivery attempt failed — the courier will retry or return the parcel",
					lastEventAt: eventAt,
					updatedAt: now,
				});
				await ctx.scheduler.runAfter(0, internal.email.notifyDeliveryJobFailed, {
					orderId: job.orderId,
					reason: "Delivery attempt failed — the courier will retry or return the parcel. Check the tracking page.",
					provider: "delyva",
				});
			}
			return;
		}

		const status = normalizeDelyvaStatus(statusCode);
		if (!status) {
			console.warn("[delyva] webhook: unknown statusCode", {
				providerOrderId: job.providerOrderId,
				statusCode,
			});
			return;
		}

		if (!stale) {
			const enteringFailure =
				(status === "canceled" || status === "rejected") &&
				isActiveJobStatus(job.status);
			const sellerCancelled =
				job.status === "canceled" && job.failureReason === "Cancelled by you";
			await ctx.db.patch(jobId, {
				status,
				...(isActiveJobStatus(status) ? { failureReason: undefined } : {}),
				lastEventAt: eventAt,
				updatedAt: now,
				...(status === "rejected"
					? {
							failureReason:
								statusText ?? "The courier couldn't collect the parcel",
						}
					: sellerCancelled
						? {} // keep "Cancelled by you"
						: status === "canceled"
							? { failureReason: statusText ?? "Cancelled by Delyva" }
							: {}),
			});
			if (enteringFailure) {
				await ctx.scheduler.runAfter(0, internal.email.notifyDeliveryJobFailed, {
					orderId: job.orderId,
					reason:
						status === "rejected"
							? (statusText ?? "The courier couldn't collect the parcel")
							: (statusText ?? "Cancelled by Delyva"),
					provider: "delyva",
				});
			}
		}

		// Order auto-transitions ride order-status guards, so replayed / stale
		// events are naturally idempotent here too. Delyva has no collection
		// direction (v1) — every job is a standard delivery to the buyer.
		const order = await ctx.db.get(job.orderId);
		if (!order || order.status === "cancelled") return;
		const awb = job.awb ?? consignmentNo;
		if (status === "picked_up" && SHIPPABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "shipped", {
				courierName: order.courierName ?? job.serviceName ?? "Delyva",
				trackingNo: order.trackingNo ?? awb,
				carrierTrackingUrl: order.carrierTrackingUrl,
			});
		} else if (status === "completed" && DELIVERABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "delivered");
		}
	},
});

// ---------------------------------------------------------------------------
// Order-detail card read
// ---------------------------------------------------------------------------

/** Public job shape for the order-detail card — no credentials, no secrets. */
export type DelyvaJobView = {
	status: Doc<"deliveryJobs">["status"];
	providerOrderId?: string;
	costActual: number;
	serviceCode: string;
	serviceName?: string;
	itemType?: string;
	awb?: string;
	failureReason?: string;
	createdAt: number;
	lastEventAt?: number;
};

/**
 * Order-detail read: the latest Delyva booking (active or most recent
 * attempt) plus WHY booking is currently unavailable (null = button live),
 * plus what the quote dialog needs to open (weight + parcel-type default).
 */
export const getDispatchState = query({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		job: DelyvaJobView | null;
		blockReason: DelyvaDispatchBlock | null;
		/** The store has a working, enabled Delyva connection. */
		bookingEnabled: boolean;
		defaultItemType: DelyvaItemType;
		/** One-line render of the stored pickup address ("55 Jln Eco Majestic,
		 * 43700 Beranang") — the dispatch card shows it before the first quote
		 * so a stale imported address is caught at the moment it matters. */
		pickupSummary?: string;
		/** Demo account (86eyjpv6z): a booking from this card dispatches no
		 * courier and spends no real credit. Said out loud at the point of
		 * spend, the Lalamove sandbox-banner posture (86eypncfy). Undefined =
		 * un-stamped row — rendered as nothing, never as a false all-clear. */
		isDemo?: boolean;
		/** Auto-resolved cart weight (kg); null = the dialog must ask. */
		computedWeightKg: number | null;
		weightIssue: "custom_item" | "missing_weights" | null;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const config = retailer.delyva as DelyvaConfig | undefined;
		const credentials = resolveDelyvaCredentials(config);

		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));
		const delyvaJobs = jobs.filter((j) => j.provider === "delyva");
		const latest =
			(activeJob?.provider === "delyva" ? activeJob : undefined) ??
			[...delyvaJobs].sort((a, b) => b.createdAt - a.createdAt)[0] ??
			null;

		const identity = await ctx.auth.getUserIdentity();
		const actingAsAdmin =
			identity !== null && retailer.userId !== identity.subject;
		let planOk = true;
		if (!actingAsAdmin) {
			try {
				await assertPlanFeature(ctx, retailer._id, "delivery");
			} catch {
				planOk = false;
			}
		}
		const blockReason = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			credentials,
			planOk,
		});
		const weight = await resolveOrderWeightKg(ctx, order);
		return {
			job: latest
				? {
						status: latest.status,
						providerOrderId: latest.providerOrderId,
						costActual: latest.costActual,
						serviceCode: latest.quotationId,
						serviceName: latest.serviceName,
						itemType: latest.itemType,
						awb: latest.awb,
						failureReason: latest.failureReason,
						createdAt: latest.createdAt,
						lastEventAt: latest.lastEventAt,
					}
				: null,
			blockReason,
			bookingEnabled:
				credentials !== null &&
				config?.enabled === true &&
				delyvaBookingAllowed(retailer.country ?? DEFAULT_COUNTRY),
			defaultItemType: config?.defaultItemType ?? "PARCEL",
			pickupSummary: config?.pickupAddress
				? [
						config.pickupAddress.address1,
						`${config.pickupAddress.postcode} ${config.pickupAddress.city}`,
					].join(", ")
				: undefined,
			isDemo: config?.isDemo,
			computedWeightKg: weight.kind === "ok" ? weight.kg : null,
			weightIssue: weight.kind === "ok" ? null : weight.kind,
		};
	},
});

// ---------------------------------------------------------------------------
// Checkout pricing (z8r3fdbvdy) — a live Delyva price for the buyer's address
// ---------------------------------------------------------------------------

/** What a live Delyva checkout quote needs from the store. */
export type DelyvaCheckoutContext = {
	credentials: DelyvaCredentials;
	customerId: number;
	origin: DelyvaAddress;
	/** Store default parcel type — the cart's type until per-item temperature
	 * flags land (86eyrmv1j). See cartItemType in lib/liveQuote. */
	itemType: DelyvaItemType;
};

/** One provider's answer, shaped for the cross-provider rule. */
export type DelyvaCheckoutQuote =
	| {
			status: "quoted";
			fee: number;
			currency: string;
			serviceCode: string;
			serviceName: string;
	  }
	| {
			status:
				| "out_of_range"
				| "no_cold_service"
				| "store_unavailable"
				| "unavailable";
	  };

/**
 * Fetch Delyva's cheapest service for this address WITHOUT recording it.
 *
 * Cheapest, because that is the price the seller will actually pay: the
 * dispatch card pre-selects the cheapest service too, so the fee collected
 * at checkout and the one offered at dispatch describe the same choice. (If
 * a seller habitually books a dearer courier they under-collect by the
 * difference — the argument for a per-store "preferred courier" setting
 * later, deliberately not v1.)
 *
 * An EMPTY service list is ambiguous in exactly the way it is at dispatch,
 * so it is disambiguated the same way — by asking what the account holds.
 * Nothing connected is the seller's problem, not the buyer's address, and
 * saying "no courier serves your address" to someone whose address is fine
 * sends them editing it forever.
 */
export async function fetchDelyvaCheckoutQuote(args: {
	context: DelyvaCheckoutContext;
	destination: DelyvaAddress;
	weightKg: number;
}): Promise<DelyvaCheckoutQuote> {
	const { context, destination, weightKg } = args;
	if (!Number.isFinite(weightKg) || weightKg <= 0) {
		// No usable cart weight (a product with no parcel weight, or a custom
		// line). Delyva prices by weight, so it can't bid — and that is the
		// STORE's gap to close, never something the buyer can act on.
		return { status: "store_unavailable" };
	}
	try {
		const services = parseInstantQuoteResponse(
			await callDelyva(
				context.credentials,
				"POST",
				"/service/instantQuote",
				buildInstantQuoteBody({
					customerId: context.customerId,
					origin: context.origin,
					destination,
					weightKg,
					itemType: context.itemType,
				}),
			),
		).sort((a, b) => a.price - b.price);

		const cheapest = services[0];
		if (cheapest) {
			return {
				status: "quoted",
				fee: cheapest.price,
				currency: cheapest.currency,
				serviceCode: cheapest.code,
				serviceName: cheapest.name,
			};
		}

		// Empty. Which kind of empty decides what the buyer is told.
		try {
			const active = countActiveDelyvaServices(
				await callDelyva(context.credentials, "GET", "/service"),
			);
			if (active === 0) return { status: "store_unavailable" };
			if (active !== null && isColdItemType(context.itemType))
				return { status: "no_cold_service" };
			if (active !== null) return { status: "out_of_range" };
		} catch {
			// Fall through — we couldn't tell, so we don't guess.
		}
		return { status: "unavailable" };
	} catch (err) {
		console.warn("[delyva] checkout quote failed", {
			message: err instanceof Error ? err.message : String(err),
		});
		return { status: "unavailable" };
	}
}
