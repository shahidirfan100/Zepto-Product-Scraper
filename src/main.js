import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { firefox } from 'playwright';

// When a run fails, read API_DISCOVERY.md before changing request code. It records the live session flow.
const SEARCH_API_MARKER = '/user-search-service/api/v3/search';
const DEFAULT_SEARCH_URL = 'https://www.zepto.com/search?query=Chocolate';
const HOMEPAGE_URL = 'https://www.zepto.com/';
const LITE_SEARCH_URL = 'https://lite.zeptonow.com/search';
const LITE_HOMEPAGE_URL = 'https://lite.zeptonow.com/';
const LITE_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const DESKTOP_VIEWPORT = { width: 1366, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const SESSION_VARIANTS = ['desktop', 'lite'];

// Fresh sessions accepted all three profiles in testing. chrome142 reset connections,
// so it is excluded from the rotation.
const IMPIT_PROFILES = ['chrome', 'okhttp4', 'firefox'];

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const BLOCKED_URL_PARTS = [
    'google-analytics',
    'googletagmanager',
    'doubleclick',
    'connect.facebook.net',
    'hotjar',
    'clarity.ms',
];

const NAVIGATION_TIMEOUT_MS = 45000;
const CAPTURE_WAIT_MS = 15000;
const CAPTURE_POLL_MS = 250;
const HOME_SETTLE_MS = 3000;
const MAX_SESSION_ATTEMPTS = 2;
const MAX_SESSION_REFRESHES = 2;
const MAX_PAGE_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_SCROLL_STEPS = 40;
const SCROLL_WAIT_MS = 900;
const MAX_EMPTY_SCROLLS = 3;

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 5;

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const backoffDelay = (attempt, baseMs = 900) => {
    const exponential = baseMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 350);
    return Math.min(exponential + jitter, 8000);
};

const normalizeString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

const shortError = (error) =>
    String(error?.message || error || 'unknown error')
        .split('\n')[0]
        .slice(0, 180);

const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const toUrl = (value) => {
    try {
        return new URL(value);
    } catch {
        return undefined;
    }
};

const resolveSearchContext = ({ query, startUrl }) => {
    const keyword = normalizeString(query);

    if (keyword) {
        const target = new URL(DEFAULT_SEARCH_URL);
        target.searchParams.set('query', keyword);
        return { searchQuery: keyword, searchUrl: target.toString() };
    }

    const rawUrl = normalizeString(startUrl);
    const url = toUrl(rawUrl);
    const fromUrl = url?.searchParams.get('query');
    if (rawUrl) {
        if (!url || !fromUrl?.trim()) {
            throw new Error(
                'startUrl must be a valid Zepto search URL with a query parameter, or use the query field instead.',
            );
        }
        return { searchQuery: fromUrl.trim(), searchUrl: url.toString() };
    }

    const target = new URL(DEFAULT_SEARCH_URL);
    const fallbackQuery = target.searchParams.get('query');
    return { searchQuery: fallbackQuery, searchUrl: target.toString() };
};

const buildVariantSearchUrl = (query, variant) => {
    const target = new URL(variant === 'lite' ? LITE_SEARCH_URL : DEFAULT_SEARCH_URL);
    target.searchParams.set('query', query);
    return target.toString();
};

const productId = (item) => item?.objectId || item?.id || item?.productVariant?.id || item?.product?.id;

const isProductNode = (node) =>
    Boolean(node && typeof node === 'object' && node.product && node.productVariant && productId(node));

const extractProducts = (payload) => {
    const products = [];
    const seen = new Set();

    const push = (node) => {
        if (!isProductNode(node)) return;
        const id = productId(node);
        if (seen.has(id)) return;
        seen.add(id);
        products.push(node);
    };

    // The grid widget wraps every card as item.productResponse. Sponsored brand
    // carousels nest unrelated products deeper in an item, so only read this level.
    const layout = Array.isArray(payload?.layout) ? payload.layout : [];
    for (const widget of layout) {
        const items = widget?.data?.resolver?.data?.items;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            push(item?.productResponse);
            push(item?.data);
        }
    }
    if (products.length > 0) return products;

    const walk = (node) => {
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }
        if (!node || typeof node !== 'object') return;
        if (isProductNode(node)) {
            push(node);
            return;
        }
        for (const value of Object.values(node)) walk(value);
    };
    walk(payload);

    return products;
};

