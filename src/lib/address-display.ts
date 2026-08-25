/**
 * Display rule for the address's state line (SG-lite, 86eynw29u).
 *
 * The rule itself lives in `convex/lib/address.ts` beside `SG_STATE_LABEL` —
 * the literal it exists to dedupe — so the client renderers and the
 * server-side despatch-label view-model share ONE author (the
 * `src/lib/phone.ts` re-export precedent). This module stays as the client's
 * import path so no call site had to move.
 */
export { displayAddressState } from "../../convex/lib/address";
