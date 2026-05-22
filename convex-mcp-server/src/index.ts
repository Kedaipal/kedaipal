#!/usr/bin/env node
/**
 * Kedaipal Convex MCP Server
 *
 * Provides admin-level read access to the Kedaipal Convex backend via the
 * Convex HTTP API, authenticated with a deploy key. Designed for use with
 * Claude's MCP integration to query retailers, orders, and products directly
 * from the chat interface.
 *
 * Required env vars:
 *   CONVEX_URL        — your deployment URL, e.g. https://relaxed-dog-123.convex.cloud
 *   CONVEX_DEPLOY_KEY — deploy key from Convex dashboard → Settings → Deploy Keys
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Config ─────────────────────────────────────────────────────────────────

const CONVEX_URL = process.env.CONVEX_URL?.replace(/\/$/, "");
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;
const CHARACTER_LIMIT = 30_000;

if (!CONVEX_URL || !CONVEX_DEPLOY_KEY) {
  process.stderr.write(
    "ERROR: Both CONVEX_URL and CONVEX_DEPLOY_KEY environment variables are required.\n" +
      "  CONVEX_URL        — e.g. https://relaxed-dog-123.convex.cloud\n" +
      "  CONVEX_DEPLOY_KEY — from Convex dashboard → Settings → Deploy Keys\n",
  );
  process.exit(1);
}

// ─── Convex HTTP client ──────────────────────────────────────────────────────

interface ConvexResponse {
  status: "success" | "error";
  value?: unknown;
  errorMessage?: string;
  errorData?: unknown;
}

async function convexCall(
  type: "query" | "mutation",
  path: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await fetch(`${CONVEX_URL}/api/${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Convex ${CONVEX_DEPLOY_KEY}`,
    },
    body: JSON.stringify({ path, args, format: "json" }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Convex HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  let result: ConvexResponse;
  try {
    result = JSON.parse(text) as ConvexResponse;
  } catch {
    throw new Error(`Invalid JSON from Convex: ${text.slice(0, 300)}`);
  }

  if (result.status === "error") {
    throw new Error(
      result.errorMessage ?? `Convex function error (no message)`,
    );
  }

  return result.value;
}

function formatResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    return (
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n… [truncated — response exceeded ${CHARACTER_LIMIT} chars. Use filters or pagination to narrow the result.]`
    );
  }
  return text;
}

function handleError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

// ─── MCP server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "convex-kedaipal-mcp-server",
  version: "1.0.0",
});

// ── Tool: list all retailers ─────────────────────────────────────────────────

server.registerTool(
  "convex_list_retailers",
  {
    title: "List All Retailers",
    description: `List every retailer registered on Kedaipal (admin view).

Returns store name, slug, WhatsApp number, notify email, currency, locale,
and sign-up timestamps (createdAt as epoch ms). Logo and QR image URLs are
resolved if present.

Use this to see your full client list, find a retailer's ID for further
queries, or audit new sign-ups.

Returns:
  Array of retailer objects, each with:
  - _id        (string) Convex document ID
  - storeName  (string)
  - slug       (string) URL slug at kedaipal.com/<slug>
  - waPhone    (string | undefined)
  - notifyEmail (string | undefined)
  - currency   (string, default "MYR")
  - locale     ("en" | "ms")
  - createdAt  (number) epoch ms
  - updatedAt  (number) epoch ms`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const retailers = await convexCall("query", "retailers:internalListAllRetailers");
      return {
        content: [{ type: "text" as const, text: formatResult(retailers) }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: handleError(error) }] };
    }
  },
);

// ── Tool: get retailer by slug ────────────────────────────────────────────────

const GetRetailerSchema = z.object({
  slug: z.string().min(1).describe("The retailer's URL slug, e.g. 'wadafish'"),
});

server.registerTool(
  "convex_get_retailer",
  {
    title: "Get Retailer by Slug",
    description: `Look up a retailer's public profile by their URL slug.

Returns the retailer's storefront details (name, slug, currency, locale,
logo URL) or a redirect hint if the slug was recently renamed.

Returns one of:
  { status: "ok",       retailer: {...} }
  { status: "redirect", to: "<new-slug>" }
  { status: "notFound" }`,
    inputSchema: GetRetailerSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ slug }) => {
    try {
      const result = await convexCall("query", "retailers:getRetailerBySlug", { slug });
      return {
        content: [{ type: "text" as const, text: formatResult(result) }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: handleError(error) }] };
    }
  },
);

// ── Tool: list orders for a retailer ─────────────────────────────────────────

const ListOrdersSchema = z.object({
  retailerId: z
    .string()
    .min(1)
    .describe(
      "Convex document ID of the retailer — get it from convex_list_retailers",
    ),
  status: z
    .enum(["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"])
    .optional()
    .describe("Filter by order status. Omit to return all statuses."),
});

server.registerTool(
  "convex_list_orders",
  {
    title: "List Orders for a Retailer",
    description: `List orders for a specific retailer, ordered newest-first.

Use convex_list_retailers first to find the retailer's _id, then pass it
as retailerId. Optionally filter by status.

Args:
  - retailerId (string): The retailer's Convex document ID
  - status     (string, optional): One of pending | confirmed | packed | shipped | delivered | cancelled

Returns:
  Array of order objects, each with shortId, items, totals, status,
  customer details, deliveryAddress, paymentStatus, createdAt, updatedAt.`,
    inputSchema: ListOrdersSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ retailerId, status }) => {
    try {
      const args: Record<string, unknown> = { retailerId };
      if (status) args.status = status;
      const orders = await convexCall("query", "orders:internalListByRetailer", args);
      return {
        content: [{ type: "text" as const, text: formatResult(orders) }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: handleError(error) }] };
    }
  },
);

// ── Tool: list products for a retailer ────────────────────────────────────────

const ListProductsSchema = z.object({
  retailerId: z
    .string()
    .min(1)
    .describe(
      "Convex document ID of the retailer — get it from convex_list_retailers",
    ),
});

server.registerTool(
  "convex_list_products",
  {
    title: "List Products for a Retailer",
    description: `List all products (active and inactive) for a specific retailer.

Use convex_list_retailers first to find the retailer's _id.

Returns:
  Array of product objects, each with name, sku, price, currency, stock,
  active status, imageUrls, sortOrder, createdAt, updatedAt.`,
    inputSchema: ListProductsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ retailerId }) => {
    try {
      const products = await convexCall("query", "products:internalListAll", { retailerId });
      return {
        content: [{ type: "text" as const, text: formatResult(products) }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: handleError(error) }] };
    }
  },
);

// ── Tool: run any Convex query (escape hatch) ─────────────────────────────────

const RunQuerySchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Convex function path in 'module:functionName' format, e.g. 'orders:get'",
    ),
  args: z
    .record(z.unknown())
    .optional()
    .describe("Arguments object to pass to the function"),
});

server.registerTool(
  "convex_run_query",
  {
    title: "Run Any Convex Query",
    description: `Run any public or internal Convex query by path with the admin deploy key.

Use this as an escape hatch for queries not covered by the other tools.
The deploy key bypasses Clerk auth, so internal functions are accessible.

Path format: 'module:functionName'
Examples:
  - 'retailers:getMyRetailer'   (requires identity — will return null)
  - 'orders:get'                { orderId: "..." }
  - 'retailers:listSlugsForSitemap'

Args:
  - path (string): Convex function path
  - args (object, optional): Arguments passed to the function`,
    inputSchema: RunQuerySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ path, args = {} }) => {
    try {
      const result = await convexCall("query", path, args);
      return {
        content: [{ type: "text" as const, text: formatResult(result) }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: handleError(error) }] };
    }
  },
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("Kedaipal Convex MCP server running via stdio\n");
