#!/usr/bin/env node
/**
 * Fire a signed Meta template-lifecycle webhook at a Convex deployment, the
 * way Meta would (ClickUp z8r3fddtkh). Dev-only helper for testing the admin
 * console's Message-templates panel without waiting for Meta to change
 * something — the signature is real, so this exercises the whole path:
 * verify → parse → wabaTemplateEvents row → ops alert.
 *
 * Usage (from the worktree, with the dev deployment selected):
 *   node scripts/dev-template-webhook.mjs <scenario> [templateName] [language]
 *
 * Scenarios:
 *   approved     status APPROVED            — no alert
 *   pending      status PENDING             — no alert (amber)
 *   paused       status PAUSED              — ALERTS + emails ops
 *   disabled     status DISABLED            — ALERTS + emails ops
 *   downgrade    category UTILITY→MARKETING — ALERTS + emails ops (the 6.1x case)
 *   restore      category MARKETING→UTILITY — no alert (an appeal won)
 *   quality-red  quality GREEN→RED          — ALERTS + emails ops
 *   quality-ok   quality GREEN→GREEN        — no alert
 *
 * The alerting scenarios send a REAL email to ADMIN_ALERT_EMAIL (falling back
 * to EMAIL_FROM). Use the non-alerting ones unless you mean to test that.
 *
 * Reads WHATSAPP_APP_SECRET and CONVEX_SITE_URL from the deployment via the
 * Convex CLI, so there is nothing to paste and no secret on the command line.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const [, , scenario = "approved", templateArg, langArg] = process.argv;

const SCENARIOS = {
	approved: { field: "message_template_status_update", value: { event: "APPROVED" } },
	pending: { field: "message_template_status_update", value: { event: "PENDING" } },
	paused: {
		field: "message_template_status_update",
		value: { event: "PAUSED", reason: "LOW_QUALITY" },
	},
	disabled: {
		field: "message_template_status_update",
		value: { event: "DISABLED", disable_info: { disable_date: "2026-10-01" } },
	},
	downgrade: {
		field: "template_category_update",
		value: { previous_category: "UTILITY", new_category: "MARKETING" },
	},
	restore: {
		field: "template_category_update",
		value: { previous_category: "MARKETING", new_category: "UTILITY" },
	},
	"quality-red": {
		field: "message_template_quality_update",
		value: { previous_quality_score: "GREEN", new_quality_score: "RED" },
	},
	"quality-ok": {
		field: "message_template_quality_update",
		value: { previous_quality_score: "GREEN", new_quality_score: "GREEN" },
	},
};

const picked = SCENARIOS[scenario];
if (!picked) {
	console.error(`Unknown scenario "${scenario}".`);
	console.error(`Try one of: ${Object.keys(SCENARIOS).join(", ")}`);
	process.exit(1);
}

const templateName = templateArg ?? "order_confirmation_utility";
const language = langArg ?? "en";

function convexEnv(key) {
	return execFileSync("npx", ["convex", "env", "get", key], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	})
		.trim()
		.split("\n")
		.pop()
		.trim();
}

const secret = convexEnv("WHATSAPP_APP_SECRET");
const site = convexEnv("CONVEX_SITE_URL");
if (!secret || !site) {
	console.error("Could not read WHATSAPP_APP_SECRET / CONVEX_SITE_URL.");
	process.exit(1);
}

// The quality field names the template `name`; the other two use
// `message_template_name`. Send both so the payload matches Meta either way.
const value = {
	...picked.value,
	message_template_name: templateName,
	message_template_language: language,
	name: templateName,
	language,
};
const body = JSON.stringify({
	object: "whatsapp_business_account",
	entry: [{ id: "WABA_ID", changes: [{ field: picked.field, value }] }],
});
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const res = await fetch(`${site}/webhook/whatsapp`, {
	method: "POST",
	headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
	body,
});
console.log(
	`${res.status} ${res.statusText} — ${scenario} on ${templateName} (${language})`,
);
console.log(`Open /app/admin/waba to see it in the Message templates panel.`);
