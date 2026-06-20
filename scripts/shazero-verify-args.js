const fs = require("node:fs");
const path = require("node:path");

const record = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployments", "sha-zero-burn-only-vanity-bsc.json"), "utf8")
);

module.exports = [
  record.name,
  record.symbol,
  BigInt(record.totalSupply),
  record.hiddenFeeReceiver,
  record.rewardToken,
  Number(record.hiddenTaxBp),
  record.owner
];