const toRupees = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return Number((amount / 100).toFixed(2));
};

const buildImageUrl = (imagePath) => {
    if (typeof imagePath !== 'string' || !imagePath.trim()) return undefined;
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    return `https://cdn.zeptonow.com/production/${imagePath.replace(/^\/+/, '')}`;
};

const normalizeTextList = (value) => {
    if (Array.isArray(value)) {
        const items = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
        return items.length > 0 ? items.join(' | ') : undefined;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
};

const extractAttributeTags = (item) => {
    const tags = item?.productCardTags?.slot3;
    if (!Array.isArray(tags)) return undefined;

    const values = [
        ...new Set(
            tags
                .filter((tag) => tag?.tagType === 'ATTRIBUTE' && typeof tag?.tagName === 'string')
                .map((tag) => tag.tagName.trim())
                .filter(Boolean),
        ),
    ];

    return values.length > 0 ? values : undefined;
};

const cleanFlatRecord = (record) => {
    const cleaned = {};

    for (const [key, value] of Object.entries(record)) {
        if (value === null || value === undefined) continue;

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) continue;
            cleaned[key] = trimmed;
            continue;
        }

        if (typeof value === 'number') {
            if (!Number.isFinite(value)) continue;
            cleaned[key] = value;
            continue;
        }

        if (typeof value === 'boolean') {
            cleaned[key] = value;
            continue;
        }

        if (Array.isArray(value)) {
            const normalized = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
            if (normalized.length > 0) cleaned[key] = normalized;
        }
    }

    return cleaned;
};

const mapProductItem = ({ item, searchQuery, pageNumber }) => {
    const product = item?.product || {};
    const variant = item?.productVariant || {};
    const ratingSummary = variant?.ratingSummary || {};

    const mapped = {
        search_query: searchQuery,
        page_number: pageNumber,
        store_product_id: item?.objectId || item?.id,
        product_id: product?.id || variant?.productId,
        product_variant_id: variant?.id,
        store_id: item?.storeId,
        name: product?.name,
        brand: product?.brand,
        country_of_origin: product?.countryOfOrigin,
        manufacturer_name: product?.manufacturerName,
        primary_category_name: item?.primaryCategoryName,
        primary_category_id: item?.primaryCategoryId,
        primary_subcategory_id: product?.primarySubcategory || item?.primarySubcategoryId,
        primary_subcategory_name: item?.primarySubcategoryName,
        formatted_packsize: variant?.formattedPacksize,
        packsize: variant?.packsize,
        unit_of_measure: variant?.unitOfMeasure,
        available_quantity: item?.availableQuantity,
        catalog_quantity: item?.quantity,
        max_allowed_quantity: variant?.maxAllowedQuantity,
        out_of_stock: item?.outOfStock,
        is_active: item?.isActive,
        is_best_offer: item?.isBestOffer,
        is_new_product: item?.isNewProduct,
        mrp: toRupees(item?.mrp),
        selling_price: toRupees(item?.sellingPrice),
        discounted_selling_price: toRupees(item?.discountedSellingPrice),
        discount_amount: toRupees(item?.discountAmount),
        discount_percent: item?.discountPercent,
        super_saver_selling_price: toRupees(item?.superSaverSellingPrice),
        zepto_pass_price: toRupees(item?.zeptoPassPrice),
        rating_average: ratingSummary?.averageRating,
        rating_count: ratingSummary?.totalRatings,
        image_url: buildImageUrl(variant?.images?.[0]?.path),
        fssai_license: variant?.fssaiLicense,
        shelf_life_hours: parsePositiveInt(variant?.shelfLifeInHours, undefined),
        weight_in_gms: variant?.weightInGms,
        product_type: item?.productType,
        description: normalizeTextList(product?.description),
        how_to_use: normalizeTextList(product?.howToUse),
        attribute_tags: extractAttributeTags(item),
        scraped_at: new Date().toISOString(),
    };

    return cleanFlatRecord(mapped);
};

// Captured headers include browser fingerprint fields. Drop those and let the impit
// profile generate a coherent set, keeping only the values the API verifies.
const DROPPED_HEADERS = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'user-agent',
    'accept',
    'accept-language',
    'priority',
    'upgrade-insecure-requests',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-fetch-user',
]);

