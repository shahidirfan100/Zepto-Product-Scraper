## What does Zepto Product Scraper do?

Zepto Product Scraper collects product search results from Zepto and saves one dataset item per
product. Give it a search term in `query` or a public Zepto search URL in `startUrl`, then choose how
many products you want.

Each row contains the product name, brand, category, pack size, prices in Indian rupees, discount,
stock status, ratings, identifiers, and image URL when Zepto publishes them. The result is a flat
table you can load into a spreadsheet or database.

## Why use Zepto Product Scraper?

Price checks are the most common use. Each row carries MRP, selling price, discounted price,
discount amount, Super Saver price, and Zepto Pass price, so you can compare runs without joining
tables.

The same rows support assortment research and stock tracking. Group them by brand, category, pack
size, or store, and watch `available_quantity` and `out_of_stock` change over time. The product,
variant, and store identifiers let you match rows to your own catalog. Schedule the same search and
the datasets become a price history.

## What data can you extract?

Each dataset item represents one product returned for the search query.

| Field | Description |
|-------|-------------|
| `name` | Product name shown in search results |
| `brand` | Product brand |
| `formatted_packsize` | Human-readable pack size |
| `mrp` | Maximum retail price in INR |
| `selling_price` | Selling price in INR |
| `discounted_selling_price` | Discounted selling price in INR |
| `discount_percent` | Discount percentage |
| `out_of_stock` | Whether the item is out of stock |
| `rating_average` | Average product rating |
| `rating_count` | Number of ratings |
| `image_url` | Primary product image URL |

The full output table below lists every field the Actor can save.

## How to scrape Zepto product data

1. Open Zepto Product Scraper on Apify.
2. Enter a product term in `query`, or paste a public Zepto search URL in `startUrl`.
3. Set `results_wanted` for the number of rows and `max_pages` as a pagination cap.
4. Enable `proxyConfiguration` only if the run needs Apify Proxy.
5. Start the run and open the dataset preview.
6. Download the results or connect the dataset to your next workflow.

If both search fields are filled, `query` wins and `startUrl` is ignored. If neither is filled, the
Actor runs the default search URL. A `startUrl` must contain a `query` parameter.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | String | No | none | Product search term. Takes precedence over `startUrl`. |
| `startUrl` | String | No | `https://www.zepto.com/search?query=Chocolate` | Public Zepto search URL. Its `query` parameter is used when `query` is empty. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique products to save. Minimum `1`. |
| `max_pages` | Integer | No | `5` | Maximum number of result pages to read. Minimum `1`. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional Apify Proxy configuration. |

## Output Data

Each item is a flat JSON object. Empty values are omitted instead of saved as placeholders.

| Field | Type | Description |
|-------|------|-------------|
| `search_query` | String | Search term used for the run |
| `page_number` | Integer | Page index where the product appeared. The first page is `0`. |
| `store_product_id` | String | Store-level product identifier |
| `product_id` | String | Product identifier |
| `product_variant_id` | String | Variant identifier |
| `store_id` | String | Store that supplied the price and stock |
| `name` | String | Product name |
| `brand` | String | Brand |
| `country_of_origin` | String | Country of origin when published |
| `manufacturer_name` | String | Manufacturer when published |
| `primary_category_name` | String | Primary category name |
| `primary_category_id` | String | Primary category identifier |
| `primary_subcategory_id` | String | Primary subcategory identifier |
| `primary_subcategory_name` | String | Primary subcategory name when published |
| `formatted_packsize` | String | Pack size label |
| `packsize` | Number | Numeric pack size |
| `unit_of_measure` | String | Unit for the pack size |
| `available_quantity` | Number | Available quantity when published |
| `catalog_quantity` | Number | Catalog quantity signal |
| `max_allowed_quantity` | Number | Maximum quantity per order |
| `out_of_stock` | Boolean | Out-of-stock flag |
| `is_active` | Boolean | Active flag |
| `is_best_offer` | Boolean | Best-offer flag |
| `is_new_product` | Boolean | New-product flag |
| `mrp` | Number | Maximum retail price in INR |
| `selling_price` | Number | Selling price in INR |
| `discounted_selling_price` | Number | Discounted selling price in INR |
| `discount_amount` | Number | Discount amount in INR |
| `discount_percent` | Number | Discount percentage |
| `super_saver_selling_price` | Number | Super Saver price in INR when available |
| `zepto_pass_price` | Number | Zepto Pass price in INR when available |
| `rating_average` | Number | Average rating |
| `rating_count` | Integer | Total ratings |
| `image_url` | String | Primary image URL |
| `fssai_license` | String | FSSAI license when published |
| `shelf_life_hours` | Integer | Shelf life in hours when published |
| `weight_in_gms` | Number | Weight in grams |
| `product_type` | String | Zepto product type |
| `description` | String | Product description |
| `how_to_use` | String | Usage instructions when published |
| `attribute_tags` | Array of Strings | Unique attribute tags |
| `scraped_at` | String | ISO timestamp of collection time |

