import { type Tx, rows } from "./db.js";
import { type Actor, getActor, requireRole } from "./auth.js";
import { scope, orderDto, camel, has, listOrders } from "./repository.js";
import { customerDto, productDto } from "./orders.js";
import { areaDto } from "./masters.js";
export async function workspace(tx: Tx, u: Actor) {
  const s = scope(u);
  const orders = await rows(
    tx,
    `SELECT o.* FROM orders o WHERE ${s.sql} ORDER BY o.updated_at DESC,o.id`,
    ...s.args,
  );
  const related = `SELECT o.id FROM orders o WHERE ${s.sql}`;
  const users = has(u, "SUPER_ADMIN")
    ? await Promise.all(
        (await rows(tx, "SELECT id FROM users ORDER BY name")).map((r) =>
          getActor(tx, String(r.id)),
        ),
      )
    : has(u, "WAREHOUSE_MANAGER")
      ? await rows(
          tx,
          `SELECT u.id,u.name,u.username,u.active,u.version,ARRAY['DRIVER']::text[] AS roles,ARRAY[]::text[] AS "areaIds" FROM users u WHERE active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND role='DRIVER')`,
        )
      : [u];
  return {
    user: u,
    users,
    orders: await Promise.all(orders.map((o) => orderDto(tx, o))),
    customers: has(u, "SALES_REP", "FINANCE")
      ? (u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
          ? await rows(tx, "SELECT * FROM customers ORDER BY name")
          : await rows(
              tx,
              `SELECT c.* FROM customers c
                 WHERE c.active AND EXISTS(
                   SELECT 1 FROM user_areas ua WHERE ua.user_id=$1::uuid AND ua.area_id=c.area_id
                 ) ORDER BY c.name`,
              u.id,
            )
        ).map(customerDto)
      : [],
    areas: has(u, "SALES_REP", "FINANCE")
      ? (
          await rows(
            tx,
            u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
              ? "SELECT * FROM areas ORDER BY name"
              : `SELECT a.* FROM areas a
                   WHERE a.active AND EXISTS(
                     SELECT 1 FROM user_areas ua WHERE ua.user_id=$1::uuid AND ua.area_id=a.id
                   ) ORDER BY a.name`,
            ...(u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
              ? []
              : [u.id]),
          )
        ).map(areaDto)
      : [],
    products: has(
      u,
      "SALES_REP",
      "SUPER_ADMIN",
      "FINANCE",
      "WAREHOUSE_MANAGER",
      "SALES_MANAGER",
    )
      ? (await rows(tx, "SELECT * FROM products ORDER BY name")).map(productDto)
      : [],
    inventory: has(u, "SALES_MANAGER", "WAREHOUSE_MANAGER", "FINANCE")
      ? (
          await rows(
            tx,
            "SELECT product_id,on_hand,reserved,version FROM inventory_balances",
          )
        ).map(camel)
      : [],
    stockReceipts: has(u, "WAREHOUSE_MANAGER", "FINANCE")
      ? (
          await rows(
            tx,
            `SELECT r.*,p.name AS product_name,p.sku AS product_sku FROM stock_receipts r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC,r.id`,
          )
        ).map(camel)
      : [],
    reservations: (
      await rows(
        tx,
        `SELECT id,order_id,order_item_id AS item_id,product_id,quantity,state AS status FROM reservations WHERE order_id IN (${related})`,
        ...s.args,
      )
    ).map(camel),
    attempts: (
      await rows(
        tx,
        `SELECT * FROM delivery_attempts WHERE order_id IN (${related}) ORDER BY occurred_at,id`,
        ...s.args,
      )
    ).map(camel),
    activity: (
      await rows(
        tx,
        `SELECT * FROM activity_events WHERE ${has(u, "SUPER_ADMIN") ? `((order_id IS NULL AND type NOT IN ('DRAFT','DELETE_DRAFT')) OR order_id IN (${related}))` : `order_id IN (${related})`} ORDER BY occurred_at,id`,
        ...s.args,
      )
    ).map(camel),
  };
}
export async function readEndpoint(
  tx: Tx,
  u: Actor,
  path: string,
  query: Record<string, unknown>,
) {
  if (path === "workspace") return workspace(tx, u);
  if (path === "orders") return listOrders(tx, u, query);
  if (path === "dashboard") {
    const data = await workspace(tx, u);
    return {
      counts: Object.fromEntries(
        [
          "DRAFT",
          "PENDING_FINANCE",
          "PENDING_MANAGER",
          "MANAGER_APPROVED",
          "WAREHOUSE_CONFIRMED",
          "IN_TRANSIT",
          "DELIVERED",
          "REJECTED",
          "CANCELLED",
        ].map((s) => [s, data.orders.filter((o) => o.status === s).length]),
      ),
      required: await listOrders(tx, u, { tab: "mine", pageSize: 5 }),
      activity: data.activity.slice(-5),
    };
  }
  if (["users", "customers", "products", "areas"].includes(path)) {
    requireRole(
      u,
      ...(path === "users" || path === "areas" ? ["SUPER_ADMIN"] : ["FINANCE"]),
    );
    const data = await workspace(tx, u);
    return data[path as "users" | "customers" | "products" | "areas"];
  }
  if (path === "lookups/customers" || path === "lookups/products") {
    requireRole(u, "SALES_REP", "FINANCE");
    if (path.endsWith("customers"))
      return (
        u.roles.includes("SUPER_ADMIN") || u.roles.includes("FINANCE")
          ? await rows(tx, "SELECT * FROM customers WHERE active ORDER BY name")
          : await rows(
              tx,
              `SELECT c.* FROM customers c WHERE c.active AND EXISTS(
                 SELECT 1 FROM user_areas ua WHERE ua.user_id=$1::uuid AND ua.area_id=c.area_id
               ) ORDER BY c.name`,
              u.id,
            )
      ).map(customerDto);
    return (
      await rows(tx, "SELECT * FROM products WHERE active ORDER BY name")
    ).map(productDto);
  }
  if (path === "lookups/drivers") {
    requireRole(u, "WAREHOUSE_MANAGER");
    return rows(
      tx,
      `SELECT u.id,u.name,u.active,ARRAY['DRIVER']::text[] roles,ARRAY[]::text[] AS "areaIds" FROM users u WHERE active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND role='DRIVER') ORDER BY u.name,u.id`,
    );
  }
  if (path === "inventory/balances") {
    requireRole(u, "WAREHOUSE_MANAGER", "SALES_MANAGER", "FINANCE");
    return (
      await rows(
        tx,
        "SELECT product_id,on_hand,reserved,version FROM inventory_balances ORDER BY product_id",
      )
    ).map(camel);
  }
  if (path === "inventory/movements") {
    requireRole(u, "WAREHOUSE_MANAGER", "SALES_MANAGER", "FINANCE");
    return (
      await rows(
        tx,
        "SELECT * FROM stock_movements ORDER BY occurred_at DESC,id",
      )
    ).map(camel);
  }
  if (path === "inventory/receipts") {
    requireRole(u, "WAREHOUSE_MANAGER", "FINANCE");
    return (
      await rows(
        tx,
        `SELECT r.*,p.name AS product_name,p.sku AS product_sku FROM stock_receipts r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC,r.id`,
      )
    ).map(camel);
  }
  if (path === "activity") {
    requireRole(u, "SUPER_ADMIN");
    const s = scope(u);
    return (
      await rows(
        tx,
        `SELECT * FROM activity_events WHERE (order_id IS NULL AND type NOT IN ('DRAFT','DELETE_DRAFT')) OR order_id IN(SELECT o.id FROM orders o WHERE ${s.sql}) ORDER BY occurred_at DESC,id`,
        ...s.args,
      )
    ).map(camel);
  }
  return undefined;
}
