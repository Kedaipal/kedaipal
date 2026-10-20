// EasyParcel parcel booking (z8r3fdcje2) — the SG parcel-aggregator lane,
// structured as convex/delyva.ts's sibling: pure wire logic lives in
// lib/easyparcel.ts; this module owns auth, eligibility, the network calls
// and the deliveryJobs ledger. Two deliberate differences from Delyva:
//  - EasyParcel is PREPAID and pays in a separate step (submit → pay), so a
//    booking can half-succeed: the order exists at EasyParcel but unpaid.
//    confirmBooking pre-checks the wallet, and an unpaid outcome RELEASES the
//    reservation with the EasyParcel order number in the message — never a
//    dangling "active" job for a shipment no courier will collect.
//  - No webhook exists on this API: the status cron (convex/crons.ts) polls
//    EPParcelStatusBulk for active jobs, and the card offers a manual
//    refresh. applyStatusSync mirrors the Delyva webhook-apply contract
//    (job follows provider truth, ORDER never regresses).
// See docs/delivery-easyparcel.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import { postcodeRule } from "./lib/address";
import { requireRetailerAccess, resolveMyRetailer } from "./lib/auth";
import { easyparcelBookingArmed } from "./lib/courierBooking";
import { toDomesticContactPhone } from "./lib/courierContact";
import { findCourier } from "./lib/couriers";
import { courierBookingAllowed } from "./lib/courierProviders";
import { encryptSecret } from "./lib/credentialCrypto";
import { type CartWeightItem, summarizeCartWeight } from "./lib/delivery";
import { isActiveJobStatus } from "./lib/deliveryJobs";
import {
	buildCheckBalanceForm,
	buildParcelStatusForm,
	buildPayOrderForm,
	buildRateCheckForm,
	buildSubmitOrderForm,
	classifyEasyparcelFailure,
	decryptEasyparcelCredentials,
	type EasyparcelCredentials,
	easyparcelActionUrl,
	type EasyparcelRate,
	EasyparcelResponseError,
	normalizeEasyparcelShipStatus,
	parseCheckBalanceResponse,
	parseParcelStatusResponse,
	parsePayOrderResponse,
	parseRateCheckResponse,
	parseSubmitOrderResponse,
	resolveEasyparcelCredentials,
} from "./lib/easyparcel";
import { DEFAULT_COUNTRY, type Country } from "./lib/country";
import type { PermissionLevel } from "./lib/permissions";
import { applyStatusTransition, resolveSharedOrder } from "./orders";
import { assertPlanFeature, assertSubscriptionActive } from "./subscriptions";

type EasyparcelConfig = NonNullable<Doc<"retailers">["easyparcel"]>;
type PickupAddress = NonNullable<EasyparcelConfig["pickupAddress"]>;

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** One form-encoded POST to `{host}/?ac={action}`. The caller passes the
 * already-built form body (the key is inside it); a non-2xx or a non-zero
 * envelope code surfaces as EasyparcelResponseError for classification. */
async function callEasyparcel(
	country: Country,
	isDemo: boolean,
	actionName: string,
	formBody: string,
): Promise<string> {
	const res = await fetch(easyparcelActionUrl(country, isDemo, actionName), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: formBody,
	});
	const text = await res.text();
	if (!res.ok) {
		throw new EasyparcelResponseError(`http_${res.status}`, text.slice(0, 200));
	}
	return text;
}

/** Map an EasyParcel failure to seller-facing copy (the friendlyBookingError
 * posture: name the fix, never just the failure). */
function friendlyEasyparcelError(err: unknown): string {
	if (err instanceof EasyparcelResponseError) {
		switch (classifyEasyparcelFailure(err)) {
			case "auth":
				return "EasyParcel didn't recognise your API key any more — reconnect it in Settings → Integrations (EasyParcel dashboard → Integrations → API Key).";
			case "invalid_address":
				return `EasyParcel rejected an address on this shipment (${err.errorRemark}). Check the buyer's postcode and your pickup address, then try again.`;
			case "credit":
				return "Your EasyParcel wallet doesn't have enough credit for this shipment. Top up in EasyParcel, then book again — nothing was dispatched and your buyer wasn't notified.";
			default:
				return err.errorRemark
					? `EasyParcel couldn't process this: ${err.errorRemark}`
					: "EasyParcel couldn't process this right now. Please try again in a moment.";
		}
	}
	return "Couldn't reach EasyParcel right now. Please try again in a moment.";
}

// ---------------------------------------------------------------------------
// Access + connect
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
		const access = await resolveStoreAccess(ctx, retailerId, "write");
		const country = access.retailer.country ?? DEFAULT_COUNTRY;
		if (!courierBookingAllowed("easyparcel", country)) {
			return {
				ok: false,
				// MY is deliberately closed (the 29 Jul frozen-prohibition finding;
				// Delyva serves MY incl. cold chain) — worded as "not available",
				// with the working alternative named.
				message:
					"EasyParcel booking isn't available in your store's country — Malaysian stores book couriers through Delyva instead.",
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
		apiKeyHint: v.string(),
		isDemo: v.boolean(),
		balanceMinor: v.number(),
		balanceCurrency: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) return;
		const prev = retailer.easyparcel as EasyparcelConfig | undefined;
		await ctx.db.patch(args.retailerId, {
			easyparcel: {
				// A fresh key connects ENABLED — connecting is the enable gesture
				// (the Delyva posture); updateSettings can pause later.
				enabled: true,
				apiKey: args.apiKey,
				apiKeyHint: args.apiKeyHint,
				isDemo: args.isDemo,
				balanceMinor: args.balanceMinor,
				balanceCurrency: args.balanceCurrency,
				balanceCheckedAt: Date.now(),
				// Pickup address survives a key rotation.
				pickupAddress: prev?.pickupAddress,
				connectedAt: prev?.connectedAt ?? Date.now(),
			},
			updatedAt: Date.now(),
		});
	},
});

