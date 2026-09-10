# Quote Builder — Import File Format (`barro-qb-import` v1)

Defined by specs/QB-IMPORT-NOCOSTING-SPEC-2026-09-11.md. This is the readable version of
the same brief the 📥 Import modal's **📋 Copy format spec for Claude**
button copies (the `QB_IMPORT_SPEC_TEXT` const in `quote-builder-v2.html`,
near the import functions) — **keep the two in sync** when either changes.

## What it's for

Hand Claude any list of items — a photo of a spec sheet, an Excel export, a
plain-text quote request — and ask it to produce a `barro-qb-import` JSON
file using this format. Open the quote builder's Estimator tab, click
**📥 Import**, paste or upload the file, and every item lands on the quote as
a standard custom line — editable, costable, and no different from one typed
in by hand.

Only the item **name** is required. Everything else — specs, dimensions,
price, costing — may be left out and filled in (or never filled in) later.

## Shape

```json
{
  "format": "barro-qb-import",
  "version": 1,
  "sections": [
    {
      "label": "Option A — Full Kitchen",
      "items": [
        {
          "name": "Stainless Prep Table",
          "specs": "SS304 1.2mm top, undershelf",
          "dims": "L1200 × W600 × H850 mm",
          "qty": 2,
          "unit": "pc",
          "unitPrice": 25000,
          "leadTime": "3 weeks",
          "notes": "client to confirm height",
          "noCosting": false,
          "costing": {
            "materialsLump": 12000,
            "bom": [ { "material": "SS sheet 4'x8' 1.2mm 304", "qty": 2, "unitPrice": 3500 } ],
            "laborDays": 1.5
          }
        }
      ]
    }
  ],
  "items": []
}
```

`format` and `version` are optional and not validated — include them or
don't, it makes no difference to the import. Three shapes are all accepted:

- a **bare array** of item objects,
- `{ "items": [...] }` with no sections,
- `{ "sections": [...] }`, or both `items` and `sections` together (top-level
  `items` are treated as section-less, same as a `sections` entry with no
  `label`).

Use `sections` only when the source list is naturally grouped — e.g. an
"Option A / Option B" quote. Otherwise a flat `items` array is simplest.

## Item fields

| Field | Type | Default if absent |
|---|---|---|
| `name` | string | **required** — an item with no name (after trimming) is skipped and counted in the import warnings |
| `specs` | string, array of strings, or array of `{label, value}` | `''` |
| `dims` | string | `''` |
| `qty` | number | `1` (also the floor — anything less becomes `1`) |
| `unit` | string | `'pc'` |
| `unitPrice` | number | `0` (no price — see below) |
| `leadTime` | string | `''` |
| `notes` | string | `''` |
| `noCosting` | boolean | `false` |
| `costing` | object, see below | absent |

**`specs`** — a plain string is used as-is. An array of strings joins with
" • ". An array of `{label, value}` objects renders each as `label: value`
and joins the same way.

**`unitPrice`** — a real, positive number sets the price and marks it
**manual**: it sticks, and the quote builder's auto-pricer skips that line
(a price from Neil's own list must never be silently overwritten by the
computed price). Leave it out, blank, or `0` and the line prices itself
automatically once it has a cost basis (see `costing` below) — or stays at
₱0, fully editable, if it never gets one.

**`noCosting`** — set `true` on a line that genuinely has no cost basis (a
pass-through item, something the client is supplying themselves). It shows a
neutral "no costing" chip instead of the "needs costing" warning, and does
not block filing the quote. It is a checkbox in the builder too — this just
pre-ticks it.

**`costing`** (optional object):

| Field | Lands as | Notes |
|---|---|---|
| `materialsLump` | `costMat` | a lump-sum materials cost, finite and ≥ 0 |
| `laborDays` | `costLaborDays` | crew-days of labor, priced at the crew day-rate |
| `laborHours` | `costHrs` | legacy hours field — `laborDays` is preferred |
| `bom` | `bom` | an itemized materials list: `[{ material, qty, unitPrice }]` |

Only give the fields you actually have numbers for — an absent
`materialsLump` never becomes `costMat: 0`; the item is simply left
"never costed" until someone enters a real basis (or ticks `noCosting`).
`bom` rows need a `material` (or `name`) string; rows with neither are
dropped.

A value that fails to parse as a number (instead of being genuinely absent)
is ignored and reported as a warning after import — it never silently
becomes `0`.

## Rules for whoever (or whatever) builds the file

- **Never invent** prices, costs, dimensions, or specs. If it isn't in the
  source material, leave the field out — don't guess or estimate.
- Put anything uncertain or worth flagging in `notes` instead of guessing.
- Up to **200 items** per file. A file over that limit is refused outright
  (no partial import) — split a longer list into batches.

## What happens on import

- Sections are matched **case-insensitively** against the quote's existing
  section names. A match reuses that section; no match creates a new one.
  Section-less items land in the currently-filtered category (or
  Miscellaneous).
- Imported items always **append** to the quote — nothing already on it is
  ever replaced or removed.
- Every string from the file is stored as typed (trimmed only) and escaped
  only when rendered — never trust an import file from an untrusted source,
  same as you wouldn't paste untrusted HTML anywhere else in the app.
