# Custom Fly Postgres image — adds pgvector to flyio/postgres-flex:17.2
#
# flyio/postgres-flex:17.2 (v0.1.0) ships without pgvector at the OS level.
# The Help System (see doc/Help_System_Plan.md) needs vector(384) columns
# and ivfflat indexes for semantic retrieval. This image extends the
# official Fly Postgres flex image and apt-installs the pgvector
# extension package so `CREATE EXTENSION vector` works post-deploy.
#
# Status: applied to both xo-db-staging and xo-db-prod as of 2026-05-13.
# Re-run only when the base flyio/postgres-flex image bumps and you want
# to rebuild on the newer Postgres version.
#
# Build + push (one-shot, per environment):
#
#   flyctl auth docker
#   docker build --platform linux/amd64 \
#     -t registry.fly.io/xo-db-<env>:pgvector-v1 \
#     infra/pg-pgvector
#   docker push registry.fly.io/xo-db-<env>:pgvector-v1
#
# Apply to the running cluster:
#
#   flyctl image update --image registry.fly.io/xo-db-<env>:pgvector-v1 \
#     -a xo-db-<env> --yes
#
# (~30-60s downtime on single-machine clusters during the image swap.)
#
# Verify after the update lands:
#
#   flyctl ssh console -a xo-db-<env> -C \
#     "sh -c 'PGPASSWORD=<pw> psql -h 127.0.0.1 -U xo_backend_<env> \
#       -d xo_backend_<env> -c \"CREATE EXTENSION IF NOT EXISTS vector;\"'"
#
#   flyctl ssh console -a xo-db-<env> -C \
#     "sh -c 'PGPASSWORD=<pw> psql -h 127.0.0.1 -U xo_backend_<env> \
#       -d xo_backend_<env> -c \"SELECT pg_typeof(ARRAY[1,2,3]::vector);\"'"
#
# DB names per environment (the Fly DATABASE_URL secret value):
#   staging: xo_backend_staging (user + db share the name)
#   prod:    xo_backend_prod    (user + db share the name)

FROM flyio/postgres-flex:17.2

# postgresql-17-pgvector is the apt package for the pgvector extension on
# PG 17 in Ubuntu 24.04. The base image is Ubuntu 24.04 per its labels.
# We rely on the PostgreSQL apt repo that the parent image already has
# configured — no apt-source changes needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
