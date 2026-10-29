// EasyParcel parcel booking (z8r3fdcje2) on the Open API (2026-09) — the SG
// parcel lane, structured as convex/delyva.ts's sibling: pure wire logic in
// lib/easyparcel.ts, and this module owns OAuth, tokens, eligibility, the
// network calls and the deliveryJobs ledger.
//
// What the Open API changes against the other providers:
//  - The seller CONNECTS by signing in at EasyParcel (OAuth authorization
//    code). Kedaipal's app credentials live in Convex env; the seller's
//    tokens live, encrypted, in `easyparcelConnections` — their own table, so
//    a token refresh never patches `retailers` (which re-runs every open
//    storefront tab).
//  - Submit books AND charges the prepaid wallet in one call.
//  - Webhooks are UNSIGNED, so they are nudges: the route takes only the
//    shipment number and this module re-reads the shipment with the seller's
//    own token before anything moves.
// See docs/delivery-easyparcel.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type ActionCtx,
	action,
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { postcodeRule, SG_STATE_LABEL } from "./lib/address";
import { requireRetailerAccess, resolveMyRetailer } from "./lib/auth";
import { COUNTRY_LABELS, DEFAULT_COUNTRY, type Country } from "./lib/country";
import { toDomesticContactPhone } from "./lib/courierContact";
import { servesOrderDestination } from "./lib/courierBooking";
import {
	COURIER_DESTINATIONS,
	courierBookingAllowed,
} from "./lib/courierProviders";
import { findCourier } from "./lib/couriers";
import { decryptSecret, encryptSecret } from "./lib/credentialCrypto";
import { type CartWeightItem, summarizeCartWeight } from "./lib/delivery";
import { easyparcelConfigured } from "./lib/easyparcelArming";
import { isActiveJobStatus } from "./lib/deliveryJobs";
import {
	accessTokenNeedsRefresh,
	basicAuthHeader,
	buildAuthorizeUrl,
	buildCancelBody,
	buildQuotationBody,
	buildSubmitBody,
	buildTokenRequestBody,
	classifyEasyparcelFailure,
	EASYPARCEL_API_BASE,
	EASYPARCEL_ON_HOLD,
	EASYPARCEL_TOKEN_URL,
	EasyparcelApiError,
	type EasyparcelItem,
	type EasyparcelRate,
	type EasyparcelTokens,
	normalizeEasyparcelStatus,
	PARCEL_BOXES,
	type ParcelBox,
	parseAccountResponse,
	parseCancelResponse,
	parseDetailsResponse,
	parseQuotationResponse,
	parseSubmitResponse,
	parseTokenResponse,
	parseWalletResponse,
	accountCountryMismatch,
	connectionEnvironment,
} from "./lib/easyparcel";
import { generateTrackingToken } from "./lib/order";
import type { PermissionLevel } from "./lib/permissions";
import { rateLimiter } from "./lib/rateLimiter";
import { applyStatusTransition, resolveSharedOrder } from "./orders";
import { storeLanes } from "./crossBorder";
import { laneCountriesFor } from "./lib/crossBorder";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";

type Connection = Doc<"easyparcelConnections">;

/** How long a connect attempt may sit at EasyParcel's sign-in before its
 * state stops being redeemable. */
// EasyParcel's own sign-in state lives 30 minutes, and the card sends a new
// seller to SIGN UP mid-flow — 10 minutes expired a real sign-in during the
// z8r3fdcje2 /test-code run (F5). Single-use + crypto nonce either way.
const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Configuration (Kedaipal's OAuth app — Convex env, never a table)
// ---------------------------------------------------------------------------

type OAuthConfig = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
};

/** The app registration this deployment talks to EasyParcel as. Absent ⇒
 * the integration is switched off here: every EasyParcel surface hides
 * (HitPay billing's posture), so an unconfigured deployment can't half-work. */
function oauthConfig(): OAuthConfig | null {
	const clientId = process.env.EASYPARCEL_CLIENT_ID?.trim();
	const clientSecret = process.env.EASYPARCEL_CLIENT_SECRET?.trim();
	const siteUrl = process.env.CONVEX_SITE_URL?.trim();
	if (!clientId || !clientSecret || !siteUrl) return null;
	return {
		clientId,
		clientSecret,
		redirectUri: `${siteUrl.replace(/\/$/, "")}/oauth/easyparcel/callback`,
	};
}

const isConfigured = easyparcelConfigured;

/**
 * Where the browser may be sent back to after EasyParcel. The return URL is
 * chosen by the CLIENT, so it is an open-redirect vector unless pinned: the
 * app's own origin (SITE_URL) always; any localhost origin ONLY when SITE_URL
 * is itself localhost — a dev deployment, where each worktree serves on its
 * own port. Production (an https SITE_URL) accepts its own origin alone.
 */
export function allowedReturnTo(
	returnTo: string,
	siteUrl: string | undefined,
): boolean {
	let url: URL;
	let site: URL | null = null;
	try {
		url = new URL(returnTo);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return false;
	try {
		site = siteUrl ? new URL(siteUrl) : null;
	} catch {
		site = null;
	}
	if (!site) return false;
	if (url.origin === site.origin) return true;
	const isLocal = (host: string) => host === "localhost" || host === "127.0.0.1";
	return isLocal(site.hostname) && isLocal(url.hostname);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

async function resolveStoreAccess(
	ctx: QueryCtx,
	retailerId: Id<"retailers"> | undefined,
	level: PermissionLevel,
) {
	if (retailerId)
		return requireRetailerAccess(ctx, retailerId, {
			area: "integrations",
			level,
		});
	const my = await resolveMyRetailer(ctx);
	if (!my) {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		throw new ConvexError("No store found");
	}
	return requireRetailerAccess(ctx, my.retailer._id, {
		area: "integrations",
		level,
	});
}

async function connectionFor(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Connection | null> {
	return ctx.db
		.query("easyparcelConnections")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.unique();
}

// ---------------------------------------------------------------------------
// Connect (OAuth authorization code)
// ---------------------------------------------------------------------------

/**
 * Step 1: mint a single-use state and hand back EasyParcel's sign-in URL. The
 * seller's browser goes there, signs in, picks which EasyParcel account
 * (Live or Demo) Kedaipal may book with, and EasyParcel sends them to our
 * callback route. Connecting is the enable moment, so it carries the Pro
 * gate; disconnecting never does.
 */
export const startConnect = mutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		returnTo: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ ok: true; url: string } | { ok: false; message: string }> => {
		const access = await resolveStoreAccess(ctx, args.retailerId, "write");
		const retailerId = access.retailer._id;
		const config = oauthConfig();
		if (!config) {
			return {
				ok: false,
				message: "EasyParcel isn't set up on this server yet.",
			};
		}
		// Connectable before the overseas lane exists (Zaki, 30 Oct): the card
		// says what's still missing as a setup step, not a refusal here.
		if (
			!courierBookingAllowed(
				"easyparcel",
				access.retailer.country ?? DEFAULT_COUNTRY,
			)
		) {
			return {
				ok: false,
				message: "EasyParcel isn't available for your store's country.",
			};
		}
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, retailerId);
			await assertPlanFeature(ctx, retailerId, "delivery");
		}
		if (!allowedReturnTo(args.returnTo, process.env.SITE_URL)) {
			return { ok: false, message: "That return address isn't allowed." };
		}
		const now = Date.now();
		const nonce = generateTrackingToken();
		await ctx.db.insert("courierOAuthStates", {
			provider: "easyparcel",
			retailerId,
			nonce,
			returnTo: args.returnTo,
			createdAt: now,
			expiresAt: now + OAUTH_STATE_TTL_MS,
		});
		return {
			ok: true,
			url: buildAuthorizeUrl({
				clientId: config.clientId,
				redirectUri: config.redirectUri,
				state: nonce,
			}),
		};
	},
});