/**
 * Connect a seller's EasyParcel account from ONE pasted Individual API key.
 * EPCheckCreditBalance doubles as the validation ping (their own plugin's
 * auth probe) — and because EasyParcel's sandbox is a SEPARATE HOST with the
 * same key format, which host accepts the key IS the environment answer:
 * production first, demo on an auth-class refusal. A key both hosts refuse is
 * simply wrong.
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
		| { ok: true; isDemo: boolean; balanceMinor: number; balanceCurrency?: string }
	> => {
		const context = await ctx.runQuery(internal.easyparcel.getConnectContext, {
			retailerId: args.retailerId,
		});
		if (!context.ok) return context;
		await ctx.runQuery(internal.subscriptions.assertWritable, {
			retailerId: context.retailerId,
		});
		const apiKey = args.apiKey.trim();
		if (!apiKey) {
			return { ok: false, message: "Paste your EasyParcel API key first." };
		}

		const probe = async (isDemo: boolean) =>
			parseCheckBalanceResponse(
				await callEasyparcel(
					context.country,
					isDemo,
					"EPCheckCreditBalance",
					buildCheckBalanceForm(apiKey),
				),
			);

		let isDemo = false;
		let balance: { balanceMinor: number; currency?: string };
		try {
			balance = await probe(false);
		} catch (err) {
			const authFailure =
				err instanceof EasyparcelResponseError &&
				classifyEasyparcelFailure(err) === "auth";
			if (!authFailure) {
				console.warn("[easyparcel] connect probe failed", {
					message: err instanceof Error ? err.message : String(err),
				});
				return {
					ok: false,
					message:
						"Couldn't reach EasyParcel to check the key. Please try again in a moment.",
				};
			}
			try {
				balance = await probe(true);
				isDemo = true;
			} catch {
				return {
					ok: false,
					message:
						"EasyParcel didn't recognise this API key. Copy it again from the EasyParcel dashboard → Integrations → API Key (choose Individual API).",
				};
			}
		}

		await ctx.runMutation(internal.easyparcel.storeConnection, {
			retailerId: context.retailerId,
			apiKey: await encryptSecret(apiKey),
			apiKeyHint: apiKey.slice(-4),
			isDemo,
			balanceMinor: balance.balanceMinor,
			balanceCurrency: balance.currency,
		});
		return {
			ok: true,
			isDemo,
			balanceMinor: balance.balanceMinor,
			balanceCurrency: balance.currency,
		};
	},
});

/** Disconnect keeps the pickup address (retyping it is the annoying part of a
 * reconnect) and drops everything credential-shaped. Never plan-gated —
 * downgrade must always have the way off. */
export const disconnect = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }) => {
		const access = await resolveStoreAccess(ctx, retailerId, "write");
		// The view-only lock (comp-off / expired stores) — the Delyva
		// disconnect's posture; plan gating never applies to disconnecting.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, access.retailer._id);
		const prev = access.retailer.easyparcel as EasyparcelConfig | undefined;
		if (!prev) return;
		await ctx.db.patch(access.retailer._id, {
			easyparcel: {
				enabled: false,
				pickupAddress: prev.pickupAddress,
			},
			updatedAt: Date.now(),
		});
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
		// The view-only lock applies to every settings write (the Delyva
		// posture); the PLAN gate below applies to the enable direction only.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, access.retailer._id);
		const config = access.retailer.easyparcel as EasyparcelConfig | undefined;
		if (!config) return { ok: false, message: "Connect EasyParcel first." };
		if (!access.actingAsAdmin && args.enabled === true && !config.enabled) {
			// Gate only the ENABLE direction; pausing stays free (downgrade
			// never traps).
			await assertPlanFeature(ctx, access.retailer._id, "delivery");
		}
		let pickupAddress = config.pickupAddress;
		if (args.pickupAddress) {
			const country = access.retailer.country ?? DEFAULT_COUNTRY;
			const rule = postcodeRule(country);
			const postcode = args.pickupAddress.postcode.trim();
			if (!rule.pattern.test(postcode)) {
				return { ok: false, message: rule.error };
			}
			if (!args.pickupAddress.address1.trim()) {
				return { ok: false, message: "Enter the pickup street address." };
			}
			pickupAddress = {
				unit: args.pickupAddress.unit?.trim() || undefined,
				address1: args.pickupAddress.address1.trim(),
				address2: args.pickupAddress.address2?.trim() || undefined,
				city: args.pickupAddress.city?.trim() || undefined,
				state: args.pickupAddress.state?.trim() || undefined,
				postcode,
			};
		}
		await ctx.db.patch(access.retailer._id, {
			easyparcel: {
				...config,
				enabled: args.enabled ?? config.enabled,
				pickupAddress,
			},
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Settings-card read — no credentials, ever. */
export const getSettings = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		available: boolean;
		connected: boolean;
		enabled: boolean;
		apiKeyHint?: string;
		isDemo?: boolean;
		balanceMinor?: number;
		balanceCurrency?: string;
		balanceCheckedAt?: number;
		pickupAddress?: PickupAddress;
		connectedAt?: number;
		country: Country;
	} | null> => {
		const access = await resolveStoreAccess(ctx, retailerId, "read");
		const country = access.retailer.country ?? DEFAULT_COUNTRY;
		const config = access.retailer.easyparcel as EasyparcelConfig | undefined;
		return {
			available: courierBookingAllowed("easyparcel", country),
			connected: resolveEasyparcelCredentials(config) !== null,
			enabled: config?.enabled === true,
			apiKeyHint: config?.apiKeyHint,
			isDemo: config?.isDemo,
			balanceMinor: config?.balanceMinor,
			balanceCurrency: config?.balanceCurrency,
			balanceCheckedAt: config?.balanceCheckedAt,
			pickupAddress: config?.pickupAddress,
			connectedAt: config?.connectedAt,
			country,
		};
	},
});

