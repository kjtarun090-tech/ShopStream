from opensearchpy import AsyncOpenSearch
from .config import settings

client = AsyncOpenSearch(
    hosts=[settings.opensearch_url],
    use_ssl=settings.opensearch_url.startswith("https://"),
    verify_certs=True,
)


async def ensure_product_index():
    exists = await client.indices.exists(index=settings.opensearch_index)
    if not exists:
        await client.indices.create(
            index=settings.opensearch_index,
            body={
                "settings": {"number_of_shards": 1, "number_of_replicas": 0},
                "mappings": {
                    "properties": {
                        "id": {"type": "integer"},
                        "sku": {"type": "keyword"},
                        "name": {"type": "text"},
                        "description": {"type": "text"},
                        "category_slug": {"type": "keyword"},
                        "category_name": {"type": "text"},
                        "price_cents": {"type": "integer"},
                        "stock": {"type": "integer"},
                        "image_url": {"type": "keyword"},
                    }
                },
            },
        )


async def index_product(doc: dict):
    await ensure_product_index()
    await client.index(index=settings.opensearch_index, id=doc["id"], body=doc, refresh=True)


async def search_products(
    query: str = "",
    category: str | None = None,
    max_price_cents: int | None = None,
    in_stock_only: bool = False,
):
    await ensure_product_index()
    must_clauses = []
    filter_clauses = []

    if query.strip():
        must_clauses.append(
            {
                "multi_match": {
                    "query": query.strip(),
                    "fields": ["name^3", "category_name^2", "description", "sku"],
                    "fuzziness": "AUTO",
                    "prefix_length": 1,
                }
            }
        )
    else:
        must_clauses.append({"match_all": {}})

    if category and category != "all":
        filter_clauses.append({"term": {"category_slug": category}})
    if max_price_cents is not None:
        filter_clauses.append({"range": {"price_cents": {"lte": max_price_cents}}})
    if in_stock_only:
        filter_clauses.append({"range": {"stock": {"gt": 0}}})

    response = await client.search(
        index=settings.opensearch_index,
        body={
            "size": 50,
            "query": {"bool": {"must": must_clauses, "filter": filter_clauses}},
        },
    )
    return [hit["_source"] for hit in response["hits"]["hits"]]
