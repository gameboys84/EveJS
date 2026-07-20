"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const forge = require("node-forge");

const ROOT_DIR = path.resolve(__dirname, "../../../..");
const CA_CERT_PATH = path.join(ROOT_DIR, "server", "certs", "xmpp-ca-cert.pem");
const CA_KEY_PATH = path.join(ROOT_DIR, "server", "certs", "xmpp-ca-key.pem");

const LOCAL_TLS_DNS_ALT_NAMES = Object.freeze([
  "app.launchdarkly.com",
  "clientstream.launchdarkly.com",
  "clientsdk.launchdarkly.com",
  "dev-public-gateway.evetech.net",
  "events.launchdarkly.com",
  "public-gateway.evetech.net",
  "stream.launchdarkly.com",
  "localhost",
]);
const LOCAL_TLS_IP_ALT_NAMES = Object.freeze(["127.0.0.1"]);

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

  ensureParentDirectory(options.caCertPath);
  ensureParentDirectory(options.caKeyPath);
  fs.writeFileSync(options.caCertPath, forge.pki.certificateToPem(cert), "utf8");
  fs.writeFileSync(
    options.caKeyPath,
    forge.pki.privateKeyToPem(keyPair.privateKey),
    "utf8",
  );
}

function ensureCertificateAuthority(options = {}) {
  const caCertPath = options.caCertPath || CA_CERT_PATH;
  const caKeyPath = options.caKeyPath || CA_KEY_PATH;

  if (fs.existsSync(caCertPath) && fs.existsSync(caKeyPath)) {
    return {
      caCertPath,
      caKeyPath,
      rebuilt: false,
    };
  }

  createCertificateAuthority({ caCertPath, caKeyPath });
  return {
    caCertPath,
    caKeyPath,
    rebuilt: true,
  };
}

function buildSubjectAltNames() {
  return [
    ...LOCAL_TLS_DNS_ALT_NAMES.map((value) => ({ type: 2, value })),
    ...LOCAL_TLS_IP_ALT_NAMES.map((ip) => ({ type: 7, ip })),
  ];
}

function buildLocalLeafCertificate(options) {
  const caCertPath = options.caCertPath || CA_CERT_PATH;
  const caKeyPath = options.caKeyPath || CA_KEY_PATH;

  ensureCertificateAuthority({ caCertPath, caKeyPath });

  const caCert = forge.pki.certificateFromPem(
    fs.readFileSync(caCertPath, "utf8"),
  );
  const caPem = fs.readFileSync(caCertPath, "utf8").trim();
  const caKey = forge.pki.privateKeyFromPem(
    fs.readFileSync(caKeyPath, "utf8"),
  );
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
      value: "dev-public-gateway.evetech.net",
    },
  ]);
  cert.setIssuer(caCert.subject.attributes);
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
      altNames: buildSubjectAltNames(),
    },
    {
      name: "subjectKeyIdentifier",
    },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  ensureParentDirectory(options.outCertPath);
  ensureParentDirectory(options.outKeyPath);
  fs.writeFileSync(
    options.outCertPath,
    `${forge.pki.certificateToPem(cert).trim()}\n${caPem}\n`,
    "utf8",
  );
  fs.writeFileSync(
    options.outKeyPath,
    forge.pki.privateKeyToPem(keyPair.privateKey),
    "utf8",
  );
}

function certificateAttributesEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftAttribute, index) => {
    const rightAttribute = right[index];
    return (
      rightAttribute &&
      leftAttribute.type === rightAttribute.type &&
      String(leftAttribute.value) === String(rightAttribute.value)
    );
  });
}

function isIssuedByCertificateAuthority(certPem, caCertPath = CA_CERT_PATH) {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const caCert = forge.pki.certificateFromPem(
      fs.readFileSync(caCertPath, "utf8"),
    );

    return (
      certificateAttributesEqual(
        cert.issuer.attributes,
        caCert.subject.attributes,
      ) &&
      caCert.verify(cert)
    );
  } catch {
    return false;
  }
}

function parseSubjectAltNames(certPem) {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const dnsNames = new Set();
    const ipAddresses = new Set();

    for (const entry of String(x509.subjectAltName || "").split(",")) {
      const normalized = entry.trim();
      if (normalized.startsWith("DNS:")) {
        dnsNames.add(normalized.slice(4).trim().toLowerCase());
      } else if (normalized.startsWith("IP Address:")) {
        ipAddresses.add(normalized.slice("IP Address:".length).trim());
      }
    }

    return { dnsNames, ipAddresses };
  } catch {
    return {
      dnsNames: new Set(),
      ipAddresses: new Set(),
    };
  }
}