type ConsumedState =
	| { kind: "unknown" }
	| { kind: "expired"; returnTo: string; stateId: Id<"courierOAuthStates"> }
	| {
			kind: "ok";
			returnTo: string;
			retailerId: Id<"retailers">;
			stateId: Id<"courierOAuthStates">;
	  };

/** Redeem a state exactly once. A replayed or stale `state` never reaches the
 * token exchange — that is the CSRF guard the parameter exists for. */
export const consumeOAuthState = internalMutation({
	args: { nonce: v.string() },
	handler: async (ctx, { nonce }): Promise<ConsumedState> => {
		const row = await ctx.db
			.query("courierOAuthStates")
			.withIndex("by_nonce", (q) => q.eq("nonce", nonce))
			.unique();
		if (!row || row.provider !== "easyparcel" || row.consumedAt !== undefined)
			return { kind: "unknown" };
		const now = Date.now();
		await ctx.db.patch(row._id, { consumedAt: now });
		if (row.expiresAt < now) {
			await ctx.db.patch(row._id, {
				outcome: "expired",
				message:
					"That sign-in took longer than 30 minutes, so we didn't use it. Tap Connect EasyParcel to try again.",
			});
			return { kind: "expired", returnTo: row.returnTo, stateId: row._id };
		}
		return {
			kind: "ok",
			returnTo: row.returnTo,
			retailerId: row.retailerId,
			stateId: row._id,
		};
	},
});

export const recordOAuthOutcome = internalMutation({
	args: {
		stateId: v.id("courierOAuthStates"),
		outcome: v.union(
			v.literal("connected"),
			v.literal("denied"),
			v.literal("failed"),
		),
		message: v.optional(v.string()),
	},
	handler: async (ctx, { stateId, outcome, message }) => {
		await ctx.db.patch(stateId, { outcome, message });
	},
});

export const storeConnection = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		// Already `enc.v1.`-encrypted by the callback action — no plaintext
		// token ever passes through the mutation log.
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		accessExpiresAt: v.number(),
		refreshExpiresAt: v.optional(v.number()),
		accountName: v.optional(v.string()),
		accountType: v.optional(v.string()),
		environment: v.optional(
			v.union(v.literal("sandbox"), v.literal("live")),
		),
		balanceMinor: v.optional(v.number()),
		balanceCurrency: v.optional(v.string()),
		importedPickupAddress: v.optional(
			v.object({
				address1: v.string(),
				address2: v.optional(v.string()),
				city: v.string(),
				state: v.optional(v.string()),
				postcode: v.string(),
			}),
		),
	},
	handler: async (ctx, args) => {
		const prev = await connectionFor(ctx, args.retailerId);
		const now = Date.now();
		const fields = {
			accessToken: args.accessToken,
			refreshToken: args.refreshToken,
			accessExpiresAt: args.accessExpiresAt,
			refreshExpiresAt: args.refreshExpiresAt,
			revokedAt: undefined,
			accountName: args.accountName,
			accountType: args.accountType,
			environment: args.environment,
			balanceMinor: args.balanceMinor,
			balanceCurrency: args.balanceCurrency,
			balanceCheckedAt: args.balanceMinor !== undefined ? now : undefined,
			updatedAt: now,
		};
		if (prev) {
			// A reconnect keeps the seller's own pickup address and switch.
			await ctx.db.patch(prev._id, fields);
			return;
		}
		await ctx.db.insert("easyparcelConnections", {
			retailerId: args.retailerId,
			// Connecting is the enable gesture (the Delyva posture); Fulfilment's
			// switch can pause it later.
			enabled: true,
			// PREFILL, never truth: the address EasyParcel holds is imported only
			// when we have none, and stays editable.
			pickupAddress: args.importedPickupAddress,
			connectedAt: now,
			...fields,
		});
	},
});

/**
 * Step 2, run by the `GET /oauth/easyparcel/callback` route: redeem the state,
 * exchange the code, read who the token belongs to, store everything, and
 * return the URL to send the browser back to. Never throws — every failure
 * becomes a recorded outcome the settings card reads.
 */
export async function completeConnect(
	ctx: ActionCtx,
	args: { state: string | null; code: string | null; error: string | null },
): Promise<string> {
	const fallback = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/settings?tab=integrations`;
	if (!args.state) return fallback;
	const state = await ctx.runMutation(internal.easyparcel.consumeOAuthState, {
		nonce: args.state,
	});
	if (state.kind === "unknown") return fallback;
	if (state.kind === "expired") return state.returnTo;

	const record = (
		outcome: "connected" | "denied" | "failed",
		message?: string,
	) =>
		ctx.runMutation(internal.easyparcel.recordOAuthOutcome, {
			stateId: state.stateId,
			outcome,
			message,
		});

	if (args.error || !args.code) {
		await record(
			"denied",
			"EasyParcel didn't share access — nothing was connected. Tap Connect EasyParcel and choose Allow to finish.",
		);
		return state.returnTo;
	}
	const config = oauthConfig();
	if (!config) {
		await record("failed", "EasyParcel isn't set up on this server yet.");
		return state.returnTo;
	}
	try {
		const tokens = await requestTokens(config, {
			kind: "authorization_code",
			code: args.code,
			redirectUri: config.redirectUri,
		});
		const [account, wallet] = await Promise.all([
			callApi(tokens.accessToken, "GET", "/account/get_account_information")
				.then((r) => parseAccountResponse(r.text, r.status))
				.catch(() => undefined),
			callApi(tokens.accessToken, "GET", "/wallet")
				.then((r) => parseWalletResponse(r.text, r.status))
				.catch(() => undefined),
		]);
		const retailer = await ctx.runQuery(
			internal.easyparcel.getRetailerCountry,
			{ retailerId: state.retailerId },
		);
		const imported = account?.pickupAddress;
		const environment = connectionEnvironment(tokens.accessToken, account?.name);
		const storeCountry = retailer?.country ?? DEFAULT_COUNTRY;
		const otherCountry =
			environment === "sandbox"
				? undefined
				: accountCountryMismatch({
						balanceCurrency: wallet?.currency,
						storeCountry,
					});
		if (otherCountry) {
			// Refused before anything is stored: a live account from the other
			// country quotes in the wrong currency and books from the wrong
			// wallet. EasyParcel's sign-in lists both under one login, so the
			// seller only picked the wrong row (test-code, 28 Oct).
			await record(
				"failed",
				`That's your ${COUNTRY_LABELS[otherCountry]} EasyParcel account, and this store ships in ${COUNTRY_LABELS[storeCountry]}. Tap Connect EasyParcel again and pick your ${COUNTRY_LABELS[storeCountry]} account when EasyParcel asks.`,
			);
			return state.returnTo;
		}
		await ctx.runMutation(internal.easyparcel.storeConnection, {
			retailerId: state.retailerId,
			accessToken: await encryptSecret(tokens.accessToken),
			refreshToken: tokens.refreshToken
				? await encryptSecret(tokens.refreshToken)
				: undefined,
			accessExpiresAt: tokens.accessExpiresAt,
			refreshExpiresAt: tokens.refreshExpiresAt,
			accountName: account?.name,
			accountType: account?.accountType,
			environment,
			balanceMinor: wallet?.balanceMinor,
			balanceCurrency: wallet?.currency,
			// Imported only when it is in the store's own country — an MY
			// profile address on an SG store would quote nothing.
			importedPickupAddress:
				imported && imported.country === retailer?.country
					? {
							address1: imported.address1,
							address2: imported.address2,
							city:
								retailer?.country === "SG" ? SG_STATE_LABEL : imported.city,
							state:
								retailer?.country === "SG" ? SG_STATE_LABEL : imported.state,
							postcode: imported.postcode,
						}
					: undefined,
		});
		await record("connected");
		return state.returnTo;
	} catch (err) {
		console.warn("[easyparcel] connect failed", {
			message: err instanceof Error ? err.message : String(err),
		});
		await record(
			"failed",
			"EasyParcel signed you in, but we couldn't finish connecting. Please try again in a moment.",
		);
		return state.returnTo;
	}
}

