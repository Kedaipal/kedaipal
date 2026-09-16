/// <reference types="vite/client" />
/**
 * The /mcp HTTP transport (z8r3fdff6p): OAuth-token auth against a stubbed
 * Clerk `oauth/userinfo`, the JSON-RPC handshake, tool dispatch through the
 * real internal tool layer, gate copy as isError tool results, and the
 * .well-known discovery routes. The tenant boundary is asserted end-to-end
 * here: the ONLY input naming a store is the bearer token — there is no
 * retailerId parameter anywhere in the protocol for a client to abuse.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { todayMytMidnight } from "./lib/fulfilmentDate";
import { capsForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ISSUER = "https://test-clerk.example.accounts.dev";
const SITE = "https://test-deployment.convex.site";
const OWNER_A = "user_http_owner_a";
const OWNER_B = "user_http_owner_b";
const TOKENS: Record<string, string> = {
	"tok-a": OWNER_A,
	"tok-b": OWNER_B,
	"tok-nostore": "user_http_no_store",
};

beforeEach(() => {
	process.env.CLERK_JWT_ISSUER_DOMAIN = ISSUER;
	process.env.CONVEX_SITE_URL = SITE;
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === `${ISSUER}/oauth/userinfo`) {
				const auth = new Headers(init?.headers).get("Authorization") ?? "";
				const userId = TOKENS[auth.replace("Bearer ", "")];
				if (!userId) return new Response("unauthorized", { status: 401 });
				return Response.json({ user_id: userId });
			}
			if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
				return Response.json({ issuer: ISSUER });
			}
			throw new Error(`unexpected fetch in test: ${url}`);
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.CLERK_JWT_ISSUER_DOMAIN;
	delete process.env.CONVEX_SITE_URL;
});

async function seedProStore(t: ReturnType<typeof setup>, userId = OWNER_A) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Http Store ${userId.slice(-1).toUpperCase()}`,
		slug: `http-store-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kuih Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 500 }],
	});
	await setPlan(t, retailer._id, "pro");
	return { retailer, productId };
}

async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: Plan,
	status: "active" | "past_due" = "active",
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		const caps = capsForPlan(plan);
		await ctx.db.patch(sub._id, {
			plan,
			status,
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: Date.now(),
		});
	});
}

function rpc(
	t: ReturnType<typeof setup>,
	body: unknown,
	token?: string,
): Promise<Response> {
	return t.fetch("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

type ToolCallResult = {
	result?: {
		content?: { type: string; text: string }[];
		isError?: boolean;
	};
	error?: { code: number; message: string };
};

async function callTool(
	t: ReturnType<typeof setup>,
	token: string,
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
	const res = await rpc(
		t,
		{
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		},
		token,
	);
	expect(res.status).toBe(200);
	return (await res.json()) as ToolCallResult;
}

describe("auth", () => {
	test("no token → 401 with the resource-metadata pointer that starts OAuth", async () => {
		const t = setup();
		const res = await rpc(t, { jsonrpc: "2.0", id: 1, method: "initialize" });
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toContain(
			`${SITE}/.well-known/oauth-protected-resource/mcp`,
		);
	});

	test("an invalid token → 401", async () => {
		const t = setup();
		const res = await rpc(
			t,
			{ jsonrpc: "2.0", id: 1, method: "initialize" },
			"tok-forged",
		);
		expect(res.status).toBe(401);
	});
});

describe("handshake", () => {
	test("initialize returns server info + instructions; notifications get 202", async () => {
		const t = setup();
		await seedProStore(t);
		const res = await rpc(
			t,
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-06-18" },
			},
			"tok-a",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: {
				protocolVersion: string;
				serverInfo: { name: string };
				instructions: string;
			};
		};
		expect(body.result.protocolVersion).toBe("2025-06-18");
		expect(body.result.serverInfo.name).toBe("Kedaipal");
		expect(body.result.instructions).toContain("Read-only");

		const notified = await rpc(
			t,
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			"tok-a",
		);
		expect(notified.status).toBe(202);
	});

	test("tools/list serves the catalog; unknown methods get -32601", async () => {
		const t = setup();
		await seedProStore(t);
		const res = await rpc(
			t,
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			"tok-a",
		);
		const body = (await res.json()) as { result: { tools: { name: string }[] } };
		expect(body.result.tools).toHaveLength(8);
		expect(body.result.tools.map((tool) => tool.name)).toContain(
			"sales_summary",
		);

		const unknown = await rpc(
			t,
			{ jsonrpc: "2.0", id: 3, method: "resources/list" },
			"tok-a",
		);
		const err = (await unknown.json()) as ToolCallResult;
		expect(err.error?.code).toBe(-32601);
	});

	test("GET is 405 (stateless server) and OPTIONS preflight is open", async () => {
		const t = setup();
		const get = await t.fetch("/mcp", { method: "GET" });
		expect(get.status).toBe(405);
		const options = await t.fetch("/mcp", { method: "OPTIONS" });
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Headers")).toContain(
			"Authorization",
		);
	});
});

describe("tools/call", () => {
	test("returns the caller's own numbers, stamped with store + currency", async () => {
		const t = setup();
		const { retailer, productId } = await seedProStore(t);
		const today = todayMytMidnight(Date.now());
		await t.run(async (ctx) => {
			await ctx.db.insert("orders", {
				retailerId: retailer._id,
				shortId: "ORD-HTTP1",
				trackingToken: `httptok${"0".repeat(18)}`,
				items: [{ productId, name: "Kuih Box", price: 10000, quantity: 1 }],
				subtotal: 10000,
				total: 10000,
				currency: "MYR",
				status: "delivered",
				paymentStatus: "received",
				channel: "whatsapp",
				customer: { name: "Aisha", waPhone: "60123456789" },
				deliveryMethod: "self_collect",
				createdAt: today + 1,
				updatedAt: today + 1,
			});
		});
		const body = await callTool(t, "tok-a", "sales_summary", {
			period: "today",
		});
		expect(body.result?.isError).toBeUndefined();
		const text = body.result?.content?.[0]?.text ?? "";
		const payload = JSON.parse(text) as Record<string, unknown>;
		expect(payload.store).toBe("Http Store A");
		expect(payload.currency).toBe("MYR");
		expect(payload.earned).toBe(100);
		expect(payload.orderCount).toBe(1);
	});

	test("ISOLATION end-to-end: the bearer token is the only tenant selector", async () => {
		const t = setup();
		await seedProStore(t, OWNER_A);
		await seedProStore(t, OWNER_B);
		const body = await callTool(t, "tok-b", "order_counts");
		const payload = JSON.parse(
			body.result?.content?.[0]?.text ?? "{}",
		) as Record<string, unknown>;
		expect(payload.store).toBe("Http Store B");
		expect(payload.ordersScanned).toBe(0);
	});

	test("Starter hears the Pro sentence as a relayable tool error", async () => {
		const t = setup();
		const { retailer } = await seedProStore(t);
		await setPlan(t, retailer._id, "starter");
		const body = await callTool(t, "tok-a", "sales_summary");
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("Pro plan");
	});

	test("a past_due sub hears the renew sentence, not an upsell", async () => {
		const t = setup();
		const { retailer } = await seedProStore(t);
		await setPlan(t, retailer._id, "pro", "past_due");
		const body = await callTool(t, "tok-a", "sales_summary");
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("past due");
	});

	test("a token whose user has no store hears the setup sentence", async () => {
		const t = setup();
		await seedProStore(t);
		const body = await callTool(t, "tok-nostore", "order_counts");
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("no store");
	});

	test("an unknown tool is a protocol error, not a crash", async () => {
		const t = setup();
		await seedProStore(t);
		const res = await rpc(
			t,
			{
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: { name: "drop_tables", arguments: {} },
			},
			"tok-a",
		);
		const body = (await res.json()) as ToolCallResult;
		expect(body.error?.code).toBe(-32602);
	});
});

describe(".well-known discovery", () => {
	test("protected-resource metadata points MCP clients at Clerk", async () => {
		const t = setup();
		for (const path of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-protected-resource/mcp",
		]) {
			const res = await t.fetch(path, { method: "GET" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				resource: string;
				authorization_servers: string[];
			};
			expect(body.resource).toBe(`${SITE}/mcp`);
			expect(body.authorization_servers).toEqual([ISSUER]);
		}
	});

	test("authorization-server metadata proxies Clerk's live document", async () => {
		const t = setup();
		const res = await t.fetch("/.well-known/oauth-authorization-server", {
			method: "GET",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { issuer: string };
		expect(body.issuer).toBe(ISSUER);
	});
});
