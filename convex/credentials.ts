/**
 * Credential encryption plumbing (86eyn25gk) — see convex/lib/credentialCrypto.ts
 * for the envelope format and docs/credential-encryption.md for the runbook.
 *
 * Encryption runs in ACTIONS (crypto.subtle is proven there; mutations never
 * touch it): `retailers.updateSettings` stores what it was given and schedules
 * `encryptRetailerCredentials`, which reads the row, encrypts any plaintext
 * credential, and writes ciphertext back through a COMPARE-AND-SWAP mutation —
 * a save racing in between wins (its own scheduled encryption re-runs), so a
 * newer key is never clobbered by an older ciphertext.
 *
 * The scheduled call carries only the retailerId — never a secret — because
 * scheduled-function arguments persist in the system tables until (and after)
 * execution. Plaintext crosses only direct runQuery/runMutation boundaries,
 * the same in-memory path `updateSettings` already receives it on.
 *
 * One-shot backfill for pre-existing rows (run per deployment AFTER setting
 * CREDENTIALS_ENCRYPTION_KEY):
 *
 *   npx convex run credentials:encryptExistingCredentials
 *
 * Idempotent — already-encrypted fields are skipped; legacy rows also get
 * their `apiKeyHint`/`mode` stamped, since queries can't derive either from
 * ciphertext.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { encryptSecret, isEncrypted } from "./lib/credentialCrypto";
import { inferHitpayMode } from "./lib/hitpay";

export const getCredentialFields = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return {
			lalamoveApiKey: retailer.deliveryBooking?.apiKey,
			lalamoveApiSecret: retailer.deliveryBooking?.apiSecret,
			hitpayApiKey: retailer.hitpay?.apiKey,
			hitpaySalt: retailer.hitpay?.salt,
		};
	},
});

const encryptedFieldValidator = v.object({
	target: v.union(
		v.literal("lalamove.apiKey"),
		v.literal("lalamove.apiSecret"),
		v.literal("hitpay.apiKey"),
		v.literal("hitpay.salt"),
	),
	/** The exact plaintext the action read — the compare-and-swap guard. */
	expected: v.string(),
	encrypted: v.string(),
	/** Stamped alongside an apiKey so legacy rows keep their settings-card
	 * hint/badge once the plaintext is gone. */
	apiKeyHint: v.optional(v.string()),
	mode: v.optional(v.union(v.literal("sandbox"), v.literal("production"))),
});

export const storeEncryptedCredentials = internalMutation({
	args: {
		retailerId: v.id("retailers"),
		fields: v.array(encryptedFieldValidator),
	},
	handler: async (ctx, { retailerId, fields }): Promise<void> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return;
		let booking = retailer.deliveryBooking;
		let hitpay = retailer.hitpay;
		let bookingChanged = false;
		let hitpayChanged = false;
		for (const f of fields) {
			// Only replace the exact plaintext the action read. A save that raced
			// in between differs, so it wins here and its own scheduled encryption
			// covers the new value.
			switch (f.target) {
				case "lalamove.apiKey":
					if (booking && booking.apiKey === f.expected) {
						booking = {
							...booking,
							apiKey: f.encrypted,
							...(f.apiKeyHint ? { apiKeyHint: f.apiKeyHint } : {}),
						};
						bookingChanged = true;
					}
					break;
				case "lalamove.apiSecret":
					if (booking && booking.apiSecret === f.expected) {
						booking = { ...booking, apiSecret: f.encrypted };
						bookingChanged = true;
					}
					break;
				case "hitpay.apiKey":
					if (hitpay && hitpay.apiKey === f.expected) {
						hitpay = {
							...hitpay,
							apiKey: f.encrypted,
							...(f.apiKeyHint ? { apiKeyHint: f.apiKeyHint } : {}),
							...(f.mode ? { mode: f.mode } : {}),
						};
						hitpayChanged = true;
					}
					break;
				case "hitpay.salt":
					if (hitpay && hitpay.salt === f.expected) {
						hitpay = { ...hitpay, salt: f.encrypted };
						hitpayChanged = true;
					}
					break;
			}
		}
		if (bookingChanged || hitpayChanged) {
			await ctx.db.patch(retailerId, {
				...(bookingChanged ? { deliveryBooking: booking } : {}),
				...(hitpayChanged ? { hitpay } : {}),
			});
		}
	},
});

