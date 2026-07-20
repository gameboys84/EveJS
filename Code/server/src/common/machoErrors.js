const { MACHONETERR_TYPE } = require("./packetTypes");

const WRONG_MACHO_NODE_CLASS =
  "carbon.common.script.net.machoNetExceptions.WrongMachoNode";

class MachoWrappedException extends Error {
  constructor(payload, message = "Wrapped remote exception") {
    super(message);
    this.name = "MachoWrappedException";
    this.machoErrorResponse = {
      errorCode: MACHONETERR_TYPE.WRAPPEDEXCEPTION,
      payload,
    };
  }
}

function buildWrappedObjectPayload(className = "", args = [], state = null) {
  const header = [
    { type: "token", value: String(className || "") },
    Array.isArray(args) ? args : [args],
  ];

  if (state && typeof state === "object") {
    header.push({
      type: "dict",
      entries: Object.entries(state),
    });
  }

  return {
    type: "objectex1",
    header,
    list: [],
    dict: [],
  };
}

function buildUserErrorPayload(message = "", values = {}) {
  const dictEntries = Object.entries(values);

  return {
    type: "objectex1",
    header: [
      { type: "token", value: "eveexceptions.UserError" },
      [message, { type: "dict", entries: dictEntries }],
      {
        type: "dict",
        entries: [
          ["msg", message],
          ["dict", { type: "dict", entries: dictEntries }],
        ],
      },
    ],
    list: [],
    dict: [],
  };
}

function throwWrappedObject(className = "", args = [], state = null) {
  throw new MachoWrappedException(
    buildWrappedObjectPayload(className, args, state),
  );
}

function buildCacheOkPayload() {
  return buildWrappedObjectPayload(
    "carbon.common.script.net.objectCaching.CacheOK",
    ["CacheOK"],
  );
}

function buildCacheOkMachoError() {
  return {
    errorCode: MACHONETERR_TYPE.WRAPPEDEXCEPTION,
    payload: buildCacheOkPayload(),
    cacheOk: true,
  };
}

function buildWrongMachoNodePayload(payload = 0) {
  return buildWrappedObjectPayload(
    WRONG_MACHO_NODE_CLASS,
    [],
    { payload },
  );
}

function buildWrongMachoNodeMachoError(payload = 0) {
  return {
    errorCode: MACHONETERR_TYPE.WRAPPEDEXCEPTION,
    payload: buildWrongMachoNodePayload(payload),
    wrongMachoNode: true,
  };
}

function throwWrappedUserError(message = "", values = {}) {
  throw new MachoWrappedException(buildUserErrorPayload(message, values));
}

function throwWrongMachoNode(payload = 0) {
  throw new MachoWrappedException(buildWrongMachoNodePayload(payload));
}

function throwWrappedRaffleCreateError(reason = "UnknownError") {
  const normalizedReason = String(reason || "UnknownError");
  throwWrappedObject(
    "raffles.CreateError",
    [normalizedReason],
    { msg: normalizedReason },
  );
}

function throwWrappedRaffleError(className = "raffles.RafflesError", message = null) {
  const normalizedClassName = String(className || "raffles.RafflesError");
  const normalizedMessage = String(
    message || normalizedClassName.split(".").pop() || "UndhandledRaffleError",
  );
  throwWrappedObject(
    normalizedClassName,
    [normalizedMessage],
    { msg: normalizedMessage },
  );
}

function isMachoWrappedException(error) {
  return Boolean(error && error.machoErrorResponse);
}

function isCacheOkMachoError(error) {
  return Boolean(error && error.cacheOk);
}

module.exports = {
  MachoWrappedException,
  WRONG_MACHO_NODE_CLASS,
  buildWrappedObjectPayload,
  buildCacheOkPayload,
  buildCacheOkMachoError,
  buildWrongMachoNodePayload,
  buildWrongMachoNodeMachoError,
  buildUserErrorPayload,
  throwWrappedObject,
  throwWrappedUserError,
  throwWrongMachoNode,
  throwWrappedRaffleCreateError,
  throwWrappedRaffleError,
  isMachoWrappedException,
  isCacheOkMachoError,
};