export const getRetailerCountry = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ country: Country } | null> => {
		const retailer = await ctx.db.get(retailerId);
		return retailer ? { country: retailer.country ?? DEFAULT_COUNTRY } : null;
	},
});

/** Disconnect deletes the tokens outright — nothing credential-shaped is
 * kept. Booked parcels keep moving at EasyParcel; only their status here
 * stops updating (the dialog says so). Never plan-gated. */
export const disconnect = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }) => {
		const access = await resolveStoreAccess(ctx, retailerId, "write");
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, access.retailer._id);
		const conn = await connectionFor(ctx, access.retailer._id);
		if (conn) await ctx.db.delete(conn._id);
	},
});

export const updateSettings = mutation({
	args: {
		retailerId: v.optional(v.id("retailers")),
		enabled: v.optional(v.boolean()),
		pickupAddress: v.optional(
			v.object({
				unit: v.optional(v.string()),
				address1: v.string(),
				address2: v.optional(v.string()),
				city: v.optional(v.string()),
				state: v.optional(v.string()),
				postcode: v.string(),
			}),
		),
	},
	handler: async (ctx, args): Promise<{ ok: boolean; message?: string }> => {
		const access = await resolveStoreAccess(ctx, args.retailerId, "write");
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, access.retailer._id);
		const conn = await connectionFor(ctx, access.retailer._id);
		if (!conn) return { ok: false, message: "Connect EasyParcel first." };
		if (!access.actingAsAdmin && args.enabled === true && !conn.enabled) {
			// The PLAN gate covers the enable direction only — pausing stays
			// free, so a downgrade never traps.
			await assertPlanFeature(ctx, access.retailer._id, "delivery");
		}
		let pickupAddress = conn.pickupAddress;
		if (args.pickupAddress) {
			const country = access.retailer.country ?? DEFAULT_COUNTRY;
			const rule = postcodeRule(country);
			const postcode = args.pickupAddress.postcode.trim();
			if (!rule.pattern.test(postcode)) return { ok: false, message: rule.error };
			if (!args.pickupAddress.address1.trim())
				return { ok: false, message: "Enter the pickup street address." };
			const city =
				country === "SG" ? SG_STATE_LABEL : args.pickupAddress.city?.trim();
			if (!city) return { ok: false, message: "Enter the pickup city." };
			pickupAddress = {
				unit: args.pickupAddress.unit?.trim() || undefined,
				address1: args.pickupAddress.address1.trim(),
				address2: args.pickupAddress.address2?.trim() || undefined,
				city,
				state:
					country === "SG"
						? SG_STATE_LABEL
						: args.pickupAddress.state?.trim() || undefined,
				postcode,
			};
		}
		await ctx.db.patch(conn._id, {
			enabled: args.enabled ?? conn.enabled,
			pickupAddress,
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/** The store's overseas lane as the EasyParcel card speaks of it: "on"
 * (taking orders), "paused" (saved, but a plan/delivery/pricing pause holds)
 * or "off" (none saved). On a MY store EasyParcel books nothing until it's
 * on, so the card makes it a setup step — the card is never hidden for it
 * (Zaki, 30 Oct: a seller must be able to FIND EasyParcel). */
export type EasyparcelLaneState = {
	destination: Country;
	state: "on" | "paused" | "off";
};

/** Settings-card read — no tokens, ever. */
export const getSettings = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }) => {
		const access = await resolveStoreAccess(ctx, retailerId, "read");
		const country = access.retailer.country ?? DEFAULT_COUNTRY;
		const conn = await connectionFor(ctx, access.retailer._id);
		const lanes = await storeLanes(ctx, access.retailer);
		const overseasLane: EasyparcelLaneState = {
			destination: laneCountriesFor(country)[0],
			state:
				lanes.effective.length > 0
					? "on"
					: lanes.stored.length > 0
						? "paused"
						: "off",
		};
		const lastAttempt = await ctx.db
			.query("courierOAuthStates")
			.withIndex("by_retailer_provider", (q) =>
				q.eq("retailerId", access.retailer._id).eq("provider", "easyparcel"),
			)
			.order("desc")
			.first();
		return {
			/** The integration exists on this deployment AND serves this
			 * country — false hides the card unless something is connected. */
			available:
				isConfigured() && courierBookingAllowed("easyparcel", country),
			/** Which orders it books from this store (z8r3fdr5yy): "abroad" on
			 * a MY store (overseas orders only — Delyva stays domestic), "both"
			 * on an SG store. The card says so. */
			destinations: COURIER_DESTINATIONS.easyparcel[country],
			/** The overseas lane — a setup step on a MY store, a line on an SG
			 * one (it carries those orders too). */
			overseasLane,
			/** EasyParcel hands the courier the store's WhatsApp number as the
			 * sender's contact; without one every booking is refused. */
			hasSenderPhone: phoneDigits(access.retailer.waPhone) !== "",
			connected: conn !== null,
			needsReconnect: conn?.revokedAt !== undefined,
			enabled: conn?.enabled === true,
			accountName: conn?.accountName,
			accountType: conn?.accountType,
			environment: conn?.environment,
			balanceMinor: conn?.balanceMinor,
			balanceCurrency: conn?.balanceCurrency,
			balanceCheckedAt: conn?.balanceCheckedAt,
			pickupAddress: conn?.pickupAddress,
			connectedAt: conn?.connectedAt,
			country,
			lastAttempt:
				lastAttempt?.outcome !== undefined
					? {
							outcome: lastAttempt.outcome,
							message: lastAttempt.message,
							at: lastAttempt.consumedAt ?? lastAttempt.createdAt,
						}
					: undefined,
		};
	},
});

// ---------------------------------------------------------------------------
// Tokens + network
// ---------------------------------------------------------------------------

