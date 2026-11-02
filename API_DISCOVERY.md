# Zepto API Discovery

Last verified: 2026-11-02.

Read this file before changing request code. It records what the live site actually does, which
requests work, and how each failure looks. The actor is built around these facts, so guessing at
new endpoints or headers usually makes reliability worse.

## Selected source

- Desktop search endpoint: `POST https://bff-gateway.zepto.com/user-search-service/api/v3/search`
- Lite search endpoint: `POST https://bff-gateway.zeptonow.com/user-search-service/api/v3/search`
- Request body: `{"query": "...", "pageNumber": 0, "mode": "SHOW_ALL_RESULTS", "userSessionId": "..."}`
- Response: JSON with a `layout` array of widgets. Product cards live in `PRODUCT_GRID` widgets at
  `data.resolver.data.items[].productResponse`.
- Pagination: `pageNumber` in the body. `nextPageParams.pageNumber` usually points at the next page.
  `hasReachedEnd` marks the last page. Page sizes vary (30 on page 0, 21 on later pages in testing).
- Auth: no API key or account. Access is gated by AWS WAF plus per-session request headers. The
  browser obtains both, then impit replays the request.

Both storefronts return the same payload shape and field set. The desktop host is tried first. The
lite host is the fallback when the desktop session demands a login.

## Why this source

- It returns the same data the rendered page uses, including brand, category, package, prices,
  stock, ratings, and images. DOM parsing loses fields and breaks when markup changes.
- The response shape is stable across pages and queries.
- Page requests are fast once the session exists (about 0.6 to 1.5 seconds per page).
- A rendered-page fallback exists if replay breaks, so the actor can still finish.

## Request flow

Desktop variant:

1. Launch Firefox headless with the configured proxy.
2. Open `https://www.zepto.com/`. This solves the AWS WAF challenge and sets the `aws-waf-token`
   cookie. The site also resolves a delivery store from the request IP and sends
   `lms/api/v2/get_page` with the store coordinates.
3. Wait for that store call and let the guest session settle. Without this wait, the first search
   request can answer `299 LOGIN_REQUIRED`.
4. Open the search URL. The page fires the real search XHR.
5. Capture the XHR URL, request headers, request body, and page 0 JSON.
6. Keep the browser open and replay page 1..N with impit using the captured headers.
7. If replay is rejected or unusable, scroll the open page. The site then fires its own page
   requests with fresh signatures, and the actor reads those responses.

Lite variant:

1. Launch Firefox with a mobile Safari user agent and a 390x844 viewport.
2. Open `https://lite.zeptonow.com/`, then `https://lite.zeptonow.com/search?query=...`.
3. The lite page sets its own guest session and store cookies. The search XHR goes to
   `bff-gateway.zeptonow.com` and returns the same `layout` payload.
4. Capture and replay the same way.

The actor tries the desktop variant twice, then the lite variant twice. If the current session later
expires, the refresh keeps the variant that was working and falls back to the other one only if
needed.

## Storefront variants

| Variant | URL | User agent | API host | Store behavior |
|---|---|---|---|---|
| desktop | `https://www.zepto.com/search?query=...` | Firefox default | `bff-gateway.zepto.com` | Store from IP geolocation |
| lite | `https://lite.zeptonow.com/search?query=...` | iPhone Safari 18.5 | `bff-gateway.zeptonow.com` | Sets its own store cookies on load |

Evidence from live testing on 2026-11-02:

- The desktop storefront began answering `299 LOGIN_REQUIRED` from one IP while the lite storefront
  returned 30 products from the same IP in the same minute.
- The lite payload had the same top-level keys and the same `PRODUCT_GRID` nesting. Brand, pack,
  price, rating, and description were all present.
- A run that started when both storefronts briefly asked for login recovered on the desktop retry,
  then finished 60 products through the rendered-page fallback after replay resets.
- The lite storefront does not need the desktop store-selection step. It sets `marketplace` and
  `serviceability` cookies during load.
- The lite run used two different `store_id` values across pages, while desktop runs kept one. Prices
  can therefore mix stores on lite. Keep desktop first for consistent pricing and use lite as the
  recovery path.

## Header requirements

Replay works only with the captured session headers. The values are short lived, produced by the
page, and must never be hardcoded.

Required in practice:

- `cookie` (includes `aws-waf-token`, `device_id`, `session_id`, `csrfSecret`, `XSRF-TOKEN`)
- `request-signature`
- `x-csrf-secret`
- `x-xsrf-token`
- `store_id`, `storeid`, `store_ids`, `store_etas`
- `device_id`, `deviceid`, `session_id`, `sessionid`
- `app_version`, `appversion`, `platform`, `app_sub_platform`, `tenant`, `source`
- `marketplace_type`, `x-timezone`, `compatible_components`

