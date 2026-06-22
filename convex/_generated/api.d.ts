/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as email from "../email.js";
import type * as google from "../google.js";
import type * as http from "../http.js";
import type * as lib_address from "../lib/address.js";
import type * as lib_channels_registry from "../lib/channels/registry.js";
import type * as lib_channels_types from "../lib/channels/types.js";
import type * as lib_channels_whatsapp_adapter from "../lib/channels/whatsapp/adapter.js";
import type * as lib_currency from "../lib/currency.js";
import type * as lib_customer from "../lib/customer.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailCopy from "../lib/emailCopy.js";
import type * as lib_legal from "../lib/legal.js";
import type * as lib_mapsUrl from "../lib/mapsUrl.js";
import type * as lib_order from "../lib/order.js";
import type * as lib_orderBuckets from "../lib/orderBuckets.js";
import type * as lib_orderStatus from "../lib/orderStatus.js";
import type * as lib_payment from "../lib/payment.js";
import type * as lib_rateLimiter from "../lib/rateLimiter.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_variant from "../lib/variant.js";
import type * as lib_whatsapp from "../lib/whatsapp.js";
import type * as lib_whatsappCopy from "../lib/whatsappCopy.js";
import type * as lib_whatsappSignature from "../lib/whatsappSignature.js";
import type * as lib_whatsappWebhook from "../lib/whatsappWebhook.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as pickupLocations from "../pickupLocations.js";
import type * as products from "../products.js";
import type * as retailers from "../retailers.js";
import type * as seed from "../seed.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  customers: typeof customers;
  email: typeof email;
  google: typeof google;
  http: typeof http;
  "lib/address": typeof lib_address;
  "lib/channels/registry": typeof lib_channels_registry;
  "lib/channels/types": typeof lib_channels_types;
  "lib/channels/whatsapp/adapter": typeof lib_channels_whatsapp_adapter;
  "lib/currency": typeof lib_currency;
  "lib/customer": typeof lib_customer;
  "lib/email": typeof lib_email;
  "lib/emailCopy": typeof lib_emailCopy;
  "lib/legal": typeof lib_legal;
  "lib/mapsUrl": typeof lib_mapsUrl;
  "lib/order": typeof lib_order;
  "lib/orderBuckets": typeof lib_orderBuckets;
  "lib/orderStatus": typeof lib_orderStatus;
  "lib/payment": typeof lib_payment;
  "lib/rateLimiter": typeof lib_rateLimiter;
  "lib/slug": typeof lib_slug;
  "lib/variant": typeof lib_variant;
  "lib/whatsapp": typeof lib_whatsapp;
  "lib/whatsappCopy": typeof lib_whatsappCopy;
  "lib/whatsappSignature": typeof lib_whatsappSignature;
  "lib/whatsappWebhook": typeof lib_whatsappWebhook;
  migrations: typeof migrations;
  orders: typeof orders;
  pickupLocations: typeof pickupLocations;
  products: typeof products;
  retailers: typeof retailers;
  seed: typeof seed;
  whatsapp: typeof whatsapp;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
};