async function requestTokens(
	config: OAuthConfig,
	grant: Parameters<typeof buildTokenRequestBody>[0],
): Promise<EasyparcelTokens> {
	const res = await fetch(EASYPARCEL_TOKEN_URL, {
		method: "POST",
		headers: {
			Authorization: basicAuthHeader(config.clientId, config.clientSecret),
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: buildTokenRequestBody(grant),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new EasyparcelApiError(
			res.status === 400 || res.status === 401 ? "auth" : "token",
			res.status,
			text.slice(0, 200),
		);
	}
	return parseTokenResponse(text, Date.now());
}

async function callApi(
	accessToken: string,
	method: "GET" | "POST",
	path: string,
	body?: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
	const res = await fetch(`${EASYPARCEL_API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const text = await res.text();
	if (res.status === 401)
		throw new EasyparcelApiError("auth", 401, text.slice(0, 200));
	if (res.status === 429)
		throw new EasyparcelApiError("rate_limited", 429, text.slice(0, 200));
	if (res.status >= 500)
		throw new EasyparcelApiError("server", res.status, text.slice(0, 200));
	return { status: res.status, text };
}

/** The seller's grant is dead (refresh refused): book nothing until they
 * reconnect. Distinct from a transient failure, which retries. */
class ReconnectNeeded extends Error {}

export const getConnectionTokens = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const conn = await connectionFor(ctx, retailerId);
		if (!conn) return null;
		return {
			connectionId: conn._id,
			accessToken: conn.accessToken,
			refreshToken: conn.refreshToken,
			accessExpiresAt: conn.accessExpiresAt,
			revoked: conn.revokedAt !== undefined,
		};
	},
});

export const storeRefreshedTokens = internalMutation({
	args: {
		connectionId: v.id("easyparcelConnections"),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		accessExpiresAt: v.number(),
		refreshExpiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const conn = await ctx.db.get(args.connectionId);
		if (!conn) return;
		await ctx.db.patch(args.connectionId, {
			accessToken: args.accessToken,
			// A refresh that doesn't rotate the refresh token keeps the old one.
			refreshToken: args.refreshToken ?? conn.refreshToken,
			accessExpiresAt: args.accessExpiresAt,
			refreshExpiresAt: args.refreshExpiresAt ?? conn.refreshExpiresAt,
			updatedAt: Date.now(),
		});
	},
});

export const markRevoked = internalMutation({
	args: { connectionId: v.id("easyparcelConnections") },
	handler: async (ctx, { connectionId }) => {
		const conn = await ctx.db.get(connectionId);
		if (!conn || conn.revokedAt !== undefined) return;
		await ctx.db.patch(connectionId, {
			revokedAt: Date.now(),
			updatedAt: Date.now(),
		});
	},
});

/**
 * Run `fn` with a live access token for this store: refresh ahead of expiry,
 * refresh once more on a 401, and declare the grant dead only when EasyParcel
 * refuses the refresh — after re-reading, because a concurrent action may
 * already have rotated the token we were holding.
 */
async function withToken<T>(
	ctx: ActionCtx,
	retailerId: Id<"retailers">,
	fn: (accessToken: string) => Promise<T>,
): Promise<T> {
	const config = oauthConfig();
	if (!config) throw new ReconnectNeeded("not configured");
	const load = () =>
		ctx.runQuery(internal.easyparcel.getConnectionTokens, { retailerId });
	let conn = await load();
	if (!conn || conn.revoked) throw new ReconnectNeeded("no live grant");

	const refresh = async (): Promise<string> => {
		const current = conn;
		if (!current?.refreshToken) {
			if (current)
				await ctx.runMutation(internal.easyparcel.markRevoked, {
					connectionId: current.connectionId,
				});
			throw new ReconnectNeeded("no refresh token");
		}
		try {
			const tokens = await requestTokens(config, {
				kind: "refresh_token",
				refreshToken: await decryptSecret(current.refreshToken),
				redirectUri: config.redirectUri,
			});
			await ctx.runMutation(internal.easyparcel.storeRefreshedTokens, {
				connectionId: current.connectionId,
				accessToken: await encryptSecret(tokens.accessToken),
				refreshToken: tokens.refreshToken
					? await encryptSecret(tokens.refreshToken)
					: undefined,
				accessExpiresAt: tokens.accessExpiresAt,
				refreshExpiresAt: tokens.refreshExpiresAt,
			});
			return tokens.accessToken;
		} catch (err) {
			const reread = await load();
			if (
				reread &&
				!reread.revoked &&
				reread.accessToken !== current.accessToken &&
				!accessTokenNeedsRefresh(reread.accessExpiresAt, Date.now())
			) {
				conn = reread;
				return decryptSecret(reread.accessToken);
			}
			if (
				err instanceof EasyparcelApiError &&
				classifyEasyparcelFailure(err) === "auth"
			) {
				await ctx.runMutation(internal.easyparcel.markRevoked, {
					connectionId: current.connectionId,
				});
				throw new ReconnectNeeded("refresh refused");
			}
			throw err;
		}
	};

	let token = accessTokenNeedsRefresh(conn.accessExpiresAt, Date.now())
		? await refresh()
		: await decryptSecret(conn.accessToken);
	try {
		return await fn(token);
	} catch (err) {
		if (err instanceof EasyparcelApiError && err.httpStatus === 401) {
			token = await refresh();
			return fn(token);
		}
		throw err;
	}
}

/** Map a failure to seller-facing copy that names the fix. */
function friendlyError(err: unknown): string {
	if (err instanceof ReconnectNeeded) {
		return "Kedaipal's access to your EasyParcel account has ended — reconnect it in Settings → Integrations → EasyParcel. Nothing was booked.";
	}
	if (err instanceof EasyparcelApiError) {
		switch (classifyEasyparcelFailure(err)) {
			case "credit":
				return "Your EasyParcel wallet doesn't have enough credit for this shipment. Top up in EasyParcel, then book again — nothing was booked and your buyer wasn't notified.";
			case "invalid_address":
				return `EasyParcel rejected an address on this shipment: ${err.detail}. Check the buyer's postcode and your pickup address, then try again.`;
			case "rate_limited":
				return "EasyParcel is busy right now — please try again in a minute.";
			case "auth":
				return "Kedaipal's access to your EasyParcel account has ended — reconnect it in Settings → Integrations → EasyParcel.";
			default:
				return err.detail && err.code === "item"
					? `EasyParcel couldn't do this: ${err.detail}`
					: "EasyParcel couldn't process this right now. Please try again in a moment.";
		}
	}
	return "Couldn't reach EasyParcel right now. Please try again in a moment.";
}

/** Re-read the prepaid wallet (settings card + dispatch). */
export const refreshBalance = action({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		| { ok: false; message: string }
		| { ok: true; balanceMinor: number; currency: string }
	> => {
		const target = await ctx.runQuery(internal.easyparcel.resolveSettingsTarget, {
			retailerId,
		});
		if (!target) return { ok: false, message: "Connect EasyParcel first." };
		try {
			const wallet = await withToken(ctx, target.retailerId, async (token) => {
				const r = await callApi(token, "GET", "/wallet");
				return parseWalletResponse(r.text, r.status);
			});
			await ctx.runMutation(internal.easyparcel.storeBalance, {
				retailerId: target.retailerId,
				balanceMinor: wallet.balanceMinor,
				currency: wallet.currency,
			});
			return { ok: true, ...wallet };
		} catch (err) {
			return { ok: false, message: friendlyError(err) };
		}
	},
});

export const resolveSettingsTarget = internalQuery({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ retailerId: Id<"retailers"> } | null> => {
		const access = await resolveStoreAccess(ctx, retailerId, "read");
		const conn = await connectionFor(ctx, access.retailer._id);
		return conn ? { retailerId: access.retailer._id } : null;
	},
});