## Usage Examples

### Basic keyword search

```json
{
  "query": "Chocolate",
  "results_wanted": 20
}
```

### Search URL input

```json
{
  "startUrl": "https://www.zepto.com/search?query=chips",
  "results_wanted": 30,
  "max_pages": 4
}
```

### Larger collection with Apify Proxy

```json
{
  "query": "protein powder",
  "results_wanted": 100,
  "max_pages": 10,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "IN"
  }
}
```

## Sample Output

This is a real row from a `Chocolate` run. Values differ by product and store.

```json
{
  "search_query": "Chocolate",
  "page_number": 0,
  "store_product_id": "688a151a-1c88-5b8b-a7dd-ed2e5539e8d7",
  "product_id": "fd5b17bd-8b3b-4861-9112-e8b678ec6efd",
  "product_variant_id": "3ef335eb-0dee-4cba-bceb-de855ce6edd5",
  "store_id": "b4dc8d65-ed2e-4142-81b6-373982b13500",
  "name": "Cadbury Dairy Milk Silk Oreo Chocolate Bar",
  "brand": "Cadbury",
  "country_of_origin": "India",
  "manufacturer_name": "Mondelez India Foods Private Limited",
  "primary_category_name": "Sweet Cravings",
  "primary_category_id": "adab2f81-7140-4fe9-b8cf-3d809f40e38a",
  "primary_subcategory_id": "ca984d2d-70b8-464c-b182-41aa328b3d4b",
  "formatted_packsize": "1 pc (58.5 g)",
  "packsize": 58,
  "unit_of_measure": "GRAM",
  "available_quantity": 9,
  "catalog_quantity": 9,
  "max_allowed_quantity": 1000,
  "out_of_stock": false,
  "is_active": true,
  "is_best_offer": false,
  "is_new_product": false,
  "mrp": 100,
  "selling_price": 100,
  "discounted_selling_price": 100,
  "discount_percent": 0,
  "super_saver_selling_price": 100,
  "rating_average": 4.7,
  "rating_count": 109168,
  "image_url": "https://cdn.zeptonow.com/production/cms/product_variant/9cb10421-0fe9-4981-a0d1-2aa909636474.jpg",
  "shelf_life_hours": 8760,
  "weight_in_gms": 58,
  "product_type": "SELLABLESKU",
  "description": "Silk: The classic taste of Cadbury Dairy Milk chocolates only more creamy, smooth & indulging.",
  "scraped_at": "2026-11-02T06:31:42.395Z"
}
```

## Data-quality behavior

- Rows are flattened to scalar values and small string arrays.
- Empty strings, nulls, and non-finite numbers are left out.
- Prices are converted from paise to INR rupees. Missing or zero optional prices are omitted.
- Products are deduplicated by product or store-level identifier across pages.
- Sponsored brand carousels are ignored. Only products from the search grid are saved.
- Product descriptions and usage text are joined into one value when Zepto returns several parts.
- If the normal request path is rejected, the Actor reads the rendered results page and keeps going.
  Data already saved stays in the dataset.
