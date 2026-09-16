/**
 * Seller MCP server — pure protocol + catalog module (z8r3fdff6p).
 *
 * Everything here is side-effect free and unit-tested: the JSON-RPC shapes,
 * the tool catalog (names, descriptions, input schemas), reporting-period
 * resolution in MYT, and the seller-facing gate copy. The Convex-aware halves
 * live elsewhere: `convex/sellerTools.ts` (the internal tool queries) and the
 * `/mcp` HTTP route in `convex/http.ts` (transport + Clerk OAuth).
 *
 * Design decisions this module encodes (16 Sep 2026, Zaki):
 *  - Tool calls are FREE — never credit-metered — and rate-limited instead.
 *  - Read-only v1: every tool is a query; there is deliberately no write tool.
 *  - Gate failures (plan / frozen sub) are TOOL results with `isError`, not
 *    protocol errors, because the text is copy a chat assistant relays to the
 *    seller verbatim — so it's written as seller-facing sentences.
 *  - Money leaves the server in MAJOR units (RM/S$, 2 dp) with an explicit
 *    `currency` field. Sen integers read as 100× typos in a chat answer.
 */

import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";
import { monthStartMyt } from "./usagePeriod";

// ---------------------------------------------------------------------------
// Protocol constants

/** Newest protocol revision this server speaks; also the reply when a client
 * asks for a version we don't know (per spec, the server answers with the
 * latest it supports and the client decides). */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26"] as const;

export const MCP_SERVER_INFO = {
	name: "Kedaipal",
	title: "Kedaipal — your store's numbers",
	version: "1.0.0",
} as const;

/** Handed to the client at initialize — the assistant reads this before any
 * tool call, so it carries the ground rules the tools rely on. */
export const MCP_SERVER_INSTRUCTIONS =
	"Read-only tools over the connected seller's own Kedaipal store. " +
	"All money figures are in the store's currency in major units (e.g. 123.50 " +
	"ringgit or dollars — check the `currency` field). Dates are YYYY-MM-DD in " +
	"Malaysia/Singapore time (MYT). Nothing here can change the store: no tool " +
	"creates, edits, or messages anything.";

/** The MCP endpoint is a bearer-token JSON API, so a permissive CORS posture is
 * safe and required — browser-based MCP clients (claude.ai, inspector tools)
 * preflight from their own origin. */
export const MCP_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers":
		"Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
	"Access-Control-Max-Age": "86400",
} as const;

// ---------------------------------------------------------------------------
// JSON-RPC helpers

export type JsonRpcId = string | number | null;

/** Standard JSON-RPC 2.0 error codes used by the route. */
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;

