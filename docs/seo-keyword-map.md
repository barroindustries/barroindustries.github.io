# SEO keyword map — barroindustries.com (2026-10-22)

Source: Google autocomplete for the Philippines (gl=ph, hl=en), 30 seed terms × 7 modifiers
("", philippines, manila, quezon city, near me, price, supplier) → 1,027 suggestions, 853 relevant.
Raw list: session scratchpad `kw/keywords-filtered.txt`. Autocomplete shows what people actually type; it
does not give volumes (that needs Google Ads Keyword Planner — owner's account).

## What searchers in the Philippines do

1. **They search "price"** for almost every product ("stainless sink price philippines", "stainless table price",
   "commercial stove price", "kitchen exhaust hood price philippines", "kitchen fire suppression system price
   philippines"). We never publish prices (owner rule) — pages answer the intent honestly: *"Prices depend on
   size and options. Get an estimated range online in minutes — no account needed"* → `/catalogue/?quote=1`.
2. **They search by city**: quezon city, manila, metro manila, pasig, marikina, paranaque, cavite, cebu.
   Only claim areas we actually serve (QC base, Luzon projects list). No fake per-city pages.
3. **Synonyms**: prep table · working table · work table · kitchen table; gas range · commercial stove ·
   3 burner commercial gas stove; metal fabrication · custom fabrication · stainless fabrication;
   stainless steel supplier; restaurant equipment · catering equipment · industrial kitchen equipment.
4. **Questions**: what is a fresh air system / how does it work; how does a kitchen fire suppression system
   work; what equipment is required in a commercial kitchen; commissary kitchen requirements; how to design a
   commercial kitchen.

## Page → keywords (primary first)

| Page | Primary | Secondary / synonyms | Status |
|---|---|---|---|
| `/` | stainless steel kitchen equipment Philippines | commercial kitchen equipment supplier Philippines, stainless steel fabrication Quezon City, Barro Kitchens | **built** 2026-10-22, not yet deployed: hero lead names the custom fabrication, a new "Stainless-steel fabrication" section after Services, "Products" in the nav, description names it. Live before: title "Barro Kitchens by Barro Industries" kept |
| `/catalogue/` | commercial kitchen equipment Philippines | kitchen equipment supplier Manila / Quezon City, restaurant equipment, catering equipment, industrial kitchen equipment, kitchen equipment price list | **built**, not yet deployed: H1 "Commercial kitchen equipment catalogue", an opening sentence for restaurants / hotels / bakeries / catering / commissaries, description, a "Learn more" link on each of the six family cards |
| `/products/` (new hub) | stainless steel kitchen equipment | stainless steel equipment supplier, stainless steel equipment manufacturers | **built**, not yet deployed (title "Stainless Steel Kitchen Equipment — Built to Order") |
| `/products/stainless-steel-sinks/` | stainless steel sink Philippines | stainless sink price, stainless kitchen sink, commercial sink, sink with cabinet, stainless sink supplier, 2/3-compartment sink | **built**, not yet deployed |
| `/products/stainless-steel-work-tables/` | stainless steel table Philippines | stainless work table / working table price, prep table, kitchen table, table for baking, table supplier/manufacturer | **built**, not yet deployed |
| `/products/commercial-gas-stoves/` | commercial gas stove Philippines | commercial gas range, commercial stove price, 3/4 burner commercial gas stove, wok burner, high-pressure burner | **built**, not yet deployed |
| `/products/stainless-steel-cabinets/` | stainless steel cabinet Philippines | stainless kitchen cabinet, wall cabinet, dish rack cabinet | **built**, not yet deployed. Needs the owner's own cabinet photo (none exists yet; the page uses a text hero) |
| `/products/stainless-steel-shelving/` | stainless steel wall shelf | stainless shelving, kitchen shelving | **built**, not yet deployed |
| `/products/stainless-steel-racks/` | stainless steel rack Philippines | kitchen rack, rack supplier | **built**, not yet deployed |
| `/services/stainless-steel-fabrication/` | stainless steel fabrication Quezon City / Metro Manila | custom stainless steel fabrication, metal fabrication Quezon City, stainless fabrication shop, SS304/SS316 fabrication | **built**, not yet deployed: title "Stainless Steel Fabrication — Quezon City / Metro Manila", H1, description, links to the six product pages |
| `/services/exhaust-and-fresh-air-systems/` → split | kitchen exhaust system Philippines | kitchen exhaust hood (price), commercial range hood, exhaust blower | **built**, not yet deployed: title "Kitchen Exhaust System & Hood", H1 "Kitchen exhaust systems and commercial range hoods", links to the new fresh-air page and the stoves page (the URL is unchanged) |
| `/services/fresh-air-systems/` (new) | fresh air system | what is a fresh air system, how a fresh air system works, fresh air ventilation for kitchens | **built**, not yet deployed |
| `/services/kitchen-fire-suppression/` | kitchen fire suppression system Philippines | how it works, types, kitchen hood fire suppression | live; stoves link added (not yet deployed) |
| `/services/lpg-gas-line-installation/` | LPG gas line installation Philippines | gas pipeline installation, LPG installation for restaurants | live; stoves and fresh-air links added (not yet deployed) |
| `/services/commercial-kitchen-fit-out/` | commercial kitchen design and build Philippines | restaurant kitchen equipment, how to design a commercial kitchen, commissary kitchen | live; product-page and fresh-air links added (not yet deployed) |
| `/faq/` | question queries | what equipment is required in a commercial kitchen, commissary kitchen requirements, fresh air system, fire suppression | live |

## Rules for every page
- One H1 containing the primary keyword naturally; title ≈ "Primary Keyword — Built to Order | Barro Industries"
  (≤ 60 chars where possible); description 140–160 chars with one secondary keyword + Barro Kitchens once.
- Real content only: options from the configurators (`scripts/public-families.json`), SS304/SS316, brushed /
  mirror / satin, sizes from the catalogue, the 6-month warranty, KitchenShield™ PMS, projects (ISPSC, DMMMSU).
- No prices, no invented specs/claims, no keyword stuffing, no competitor names, QC contact only.
- Each page: "Configure & add" / "Get a quote" + the price-intent line, FAQ block (FAQPage JSON-LD),
  internal links (hub ↔ product ↔ catalogue category ↔ related service), in sitemap.xml, requested in Search Console.
