#!/usr/bin/env bash
# ABU's databaseroller (RLS fase 0): kører prisma/roles.sql (monteret som /abu/roles.sql) som superbrugeren.
#  - Automatisk ved FØRSTE start af compose-Postgres (tom datamappe), før migrate-servicen kører.
#  - Manuelt: `docker compose run --rm db-roles` (fx efter skift af adgangskode eller på en eksisterende volumen).
# Adgangskoderne kommer fra miljøet (ABU_OWNER_PASSWORD, ABU_APP_PASSWORD, valgfri ABU_JOBS_PASSWORD) – aldrig fra repoet –
# og skrives ikke ud.
set -euo pipefail

check() {
  local name=$1 value=${2-}
  if [[ ! "$value" =~ ^[A-Za-z0-9._~-]{24,}$ ]]; then
    echo "[abu-roles] $name skal være sat: mindst 24 tegn, kun A-Z a-z 0-9 . _ ~ - (generér med: openssl rand -hex 32)" >&2
    exit 1
  fi
}
check ABU_OWNER_PASSWORD "${ABU_OWNER_PASSWORD-}"
check ABU_APP_PASSWORD "${ABU_APP_PASSWORD-}"
if [[ -n "${ABU_JOBS_PASSWORD-}" ]]; then check ABU_JOBS_PASSWORD "$ABU_JOBS_PASSWORD"; fi

psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-abu}" \
  -v owner_password="$ABU_OWNER_PASSWORD" -v app_password="$ABU_APP_PASSWORD" -v jobs_password="${ABU_JOBS_PASSWORD-}" <<'SQL'
\o /dev/null
SELECT set_config('abu.owner_password', :'owner_password', false),
       set_config('abu.app_password', :'app_password', false),
       set_config('abu.jobs_password', :'jobs_password', false);
\o
\i /abu/roles.sql
SQL
echo "[abu-roles] Rollerne abu_owner, abu_app og abu_jobs er klar i databasen ${POSTGRES_DB:-abu}."
