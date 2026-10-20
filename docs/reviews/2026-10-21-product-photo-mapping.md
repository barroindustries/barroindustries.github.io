# Product photo mapping - owner review (2026-10-21)

**Status: draft for owner review. Nothing here is committed or deployed yet.**

Source: the *Barro Kitchens kitchen catalogue, 2026 edition* PDF, the edition without pricing (product pages 6-9, systems pages 11-12). 62 product images were extracted (60 distinct artworks; two artworks are reused under two captions each). 24 placements (23 distinct artworks) are used by the mapping below, which gives photos to **32 of 165 products** (12 high confidence, 20 medium). Every other product keeps its placeholder.

Machine-readable mapping: `scripts/product-photos.json` (product id -> `site/img/products/<slug>.webp`). Each photo also has `<slug>-thumb.webp` (400 px long edge); the full size is 800 px long edge. Both are RGB on pure white, auto-trimmed with an even margin, metadata stripped.

## How to read the confidence column

- **high** - same equipment type, and every configuration detail the product states and the photo can show (burner / tray / bowl / shelf / door counts, backsplash, upright vs undercounter) matches.
- **medium** - same equipment type and the key counts match, but one detail differs or cannot be verified from a photo (see the rationale). Approve or strike these before the photos go live: to strike one, delete its key from `scripts/product-photos.json`.
- Anything less certain was **not mapped**. A placeholder beats a wrong photo.

## Decisions for the owner (all the medium-confidence mappings, grouped)

1. **Countertop photos on floor-standing cooking items** - CE-002, CE-004, CE-005, CE-019, CE-020, CE-021. The PDF photos are countertop / "no stand" units; the products are listed at about 850 mm high (floor-standing). Equipment type and burner counts match. Keep only if you are happy with a countertop picture standing in for the stand version.
2. **Fire suppression (FS-001 to FS-004)** - the only available image is the PDF's isometric system diagram, not a photograph. It shows hood, detectors, suppression line, cylinder and manual pull, plus a cooking line the product does not include.
3. **GL-001 tank farm** - the PDF's own picture shows about six cylinders; the product is a cage for four 50 kg tanks and the tanks are not included.
4. **Duct photo shared by EX-004 and FA-003** - one image of duct sections with elbows serves both the exhaust and fresh-air duct items; the PDF caption says "stainless steel" but the duct looks galvanised.
5. **Shared photos** - pan trolley for BA-003 (high), PW-027 and PW-034 (medium; the photo shows about 16-17 levels vs 15 / 20); range hood for EX-001 (high) and EX-002 (medium, 5 m length not visible); the undercounter photo is used by the PDF itself for both the chiller and the freezer caption (RF-004 medium, RF-003 high).
6. **PW-004, PW-030, PW-051** - same type, one detail unconfirmed (faucet not shown; shelf count not stated; Single basin shown, Double offered).

## Mapping table

### Cooking Line (10 of 31 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| CE-002 | SS Open Top Low Pressure Stove (2 Burner) | `countertop-gas-cooking-range` | COUNTERTOP GAS COOKING RANGE (p.6) | medium | 2 open burners and 2 front knobs match; photo is a countertop unit on short legs, the product is 850 mm working height. |
| CE-004 | SS Open Top High Pressure Stove (4 Burner) | `open-gas-range-4-burner-no-stand` | OPEN GAS RANGE, 4 BURNER, NO STAND (p.6) | medium | 4 open-top burners (2x2) with 4 knobs match; PDF caption says "no stand" while the product is 850 mm high. |
| CE-005 | SS Open Top HP Stove (4 Burner, Square) | `open-gas-range-4-burner-no-stand` | OPEN GAS RANGE, 4 BURNER, NO STAND (p.6) | medium | 2x2 four-burner layout matches "4 Burner, Square"; same no-stand caveat as CE-004. |
| CE-009 | SS Double Fryer | `gas-upright-split-tank-fryer` | GAS UPRIGHT SPLIT TANK FRYER (p.6) | high | Two fry tanks side by side on an upright floor-standing cabinet = a double fryer. |
| CE-011 | SS Commercial Gas Rice Steamer (6-Tray) | `commercial-gas-rice-steamer` | COMMERCIAL GAS RICE STEAMER (p.6) | high | Same equipment (caption matches the product name): single-door gas rice steamer cabinet on casters. |
| CE-014 | SS 4 Open Top Square HP w/ SS/BI Combo Oven & Thermostat | `stainless-gas-range-with-static-oven` | STAINLESS GAS RANGE WITH STATIC OVEN (p.6) | high | 4 burners (2x2) over a static oven with thermostat panel, floor-standing; no riser/shelf, which the product does not list. |
| CE-018 | SS Stock Pot Range (Institutional) | `stock-pot-gas-range` | STOCK POT GAS RANGE (p.6) | high | Same equipment type: low single-burner stock pot range with backsplash and front knobs. |
| CE-019 | SS Griller (Institutional, Lava Rock) | `countertop-gas-charbroiler` | COUNTERTOP GAS CHARBROILER (p.6) | medium | Gas charbroiler (grate type) = griller; photo is a countertop unit vs the 851 mm institutional product; lava-rock vs radiant not visible. |
| CE-020 | SS Fryer (Institutional, Ball Valve) | `countertop-single-tank-gas-fryer` | COUNTERTOP SINGLE TANK GAS FRYER (p.6) | medium | Single-tank gas fryer matches; photo is a countertop-style unit vs the 851 mm institutional product. |
| CE-021 | SS Griddle (Institutional, MS Plate) | `countertop-gas-flat-griddle` | COUNTERTOP GAS FLAT GRIDDLE (p.6) | medium | Gas flat griddle matches; photo is a countertop unit vs the 851 mm institutional product; plate type not visible. |

