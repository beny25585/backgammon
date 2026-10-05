#!/bin/sh
set -eu
# psql imports passwords from its environment, never from command arguments.
for app_name in game tournaments analysis; do
    export APP_DB_USER="backgammon_${app_name}"
    export APP_DB_NAME="backgammon_${app_name}"
    export APP_DB_PASSWORD="$(cat "/run/secrets/${app_name}_password")"
    psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_user APP_DB_USER
\getenv app_db APP_DB_NAME
\getenv app_password APP_DB_PASSWORD
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"app_db" OWNER :"app_user";
SQL
done
unset APP_DB_PASSWORD
