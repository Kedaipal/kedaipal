// Unpaid-order payment reminder cron — see docs/payment-reminder.md.
//
// Daily sweep that finds orders sitting unpaid at day 11 of their 14-day
// open-payment window and sends the buyer ONE WhatsApp nudge. The stamp
// (`orders.paymentReminderSentAt`) is written here, at schedule time, so a
// crash-and-retry of the send action can never double-message; the send action
// re-checks payment state so a buyer who paid in the gap is never nagged.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
	isPaymentReminderDue,
	PAYMENT_REMINDER_AFTER_MS,
	PAYMENT_REMINDER_SCAN_WINDOW_MS,
} from "./lib/paymentReminder";

export const sendDuePaymentReminders = internalMutation({
	// `now` is injectable for tests; the cron passes {} and uses wall-clock time.
	args: { now: v.optional(v.number()) },
	handler: async (ctx, args): Promise<{ scheduled: number }> => {
		const now = args.now ?? Date.now();
		// Bounded index scan: only orders whose age is inside [day 11, day 14] —
		// at most 3 days of orders platform-wide, on the built-in creation-time
		// index (no full table scan). Orders past day 14 aged out of the window
		// (the deadline the reminder references has passed); orders younger than
		// day 11 aren't due yet.
		const candidates = await ctx.db
			.query("orders")
			.withIndex("by_creation_time", (q) =>
				q
					.gte("_creationTime", now - PAYMENT_REMINDER_SCAN_WINDOW_MS)
					.lte("_creationTime", now - PAYMENT_REMINDER_AFTER_MS),
			)
			.collect();

		let scheduled = 0;
		for (const order of candidates) {
			if (!isPaymentReminderDue(order, now)) continue;
			await ctx.db.patch(order._id, { paymentReminderSentAt: now });
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyPaymentReminder, {
				orderId: order._id,
			});
			scheduled++;
		}
		return { scheduled };
	},
});