- A rejected session is rebuilt and the page is retried before the fallback is used.
- If the main storefront asks for a login, the Actor switches to Zepto's lighter storefront and
  continues.

## Tips for best results

- Use specific terms such as `dark chocolate pack` or `wireless earbuds` for a focused dataset.
- Start with 20 results to confirm the query and fields before raising `results_wanted`.
- Raise `max_pages` when a query has more results than one page. Page sizes vary, so keep the cap
  above the number of pages you expect.
- Keep `results_wanted` and `max_pages` consistent. A low page cap can stop the run before the
  result limit is reached.
- Enable an Indian residential proxy when you need a store in India. The store affects prices,
  stock, and delivery estimates.
- Schedule repeat runs to compare price and availability changes.

## Limitations

- The Actor collects Zepto search results, not a full catalog or arbitrary product pages.
- One run uses one search context. The schema does not accept a list of queries.
- There are no filters for brand, category, price, stock, or sort order.
- The delivery store is chosen by Zepto from the request IP. Two runs from different IPs can return
  different prices for the same product. `store_id` shows which store was used.
- Result counts depend on the query. A run can stop at `results_wanted`, `max_pages`, the end of the
  results, or a session failure, so fewer rows may be returned.
- Zepto may ask an IP to log in before searching. The Actor tries the lighter storefront in that
  case. If both storefronts refuse, enable an Indian residential proxy and retry.
- Prices are in INR and change between runs.

## Integrations and export formats

- **Apify API** - Read dataset items from applications and pipelines.
- **Google Sheets** - Review product prices, brands, pack sizes, and stock.
- **Webhooks** - Notify another service when a run finishes.
- **Make or Zapier** - Send rows to no-code workflows.
- **JSON, CSV, Excel, and XML** - Export for analysis or imports.

## Frequently Asked Questions

### Can I search Zepto by keyword?

Yes. Set `query` to a product term such as `coffee` or `shampoo`.

### Can I use a Zepto search URL instead?

Yes. Set `startUrl` to a public Zepto search URL that contains a `query` parameter. If `query` is
also set, `query` wins.

### Are prices returned in Indian rupees?

Yes. Price fields are converted to numeric INR values.

### Why is a field missing from a product?

Zepto does not publish every attribute for every product. The Actor omits empty values, so a missing
field usually means the source did not return it.

### Will duplicate products appear across pages?

No. The Actor removes repeats when a product or store-level identifier is available.

### Why do prices differ between runs?

Zepto prices depend on the delivery store it assigns to the request IP. Use an Indian proxy to keep
the region stable, and compare rows by `store_id`.

### Can I run this Actor on a schedule?

Yes. Create an Apify schedule with the same input and compare datasets over time.

### What happens if a request is blocked?

The Actor retries, rebuilds the session when needed, switches to Zepto's lighter storefront if the
main one asks for a login, and falls back to reading the rendered results page. If nothing can be
collected, the run fails with a clear message instead of saving an empty dataset.

### Is it legal to collect Zepto data?

You are responsible for complying with Zepto's terms, applicable laws, privacy rules, and any
restrictions on the data you collect. Use the Actor for legitimate research and monitoring.

## Related Actors

- [Target Product Scraper](https://apify.com/shahidirfan/target-product-scraper) - Product prices,
  ratings, availability, images, and inventory data from Target.com.
- [Trendyol Product Scraper](https://apify.com/shahidirfan/trendyol-product-scraper) - Product,
  price, rating, seller, image, and category data from Trendyol search results.
- [Shopify Product Scraper](https://apify.com/shahidirfan/shopify-product-scraper) - Normalized
  product and variant data from public Shopify stores.

## Support

For issues, feature requests, or changes in Zepto's search results, use the Issues tab on the Actor
page in Apify Console. Include the input, run ID, and a short description of the unexpected result.

## Legal Notice

This Actor is intended for legitimate collection and analysis of publicly available Zepto product
information. Users are responsible for complying with Zepto's website terms, applicable laws,
privacy obligations, and any requirements governing the use or redistribution of collected data.
