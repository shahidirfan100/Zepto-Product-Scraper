# Zepto API Discovery

Last verified: 2026-11-06.

Read this file before changing request code. It records what the live site actually does, which
requests work, and how each failure looks. The actor is built around these facts, so guessing at
new endpoints or headers usually makes reliability worse.

## Selected source

- Current desktop and lite search endpoint:
  `GET https://bff-gateway.zepto.com/search-federator-service/api/v1/search?query=...&mode=SHOW_ALL_RESULTS&pageNumber=N`
  (lite uses the same path on `bff-gateway.zeptonow.com`).
- The older `POST .../user-search-service/api/v3/search` endpoint is still seen in some sessions and
  remains supported. The actor captures whichever one the page actually calls.
- Request body for the older endpoint: `{"query": "...", "pageNumber": 0, "mode": "SHOW_ALL_RESULTS", "userSessionId": "..."}`.
  The federator endpoint uses query parameters and has no body.
- Response: JSON with a `layout` array of widgets. Product cards live in `PRODUCT_GRID` /
  `SEARCHED_PRODUCTS` widgets at `data.resolver.data.items[].productResponse`.
- Pagination: `pageNumber` in the body or URL. `nextPageParams.pageNumber` usually points at the
  next page. `hasReachedEnd` marks the last page. Page sizes vary (30 on page 0, 21-30 on later
  pages in testing).
- Auth: no API key or account. Access is gated by AWS WAF plus per-session request headers. The
  browser obtains both, then the page's own `fetch` replays the request.

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
4. If the IP resolves no serviceable store, set the `user_position` cookie to the fallback Indian
   location and reload. The store is then resolved from those coordinates instead of the exit IP.
5. Open the search URL. The page fires the real search XHR (federator GET or older v3 POST).
6. Capture the XHR URL, HTTP method, request headers, request body, and page 0 JSON. The capture is
   identified by the payload shape and `SEARCHED_PRODUCTS` widgets, not by a hardcoded path.
7. Keep the browser open and replay page 1..N with the page's own `fetch`, using the captured
   headers and the same HTTP method and pagination style.
8. If replay is rejected or unusable, scroll the open page. The site then fires its own page
   requests with fresh signatures, and the actor reads those responses.
9. If the captured endpoint rejects a page, retry that page through the older v3 POST endpoint with
   the same headers. This often works when the federator GET asks for a login.
10. If every direct session attempt is login-walled and the caller did not configure a proxy, retry
    session setup once with an Apify Indian residential proxy.

Lite variant:

1. Launch Firefox with a mobile Safari user agent and a 390x844 viewport.
2. Open `https://lite.zeptonow.com/`, then `https://lite.zeptonow.com/search?query=...`.
3. The lite page sets its own guest session and store cookies. The search XHR goes to
   `bff-gateway.zeptonow.com` and returns the same `layout` payload.
4. Capture and replay the same way.

The actor tries the desktop variant first, then the lite variant. The same storefront is retried only
for transient failures; `LOGIN_REQUIRED`, `BLOCKED`, and `UNSERVICEABLE` move straight to the other
variant because the IP and location did not change. If the current session later expires, the refresh
keeps the variant and location that were working.

## Storefront variants

| Variant | URL | User agent | API host | Store behavior |
|---|---|---|---|---|
| desktop | `https://www.zepto.com/search?query=...` | Firefox default | `bff-gateway.zepto.com` | Store from IP geolocation |
| lite | `https://lite.zeptonow.com/search?query=...` | iPhone Safari 18.5 | `bff-gateway.zeptonow.com` | Sets its own store cookies on load |

Evidence from live testing on 2026-11-06:

- The search call moved from the v3 `user-search-service` POST to the federator GET. The rendered
  page still returned products, but an actor listening only for the old path captured nothing. This
  was the main cause of intermittent "Search page returned no product data" failures.
- From a non-India IP, the homepage returned no serviceable store. Setting `user_position` to
  Bengaluru (`12.96902, 77.75395`) produced a serviceable store and 30 products on page 0.
- The desktop storefront still answered `299 LOGIN_REQUIRED` on some attempts even after the
  location fallback. The lite storefront returned 30 products in the same run.