### Preparation & Washing (9 of 53 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| PW-003 | SS Preparation Table (3 Layer) | `stainless-steel-island-type-worktable-with-mid-and-bottom-shelf` | STAINLESS STEEL ISLAND TYPE WORKTABLE WITH MID & BOTTOM SHELF (p.8) | high | Top + mid + bottom shelf = 3 layers, plain legs, no backsplash. |
| PW-004 | SS Wash Sink (Single) with Gooseneck Faucet | `stainless-steel-sink-with-backsplash` | STAINLESS STEEL SINK WITH BACKSPLASH (p.7) | medium | Single-bowl SS sink on legs with backsplash; the photo shows no faucet (the product includes a gooseneck). |
| PW-008 | SS Giant Triple Sink with Faucet | `stainless-steel-potwash-sinktable-with-backsplash` | STAINLESS STEEL POTWASH SINKTABLE WITH BACKSPLASH (p.7) | high | Three-bowl SS sink on an open frame with backsplash (faucet not shown). |
| PW-019 | SS Layer Table w/ Back Stopper | `stainless-steel-wall-type-worktable-with-mid-and-bottom-shelf-with-backsplash` | STAINLESS STEEL WALL TYPE WORKTABLE WITH MID & BOTTOM SHELF WITH BACKSPLASH (p.8) | high | Top + mid + bottom shelves with a rear backsplash = layer table with back stopper. |
| PW-023 | SS Wall Shelf | `wall-shelf-w-backsplash` | WALL SHELF W/ BACKSPLASH (p.9) | high | Wall-mounted SS shelf with backsplash and side brackets = wall shelf. |
| PW-027 | SS Cooling Rack (Caster) | `stainless-steel-mobile-baking-pan-trolley` | STAINLESS STEEL MOBILE BAKING PAN TROLLEY (p.9) | medium | Tall SS rack with angle runners on casters = cooling rack on casters; tier count not verifiable. |
| PW-030 | SS Slotted Clean Dish Rack | `stainless-steel-4-tier-slotted-racks` | STAINLESS STEEL 4-TIER SLOTTED RACKS (p.9) | medium | Slotted SS shelves on adjustable feet = slotted dish rack; the product does not state a shelf count (photo shows 4). |
| PW-034 | SS Trolley, 20-Tray Capacity | `stainless-steel-mobile-baking-pan-trolley` | STAINLESS STEEL MOBILE BAKING PAN TROLLEY (p.9) | medium | SS tray trolley with angle slides on casters; photo shows about 16-17 levels vs the product's 20-tray capacity. |
| PW-051 | SS Sink Table (Single/Double Basin) | `stainless-steel-1-bowl-sinktable-with-backsplash` | STAINLESS STEEL 1-BOWL SINKTABLE WITH BACKSPLASH (p.8) | medium | Single-basin sink table with drainboard and backsplash on round-tube posts = the default "Single" option; the Double option is not shown. |

### Refrigeration (2 of 6 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| RF-003 | Undercounter Freezer | `undercounter-worktable-freezer` | UNDERCOUNTER WORKTABLE FREEZER (p.8) | high | The PDF captions this very artwork "undercounter worktable freezer": two solid doors, side compressor, casters. (The same artwork is also captioned as a chiller.) |
| RF-004 | Undercounter Chiller | `undercounter-door-worktable-chiller` | UNDERCOUNTER DOOR WORKTABLE CHILLER (p.8) | medium | The PDF captions this artwork "undercounter door worktable chiller"; the product's spec is still marked pending, so the door count is unconfirmed. |

