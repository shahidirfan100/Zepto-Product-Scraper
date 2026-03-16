# Zepto Product Scraper

Extract structured Zepto product search data at scale for analysis, pricing intelligence, and catalog monitoring. Collect product names, pack sizes, prices, stock status, ratings, categories, and images in one run. Built for reliable recurring data collection with clean dataset output.

## Features

- **Search-based extraction** - Collect product data for any Zepto search query.
- **Rich product records** - Capture pricing, stock, ratings, IDs, pack details, and images.
- **Multi-page collection** - Fetch multiple pages until your result limit is reached.
- **Clean datasets** - Removes null and empty values before saving records.
- **Deduplicated output** - Prevents duplicate products across pages.

## Use Cases

### Price Tracking
Monitor product price movement over time and compare pricing across categories for better purchasing and strategy decisions.

### Product Catalog Intelligence
Build clean product datasets for internal catalog enrichment, assortment analysis, and SKU-level tracking.

### Competitive Market Research
Analyze brand-level and category-level product trends to identify high-demand items and market gaps.

### Availability Monitoring
Track stock status and available quantity signals for important products and brands.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | String | No | `"Chocolate"` | Search keyword to scrape from Zepto. |
| `keyword` | String | No | — | Alias for `query` (used when `query` is empty). |
| `startUrl` | String | No | `"https://www.zepto.com/search?query=Chocolate"` | Optional Zepto search URL. Query is synchronized with `query`. |
| `results_wanted` | Integer | No | `20` | Maximum number of products to save. |
| `max_pages` | Integer | No | `5` | Safety cap for number of search pages to process. |
| `proxyConfiguration` | Object | No | Apify Proxy (Residential) | Proxy setup for reliability. |

---

## Output Data

Each dataset item may contain:

| Field | Type | Description |
|-------|------|-------------|
| `search_query` | String | Search query used for extraction. |
| `page_number` | Integer | Page index where the product was found. |
| `store_product_id` | String | Store-level product identifier. |
| `product_id` | String | Product identifier. |
| `product_variant_id` | String | Product variant identifier. |
| `store_id` | String | Store identifier. |
| `name` | String | Product title/name. |
| `brand` | String | Product brand. |
| `primary_category_name` | String | Primary category name. |
| `primary_category_id` | String | Primary category ID. |
| `formatted_packsize` | String | Product pack size label. |
| `unit_of_measure` | String | Unit of measure. |
| `available_quantity` | Integer | Available quantity. |
| `out_of_stock` | Boolean | Stock availability flag. |
| `mrp` | Number | MRP in INR. |
| `selling_price` | Number | Selling price in INR. |
| `discounted_selling_price` | Number | Discounted price in INR. |
| `discount_percent` | Number | Discount percentage. |
| `rating_average` | Number | Average user rating. |
| `rating_count` | Integer | Number of ratings. |
| `image_url` | String | Primary product image URL. |
| `scraped_at` | String | ISO timestamp of extraction. |

---

## Usage Examples

### Basic Query Run

```json
{
  "query": "Chocolate",
  "results_wanted": 20
}
```

### URL-Based Run

```json
{
  "startUrl": "https://www.zepto.com/search?query=chips",
  "results_wanted": 30,
  "max_pages": 4
}
```

### Large Collection Run

```json
{
  "query": "protein",
  "results_wanted": 120,
  "max_pages": 10,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "search_query": "Chocolate",
  "page_number": 0,
  "store_product_id": "74fc41ee-9a42-5b57-855b-b0f190032a4b",
  "product_id": "bb8502be-e590-42d1-93ee-2b28ab0a34a2",
  "product_variant_id": "317547c4-81a0-4aab-8bc1-53e5a719c8ed",
  "store_id": "b4dc8d65-ed2e-4142-81b6-373982b13500",
  "name": "Nestle Kitkat Delights Rich Heart Box | Valentine's Pack",
  "brand": "Kit-Kat",
  "primary_category_name": "Sweet Cravings",
  "formatted_packsize": "1 pack (14 x 7.4 g)",
  "unit_of_measure": "PIECE",
  "available_quantity": 6,
  "out_of_stock": false,
  "mrp": 375,
  "selling_price": 250,
  "discounted_selling_price": 250,
  "discount_percent": 33,
  "rating_average": 4.9,
  "rating_count": 544,
  "image_url": "https://cdn.zeptonow.com/production/cms/product_variant/5f1faf90-68c9-4fed-8076-0e2be46429b4.jpeg",
  "scraped_at": "2026-03-16T15:10:00.000Z"
}
```

---

## Tips for Best Results

### Use Clear Queries
- Use specific product keywords for higher relevance.
- Avoid overly broad terms when you need focused output.

### Keep Runtime Predictable
- Start with `results_wanted: 20` for quick validation.
- Increase `max_pages` only when you need deeper coverage.

### Improve Reliability
- Use proxy configuration for repeatable large runs.
- Schedule runs during off-peak hours for stable throughput.

---

## Integrations

Connect your dataset with:

- **Google Sheets** - Analyze product and price trends.
- **Airtable** - Build searchable SKU catalogs.
- **Looker Studio** - Create dashboards from exported data.
- **Make** - Automate post-processing workflows.
- **Zapier** - Trigger downstream business automations.

### Export Formats

- **JSON** - API and engineering workflows.
- **CSV** - Spreadsheet analysis.
- **Excel** - Business reporting.
- **XML** - System integrations.

---

## Frequently Asked Questions

### How many products can I collect?
You can collect as many as available for your query, controlled by `results_wanted` and `max_pages`.

### Will duplicate products appear?
No. Output is deduplicated across processed pages.

### Why are some fields missing on some products?
Some products may not include every attribute in the source data. Empty values are removed from output.

### Can I run this on a schedule?
Yes. You can schedule recurring runs in Apify and store fresh datasets automatically.

### Does it support different queries each run?
Yes. Set `query` (or `startUrl`) per run to scrape different product groups.

---

## Support

For issues or feature requests, use the Apify Console issue flow for this Actor.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Schedules](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This Actor is intended for lawful data collection and analysis. You are responsible for complying with website terms, local laws, and applicable regulations when using collected data.