export const storeBalance = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		balanceMinor: v.number(),
		currency: v.string(),
	},
	handler: async (ctx, args) => {
		const conn = await connectionFor(ctx, args.retailerId);
		if (!conn) return;
		await ctx.db.patch(conn._id, {
			balanceMinor: args.balanceMinor,
			balanceCurrency: args.currency,
			balanceCheckedAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type EasyparcelDispatchBlock =
	| "not_configured"
	| "country_unsupported"
	/** The order is going somewhere this provider doesn't carry from this
	 * store (z8r3fdr5yy): a cross-border order on Lalamove/Delyva, or a
	 * domestic one on a MY store's EasyParcel. */
	| "destination_unsupported"
	| "not_delivery"
	| "bad_status"
	| "job_active"
	| "not_connected"
	| "reconnect_needed"
	| "wrong_country"
	| "disabled"
	| "plan_gated"
	| "no_pickup_address"
	/** EasyParcel requires a sender phone, and that's the store's WhatsApp
	 * number — refused here, before the call, not by EasyParcel after it. */
	| "no_sender_phone"
	| "no_address";

function dispatchBlockReason(args: {
	order: Doc<"orders">;
	retailer: Doc<"retailers">;
	activeJob: Doc<"deliveryJobs"> | undefined;
	conn: Connection | null;
	planOk: boolean;
}): EasyparcelDispatchBlock | null {
	const { order, retailer, activeJob, conn, planOk } = args;
	// Deployment and country first — every reason below names a fix, and
	// for these two there is none to name (the 86eyqgujv lesson).
	if (!isConfigured()) return "not_configured";
	if (!courierBookingAllowed("easyparcel", retailer.country ?? DEFAULT_COUNTRY))
		return "country_unsupported";
	if (!servesOrderDestination("easyparcel", order, retailer))
		return "destination_unsupported";
	if (order.deliveryMethod !== "delivery") return "not_delivery";
	if (order.status !== "confirmed" && order.status !== "packed")
		return "bad_status";
	if (activeJob) return "job_active";
	if (!conn) return "not_connected";
	if (conn.revokedAt !== undefined) return "reconnect_needed";
	// A live account from the other country (connected before the connect
	// check existed): its wallet and prices are in the wrong currency.
	if (
		conn.environment !== "sandbox" &&
		accountCountryMismatch({
			balanceCurrency: conn.balanceCurrency,
			storeCountry: retailer.country ?? DEFAULT_COUNTRY,
		})
	)
		return "wrong_country";
	if (!conn.enabled) return "disabled";
	if (!planOk) return "plan_gated";
	if (!conn.pickupAddress) return "no_pickup_address";
	if (phoneDigits(retailer.waPhone) === "") return "no_sender_phone";
	if (!order.deliveryAddress) return "no_address";
	return null;
}

function phoneDigits(waPhone: string | undefined): string {
	return (waPhone ?? "").replace(/\D/g, "");
}

/** Where the parcel is going: the order's stamped country, else the store's
 * (orders from before the stamp are domestic). The booking and the card's
 * view both ask this, so the notice can never judge a different country from
 * the one the booking sends (found on the /test-code pass, z8r3fdr5yy). */
function receiverCountryOf(
	order: Doc<"orders">,
	storeCountry: Country,
): Country {
	return order.deliveryAddress?.country ?? storeCountry;
}

/** Same rule as Delyva/Lalamove dispatch (z8r3fdh274): a buyer number from
 * outside the country the parcel is GOING TO hands the courier the store's
 * number. Judged by the destination, not the store (z8r3fdr5yy): on an
 * SG→MY parcel the Malaysian courier needs the buyer's +60 number, which is
 * exactly the one a store-country check would have thrown away. */
function buyerContactPhone(
	buyerPhone: string,
	sellerPhone: string,
	country: Country,
): { phone: string; fallback: boolean } {
	const fallback =
		buyerPhone !== "" &&
		sellerPhone !== "" &&
		toDomesticContactPhone(buyerPhone, country) === null;
	return {
		phone: fallback ? sellerPhone : buyerPhone || sellerPhone,
		fallback,
	};
}

/** The order's parcel weight through the SAME summariser the weight/zone
 * pricing and Delyva use. */
async function resolveOrderWeight(
	ctx: QueryCtx,
	order: Doc<"orders">,
): Promise<{
	kg: number | null;
	issue: "custom_item" | "missing_weights" | null;
	perUnitKg: Array<number | undefined>;
}> {
	const perUnitKg: Array<number | undefined> = [];
	const items: CartWeightItem[] = await Promise.all(
		order.items.map(async (item, i): Promise<CartWeightItem> => {
			const variant = item.variantId ? await ctx.db.get(item.variantId) : null;
			perUnitKg[i] = variant?.parcelWeightG
				? variant.parcelWeightG / 1000
				: undefined;
			return {
				parcelWeightG: variant?.parcelWeightG ?? 0,
				quantity: item.quantity,
				isCustom: variant?.isCustom === true,
			};
		}),
	);
	const summary = summarizeCartWeight(items);
	return summary.kind === "ok"
		? { kg: summary.grams / 1000, issue: null, perUnitKg }
		: { kg: null, issue: summary.kind, perUnitKg };
}

const WEIGHT_OVERRIDE_MAX_KG = 1_000;

type DispatchContext =
	| { ok: false; reason: EasyparcelDispatchBlock | "not_found" }
	| {
			ok: true;
			orderId: Id<"orders">;
			retailerId: Id<"retailers">;
			shortId: string;
			country: Country;
			/** Where the parcel is going — the store's country, or the other
			 * one on a cross-border order (z8r3fdr5yy). */
			receiverCountry: Country;
			currency: string;
			sender: {
				name: string;
				phone: string;
				email?: string;
				unit?: string;
				address1: string;
				address2?: string;
				city: string;
				state?: string;
				postcode: string;
			};
			receiver: {
				name: string;
				phone: string;
				address1: string;
				address2?: string;
				city: string;
				state?: string;
				postcode: string;
			};
			items: Array<{
				name: string;
				unitKg?: number;
				unitValue: number;
				quantity: number;
			}>;
			declaredValue: number;
			computedWeightKg: number | null;
			weightIssue: "custom_item" | "missing_weights" | null;
			buyerPaidFee: number;
			balanceMinor?: number;
	  };

/**
 * Auth + eligibility + payload assembly for one booking attempt. INTERNAL —
 * the public surface is getDispatchState below.
 */
export const getDispatchContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<DispatchContext> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return { ok: false, reason: "not_found" };
		const access = await requireRetailerAccess(ctx, retailer._id, {
			area: "orders",
			level: "write",
		});
		let planOk = true;
		if (access.role !== "admin") {
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
		const conn = await connectionFor(ctx, retailer._id);
		const blocked = dispatchBlockReason({
			order,
			retailer,
			activeJob,
			conn,
			planOk,
		});
		if (blocked) return { ok: false, reason: blocked };
		const pickup = conn?.pickupAddress;
		if (!conn || !pickup || !order.deliveryAddress)
			return { ok: false, reason: "not_connected" }; // restated for types

		const weight = await resolveOrderWeight(ctx, order);
		const country = retailer.country ?? DEFAULT_COUNTRY;
		const receiverCountry = receiverCountryOf(order, country);
		const buyerPhone = phoneDigits(order.customer.waPhone);
		const sellerPhone = phoneDigits(retailer.waPhone);
		const buyer = buyerContactPhone(buyerPhone, sellerPhone, receiverCountry);
		const goodsTotal = order.items.reduce(
			(sum, i) => sum + i.price * i.quantity,
			0,
		);
		return {
			ok: true,
			orderId: order._id,
			retailerId: retailer._id,
			shortId: order.shortId,
			country,
			receiverCountry,
			currency: order.currency,
			sender: {
				name: retailer.storeName,
				phone: sellerPhone,
				email: retailer.notifyEmail || undefined,
				unit: pickup.unit,
				address1: pickup.address1,
				address2: pickup.address2,
				city: pickup.city,
				state: pickup.state,
				postcode: pickup.postcode,
			},
			receiver: {
				name: order.customer.name ?? "Customer",
				phone: buyer.phone,
				address1: order.deliveryAddress.line1,
				address2: order.deliveryAddress.line2,
				city: order.deliveryAddress.city,
				state: order.deliveryAddress.state,
				postcode: order.deliveryAddress.postcode,
			},
			items: order.items.map((item, i) => ({
				name: item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name,
				unitKg: weight.perUnitKg[i],
				unitValue: item.price / 100,
				quantity: item.quantity,
			})),
			declaredValue: goodsTotal / 100,
			computedWeightKg: weight.kg,
			weightIssue: weight.issue,
			buyerPaidFee: order.deliveryFee ?? 0,
			balanceMinor: conn.balanceMinor,
		};
	},
});

function resolveWeightKg(
	context: Extract<DispatchContext, { ok: true }>,
	override: number | undefined,
): { ok: true; kg: number } | { ok: false; message: string } {
	if (override !== undefined) {
		if (!Number.isFinite(override) || override <= 0 || override > WEIGHT_OVERRIDE_MAX_KG)
			return { ok: false, message: "Enter the packed weight in kg (e.g. 2.5)." };
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

/** The items as EasyParcel wants them: per-unit weight, falling back to an
 * even share of the parcel weight for lines with none (custom lines) — the
 * shipment weight, not these, is what's priced. */
function toItems(
	context: Extract<DispatchContext, { ok: true }>,
	shipmentKg: number,
): EasyparcelItem[] {
	const units = context.items.reduce((n, i) => n + i.quantity, 0) || 1;
	return context.items.map((i) => ({
		content: i.name,
		weightKg: i.unitKg ?? shipmentKg / units,
		value: i.unitValue,
		quantity: i.quantity,
	}));
}

/** "YYYY-MM-DD" in the store's timezone (MY/SG share UTC+8) — the soonest
 * collection a courier can take; EasyParcel schedules the actual pickup. */
function todayInStoreTz(now: number): string {
	return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const boxValidator = v.union(
	v.literal("small"),
	v.literal("medium"),
	v.literal("large"),
);

/**
 * Step 1 of the two-tap dispatch: quote the parcel and read the wallet, so
 * the dialog can show every courier's price beside what the wallet holds.
 */
export const prepareBooking = action({
	args: {
		shortId: v.string(),
		box: boxValidator,
		weightKgOverride: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| {
				ok: false;
				reason:
					| EasyparcelDispatchBlock
					| "not_found"
					| "no_weight"
					| "quote_failed";
				message?: string;
		  }
		| {
				ok: true;
				rates: EasyparcelRate[];
				weightKg: number;
				buyerPaidFee: number;
				balanceMinor?: number;
				balanceCurrency?: string;
		  }
	> => {
		await ctx.runQuery(internal.subscriptions.assertWritableForOrder, {
			shortId: args.shortId,
		});
		await ctx.runQuery(internal.creditLock.assertCreditsForOrder, {
			shortId: args.shortId,
		});
		const context = await ctx.runQuery(internal.easyparcel.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		const weight = resolveWeightKg(context, args.weightKgOverride);
		if (!weight.ok)
			return { ok: false, reason: "no_weight", message: weight.message };
		try {
			const { rates, wallet } = await withToken(
				ctx,
				context.retailerId,
				async (token) => {
					const [quote, walletRes] = await Promise.all([
						callApi(
							token,
							"POST",
							"/shipment/quotations",
							buildQuotationBody({
								sender: {
									postcode: context.sender.postcode,
									state: context.sender.state,
									country: context.country,
								},
								receiver: {
									postcode: context.receiver.postcode,
									state: context.receiver.state,
									country: context.receiverCountry,
								},
								weightKg: weight.kg,
								dims: PARCEL_BOXES[args.box as ParcelBox],
								parcelValue: context.declaredValue,
							}),
						),
						callApi(token, "GET", "/wallet").catch(() => null),
					]);
					return {
						rates: parseQuotationResponse(quote.text, quote.status),
						wallet: walletRes
							? (() => {
									try {
										return parseWalletResponse(walletRes.text, walletRes.status);
									} catch {
										return null;
									}
								})()
							: null,
					};
				},
			);
			if (wallet) {
				await ctx.runMutation(internal.easyparcel.storeBalance, {
					retailerId: context.retailerId,
					balanceMinor: wallet.balanceMinor,
					currency: wallet.currency,
				});
			}
			return {
				ok: true,
				rates,
				weightKg: weight.kg,
				buyerPaidFee: context.buyerPaidFee,
				balanceMinor: wallet?.balanceMinor ?? context.balanceMinor,
				balanceCurrency: wallet?.currency,
			};
		} catch (err) {
			console.warn("[easyparcel] dispatch quote failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: err instanceof ReconnectNeeded ? "reconnect_needed" : "quote_failed",
				message: friendlyError(err),
			};
		}
	},
});

/** How long an uncommitted reservation may exist before the sweeper flags it. */
const RESERVATION_EXPIRY_MS = 5 * 60 * 1000;

/** Claim the order's one-active-job slot BEFORE the external call — jobs
 * from EVERY provider count (the cross-provider invariant). */
export const reserveBooking = internalMutation({
	args: {
		orderId: v.id("orders"),
		retailerId: v.id("retailers"),
		serviceId: v.string(),
		serviceName: v.string(),
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
			provider: "easyparcel",
			status: "assigning",
			costActual: 0, // real figure patched at commit (never client-supplied)
			quotationId: args.serviceId,
			vehicleType: args.serviceId,
			serviceName: args.serviceName,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			RESERVATION_EXPIRY_MS,
			internal.easyparcel.expireStaleReservation,
			{ jobId },
		);
		return jobId;
	},
});

export const commitBooking = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		shipmentNumber: v.string(),
		costActual: v.number(),
		courierName: v.string(),
		awb: v.optional(v.string()),
		labelUrl: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;
		await ctx.db.patch(args.jobId, {
			providerOrderId: args.shipmentNumber,
			status: "assigning",
			costActual: args.costActual,
			awb: args.awb,
			labelUrl: args.labelUrl,
			// A commit that lost a race against its own expiry sweep revives the
			// row — the shipment DOES exist at EasyParcel either way.
			failureReason: undefined,
			updatedAt: Date.now(),
		});
		if (args.awb) {
			await mirrorAwbOntoOrder(ctx, job, {
				awb: args.awb,
				courierName: args.courierName,
				trackingUrl: args.trackingUrl,
			});
		}
	},
});

/** Write the AWB into the buyer-visible manual-courier fields (86eyehvk4) —
 * fill-if-unset, so a seller's own entry is never overwritten. EasyParcel's
 * own tracking link first, then the courier registry; never an invented URL. */
async function mirrorAwbOntoOrder(
	ctx: MutationCtx,
	job: Doc<"deliveryJobs">,
	args: { awb: string; courierName: string; trackingUrl?: string },
): Promise<void> {
	const order = await ctx.db.get(job.orderId);
	if (!order || order.trackingNo) return;
	const registry = findCourier(args.courierName);
	const trackingUrl =
		args.trackingUrl ??
		(registry?.buildTrackingUrl ? registry.buildTrackingUrl(args.awb) : undefined);
	await ctx.db.patch(order._id, {
		courierName: args.courierName,
		trackingNo: args.awb,
		...(order.carrierTrackingUrl || !trackingUrl
			? {}
			: { carrierTrackingUrl: trackingUrl }),
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
		if (!job || job.providerOrderId !== undefined) return;
		if (job.status !== "assigning") return;
		await ctx.db.patch(jobId, {
			status: "expired",
			failureReason:
				"Booking never confirmed — check your EasyParcel dashboard before rebooking",
			updatedAt: Date.now(),
		});
	},
});

/**
 * Step 2: book the picked service. Submit books AND charges the wallet in one
 * call, so the wallet is re-read first and a pick it can't cover is refused
 * before anything is sent. A failure we can't classify AFTER the request left
 * (a timeout) may still have booked — the reservation releases with a reason
 * that names the shortId to look for, rather than inviting a double booking.
 */
export const confirmBooking = action({
	args: {
		shortId: v.string(),
		serviceId: v.string(),
		serviceName: v.string(),
		courierName: v.string(),
		/** Wallet pre-check only — the charged figure comes from EasyParcel. */
		priceMinor: v.number(),
		box: boxValidator,
		weightKgOverride: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		| {
				ok: false;
				reason:
					| EasyparcelDispatchBlock
					| "not_found"
					| "no_weight"
					| "booking_failed";
				message?: string;
		  }
		| {
				ok: true;
				shipmentNumber: string;
				costActual: number;
				awb?: string;
				labelUrl?: string;
		  }
	> => {
		await ctx.runQuery(internal.subscriptions.assertWritableForOrder, {
			shortId: args.shortId,
		});
		await ctx.runQuery(internal.creditLock.assertCreditsForOrder, {
			shortId: args.shortId,
		});
		const context = await ctx.runQuery(internal.easyparcel.getDispatchContext, {
			shortId: args.shortId,
		});
		if (!context.ok) return context;
		const weight = resolveWeightKg(context, args.weightKgOverride);
		if (!weight.ok)
			return { ok: false, reason: "no_weight", message: weight.message };

		// Fresh wallet read — the quote's snapshot may be minutes old.
		try {
			const wallet = await withToken(ctx, context.retailerId, async (token) => {
				const r = await callApi(token, "GET", "/wallet");
				return parseWalletResponse(r.text, r.status);
			});
			await ctx.runMutation(internal.easyparcel.storeBalance, {
				retailerId: context.retailerId,
				balanceMinor: wallet.balanceMinor,
				currency: wallet.currency,
			});
			if (wallet.balanceMinor < args.priceMinor) {
				return {
					ok: false,
					reason: "booking_failed",
					message: `Your EasyParcel wallet holds ${(wallet.balanceMinor / 100).toFixed(2)} but this courier costs ${(args.priceMinor / 100).toFixed(2)} — top up in EasyParcel, then book again. Nothing was booked.`,
				};
			}
		} catch (err) {
			if (err instanceof ReconnectNeeded) {
				return {
					ok: false,
					reason: "reconnect_needed",
					message: friendlyError(err),
				};
			}
			// Any other wallet failure: the submit itself is the real gate.
		}

		let jobId: Id<"deliveryJobs">;
		try {
			jobId = await ctx.runMutation(internal.easyparcel.reserveBooking, {
				orderId: context.orderId,
				retailerId: context.retailerId,
				serviceId: args.serviceId,
				serviceName: args.serviceName,
			});
		} catch {
			return {
				ok: false,
				reason: "job_active",
				message: "A delivery booking is already in progress for this order.",
			};
		}

		const dims = PARCEL_BOXES[args.box as ParcelBox];
		try {
			const booked = await withToken(ctx, context.retailerId, async (token) => {
				const r = await callApi(
					token,
					"POST",
					"/shipment/submit_orders",
					buildSubmitBody({
						serviceId: args.serviceId,
						collectionDate: todayInStoreTz(Date.now()),
						weightKg: weight.kg,
						dims,
						items: toItems(context, weight.kg),
						currency: context.currency,
						reference: context.shortId,
						sender: { ...context.sender, country: context.country },
						receiver: {
							...context.receiver,
							country: context.receiverCountry,
						},
					}),
				);
				return parseSubmitResponse(r.text, r.status);
			});
			const costActual = booked.paidMinor ?? args.priceMinor;
			await ctx.runMutation(internal.easyparcel.commitBooking, {
				jobId,
				shipmentNumber: booked.shipmentNumber,
				costActual,
				courierName: booked.courierName ?? args.courierName,
				awb: booked.awb,
				labelUrl: booked.labelUrl,
				trackingUrl: booked.trackingUrl,
			});
			// The AWB often isn't issued at submit. The awb webhook brings it;
			// this re-read is the backstop for a missed one.
			if (!booked.awb) {
				await ctx.scheduler.runAfter(60_000, internal.easyparcel.syncJob, {
					jobId,
				});
			}
			return {
				ok: true,
				shipmentNumber: booked.shipmentNumber,
				costActual,
				awb: booked.awb,
				labelUrl: booked.labelUrl,
			};
		} catch (err) {
			console.warn("[easyparcel] booking failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			// An item-level refusal is a definite "not booked"; anything else
			// (timeout, 5xx) might have booked before failing.
			const definite =
				err instanceof ReconnectNeeded ||
				(err instanceof EasyparcelApiError &&
					(err.code === "item" || err.code === "envelope"));
			const message = definite
				? friendlyError(err)
				: `We couldn't confirm the booking with EasyParcel. Check your EasyParcel dashboard for an order with reference ${context.shortId} before booking again, so it isn't booked twice.`;
			await ctx.runMutation(internal.easyparcel.releaseReservation, {
				jobId,
				reason: message,
			});
			return {
				ok: false,
				reason: err instanceof ReconnectNeeded ? "reconnect_needed" : "booking_failed",
				message,
			};
		}
	},
});

/** Cancel at EasyParcel (refunded to the seller's wallet). EasyParcel's own
 * refusal sentence — e.g. the 7-days-from-collection window — is shown as is. */
export const cancelBooking = action({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{ ok: boolean; message?: string }> => {
		await ctx.runQuery(internal.subscriptions.assertWritableForOrder, {
			shortId,
		});
		const target = await ctx.runQuery(internal.easyparcel.getCancelContext, {
			shortId,
		});
		if (!target) return { ok: false, message: "No active booking to cancel." };
		try {
			const result = await withToken(ctx, target.retailerId, async (token) => {
				const r = await callApi(
					token,
					"POST",
					"/shipment/cancel",
					buildCancelBody(target.shipmentNumber, `Cancelled from Kedaipal (${shortId})`),
				);
				return parseCancelResponse(r.text, r.status);
			});
			if (!result.ok) return { ok: false, message: result.message };
			await ctx.runMutation(internal.easyparcel.markJobCancelled, {
				jobId: target.jobId,
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, message: friendlyError(err) };
		}
	},
});

export const getCancelContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		jobId: Id<"deliveryJobs">;
		retailerId: Id<"retailers">;
		shipmentNumber: string;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		await requireRetailerAccess(ctx, order.retailerId, {
			area: "orders",
			level: "write",
		});
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const active = jobs.find(
			(j) => j.provider === "easyparcel" && isActiveJobStatus(j.status),
		);
		if (!active?.providerOrderId) return null;
		return {
			jobId: active._id,
			retailerId: order.retailerId,
			shipmentNumber: active.providerOrderId,
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
			failureReason: SELLER_CANCELLED,
			updatedAt: Date.now(),
		});
	},
});

const SELLER_CANCELLED = "Cancelled by you — refunded to your EasyParcel wallet";

// ---------------------------------------------------------------------------
// Status — webhook nudge, backstop cron, and the card's refresh
// ---------------------------------------------------------------------------

/** Order statuses that may auto-advance from a courier event — the
 * Lalamove/Delyva rule: a pending order never ships itself. */
const SHIPPABLE_FROM = new Set(["confirmed", "packed"]);
const DELIVERABLE_FROM = new Set(["confirmed", "packed", "shipped"]);

/**
 * The webhook route's whole job: find the job this shipment number belongs
 * to and schedule a re-read. The payload is unsigned, so it is trusted for
 * NOTHING but "this shipment may have changed" — and the per-job rate limit
 * means a flood of forged events costs at most a handful of reads.
 */
export const queueSyncForShipment = internalMutation({
	args: { shipmentNumber: v.string() },
	handler: async (ctx, { shipmentNumber }) => {
		const job = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_provider_order", (q) =>
				q.eq("provider", "easyparcel").eq("providerOrderId", shipmentNumber),
			)
			// `.first()`, never `.unique()`: this runs under an UNAUTHENTICATED
			// route that promises a fast 200, so a duplicate shipment number
			// (should EasyParcel ever reissue one) must not throw it into a 500.
			.first();
		if (!job) return;
		const { ok } = await rateLimiter.limit(ctx, "easyparcelWebhookSync", {
			key: job._id,
		});
		if (!ok) return;
		await ctx.scheduler.runAfter(0, internal.easyparcel.syncJob, {
			jobId: job._id,
		});
	},
});