function hasRequiredAltNames(certPem) {
  const { dnsNames, ipAddresses } = parseSubjectAltNames(certPem);
  return (
    dnsNames.size === LOCAL_TLS_DNS_ALT_NAMES.length &&
    ipAddresses.size === LOCAL_TLS_IP_ALT_NAMES.length &&
    LOCAL_TLS_DNS_ALT_NAMES.every((name) =>
      dnsNames.has(String(name).toLowerCase()),
    ) &&
    LOCAL_TLS_IP_ALT_NAMES.every((ip) => ipAddresses.has(ip))
  );
}

function ensureLocalLeafCertificate(options = {}) {
  const certDir = options.certDir || path.join(__dirname, "certs");
  const outCertPath =
    options.outCertPath || path.join(certDir, "gateway-dev-cert.pem");
  const outKeyPath =
    options.outKeyPath || path.join(certDir, "gateway-dev-key.pem");
  const caCertPath = options.caCertPath || CA_CERT_PATH;
  const caKeyPath = options.caKeyPath || CA_KEY_PATH;

  ensureCertificateAuthority({ caCertPath, caKeyPath });

  const existingCertPem = fs.existsSync(outCertPath)
    ? fs.readFileSync(outCertPath, "utf8")
    : null;

  if (
    existingCertPem &&
    fs.existsSync(outKeyPath) &&
    hasRequiredAltNames(existingCertPem) &&
    isIssuedByCertificateAuthority(existingCertPem, caCertPath)
  ) {
    return {
      outCertPath,
      outKeyPath,
      rebuilt: false,
    };
  }

  buildLocalLeafCertificate({
    caCertPath,
    caKeyPath,
    outCertPath,
    outKeyPath,
  });

  return {
    outCertPath,
    outKeyPath,
    rebuilt: true,
  };
}

// Ensure a CA-signed TLS cert for the XMPP chat server exists at the given
// paths, creating the shared CA if needed. The EVE client validates the chat
// TLS connection against its certifi CA bundle only and does NOT check the
// hostname, so the SAN set is not critical (localhost + 127.0.0.1 by default,
// plus any extraHosts). Lets a fresh checkout start instead of throwing.
function ensureXmppTlsCertificate(options = {}) {
  const outCertPath = options.outCertPath;
  const outKeyPath = options.outKeyPath;
  if (!outCertPath || !outKeyPath) {
    throw new Error("ensureXmppTlsCertificate requires outCertPath and outKeyPath.");
  }
  const caCertPath = options.caCertPath || CA_CERT_PATH;
  const caKeyPath = options.caKeyPath || CA_KEY_PATH;

  ensureCertificateAuthority({ caCertPath, caKeyPath });

  if (
    fs.existsSync(outCertPath) &&
    fs.existsSync(outKeyPath) &&
    isIssuedByCertificateAuthority(fs.readFileSync(outCertPath, "utf8"), caCertPath)
  ) {
    return { outCertPath, outKeyPath, rebuilt: false };
  }

  const commonName = String(options.commonName || "localhost").trim() || "localhost";
  const dnsAltNames = [];
  const ipAltNames = [];
  const pushHost = (host) => {
    const value = String(host || "").trim();
    if (!value) {
      return;
    }
    if (net.isIP(value)) {
      if (!ipAltNames.includes(value)) {
        ipAltNames.push(value);
      }
    } else if (!dnsAltNames.includes(value)) {
      dnsAltNames.push(value);
    }
  };
  [commonName, "localhost", "127.0.0.1", ...(options.extraHosts || [])].forEach(pushHost);

  const caCert = forge.pki.certificateFromPem(fs.readFileSync(caCertPath, "utf8"));
  const caPem = fs.readFileSync(caCertPath, "utf8").trim();
  const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(caKeyPath, "utf8"));
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  const validity = makeValidity(10);

  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = validity.notBefore;
  cert.validity.notAfter = validity.notAfter;
  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    { name: "extKeyUsage", serverAuth: true, critical: true },
    {
      name: "subjectAltName",
      altNames: [
        ...dnsAltNames.map((value) => ({ type: 2, value })),
        ...ipAltNames.map((ip) => ({ type: 7, ip })),
      ],
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(caKey, forge.md.sha256.create());

  ensureParentDirectory(outCertPath);
  ensureParentDirectory(outKeyPath);
  fs.writeFileSync(
    outCertPath,
    `${forge.pki.certificateToPem(cert).trim()}\n${caPem}\n`,
    "utf8",
  );
  fs.writeFileSync(
    outKeyPath,
    forge.pki.privateKeyToPem(keyPair.privateKey),
    "utf8",
  );

  return { outCertPath, outKeyPath, rebuilt: true };
}

module.exports = {
  CA_CERT_PATH,
  CA_KEY_PATH,
  LOCAL_TLS_DNS_ALT_NAMES,
  LOCAL_TLS_IP_ALT_NAMES,
  buildLocalLeafCertificate,
  ensureCertificateAuthority,
  ensureLocalLeafCertificate,
  ensureXmppTlsCertificate,
  hasRequiredAltNames,
  isIssuedByCertificateAuthority,
};