### Baking (1 of 12 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| BA-003 | SS Baking Tray / Pan Rack Trolley (15-Tier) | `stainless-steel-mobile-baking-pan-trolley` | STAINLESS STEEL MOBILE BAKING PAN TROLLEY (p.9) | high | Same item: mobile SS baking-pan rack with angle runners on casters; about 16-17 levels shown vs 15-tier default (10/15/20 offered). |

### Exhaust System (3 of 27 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| EX-001 | SS Range Hood with Baffle Filter, Lamp & Switch | `stainless-steel-range-hood` | STAINLESS STEEL RANGE HOOD (p.11) | high | Wall-type SS canopy hood with a baffle-filter bank = same item (lamp and switch not visible). |
| EX-002 | SS Range Hood Large (5m) with Baffle Filter | `stainless-steel-range-hood` | STAINLESS STEEL RANGE HOOD (p.11) | medium | Same hood type as EX-001; the 5 m length cannot be shown in a photo. |
| EX-004 | Galvanized Exhaust Duct with Elbows (per ~1m) | `stainless-steel-ducting` | STAINLESS STEEL DUCTING (p.11) | medium | Rectangular duct sections with elbows and a transition; looks galvanised although the PDF caption says "stainless steel". |

### Fresh Air System (2 of 10 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| FA-003 | SS Fresh Air Ducting (per run) | `stainless-steel-ducting` | STAINLESS STEEL DUCTING (p.11) | medium | Same duct-with-elbows photo; the PDF files it under the exhaust and fresh-air components, and its caption wording ("stainless steel ducting") matches "SS". |
| FA-004 | Air Diffuser with Galva Drop Box (300x300) | `square-louvered-diffusers` | SQUARE LOUVERED DIFFUSERS (p.11) | high | Square louvered ceiling diffuser = the 300x300 air diffuser (drop box sits above the ceiling, not visible). Grill products FA-005/FA-010 are deliberately not mapped. |

### Gas Line (1 of 3 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| GL-001 | Gas Line System with Tank Farm (4 x 50kg) | `gas-tank-farm` | GAS TANK FARM (p.12) | medium | The PDF's own image for the gas tank farm (caged farm with piping). It shows about 6 cylinders vs the product's 4 x 50 kg, and tanks are not included in the product. |

### Fire Suppression (4 of 6 products)

| ID | Product | Photo slug | PDF caption (page) | Confidence | Rationale |
|---|---|---|---|---|---|
| FS-001 | Fire Suppression System (Wet Chemical, Small) | `fire-suppression-diagram-of-possible-system-components` | DIAGRAM OF POSSIBLE SYSTEM COMPONENTS (label above the image, Fire Suppression System section) (p.12) | medium | Illustration (not a photograph) of a hood-integrated wet-chemical system: detectors, line, cylinder, manual pull. Same image for FS-001 to FS-004. |
| FS-002 | Fire Suppression System (Wet Chemical, Large) | `fire-suppression-diagram-of-possible-system-components` | DIAGRAM OF POSSIBLE SYSTEM COMPONENTS (label above the image, Fire Suppression System section) (p.12) | medium | Same illustration as FS-001 (system type matches; coverage size is not depicted). |
| FS-003 | Fire Suppression System, 4-Gallon (Complete w/ Install) | `fire-suppression-diagram-of-possible-system-components` | DIAGRAM OF POSSIBLE SYSTEM COMPONENTS (label above the image, Fire Suppression System section) (p.12) | medium | Same illustration as FS-001 (system type matches; 4-gallon size is not depicted). |
| FS-004 | Fire Suppression System (20L Flow, Detailed Spec) | `fire-suppression-diagram-of-possible-system-components` | DIAGRAM OF POSSIBLE SYSTEM COMPONENTS (label above the image, Fire Suppression System section) (p.12) | medium | Same illustration as FS-001 (system type matches; shows detector line, nozzles and manual pull). |

## Photos not mapped to any product

38 placements (37 distinct artworks). None of these has a webp in the repo.

