const path = require("path");

const {
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const DEFAULT_PORTRAIT_DATA = Object.freeze({
  browLeftCurl: 0,
  browLeftTighten: 0,
  browLeftUpDown: 0.5,
  browRightCurl: 0.5,
  browRightTighten: 0,
  browRightUpDown: 0.5,
  eyeClose: 0,
  eyesLookHorizontal: 0.5,
  eyesLookVertical: 0.5,
  frownLeft: 0,
  frownRight: 0,
  headLookTargetX: 0,
  headLookTargetY: 1.5,
  headLookTargetZ: 1,
  headTilt: 0,
  jawSideways: 0.5,
  jawUp: 0.5,
  orientChar: 0,
  puckerLips: 0,
  smileLeft: 0,
  smileRight: 0,
  squintLeft: 0,
  squintRight: 0,
  cameraFieldOfView: 0.3,
  cameraPoiX: 0,
  cameraPoiY: 1.5,
  cameraPoiZ: 0,
  cameraX: 0,
  cameraY: 1.5,
  cameraZ: 1.5,
  backgroundID: 1,
  lightColorID: null,
  lightID: null,
  lightIntensity: null,
  renderStatus: 0,
  paperdollState: 0,
  portraitPoseNumber: 0,
});

const FLAT_PORTRAIT_FIELDS = Object.keys(DEFAULT_PORTRAIT_DATA);

const POSE_DATA_TO_PORTRAIT_FIELD = Object.freeze({
  BrowLeftCurl: "browLeftCurl",
  BrowLeftTighten: "browLeftTighten",
  BrowLeftUpDown: "browLeftUpDown",
  BrowRightCurl: "browRightCurl",
  BrowRightTighten: "browRightTighten",
  BrowRightUpDown: "browRightUpDown",
  EyeClose: "eyeClose",
  EyesLookHorizontal: "eyesLookHorizontal",
  EyesLookVertical: "eyesLookVertical",
  FrownLeft: "frownLeft",
  FrownRight: "frownRight",
  HeadTilt: "headTilt",
  JawSideways: "jawSideways",
  JawUp: "jawUp",
  OrientChar: "orientChar",
  PortraitPoseNumber: "portraitPoseNumber",
  PuckerLips: "puckerLips",
  SmileLeft: "smileLeft",
  SmileRight: "smileRight",
  SquintLeft: "squintLeft",
  SquintRight: "squintRight",
});

function cloneJsonSafe(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonSafe(entry));
  }

  if (typeof value === "object") {
    const cloned = {};
    for (const [key, entryValue] of Object.entries(value)) {
      cloned[key] = cloneJsonSafe(entryValue);
    }
    return cloned;
  }

  return String(value);
}

function normalizeSculptingRowHeader(header = []) {
  const normalized = [...header];
  while (normalized.length < 5) {
    normalized.push(0);
  }

  for (let index = 2; index <= 4; index += 1) {
    if (normalized[index] === null || normalized[index] === undefined) {
      normalized[index] = 0;
    }
  }

  return normalized;
}

function normalizePaperDollPayload(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePaperDollPayload(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "sculptLocationID") &&
    (
      Object.prototype.hasOwnProperty.call(value, "weightUpDown") ||
      Object.prototype.hasOwnProperty.call(value, "weightLeftRight") ||
      Object.prototype.hasOwnProperty.call(value, "weightForwardBack")
    )
  ) {
    return {
      ...value,
      weightUpDown: value.weightUpDown ?? 0,
      weightLeftRight: value.weightLeftRight ?? 0,
      weightForwardBack: value.weightForwardBack ?? 0,
    };
  }

  if (
    value.type === "objectex2" &&
    Array.isArray(value.header) &&
    value.header.length > 0 &&
    Array.isArray(value.header[0]) &&
    value.header[0].length > 0 &&
    value.header[0][0] &&
    typeof value.header[0][0] === "object" &&
    String(value.header[0][0].value || "").endsWith(".SculptingRow")
  ) {
    return {
      ...value,
      header: [
        normalizeSculptingRowHeader(value.header[0]),
        ...value.header.slice(1).map((entry) => normalizePaperDollPayload(entry)),
      ],
      list: normalizePaperDollPayload(value.list || []),
      dict: normalizePaperDollPayload(value.dict || []),
    };
  }

  const normalized = {};
  for (const [key, entryValue] of Object.entries(value)) {
    normalized[key] = normalizePaperDollPayload(entryValue);
  }
  return normalized;
}

function clonePaperDollPayload(value) {
  return normalizePaperDollPayload(cloneJsonSafe(value));
}

function normalizeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInteger(value, fallback = 0) {
  return Math.trunc(normalizeNumber(value, fallback));
}

function setNumberField(target, source, field) {
  if (
    !source ||
    typeof source !== "object" ||
    !Object.prototype.hasOwnProperty.call(source, field)
  ) {
    return;
  }

  const fallback = DEFAULT_PORTRAIT_DATA[field];
  if (
    fallback === null &&
    (source[field] === null || source[field] === undefined)
  ) {
    target[field] = null;
    return;
  }

  target[field] = normalizeNumber(source[field], fallback === null ? 0 : fallback);
}

