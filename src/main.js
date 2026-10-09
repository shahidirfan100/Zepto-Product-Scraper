import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { firefox } from 'playwright';

const API_ENDPOINT = 'https://bff-gateway.zepto.com/user-search-service/api/v3/search';
const SEARCH_API_MATCH = '/user-search-service/api/v3/search';
const DEFAULT_SEARCH_URL = 'https://www.zepto.com/search?query=Chocolate';
const IMPIT_BROWSER = 'chrome';
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media', 'stylesheet']);
const MAX_PAGE_ATTEMPTS = 3;
const MAX_SESSION_REFRESHES = 2;
const CAPTURE_WAIT_MS = 15000;
const CAPTURE_POLL_MS = 250;
const WARMUP_URL = 'https://www.zepto.com/';
const WARMUP_WAIT_MS = 3000;
const NAVIGATION_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const backoffDelay = (attempt, baseMs = 1000) => {
    const exponential = baseMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 400);
    return Math.min(exponential + jitter, 15000);
};

const normalizeString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

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
    const url = normalizeString(startUrl);

    if (keyword) {
        const target = toUrl(url) || new URL('https://www.zepto.com/search');
        target.searchParams.set('query', keyword);
        return { searchQuery: keyword, searchUrl: target.toString() };
    }

    if (url) {
        const target = toUrl(url);
        const fromUrl = target?.searchParams.get('query');
        if (!target || !fromUrl || !fromUrl.trim()) return undefined;
        return { searchQuery: fromUrl.trim(), searchUrl: target.toString() };
    }

    const target = new URL(DEFAULT_SEARCH_URL);
    return { searchQuery: target.searchParams.get('query'), searchUrl: target.toString() };
};

const sanitizeHeaders = (headers) => {
    const excluded = new Set(['content-length', 'host', 'connection']);
    const sanitized = {};

    for (const [key, value] of Object.entries(headers || {})) {
        const lower = key.toLowerCase();
        if (excluded.has(lower)) continue;
        if (typeof value !== 'string' || !value.trim()) continue;
        sanitized[lower] = value;
    }

    sanitized.accept = sanitized.accept || 'application/json, text/plain, */*';
    sanitized['content-type'] = 'application/json';
    sanitized.referer = sanitized.referer || 'https://www.zepto.com/';
    sanitized.origin = sanitized.origin || 'https://www.zepto.com';

    return sanitized;
};

const extractProductItems = (payload) => {
    const items = [];
    const seen = new Set();

    const pushCandidate = (candidate) => {
        const uniqueId = candidate?.id || candidate?.objectId || candidate?.productVariant?.id || candidate?.product?.id;
        if (!uniqueId || seen.has(uniqueId)) return;
        seen.add(uniqueId);
        items.push(candidate);
    };

    const walk = (node) => {
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }

        if (!node || typeof node !== 'object') return;

        if (node.type === 'PRODUCT_ITEM' && node.data && typeof node.data === 'object') {
            pushCandidate(node.data);
        }

        if (node.product && node.productVariant) {
            pushCandidate(node);
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    };

    walk(payload);
    return items;
};

const toRupees = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return undefined;
    return Number((amount / 100).toFixed(2));
};

const buildImageUrl = (imagePath) => {
    if (typeof imagePath !== 'string' || !imagePath.trim()) return undefined;
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    return `https://cdn.zeptonow.com/production/${imagePath.replace(/^\/+/, '')}`;
};

const normalizeTextList = (value) => {
    if (Array.isArray(value)) {
        const items = value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean);
        return items.length > 0 ? items.join(' | ') : undefined;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
};

