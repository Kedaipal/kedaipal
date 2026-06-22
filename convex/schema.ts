import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Multi-tenant core. Every order/inventory entity that lands later MUST carry
 * a `channel` field so future marketplace connectors (Shopee, Lazada, TikTok
 * Shop, StoreHub) slot in without schema rewrites.
 */
export default defineSchema({
	retailers: defineTable({
		userId: v.string(), // Clerk subject (sub claim)
		slug: v.string(),
		storeName: v.string(),
		waPhone: v.optional(v.string()),
		// Email address for retailer-facing operational notifications
		// (new orders, payment claims, etc.). Independent of the Clerk auth
		// email so retailers can route alerts to a shared ops inbox.
		// When unset, the retailer simply receives no email notifications —
		// behaviour mirrors the WhatsApp waPhone field above.
		notifyEmail: v.optional(v.string()),
		// Convex storage ID for the store's logo. Public — surfaced on the
		// storefront header, dashboard hero, and as the OG image fallback.
		logoStorageId: v.optional(v.string()),
		currency: v.optional(v.string()),
		locale: v.optional(v.union(v.literal("en"), v.literal("ms"))),
		// Per-retailer overrides for WhatsApp message copy. Any key omitted falls
		// back to the default catalog in convex/lib/whatsappCopy.ts.
		// Variables supported in templates: {shortId}, {storeName}.
		messageTemplates: v.optional(
			v.object({
				en: v.optional(
					v.object({
						confirm: v.optional(v.string()),
						packed: v.optional(v.string()),
						shipped: v.optional(v.string()),
						delivered: v.optional(v.string()),
						cancelled: v.optional(v.string()),
						unknownFallback: v.optional(v.string()),
					}),
				),
				ms: v.optional(
					v.object({
						confirm: v.optional(v.string()),
						packed: v.optional(v.string()),
						shipped: v.optional(v.string()),
						delivered: v.optional(v.string()),
						cancelled: v.optional(v.string()),
						unknownFallback: v.optional(v.string()),
					}),
				),
			}),
		),
		// Per-retailer overrides for the SHORT status labels shown on the buyer
		// tracking-page timeline/pills + the seller dashboard (badges, tabs,
		// transition buttons). Distinct from `messageTemplates` above, which is
		// the full WhatsApp message body. Any key omitted (or blank after trim)
		// falls back to the delivery-method preset, then the base default —
		// resolved at render time in convex/lib/orderStatus.ts. Phase 1 of
		// per-retailer status customization; presentation only, the canonical
		// `orders.status` union is untouched. See
		// docs/order-status-customization.md.
		statusLabels: v.optional(
			v.object({
				en: v.optional(
					v.object({
						pending: v.optional(v.string()),
						confirmed: v.optional(v.string()),
						packed: v.optional(v.string()),
						shipped: v.optional(v.string()),
						delivered: v.optional(v.string()),
						cancelled: v.optional(v.string()),
					}),
				),
				ms: v.optional(
					v.object({
						pending: v.optional(v.string()),
						confirmed: v.optional(v.string()),
						packed: v.optional(v.string()),
						shipped: v.optional(v.string()),
						delivered: v.optional(v.string()),
						cancelled: v.optional(v.string()),
					}),
				),
			}),
		),
		// Phase 2 of order-status customization: a seller-defined, ordered list of
		// buyer-visible stages (cap 20), each pinned to ONE canonical anchor
		// (confirmed/packed/shipped/delivered). `orders.currentStageId` points at
		// the seller's stage; the canonical `orders.status` is DERIVED from the
		// stage's anchor. Absent => the resolver synthesizes the 5 default stages
		// from `statusLabels` (so an un-configured retailer flows through the SAME
		// stage code path). pending/cancelled are system-managed, never stages.
		// Bounded (≤20) so it's safe to embed. See docs/order-status-customization.md.
		orderStages: v.optional(
			v.array(
				v.object({
					id: v.string(),
					anchor: v.union(
						v.literal("confirmed"),
						v.literal("packed"),
						v.literal("shipped"),
						v.literal("delivered"),
					),
					label: v.object({ en: v.string(), ms: v.optional(v.string()) }),
					description: v.optional(
						v.object({
							en: v.optional(v.string()),
							ms: v.optional(v.string()),
						}),
					),
					notify: v.boolean(),
					sortOrder: v.number(),
				}),
			),
		),
		// DEPRECATED — superseded by `paymentMethods` (multi-method). Kept readable
		// during the widen→backfill→narrow migration so un-migrated rows still
		// surface payment details; `resolvePaymentMethods` (convex/lib/payment.ts)
		// synthesizes methods from it. Dropped in a later narrow migration.
		paymentInstructions: v.optional(
			v.object({
				bankName: v.optional(v.string()),
				bankAccountName: v.optional(v.string()),
				bankAccountNumber: v.optional(v.string()),
				qrImageStorageId: v.optional(v.string()),
				note: v.optional(v.string()),
			}),
		),
		// Multiple payment methods surfaced to the shopper in the WA confirm reply
		// + tracking page. Each is a `bank` (account details) or a `qr` (uploaded
		// image), with a label and sort order. Established sellers run several
		// banks/QRs; this replaces the single `paymentInstructions` object above.
		paymentMethods: v.optional(
			v.array(
				v.object({
					type: v.union(v.literal("bank"), v.literal("qr")),
					label: v.string(),
					bankName: v.optional(v.string()),
					bankAccountName: v.optional(v.string()),
					bankAccountNumber: v.optional(v.string()),
					qrImageStorageId: v.optional(v.string()),
					note: v.optional(v.string()),
					sortOrder: v.number(),
				}),
			),
		),
		// Legal consent tracking. Versions are ISO dates mirrored from
		// convex/lib/legal.ts; *AcceptedAt is the epoch-ms acceptance time;
		// acceptanceIp is a best-effort client IP captured at acceptance for
		// legal defensibility. Stamped at onboarding (createRetailer) and on
		// re-acceptance (recordConsentAcceptance).
		termsAcceptedAt: v.optional(v.number()),
		termsVersion: v.optional(v.string()),
		privacyAcceptedAt: v.optional(v.number()),
		privacyVersion: v.optional(v.string()),
		aupAcceptedAt: v.optional(v.number()),
		aupVersion: v.optional(v.string()),
		acceptanceIp: v.optional(v.string()),
		// Retailer opt-in for offering self-collect at checkout. Storefront only
		// surfaces the self-collect option when this is true AND the retailer has
		// at least one active pickup location. New retailers default to true
		// (set in createRetailer) so the Pickup checklist step is discoverable
		// during onboarding; pre-existing rows stay undefined (treated as false).
		offerSelfCollect: v.optional(v.boolean()),
		// Set to true the first time the retailer opens the Pickup settings tab.
		// Used by the dashboard checklist to mark step 4 done after a single
		// visit, even if the retailer chose to skip self-collect — keeps the
		// onboarding flow from nagging an uninterested seller.
		pickupSetupSeen: v.optional(v.boolean()),
		// Onboarding checklist: marks the optional "WhatsApp Business greeting
		// message" setup step as done (or skipped). Persisted so the step stays
		// collapsed across sessions and the setup checklist can reach all-done.
		onboardingGreetingSetup: v.optional(v.boolean()),
		// Founding Member denormalized flags (fast storefront reads). Set once when
		// the retailer's first Pro invoice is marked paid (rank ≤ 10); never revert,
		// even on cancellation/refund. Source of truth is the `foundingMembers`
		// ledger. See docs/manual-subscription.md.
		isFoundingMember: v.optional(v.boolean()),
		foundingMemberRank: v.optional(v.number()),
		channel: v.literal("whatsapp"),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_slug", ["slug"])
		// Admin "onboard a client" pre-check: is a store already registered to this
		// email? notifyEmail is stored normalized (trim + lowercase via
		// assertValidEmail), so an equality lookup is exact. See docs/vendor-identity.md.
		.index("by_notify_email", ["notifyEmail"]),

	slugHistory: defineTable({
		oldSlug: v.string(),
		retailerId: v.id("retailers"),
		expiresAt: v.number(),
	}).index("by_old_slug", ["oldSlug"]),

	products: defineTable({
		retailerId: v.id("retailers"),
		// DEPRECATED — moved to productVariants. Kept optional during the
		// flat→variant migration (widen-migrate-narrow) so pre-variant rows keep
		// validating. SKU uniqueness now lives on the variant. Dropped in the
		// separate narrow migration. See docs/product-variants.md §5.
		sku: v.optional(v.string()),
		name: v.string(),
		// Product-level rich text rendered as sanitized markdown on the storefront
		// (specs + "what's included"). NOT the home for store-wide FAQ.
		description: v.optional(v.string()),
		// DEPRECATED — moved to productVariants.price/.onHand. Optional during
		// migration; new variant-first products omit them. Reads go through
		// productVariants. Dropped in the narrow migration.
		price: v.optional(v.number()),
		currency: v.string(),
		stock: v.optional(v.number()),
		imageStorageIds: v.array(v.string()),
		active: v.boolean(),
		// Option axes this product varies along, ordered (drives picker order).
		// Empty array (or undefined on pre-migration rows) = no axes → exactly
		// one implicit variant with optionValues:[]. Capped at 2 axes. Bounded,
		// so safe to embed (not an unbounded list).
		options: v.optional(
			v.array(
				v.object({
					name: v.string(),
					values: v.array(v.string()),
				}),
			),
		),
		// DEPRECATED — moved to productVariants (per-variant). Kept as a read
		// fallback for variants that haven't been backfilled. See proof-approval.md
		// + product-variants.md §5/§7.
		blockWhenOutOfStock: v.optional(v.boolean()),
		// DEPRECATED — moved to productVariants.requiresProof (per-variant).
		requiresProof: v.optional(v.boolean()),
		channel: v.union(v.literal("whatsapp")),
		sortOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_retailer_active", ["retailerId", "active"])
		.index("by_retailer_sku", ["retailerId", "sku"]),

	/**
	 * First-class sellable unit. Every product resolves to ≥1 variant — a
	 * product with no option axes gets exactly one implicit variant
	 * (optionValues: []). There is no separate "simple product" code path.
	 * `optionValues` is positionally aligned with the parent `products.options`.
	 * Frozen onto orders via `orders.items[].variantLabel`. See
	 * docs/product-variants.md §5.
	 */
	productVariants: defineTable({
		productId: v.id("products"),
		// Denormalized so the per-retailer SKU uniqueness index can live here.
		retailerId: v.id("retailers"),
		// Positionally aligned with product.options; [] for the implicit default.
		optionValues: v.array(v.string()),
		sku: v.optional(v.string()),
		price: v.number(),
		onHand: v.number(),
		// Reserved-but-not-yet-sold count. Stays 0 until HitPay reservation/hold
		// lands — forward-wired now so no later migration. See §9.
		reserved: v.number(),
		// Parcel weight in grams, feeds weight-band delivery (separate task).
		// 0 = unset (backfilled/legacy variants read as weightless until edited).
		parcelWeightG: v.number(),
		imageStorageIds: v.array(v.string()),
		active: v.boolean(),
		// Per-variant overrides of the (now-deprecated) product-level flags, so a
		// product can mix stock-tracked sizes with a made-to-order "Custom" size,
		// or gate only one variant on mockup approval. Reads prefer the variant
		// value and fall back to the product-level flag for un-backfilled rows.
		// `true` = hard stock block; undefined/false = made-to-order.
		blockWhenOutOfStock: v.optional(v.boolean()),
		// `true` = an order containing THIS variant is mockup-gated.
		requiresProof: v.optional(v.boolean()),
		// Custom / made-to-order line: a single per-product variant that lives
		// OUTSIDE the option-axis cartesian. `optionValues` is [] (like a no-axes
		// default — disambiguated from it by this flag, never by optionValues), and
		// it always behaves as made-to-order + mockup-gated (blockWhenOutOfStock
		// false, requiresProof true). Lets a product offer "S/M/L … plus a bespoke
		// custom order" without multiplying "Custom" across every size. See
		// docs/custom-option.md.
		isCustom: v.optional(v.boolean()),
		// Buyer-facing name for the custom line (default "Custom"). Only meaningful
		// when isCustom is true.
		customLabel: v.optional(v.string()),
		// Optional prompt shown to the buyer when they pick the custom line, telling
		// them what to specify ("Tell us your design, flavour & date"). isCustom only.
		customPrompt: v.optional(v.string()),
		sortOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_product", ["productId"])
		.index("by_retailer_sku", ["retailerId", "sku"]),

	/**
	 * First-class customer entity, keyed by (retailerId, waPhone). Aggregates
	 * are denormalized and refreshed on order create/cancel so the dashboard
	 * list/detail views never scan the orders table to compute lifetime value.
	 */
	customers: defineTable({
		retailerId: v.id("retailers"),
		waPhone: v.string(),
		// Retailer-edited override — source of truth for the display name.
		name: v.optional(v.string()),
		// Raw pushname from the WhatsApp webhook, auto-refreshed on inbound
		// messages. Never overwrites the retailer-edited `name`.
		waProfileName: v.optional(v.string()),
		// Retailer-private notes (e.g. "allergic to nuts"). Never exposed to shoppers.
		notes: v.optional(v.string()),
		// Lowercase haystack (name + pushname + phone) powering full-text search.
		// Rebuilt whenever any of those fields change.
		searchText: v.string(),
		// Denormalized aggregates — refreshed on order create/cancel.
		orderCount: v.number(),
		totalSpent: v.number(),
		firstOrderAt: v.number(),
		lastOrderAt: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_retailer_phone", ["retailerId", "waPhone"])
		.index("by_retailer_lastOrder", ["retailerId", "lastOrderAt"])
		.index("by_retailer_ltv", ["retailerId", "totalSpent"])
		.index("by_retailer_orderCount", ["retailerId", "orderCount"])
		.searchIndex("search_customers", {
			searchField: "searchText",
			filterFields: ["retailerId"],
		}),

	orders: defineTable({
		retailerId: v.id("retailers"),
		shortId: v.string(),
		// Link to the aggregated customer record. Optional during backfill and
		// for orders that arrive without a phone (link-in-bio checkout); stamped
		// once the (retailerId, waPhone) pair is known.
		customerId: v.optional(v.id("customers")),
		items: v.array(
			v.object({
				productId: v.id("products"),
				// The sellable unit ordered. Optional only for historical orders
				// created before variants existed; new orders always set it.
				variantId: v.optional(v.id("productVariants")),
				name: v.string(),
				// Human label of the chosen option values ("1kg / Fillet"). Empty
				// for single-variant products. Frozen at order-create time.
				variantLabel: v.optional(v.string()),
				price: v.number(),
				quantity: v.number(),
			}),
		),
		subtotal: v.number(),
		total: v.number(),
		currency: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("confirmed"),
			v.literal("packed"),
			v.literal("shipped"),
			v.literal("delivered"),
			v.literal("cancelled"),
		),
		// Phase 2: the seller-defined stage this order currently sits at (id from
		// retailers.orderStages, or a synthesized "default:<anchor>" id). The
		// canonical `status` above stays the source of truth for all gates and is
		// derived from this stage's anchor on each advance. Optional: orders that
		// predate stages (or never advanced) derive their stage from `status` at
		// read time — no backfill required. See docs/order-status-customization.md.
		currentStageId: v.optional(v.string()),
		channel: v.union(v.literal("whatsapp")),
		customer: v.object({
			name: v.optional(v.string()),
			waPhone: v.optional(v.string()),
		}),
		// How the customer receives the order. "delivery" = shipped via carrier;
		// "self_collect" = customer picks up from the store. Defaults to "delivery"
		// for orders created before this field existed.
		deliveryMethod: v.optional(
			v.union(v.literal("delivery"), v.literal("self_collect")),
		),
		// Structured shipping address. Required when deliveryMethod === "delivery"
		// and forbidden when "self_collect" — invariant enforced in orders.create.
		// Validated/sanitized server-side via convex/lib/address.ts.
		deliveryAddress: v.optional(
			v.object({
				line1: v.string(),
				line2: v.optional(v.string()),
				city: v.string(),
				state: v.string(),
				postcode: v.string(),
				notes: v.optional(v.string()),
				mapsUrl: v.optional(v.string()),
				// Captured from Google Places autocomplete when the buyer picks
				// a suggestion. Optional because legacy orders + free-form
				// manual entry won't have coordinates. Drives the WhatsApp
				// location pin sent after confirm.
				latitude: v.optional(v.number()),
				longitude: v.optional(v.number()),
				// Google Place ID — when set, maps URLs deep-link to the
				// named place page instead of raw lat/lng search.
				placeId: v.optional(v.string()),
			}),
		),
		// Reference to the retailer's pickup location when deliveryMethod ===
		// "self_collect". Required at order-create time iff the retailer has
		// offerSelfCollect = true AND ≥1 active pickup location. Soft-deleting
		// the referenced location later does not invalidate the order — the
		// frozen `pickupSnapshot` below carries the historical detail.
		pickupLocationId: v.optional(v.id("pickupLocations")),
		// Frozen copy of the pickup location at order-creation time. Never
		// mutated after insert; safe to display on the tracking page and in
		// WhatsApp messages even if the retailer later edits or deactivates
		// the source location.
		pickupSnapshot: v.optional(
			v.object({
				label: v.string(),
				address: v.string(),
				mapsUrl: v.optional(v.string()),
				notes: v.optional(v.string()),
				// Frozen at order create. Drives the WhatsApp location pin
				// sent after confirm + the Waze/Google buttons on the
				// tracking page. Optional so orders against legacy pickup
				// locations (created before autocomplete) keep working.
				latitude: v.optional(v.number()),
				longitude: v.optional(v.number()),
				// Google Place ID — frozen so the Maps URL can deep-link
				// to the named place page (not just lat/lng search).
				placeId: v.optional(v.string()),
			}),
		),
		// Free-text instruction the shopper attached at checkout ("no onions",
		// "deliver after 5pm"). Optional; absent on orders created before this
		// field. Distinct from deliveryAddress.notes (address/gate detail, delivery
		// only) — this is order-level and applies to self-collect too. Trimmed +
		// length-capped server-side; rendered escaped (plain text, no markdown).
		customerNote: v.optional(v.string()),
		// Optional reference image the buyer attached for a custom/made-to-order
		// line (a photo says more than a note — e.g. a cake design). One per order.
		// Storage id uploaded pre-order via the public customImageUpload mutation.
		// See docs/custom-option.md.
		customerImageStorageId: v.optional(v.string()),
		// Optional external carrier tracking URL set by the retailer when marking
		// shipped. Surfaced on the customer tracking page and included in the
		// WhatsApp shipped notification. Only relevant for delivery orders.
		carrierTrackingUrl: v.optional(v.string()),
		// Payment handshake — independent of the fulfilment status pipeline above.
		// `unpaid` (or undefined) → shopper hasn't claimed payment yet.
		// `claimed` → shopper tapped "I've paid" on the tracking page.
		// `received` → retailer confirmed the money landed in their bank app.
		// A future PSP webhook can short-circuit straight to "received" without
		// the manual claim step — same end state.
		paymentStatus: v.optional(
			v.union(
				v.literal("unpaid"),
				v.literal("claimed"),
				v.literal("received"),
			),
		),
		paymentReference: v.optional(v.string()),
		paymentClaimedAt: v.optional(v.number()),
		paymentReceivedAt: v.optional(v.number()),
		paymentProofStorageId: v.optional(v.string()),
		// Mockup/proof approval — a third independent dimension (like payment),
		// gating the confirmed→packed transition for made-to-order orders.
		// Undefined = order has no proof-required item (no gate). See
		// docs/proof-approval.md. NOTE: "mockup" (not "proof") in code — "proof"
		// is the buyer's PAYMENT screenshot (paymentProofStorageId above).
		mockupStatus: v.optional(
			v.union(
				v.literal("pending"), // needs a mockup; seller hasn't sent one
				v.literal("submitted"), // seller sent it; awaiting the buyer
				v.literal("changes_requested"), // buyer wants changes; back to seller
				v.literal("approved"), // buyer approved; gate open
			),
		),
		// Current mockup image(s). `mockupImageStorageIds` is the source of truth
		// (1–5 images, e.g. multiple designs/angles or one-per-item for a multi-part
		// custom order). `mockupImageStorageId` is kept in sync as `[0]` for legacy
		// readers (WhatsApp send + the quote guard) and pre-multi orders. Reads
		// resolve `mockupImageStorageIds ?? [mockupImageStorageId]`. See docs/proof-approval.md.
		mockupImageStorageId: v.optional(v.string()),
		mockupImageStorageIds: v.optional(v.array(v.string())),
		mockupChangeNote: v.optional(v.string()), // buyer's requested changes
		mockupSubmittedAt: v.optional(v.number()),
		mockupApprovedAt: v.optional(v.number()),
		mockupWaivedAt: v.optional(v.number()), // seller proceeded without approval
		// Seller's quoted price for the custom (made-to-order) work, in minor
		// units. Set/updated on each mockup submission (re-priceable per round) and
		// folded into `total` via computeOrderTotals. Undefined = no quote (the
		// custom line, if any, is sold at its storefront price). Cleared when the
		// buyer declines the custom item. See docs/proof-approval.md.
		mockupQuotedAmount: v.optional(v.number()),
		// When the canonical `status` last changed — drives the "time in status"
		// badge in the order inbox (e.g. "Pending 2h"). Stamped on create + every
		// status transition. Optional: pre-inbox orders fall back to updatedAt /
		// createdAt at read time, so no backfill. See docs/order-inbox.md.
		statusChangedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_retailer_status", ["retailerId", "status"])
		.index("by_retailer_payment", ["retailerId", "paymentStatus"])
		.index("by_retailer_mockup", ["retailerId", "mockupStatus"])
		.index("by_shortId", ["shortId"])
		.index("by_customer", ["customerId"]),

	/**
	 * Retailer-managed library of self-collect pickup locations. Frozen onto
	 * an order via `orders.pickupSnapshot` at create time so deactivating /
	 * editing a location later doesn't rewrite history.
	 */
	pickupLocations: defineTable({
		retailerId: v.id("retailers"),
		label: v.string(),
		address: v.string(),
		mapsUrl: v.optional(v.string()),
		notes: v.optional(v.string()),
		// Coordinates + Google place identifier captured via Places
		// autocomplete. Optional — legacy rows created via free-form text
		// don't have these. New autocomplete-captured rows write all three.
		latitude: v.optional(v.number()),
		longitude: v.optional(v.number()),
		placeId: v.optional(v.string()),
		// Optional contact info for the person running this pickup spot. When
		// set, the seller order detail page surfaces a "Notify <name>" wa.me
		// button so the seller can forward the order details in one tap.
		// Intentionally NOT frozen onto the order snapshot — pickup orders
		// should always route to the *current* manager, even if the seller
		// swaps them after an order is placed.
		managerName: v.optional(v.string()),
		managerWaPhone: v.optional(v.string()),
		// Soft-delete flag. Retailers deactivate (rather than hard-delete) so
		// historical order snapshots remain meaningful. Inactive rows are
		// hidden from the storefront picker but still listed in settings under
		// a "show inactive" toggle.
		isActive: v.boolean(),
		// Ascending integer used to drive the picker order. The settings UI
		// surfaces up/down arrows that swap sortOrder with the neighbour.
		sortOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_retailer_active", ["retailerId", "isActive"]),

	orderEvents: defineTable({
		orderId: v.id("orders"),
		status: v.union(
			v.literal("pending"),
			v.literal("confirmed"),
			v.literal("packed"),
			v.literal("shipped"),
			v.literal("delivered"),
			v.literal("cancelled"),
		),
		// Phase 2: which seller stage this event advanced into, plus a FROZEN
		// label snapshot (pickupSnapshot pattern) so the order history stays
		// readable even if the stage is later renamed or deleted. Both optional —
		// canonical-only transitions (e.g. cancel) and pre-Phase-2 events omit them.
		stageId: v.optional(v.string()),
		stageLabel: v.optional(v.string()),
		note: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_order", ["orderId"]),

	// --- Manual subscription billing (docs/manual-subscription.md) -----------
	// Per-retailer subscription. One row per retailer (created in-transaction by
	// createRetailer). Entitlement caps are DENORMALIZED here so feature-gating
	// reads them directly, never the `plan` field — keeps the seam clean for when
	// automated billing arrives. `trialing` (plan = tier being trialed, default
	// pro) → `active` (paid) / `past_due` (lapsed) / `cancelled`.
	subscriptions: defineTable({
		retailerId: v.id("retailers"),
		plan: v.union(v.literal("starter"), v.literal("pro"), v.literal("scale")),
		billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
		status: v.union(
			v.literal("trialing"),
			v.literal("active"),
			v.literal("past_due"),
			v.literal("cancelled"),
		),
		trialEndsAt: v.optional(v.number()),
		// Stamped when the "trial ends in 3 days" email is sent, so the daily cron
		// sends it at most once.
		trialReminderSentAt: v.optional(v.number()),
		currentPeriodStart: v.optional(v.number()),
		currentPeriodEnd: v.optional(v.number()),
		cancelledAt: v.optional(v.number()),
		// Pilot / backfilled retailers: full access, never charged, ineligible for
		// the Founding rank.
		comped: v.optional(v.boolean()),
		// Denormalized entitlements read by feature-gating. orderCap is SOFT in v1
		// (nudge only, never blocks the public storefront); userCap + broadcastQuota
		// are hard on seller-side surfaces.
		orderCap: v.number(),
		userCap: v.number(),
		broadcastQuota: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_status", ["status"]), // drives the cron status scans

	// Per-period invoice. Admin marks it paid out-of-band (DuitNow / bank). The
	// founding pending invoice carries a `dueDate` that drives the active→past_due
	// overdue cron flip.
	invoices: defineTable({
		retailerId: v.id("retailers"),
		subscriptionId: v.id("subscriptions"),
		invoiceNumber: v.string(),
		amount: v.number(), // base (minor units)
		foundingDiscount: v.optional(v.number()), // 30% line if applicable
		total: v.number(), // amount - foundingDiscount
		currency: v.string(),
		periodStart: v.number(),
		periodEnd: v.number(),
		dueDate: v.number(),
		status: v.union(
			v.literal("pending"),
			v.literal("paid"),
			v.literal("void"),
		),
		markedPaidAt: v.optional(v.number()),
		markedPaidBy: v.optional(v.string()), // admin Clerk subject
		paymentMethod: v.optional(v.string()), // "duitnow" / "bank_transfer" — freeform v1
		// Soft-cancel audit (a pending invoice issued in error). The row is kept for
		// history/reconciliation; status flips to "void". See invoices.voidInvoice.
		voidedAt: v.optional(v.number()),
		voidedBy: v.optional(v.string()), // admin Clerk subject
		voidReason: v.optional(v.string()),
		// Stamped when the pre-due-date reminder email is sent, so the daily cron
		// sends it at most once. See convex/billingEmail.ts.
		reminderSentAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_retailer", ["retailerId"])
		.index("by_status", ["status"]),

	// Global Kedaipal payment details (retailers pay Kedaipal). A SINGLETON — one
	// row, no retailerId. Admin-editable from /app/admin/billing so the boss can
	// change bank details / swap the QR without a deploy. The QR image lives in
	// Convex storage; this holds its id. See docs/manual-subscription.md.
	billingConfig: defineTable({
		bankName: v.optional(v.string()),
		bankAccountName: v.optional(v.string()),
		bankAccountNumber: v.optional(v.string()),
		duitnowId: v.optional(v.string()),
		qrImageStorageId: v.optional(v.string()),
		updatedAt: v.number(),
		updatedBy: v.optional(v.string()), // admin Clerk subject
	}),

	// Founding Member ledger — atomic rank claim (1..10). Source of truth for the
	// denormalized retailer flags. A row exists iff a retailer claimed a rank.
	foundingMembers: defineTable({
		retailerId: v.id("retailers"),
		rank: v.number(), // 1..10
		plan: v.union(v.literal("pro"), v.literal("scale")), // tier at claim time
		paidAt: v.number(),
		firstInvoiceId: v.id("invoices"),
		welcomedAt: v.optional(v.number()),
		whiteGloveScheduledAt: v.optional(v.number()),
	})
		.index("by_rank", ["rank"])
		.index("by_retailer", ["retailerId"]),
});