| PDF page | PDF caption | Why not mapped |
|---|---|---|
| p.6 | ELECTRIC COUNTERTOP FRYER | Electric single-basket countertop fryer; no matching product (CE-022 is a 3-basket deep fryer). |
| p.6 | OPEN GAS RANGE WITH STAND, 6 BURNER | 6 burners on a stand; no 6-burner product (nearest are the 3-burner stoves CE-003 / CE-027). |
| p.6 | COMMERCIAL GAS RANGE OVEN, UPPER SHELF | 4 burners + oven + riser shelf; CE-014 uses the plainer static-oven range photo instead. |
| p.6 | ELECTRIC CREPE MAKER | No crepe maker product. |
| p.6 | 3 DECK CHINESE STEAMING CABINET | No Chinese steaming cabinet product (CE-011 is the single-door rice steamer). |
| p.7 | COUNTERTOP PIZZA OVEN WITH 2 LAYERS | Electric 2-layer countertop pizza oven; CE-012 is a floor-standing 2-deck gas oven. |
| p.7 | GAS CONVECTION OVEN WITH 4 TRAY CAPACITY | No convection oven product. |
| p.7 | COMMERCIAL GAS OVEN | Single-deck oven (same artwork as the electric-oven caption); no single-deck oven product. CE-012 is 2-deck gas. |
| p.7 | COMMERCIAL ELECTRIC OVEN | Same artwork as the gas-oven caption; no single-deck electric oven product. |
| p.7 | STAINLESS STEEL SINK TABLE WITH BACKSPLASH | Sink table with drainboard; PW-051 uses the equivalent 1-bowl photo. PW-005 is only 600 mm wide, so a bowl-plus-drainboard layout is unlikely; not mapped. |
| p.7 | STAINLESS STEEL KNEE-OPERATED HANDWASH SINK | No hand-wash sink product. |
| p.7 | STAINLESS STEEL 3 DECK 6 TRAY ELECTRIC OVEN WITH GAUGE CONTROL | 3-deck electric oven; CE-012 is 2-deck gas. |
| p.7 | CHICKEN ROTISSERIE OVEN | No rotisserie oven product. |
| p.7 | SMALL ROTISSERIE OVEN | No rotisserie oven product. |
| p.8 | STAINLESS STEEL EQUIPMENT STAND | Nearest are BA-005 (deck oven stand, heavy box-tube and cross-braced), PW-002 (movable on casters) and PW-029 (dish table): configurations differ, so none mapped. |
| p.8 | REFRIGERATED SALAD PREP COUNTER | No refrigerated prep counter product. |
| p.8 | REFRIGERATED PIZZA PREP TABLE | No pizza prep table product. |
| p.8 | COMMERCIAL REACH-IN CHILLER | No reach-in chiller product (RF-002 is a single-door glass display chiller). |
| p.8 | COMMERCIAL REACH-IN COMBI | No reach-in combi product. |
| p.8 | UNDERCOUNTER GLASS DOOR WORKTABLE CHILLER | Nearest is RF-006 (underbar chiller), but a glass-door worktable chiller is not confirmed to be the same item. |
| p.8 | CHILLED SANDWICH PREP COUNTER (COIL) | No sandwich prep counter product. |
| p.8 | STAINLESS STEEL FLOOR OPERATED HAND WASH SINK WITH BACKSPLASH | No hand-wash sink product. |
| p.8 | STAINLESS STEEL WORKTABLE | Worktable with tray rails; no matching product (PW-001/PW-017 are plain tables/frames). |
| p.9 | COMMERCIAL BLAST FREEZER | No blast freezer product. |
| p.9 | DRAWER REFRIGERATED CHEF BASE | No chef base product. |
| p.9 | STAINLESS STEEL WORKTABLE WITH BASE CABINET AND BACKSPLASH | Worktable with sliding-door base cabinet; no matching product (PW-047/PW-048 are countertop cabinets). |
| p.9 | STAINLESS STEEL WORKTABLE WITH BASE CABINET | Worktable with hinged-door base cabinet; no matching product. |
| p.9 | WALL TYPE CABINET WITH MIDSHELF AND SLIDING DOORS | Wall cabinet with sliding doors; PW-045/PW-046 hanging wall cabinets have butterfly (hinged) doors. |
| p.9 | WALL TYPE CABINET WITH MIDSHELF, SLIDING DOORS AND BACKSPLASH | Cabinet with backsplash and 3 doors; no matching product. |
| p.9 | CHROME PLATED WIRE SHELVINGS | Chrome wire shelving; no matching product (BA-004 is an SS bread cooling rack). |
| p.9 | VERTICAL CABINET UPRIGHT STORAGE | Tall sliding-door cabinet; PW-015/PW-038 storage cabinets have a different layout (3 layers with drain). |
| p.9 | WALL SHELF WITH SIDE GUARDS | Wall shelf with side guards (sloped); PW-023 uses the backsplash wall-shelf photo. |
| p.11 | IN-LINE CEILING EXHAUST FAN FOR RECATNGULAR [sic] DUCT | In-line ceiling exhaust fan box. EX-014 (blower box with belt drive) is plausible but the belt-drive/in-line configuration is unconfirmed - held back for owner decision. |
| p.11 | (no caption - exhaust system illustration) | Uncaptioned exhaust-system render (hood + ducting). Nearest are system/lot items EX-015 and EX-017, not mapped. |
| p.11 | (no caption - exhaust system illustration) | Uncaptioned exhaust-system render (hood + fan + ducting). Not mapped. |
| p.11 | (no caption - exhaust system illustration) | Uncaptioned exhaust-system render (hood + riser duct). Not mapped. |
| p.12 | SAFETY CONTROLS | Gas safety control (valve with controller); no matching product. |
| p.12 | SAFETY CONTROLS | Gas emergency shut-off solenoid valve; no matching product. |

