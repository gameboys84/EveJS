"use strict";

function normalizeUint(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizeProtoNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value);
}

function normalizeScore(score) {
  if (!score || typeof score !== "object") {
    return null;
  }
  const factionID = normalizeUint(
    score.factionID ?? score.factionId ?? score.faction_id ??
      (score.faction && score.faction.sequential),
    0,
  );
  if (factionID <= 0) {
    return null;
  }
  return {
    faction: { sequential: factionID },
    contribution: normalizeUint(score.contribution, 0),
    floor: normalizeUint(score.floor ?? score.terrain, 0),
  };
}

function getScoreEntriesFromSource(source, solarSystemID) {
  if (!source || typeof source !== "object") {
    return [];
  }

  const rawScores =
    source instanceof Map
      ? source.get(solarSystemID) || source.get(String(solarSystemID))
      : source[solarSystemID] || source[String(solarSystemID)];

  if (!rawScores) {
    return [];
  }

  if (Array.isArray(rawScores)) {
    return rawScores.map(normalizeScore).filter(Boolean);
  }

  if (rawScores instanceof Map) {
    return [...rawScores.entries()]
      .map(([factionID, score]) => normalizeScore({
        factionID,
        ...(score && typeof score === "object" ? score : { contribution: score }),
      }))
      .filter(Boolean);
  }

  if (typeof rawScores === "object") {
    return Object.entries(rawScores)
      .map(([factionID, score]) => normalizeScore({
        factionID,
        ...(score && typeof score === "object" ? score : { contribution: score }),
      }))
      .filter(Boolean);
  }

  return [];
}

function buildSolarSystemScoresPayload(solarSystemID, scores = []) {
  return {
    solar_system: { sequential: normalizeUint(solarSystemID, 0) },
    scores: scores.map(normalizeScore).filter(Boolean),
  };
}

function buildEncodedPayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function createFwAdvantageGatewayService(context = {}) {
  const protoRoot = context.protoRoot;
  const scoreSource = context.fwAdvantageScoresBySolarSystemID || null;
  const getSolarSystemScoresRequest = protoRoot.lookupType(
    "eve_public.faction.activity.GetSolarSystemScoresRequest",
  );
  const getSolarSystemScoresResponse = protoRoot.lookupType(
    "eve_public.faction.activity.GetSolarSystemScoresResponse",
  );

  function getSystemID(requestEnvelope) {
    const request = getSolarSystemScoresRequest.decode(
      requestEnvelope.payload.value || Buffer.alloc(0),
    );
    return normalizeProtoNumber(request?.solar_system?.sequential);
  }

  return {
    name: "fw-advantage",
    handledRequestTypes: [
      "eve_public.faction.activity.GetSolarSystemScoresRequest",
    ],
    handleRequest(requestTypeName, requestEnvelope) {
      if (requestTypeName !== "eve_public.faction.activity.GetSolarSystemScoresRequest") {
        return null;
      }

      const solarSystemID = normalizeUint(getSystemID(requestEnvelope), 0);
      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName: "eve_public.faction.activity.GetSolarSystemScoresResponse",
        responsePayloadBuffer: buildEncodedPayload(
          getSolarSystemScoresResponse,
          buildSolarSystemScoresPayload(
            solarSystemID,
            getScoreEntriesFromSource(scoreSource, solarSystemID),
          ),
        ),
      };
    },
  };
}

module.exports = {
  buildSolarSystemScoresPayload,
  createFwAdvantageGatewayService,
  normalizeScore,
};
