# URL search params — reading them safely

Every route that keeps state in the URL (`?q=`, `?status=`, `?voucher=`, …)
parses it in its TanStack `validateSearch`. Two rules apply to every one of
them. Both come from one bug ([`z8r3fdtk87`](https://app.clickup.com/t/z8r3fdtk87)):
`/app/admin/sellers?q=9981` and the public `/stores?q=2024` crashed to
"Something went wrong".

The helper is [`src/lib/search-params.ts`](../src/lib/search-params.ts).

## Why it broke: the URL decides the type

TanStack's default `parseSearch` JSON-parses each value. The same text
arrives as different types depending on how the URL was written:

| URL | What `validateSearch` receives |
|---|---|
| `?q=%229981%22` (what the app writes when you type in a box) | `"9981"` (string) |
| `?q=9981` (hand-typed, shared, from an older link) | `9981` (**number**) |
| `?q=true` · `?q=[1]` · `?q={}` | boolean · array · object |
| `?q=0123456` (leading zero: not valid JSON) | `"0123456"` (string) |

Typing in a search box never crashed, because the router quotes what it
writes. A link someone pasted or typed did.

## Rule 1: return every key you read

TanStack **merges the validator's result over the raw parsed search**. A key
the validator leaves out is not dropped. Its raw value leaks into
`Route.useSearch()`, in whatever type the URL gave it.

```ts
// ✗ On `?q=9981` this returns {}, and the component gets q = 9981 (a number).
//   `q.trim()` throws and the route's error card replaces the page.
validateSearch: (s) => ({ ...(typeof s.q === "string" ? { q: s.q } : {}) }),

// ✓ `undefined` overrides the raw value, and is dropped from the URL.
validateSearch: (s) => ({ q: searchText(s.q) }),
```

The same trap applies to an early `return { booking }` that skips the other
keys. On `/$slug/checkout` that let a raw `rsvp` through beside a `booking`,
breaking the "booking wins" rule the validator exists to keep.

A legacy key the validator folds into a newer one (`bucket` → `st`,
`source` → `sources`, `nopin` → `pin` on the Orders inbox) is returned as
`undefined` for the same reason. That also drops the old param from the URL
on the seller's next tap.

**Enforced:** [`src/lib/search-params-sweep.test.ts`](../src/lib/search-params-sweep.test.ts)
imports every route and runs its `validateSearch` against a search object.
That object records each key read and answers it with a number, a boolean,
then an array. Every key read must be an own property of the result. A key
that is deliberately left open goes in `OPEN_BY_DESIGN` with the reason it
is harmless (today only onboarding's raw `p` token: the page reads the
decoded `prefill`).

The TanStack behaviour itself is pinned through a real memory router in
[`src/lib/search-params.test.tsx`](../src/lib/search-params.test.tsx). If a
router upgrade changes the merge, that test says why the routes are written
this way.

## Rule 2: free text goes through `searchText`

A search query, voucher code, category name or showcase slug can be all
digits, and `typeof x === "string"` silently throws such a link away. For
example, the Orders inbox read `?q=60123456789` as "no search".
`searchText(raw)` reads a number or boolean back as the text the URL spelled.
Arrays, objects, `null` and whitespace-only values read as absent.

It does **not** trim. A search box keeps the space the user just typed, and a
caller that wants trimming (`/stores` caps at 80 trimmed characters) trims
after.

Known, accepted loss: JSON normalises exotic number spellings, so `?q=1e3`
reads back `"1000"`. Phone numbers and order numbers are plain digits and
round-trip exactly. A leading zero is not valid JSON, so the value stays a
string untouched.

Enum and id params (`status`, `sort`, `booking`, `session`, …) keep their own
exact checks. A number is never a valid enum value, so they need Rule 1 only.

## Where it applies today

`searchText`: `/app/admin/sellers` `q` · `/stores` `q` + `showcase` ·
`/$slug/checkout` `voucher` · `/app/orders` `q` + `cat`.

Closed keys (Rule 1) on every route with a `validateSearch`, swept by the
test above.