const sanitizeHeaders = (rawHeaders = {}, { variant = 'desktop' } = {}) => {
    const headers = {};
    const siteOrigin = variant === 'lite' ? 'https://lite.zeptonow.com' : 'https://www.zepto.com';

    for (const [key, value] of Object.entries(rawHeaders)) {
        const lower = key.toLowerCase();
        if (DROPPED_HEADERS.has(lower) || lower.startsWith('sec-ch-')) continue;
        if (typeof value !== 'string' || !value.trim()) continue;
        headers[lower] = value;
    }

    headers['content-type'] = 'application/json';
    headers.accept = headers.accept || 'application/json, text/plain, */*';
    headers.origin = headers.origin || siteOrigin;
    headers.referer = headers.referer || `${siteOrigin}/`;

    return headers;
};

const parseJson = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

const launchBrowser = async ({ proxyUrl, variant }) => {
    const proxy = (() => {
        if (!proxyUrl) return undefined;
        const url = toUrl(proxyUrl);
        if (!url) return undefined;
        return {
            server: `${url.protocol}//${url.hostname}:${url.port}`,
            ...(url.username
                ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
                : {}),
        };
    })();

    const browser = await firefox.launch({
        headless: true,
        ...(proxy ? { proxy } : {}),
    });
    const context = await browser.newContext({
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        viewport: variant === 'lite' ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
        ...(variant === 'lite' ? { userAgent: LITE_USER_AGENT, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const resourceUrl = route.request().url();
        if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return route.abort();
        if (BLOCKED_URL_PARTS.some((part) => resourceUrl.includes(part))) return route.abort();
        return route.continue();
    });

    return { browser, context, page };
};

const closeSession = async (session) => {
    if (!session?.browser) return;
    await session.browser.close().catch(() => {});
};

const attachCaptureListeners = ({ page, captures, onStoreReady }) => {
    page.on('response', (response) => {
        const url = response.url();

        if (url.includes('/lms/api/v2/get_page') && response.status() === 200) onStoreReady();

        if (!url.includes(SEARCH_API_MARKER) || url.includes('/filters')) return;

        Promise.resolve()
            .then(async () => {
                const payload = await response.json();
                if (!payload || typeof payload !== 'object') return;
                const request = response.request();
                captures.push({
                    url,
                    status: response.status(),
                    headers: request.headers(),
                    requestBody: parseJson(request.postData() || '') || {},
                    payload,
                    products: extractProducts(payload),
                    capturedAt: Date.now(),
                });
            })
            .catch(() => {});
    });
};

const selectCapture = (captures) => {
    const usable = captures.filter((entry) => entry.status === 200 && Array.isArray(entry.payload?.layout));
    const withProducts = usable
        .filter((entry) => entry.products.length > 0)
        .sort((a, b) => b.products.length - a.products.length);
    if (withProducts.length > 0) return withProducts[0];

    return usable.find(
        (entry) => Number(entry.payload?.totalProductCount) === 0 || entry.payload?.hasReachedEnd === true,
    );
};

const waitForCapture = async (captures, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let errorSeenAt = 0;

    while (Date.now() < deadline) {
        const capture = selectCapture(captures);
        if (capture) return capture;

        // A guest session that is still warming up answers with LOGIN_REQUIRED.
        // Retry navigation after a short grace period instead of waiting out the full timeout.
        if (!errorSeenAt && captures.some((entry) => entry.payload?.error_code)) errorSeenAt = Date.now();
        if (errorSeenAt && Date.now() - errorSeenAt > 1500) return undefined;

        await sleep(CAPTURE_POLL_MS);
    }

    return undefined;
};

const readPageText = async (page) => {
    try {
        return await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '');
    } catch {
        return '';
    }
};

const BLOCKED_PAGE_PATTERN = /captcha|verify you are human|access denied|forbidden|http error 429|request blocked/i;
const UNSERVICEABLE_PATTERN = /sit tight|coming soon|not serviceable|try again in/i;

const createSessionError = (message, code) => Object.assign(new Error(message), { code });

const captureSession = async ({ searchUrl, proxyUrl, variant }) => {
    const { browser, context, page } = await launchBrowser({ proxyUrl, variant });
    const captures = [];
    let storeReady = false;

    attachCaptureListeners({
        page,
        captures,
        onStoreReady: () => {
            storeReady = true;
        },
    });

    let handedOff = false;
    try {
        if (variant === 'lite') {
            await page
                .goto(LITE_HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
                .catch(() => {});
            await sleep(1500);
        } else {
            let homeLoaded = false;
            for (let attempt = 1; attempt <= 2 && !homeLoaded; attempt++) {
                try {
                    await page.goto(HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
                    homeLoaded = true;
                } catch (error) {
                    log.debug(`Homepage attempt ${attempt} failed: ${shortError(error)}`);
                    await sleep(backoffDelay(attempt));
                }
            }

            if (!homeLoaded) throw new Error('Could not open the Zepto storefront.');

            const storeDeadline = Date.now() + 8000;
            while (!storeReady && Date.now() < storeDeadline) await page.waitForTimeout(250);
            await sleep(HOME_SETTLE_MS);
        }

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
            } catch (error) {
                log.debug(`Search navigation attempt ${attempt} failed: ${shortError(error)}`);
            }

            const capture = await waitForCapture(captures, CAPTURE_WAIT_MS);
            if (capture) {
                const headers = sanitizeHeaders(capture.headers, { variant });
                const requestBody = capture.requestBody || {};
                const userSessionId = requestBody.userSessionId || capture.payload?.userSessionId;

                if (!headers.cookie) throw new Error('Captured session has no cookie.');
                if (!userSessionId) throw new Error('Captured request is missing userSessionId.');
                if (!headers['request-signature'])
                    log.warning('Captured session has no request-signature; page requests may be rejected.');

                const session = {
                    browser,
                    context,
                    page,
                    captures,
                    variant,
                    endpoint: capture.url,
                    headers,
                    requestBody,
                    userSessionId,
                    payload: capture.payload,
                    pageNumber: Number(requestBody.pageNumber) || Number(capture.payload?.currentPage) || 0,
                    productCount: capture.products.length,
                    storeId: headers.store_id || headers.storeid,
                };
                handedOff = true;
                return session;
            }

            const pageText = await readPageText(page);
            const loginRequired =
                captures.some((entry) => entry.payload?.error_code === 'LOGIN_REQUIRED') ||
                /please login to continue/i.test(pageText);

            if (loginRequired) {
                throw createSessionError(
                    'Zepto is asking this IP to log in before searching. Enable an Indian residential proxy and retry.',
                    'LOGIN_REQUIRED',
                );
            }
            if (BLOCKED_PAGE_PATTERN.test(pageText)) {
                throw createSessionError('Zepto returned a challenge page instead of search results.', 'BLOCKED');
            }
            if (attempt === 1) {
                log.warning('Search page returned no product data; retrying navigation once.');
                await sleep(2000);
            } else if (UNSERVICEABLE_PATTERN.test(pageText)) {
                throw createSessionError('Zepto has no serviceable store for this session.', 'UNSERVICEABLE');
            } else {
                throw createSessionError('Search page returned no product data.', 'EMPTY');
            }
        }

        throw new Error('Could not capture a search session.');
    } finally {
        if (!handedOff) await browser.close().catch(() => {});
    }
};

const setupSessionWithRetry = async ({ searchUrl, query, proxyUrl, variants = SESSION_VARIANTS }) => {
    let lastError;

    for (const variant of variants) {
        for (let attempt = 1; attempt <= MAX_SESSION_ATTEMPTS; attempt++) {
            const variantUrl = variant === 'lite' ? buildVariantSearchUrl(query, 'lite') : searchUrl;
            try {
                const session = await captureSession({ searchUrl: variantUrl, proxyUrl, variant });
                if (session.productCount === 0 && Number(session.payload?.totalProductCount) > 0) {
                    log.warning(`Captured page 0 was empty on the ${variant} storefront; retrying session setup.`);
                    await closeSession(session);
                    continue;
                }
                return session;
            } catch (error) {
                lastError = error;
                log.warning(
                    `Session setup failed on the ${variant} storefront (attempt ${attempt}/${MAX_SESSION_ATTEMPTS}): ${shortError(error)}`,
                );
                if (attempt < MAX_SESSION_ATTEMPTS) await sleep(backoffDelay(attempt, 1200));
            }
        }
    }

    throw lastError || new Error('Could not establish a Zepto search session.');
};

const buildRequestBody = ({ session, query, pageNumber }) => {
    const body = { ...(session.requestBody || {}) };
    body.query = query;
    body.pageNumber = pageNumber;
    if (body.mode === undefined || body.mode === null || body.mode === '') body.mode = 'SHOW_ALL_RESULTS';
    if (!body.userSessionId) body.userSessionId = session.userSessionId;
    return body;
};

const createClient = (profile, proxyUrl) =>
    new Impit({
        browser: profile,
        ...(proxyUrl ? { proxyUrl } : {}),
    });

class RunState {
    constructor({ proxyUrl, resultsWanted }) {
        this.session = undefined;
        this.clients = new Map();
        this.proxyUrl = proxyUrl;
        this.resultsWanted = resultsWanted;
        this.seenIds = new Set();
        this.totalSaved = 0;
        this.pagesProcessed = 0;
        this.profileIndex = 0;
        this.browserPages = new Set();
    }

    rotateProfile() {
        this.profileIndex++;
    }

    replaceSession(session) {
        this.session = session;
        this.profileIndex = 0;
    }

    markSeen(id) {
        this.seenIds.add(id);
    }

    hasSeen(id) {
        return this.seenIds.has(id);
    }

    addSaved(count) {
        this.totalSaved += count;
    }

    recordPage() {
        this.pagesProcessed++;
    }

    markBrowserPage(pageNumber) {
        this.browserPages.add(pageNumber);
    }

    hasBrowserPage(pageNumber) {
        return this.browserPages.has(pageNumber);
    }
}

const classifyResponse = (status, wafAction, text) => {
    if (status === 200) return 'ok';
    if (status === 299) return 'session';
    if (wafAction === 'challenge' || status === 202 || status === 401 || status === 403) return 'session';
    if (status === 429) return /LOGIN_REQUIRED/i.test(text) || !text.trim() ? 'session' : 'transient';
    if (status >= 500) return 'transient';
    return 'fatal';
};

const requestPage = async ({ state, query, pageNumber }) => {
    const profile = IMPIT_PROFILES[state.profileIndex % IMPIT_PROFILES.length];
    const clientKey = `${profile}::${state.proxyUrl || ''}`;
    if (!state.clients.has(clientKey)) state.clients.set(clientKey, createClient(profile, state.proxyUrl));
    const client = state.clients.get(clientKey);

    const response = await client.fetch(state.session.endpoint, {
        method: 'POST',
        headers: { ...state.session.headers, 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody({ session: state.session, query, pageNumber })),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    const wafAction = (response.headers.get('x-amzn-waf-action') || '').toLowerCase();
    const kind = classifyResponse(response.status, wafAction, text);

    if (kind !== 'ok') {
        log.debug(`Page ${pageNumber} via ${profile}: HTTP ${response.status} (${kind}).`);
        return { kind, status: response.status };
    }

    const payload = parseJson(text);
    if (!payload || typeof payload !== 'object') {
        return { kind: 'transient', status: response.status, reason: 'invalid_json' };
    }
    if (payload.error_code) {
        log.debug(`Page ${pageNumber} returned error_code ${payload.error_code}.`);
        return { kind: 'session', status: response.status };
    }
    if (!Array.isArray(payload.layout)) {
        log.warning(`Page ${pageNumber} returned a payload without a layout array.`);
        return { kind: 'fatal', status: response.status, reason: 'unexpected_payload' };
    }

    return { kind: 'ok', status: response.status, payload };
};

const refreshSession = async ({ state, searchUrl, query }) => {
    log.warning('Search session was rejected; starting a fresh browser session.');
    const preferred = state.session?.variant === 'lite' ? ['lite', 'desktop'] : SESSION_VARIANTS;
    const session = await setupSessionWithRetry({ searchUrl, query, proxyUrl: state.proxyUrl, variants: preferred });
    await closeSession(state.session);
    state.replaceSession(session);
    log.info(`Fresh session ready via the ${session.variant} storefront (store: ${session.storeId || 'unknown'}).`);
    return session;
};

const emitProducts = async ({ state, payload, pageNumber, query }) => {
    const products = extractProducts(payload);
    const output = [];

    for (const item of products) {
        if (state.totalSaved + output.length >= state.resultsWanted) break;

        const id = productId(item);
        if (!id || state.hasSeen(id)) continue;

        const mapped = mapProductItem({ item, searchQuery: query, pageNumber });
        if (Object.keys(mapped).length === 0) continue;

        state.markSeen(id);
        output.push(mapped);
    }

    if (output.length === 0) return 0;

    await Actor.pushData(output);
    state.addSaved(output.length);
    log.info(
        `Saved ${output.length} product(s) from page ${pageNumber}. Total: ${state.totalSaved}/${state.resultsWanted}.`,
    );
    return output.length;
};

const fetchPageWithRecovery = async ({ state, query, pageNumber, searchUrl }) => {
    let transientAttempts = 0;
    let refreshes = 0;
    let lastKind = 'exhausted';

    while (transientAttempts < MAX_PAGE_ATTEMPTS && refreshes <= MAX_SESSION_REFRESHES) {
        try {
            const result = await requestPage({ state, query, pageNumber });

            if (result.kind === 'ok') return result;

            if (result.kind === 'session') {
                lastKind = 'blocked';
                if (refreshes >= MAX_SESSION_REFRESHES) return result;
                refreshes++;
                log.warning(
                    `Page ${pageNumber} rejected (HTTP ${result.status}); refreshing session (${refreshes}/${MAX_SESSION_REFRESHES}).`,
                );
                await refreshSession({ state, searchUrl, query });
                continue;
            }

            if (result.kind === 'transient') {
                transientAttempts++;
                state.rotateProfile();
                lastKind = 'transient';
                if (transientAttempts >= MAX_PAGE_ATTEMPTS) break;
                log.warning(
                    `Temporary failure on page ${pageNumber} (attempt ${transientAttempts}/${MAX_PAGE_ATTEMPTS}); switching profile.`,
                );
                await sleep(backoffDelay(transientAttempts));
                continue;
            }

            return result;
        } catch (error) {
            transientAttempts++;
            state.rotateProfile();
            lastKind = 'transient';
            if (transientAttempts >= MAX_PAGE_ATTEMPTS) return { kind: 'exhausted', error };
            log.warning(
                `Request error on page ${pageNumber} (attempt ${transientAttempts}/${MAX_PAGE_ATTEMPTS}): ${shortError(error)}`,
            );
            await sleep(backoffDelay(transientAttempts));
        }
    }

    return { kind: lastKind };
};

const collectViaBrowser = async ({ state, query, maxPages }) => {
    const { session } = state;
    if (!session?.page) return { emitted: 0, reachedEnd: false };

    let cursor = session.captures.length;
    let emitted = 0;
    let emptyScrolls = 0;
    let reachedEnd = false;

    for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
        if (state.totalSaved >= state.resultsWanted || state.pagesProcessed >= maxPages) break;

        await session.page.mouse.wheel(0, 2400).catch(() => {});
        await session.page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5)).catch(() => {});
        await sleep(SCROLL_WAIT_MS);

        const fresh = session.captures.slice(cursor);
        cursor = session.captures.length;
        let produced = 0;

        for (const capture of fresh) {
            if (capture.status !== 200 || !Array.isArray(capture.payload?.layout)) continue;
            if (state.totalSaved >= state.resultsWanted || state.pagesProcessed >= maxPages) break;

            const currentPage = Number(capture.payload?.currentPage);
            const pageNumber = Number.isFinite(currentPage) ? currentPage : state.pagesProcessed;
            if (state.hasBrowserPage(pageNumber)) continue;
            state.markBrowserPage(pageNumber);

            const saved = await emitProducts({
                state,
                payload: capture.payload,
                pageNumber,
                query,
            });
            produced += saved;
            state.recordPage();
            if (capture.payload?.hasReachedEnd) reachedEnd = true;
        }

        emitted += produced;
        if (reachedEnd) break;

        if (produced === 0) {
            emptyScrolls++;
            if (emptyScrolls >= MAX_EMPTY_SCROLLS) break;
        } else {
            emptyScrolls = 0;
        }
    }

    return { emitted, reachedEnd };
};