/** Re-read the prepaid wallet (settings card + dispatch dialog refresh). */
export const refreshBalance = action({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		| { ok: false; message: string }
		| { ok: true; balanceMinor: number; balanceCurrency?: string }
	> => {
		const target = await ctx.runQuery(
			internal.easyparcel.getBalanceRefreshContext,
			{ retailerId },
		);
		if (!target) return { ok: false, message: "Connect EasyParcel first." };
		try {
			const credentials = await decryptEasyparcelCredentials(
				target.credentials,
			);
			const balance = parseCheckBalanceResponse(
				await callEasyparcel(
					target.country,
					target.isDemo,
					"EPCheckCreditBalance",
					buildCheckBalanceForm(credentials.apiKey),
				),
			);
			await ctx.runMutation(internal.easyparcel.storeBalance, {
				retailerId: target.retailerId,
				balanceMinor: balance.balanceMinor,
				balanceCurrency: balance.currency,
			});
			return {
				ok: true,
				balanceMinor: balance.balanceMinor,
				balanceCurrency: balance.currency,
			};
		} catch (err) {
			return { ok: false, message: friendlyEasyparcelError(err) };
		}
	},
});

export const getBalanceRefreshContext = internalQuery({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		retailerId: Id<"retailers">;
		credentials: EasyparcelCredentials;
		country: Country;
		isDemo: boolean;
	} | null> => {
		const access = await resolveStoreAccess(ctx, retailerId, "read");
		const config = access.retailer.easyparcel as EasyparcelConfig | undefined;
		const credentials = resolveEasyparcelCredentials(config);
		if (!credentials) return null;
		return {
			retailerId: access.retailer._id,
			credentials,
			country: access.retailer.country ?? DEFAULT_COUNTRY,
			isDemo: config?.isDemo === true,
		};
	},
});

export const storeBalance = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		balanceMinor: v.number(),
		balanceCurrency: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const retailer = await ctx.db.get(args.retailerId);
		const config = retailer?.easyparcel as EasyparcelConfig | undefined;
		if (!retailer || !config) return;
		await ctx.db.patch(args.retailerId, {
			easyparcel: {
				...config,
				balanceMinor: args.balanceMinor,
				balanceCurrency: args.balanceCurrency,
				balanceCheckedAt: Date.now(),
			},
			updatedAt: Date.now(),
		});
	},
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type EasyparcelDispatchBlock =
	| "country_unsupported"
	| "not_delivery"
	| "bad_status"
	| "job_active"
	| "not_connected"
	| "disabled"
	| "plan_gated"
	| "no_pickup_address"
	| "no_address";