export const getJobSyncContext = internalQuery({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.provider !== "easyparcel" || !job.providerOrderId)
			return null;
		return { retailerId: job.retailerId, shipmentNumber: job.providerOrderId };
	},
});

/** Re-read ONE shipment with the seller's own token and apply it. */
export const syncJob = internalAction({
	args: { jobId: v.id("deliveryJobs") },
	handler: async (ctx, { jobId }): Promise<void> => {
		const target = await ctx.runQuery(internal.easyparcel.getJobSyncContext, {
			jobId,
		});
		if (!target) return;
		try {
			const state = await withToken(ctx, target.retailerId, async (token) => {
				const r = await callApi(token, "POST", "/shipment/details", {
					shipment_number: target.shipmentNumber,
				});
				return parseDetailsResponse(r.text, r.status);
			});
			await ctx.runMutation(internal.easyparcel.applyStatusSync, {
				jobId,
				statusCode: state.statusCode,
				statusText: state.statusText,
				awb: state.awb,
				labelUrl: state.labelUrl,
				trackingUrl: state.trackingUrl,
				syncedAt: Date.now(),
			});
		} catch (err) {
			console.warn("[easyparcel] status sync failed", {
				jobId,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	},
});

/**
 * Apply one shipment read — the applyWebhookEvent contract: idempotent, the
 * job follows provider truth, the ORDER never regresses, a seller-cancel
 * story is never rewritten by a later read.
 */
export const applyStatusSync = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		statusCode: v.optional(v.number()),
		statusText: v.optional(v.string()),
		awb: v.optional(v.string()),
		labelUrl: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		syncedAt: v.number(),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || job.provider !== "easyparcel") return;
		const now = Date.now();
		const courierName = job.serviceName ?? "EasyParcel";

		if (args.awb && !job.awb) {
			await ctx.db.patch(args.jobId, { awb: args.awb, updatedAt: now });
			await mirrorAwbOntoOrder(ctx, job, {
				awb: args.awb,
				courierName,
				trackingUrl: args.trackingUrl,
			});
		}
		if (args.labelUrl && !job.labelUrl) {
			await ctx.db.patch(args.jobId, { labelUrl: args.labelUrl, updatedAt: now });
		}

		const status = normalizeEasyparcelStatus(args.statusCode);
		if (!status) {
			if (args.statusCode === EASYPARCEL_ON_HOLD && isActiveJobStatus(job.status)) {
				await ctx.db.patch(args.jobId, {
					failureReason:
						"EasyParcel reports the parcel on hold — check your EasyParcel dashboard",
					lastEventAt: args.syncedAt,
					updatedAt: now,
				});
			}
			return;
		}

		const sellerCancelled =
			job.status === "canceled" && job.failureReason === SELLER_CANCELLED;
		if (status !== job.status && !sellerCancelled) {
			const enteringFailure =
				(status === "canceled" || status === "rejected") &&
				isActiveJobStatus(job.status);
			await ctx.db.patch(args.jobId, {
				status,
				...(isActiveJobStatus(status) ? { failureReason: undefined } : {}),
				...(status === "rejected"
					? { failureReason: args.statusText ?? "The parcel was returned" }
					: status === "canceled"
						? { failureReason: args.statusText ?? "Cancelled at EasyParcel" }
						: {}),
				lastEventAt: args.syncedAt,
				updatedAt: now,
			});
			if (enteringFailure) {
				await ctx.scheduler.runAfter(0, internal.email.notifyDeliveryJobFailed, {
					orderId: job.orderId,
					reason:
						status === "rejected"
							? "The courier returned the parcel. Check your EasyParcel dashboard."
							: "The EasyParcel booking was cancelled.",
					provider: "easyparcel",
				});
			}
		} else {
			await ctx.db.patch(args.jobId, { lastEventAt: args.syncedAt, updatedAt: now });
		}

		const order = await ctx.db.get(job.orderId);
		if (!order || order.status === "cancelled") return;
		if (status === "picked_up" && SHIPPABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "shipped", {
				courierName: order.courierName ?? courierName,
				trackingNo: order.trackingNo ?? job.awb ?? args.awb,
				carrierTrackingUrl: order.carrierTrackingUrl ?? args.trackingUrl,
			});
		} else if (status === "completed" && DELIVERABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "delivered");
		}
	},
});

