from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, HTTPException, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .auth import create_access_token, get_current_user, hash_password, require_admin, verify_password
from .config import settings
from .database import Base, engine, get_db
from .kafka_service import publish_event, start_kafka_producer, stop_kafka_producer
from .models import Order, OrderItem, Product, User
from .opensearch_service import search_products

active_sockets: set[WebSocket] = set()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await start_kafka_producer()
    yield
    await stop_kafka_producer()


app = FastAPI(title="ShopStream API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    address: str = ""


class OrderLineInput(BaseModel):
    product_id: int
    quantity: int


class CreateOrderRequest(BaseModel):
    customer_name: str
    customer_email: EmailStr
    shipping_address: str
    items: list[OrderLineInput]


class StockAdjustmentRequest(BaseModel):
    delta: int
    source: str = "physical_store_pos"


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        name=body.name.strip(),
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        address=body.address.strip(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/auth/token")
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form.username.lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/products")
async def list_products(
    q: str = "",
    category: str | None = None,
    max_price_cents: int | None = None,
    in_stock_only: bool = False,
):
    items = await search_products(q, category, max_price_cents, in_stock_only)
    return {"items": items, "total": len(items)}


@app.post("/api/orders", status_code=status.HTTP_201_CREATED)
async def place_order(
    body: CreateOrderRequest,
    user: User | None = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="Order requires at least one item")

    updated_events = []
    async with db.begin():
        total_cents = 0
        order_items: list[OrderItem] = []

        for line in body.items:
            if line.quantity <= 0:
                raise HTTPException(status_code=400, detail="Quantity must be positive")

            # PostgreSQL row-level lock prevents concurrent overselling
            result = await db.execute(
                select(Product).where(Product.id == line.product_id).with_for_update()
            )
            product = result.scalar_one_or_none()
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {line.product_id} not found")
            if product.stock < line.quantity:
                raise HTTPException(
                    status_code=409,
                    detail=f"Insufficient stock for {product.name}: {product.stock} available",
                )

            previous_stock = product.stock
            product.stock -= line.quantity
            total_cents += product.price_cents * line.quantity

            order_items.append(
                OrderItem(
                    product_id=product.id,
                    product_name=product.name,
                    sku=product.sku,
                    quantity=line.quantity,
                    unit_price_cents=product.price_cents,
                )
            )
            updated_events.append(
                {
                    "product_id": product.id,
                    "sku": product.sku,
                    "previous_stock": previous_stock,
                    "new_stock": product.stock,
                }
            )

        order = Order(
            order_number=f"SS-{int(datetime.now(timezone.utc).timestamp())}",
            user_id=user.id if user else None,
            customer_name=body.customer_name,
            customer_email=body.customer_email.lower(),
            shipping_address=body.shipping_address,
            total_cents=total_cents,
            items=order_items,
        )
        db.add(order)

    await publish_event(
        settings.kafka_orders_topic,
        "order.placed",
        {"order_number": order.order_number, "total_cents": order.total_cents},
    )
    for ev in updated_events:
        await publish_event(settings.kafka_inventory_topic, "inventory.updated", ev)

    for ws in list(active_sockets):
        try:
            await ws.send_json({"type": "inventory_sync", "updates": updated_events})
        except Exception:
            active_sockets.discard(ws)

    return {"order_number": order.order_number, "status": order.status, "total_cents": order.total_cents}


@app.post("/api/admin/products/{product_id}/adjust-stock")
async def adjust_stock(
    product_id: int,
    body: StockAdjustmentRequest,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    async with db.begin():
        result = await db.execute(select(Product).where(Product.id == product_id).with_for_update())
        product = result.scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        if product.stock + body.delta < 0:
            raise HTTPException(status_code=409, detail="Resulting stock cannot be negative")
        previous_stock = product.stock
        product.stock += body.delta

    payload = {
        "product_id": product.id,
        "sku": product.sku,
        "previous_stock": previous_stock,
        "new_stock": product.stock,
        "source": body.source,
    }
    await publish_event(settings.kafka_inventory_topic, "inventory.updated", payload)
    return payload


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    active_sockets.add(ws)
    try:
        while True:
            await ws.receive_text()
    except Exception:
        active_sockets.discard(ws)