function dispatchBlockReason(args: {
	order: Doc<"orders">;
	retailer: Doc<"retailers">;
	activeJob: Doc<"deliveryJobs"> | undefined;
	credentials: EasyparcelCredentials | null;
	planOk: boolean;
}): EasyparcelDispatchBlock | null {
	const { order, retailer, activeJob, credentials, planOk } = args;
	const config = retailer.easyparcel as EasyparcelConfig | undefined;
	// Country first — every reason below names a fix; in a country EasyParcel
	// booking doesn't serve there is none to name (the 86eyqgujv lesson).
	if (!courierBookingAllowed("easyparcel", retailer.country ?? DEFAULT_COUNTRY))
		return "country_unsupported";
	if (order.deliveryMethod !== "delivery") return "not_delivery";
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

/** Stored phone → bare digits ("" when there is none). */
function phoneDigits(waPhone: string | undefined): string {
	return (waPhone ?? "").replace(/\D/g, "");
}

/** Same rule as Delyva/Lalamove dispatch (z8r3fdh274): a buyer number from
 * outside the store's country hands the courier the STORE's number, and the
 * buyer's real one leads the parcel content note. */
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
 * pricing uses — the Delyva helper, duplicated rather than exported from
 * there because each provider module stays self-contained (the lib seam is
 * for pure logic, and this one touches ctx.db). */
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

/** Validate a seller-typed weight override (kg) — the Delyva ceiling. */
const WEIGHT_OVERRIDE_MAX_KG = 1_000;

type EasyparcelDispatchContext =
	| {
			ok: false;
			reason: EasyparcelDispatchBlock | "not_found";
			message?: string;
	  }
	| {
			ok: true;
			orderId: Id<"orders">;
			retailerId: Id<"retailers">;
			shortId: string;
			credentials: EasyparcelCredentials;
			country: Country;
			isDemo: boolean;
			pickup: {
				name: string;
				phone: string;
				unit?: string;
				address1: string;
				address2?: string;
				city?: string;
				state?: string;
				postcode: string;
			};
			send: {
				name: string;
				phone: string;
				address1: string;
				address2?: string;
				city?: string;
				state?: string;
				postcode: string;
			};
			/** Label content line ("2× Keropok Lekor, 1× Sambal"), pre-truncated
			 * by the form builder. */
			content: string;
			/** Declared value, MAJOR units string — the order's goods total. */
			declaredValue: string;
			computedWeightKg: number | null;
			weightIssue: "custom_item" | "missing_weights" | null;
			buyerPaidFee: number;
			balanceMinor?: number;
			buyerContactFallback: boolean;
	  };

function resolveWeightKg(
	context: Extract<EasyparcelDispatchContext, { ok: true }>,
	override: number | undefined,
): { ok: true; kg: number } | { ok: false; message: string } {
	if (override !== undefined) {
		if (
			!Number.isFinite(override) ||
			override <= 0 ||
			override > WEIGHT_OVERRIDE_MAX_KG
		) {
			return { ok: false, message: "Enter the packed weight in kg (e.g. 2.5)." };
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

/**
 * Auth + full eligibility + payload assembly for one booking attempt.
 * INTERNAL — resolved credentials ride back to the calling action and must
 * never reach a client (the public surface is getDispatchState below).
 */
export const getDispatchContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<EasyparcelDispatchContext> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, reason: "not_found" };
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return { ok: false, reason: "not_found" };

		// Real role from the gate (86exr91r4): booking is orders work at write
		// level; only a true admin skips the plan gate.
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
		const config = retailer.easyparcel as EasyparcelConfig | undefined;
		const credentials = resolveEasyparcelCredentials(config);

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
		const country = retailer.country ?? DEFAULT_COUNTRY;
		const buyerPhone = phoneDigits(order.customer.waPhone);
		const sellerPhone = phoneDigits(retailer.waPhone);
		const buyerContact = buyerContactPhone(buyerPhone, sellerPhone, country);
		const content = order.items
			.map((i) => `${i.quantity}x ${i.name}`)
			.join(", ");
		const goodsTotal = order.items.reduce(
			(sum, i) => sum + i.price * i.quantity,
			0,
		);
		return {
			ok: true,
			orderId: order._id,
			retailerId: retailer._id,
			shortId: order.shortId,
			credentials,
			country,
			isDemo: config.isDemo === true,
			pickup: {
				name: retailer.storeName,
				phone: sellerPhone,
				unit: config.pickupAddress.unit,
				address1: config.pickupAddress.address1,
				address2: config.pickupAddress.address2,
				city: config.pickupAddress.city,
				state: config.pickupAddress.state,
				postcode: config.pickupAddress.postcode,
			},
			send: {
				name: order.customer.name ?? "Customer",
				phone: buyerContact.phone,
				address1: order.deliveryAddress.line1,
				address2: order.deliveryAddress.line2,
				city: order.deliveryAddress.city,
				state: order.deliveryAddress.state,
				postcode: order.deliveryAddress.postcode,
			},
			content,
			declaredValue: (goodsTotal / 100).toFixed(2),
			computedWeightKg: weight.kind === "ok" ? weight.kg : null,
			weightIssue: weight.kind === "ok" ? null : weight.kind,
			buyerPaidFee: order.deliveryFee ?? 0,
			balanceMinor: config.balanceMinor,
			buyerContactFallback: buyerContact.fallback,
		};
	},
});

/**
 * Step 1 of the two-tap dispatch: rate-check the parcel and hand back the
 * courier service list. An EMPTY list is a normal answer the card must
 * render (no courier covers this shipment).
 */
export const prepareBooking = action({
	args: {
		shortId: v.string(),
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
				/** Prepaid-wallet snapshot (minor units), so the dialog can warn
				 * about an underfunded wallet BEFORE the book tap. */
				balanceMinor?: number;
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
			const credentials = await decryptEasyparcelCredentials(
				context.credentials,
			);
			const rates = parseRateCheckResponse(
				await callEasyparcel(
					context.country,
					context.isDemo,
					"EPRateCheckingBulk",
					buildRateCheckForm({
						apiKey: credentials.apiKey,
						pickup: {
							postcode: context.pickup.postcode,
							state: context.pickup.state,
							country: context.country,
						},
						send: {
							postcode: context.send.postcode,
							state: context.send.state,
							country: context.country,
						},
						weightKg: weight.kg,
					}),
				),
			);
			return {
				ok: true,
				rates,
				weightKg: weight.kg,
				buyerPaidFee: context.buyerPaidFee,
				balanceMinor: context.balanceMinor,
			};
		} catch (err) {
			console.warn("[easyparcel] dispatch quote failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				reason: "quote_failed",
				message: friendlyEasyparcelError(err),
			};
		}
	},
});