- The lite payload had the same top-level keys and the same `PRODUCT_GRID` / `SEARCHED_PRODUCTS`
  nesting. Brand, pack, price, rating, and description were all present.
- GET replay worked immediately with the captured headers: page 0 and page 1 both returned 30
  products. Replaying the same headers minutes later returned `299 LOGIN_REQUIRED`, so the session
  is short lived and must be used promptly.
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
`sec-ch-*`. The actor drops those and lets the browser supply a coherent set.
`content-type` is sent only for POST replays; the federator GET has no body.

Tests that established this:

| Header set | Page 0 | Page 1 | Result |
|---|---|---|---|
| Full captured set | 200 | 200 | Works |
| Captured set minus `request-signature` | 429 | 429 | Signature is required |
| Captured set minus browser fingerprint headers | 200 | 200 | Works, cleaner fingerprint |
| Cookie only, no app headers | 429 | 429 | App headers are required |

`request-signature` changed on each page request in testing, but replaying page 1 with the page-0
signature still returned 200. The server does not appear to bind it to the body or page today. Keep
reusing the captured set, but do not assume this will always hold. The browser fallback covers the
case where it changes.

The captured session is short lived. Replaying the same headers a few minutes later returned
`299 LOGIN_REQUIRED`, so replay page 1+ immediately after capture.

## Browser fetch replay

Pages 1..N are fetched with the browser's own `fetch` from the open Firefox page, not with a separate
HTTP client. The browser already holds the WAF token, cookies, TLS fingerprint, origin, referer, and
`sec-fetch-*` headers, so replay uses the same network identity that passed the challenge.

- GET federator: set `query`, `mode`, and `pageNumber` in the URL and send no body.
- POST v3: send `{"query","pageNumber","mode":"SHOW_ALL_RESULTS","userSessionId"}`.
- Drop `cookie`, `user-agent`, `accept-language`, `origin`, `referer`, `sec-*`, `host`, and
  `content-length` from the captured headers; the browser supplies them.
- Keep `store_id`, `storeid`, `request-signature`, `x-csrf-secret`, `x-xsrf-token`,
  `marketplace_type`, `x-timezone`, `compatible_components`, and the app/device headers.

Verified live on 2026-11-06: federator page 1 returned 200 with 30 products, v3 page 0 returned 66
products, and v3 page 1 returned 36 products from the same page context. This replaced the earlier
impit TLS-profile matrix; browser fetch avoids TLS fingerprint mismatches and profile-specific
connection resets.

## Failure map

| Symptom | Meaning | Actor response |
|---|---|---|
| HTTP `202` with `x-amzn-waf-action: challenge` | WAF challenge on the request. The token is missing, expired, or bound to a different session. | Refresh the browser session, then retry the page. |
| HTTP `299` with `{"error_code":"LOGIN_REQUIRED"}` | The guest session is not authenticated, expired, or the IP is being asked to log in. | Recover page 0 through the v3 POST endpoint. On setup, then try the other storefront variant. If no proxy is configured and both storefronts ask for login, retry once with an Apify Indian residential proxy. Mid-run, refresh the session. |
| Search page renders products but no XHR is captured | The search microservice path changed (v3 -> federator) or the request was not XHR/fetch. | Detect the response by payload shape and `SEARCHED_PRODUCTS` widgets, not by URL. |
| Replay returns `400` or `405` | Replay used the wrong HTTP method or sent a body to a GET endpoint. | Match the captured method and pagination style: GET query parameters or POST JSON body. Fall back to the v3 POST endpoint. |
| HTTP `429`, empty body | Missing or invalid signature/CSRF headers, not simple rate limiting. | Refresh the session. |
| HTTP `429` with a JSON body | Rate limited. | Bounded backoff, then retry. |
| HTTP `401` or `403` | Session rejected. | Refresh the session. |
| HTTP `5xx` | Upstream failure. | Bounded retry with backoff. |
| Connection reset / `ECONNRESET` / timeout | CDN or TLS connection dropped. | Retry, then refresh the session if it continues. |
| HTTP `200` with no `layout` | Response shape changed or a partial body was returned. | Stop the structured path and use the rendered-page fallback. |
| HTTP `200`, `pageProductCount: 0`, `totalProductCount: 0` | The query has no results. | Stop and fail with a clear message if nothing was saved. |
| Page shows `Sit Tight` or `Coming Soon` | No serviceable store for the request IP. | Apply the Indian `user_position` location fallback, then try the lite variant. If both fail, fail with the store message. |
| Page shows a CAPTCHA or access-denied page | Browser challenge escalation. | Try the other storefront, then the automatic Indian residential proxy fallback (when no proxy was configured). If it still fails, fail with a proxy hint. |

