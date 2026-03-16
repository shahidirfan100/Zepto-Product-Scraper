# API Discovery - Zepto Product Scraper

## Existing Actor Audit (Before Upgrade)

Previous actor state (Remote.co jobs scraper) extracted only job-centric fields:
- `title`
- `company`
- `category`
- `location`
- `date_posted`
- `description_html`
- `description_text`
- `url`

This did not match Zepto product search use cases.

## Missing Fields Needed for Zepto

For product intelligence use cases, these were missing:
- Product IDs and variant IDs
- Brand and category IDs
- Pack size and unit of measure
- Availability / out-of-stock flags
- MRP, selling price, discounted price, discount percentage
- Rating average and rating count
- Image URLs
- Store ID and query context

## URLScan + Live Network Discovery

Primary discovery sources:
- URLScan domain search for `zepto.com`
- Live browser network capture on `https://www.zepto.com/search?query=Chocolate`

Discovered endpoints:
- `GET https://www.zepto.com/search?_rsc=...` (RSC payload)
- `POST https://bff-gateway.zepto.com/user-search-service/api/v3/search`
- `POST https://bff-gateway.zepto.com/user-search-service/api/v3/search/filters`

## Selected API

- Endpoint: `https://bff-gateway.zepto.com/user-search-service/api/v3/search`
- Method: `POST`
- Auth: Session headers required (captured from live browser session)
- Pagination: `pageNumber` in request body + `hasReachedEnd` in response
- Request body shape:
  - `query` (string)
  - `pageNumber` (integer)
  - `mode` (`SHOW_ALL_RESULTS`)
  - `userSessionId` (string)

### Field Availability

Top-level response fields include:
- `layout`, `currentPage`, `pageProductCount`, `totalProductCount`, `hasReachedEnd`, `filters`, `pageMeta`, etc.

Product-level fields include (non-exhaustive):
- `id`, `objectId`, `storeId`
- `product.*` (name, brand, brandId, primarySubcategory, etc.)
- `productVariant.*` (id, formattedPacksize, images, mrp, ratingSummary, unitOfMeasure, quantity)
- Price and discount fields (`mrp`, `sellingPrice`, `discountedSellingPrice`, `discountPercent`, `discountAmount`)
- Availability fields (`availableQuantity`, `outOfStock`)

## Scoring

| Score Factor | Points |
|---|---:|
| Returns JSON directly | +30 |
| Has >15 unique fields | +25 |
| No login required for public search | +20 |
| Supports pagination | +15 |
| Extends previous fields substantially | +10 |
| **Total** | **100** |

Selected endpoint exceeds the minimum score (50) and is the richest source for production extraction.
