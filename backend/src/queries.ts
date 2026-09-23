import { type Tx, rows } from "./db.js";
import { type Actor, getActor } from "./auth.js";
import { scope, orderDto, camel, listOrders } from "./repository.js";
import {
  hasPermission,
  requirePermission,
  requireSuperAdmin,
} from "./permissions.js";
import { customerDto, productDto } from "./orders.js";
import { areaDto, rolePermissions } from "./masters.js";

export async function workspace(tx: Tx, u: Actor) {
  const s = scope(u);
  const orders = await rows(
    tx,
    `SELECT o.* FROM orders o WHERE ${s.sql} ORDER BY o.updated_at DESC,o.id`,
    ...s.args,
  );
  const related = `SELECT o.id FROM orders o WHERE ${s.sql}`;
  const users = hasPermission(u, "USERS_MANAGE")
    ? await Promise.all(
        (await rows(tx, "SELECT id FROM users ORDER BY name")).map((r) =>
          getActor(tx, String(r.id)),
        ),
      )
    : hasPermission(u, "WAREHOUSE_PREPARE")
      ? await Promise.all(
          (
            await rows(
              tx,
              `SELECT u.id FROM users u WHERE active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND role='DRIVER') ORDER BY u.name,u.id`,
            )
          ).map((r) => getActor(tx, String(r.id))),
        )
      : [u];
  const managesCustomers = hasPermission(u, "CUSTOMERS_MANAGE");
  const managesAreas = hasPermission(u, "AREAS_MANAGE");
  return {
    user: u,
    users,
    orders: await Promise.all(orders.map((o) => orderDto(tx, o))),
    customers: hasPermission(u, "ORDERS_CREATE", "CUSTOMERS_MANAGE")
      ? (managesCustomers
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
    areas: hasPermission(u, "ORDERS_CREATE", "CUSTOMERS_MANAGE", "AREAS_MANAGE")
      ? (
          await rows(
            tx,
            managesCustomers || managesAreas
              ? "SELECT * FROM areas ORDER BY name"
              : `SELECT a.* FROM areas a
                   WHERE a.active AND EXISTS(
                     SELECT 1 FROM user_areas ua WHERE ua.user_id=$1::uuid AND ua.area_id=a.id
                   ) ORDER BY a.name`,
            ...(managesCustomers || managesAreas ? [] : [u.id]),
          )
        ).map(areaDto)
      : [],
    products: hasPermission(
      u,
      "ORDERS_CREATE",
      "PRODUCTS_MANAGE",
      "INVENTORY_VIEW",
      "INVENTORY_RECEIVE",
      "WAREHOUSE_PREPARE",
    )
      ? (await rows(tx, "SELECT * FROM products ORDER BY name")).map(productDto)
      : [],
    inventory: hasPermission(u, "INVENTORY_VIEW")
      ? (
          await rows(
            tx,
            "SELECT product_id,on_hand,reserved,version FROM inventory_balances",
          )
        ).map(camel)
      : [],
    stockReceipts: hasPermission(u, "INVENTORY_RECEIVE", "RECEIPTS_APPROVE")
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
        `SELECT * FROM activity_events WHERE ${hasPermission(u, "ACTIVITY_VIEW") ? `((order_id IS NULL AND type NOT IN ('DRAFT','DELETE_DRAFT')) OR order_id IN (${related}))` : `order_id IN (${related})`} ORDER BY occurred_at,id`,
        ...s.args,
      )
    ).map(camel),
    rolePermissions: u.roles.includes("SUPER_ADMIN")
      ? await rolePermissions(tx)
      : [],
  };
}

export async function readEndpoint(
  tx: Tx,
  u: Actor,
  path: string,
  query: Record<string, unknown>,
) {
  if (path === "workspace") return workspace(tx, u);
  if (path === "orders") {
    requirePermission(u, "ORDERS_VIEW");
    return listOrders(tx, u, query);
  }
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
        ].map((status) => [
          status,
          data.orders.filter((order) => order.status === status).length,
        ]),
      ),
      required: await listOrders(tx, u, { tab: "mine", pageSize: 5 }),
      activity: data.activity.slice(-5),
    };
  }
  if (["users", "customers", "products", "areas"].includes(path)) {
    requirePermission(
      u,
      path === "users"
        ? "USERS_MANAGE"
        : path === "areas"
          ? "AREAS_MANAGE"
          : path === "customers"
            ? "CUSTOMERS_MANAGE"
            : "PRODUCTS_MANAGE",
    );
    const data = await workspace(tx, u);
    return data[path as "users" | "customers" | "products" | "areas"];
  }
  if (path === "role-permissions") {
    requireSuperAdmin(u);
    return rolePermissions(tx);
  }
  if (path === "lookups/customers" || path === "lookups/products") {
    requirePermission(
      u,
      "ORDERS_CREATE",
      path.endsWith("customers") ? "CUSTOMERS_MANAGE" : "PRODUCTS_MANAGE",
    );
    if (path.endsWith("customers"))
      return (
        hasPermission(u, "CUSTOMERS_MANAGE")
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
    requirePermission(u, "WAREHOUSE_PREPARE");
    return Promise.all(
      (
        await rows(
          tx,
          `SELECT u.id FROM users u WHERE active AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND role='DRIVER') ORDER BY u.name,u.id`,
        )
      ).map((row) => getActor(tx, String(row.id))),
    );
  }
  if (path === "inventory/balances") {
    requirePermission(u, "INVENTORY_VIEW");
    return (
      await rows(
        tx,
        "SELECT product_id,on_hand,reserved,version FROM inventory_balances ORDER BY product_id",
      )
    ).map(camel);
  }
  if (path === "inventory/movements") {
    requirePermission(u, "INVENTORY_VIEW");
    return (
      await rows(
        tx,
        "SELECT * FROM stock_movements ORDER BY occurred_at DESC,id",
      )
    ).map(camel);
  }
  if (path === "inventory/receipts") {
    requirePermission(u, "INVENTORY_RECEIVE", "RECEIPTS_APPROVE");
    return (
      await rows(
        tx,
        `SELECT r.*,p.name AS product_name,p.sku AS product_sku FROM stock_receipts r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC,r.id`,
      )
    ).map(camel);
  }
  if (path === "activity") {
    requirePermission(u, "ACTIVITY_VIEW");
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