## Diagnostics when a run fails

1. Read the run log for the first warning. `Session setup failed` means the browser never got a
   usable page 0. `Page N rejected` means replay stopped working mid-run.
   `No serviceable Zepto store for this IP; retrying with an Indian delivery location` is a normal
   recovery step, not a failure. `Direct IP could not open a search session; retrying with an Apify
   Indian residential proxy` is the last-resort IP fallback.
2. Check whether the failure is `299` (guest session) or `202`/`429` empty (WAF or headers). The log
   records the HTTP status.
3. Confirm the endpoint path still exists. The actor uses the URL it captured from the page, so a
   path change inside the site is picked up automatically. A hardcoded path is only mentioned in
   docs. If the page renders products but no request is captured, compare the live network tab with
   the payload guard in `attachCaptureListeners`.
4. Confirm the captured request method. Federator search is a GET with query parameters; the older
   v3 endpoint is a POST with a JSON body. Replaying one in the other shape returns `400`/`405`.
5. Confirm the response still has `layout[].data.resolver.data.items[].productResponse`. If the
   widget nesting changed, the generic fallback still finds `product` + `productVariant` nodes, but
   inspect the payload before changing the extractor.
6. Re-run the actor with `max_pages: 1` and `results_wanted: 5`. If that succeeds, the session
   works and the problem is pagination. If it fails, the problem is session setup.
7. Check the input. `query` wins over `startUrl`. A `startUrl` without a `query` parameter falls back
   to the default search URL.

## Response shape

- `layout[]`: ordered widgets. `PRODUCT_GRID` and `SEARCHED_PRODUCTS_*` widgets hold products.
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
- The captured session is short lived. A long run may need a session refresh; the actor does that
  automatically.
- The actor does not slow successful requests. Backoff is limited to retries.
- Each run reuses one proxy URL for both the browser and its fetches so the store and IP stay
  consistent. A mid-run proxy rotation would change prices and availability.

## Store and location

- The delivery store normally comes from Zepto's IP geolocation. Datacenter and non-India IPs often
  resolve no serviceable store.
- When no store is serviceable, the actor sets the `user_position` cookie to
  `{"latitude":12.96902,"longitude":77.75395}` (Bengaluru) and reloads. The cookie is set before
  navigation on later attempts and applies to both `zepto.com` and `zeptonow.com`.
- This fallback is used only after the natural IP attempt fails, so a run from a good Indian IP
  keeps its own store. When the fallback is used, the log says
  `No serviceable Zepto store for this IP; retrying with an Indian delivery location`.
- Prices, stock, and delivery estimates belong to the resolved store. The dataset records `store_id`
  so rows from different runs can be compared correctly.
- An Indian residential proxy changes the store. With the location fallback, a proxy is optional for
  getting data, but a residential proxy still gives the most accurate local pricing.
- If the direct IP is login-walled and no proxy was configured, the actor retries session setup once
  with an Apify Indian residential proxy. A proxy configured by the caller is used as-is.
- Datacenter proxy IPs are often blocked by Zepto's WAF or login wall. Prefer residential IN when a
  proxy is required.
- There is no location input in the current contract. Adding one would require replicating the
  site's address flow, which is a separate project.

## Reproduction notes

The discovery scripts used to verify this file were temporary and are not part of the actor. To
re-check the live behavior, use the actor itself with a small input and read the log. For raw
inspection, open the search page in Firefox, watch the Network tab for the search request (federator
GET or v3 POST), and compare the request headers with the list above.