/** The hourly backstop for missed webhooks: every active easyparcel job gets
 * a re-read, spaced a second apart so a busy store doesn't burst the API. */
export const syncActiveJobs = internalMutation({
	args: {},
	handler: async (ctx) => {
		let delay = 0;
		for (const status of ["assigning", "ongoing", "picked_up"] as const) {
			const rows = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_provider_status", (q) =>
					q.eq("provider", "easyparcel").eq("status", status),
				)
				.take(500);
			for (const job of rows) {
				if (!job.providerOrderId) continue;
				await ctx.scheduler.runAfter(delay, internal.easyparcel.syncJob, {
					jobId: job._id,
				});
				delay += 1000;
			}
		}
	},
});

/** The card's "Refresh status" — a re-read on demand. */
export const refreshJobStatus = action({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<{ ok: boolean; message?: string }> => {
		const target = await ctx.runQuery(internal.easyparcel.getRefreshTarget, {
			shortId,
		});
		if (!target) return { ok: false, message: "No EasyParcel booking to refresh." };
		await ctx.runAction(internal.easyparcel.syncJob, { jobId: target.jobId });
		return { ok: true };
	},
});

export const getRefreshTarget = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }) => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		await requireRetailerAccess(ctx, order.retailerId, {
			area: "orders",
			level: "read",
		});
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const target = jobs.find(
			(j) =>
				j.provider === "easyparcel" &&
				j.providerOrderId !== undefined &&
				isActiveJobStatus(j.status),
		);
		return target ? { jobId: target._id } : null;
	},
});