function setIntegerField(target, source, field) {
  if (
    !source ||
    typeof source !== "object" ||
    !Object.prototype.hasOwnProperty.call(source, field)
  ) {
    return;
  }

  target[field] = normalizeInteger(source[field], DEFAULT_PORTRAIT_DATA[field]);
}

function normalizeVector(value, fallback) {
  if (Array.isArray(value)) {
    return [
      normalizeNumber(value[0], fallback[0]),
      normalizeNumber(value[1], fallback[1]),
      normalizeNumber(value[2], fallback[2]),
    ];
  }

  if (value && typeof value === "object") {
    return [
      normalizeNumber(value.x ?? value.X ?? value[0], fallback[0]),
      normalizeNumber(value.y ?? value.Y ?? value[1], fallback[1]),
      normalizeNumber(value.z ?? value.Z ?? value[2], fallback[2]),
    ];
  }

  return [...fallback];
}

function setVectorFields(target, value, fields, fallback) {
  const normalized = normalizeVector(value, fallback);
  for (let index = 0; index < fields.length; index += 1) {
    target[fields[index]] = normalized[index];
  }
}

function normalizePortraitDataForClient(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const source = unwrapMarshalValue(clonePaperDollPayload(value));
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const portraitData = { ...DEFAULT_PORTRAIT_DATA };

  for (const field of FLAT_PORTRAIT_FIELDS) {
    if (
      field === "backgroundID" ||
      field === "portraitPoseNumber" ||
      field === "renderStatus" ||
      field === "paperdollState"
    ) {
      setIntegerField(portraitData, source, field);
    } else {
      setNumberField(portraitData, source, field);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "cameraPosition")) {
    setVectorFields(
      portraitData,
      source.cameraPosition,
      ["cameraX", "cameraY", "cameraZ"],
      [
        DEFAULT_PORTRAIT_DATA.cameraX,
        DEFAULT_PORTRAIT_DATA.cameraY,
        DEFAULT_PORTRAIT_DATA.cameraZ,
      ],
    );
  }

  if (Object.prototype.hasOwnProperty.call(source, "cameraPoi")) {
    setVectorFields(
      portraitData,
      source.cameraPoi,
      ["cameraPoiX", "cameraPoiY", "cameraPoiZ"],
      [
        DEFAULT_PORTRAIT_DATA.cameraPoiX,
        DEFAULT_PORTRAIT_DATA.cameraPoiY,
        DEFAULT_PORTRAIT_DATA.cameraPoiZ,
      ],
    );
  }

  const poseData =
    source.poseData &&
    typeof source.poseData === "object" &&
    !Array.isArray(source.poseData)
      ? source.poseData
      : null;
  if (poseData) {
    for (const [poseKey, portraitField] of Object.entries(
      POSE_DATA_TO_PORTRAIT_FIELD,
    )) {
      if (!Object.prototype.hasOwnProperty.call(poseData, poseKey)) {
        continue;
      }

      if (portraitField === "portraitPoseNumber") {
        portraitData[portraitField] = normalizeInteger(
          poseData[poseKey],
          DEFAULT_PORTRAIT_DATA[portraitField],
        );
      } else {
        portraitData[portraitField] = normalizeNumber(
          poseData[poseKey],
          DEFAULT_PORTRAIT_DATA[portraitField],
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(poseData, "HeadLookTarget")) {
      setVectorFields(
        portraitData,
        poseData.HeadLookTarget,
        ["headLookTargetX", "headLookTargetY", "headLookTargetZ"],
        [
          DEFAULT_PORTRAIT_DATA.headLookTargetX,
          DEFAULT_PORTRAIT_DATA.headLookTargetY,
          DEFAULT_PORTRAIT_DATA.headLookTargetZ,
        ],
      );
    }
  }

  return portraitData;
}

function getStoredAppearanceInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const appearanceInfo =
    record.appearanceInfo ??
    record.charInfo ??
    record.paperDollData ??
    null;

  return clonePaperDollPayload(appearanceInfo);
}

function getStoredPortraitInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const portraitInfo =
    record.portraitInfo ??
    record.paperDollPortraitInfo ??
    null;

  return clonePaperDollPayload(portraitInfo);
}

function getStoredPortraitDataForClient(record = {}) {
  return normalizePortraitDataForClient(getStoredPortraitInfo(record));
}

function hasStoredAppearanceInfo(record = {}) {
  if (!record || typeof record !== "object") {
    return false;
  }

  return (
    record.appearanceInfo !== undefined &&
    record.appearanceInfo !== null
  ) || (
    record.charInfo !== undefined &&
    record.charInfo !== null
  ) || (
    record.paperDollData !== undefined &&
    record.paperDollData !== null
  );
}

function resolvePaperDollState(record = {}, fallback = 0) {
  const numericState = Number(record && record.paperDollState);
  if (Number.isInteger(numericState) && numericState >= 0 && numericState <= 4) {
    return numericState;
  }

  return hasStoredAppearanceInfo(record) ? 0 : fallback;
}

module.exports = {
  clonePaperDollPayload,
  getStoredAppearanceInfo,
  getStoredPortraitDataForClient,
  getStoredPortraitInfo,
  hasStoredAppearanceInfo,
  normalizePortraitDataForClient,
  normalizePaperDollPayload,
  resolvePaperDollState,
};
