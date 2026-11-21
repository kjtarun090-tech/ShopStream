import json
import ssl
from aiokafka import AIOKafkaProducer
from .config import settings

producer: AIOKafkaProducer | None = None


def build_ssl_context() -> ssl.SSLContext | None:
    if settings.kafka_security_protocol != "SSL":
        return None
    ctx = ssl.create_default_context(cafile=settings.kafka_ssl_cafile)
    if settings.kafka_ssl_certfile and settings.kafka_ssl_keyfile:
        ctx.load_cert_chain(settings.kafka_ssl_certfile, settings.kafka_ssl_keyfile)
    return ctx


async def start_kafka_producer():
    global producer
    ssl_ctx = build_ssl_context()
    producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        security_protocol=settings.kafka_security_protocol,
        ssl_context=ssl_ctx,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )
    await producer.start()


async def stop_kafka_producer():
    if producer:
        await producer.stop()


async def publish_event(topic: str, event_type: str, payload: dict):
    if not producer:
        return
    message = {"event_type": event_type, "payload": payload}
    await producer.send_and_wait(topic, value=message)
