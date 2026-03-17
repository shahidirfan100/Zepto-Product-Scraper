## Selected API
- Endpoint: https://bff-gateway.zepto.com/user-search-service/api/v3/search
- Method: POST
- Auth: No explicit auth token required; request relies on captured browser session headers and userSessionId
- Pagination: `pageNumber` request body parameter
- Query parameters/body: `query`, `pageNumber`, `mode`, `userSessionId`
- Response format: JSON

## Selection Notes
- Returns JSON directly: Yes
- Field richness: High (nested product + variant + pricing + category + ratings + media fields)
- Pagination support: Yes (`pageNumber` + `hasReachedEnd`)
- Score summary (per apify-updater rubric): 80+

## Fields Available (API)
- Product identity: `id`, `objectId`, `product.id`, `productVariant.id`, `storeId`
- Product details: `product.name`, `product.brand`, `product.countryOfOrigin`, `product.description`, `product.manufacturerName`
- Category data: `primaryCategoryName`, `primaryCategoryId`, `product.primarySubcategory`
- Variant data: `productVariant.formattedPacksize`, `productVariant.packsize`, `productVariant.unitOfMeasure`, `productVariant.weightInGms`
- Price and discount: `mrp`, `sellingPrice`, `discountedSellingPrice`, `discountAmount`, `discountPercent`, `superSaverSellingPrice`, `zeptoPassPrice`
- Availability: `availableQuantity`, `quantity`, `outOfStock`, `isActive`, `isBestOffer`, `isNewProduct`
- Ratings: `productVariant.ratingSummary.averageRating`, `productVariant.ratingSummary.totalRatings`
- Media and labels: `productVariant.images[]`, `productCardTags`

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
