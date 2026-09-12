-- Run as migration owner; psql -v runtime_role=sales_runtime -f this-file.sql
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
REVOKE UPDATE, DELETE ON activity_events, stock_movements FROM :"runtime_role";
REVOKE DELETE ON users, customers, products, warehouses FROM :"runtime_role";
REVOKE INSERT, UPDATE, DELETE ON _prisma_migrations FROM :"runtime_role";
