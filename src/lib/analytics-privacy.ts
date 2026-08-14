/**
 * Marks a DOM subtree as personally identifiable so session-replay tools mask
 * its text.
 *
 * Microsoft Clarity's default masking mode is **Balanced**, which masks only
 * numbers, email addresses, and the contents of `input`/`select` elements —
 * every other *rendered* string is captured verbatim. That leaves buyer names,
 * the non-numeric parts of delivery addresses, order notes, and the seller's
 * private customer notes exposed in replays.
 *
 * `data-clarity-mask="true"` overrides the dashboard setting for that subtree,
 * which keeps the rule in the repo where review can see it rather than behind
 * an out-of-band toggle nobody can diff.
 *
 * Spread it onto the outermost element of any region that renders buyer or
 * customer PII:
 *
 * ```tsx
 * <section {...MASK_PII} className="...">…</section>
 * ```
 *
 * Grep for `MASK_PII` to audit coverage. New surfaces that render a customer's
 * name, phone, address, or notes must carry it.
 */
export const MASK_PII = { "data-clarity-mask": "true" } as const;