/** Daily: drop connect attempts older than a week — the card only ever reads
 * the latest one. */
export const purgeOAuthStates = internalMutation({
	args: {},
	handler: async (ctx) => {
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const old = await ctx.db
			.query("courierOAuthStates")
			.withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
			.take(500);
		for (const row of old) await ctx.db.delete(row._id);
	},
});

// ---------------------------------------------------------------------------
// Order-detail card read
// ---------------------------------------------------------------------------

export type EasyparcelJobView = {
	status: Doc<"deliveryJobs">["status"];
	shipmentNumber?: string;
	costActual: number;
	serviceName?: string;
	awb?: string;
	labelUrl?: string;
	failureReason?: string;
	createdAt: number;
	lastEventAt?: number;
};

export const getDispatchState = query({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }) => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const conn = await connectionFor(ctx, retailer._id);
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));
		const own = jobs.filter((j) => j.provider === "easyparcel");
		const latest =
			(activeJob?.provider === "easyparcel" ? activeJob : undefined) ??
			[...own].sort((a, b) => b.createdAt - a.createdAt)[0] ??
			null;
		const access = await requireRetailerAccess(ctx, retailer._id, {
			area: "orders",
			level: "read",
		});
		let planOk = true;
		if (access.role !== "admin") {
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
			conn,
			planOk,
		});
		const weight = await resolveOrderWeight(ctx, order);
		const country = retailer.country ?? DEFAULT_COUNTRY;
		const receiverCountry = receiverCountryOf(order, country);
		const pickup = conn?.pickupAddress;
		const job: EasyparcelJobView | null = latest
			? {
					status: latest.status,
					shipmentNumber: latest.providerOrderId,
					costActual: latest.costActual,
					serviceName: latest.serviceName,
					awb: latest.awb,
					labelUrl: latest.labelUrl,
					failureReason: latest.failureReason,
					createdAt: latest.createdAt,
					lastEventAt: latest.lastEventAt,
				}
			: null;
		return {
			job,
			blockReason,
			/** Connected (grant alive or not), switched on, served here — the
			 * card renders; a dead grant shows as the reconnect block, not as a
			 * set-up hint for an integration the seller already has. */
			bookingEnabled:
				conn !== null &&
				conn.enabled &&
				isConfigured() &&
				courierBookingAllowed("easyparcel", country),
			country,
			/** The country the parcel goes to — the notice names it. */
			receiverCountry,
			buyerContactFallback: buyerContactPhone(
				phoneDigits(order.customer.waPhone),
				phoneDigits(retailer.waPhone),
				receiverCountry,
			).fallback,
			pickupSummary: pickup
				? [
						[pickup.unit, pickup.address1].filter(Boolean).join(" "),
						`${pickup.postcode}${pickup.city && pickup.city !== SG_STATE_LABEL ? ` ${pickup.city}` : ""}`,
					].join(", ")
				: undefined,
			environment: conn?.environment,
			accountName: conn?.accountName,
			balanceMinor: conn?.balanceMinor,
			balanceCurrency: conn?.balanceCurrency,
			computedWeightKg: weight.kg,
			weightIssue: weight.issue,
		};
	},
});