Not required: `user-agent`, `accept`, `accept-language`, `accept-encoding`, `sec-fetch-*`,
`sec-ch-*`. The actor drops those and lets the impit profile supply a coherent set.

Tests that established this:

| Header set | Page 0 | Page 1 | Result |
|---|---|---|---|
| Full captured set | 200 | 200 | Works |
| Captured set minus `request-signature` | 429 | 429 | Signature is required |
| Captured set minus browser fingerprint headers | 200 | 200 | Works, cleaner fingerprint |
| Cookie only, no app headers | 429 | 429 | App headers are required |

`request-signature` did not change between requests with a different `query` or `pageNumber` in
testing. That means the server does not bind it to the body today. Keep reusing the captured set,
but do not assume this will always hold. The browser fallback covers the case where it changes.

## Impit profile matrix

Tested against the live endpoint with a fresh captured session. A fresh session per profile is
required because the WAF token expires and rate limits distort results.

| Profile | Page 0 | Page 1 | Notes |
|---|---|---|---|
| `chrome` | 200 | 200 | Selected default |
| `okhttp4` | 200 | 200 | Selected fallback |
| `firefox` | 200 | 200 | Selected fallback |
| `ios18` | 200 | 200 | Works, but mobile fingerprint adds no value |
| `chrome104`, `chrome125`, `chrome131`, `chrome136`, `chrome142` | 200 | 200 | Worked in burst tests |
| `chrome142` | reset | reset | Failed in a fresh-session test, excluded |
| `chrome100`, `chrome101`, `chrome107`, `chrome110`, `chrome116`, `chrome124`, `chrome151` | mixed | mixed | Connection resets under load, unreliable |
| `firefox128`, `firefox144` | 200 | 200 | Work |
| `firefox133`, `firefox135` | mixed | mixed | Resets |
| `okhttp`, `okhttp3`, `okhttp5` | mixed | mixed | `okhttp5` timed out |
| No profile | mixed | mixed | Not used |

The profile rotation is `chrome` -> `okhttp4` -> `firefox`. Rotation happens only after a network
failure, timeout, or 5xx.

Lite replay was checked separately with the lite host and its own captured session:

| Profile | Page 0 | Page 1 | Page 2 |
|---|---|---|---|
| `ios18` | 200 | 200 | 299 |
| `chrome` | reset | 200 | 200 |
| `firefox` | reset | 200 | 200 |
| `okhttp4` | reset | reset | reset |

The resets are connection-level, not HTTP rejections, and the same rotation recovers them.

## Failure map

| Symptom | Meaning | Actor response |
|---|---|---|
| HTTP `202` with `x-amzn-waf-action: challenge` | WAF challenge on the request. The token is missing, expired, or bound to a different session. | Refresh the browser session, then retry the page. |
| HTTP `299` with `{"error_code":"LOGIN_REQUIRED"}` | The guest session is not authenticated, expired, or the IP is being asked to log in. | On setup, try the other storefront variant. Mid-run, refresh the session. If both storefronts ask for login, fail with a proxy hint. |
| HTTP `429`, empty body | Missing or invalid signature/CSRF headers, not simple rate limiting. | Refresh the session. |
| HTTP `429` with a JSON body | Rate limited. | Bounded backoff, then profile rotation. |
| HTTP `401` or `403` | Session rejected. | Refresh the session. |
| HTTP `5xx` | Upstream failure. | Bounded retry with backoff, then profile rotation. |
| Connection reset / `ECONNRESET` / timeout | CDN or TLS connection dropped. Common with some TLS profiles. | Retry, then rotate profile. This is why three profiles exist. |
| HTTP `200` with no `layout` | Response shape changed or a partial body was returned. | Stop the structured path and use the rendered-page fallback. |
| HTTP `200`, `pageProductCount: 0`, `totalProductCount: 0` | The query has no results. | Stop and fail with a clear message if nothing was saved. |
| Page shows `Sit Tight` or `Coming Soon` | No serviceable store for the request IP. | Try the lite variant. If that fails too, fail with the store message. |
| Page shows a CAPTCHA or access-denied page | Browser challenge escalation. | Fail with a hint to use an Indian residential proxy. |

## Diagnostics when a run fails

1. Read the run log for the first warning. `Session setup failed` means the browser never got a
   usable page 0. `Page N rejected` means replay stopped working mid-run.
