import asyncio
import json
from aiokafka import AIOKafkaConsumer
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from .config import settings
from .database import AsyncSessionLocal
from .kafka_service import build_ssl_context
from .models import Product
from .opensearch_service import index_product


async def process_inventory_event(event: dict):
    event_type = event.get("event_type")
    payload = event.get("payload", {})
    product_id = payload.get("product_id")
    if not product_id:
        return

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Product).options(selectinload(Product.category)).where(Product.id == product_id)
        )
        product = result.scalar_one_or_none()
        if not product:
            return

        await index_product(
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "description": product.description,
                "category_slug": product.category.slug,
                "category_name": product.category.name,
                "price_cents": product.price_cents,
                "stock": product.stock,
                "image_url": product.image_url,
            }
        )

    if event_type == "inventory.updated" and payload.get("new_stock", 999) <= 5:
        print(f"[LOW STOCK ALERT] SKU={payload.get('sku')} remaining={payload.get('new_stock')}")


async def run_consumer():
    consumer = AIOKafkaConsumer(
        settings.kafka_orders_topic,
        settings.kafka_inventory_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        security_protocol=settings.kafka_security_protocol,
        ssl_context=build_ssl_context(),
        group_id="shopstream-inventory-sync",
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )
    await consumer.start()
    try:
        async for msg in consumer:
            await process_inventory_event(msg.value)
    finally:
        await consumer.stop()


if __name__ == "__main__":
    asyncio.run(run_consumer())