### Held back - plausible, needs an owner decision

These could be added if you approve (the photos exist in the PDF; they are not exported yet because the mapping does not use them).

| Product | Candidate photo (PDF page) | Why held back |
|---|---|---|
| EX-014 Blower Box with Belt Drive | IN-LINE CEILING EXHAUST FAN FOR RECTANGULAR DUCT (p.11) | A box-type fan housing is plausible, but belt drive and in-line configuration cannot be confirmed from the photo. |
| EX-003 SS Exhaust Hood (Institutional Grade) | STAINLESS STEEL RANGE HOOD (p.11) | Same hood type as EX-001 / EX-002, but a different (heavy-duty institutional) product line. |
| BA-005 SS Heavy-Duty Deck Oven Stand | STAINLESS STEEL EQUIPMENT STAND (p.8) | The product is a heavy box-tube, cross-braced stand with proofer slots; the photo is a light table-style stand with one undershelf. |
| CE-029 SS 4 Open Top Combo (2 Low / 2 High Pressure) | OPEN GAS RANGE, 4 BURNER, NO STAND (p.6) | The defining Low/High burner split cannot be seen in the photo. |
| RF-006 Underbar Chiller | UNDERCOUNTER GLASS DOOR WORKTABLE CHILLER (p.8) | Underbar units are not confirmed to be this worktable-style glass-door chiller. |
| PW-010 SS Dish Rack (Movable, 4 Layer) | STAINLESS STEEL 4-TIER SLOTTED RACKS (p.9) | Four slotted layers match, but the product is on casters and the photo shows fixed feet (PW-030 is mapped instead). |

## Products without a photo, by category

| Category | Products | Mapped | Unmapped |
|---|---|---|---|
| Cooking Line | 31 | 10 | 21 |
| Preparation & Washing | 53 | 9 | 44 |
| Refrigeration | 6 | 2 | 4 |
| Baking | 12 | 1 | 11 |
| Exhaust System | 27 | 3 | 24 |
| Fresh Air System | 10 | 2 | 8 |
| Gas Line | 3 | 1 | 2 |
| Fire Suppression | 6 | 4 | 2 |
| Miscellaneous | 17 | 0 | 17 |
| **Total** | **165** | **32** | **133** |

## Technical notes

- **Source resolution is low.** The PDF embeds each product photo at about 150 dpi: 220 to 400 px square, saved as JPEG quality 60 with a JPEG soft mask. The 800 px and 400 px outputs are upscaled (about 2.7x for the 800 px size, with a light sharpen), so the pictures look soft at large sizes. Higher-resolution originals of the same equipment would improve every card.
- Several PDF images are mirrored on the page (the PDF flips them in layout). Each photo was exported in the orientation shown on the page, verified against a render of that page.
- Transparent edges were composited onto pure white (#FFFFFF), mask ringing was cleaned, and the result was trimmed to the product with a 5% margin. Aspect ratio is kept (no padding to 4:3).
- Two captions share one artwork on the PDF: *commercial gas oven* / *commercial electric oven* (single-deck oven; not mapped) and *undercounter door worktable chiller* / *undercounter worktable freezer* (both mapped). The two undercounter files are byte-identical copies under their own caption slugs.
- The three large exhaust-system renders on the PDF's exhaust page have no captions and are not product photos; they are not used.
- Slugs are the kebab-case of the PDF caption (`&` becomes `and`; the fire-suppression diagram takes its section name). Pages are numbered as in the PDF viewer (cover = p.1).

