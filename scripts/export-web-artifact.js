const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendorSource = path.join(root, "node_modules", "ethers", "dist", "ethers.umd.min.js");
const webDir = path.join(root, "web");
const vendorDir = path.join(webDir, "vendor");

function readArtifact(contractPath, artifactName) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "artifacts", "contracts", contractPath, `${artifactName}.json`), "utf8")
  );
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const tokenZeroArtifact = readArtifact("TokenZero.sol", "TokenZero");
const snowballTokenArtifact = readArtifact("SnowballToken.sol", "SnowballToken");
const snowballLaunchpadArtifact = readArtifact("SnowballLaunchpad.sol", "SnowballLaunchpad");
const mintAddSaleArtifact = readArtifact("MintAddSale.sol", "MintAddSale");
const mintAddSaleFactoryArtifact = readArtifact("MintAddSaleFactory.sol", "MintAddSaleFactory");
const snowballDeployment =
  readOptionalJson(path.join(root, "deployments", "snowball-launchpad-bsc.json")) ||
  readOptionalJson(path.join(root, "deployments", "snowball-launchpad-bscTestnet.json"));
const mintSaleDeployment =
  readOptionalJson(path.join(root, "deployments", "mint-add-sale-factory-bsc.json")) ||
  readOptionalJson(path.join(root, "deployments", "mint-add-sale-factory-bscTestnet.json"));

// 合并最新的 token 部署地址到 deployment（用于前端自动填充）
const shazeroLegacyDeployment =
  readOptionalJson(path.join(root, "deployments", "snowball-legacy-hidden-tax-vanity-bsc.json")) ||
  readOptionalJson(path.join(root, "deployments", "sha-zero-hidden-tax-bsc.json"));
if (snowballDeployment && shazeroLegacyDeployment && shazeroLegacyDeployment.token) {
  snowballDeployment.token = shazeroLegacyDeployment.token;
  snowballDeployment.tokenName = shazeroLegacyDeployment.name || shazeroLegacyDeployment.tokenName;
  snowballDeployment.tokenSymbol = shazeroLegacyDeployment.symbol || shazeroLegacyDeployment.tokenSymbol;
  snowballDeployment.tokenDeploymentTx = shazeroLegacyDeployment.deploymentTx;
}

fs.mkdirSync(vendorDir, { recursive: true });
fs.writeFileSync(
  path.join(webDir, "tokenzero-artifact.js"),
  `window.TOKENZERO_ARTIFACT = ${JSON.stringify({
    abi: tokenZeroArtifact.abi,
    bytecode: tokenZeroArtifact.bytecode
  })};\n`,
  "utf8"
);
fs.writeFileSync(
  path.join(webDir, "snowball-artifacts.js"),
  `window.SNOWBALL_ARTIFACTS = ${JSON.stringify({
    launchpad: {
      abi: snowballLaunchpadArtifact.abi,
      bytecode: snowballLaunchpadArtifact.bytecode
    },
    token: {
      abi: snowballTokenArtifact.abi,
      bytecode: snowballTokenArtifact.bytecode
    },
    mintSaleFactory: {
      abi: mintAddSaleFactoryArtifact.abi,
      bytecode: mintAddSaleFactoryArtifact.bytecode
    },
    mintSale: {
      abi: mintAddSaleArtifact.abi,
      bytecode: mintAddSaleArtifact.bytecode
    },
    mintSaleDeployment,
    deployment: snowballDeployment
  })};\n`,
  "utf8"
);
fs.copyFileSync(vendorSource, path.join(vendorDir, "ethers.umd.min.js"));

console.log("Exported web artifacts and web/vendor/ethers.umd.min.js");