2. Check whether the failure is `299` (guest session) or `202`/`429` empty (WAF or headers). The log
   records the HTTP status.
3. Confirm the endpoint path still exists. The actor uses the URL it captured from the page, so a
   path change inside the site is picked up automatically. A hardcoded path is only used in docs.
4. Confirm the response still has `layout[].data.resolver.data.items[].productResponse`. If the
   widget nesting changed, the generic fallback still finds `product` + `productVariant` nodes, but
   inspect the payload before changing the extractor.
5. Re-run the actor with `max_pages: 1` and `results_wanted: 5`. If that succeeds, the session
   works and the problem is pagination. If it fails, the problem is session setup.
6. Check the input. `query` wins over `startUrl`. A `startUrl` without a `query` parameter falls back
   to the default search URL.

## Response shape

- `layout[]`: ordered widgets. `PRODUCT_GRID` widgets hold products.
- `pageProductCount`: products on this page.
- `totalProductCount`: total matching products.
- `currentPage`: page index.
- `hasReachedEnd`: last page flag.
- `nextPageParams.pageNumber`: suggested next page.
- Product entry: `productResponse` with `objectId`, `id`, `storeId`, `product`, `productVariant`,
  `mrp`, `sellingPrice`, `discountedSellingPrice`, `discountAmount`, `discountPercent`,
  `availableQuantity`, `outOfStock`, `superSaverSellingPrice`, `zeptoPassPrice`,
  `productCardTags`, `primaryCategoryName`, `primaryCategoryId`, `primarySubcategoryId`.
- `product`: `id`, `name`, `brand`, `countryOfOrigin`, `manufacturerName`, `description`,
  `howToUse`, `primarySubcategory`.
- `productVariant`: `id`, `formattedPacksize`, `packsize`, `unitOfMeasure`, `weightInGms`,
  `maxAllowedQuantity`, `shelfLifeInHours`, `fssaiLicense`, `images[]`, `ratingSummary`.

All prices are paise. The actor divides by 100 and drops non-positive optional prices.

Sponsored brand carousels also contain `productResponse` objects nested under a brand item. Reading
only `PRODUCT_GRID` items avoids adding those to the dataset. A recursive fallback exists only for a
changed payload shape and stops descending once it matches a product node.

## Rejected candidates

- Cold HTTP to the search API without a browser session: `202` challenge. The WAF needs a real
  browser to solve its challenge.
- Search page HTML without JavaScript: the SPA shell only, no product data.
- `_next/data` route: no build data is exposed for these pages.
- `www.zeptonow.com`, `shop.zeptonow.com`, `bff-gateway.zeptonow.com` at the root: same WAF
  challenge as the desktop host. The root is not usable, but the lite storefront paths are.
- `lite.zeptonow.com`: not rejected. It is the selected fallback and returns the same payload with a
  mobile Safari user agent. See the storefront variants section.
- `api.zepto.com` and `api.zepto.co.in`: every probed path returned `404` with an empty body. They
  are not the mobile search surface.
- `cdn.zeptonow.com`: image CDN only.
- Zepto MCP (`mcp.zepto.co.in`): requires OAuth with an Indian mobile number. Not usable for an
  unattended Actor.
- Third-party APIs (Upscrape, Scrape.do, Bright Data): they work, but they need a paid key and add a
  dependency the Actor does not need.
- DOM-only parsing: it works but loses fields and is fragile. It is used only as a fallback.

## Session lifetime and pacing

- The WAF token and session headers lasted minutes in testing, not hours. A run that finishes in
  under about two minutes usually needs one session.
- Bursts of mixed-profile requests can invalidate the session. The actor uses one profile until a
  real failure, then rotates.
- The actor does not slow successful requests. Backoff is limited to retries.
- Each run reuses one proxy URL for both the browser and impit so the store and IP stay consistent.
  A mid-run proxy rotation would change prices and availability.

## Store and location

- The delivery store comes from Zepto's IP geolocation. From a non-India IP in testing, Zepto
  resolved a Bangalore store, and search returned products.
- Prices, stock, and delivery estimates belong to that store. The dataset records `store_id` so
  rows from different runs can be compared correctly.
- An Indian residential proxy changes the store. This is the only supported way to influence it
  without adding location inputs.
- There is no location input in the current contract. Adding one would require replicating the
  site's address flow, which is a separate project.

## Reproduction notes

The discovery scripts used to verify this file were temporary and are not part of the actor. To
re-check the live behavior, use the actor itself with a small input and read the log. For raw
inspection, open the search page in Firefox, watch the Network tab for the `v3/search` XHR, and
compare the request headers with the list above.