const extractAttributeTags = (item) => {
    const tags = item?.productCardTags?.slot3;
    if (!Array.isArray(tags)) return undefined;

    const values = [...new Set(tags
        .filter((tag) => tag?.tagType === 'ATTRIBUTE' && typeof tag?.tagName === 'string')
        .map((tag) => tag.tagName.trim())
        .filter(Boolean))];

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
            const normalized = value
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
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

const captureSession = async ({ searchUrl, proxyUrl }) => {
    const browser = await firefox.launch({
        headless: true,
        ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    });

    try {
        const page = await browser.newPage();
        const captures = [];

        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            const resourceUrl = route.request().url();

            if (
                BLOCKED_RESOURCE_TYPES.has(resourceType)
                || resourceUrl.includes('google-analytics')
                || resourceUrl.includes('googletagmanager')
                || resourceUrl.includes('doubleclick')
                || resourceUrl.includes('facebook')
            ) {
                return route.abort();
            }

            return route.continue();
        });

        page.on('response', async (response) => {
            try {
                const responseUrl = response.url();
                if (!responseUrl.includes(SEARCH_API_MATCH) || responseUrl.includes('/filters')) return;

                const rawRequestBody = response.request().postData();
                let requestBody = {};
                if (rawRequestBody) {
                    try {
                        requestBody = JSON.parse(rawRequestBody);
                    } catch {
                        requestBody = {};
                    }
                }

                let responseBody = null;
                try {
                    responseBody = await response.json();
                } catch {
                    responseBody = null;
                }

                captures.push({ headers: response.request().headers(), requestBody, responseBody });
            } catch (error) {
                log.debug(`Failed to capture search response: ${error.message}`);
            }
        });

        const hasProducts = (entry) => extractProductItems(entry?.responseBody).length > 0;
        const selectCapture = () => {
            const pageZero = captures.filter((entry) => Number(entry?.requestBody?.pageNumber) === 0);
            return pageZero.find(hasProducts)
                || captures.find(hasProducts)
                || pageZero[0]
                || captures[0];
        };

        await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
        await page.waitForTimeout(WARMUP_WAIT_MS);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

        let capture = selectCapture();
        const deadline = Date.now() + CAPTURE_WAIT_MS;
        while (Date.now() < deadline && !hasProducts(capture)) {
            await page.waitForTimeout(CAPTURE_POLL_MS);
            capture = selectCapture();
        }

        if (!capture?.responseBody) {
            throw new Error('Could not capture search session data from the browser session.');
        }

        const headers = sanitizeHeaders(capture.headers);
        const userSessionId = capture.requestBody?.userSessionId || capture.responseBody?.userSessionId;

        if (!userSessionId) {
            throw new Error('Captured request is missing userSessionId.');
        }

        return {
            headers,
            userSessionId,
            firstPagePayload: capture.responseBody,
            firstPageNumber: Number(capture.requestBody?.pageNumber) || 0,
            firstPageProductCount: extractProductItems(capture.responseBody).length,
        };
    } finally {
        await browser.close().catch(() => {});
    }
};

const captureSessionWithRetry = async ({ searchUrl, proxyUrl }) => {
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const session = await captureSession({ searchUrl, proxyUrl });
            if (session.firstPageProductCount === 0 && attempt < 2) {
                log.warning('Captured page 0 returned no products; retrying session setup once.');
                continue;
            }
            return session;
        } catch (error) {
            lastError = error;
            log.warning(`Session setup failed (attempt ${attempt}/2): ${error.message}`);
            if (attempt < 2) await sleep(backoffDelay(attempt, 500));
        }
    }

    throw lastError;
};

const fetchPagePayload = async ({ client, query, pageNumber, session }) => {
    const response = await client.fetch(API_ENDPOINT, {
        method: 'POST',
        headers: session.headers,
        body: JSON.stringify({
            query,
            pageNumber,
            mode: 'SHOW_ALL_RESULTS',
            userSessionId: session.userSessionId,
        }),
    });

    const body = await response.text();
    const wafAction = (response.headers.get('x-amzn-waf-action') || '').toLowerCase();

    return { status: response.status, ok: response.ok, wafAction, body };
};

const fetchPageWithRecovery = async ({ client, query, pageNumber, searchUrl, proxyUrl, session }) => {
    let currentSession = session;
    let transientFailures = 0;
    let refreshes = 0;

    const finish = (payload) => ({ payload, session: currentSession });

    while (transientFailures < MAX_PAGE_ATTEMPTS && refreshes <= MAX_SESSION_REFRESHES) {
        try {
            const { status, ok, wafAction, body } = await fetchPagePayload({
                client,
                query,
                pageNumber,
                session: currentSession,
            });

            const sessionIssue = status === 202 || status === 401 || status === 403 || wafAction === 'challenge';

            if (sessionIssue) {
                if (refreshes < MAX_SESSION_REFRESHES) {
                    refreshes++;
                    log.warning(`Search session rejected on page ${pageNumber}; refreshing session (${refreshes}/${MAX_SESSION_REFRESHES}).`);
                    currentSession = await captureSessionWithRetry({ searchUrl, proxyUrl });
                    continue;
                }
                log.warning(`Page ${pageNumber} still blocked after session refresh. Stopping pagination.`);
                return finish(undefined);
            }

            if (status === 429 || status >= 500) {
                transientFailures++;
                if (transientFailures >= MAX_PAGE_ATTEMPTS) break;
                log.warning(`Temporary HTTP ${status} on page ${pageNumber} (attempt ${transientFailures}/${MAX_PAGE_ATTEMPTS}).`);
                await sleep(backoffDelay(transientFailures, 1500));
                continue;
            }

            if (!ok) {
                log.warning(`Page ${pageNumber} returned HTTP ${status}. Stopping pagination.`);
                return finish(undefined);
            }

            try {
                const parsed = JSON.parse(body);
                if (!parsed || typeof parsed !== 'object') {
                    log.warning(`Page ${pageNumber} returned an unexpected payload. Stopping pagination.`);
                    return finish(undefined);
                }
                return finish(parsed);
            } catch {
                log.warning(`Page ${pageNumber} returned unparseable JSON. Stopping pagination.`);
                return finish(undefined);
            }
        } catch (error) {
            transientFailures++;
            if (transientFailures >= MAX_PAGE_ATTEMPTS) break;
            log.warning(`Request error on page ${pageNumber} (attempt ${transientFailures}/${MAX_PAGE_ATTEMPTS}): ${error.message}`);
            await sleep(backoffDelay(transientFailures));
        }
    }

    return finish(undefined);
};