/** How long an uncommitted reservation may exist before the sweeper flags it. */
const RESERVATION_EXPIRY_MS = 5 * 60 * 1000;

/** Atomically claim the order's one-active-job slot BEFORE the external POST
 * — counts jobs from EVERY provider, the cross-provider invariant. */
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
		providerOrderId: v.string(),
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
			providerOrderId: args.providerOrderId,
			status: "assigning",
			costActual: args.costActual,
			awb: args.awb,
			labelUrl: args.labelUrl,
			// A commit that lost a race against its own expiry sweep revives the
			// row — the booking DOES exist at EasyParcel either way.
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
 * fill-if-unset, so a seller's own manual entry is never overwritten. The
 * tracking URL prefers EasyParcel's own link (MY responses carry one), then
 * the courier registry; none is an honest absence, never an invented URL. */
async function mirrorAwbOntoOrder(
	ctx: MutationCtx,
	job: Doc<"deliveryJobs">,
	args: { awb: string; courierName: string; trackingUrl?: string },
): Promise<void> {
	const order = await ctx.db.get(job.orderId);
	if (!order) return;
	if (order.trackingNo) return; // seller already recorded a shipment by hand
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
		if (!job || job.providerOrderId !== undefined) return; // committed
		if (job.status !== "assigning") return; // already released
		await ctx.db.patch(jobId, {
			status: "expired",
			failureReason:
				"Booking never confirmed — check your EasyParcel dashboard before rebooking",
			updatedAt: Date.now(),
		});
	},
});

/**
 * Step 2: book the picked service — EPSubmitOrderBulk creates the order,
 * EPPayOrderBulk pays it from the prepaid wallet and returns the AWB + the
 * courier's label PDF. The wallet is pre-checked against the picked price so
 * the common insufficient-credit case refuses BEFORE an unpaid order lands
 * in the seller's EasyParcel dashboard; a pay step that still comes back
 * unpaid releases the reservation with the EasyParcel order number in the
 * message (top up and rebook here, or pay it in EasyParcel — the next status
 * poll can't adopt it, so rebooFking here is the clean path).
 */