export function jsonRpcResult(id: JsonRpcId, result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function jsonRpcError(
	id: JsonRpcId,
	code: number,
	message: string,
): string {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** A tools/call result whose text the assistant shows the seller. `isError`
 * marks execution failures (gates, rate limits) without breaking protocol. */
export function toolResult(payload: unknown, isError = false) {
	return {
		content: [
			{
				type: "text" as const,
				text:
					typeof payload === "string"
						? payload
						: JSON.stringify(payload, null, 2),
			},
		],
		...(isError ? { isError: true } : {}),
	};
}

// ---------------------------------------------------------------------------
// Gate + limit copy (seller-facing — an assistant relays these verbatim)

export const MCP_GATE_COPY = {
	no_store:
		"This Kedaipal account has no store yet. Finish setting up your store at kedaipal.com, then reconnect.",
	plan:
		"The AI assistant connection is available on the Pro plan. Upgrade in Settings → Billing on your Kedaipal dashboard to use it.",
	frozen:
		"Your Kedaipal subscription is past due, so the AI assistant connection is paused. Pay your open invoice in Settings → Billing to reconnect — your storefront and existing orders stay live in the meantime.",
} as const;

export type McpGateReason = keyof typeof MCP_GATE_COPY;

export function rateLimitCopy(retryAfterMs: number): string {
	const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
	return `Too many requests for this store right now. Try again in about ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

// ---------------------------------------------------------------------------
// Reporting periods (MYT)

export const MCP_PERIODS = [
	"today",
	"yesterday",
	"last_7_days",
	"last_30_days",
	"this_month",
	"last_month",
] as const;

export type McpPeriod = (typeof MCP_PERIODS)[number];

export function isMcpPeriod(value: unknown): value is McpPeriod {
	return (
		typeof value === "string" && (MCP_PERIODS as readonly string[]).includes(value)
	);
}

/** Resolve a named period to a half-open MYT window [from, toExclusive).
 * Rolling windows include today (the seller asking "last 7 days" means "up to
 * now", unlike the Insights page's closed historical ranges). */
export function resolvePeriod(
	period: McpPeriod,
	now: number = Date.now(),
): { from: number; toExclusive: number } {
	const today = todayMytMidnight(now);
	switch (period) {
		case "today":
			return { from: today, toExclusive: today + DAY_MS };
		case "yesterday":
			return { from: today - DAY_MS, toExclusive: today };
		case "last_7_days":
			return { from: today - 6 * DAY_MS, toExclusive: today + DAY_MS };
		case "last_30_days":
			return { from: today - 29 * DAY_MS, toExclusive: today + DAY_MS };
		case "this_month":
			return { from: monthStartMyt(now), toExclusive: today + DAY_MS };
		case "last_month": {
			const thisMonthStart = monthStartMyt(now);
			return {
				from: monthStartMyt(thisMonthStart - 1),
				toExclusive: thisMonthStart,
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Output formatting

/** Sen → major units (RM/S$), safe for JSON output the assistant reads. */
export function senToMajor(sen: number): number {
	return Math.round(sen) / 100;
}

/** Minutes-since-MYT-midnight → "HH:MM", or null when the buyer picked no time. */
export function minutesToHhMm(minutes: number | undefined): string | null {
	if (minutes === undefined) return null;
	const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
	const mm = String(minutes % 60).padStart(2, "0");
	return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Tool catalog

const PERIOD_SCHEMA = {
	type: "string",
	enum: [...MCP_PERIODS],
	description: "Reporting window, in the store's timezone (MYT).",
	default: "last_7_days",
} as const;

export type McpToolName =
	| "sales_summary"
	| "order_counts"
	| "top_products"
	| "top_customers"
	| "unpaid_orders"
	| "upcoming_fulfilments"
	| "low_stock"
	| "credit_balance";

/** The catalog served by tools/list. Descriptions are written for the MODEL
 * (they steer tool choice), so they say what question each tool answers and
 * name the semantic traps (deposit-net revenue, gross customer spend). */
export const MCP_TOOLS: ReadonlyArray<{
	name: McpToolName;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
}> = [
	{
		name: "sales_summary",
		title: "Sales summary",
		description:
			"Revenue and order KPIs for a period: earned (deposit-net revenue from confirmed-or-later orders — cancelled and still-pending orders never count), collected (the earned money already marked received), order count, average order value, top products, payment-method and traffic-source breakdowns. Matches the seller's Insights page.",
		inputSchema: {
			type: "object",
			properties: { period: PERIOD_SCHEMA },
			additionalProperties: false,
		},
	},
	{
		name: "order_counts",
		title: "Order counts by status",
		description:
			"How many orders sit in each inbox bucket right now — new (needs attention), in progress, completed, cancelled — plus how many open orders are unpaid (and their total value) and how many are due today. Scans the store's most recent orders.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "top_products",
		title: "Top products",
		description:
			"Best-selling products for a period, ranked by revenue or by quantity sold. Uses the names frozen on each order, so renamed or deleted products still report their historical sales.",
		inputSchema: {
			type: "object",
			properties: {
				period: PERIOD_SCHEMA,
				by: {
					type: "string",
					enum: ["revenue", "quantity"],
					default: "revenue",
					description: "Ranking metric.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "top_customers",
		title: "Top customers",
		description:
			"The store's best customers over all time, ranked by total spend or by number of orders. `totalSpent` is gross order totals (deposits included), so it can read higher than the deposit-net revenue in sales_summary.",
		inputSchema: {
			type: "object",
			properties: {
				by: {
					type: "string",
					enum: ["spend", "orders"],
					default: "spend",
					description: "Ranking metric.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "unpaid_orders",
		title: "Unpaid orders",
		description:
			"Open orders (new or in progress) whose payment hasn't been received yet — the seller's chase list, newest first, with order ID, customer, amount and age.",
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "Maximum orders to return.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "upcoming_fulfilments",
		title: "Upcoming fulfilments",
		description:
			"What's due soon: open orders with a delivery/pickup date in the window, plus bookings that are upcoming or currently active. 'this_week' spans today through the next 7 days.",
		inputSchema: {
			type: "object",
			properties: {
				window: {
					type: "string",
					enum: ["today", "tomorrow", "this_week"],
					default: "today",
					description: "Fulfilment window, in the store's timezone (MYT).",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "low_stock",
		title: "Low stock",
		description:
			"Product variants that track stock and are at or below a threshold (default 3), lowest first. Made-to-order items never appear — they have no stock ceiling by design.",
		inputSchema: {
			type: "object",
			properties: {
				threshold: {
					type: "integer",
					minimum: 0,
					maximum: 100,
					default: 3,
					description: "Report variants with this many units on hand or fewer.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "credit_balance",
		title: "Order credits",
		description:
			"The store's order-credit balance. Order credits are not live yet — this tool says so until the credits system ships.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	},
];

export function isMcpToolName(value: unknown): value is McpToolName {
	return (
		typeof value === "string" && MCP_TOOLS.some((tool) => tool.name === value)
	);
}
