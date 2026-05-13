# Custom Fly Postgres image — adds pgvector to flyio/postgres-flex:17.2
#
# flyio/postgres-flex:17.2 (v0.1.0) ships without pgvector at the OS level.
# The Help System (see doc/Help_System_Plan.md) needs vector(384) columns
# and ivfflat indexes for semantic retrieval. This image extends the
# official Fly Postgres flex image and apt-installs the pgvector
# extension package so `CREATE EXTENSION vector` works post-deploy.
#
# Build + push (one-shot):
#
#   flyctl auth docker
#   docker build --platform linux/amd64 \
#     -t registry.fly.io/xo-db-staging:pgvector-v1 \
#     infra/pg-pgvector
#   docker push registry.fly.io/xo-db-staging:pgvector-v1
#
# Apply to the running cluster:
#
#   flyctl image update --image registry.fly.io/xo-db-staging:pgvector-v1 \
#     -a xo-db-staging --yes
#
# Verify after the update lands:
#
#   flyctl ssh console -a xo-db-staging -C \
#     "sh -c 'PGPASSWORD=<pw> psql -h 127.0.0.1 -U xo_backend_staging \
#       -d xo_backend_staging -c \"CREATE EXTENSION IF NOT EXISTS vector;\"'"
#
# When promoting to prod, repeat the build + push against `xo-db-prod`
# and bump the tag (e.g., pgvector-v2).

FROM flyio/postgres-flex:17.2

# postgresql-17-pgvector is the apt package for the pgvector extension on
# PG 17 in Ubuntu 24.04. The base image is Ubuntu 24.04 per its labels.
# We rely on the PostgreSQL apt repo that the parent image already has
# configured — no apt-source changes needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
