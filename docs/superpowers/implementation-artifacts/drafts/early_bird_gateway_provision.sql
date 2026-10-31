-- Draft operator script: run only after review, supplying an existing dedicated
-- LOGIN with psql -v gateway_login=...; never add membership to a shared login.
-- Passwords are managed in a protected libpq passfile, not this script.
GRANT ii_tonya_wave_gateway TO :"gateway_login";
