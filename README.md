## What does Zepto Product Scraper do?

Zepto Product Scraper is a Zepto product scraper and data extractor for collecting structured product search results from Zepto. Enter a product keyword with `query` or provide a public Zepto search URL through `startUrl`, then receive one dataset item per product.

The output includes product names, brands, pack sizes, categories, prices in Indian rupees, discounts, availability, ratings, product identifiers, images, and other catalog attributes when Zepto publishes them. This makes the Actor useful for ecommerce market research, price monitoring, assortment analysis, catalog enrichment, and recurring availability checks.

## Why use Zepto Product Scraper?

- **Product research** - Build structured datasets for grocery, household, personal care, electronics, and other products returned by Zepto search.
- **Price monitoring** - Compare MRP, selling price, discounted price, discount percentage, and membership-related price fields across scheduled runs.
- **Availability analysis** - Track out-of-stock status, available quantity, catalog quantity, and product activity signals when available.
- **Catalog intelligence** - Group results by brand, category, subcategory, pack size, product type, or product and variant identifiers.
- **Workflow-ready data** - Review the default Apify dataset, export it to common formats, or connect it to downstream data workflows.

## What data can you extract from Zepto?

Each dataset item represents one product or product variant returned for the search query. Common fields include:

| Field | Description |
|-------|-------------|
| `name` | Product name shown in the search results. |
| `brand` | Product brand when available. |
| `formatted_packsize` | Human-readable pack size. |
| `mrp` | Maximum retail price in INR. |
| `selling_price` | Selling price in INR. |
| `discounted_selling_price` | Discounted selling price in INR. |
| `out_of_stock` | Whether the item is marked out of stock. |
| `rating_average` | Average product rating. |
| `rating_count` | Number of ratings. |
| `image_url` | Primary product image URL when available. |

## How to scrape Zepto product data

1. Open Zepto Product Scraper on Apify.
2. Enter a product keyword in `query`, or use a public Zepto search URL in `startUrl`.
3. Set `results_wanted` and `max_pages` for the size of the collection.
4. Enable `proxyConfiguration` only when your run needs Apify Proxy routing.
5. Start the run and review the dataset preview.
6. Download the results or connect the dataset to your next workflow.

If both `query` and `startUrl` are supplied, the search term from `query` is used and synchronized into the URL. A usable `query`, or a `startUrl` containing a `query` parameter, is required even though the schema marks the fields as optional.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | String | No* | `"Chocolate"` | Product search term to collect from Zepto. |
| `startUrl` | String | No* | `"https://www.zepto.com/search?query=Chocolate"` | Public Zepto search URL. Its `query` parameter is used when `query` is not supplied, and is synchronized when both are supplied. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique product records to save. The minimum accepted value is `1`. |
| `max_pages` | Integer | No | `5` | Maximum number of search result pages to process. The minimum accepted value is `1`. |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Optional Apify Proxy configuration for the run. |

`*` At least one usable search input is required. The public input schema accepts `query`, `startUrl`, `results_wanted`, `max_pages`, and `proxyConfiguration`.

## Output Data

Each dataset item is a flat JSON object. Fields that are not present or are empty in the source data are omitted from that item.

| Field | Type | Description |
|-------|------|-------------|
| `search_query` | String | Search term used for the run. |
| `page_number` | Integer | Result page index where the product was found. The first page is `0`. |
| `store_product_id` | String | Zepto store-level product identifier. |
| `product_id` | String | Product identifier. |
| `product_variant_id` | String | Product variant identifier. |
| `store_id` | String | Store identifier when available. |
| `name` | String | Product name. |
| `brand` | String | Product brand. |
| `country_of_origin` | String | Country of origin when published. |
| `manufacturer_name` | String | Manufacturer name when published. |
| `primary_category_name` | String | Primary category name. |
| `primary_category_id` | String | Primary category identifier. |
| `primary_subcategory_id` | String | Primary subcategory identifier. |
| `primary_subcategory_name` | String | Primary subcategory name when available. |
| `formatted_packsize` | String | Formatted pack size label. |
| `packsize` | Number or String | Pack size value supplied by Zepto. |
| `unit_of_measure` | String | Unit used for the pack size. |
| `available_quantity` | Number | Quantity currently available when published. |
| `catalog_quantity` | Number | Catalog quantity signal when available. |
| `max_allowed_quantity` | Number | Maximum quantity allowed for the item when published. |
| `out_of_stock` | Boolean | Whether the item is out of stock. |
| `is_active` | Boolean | Whether the item is marked active. |
| `is_best_offer` | Boolean | Whether the item is marked as a best offer. |
| `is_new_product` | Boolean | Whether the item is marked as a new product. |
| `mrp` | Number | Maximum retail price in INR. |
| `selling_price` | Number | Selling price in INR. |
| `discounted_selling_price` | Number | Discounted selling price in INR. |
| `discount_amount` | Number | Discount amount in INR. |
| `discount_percent` | Number | Discount percentage. |
| `super_saver_selling_price` | Number | Super Saver selling price in INR when available. |
| `zepto_pass_price` | Number | Zepto Pass price in INR when available. |
| `rating_average` | Number | Average product rating. |
| `rating_count` | Integer | Total number of ratings. |
| `image_url` | String | Primary product image URL. |
| `fssai_license` | String | FSSAI license information when published. |
| `shelf_life_hours` | Integer | Product shelf life in hours when available. |
| `weight_in_gms` | Number | Product weight in grams when published. |
| `product_type` | String | Product type supplied by Zepto. |
| `description` | String | Product description. Multiple source entries are combined into one text value. |
| `how_to_use` | String | Usage instructions when published. |
| `attribute_tags` | Array of Strings | Unique product attribute tags when available. |
| `scraped_at` | String | ISO timestamp for when the record was collected. |

