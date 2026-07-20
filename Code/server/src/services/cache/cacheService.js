const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildClientBootMetadataEntries,
  getRuntimeConfig,
} = require(path.join(__dirname, "../machoNet/globalConfig"));

function buildServerVersionAndBuild(runtimeConfig = getRuntimeConfig()) {
  const bootMetadata = new Map(buildClientBootMetadataEntries(runtimeConfig));
  return [
    bootMetadata.get("boot_version"),
    bootMetadata.get("boot_build"),
  ];
}

class CacheService extends BaseService {
  constructor() {
    super("cache");
  }

  Handle_GetServerVersionAndBuild() {
    return buildServerVersionAndBuild();
  }
}

CacheService._testing = {
  buildServerVersionAndBuild,
};

module.exports = CacheService;
