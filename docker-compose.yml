services:
  fastapi-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      KAFKA_BOOTSTRAP_SERVERS: ${KAFKA_BOOTSTRAP_SERVERS}
      KAFKA_SECURITY_PROTOCOL: ${KAFKA_SECURITY_PROTOCOL:-PLAINTEXT}
      OPENSEARCH_URL: ${OPENSEARCH_URL}
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGINS: http://localhost:3000
    restart: unless-stopped

  kafka-consumer:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: ["python", "-m", "app.consumer"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      KAFKA_BOOTSTRAP_SERVERS: ${KAFKA_BOOTSTRAP_SERVERS}
      KAFKA_SECURITY_PROTOCOL: ${KAFKA_SECURITY_PROTOCOL:-PLAINTEXT}
      OPENSEARCH_URL: ${OPENSEARCH_URL}
    depends_on:
      - fastapi-backend
    restart: unless-stopped

  nextjs-frontend:
    build:
      context: ./frontend-nextjs
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8000}
    depends_on:
      - fastapi-backend
    restart: unless-stopped

  # Optional local infrastructure for offline development without Aiven Cloud:
  # Run with: docker compose --profile local-infra up --build
  postgres:
    image: postgres:16-alpine
    profiles: ["local-infra"]
    environment:
      POSTGRES_DB: shopstream
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-shopstream_local_dev}
    ports:
      - "5432:5432"

  kafka:
    image: bitnami/kafka:3.7
    profiles: ["local-infra"]
    environment:
      KAFKA_CFG_NODE_ID: 0
      KAFKA_CFG_PROCESS_ROLES: controller,broker
      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: 0@kafka:9093
      KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER
    ports:
      - "9092:9092"

  opensearch:
    image: opensearchproject/opensearch:2.17.1
    profiles: ["local-infra"]
    environment:
      discovery.type: single-node
      DISABLE_SECURITY_PLUGIN: "true"
    ports:
      - "9200:9200"