export const confirmBooking = action({
	args: {
		shortId: v.string(),
		serviceId: v.string(),
		serviceName: v.string(),
		courierName: v.string(),
		/** The picked rate's price (minor units) — wallet pre-check only; the
		 * charged figure always comes from EasyParcel's own responses. */
		priceMinor: v.number(),
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
				providerOrderId: string;
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

		const credentials = await decryptEasyparcelCredentials(context.credentials);

		// Wallet pre-check — refresh first so the verdict is current, not the
		// connect-time snapshot. Non-fatal when the balance call itself fails
		// (the pay step is the real gate); an insufficient CURRENT balance is a
		// named refusal before anything lands at EasyParcel.
		try {
			const balance = parseCheckBalanceResponse(
				await callEasyparcel(
					context.country,
					context.isDemo,
					"EPCheckCreditBalance",
					buildCheckBalanceForm(credentials.apiKey),
				),
			);
			await ctx.runMutation(internal.easyparcel.storeBalance, {
				retailerId: context.retailerId,
				balanceMinor: balance.balanceMinor,
				balanceCurrency: balance.currency,
			});
			if (balance.balanceMinor < args.priceMinor) {
				return {
					ok: false,
					reason: "booking_failed",
					message: `Your EasyParcel wallet holds ${((balance.balanceMinor ?? 0) / 100).toFixed(2)} but this shipment costs ${(args.priceMinor / 100).toFixed(2)} — top up in EasyParcel, then book again. Nothing was booked.`,
				};
			}
		} catch {
			// fall through — EPPayOrderBulk is the authoritative gate
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

		let orderNumber: string | undefined;
		try {
			const submitted = parseSubmitOrderResponse(
				await callEasyparcel(
					context.country,
					context.isDemo,
					"EPSubmitOrderBulk",
					buildSubmitOrderForm({
						apiKey: credentials.apiKey,
						pickup: { ...context.pickup, country: context.country },
						send: { ...context.send, country: context.country },
						weightKg: weight.kg,
						content: context.content,
						value: context.declaredValue,
						serviceId: args.serviceId,
						reference: context.shortId,
					}),
				),
			);
			orderNumber = submitted.orderNumber;
			const paid = parsePayOrderResponse(
				await callEasyparcel(
					context.country,
					context.isDemo,
					"EPPayOrderBulk",
					buildPayOrderForm({
						apiKey: credentials.apiKey,
						orderNumber: submitted.orderNumber,
					}),
				),
			);
			if (!paid.paid) {
				await ctx.runMutation(internal.easyparcel.releaseReservation, {
					jobId,
					reason: `EasyParcel created order ${submitted.orderNumber} but payment failed (${paid.message}). Top up your EasyParcel wallet and book again here — or cancel ${submitted.orderNumber} in your EasyParcel dashboard.`,
				});
				return {
					ok: false,
					reason: "booking_failed",
					message: `EasyParcel accepted the shipment but your wallet couldn't pay for it (${paid.message}). Top up in EasyParcel, then book again — order ${submitted.orderNumber} sits unpaid in your EasyParcel dashboard and no courier will collect it.`,
				};
			}
			const costActual =
				submitted.priceMinor > 0 ? submitted.priceMinor : args.priceMinor;
			await ctx.runMutation(internal.easyparcel.commitBooking, {
				jobId,
				providerOrderId: submitted.orderNumber,
				costActual,
				courierName: args.courierName,
				awb: paid.awb,
				labelUrl: paid.labelUrl,
				trackingUrl: paid.trackingUrl,
			});
			return {
				ok: true,
				providerOrderId: submitted.orderNumber,
				costActual,
				awb: paid.awb,
				labelUrl: paid.labelUrl,
			};
		} catch (err) {
			console.warn("[easyparcel] booking failed", {
				shortId: args.shortId,
				message: err instanceof Error ? err.message : String(err),
			});
			const message = friendlyEasyparcelError(err);
			await ctx.runMutation(internal.easyparcel.releaseReservation, {
				jobId,
				reason: orderNumber
					? `${message} (EasyParcel order ${orderNumber} may exist unpaid in your dashboard.)`
					: message,
			});
			return { ok: false, reason: "booking_failed", message };
		}
	},
});

/**
 * There is no reliable cancel on this API (the Individual docs document
 * none), so cancellation is honest rather than pretended: the seller cancels
 * the shipment in their EasyParcel dashboard, then marks it cancelled here —
 * which frees the order's booking slot. The card says exactly this.
 */
export const markCancelled = mutation({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<{ ok: boolean; message?: string }> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return { ok: false, message: "Order not found." };
		const access = await requireRetailerAccess(ctx, order.retailerId, {
			area: "orders",
			level: "write",
		});
		// The view-only lock — the Delyva cancelBooking posture.
		if (access.role !== "admin")
			await assertSubscriptionActive(ctx, order.retailerId);
		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const active = jobs.find(
			(j) => j.provider === "easyparcel" && isActiveJobStatus(j.status),
		);
		if (!active) return { ok: false, message: "No active booking to cancel." };
		await ctx.db.patch(active._id, {
			status: "canceled",
			failureReason: "Cancelled by you (in EasyParcel)",
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

// ---------------------------------------------------------------------------
// Status sync — the poll that stands in for a webhook
// ---------------------------------------------------------------------------

/** Order statuses that may auto-advance from a courier event — identical to
 * the Lalamove/Delyva rule: a pending order never ships itself. */
const SHIPPABLE_FROM = new Set(["confirmed", "packed"]);
const DELIVERABLE_FROM = new Set(["confirmed", "packed", "shipped"]);

/** Active easyparcel jobs grouped per retailer, with what one EPParcelStatusBulk
 * call needs. INTERNAL — carries stored (encrypted) credentials. */
export const listActiveJobs = internalQuery({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			retailerId: Id<"retailers">;
			credentials: EasyparcelCredentials;
			country: Country;
			isDemo: boolean;
			jobs: Array<{ jobId: Id<"deliveryJobs">; orderNumber: string }>;
		}>
	> => {
		const active: Doc<"deliveryJobs">[] = [];
		for (const status of ["assigning", "ongoing", "picked_up"] as const) {
			const rows = await ctx.db
				.query("deliveryJobs")
				.withIndex("by_provider_status", (q) =>
					q.eq("provider", "easyparcel").eq("status", status),
				)
				.collect();
			active.push(...rows);
		}
		const byRetailer = new Map<
			Id<"retailers">,
			Array<{ jobId: Id<"deliveryJobs">; orderNumber: string }>
		>();
		for (const job of active) {
			if (!job.providerOrderId) continue; // uncommitted reservation
			const list = byRetailer.get(job.retailerId) ?? [];
			list.push({ jobId: job._id, orderNumber: job.providerOrderId });
			byRetailer.set(job.retailerId, list);
		}
		const out: Array<{
			retailerId: Id<"retailers">;
			credentials: EasyparcelCredentials;
			country: Country;
			isDemo: boolean;
			jobs: Array<{ jobId: Id<"deliveryJobs">; orderNumber: string }>;
		}> = [];
		for (const [retailerId, jobs] of byRetailer) {
			const retailer = await ctx.db.get(retailerId);
			const config = retailer?.easyparcel as EasyparcelConfig | undefined;
			const credentials = resolveEasyparcelCredentials(config);
			if (!retailer || !credentials) continue; // disconnected mid-flight
			out.push({
				retailerId,
				credentials,
				country: retailer.country ?? DEFAULT_COUNTRY,
				isDemo: config?.isDemo === true,
				jobs,
			});
		}
		return out;
	},
});

/** The cron body: one EPParcelStatusBulk per retailer (bulk ≤300 — far above
 * any store's live shipment count), each row applied idempotently. A
 * retailer whose call fails is skipped, never the whole sweep. */
export const syncJobStatuses = internalAction({
	args: {},
	handler: async (ctx): Promise<void> => {
		const groups = await ctx.runQuery(internal.easyparcel.listActiveJobs, {});
		for (const group of groups) {
			try {
				const credentials = await decryptEasyparcelCredentials(
					group.credentials,
				);
				const rows = parseParcelStatusResponse(
					await callEasyparcel(
						group.country,
						group.isDemo,
						"EPParcelStatusBulk",
						buildParcelStatusForm({
							apiKey: credentials.apiKey,
							orderNumbers: group.jobs.map((j) => j.orderNumber),
						}),
					),
				);
				const byOrderNumber = new Map(rows.map((r) => [r.orderNumber, r]));
				for (const job of group.jobs) {
					const row = byOrderNumber.get(job.orderNumber);
					if (!row) continue;
					await ctx.runMutation(internal.easyparcel.applyStatusSync, {
						jobId: job.jobId,
						shipStatus: row.shipStatus,
						awb: row.awb,
						labelUrl: row.labelUrl,
						syncedAt: Date.now(),
					});
				}
			} catch (err) {
				console.warn("[easyparcel] status sweep failed for retailer", {
					retailerId: group.retailerId,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}
	},
});

/**
 * Apply one polled status row — the applyWebhookEvent contract: idempotent,
 * job follows provider truth, ORDER never regresses. `syncedAt` plays the
 * webhook's event-time role in `lastEventAt` (polls are self-ordered).
 */
export const applyStatusSync = internalMutation({
	args: {
		jobId: v.id("deliveryJobs"),
		shipStatus: v.optional(v.string()),
		awb: v.optional(v.string()),
		labelUrl: v.optional(v.string()),
		syncedAt: v.number(),
	},
	handler: async (ctx, { jobId, shipStatus, awb, labelUrl, syncedAt }) => {
		const job = await ctx.db.get(jobId);
		if (!job || job.provider !== "easyparcel") return;
		const now = Date.now();

		// AWB/label fill in whenever first seen — gap-filling writes, the
		// Delyva consignment posture.
		if (awb && !job.awb) {
			await ctx.db.patch(jobId, { awb, updatedAt: now });
			await mirrorAwbOntoOrder(ctx, job, {
				awb,
				courierName: job.serviceName ?? "EasyParcel",
			});
		}
		if (labelUrl && !job.labelUrl) {
			await ctx.db.patch(jobId, { labelUrl, updatedAt: now });
		}

		const status = normalizeEasyparcelShipStatus(shipStatus);
		if (!status) {
			// "On Hold" / unknown vocabulary: informational, surfaced without
			// moving the job (their status list can grow).
			if (shipStatus && /on hold/i.test(shipStatus) && isActiveJobStatus(job.status)) {
				await ctx.db.patch(jobId, {
					failureReason: "EasyParcel reports the parcel on hold — check your EasyParcel dashboard",
					lastEventAt: syncedAt,
					updatedAt: now,
				});
			}
			return;
		}

		if (status !== job.status) {
			const enteringFailure =
				(status === "canceled" || status === "rejected" || status === "expired") &&
				isActiveJobStatus(job.status);
			const sellerCancelled =
				job.status === "canceled" &&
				job.failureReason === "Cancelled by you (in EasyParcel)";
			if (!sellerCancelled) {
				await ctx.db.patch(jobId, {
					status,
					...(isActiveJobStatus(status) ? { failureReason: undefined } : {}),
					lastEventAt: syncedAt,
					updatedAt: now,
					...(status === "rejected"
						? { failureReason: shipStatus ?? "The parcel was returned" }
						: status === "canceled"
							? { failureReason: shipStatus ?? "Cancelled by EasyParcel" }
							: status === "expired"
								? { failureReason: "The unpaid order expired at EasyParcel" }
								: {}),
				});
				if (enteringFailure) {
					await ctx.scheduler.runAfter(0, internal.email.notifyDeliveryJobFailed, {
						orderId: job.orderId,
						reason:
							status === "rejected"
								? "The courier returned the parcel. Check your EasyParcel dashboard."
								: status === "expired"
									? "The EasyParcel order expired unpaid."
									: "The EasyParcel booking was cancelled.",
						provider: "easyparcel",
					});
				}
			}
		} else {
			await ctx.db.patch(jobId, { lastEventAt: syncedAt, updatedAt: now });
		}

		// Order auto-transitions ride order-status guards, so repeated polls are
		// naturally idempotent here too.
		const order = await ctx.db.get(job.orderId);
		if (!order || order.status === "cancelled") return;
		const effectiveAwb = job.awb ?? awb;
		if (status === "picked_up" && SHIPPABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "shipped", {
				courierName: order.courierName ?? job.serviceName ?? "EasyParcel",
				trackingNo: order.trackingNo ?? effectiveAwb,
				carrierTrackingUrl: order.carrierTrackingUrl,
			});
		} else if (status === "completed" && DELIVERABLE_FROM.has(order.status)) {
			await applyStatusTransition(ctx, order, "delivered");
		}
	},
});

/** Card action: poll THIS order's status now instead of waiting for the cron
 * (the "Refresh status" button — a poll-based provider owes the seller a way
 * to not wait 30 minutes). */
export const refreshJobStatus = action({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<{ ok: boolean; message?: string }> => {
		const target = await ctx.runQuery(internal.easyparcel.getRefreshContext, {
			shortId,
		});
		if (!target) return { ok: false, message: "No EasyParcel booking to refresh." };
		try {
			const credentials = await decryptEasyparcelCredentials(
				target.credentials,
			);
			const rows = parseParcelStatusResponse(
				await callEasyparcel(
					target.country,
					target.isDemo,
					"EPParcelStatusBulk",
					buildParcelStatusForm({
						apiKey: credentials.apiKey,
						orderNumbers: [target.orderNumber],
					}),
				),
			);
			const row = rows.find((r) => r.orderNumber === target.orderNumber);
			if (row) {
				await ctx.runMutation(internal.easyparcel.applyStatusSync, {
					jobId: target.jobId,
					shipStatus: row.shipStatus,
					awb: row.awb,
					labelUrl: row.labelUrl,
					syncedAt: Date.now(),
				});
			}
			return { ok: true };
		} catch (err) {
			return { ok: false, message: friendlyEasyparcelError(err) };
		}
	},
});

export const getRefreshContext = internalQuery({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		jobId: Id<"deliveryJobs">;
		orderNumber: string;
		credentials: EasyparcelCredentials;
		country: Country;
		isDemo: boolean;
	} | null> => {
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
		if (!target || !target.providerOrderId) return null;
		const retailer = await ctx.db.get(order.retailerId);
		const config = retailer?.easyparcel as EasyparcelConfig | undefined;
		const credentials = resolveEasyparcelCredentials(config);
		if (!retailer || !credentials) return null;
		return {
			jobId: target._id,
			orderNumber: target.providerOrderId,
			credentials,
			country: retailer.country ?? DEFAULT_COUNTRY,
			isDemo: config?.isDemo === true,
		};
	},
});

// ---------------------------------------------------------------------------
// Order-detail card read
// ---------------------------------------------------------------------------

/** Public job shape for the order-detail card — no credentials, no secrets. */
export type EasyparcelJobView = {
	status: Doc<"deliveryJobs">["status"];
	providerOrderId?: string;
	costActual: number;
	serviceId: string;
	serviceName?: string;
	awb?: string;
	labelUrl?: string;
	failureReason?: string;
	createdAt: number;
	lastEventAt?: number;
};

/**
 * Order-detail read: the latest EasyParcel booking (active or most recent
 * attempt) plus WHY booking is currently unavailable (null = button live),
 * plus what the quote dialog needs to open.
 */
export const getDispatchState = query({
	args: { shortId: v.string() },
	handler: async (
		ctx,
		{ shortId },
	): Promise<{
		job: EasyparcelJobView | null;
		blockReason: EasyparcelDispatchBlock | null;
		/** The store has a working, enabled EasyParcel connection. */
		bookingEnabled: boolean;
		country: Country;
		/** A booking would hand the courier the STORE's number for the buyer's
		 * stop (foreign buyer number) — said before the first quote. */
		buyerContactFallback: boolean;
		/** One-line render of the stored pickup address, caught at the moment
		 * it matters. */
		pickupSummary?: string;
		/** Demo host (z8r3fdcje2): a booking spends play money and dispatches
		 * no courier — said at the point of spend (86eypncfy posture). */
		isDemo?: boolean;
		/** Prepaid wallet snapshot for the card's balance line. */
		balanceMinor?: number;
		balanceCurrency?: string;
		computedWeightKg: number | null;
		weightIssue: "custom_item" | "missing_weights" | null;
	} | null> => {
		const order = await resolveSharedOrder(ctx, { shortId });
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer) return null;
		const config = retailer.easyparcel as EasyparcelConfig | undefined;
		const credentials = resolveEasyparcelCredentials(config);

		const jobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		const activeJob = jobs.find((j) => isActiveJobStatus(j.status));
		const easyparcelJobs = jobs.filter((j) => j.provider === "easyparcel");
		const latest =
			(activeJob?.provider === "easyparcel" ? activeJob : undefined) ??
			[...easyparcelJobs].sort((a, b) => b.createdAt - a.createdAt)[0] ??
			null;

		// Real role from the gate (86exr91r4) — read level here; booking itself
		// re-gates at write. Only a true admin skips the plan gate.
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
			credentials,
			planOk,
		});
		const weight = await resolveOrderWeightKg(ctx, order);
		const country = retailer.country ?? DEFAULT_COUNTRY;
		return {
			job: latest
				? {
						status: latest.status,
						providerOrderId: latest.providerOrderId,
						costActual: latest.costActual,
						serviceId: latest.quotationId ?? "",
						serviceName: latest.serviceName,
						awb: latest.awb,
						labelUrl: latest.labelUrl,
						failureReason: latest.failureReason,
						createdAt: latest.createdAt,
						lastEventAt: latest.lastEventAt,
					}
				: null,
			blockReason,
			bookingEnabled: easyparcelBookingArmed(retailer),
			country,
			buyerContactFallback: buyerContactPhone(
				phoneDigits(order.customer.waPhone),
				phoneDigits(retailer.waPhone),
				country,
			).fallback,
			pickupSummary: config?.pickupAddress
				? [
						[config.pickupAddress.unit, config.pickupAddress.address1]
							.filter(Boolean)
							.join(" "),
						`${config.pickupAddress.postcode}${config.pickupAddress.city ? ` ${config.pickupAddress.city}` : ""}`,
					].join(", ")
				: undefined,
			isDemo: config?.isDemo,
			balanceMinor: config?.balanceMinor,
			balanceCurrency: config?.balanceCurrency,
			computedWeightKg: weight.kind === "ok" ? weight.kg : null,
			weightIssue: weight.kind === "ok" ? null : weight.kind,
		};
	},
});
