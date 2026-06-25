const fs = require("node:fs");
const path = require("node:path");

const record = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployments", "snowball-burn-only-vanity-bsc.json"), "utf8")
);

module.exports = [
  record.name,
  record.symbol,
  BigInt(record.totalSupply),
  record.owner
];
