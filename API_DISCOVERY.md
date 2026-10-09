## Selected API
- Endpoint: https://bff-gateway.zepto.com/user-search-service/api/v3/search
- Method: POST
- Auth: No explicit API key; access is gated by an AWS WAF challenge that must be solved by a real browser. Subsequent pages reuse the captured session headers + cookies (`aws-waf-token`, `session_id`, `csrfSecret`, `XSRF-TOKEN`) and the `request-signature` header.
- Pagination: `pageNumber` request body parameter
- Query parameters/body: `query`, `pageNumber`, `mode`, `userSessionId`
- Response format: JSON

## Selection Notes
- Returns JSON directly: Yes
- Field richness: High (nested product + variant + pricing + category + ratings + media fields)
- Pagination support: Yes (`pageNumber` + `hasReachedEnd`)
- Score summary (per apify-updater rubric): 80+

## Request Flow (verified)
1. A Playwright Firefox session opens the public search page. This solves the AWS WAF challenge and issues the session cookies.
2. The actor captures the live search XHR: request headers (including `cookie`, `request-signature`, CSRF headers), the request body (`userSessionId`), and the page-0 JSON payload.
3. The browser is closed. A single **impit** client (HTTP-only) replays page 1..N using the captured headers/session. The page-0 payload is used directly.

## Guest Session Warm-up (required for speed)
- Before the browser's guest session is authenticated, the search API answers `HTTP 299` with `{"error_code":"LOGIN_REQUIRED","message":"Oops! Please login to continue searching"}`. That response has no products.
- A short warm-up navigation to the storefront (`https://www.zepto.com/`) followed by a ~3s pause lets the guest session complete, so the **first** search navigation returns `HTTP 200` with products.
- Without the warm-up, the first browser instance can stay stuck on `LOGIN_REQUIRED` indefinitely and only a freshly launched browser returns `200` (this was the cause of slow ~50s runs). The warm-up removes that wasted retry cycle.

## Impit Conversion Findings
- AWS WAF blocks plain HTTP requests with `HTTP 202` + `x-amzn-waf-action: challenge`, regardless of the impit browser profile. A browser bootstrap is therefore required before impit can fetch data.
- With the full captured header set + session cookie, impit returns `HTTP 200` JSON.
- Browser profile matrix (tested against the live endpoint with the full captured header set):
  - `chrome`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`, `chrome124`, `chrome125`, `chrome131`, `chrome136`, `chrome142`, `chrome151` - 200 OK
  - `firefox`, `firefox128`, `firefox133`, `firefox135`, `firefox144` - 200 OK
  - `okhttp`, `okhttp3`, `okhttp4`, `okhttp5` - 200 OK
  - `ios18` - 429 (mobile fingerprint conflicts with the captured desktop session) - rejected
  - `chrome` is selected as the documented default; every desktop profile passes, so the choice is not fingerprint-sensitive.
- Without the session cookie: `202 challenge`. With a partial header set (missing `request-signature`/CSRF): `429`.

## Fields Available (API)
- Product identity: `id`, `objectId`, `product.id`, `productVariant.id`, `storeId`
- Product details: `product.name`, `product.brand`, `product.countryOfOrigin`, `product.description`, `product.manufacturerName`
- Category data: `primaryCategoryName`, `primaryCategoryId`, `product.primarySubcategory`
- Variant data: `productVariant.formattedPacksize`, `productVariant.packsize`, `productVariant.unitOfMeasure`, `productVariant.weightInGms`
- Price and discount: `mrp`, `sellingPrice`, `discountedSellingPrice`, `discountAmount`, `discountPercent`, `superSaverSellingPrice`, `zeptoPassPrice`
- Availability: `availableQuantity`, `quantity`, `outOfStock`, `isActive`, `isBestOffer`, `isNewProduct`
- Ratings: `productVariant.ratingSummary.averageRating`, `productVariant.ratingSummary.totalRatings`
- Media and labels: `productVariant.images[]`, `productCardTags`

## Resilience / Auto-Healing
- Bounded retry with exponential backoff + jitter for `429`, `5xx`, timeouts, and network errors.
- On `202`/`401`/`403`/`x-amzn-waf-action: challenge`, the actor re-runs the browser bootstrap to obtain a fresh session (bounded to `MAX_SESSION_REFRESHES`), then retries the page.
- Per-page failures are isolated; pagination stops gracefully and already-saved data is preserved.
- Responses are validated (status, parsed JSON shape) before nested access; malformed pages produce a concise warning instead of crashing.
- The browser capture waits for and prefers a page-0 response that actually contains products. If page 0 is empty, the whole session setup is retried (bounded). This fixed a real transient cloud failure where the first captured page-0 response was empty and a later one was populated (`Captured page 0 returned no products; retrying session setup`).

## Current Output Strategy (Flat + Clean)
- Keep only flat scalar fields and small scalar arrays (e.g., `attribute_tags`)
- Remove null/undefined/empty-string values
- Convert paise values to INR rupees
- Keep deterministic deduplication by product/store-level id
- Include run metadata: `search_query`, `page_number`, `scraped_at`

## Fields Previously Missing / Unclean in Output
- Previous dataset rows stored full nested raw payload objects
- Null-heavy nested objects and label blobs increased noise
- Output now targets consistent flat records with meaningful business values only
