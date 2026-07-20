/**
 * Object Caching Service
 *
 * Handles cached data queries for pass-by-value CCP cache objects.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCachedMethodCallVersion,
  getCachableObjectResponse,
  getCachedObject,
  getCachedObjectVersion,
  invalidateCachedMethodCall,
  invalidateCachedMethodCalls,
  invalidateCachedObjects,
  __testHooks,
} = require(path.join(__dirname, "./objectCacheRuntime"));

function normalizeArgsArray(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return value.items;
  }
  return [value];
}

class ObjCacheService extends BaseService {
  constructor() {
    super("objectCaching");
  }

  Handle_GetCachableObject(args) {
    const shared = args && args.length > 0 ? args[0] : 1;
    const objectId = args && args.length > 1 ? args[1] : null;
    const objectVersion = args && args.length > 2 ? args[2] : null;
    const nodeId = args && args.length > 3 ? args[3] : null;

    log.debug(
      `[ObjCache] GetCachableObject ${__testHooks.describeObjectId(objectId)}`,
    );

    return getCachableObjectResponse(shared, objectId, objectVersion, nodeId);
  }

  Handle_GetCachedObject(args) {
    const objectId = args && args.length > 0 ? args[0] : null;
    log.debug(`[ObjCache] GetCachedObject ${__testHooks.describeObjectId(objectId)}`);
    return getCachedObject(objectId);
  }

  Handle_GetCachedObjectVersion(args) {
    const objectId = args && args.length > 0 ? args[0] : null;
    log.debug(`[ObjCache] GetCachedObjectVersion ${__testHooks.describeObjectId(objectId)}`);
    return getCachedObjectVersion(objectId);
  }

  Handle_GetCachedMethodCallVersion(args, session) {
    const serviceName = args && args.length > 1 ? args[1] : null;
    const method = args && args.length > 2 ? args[2] : null;
    const methodArgs = args && args.length > 3 ? args[3] : [];
    const version = getCachedMethodCallVersion({
      serviceName,
      method,
      args: normalizeArgsArray(methodArgs),
      session,
    });

    log.debug(`[ObjCache] GetCachedMethodCallVersion ${serviceName}::${method} -> ${version}`);
    return version;
  }

  Handle_InvalidateCachedMethodCall(args, session) {
    const serviceName = args && args.length > 0 ? args[0] : null;
    const method = args && args.length > 1 ? args[1] : null;
    const methodArgs = args && args.length > 2 ? args.slice(2) : [];
    const deleted = invalidateCachedMethodCall({
      serviceName,
      method,
      args: methodArgs,
      session,
    });

    log.debug(`[ObjCache] InvalidateCachedMethodCall ${serviceName}::${method} deleted=${deleted}`);
    return null;
  }

  Handle_InvalidateCachedMethodCalls(args, session) {
    const methodCalls = args && args.length > 0 ? args[0] : [];
    const deleted = invalidateCachedMethodCalls(methodCalls, session);
    log.debug(`[ObjCache] InvalidateCachedMethodCalls deleted=${deleted}`);
    return null;
  }

  Handle_InvalidateCachedObjects(args) {
    const objectIds = args && args.length > 0 ? args[0] : [];
    const deleted = invalidateCachedObjects(objectIds);
    log.debug(`[ObjCache] InvalidateCachedObjects deleted=${deleted}`);
    return null;
  }

  Handle_UpdateCache() {
    log.debug("[ObjCache] UpdateCache");
    return null;
  }
}

module.exports = ObjCacheService;
