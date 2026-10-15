"""Read the provided legacy XLS into a private, auditable import batch."""
import argparse
import hashlib
import json
from pathlib import Path

import xlrd

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
book = xlrd.open_workbook(str(args.source))
sheets = {sheet.name.strip(): sheet for sheet in book.sheets()}
customers = sheets["العملاء"]
products = sheets["الاصناف"]
batch = {
    "sourceFile": args.source.name,
    "sourceSha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
    "customers": [],
    "products": [],
}
for index in range(1, customers.nrows):
    row = customers.row_values(index)
    if not any(str(value).strip() for value in row):
        continue
    batch["customers"].append({
        "sourceRow": index + 1,
        "code": str(row[0]).strip(),
        "name": str(row[1]).strip(),
        "representative": str(row[2]).strip(),
    })
for index in range(1, products.nrows):
    row = products.row_values(index)
    if not any(str(value).strip() for value in row):
        continue
    batch["products"].append({
        "sourceRow": index + 1,
        "name": str(row[0]).strip(),
        "weight": None if row[1] == "" else row[1],
        "weightUnit": str(row[2]).strip(),
    })
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"customers": len(batch["customers"]), "products": len(batch["products"])}))