await Actor.init();

let exitCode = 0;

try {
    const input = (await Actor.getInput()) || {};
    const {
        query,
        startUrl,
        results_wanted: resultsWantedInput,
        max_pages: maxPagesInput,
        proxyConfiguration: proxyConfig,
    } = input;

    const resultsWanted = parsePositiveInt(resultsWantedInput, 20);
    const maxPages = parsePositiveInt(maxPagesInput, 5);

    const searchContext = resolveSearchContext({ query, startUrl });
    if (!searchContext) {
        throw new Error('Missing search input. Provide `query` or a `startUrl` containing a `query` parameter.');
    }

    const { searchQuery, searchUrl } = searchContext;

    const proxyConfiguration = proxyConfig ? await Actor.createProxyConfiguration(proxyConfig) : undefined;
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

    const client = new Impit({
        browser: IMPIT_BROWSER,
        ...(proxyUrl ? { proxyUrl } : {}),
    });

    let session = await captureSessionWithRetry({ searchUrl, proxyUrl });
    log.info(`Search session ready for "${searchQuery}" (page 0: ${session.firstPageProductCount} product(s)).`);

    const seenIds = new Set();
    let totalSaved = 0;
    let pagesProcessed = 0;
    let stopReason = 'completed';

    const emitPage = async ({ payload, pageNumber }) => {
        const products = extractProductItems(payload);
        const output = [];

        for (const item of products) {
            const uniqueId = item?.id || item?.objectId || item?.productVariant?.id || item?.product?.id;
            if (!uniqueId || seenIds.has(uniqueId)) continue;

            const mappedItem = mapProductItem({ item, searchQuery, pageNumber });
            if (Object.keys(mappedItem).length === 0) continue;

            seenIds.add(uniqueId);
            output.push(mappedItem);

            if (totalSaved + output.length >= resultsWanted) break;
        }

        if (output.length > 0) {
            await Actor.pushData(output);
            totalSaved += output.length;
            log.info(`Saved ${output.length} product(s) from page ${pageNumber}. Total: ${totalSaved}/${resultsWanted}.`);
        }

        return output.length;
    };

    await emitPage({ payload: session.firstPagePayload, pageNumber: session.firstPageNumber });
    pagesProcessed++;

    let nextPage = session.firstPageNumber + 1;
    let hasReachedEnd = Boolean(session.firstPagePayload?.hasReachedEnd);

    while (totalSaved < resultsWanted && pagesProcessed < maxPages && !hasReachedEnd) {
        const result = await fetchPageWithRecovery({
            client,
            query: searchQuery,
            pageNumber: nextPage,
            searchUrl,
            proxyUrl,
            session,
        });

        session = result.session;

        const pagePayload = result.payload;
        if (!pagePayload) {
            stopReason = `page_${nextPage}_unavailable`;
            break;
        }

        const savedNow = await emitPage({ payload: pagePayload, pageNumber: nextPage });
        pagesProcessed++;
        hasReachedEnd = Boolean(pagePayload?.hasReachedEnd);

        if (savedNow === 0 && hasReachedEnd) break;
        nextPage++;
    }

    if (totalSaved === 0) {
        throw new Error('Run completed but no products were extracted.');
    }

    log.info(`Done | query="${searchQuery}" | saved=${totalSaved} | pages=${pagesProcessed} | stop_reason=${stopReason}`);
} catch (error) {
    exitCode = 1;
    const safeMessage = String(error?.message || 'Unknown error').replace(/https?:\/\/\S+/gi, '[redacted]');
    log.error(`Actor failed: ${safeMessage}`);
}

await Actor.exit({ exitCode });
