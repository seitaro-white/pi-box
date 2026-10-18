#!/bin/sh
# Official-image bootstrap: runs only for an empty data directory. Infrastructure
# only: create the app role/database ownership, never demo tables or sample data.
set -eu
psql --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER DATABASE appdb OWNER TO app;
SQL
