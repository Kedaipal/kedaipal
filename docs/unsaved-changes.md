# Unsaved changes: the leave guard and photo autosave

ClickUp [`z8r3fdtk82`](https://app.clickup.com/t/z8r3fdtk82). Campfest vendors
were adding photos to their products and leaving. The photo was gone, with no
warning, and the vendor thought the store was done.

## What was actually wrong

The ticket said Save changes stays disabled for a photo-only edit. **It never
was.** The button only disables while saving, while uploading, when the form
is invalid, or when the store is locked, and TanStack Form's `canSubmit` is
true on an untouched form. Two real gaps sat underneath:

1. **Nothing in the app warned before leaving.** Every unsaved edit on every
   field was dropped silently, not just photos.
2. **Sellers treat a photo that shows on screen as saved.** That's how
   WhatsApp and every marketplace app behave. Nothing on the page said a photo
   waits for Save.

## The pieces

| Piece | Where | Job |
|---|---|---|
| `draftFingerprint` / `isDraftDirty` | `src/lib/product-form-dirty.ts` | Dirty = the form's draft (`ProductFormDraft`, the same object Preview and the wizard switch read) compared with the draft it opened with. Preview URLs are ignored, because a fresh upload previews from `blob:` and the saved copy from storage, so only the storage ID counts. |
| `UnsavedChangesGuard` | `src/components/app/unsaved-changes-guard.tsx` | TanStack Router `useBlocker`. In-app navigation opens the house `ConfirmDialog` (Keep editing / Discard changes). Tab close or reload gets the browser's "Leave site?". Same-pathname moves are never blocked (wizard ↔ full form). |
| `usePhotoAutosave` | `src/hooks/usePhotoAutosave.ts` | Saves an existing product's photo list the moment it changes. Single-flight and latest-wins: a burst of reorders is at most two writes, and an older list can never land after a newer one. |

The forms (`ProductForm`, `ProductWizard`) stay **router-agnostic**. They
report `UnsavedState` (`none` / `changes` / `uploading`) via
`onUnsavedChange`, and the **route** renders the guard. Blocking navigation is
the route's decision, and the route already owns the navigate-after-save.

## Rules

- **A save's own exit passes `ignoreBlocker: true`.** That covers product
  saved, product created, product deleted, and the wizard's Cancel (which has
  already confirmed the discard itself). Archive does NOT pass it: archiving
  doesn't save the draft, so unsaved edits still get the prompt.
- **Photos autosave only on an existing product and only while saving is
  allowed.** On `/new` there's no product to save into. Under a `saveLock`
  (view-only, a teammate with view on products) photos stay in the draft like
  every other field, and the guard covers them.
- **An autosave moves only the images in the baseline.** Every other field
  still counts as unsaved until Save changes. A failed autosave leaves the
  baseline alone, so the photos stay dirty, the inline error says to tap
  Save, and the guard still warns.
- **Throttled is not failed.** Autosave shares the `productWrite` limit (20
  writes/min per user) with every other product write, and each new photo
  now costs two (upload URL + autosave). When it trips, the card says "Lots
  of changes — saving in 40s" and retries by itself with the newest list.
  Changes made meanwhile join that one retry. It never says "tap Save",
  because Save would be refused by the same limit. Leaving the page abandons
  the retry (the guard has already asked).
- **Removing a photo saves straight away, so each removal gets its own Undo
  toast,** held for 10 seconds rather than the 4-second default (the hands-on
  test ran out of time reaching for it). Undo puts back **only that photo**,
  at its old position, into the list as it is now. It never restores a
  snapshot, which would undo everything done since. Two quick removals keep
  two Undos (one shared toast used to replace the first). Leaving the page
  dismisses them, because an Undo fired elsewhere would write a list the form
  no longer shows. Product image removal never deletes the stored file
  (`products.update` only rewrites the ID list), so Undo is a real restore.
- **Every product-photo picker clears itself after a pick**
  (`takePickedFiles`, `src/lib/file-input.ts`). A file input only fires
  `change` when its value changes, so without the reset, removing a photo and
  picking the same file again did nothing at all. Covers the photo grid, the
  wizard's per-choice cell and both variant-grid pickers.
- **A wizard draft handed to the full form is unsaved from the first render**
  (`startsDirty`), but only if the wizard was dirty. A seller who taps
  "Skip, use the full form" without typing anything isn't asked about it.

## What the seller sees

- **Photos card (edit):** "Photos save as soon as you add, remove or reorder
  them, so there's no need to tap Save." The card shows **Saving…** /
  **Saved** beside the count, or an inline error if the save failed.
- **Save button (edit):** reads **All changes saved** (disabled, with a check
  icon) when nothing is unsaved, and flips back to **Save changes** the moment
  any field moves. The saved state is drawn solid and muted, not with the
  usual half-transparent disabled look: on a phone the bar is sticky, and the
  form showed through it.
- **Leaving with unsaved work:** "Leave without saving?", or "A photo is still
  uploading" when an upload is in flight. The wizard's own Cancel asks
  "Discard this product?" with the same two answers, **Keep editing** /
  **Discard changes**, so leaving reads the same whichever way the seller
  leaves.

## Deliberately not covered

- **Per-variant photos** (the Choices grid) don't autosave. They're part of
  the variant grid, which saves as a whole through `saveVariantGrid`, and a
  row may not exist on the server yet. They're covered by the dirty state
  and the guard instead.
- **Other dashboard forms** (settings cards and so on) don't use the guard
  yet. It's a drop-in: report an `UnsavedState`, render
  `<UnsavedChangesGuard>` in the route.
