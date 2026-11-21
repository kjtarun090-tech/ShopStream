import secrets
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/shopstream"
    kafka_bootstrap_servers: str = "kafka:9092"
    kafka_security_protocol: str = "PLAINTEXT"
    kafka_ssl_cafile: str | None = None
    kafka_ssl_certfile: str | None = None
    kafka_ssl_keyfile: str | None = None
    kafka_orders_topic: str = "shopstream.orders"
    kafka_inventory_topic: str = "shopstream.inventory"
    opensearch_url: str = "http://opensearch:9200"
    opensearch_index: str = "shopstream_products"
    jwt_secret: str = secrets.token_urlsafe(32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    cors_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