type EncryptedField = {
	target:
		| "lalamove.apiKey"
		| "lalamove.apiSecret"
		| "hitpay.apiKey"
		| "hitpay.salt";
	expected: string;
	encrypted: string;
	apiKeyHint?: string;
	mode?: "sandbox" | "production";
};

/** Encrypt one retailer's stored plaintext credentials in place. Returns the
 * number of fields rewritten (0 when everything is already encrypted or the
 * env key is unset — encryptSecret passthrough). */
async function encryptOne(
	ctx: ActionCtx,
	retailerId: Id<"retailers">,
): Promise<number> {
	const stored = await ctx.runQuery(internal.credentials.getCredentialFields, {
		retailerId,
	});
	if (!stored) return 0;
	const fields: EncryptedField[] = [];
	const add = async (
		target: EncryptedField["target"],
		value: string | undefined,
		extras: Pick<EncryptedField, "apiKeyHint" | "mode"> = {},
	): Promise<void> => {
		if (!value || isEncrypted(value)) return;
		const encrypted = await encryptSecret(value);
		if (encrypted === value) return; // env key unset — plaintext era, no-op
		fields.push({ target, expected: value, encrypted, ...extras });
	};
	await add(
		"lalamove.apiKey",
		stored.lalamoveApiKey,
		stored.lalamoveApiKey
			? { apiKeyHint: stored.lalamoveApiKey.slice(-4) }
			: {},
	);
	await add("lalamove.apiSecret", stored.lalamoveApiSecret);
	await add(
		"hitpay.apiKey",
		stored.hitpayApiKey,
		stored.hitpayApiKey
			? {
					apiKeyHint: stored.hitpayApiKey.slice(-4),
					mode: inferHitpayMode(stored.hitpayApiKey),
				}
			: {},
	);
	await add("hitpay.salt", stored.hitpaySalt);
	if (fields.length > 0) {
		await ctx.runMutation(internal.credentials.storeEncryptedCredentials, {
			retailerId,
			fields,
		});
	}
	return fields.length;
}

/** Scheduled by retailers.updateSettings right after a save stores a
 * plaintext credential. Args carry only the id — see the module header. */
export const encryptRetailerCredentials = internalAction({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		await encryptOne(ctx, retailerId);
	},
});

export const listRetailerIdsPage = internalQuery({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("retailers")
			.paginate({ numItems: 25, cursor: cursor ?? null });
		return {
			ids: page.page.map((r) => r._id),
			continueCursor: page.continueCursor,
			isDone: page.isDone,
		};
	},
});

/** One-shot per deployment: `npx convex run credentials:encryptExistingCredentials`
 * (AFTER `npx convex env set CREDENTIALS_ENCRYPTION_KEY …`). Idempotent;
 * self-schedules the next page, house backfill style. */
export const encryptExistingCredentials = internalAction({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }): Promise<void> => {
		if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
			console.warn(
				"[credentials] backfill skipped — CREDENTIALS_ENCRYPTION_KEY is not set on this deployment",
			);
			return;
		}
		const page = await ctx.runQuery(internal.credentials.listRetailerIdsPage, {
			cursor,
		});
		let fieldsEncrypted = 0;
		for (const id of page.ids) {
			fieldsEncrypted += await encryptOne(ctx, id);
		}
		console.log("[credentials] encrypt backfill page", {
			retailers: page.ids.length,
			fieldsEncrypted,
			isDone: page.isDone,
		});
		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.credentials.encryptExistingCredentials,
				{ cursor: page.continueCursor },
			);
		}
	},
});