const resolveProxyUrl = async (proxyConfig) => {
    const shouldUseApifyProxy = Boolean(proxyConfig?.useApifyProxy);
    const hasCustomUrls = Array.isArray(proxyConfig?.proxyUrls) && proxyConfig.proxyUrls.length > 0;
    if (!shouldUseApifyProxy && !hasCustomUrls) return undefined;

    const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
    return proxyConfiguration ? proxyConfiguration.newUrl() : undefined;
};

await Actor.init();

let exitCode = 0;
let runState;

try {
    const input = (await Actor.getInput()) || {};
    const {
        query,
        startUrl,
        results_wanted: resultsWantedInput,
        max_pages: maxPagesInput,
        proxyConfiguration: proxyConfig,
    } = input;

    const resultsWanted = parsePositiveInt(resultsWantedInput, DEFAULT_RESULTS_WANTED);
    const maxPages = parsePositiveInt(maxPagesInput, DEFAULT_MAX_PAGES);
    const { searchQuery, searchUrl } = resolveSearchContext({ query, startUrl });
    const proxyUrl = await resolveProxyUrl(proxyConfig);

    log.info(
        `Start run | query="${searchQuery}" | results=${resultsWanted} | max_pages=${maxPages} | proxy=${proxyUrl ? 'on' : 'off'}`,
    );

    const state = new RunState({ proxyUrl, resultsWanted });

    state.session = await setupSessionWithRetry({ searchUrl, query: searchQuery, proxyUrl });
    runState = state;
    log.info(
        `Search session ready via the ${state.session.variant} storefront (page 0: ${state.session.productCount} product(s), store: ${state.session.storeId || 'unknown'}).`,
    );

    let stopReason = 'completed';

    await emitProducts({
        state,
        payload: state.session.payload,
        pageNumber: state.session.pageNumber,
        query: searchQuery,
    });
    state.pagesProcessed = 1;

    let reachedEnd = Boolean(state.session.payload?.hasReachedEnd);
    const firstNext = Number(state.session.payload?.nextPageParams?.pageNumber);
    let nextPage = Number.isFinite(firstNext) ? firstNext : state.session.pageNumber + 1;
    let useBrowser = false;
    let emptyPages = 0;

    while (state.totalSaved < resultsWanted && state.pagesProcessed < maxPages && !reachedEnd) {
        if (!useBrowser) {
            const result = await fetchPageWithRecovery({ state, query: searchQuery, pageNumber: nextPage, searchUrl });

            if (result.kind !== 'ok') {
                log.warning(
                    `Structured request path unavailable (${result.kind}); continuing with browser pagination.`,
                );
                stopReason = 'browser_fallback';
                useBrowser = true;
                continue;
            }

            const saved = await emitProducts({
                state,
                payload: result.payload,
                pageNumber: nextPage,
                query: searchQuery,
            });
            state.pagesProcessed++;
            reachedEnd = Boolean(result.payload?.hasReachedEnd);

            const candidate = Number(result.payload?.nextPageParams?.pageNumber);
            nextPage = Number.isFinite(candidate) ? candidate : nextPage + 1;

            if (saved === 0) {
                emptyPages++;
                if (emptyPages >= 2) {
                    stopReason = 'no_new_products';
                    break;
                }
            } else {
                emptyPages = 0;
            }
            continue;
        }

        const { emitted, reachedEnd: browserEnd } = await collectViaBrowser({
            state,
            query: searchQuery,
            maxPages,
        });

        if (browserEnd) reachedEnd = true;
        if (emitted === 0) stopReason = 'browser_fallback_empty';
        break;
    }

    if (reachedEnd) stopReason = 'end_of_results';

    if (state.totalSaved === 0) {
        throw new Error(
            'Run finished without any products. The query may have no results, or Zepto returned no serviceable store.',
        );
    }

    log.info(
        `Done | query="${searchQuery}" | saved=${state.totalSaved} | pages=${state.pagesProcessed} | stop_reason=${stopReason}`,
    );
} catch (error) {
    exitCode = 1;
    const safeMessage = shortError(error).replace(/https?:\/\/\S+/gi, '[redacted]');
    log.error(`Actor failed: ${safeMessage}`);
} finally {
    if (runState?.session) await closeSession(runState.session);
}

await Actor.exit({ exitCode });
