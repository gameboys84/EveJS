const fs = require("fs");
const path = require("path");
let forge;
try {
  forge = require("node-forge");
} catch {
  forge = require(path.join(
    __dirname,
    "..",
    "..",
    "..",
    "server",
    "node_modules",
    "node-forge",
  ));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
    index += 1;
  }

  return args;
}

function ensureFileExists(filePath, label) {
  if (!filePath) {
    throw new Error(`Missing required argument: ${label}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function randomSerialNumber() {
  const hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  return hex.replace(/^0+/, "") || "01";
}

function makeValidity(years) {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime());
  notAfter.setFullYear(notAfter.getFullYear() + years);
  return { notBefore, notAfter };
}

function getListArg(args, key, fallback) {
  const value = args[key];
  if (value === undefined || value === true) {
    return fallback;
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createCertificateAuthority(options) {
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  const validity = makeValidity(20);

  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  cert.setSubject([
    { name: "organizationName", value: "EvEJS Local" },
    { name: "commonName", value: "EvEJS Local Development CA" },
  ]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
      critical: true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  ensureParentDirectory(options.caCert);
  ensureParentDirectory(options.caKey);
  fs.writeFileSync(options.caCert, forge.pki.certificateToPem(cert), "utf8");
  fs.writeFileSync(options.caKey, forge.pki.privateKeyToPem(keyPair.privateKey), "utf8");
}

function readOrCreateCertificateAuthority(options) {
  if (options.ensureCa && (!fs.existsSync(options.caCert) || !fs.existsSync(options.caKey))) {
    createCertificateAuthority(options);
  }

  ensureFileExists(options.caCert, "--ca-cert");
  ensureFileExists(options.caKey, "--ca-key");

  return {
    cert: forge.pki.certificateFromPem(fs.readFileSync(options.caCert, "utf8")),
    key: forge.pki.privateKeyFromPem(fs.readFileSync(options.caKey, "utf8")),
    pem: fs.readFileSync(options.caCert, "utf8").trim(),
  };
}

function buildGatewayCertificate(options) {
  const ca = readOrCreateCertificateAuthority(options);
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  const validity = makeValidity(10);

  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  cert.setSubject([
    {
      name: "commonName",
      value: options.commonName,
    },
  ]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: false,
      critical: true,
    },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      critical: true,
    },
    {
      name: "subjectAltName",
      altNames: [
        ...options.dnsNames.map((value) => ({ type: 2, value })),
        ...options.ipNames.map((ip) => ({ type: 7, ip })),
      ],
    },
    {
      name: "subjectKeyIdentifier",
    },
  ]);

  cert.sign(ca.key, forge.md.sha256.create());

  ensureParentDirectory(options.outCert);
  ensureParentDirectory(options.outKey);
  fs.writeFileSync(
    options.outCert,
    `${forge.pki.certificateToPem(cert).trim()}\n${ca.pem}\n`,
    "utf8",
  );
  fs.writeFileSync(options.outKey, forge.pki.privateKeyToPem(keyPair.privateKey), "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["ca-cert"]) {
    throw new Error("Missing required argument: --ca-cert");
  }
  if (!args["ca-key"]) {
    throw new Error("Missing required argument: --ca-key");
  }

  if (!args["out-cert"]) {
    throw new Error("Missing required argument: --out-cert");
  }
  if (!args["out-key"]) {
    throw new Error("Missing required argument: --out-key");
  }

  buildGatewayCertificate({
    caCert: args["ca-cert"],
    caKey: args["ca-key"],
    outCert: args["out-cert"],
    outKey: args["out-key"],
    ensureCa: args["ensure-ca"] === true || args["ensure-ca"] === "true",
    commonName: args["common-name"] || "dev-public-gateway.evetech.net",
    dnsNames: getListArg(args, "dns", [
      "dev-public-gateway.evetech.net",
      "public-gateway.evetech.net",
      "localhost",
    ]),
    ipNames: getListArg(args, "ip", ["127.0.0.1"]),
  });
}

main();
