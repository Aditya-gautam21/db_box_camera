import { getSession } from "./cameraSession.js";
import { loadCameras } from "./addCamera.js";
import { groupMap } from "./groupData.js";

const FD_GET = {
  MsgId: null,
  TypeFlags: 1,
  DefaultVal: 0,
  WithInternal: 0,
  SimpleInfo: 0,
  GroupsId: [],
};

function genderValue(gender) {
  const s = String(gender ?? "").toLowerCase();
  if (s === "male" || s === "m") return 1;
  if (s === "female" || s === "f") return 2;
  const n = Number(gender);
  return Number.isFinite(n) ? n : 0;
}

function stripDataUrl(value) {
  const s = String(value || "");
  const m = s.match(/^data:[^;]+;base64,(.+)$/s);
  return m ? m[1] : s;
}

function mapGroup(g) {
  return {
    id: g.Id,
    name: g.Name,
    canDel: g.CanDel,
    enabled: g.Enabled,
    similarity: g.Similarity,
    policy: g.Policy,
    detectType: g.DetectType,
    enableAlarm: g.EnableAlarm,
    enableChnAlarm: g.EnableChnAlarm,
  };
}

function nameKey(name) {
  return String(name || "").trim().toLowerCase();
}

async function fetchRawGroups(session) {
  const res = await session.post("/API/AI/FDGroup/Get", FD_GET);
  return res.data?.Group ?? [];
}

/**
 * Cameras that expose a usable face-group DB (FDGroup/Get returns groups).
 * Unreachable / non-AI / unlicensed cameras are skipped.
 */
export async function faceDbTargets() {
  const cams = await loadCameras();
  const out = [];
  for (const cam of cams) {
    try {
      const session = await getSession(cam.id);
      const groups = await fetchRawGroups(session);
      if (!Array.isArray(groups) || groups.length === 0) continue;
      out.push({ cam, session, groups });
    } catch {
      /* no face DB on this camera */
    }
  }
  return out;
}

async function mapFaceDb(fn) {
  const targets = await faceDbTargets();
  if (!targets.length) throw new Error("no cameras with a face database");
  const results = [];
  for (const target of targets) {
    try {
      const value = await fn(target);
      results.push({ cam: target.cam.id, name: target.cam.name, ok: true, value });
    } catch (err) {
      results.push({
        cam: target.cam.id,
        name: target.cam.name,
        ok: false,
        error: err.message || String(err),
      });
    }
  }
  if (!results.some((r) => r.ok)) {
    throw new Error(results.map((r) => `${r.name}: ${r.error}`).join("; ") || "all cameras failed");
  }
  return { targets, results };
}

function findRawGroup(groups, { id, matchName }) {
  const gid = Number(id);
  const key = nameKey(matchName);
  if (key) {
    const byName = groups.find((g) => nameKey(g.Name) === key);
    if (byName) return byName;
  }
  if (Number.isFinite(gid)) {
    return groups.find((g) => Number(g.Id) === gid) ?? null;
  }
  return null;
}

export async function getGrpId(list) {
  const names = await groupMap(await getSession());
  const want = String(list).toLowerCase();
  for (const [id, name] of names) {
    if (String(name).toLowerCase() === want) return id;
  }
  throw new Error(`unknown group: ${list}`);
}

