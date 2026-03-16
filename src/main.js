import { Actor, log } from 'apify';
import { Dataset, PlaywrightCrawler } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { firefox } from 'playwright';
import { readFile } from 'node:fs/promises';

await Actor.init();

const API_ENDPOINT = 'https://bff-gateway.zepto.com/user-search-service/api/v3/search';
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media', 'stylesheet']);

const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const resolveSearchQuery = ({ query, keyword, startUrl }) => {
    if (typeof query === 'string' && query.trim()) return query.trim();
    if (typeof keyword === 'string' && keyword.trim()) return keyword.trim();
    if (typeof startUrl === 'string' && startUrl.trim()) {
        try {
            const parsed = new URL(startUrl);
            const fromUrl = parsed.searchParams.get('query');
            if (fromUrl && fromUrl.trim()) return fromUrl.trim();
        } catch {
            return undefined;
        }
    }
    return undefined;
};

const resolveSearchUrl = ({ startUrl, query }) => {
    if (typeof startUrl === 'string' && startUrl.trim()) {
        try {
            const parsed = new URL(startUrl);
            parsed.searchParams.set('query', query);
            return parsed.toString();
        } catch {
            // fall through to default URL
        }
    }
    const url = new URL('https://www.zepto.com/search');
    url.searchParams.set('query', query);
    return url.toString();
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

const fetchApiPage = async ({ headers, pageNumber, query, userSessionId, proxyConfiguration }) => {
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

    let response;
    try {
        response = await gotScraping.post(API_ENDPOINT, {
            proxyUrl,
            headers,
            json: {
                query,
                pageNumber,
                mode: 'SHOW_ALL_RESULTS',
                userSessionId,
            },
            responseType: 'json',
            timeout: { request: 30000 },
            throwHttpErrors: false,
        });
    } catch {
        throw new Error(`Request failed on page ${pageNumber}.`);
    }

    if (response.statusCode >= 400) {
        throw new Error(`Request failed on page ${pageNumber}. Status: ${response.statusCode}.`);
    }

    return response.body;
};

try {
    const actorInput = await Actor.getInput();
    let input = actorInput || {};

    if (!actorInput) {
        try {
            const localInput = await readFile('INPUT.json', 'utf8');
            input = JSON.parse(localInput);
            log.info('No Actor input found. Falling back to INPUT.json for local run.');
        } catch {
            // Ignore when local file is not present.
        }
    }

    const {
        query,
        keyword,
        startUrl,
        results_wanted = 20,
        max_pages = 5,
        proxyConfiguration: proxyConfig,
    } = input;

    const resultsWanted = parsePositiveInt(results_wanted, 20);
    const maxPages = parsePositiveInt(max_pages, 5);
    const searchQuery = resolveSearchQuery({ query, keyword, startUrl });

    if (!searchQuery) {
        throw new Error('Missing required input. Provide `query` (or `keyword`) or use `startUrl` with `?query=...`.');
    }

    const searchUrl = resolveSearchUrl({ startUrl, query: searchQuery });
    const proxyConf = proxyConfig ? await Actor.createProxyConfiguration(proxyConfig) : undefined;

    let initialCapture;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConf,
        launchContext: {
            launcher: firefox,
            launchOptions: {
                headless: true,
            },
        },
        maxConcurrency: 1,
        maxRequestRetries: 2,
        navigationTimeoutSecs: 45,
        requestHandlerTimeoutSecs: 120,
        preNavigationHooks: [
            async ({ page, request }) => {
                request.userData.apiCaptures = [];

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
                        if (!responseUrl.includes('/user-search-service/api/v3/search') || responseUrl.includes('/filters')) {
                            return;
                        }

                        const requestBodyRaw = response.request().postData();
                        const requestBody = requestBodyRaw ? JSON.parse(requestBodyRaw) : {};
                        const responseBody = await response.json();

                        request.userData.apiCaptures.push({
                            status: response.status(),
                            headers: response.request().headers(),
                            requestBody,
                            responseBody,
                        });
                    } catch (error) {
                        log.debug(`Failed to capture search response: ${error.message}`);
                    }
                });
            },
        ],
        async requestHandler({ page, request }) {
            log.info(`Opening search page: ${request.url}`);

            await page.waitForLoadState('domcontentloaded');

            for (let i = 0; i < 20 && request.userData.apiCaptures.length === 0; i++) {
                await page.waitForTimeout(500);
            }

            initialCapture = request.userData.apiCaptures
                .find((capture) => Number(capture?.requestBody?.pageNumber) === 0)
                || request.userData.apiCaptures[0];

            if (!initialCapture) {
                throw new Error('Could not capture search session data from browser session.');
            }

            log.info('Captured search session data successfully.');
        },
    });

    await crawler.run([{ url: searchUrl }]);

    if (!initialCapture?.responseBody) {
        throw new Error('Failed to capture initial search payload.');
    }

    const requestHeaders = sanitizeHeaders(initialCapture.headers);
    const userSessionId = initialCapture.requestBody?.userSessionId || initialCapture.responseBody?.userSessionId;

    if (!userSessionId) {
        throw new Error('Captured request is missing `userSessionId`.');
    }

    const seenIds = new Set();
    let totalSaved = 0;
    let pagesProcessed = 0;

    const pushPageProducts = async (payload) => {
        const products = extractProductItems(payload);
        const output = [];

        for (const item of products) {
            const uniqueId = item?.id || item?.objectId || item?.productVariant?.id || item?.product?.id;
            if (!uniqueId || seenIds.has(uniqueId)) continue;

            seenIds.add(uniqueId);
            output.push(item);

            if (totalSaved + output.length >= resultsWanted) break;
        }

        if (output.length > 0) {
            await Dataset.pushData(output);
            totalSaved += output.length;
        }

        return output.length;
    };

    const firstPageNumber = Number(initialCapture.requestBody?.pageNumber) || 0;
    await pushPageProducts(initialCapture.responseBody);
    pagesProcessed++;

    log.info(`Saved ${totalSaved} product(s) from page ${firstPageNumber}.`);

    let nextPage = firstPageNumber + 1;
    let hasReachedEnd = Boolean(initialCapture.responseBody?.hasReachedEnd);

    while (totalSaved < resultsWanted && pagesProcessed < maxPages && !hasReachedEnd) {
        log.info(`Fetching page ${nextPage}...`);
        const pagePayload = await fetchApiPage({
            headers: requestHeaders,
            pageNumber: nextPage,
            query: searchQuery,
            userSessionId,
            proxyConfiguration: proxyConf,
        });

        const savedNow = await pushPageProducts(pagePayload);
        pagesProcessed++;
        hasReachedEnd = Boolean(pagePayload?.hasReachedEnd);

        log.info(`Saved ${savedNow} new product(s) from page ${nextPage}. Total: ${totalSaved}/${resultsWanted}`);

        if (savedNow === 0 && hasReachedEnd) break;
        nextPage++;
    }

    if (totalSaved === 0) {
        throw new Error('Run completed but no products were extracted.');
    }

    log.info(`Extraction complete. Saved ${totalSaved} product(s) for query "${searchQuery}".`);
} catch (error) {
    const safeMessage = String(error?.message || 'Unknown error')
        .replace(/https?:\/\/\S+/gi, '[redacted]');
    log.error(`Actor failed: ${safeMessage}`);
    throw error;
} finally {
    await Actor.exit();
}
