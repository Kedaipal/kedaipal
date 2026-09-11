// THROWAWAY dev helper (V2 webhook verification round 2) — NEVER COMMIT.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { HITPAY_API_BASE } from "./lib/hitpay";
import {
	buildAutoRenewSessionParams,
	resolveBillingGatewayCredentials,
} from "./lib/hitpayBilling";

export const mintFor = internalAction({
	args: { slug: v.string(), currency: v.optional(v.string()) },
	handler: async (ctx, { slug, currency }): Promise<unknown> => {
		const creds = resolveBillingGatewayCredentials({
			HITPAY_BILLING_API_KEY: process.env.HITPAY_BILLING_API_KEY,
			HITPAY_BILLING_SALT: process.env.HITPAY_BILLING_SALT,
			HITPAY_BILLING_WEBHOOK_SALT: process.env.HITPAY_BILLING_WEBHOOK_SALT,
		});
		if (!creds) return { error: "no creds" };
		const c: {
			subscriptionId: string;
			storeName: string;
			email: string;
			currency: "MYR" | "SGD";
		} = await ctx.runQuery(internal.devWebhookTest.ctxFor, { slug });
		const params = buildAutoRenewSessionParams({
			planLabel: "Pro",
			storeName: c.storeName,
			description: "Auto-renewal setup — nothing is charged today; renewals bill automatically",
			customerEmail: c.email,
			customerName: c.storeName,
			amountSen: 14900,
			currency: (currency as "MYR" | "SGD") ?? c.currency,
			redirectUrl: `${process.env.SITE_URL}/app/settings?tab=billing&autorenew=return`,
			reference: c.subscriptionId,
			paymentMethods: undefined,
		});
		const res = await fetch(`${HITPAY_API_BASE[creds.mode]}/recurring-billing`, {
			method: "POST",
			headers: {
				"X-BUSINESS-API-KEY": creds.apiKey,
				"Content-Type": "application/x-www-form-urlencoded",
				"X-Requested-With": "XMLHttpRequest",
			},
			body: params.toString(),
		});
		const body = (await res.json()) as { id?: string; url?: string; payment_methods?: string[] };
		if (!res.ok || !body.id || !body.url) return { status: res.status, body };
		await ctx.runMutation(internal.subscriptionPayments.recordAutoRenewSession, {
			subscriptionId: c.subscriptionId as never,
			sessionId: body.id,
			url: body.url,
		});
		return { sessionId: body.id, url: body.url, methods: body.payment_methods ?? null };
	},
});

import { internalQuery } from "./_generated/server";
import { BILLING_CURRENCY_FOR_COUNTRY } from "./lib/plans";

export const ctxFor = internalQuery({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("no retailer");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (!sub) throw new Error("no sub");
		return {
			subscriptionId: sub._id,
			storeName: r.storeName,
			email: r.notifyEmail ?? "dev@kedaipal.com",
			currency: BILLING_CURRENCY_FOR_COUNTRY[r.country ?? "MY"],
		};
	},
});