## Usage Examples

### Basic keyword search

Collect up to 20 products matching a Zepto search term:

```json
{
  "query": "Chocolate",
  "results_wanted": 20
}
```

### Search URL input

Use a public Zepto search URL when the search context is already represented in the URL:

```json
{
  "startUrl": "https://www.zepto.com/search?query=chips",
  "results_wanted": 30,
  "max_pages": 4
}
```

### Larger collection with Apify Proxy

Request more records and enable Apify Proxy for a larger recurring collection:

```json
{
  "query": "protein powder",
  "results_wanted": 100,
  "max_pages": 10,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

## Sample Output

The following is one example of a dataset item. Values and available fields vary by product:

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

## Data-quality behavior

- Records are flattened into business-friendly scalar fields and small string arrays.
- Empty, null, undefined, and non-finite values are omitted instead of being saved as noisy placeholders.
- Products are deduplicated across processed pages using the available product or store-level identifier.
- Zepto price values are converted to INR rupees before they are saved.
- Product descriptions and usage instructions are normalized into text. Attribute tags are kept as unique string values.
- `scraped_at` records the collection time, while `page_number` and `search_query` preserve run context.

## Tips for best results

- Use specific search terms such as `dark chocolate pack` or `wireless earbuds` when you need a focused dataset.
- Start with 20 results to confirm the query and output before increasing `results_wanted`.
- Increase `max_pages` when a query has more results than the first page, while keeping the page cap high enough for the requested result limit.
- Review several records before treating any field as universal. Zepto may omit descriptions, ratings, quantities, or other attributes for individual products.
- Schedule repeat runs when you need to compare price or availability changes over time.

## Limitations

- The Actor collects Zepto search results, not a general product catalog or arbitrary product detail pages.
- One run accepts one search context. The public schema does not provide a list of queries or multiple start URLs.
- There are no input filters for brand, category, price range, stock status, location, or sorting order.
- The Actor does not return a dedicated product-page URL field. Use the product identifiers and `image_url` together with your own catalog workflow when product-page linking is needed.
- Result counts depend on what Zepto returns for the query. The run can stop at `results_wanted`, `max_pages`, or the end of the available search results, so fewer records may be returned.
- Prices are reported in INR and may change between runs. Availability and store-specific values can also vary.

## Integrations and export formats

- **Apify API** - Read dataset items from applications and data pipelines.
- **Google Sheets** - Review product prices, brands, pack sizes, and availability.
- **Webhooks** - Notify another service after a run completes.
- **Make or Zapier** - Send product records to no-code workflows.
- **JSON, CSV, Excel, and XML** - Export results for analysis, reporting, or system imports.

## Frequently Asked Questions

### Can I search Zepto by keyword?

Yes. Set `query` to the product term you want to collect, such as `coffee` or `shampoo`.

### Can I use a Zepto search URL instead?

Yes. Set `startUrl` to a public Zepto search URL containing a `query` parameter. If you also set `query`, the explicit `query` value is used.

### Are prices returned in Indian rupees?

Yes. Price fields are converted to numeric INR rupee values, including `mrp`, `selling_price`, `discounted_selling_price`, and other available price signals.

### Why is a field missing from a product?

Zepto does not publish every attribute for every product. The Actor omits empty values, so missing fields usually indicate unavailable source data rather than an empty placeholder.

### Will duplicate products appear across pages?

No. The Actor removes repeated products when a usable product or store-level identifier is available.

### Can I run this Actor on a schedule?

Yes. Create an Apify schedule to repeat the same query and compare datasets over time.

### Is it legal to collect Zepto data?

You are responsible for complying with Zepto's terms, applicable laws, privacy requirements, and any restrictions governing the data you collect. Use the Actor for legitimate research, monitoring, and business workflows.

## Related Actors

- [Target Product Scraper](https://apify.com/shahidirfan/target-product-scraper) - Collect product prices, ratings, availability, images, and inventory data from Target.com.
- [Trendyol Product Scraper](https://apify.com/shahidirfan/trendyol-product-scraper) - Collect structured product, price, rating, seller, image, and category data from Trendyol search results.
- [Shopify Product Scraper](https://apify.com/shahidirfan/shopify-product-scraper) - Collect normalized product and variant data from public Shopify-powered stores.

## Support

For issues, feature requests, or changes in Zepto's search results, use the Issues tab on the Actor page in Apify Console. Include the input used, run ID, and a short description of the unexpected result.

## Legal Notice

This Actor is intended for legitimate collection and analysis of publicly available Zepto product information. Users are responsible for complying with Zepto's website terms, applicable laws, privacy obligations, and any requirements governing the use or redistribution of collected data.