/** Merged face groups across all face-DB cameras (matched by name). */
export async function listGroups() {
  const targets = await faceDbTargets();
  if (!targets.length) return [];

  const byName = new Map();
  for (const { cam, groups } of targets) {
    for (const g of groups) {
      const key = nameKey(g.Name);
      if (!key) continue;
      const hit = byName.get(key);
      if (!hit) {
        byName.set(key, { ...mapGroup(g), cameras: [cam.name || cam.id] });
      } else {
        hit.cameras.push(cam.name || cam.id);
      }
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const g of targets[0].groups) {
    const key = nameKey(g.Name);
    const row = byName.get(key);
    if (!row || seen.has(key)) continue;
    seen.add(key);
    ordered.push(row);
  }
  for (const [key, row] of byName) {
    if (seen.has(key)) continue;
    ordered.push(row);
  }
  return ordered;
}

export async function modifyGroup(id, fields = {}) {
  const { results } = await mapFaceDb(async ({ session, groups }) => {
    const current = findRawGroup(groups, { id, matchName: fields.matchName });
    if (!current) throw new Error("group not found");
    const group = { ...current, Id: current.Id };
    if (fields.name != null) {
      const trimmed = String(fields.name).trim();
      if (!trimmed) throw new Error("group name required");
      group.Name = trimmed;
    }
    if (fields.similarity != null && fields.similarity !== "") {
      group.Similarity = Number(fields.similarity);
    }
    if (fields.enabled != null && fields.enabled !== "") {
      group.Enabled = Number(fields.enabled) ? 1 : 0;
    }
    if (fields.enableAlarm != null && fields.enableAlarm !== "") {
      group.EnableAlarm = Number(fields.enableAlarm) ? 1 : 0;
    }
    if (fields.policy != null && fields.policy !== "") {
      group.Policy = Number(fields.policy);
    }
    if (fields.detectType != null && fields.detectType !== "") {
      group.DetectType = Number(fields.detectType);
    }
    const mod = await session.post("/API/AI/FDGroup/Modify", { Group: [group] });
    const result = mod.data?.Result;
    if (Array.isArray(result) && result[0] !== 0) {
      throw new Error("group update failed");
    }
    return mapGroup(group);
  });

  const primary = results.find((r) => r.ok)?.value;
  return {
    ...primary,
    id: primary?.id ?? Number(id),
    cameras: results.filter((r) => r.ok).length,
    results,
  };
}

export async function addGroup(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("group name required");
  const key = nameKey(trimmed);

  const { results } = await mapFaceDb(async ({ session, groups }) => {
    const existing = groups.find((g) => nameKey(g.Name) === key);
    if (existing) return { id: existing.Id, name: existing.Name, existed: true };

    const res = await session.post("/API/AI/FDGroup/Add", {
      MsgId: null,
      Group: [
        {
          Name: trimmed,
          Policy: 0,
          DetectType: 0,
          Similarity: 70,
          CanDel: 1,
          Enabled: 1,
          EnableAlarm: 1,
          EnableChnAlarm: [1],
          Id: -1,
        },
      ],
    });
    const g = res.data?.Group?.[0];
    if (g?.Id == null) throw new Error("group add failed");
    return { id: g.Id, name: g.Name, existed: false };
  });

  const primary = results.find((r) => r.ok)?.value;
  return {
    id: primary.id,
    name: primary.name,
    cameras: results.filter((r) => r.ok).length,
    results,
  };
}

export async function removeGroup(id, { name } = {}) {
  const { results } = await mapFaceDb(async ({ session, groups }) => {
    const current = findRawGroup(groups, { id, matchName: name });
    if (!current) throw new Error("group not found");
    if (Number(current.CanDel) === 0) throw new Error("group cannot be deleted");
    const res = await session.post("/API/AI/FDGroup/Remove", {
      MsgId: null,
      Group: [{ Id: Number(current.Id) }],
    });
    if (res.error_code) throw new Error(res.error_code);
    return { id: Number(current.Id), name: current.Name };
  });

  return {
    id: Number(id),
    cameras: results.filter((r) => r.ok).length,
    results,
  };
}

function mapFace(row) {
  return {
    id: row.Id,
    grpId: row.GrpId,
    name: row.Name || "",
    gender: row.Sex ?? 0,
    age: row.Age && Number(row.Age) !== 0 ? row.Age : "",
    country: row.Country || "",
    nation: row.Nation || "",
    nativePlace: row.NativePlace || "",
    idCode: row.IdCode || "",
    job: row.Job || "",
    phone: row.Phone || "",
    email: row.Email || "",
    domicile: row.Domicile || "",
    remark: row.Remark || "",
    url: row.Id != null ? `/api/groups/${row.GrpId}/faces/${row.Id}/image` : "",
  };
}

const faceJpegCache = new Map();

function cacheFaceJpeg(id, b64) {
  if (!id || !b64) return;
  faceJpegCache.set(Number(id), Buffer.from(b64, "base64"));
}

export async function listGroupFaces(grpId) {
  const session = await getSession();
  const search = await session.post("/API/AI/AddedFaces/Search", {
    MsgId: null,
    FaceInfo: [{ GrpId: Number(grpId) }],
  });
  const total = search.data?.Count ?? 0;
  if (!total) return [];
  const page = await session.post("/API/AI/AddedFaces/GetByIndex", {
    MsgId: null,
    StartIndex: 0,
    Count: total,
    SimpleInfo: 0,
    WithImage: 0,
    WithFeature: 0,
  });
  return (page.data?.FaceInfo ?? []).map(mapFace);
}

export async function getFace(id) {
  const res = await (await getSession()).post("/API/AI/AddedFaces/GetById", {
    MsgId: null,
    FacesId: [Number(id)],
    SimpleInfo: 0,
    WithImage: 1,
    WithFeature: 0,
  });
  const row = res.data?.FaceInfo?.[0];
  if (!row) throw new Error("face not found");
  cacheFaceJpeg(row.Id, row.Image1);
  return mapFace(row);
}

export async function getFaceJpeg(id) {
  const faceId = Number(id);
  const hit = faceJpegCache.get(faceId);
  if (hit) return hit;
  const res = await (await getSession()).post("/API/AI/AddedFaces/GetById", {
    MsgId: null,
    FacesId: [faceId],
    SimpleInfo: 0,
    WithImage: 1,
    WithFeature: 0,
  });
  const img = res.data?.FaceInfo?.[0]?.Image1;
  if (!img) throw new Error("no face image");
  cacheFaceJpeg(faceId, img);
  return faceJpegCache.get(faceId);
}

export async function removeFace({ id, grpId }) {
  const faceId = Number(id);
  const gid = Number(grpId);
  if (!Number.isFinite(faceId) || !Number.isFinite(gid)) {
    throw new Error("face id and group id required");
  }
  const res = await (await getSession()).post("/API/AI/Faces/Remove", {
    MsgId: null,
    Count: 1,
    FaceInfo: [{ Id: faceId, GrpId: gid }],
  });
  if (res.error_code) throw new Error(res.error_code);
  faceJpegCache.delete(faceId);
  return { id: faceId, grpId: gid };
}

export async function modifyFace(fields) {
  const faceId = Number(fields.id);
  const gid = Number(fields.grpId);
  if (!Number.isFinite(faceId) || !Number.isFinite(gid)) {
    throw new Error("face id and group id required");
  }
  const currentRes = await (await getSession()).post("/API/AI/AddedFaces/GetById", {
    MsgId: null,
    FacesId: [faceId],
    SimpleInfo: 0,
    WithImage: 0,
    WithFeature: 0,
  });
  const current = currentRes.data?.FaceInfo?.[0];
  if (!current) throw new Error("face not found");
  const face = {
    ...current,
    Id: faceId,
    GrpId: gid,
    Name: fields.name ?? current.Name ?? "",
    Age: fields.age === "" || fields.age == null ? current.Age ?? 0 : Number(fields.age),
    Sex: fields.gender == null || fields.gender === "" ? current.Sex ?? 0 : genderValue(fields.gender),
    Country: fields.country ?? current.Country ?? "",
    Nation: fields.nation ?? current.Nation ?? "",
    NativePlace: fields.nativePlace ?? current.NativePlace ?? "",
    IdCode: fields.idCode ?? current.IdCode ?? "",
    Job: fields.job ?? current.Job ?? "",
    Phone: fields.phone ?? current.Phone ?? "",
    Email: fields.email ?? current.Email ?? "",
    Domicile: fields.domicile ?? current.Domicile ?? "",
    Remark: fields.remark ?? current.Remark ?? "",
  };
  delete face.Image1;
  delete face.Feature;
  delete face.FtVersion;
  const res = await (await getSession()).post("/API/AI/Faces/Modify", {
    MsgId: null,
    Count: 1,
    FaceInfo: [face],
  });
  const ok = res.data?.Result?.[0] === 0 || res.data?.Id?.[0] === faceId;
  if (!ok && res.error_code) throw new Error(res.error_code);
  if (res.data?.Id?.[0] == null && res.data?.Result?.[0] !== 0) {
    throw new Error("face update failed");
  }
  return mapFace(face);
}

async function snapBlobs(uuid, cam) {
  const res = await (await getSession(cam)).post("/API/AI/SnapedFaces/GetById", {
    MsgId: "",
    Engine: 1,
    UUIds: [uuid],
    WithFaceImage: 1,
    WithBodyImage: 0,
    WithBackgroud: 0,
    WithFeature: 1,
  });
  const face = res.data?.SnapedFaceInfo?.[0];
  if (!face?.FaceImage) throw new Error("no image for that snapshot");
  return face;
}

async function enroll({
  grpId,
  name,
  age,
  gender,
  country,
  nation,
  nativePlace,
  idCode,
  job,
  phone,
  email,
  domicile,
  remark,
  image,
  feature,
  ftVersion,
}) {
  const gid = Number(grpId);
  if (!Number.isFinite(gid)) throw new Error("group id required");
  const image1 = stripDataUrl(image);
  if (!image1) throw new Error("image required");
  const res = await (await getSession()).post("/API/AI/Faces/Add", {
    FaceInfo: [
      {
        Id: -1,
        GrpId: gid,
        Name: name || "",
        Age: age === "" || age == null ? 0 : Number(age),
        Sex: genderValue(gender),
        IdCode: idCode || "",
        Email: email || "",
        Domicile: domicile || "",
        Country: country || "",
        Nation: nation || "",
        NativePlace: nativePlace || "",
        Job: job || "",
        Phone: phone || "",
        Remark: remark || "",
        EnableChnAlarm: [],
        Image1: image1,
        Feature: feature || "",
        FtVersion: ftVersion || 10485764,
      },
    ],
  });
  const id = res.data?.Id?.[0];
  if (id == null) throw new Error("face add failed");
  cacheFaceJpeg(id, image1);
  return { id, grpId: gid, name: name || "" };
}

export async function addImportedFaces(fields) {
  return enroll(fields);
}

export async function addCapturedFaces(fields) {
  if (fields.uuid && !fields.image) {
    const snap = await snapBlobs(fields.uuid, fields.cam);
    return enroll({
      ...fields,
      image: snap.FaceImage,
      feature: snap.Feature,
      ftVersion: snap.FtVersion,
    });
  }
  return enroll(fields);
}
