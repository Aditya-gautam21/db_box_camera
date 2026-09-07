import { getSession } from "./cameraSession.js";

const DEFAULT_EVENT_CHANNEL = "CH1";

function fail(status, message) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function assertOk(res, fallback) {
    if (res?.result === "failed" || res?.error_code) {
        fail(500, res.reason || res.error_code || fallback);
    }
    return res;
}

function mergeOsdBlock(block, patch) {
    const next = { ...block, ...patch };
    for (const key of ["name", "datetime", "alarm"]) {
        if (!patch?.[key] || typeof patch[key] !== "object") continue;
        next[key] = { ...block[key], ...patch[key] };
        if (patch[key].pos) next[key].pos = { ...block[key]?.pos, ...patch[key].pos };
        if (patch[key].time) next[key].time = { ...block[key]?.time, ...patch[key].time };
    }
    return next;
}

function osdCanvas(rangeItems) {
    const pos = rangeItems?.name?.items?.pos?.items || rangeItems?.datetime?.items?.pos?.items;
    return {
        width: Number(pos?.x?.max) || 704,
        height: Number(pos?.y?.max) || 576,
    };
}

function coverCanvas(rangeItems) {
    const rect = rangeItems?.zone_info?.items?.[0]?.rect?.items;
    return {
        width: Number(rect?.left?.max) || 704,
        height: Number(rect?.top?.max) || 576,
    };
}

export async function getOsdSettings(camId, channel = DEFAULT_EVENT_CHANNEL) {
    const ch = channelKey(channel);
    const session = await getSession(camId);
    const [got, range] = await Promise.all([
        session.post("/API/ChannelConfig/OSD/Get", {}),
        session.post("/API/ChannelConfig/OSD/Range", {}),
    ]);
    assertOk(got, "failed to get live OSD settings");
    const block = got.data?.channel_info?.[ch];
    if (!block) fail(404, `no OSD settings for ${ch}`);
    const rangeItems = range?.data?.channel_info?.items?.[ch]?.items || {};
    return { channel: ch, config: block, range: rangeItems, canvas: osdCanvas(rangeItems) };
}

export async function setOsdSettings(camId, fields = {}) {
    const ch = channelKey(fields.channel || DEFAULT_EVENT_CHANNEL);
    const session = await getSession(camId);
    const got = assertOk(
        await session.post("/API/ChannelConfig/OSD/Get", {}),
        "failed to get live OSD settings",
    );
    const block = got.data?.channel_info?.[ch];
    if (!block) fail(404, `no OSD settings for ${ch}`);
    const patch = fields.config && typeof fields.config === "object" ? fields.config : fields;
    got.data.channel_info[ch] = mergeOsdBlock(block, patch);
    assertOk(await session.post("/API/ChannelConfig/OSD/Set", got.data), "failed to set live OSD settings");
    return getOsdSettings(camId, ch);
}

export async function getVideoCover(camId, channel = DEFAULT_EVENT_CHANNEL) {
    const ch = channelKey(channel);
    const session = await getSession(camId);
    const [got, range] = await Promise.all([
        session.post("/API/ChannelConfig/VideoCover/Get", {}),
        session.post("/API/ChannelConfig/VideoCover/Range", {}),
    ]);
    assertOk(got, "failed to get video cover");
    const block = got.data?.channel_info?.[ch];
    if (!block) fail(404, `no video cover for ${ch}`);
    const rangeItems = range?.data?.channel_info?.items?.[ch]?.items || {};
    return {
        channel: ch,
        privacy_zone_enable: Boolean(block.privacy_zone_enable),
        zone_info: block.zone_info || [],
        canvas: coverCanvas(rangeItems),
    };
}

export async function setVideoCover(camId, fields = {}) {
    const ch = channelKey(fields.channel || DEFAULT_EVENT_CHANNEL);
    const session = await getSession(camId);
    const got = assertOk(
        await session.post("/API/ChannelConfig/VideoCover/Get", {}),
        "failed to get video cover",
    );
    const block = got.data?.channel_info?.[ch];
    if (!block) fail(404, `no video cover for ${ch}`);
    if (fields.privacy_zone_enable !== undefined) block.privacy_zone_enable = Boolean(fields.privacy_zone_enable);
    if (Array.isArray(fields.zone_info)) block.zone_info = fields.zone_info;
    assertOk(await session.post("/API/ChannelConfig/VideoCover/Set", got.data), "failed to set video cover");
    return getVideoCover(camId, ch);
}

export async function getDiskSettings(camId) {
    const session = await getSession(camId);
    const [got, range] = await Promise.all([
        session.post("/API/StorageConfig/Disk/Get", {}),
        session.post("/API/StorageConfig/Disk/Range", {}),
    ]);
    assertOk(got, "failed to get disk settings");
    return {
        over_write: got.data?.over_write,
        support_format: Boolean(got.data?.support_format),
        hdd_format_type: got.data?.hdd_format_type,
        disk_info: got.data?.disk_info || [],
        range: range?.data || {},
    };
}

export async function setDiskSettings(camId, fields = {}) {
    const session = await getSession(camId);
    const got = assertOk(
        await session.post("/API/StorageConfig/Disk/Get", {}),
        "failed to get disk settings",
    );
    const payload = {
        over_write: fields.over_write ?? got.data.over_write,
        hdd_format_type: got.data.hdd_format_type,
    };
    assertOk(await session.post("/API/StorageConfig/Disk/Set", payload), "failed to set disk settings");
    return getDiskSettings(camId);
}

async function withBusyRetry(run, fallback) {
    let res;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        res = await run();
        if (res?.error_code !== "data_saving_busy") break;
        await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return assertOk(res, fallback);
}

export async function getNetworkSettings(camId) {
    const session = await getSession(camId);
    const [got, range] = await Promise.all([
        session.post("/API/NetworkConfig/NetBase/Get", {}),
        session.post("/API/NetworkConfig/NetBase/Range", {}),
    ]);
    assertOk(got, "failed to get network settings");
    return {
        wan: got.data?.wan || {},
        range: range?.data?.wan?.items || {},
    };
}

export async function setNetworkSettings(camId, fields = {}) {
    const session = await getSession(camId);
    const got = assertOk(
        await session.post("/API/NetworkConfig/NetBase/Get", {}),
        "failed to get network settings",
    );
    const patch = fields.wan && typeof fields.wan === "object" ? fields.wan : fields;
    got.data.wan = { ...got.data.wan, ...patch };
    await withBusyRetry(
        () => session.post("/API/NetworkConfig/NetBase/Set", got.data),
        "failed to set network settings",
    );
    return getNetworkSettings(camId);
}

export async function testNetworkAddress(camId, ip) {
    const address = String(ip || "").trim();
    if (!address) fail(400, "IP address required");
    const session = await getSession(camId);
    const res = await session.post("/API/NetworkConfig/NetBase/Test", {
        wan: { ip_address: address },
    });
    if (res?.result === "failed" || res?.error_code) {
        fail(400, res.reason || res.error_code || "IP test failed");
    }
    return { ok: true };
}

const EVENT_GET = "/API/Event/ChnSmart/Get";
const EVENT_SET = "/API/Event/ChnSmart/Set";

function channelKey(channel = DEFAULT_EVENT_CHANNEL) {
    const raw = String(channel || DEFAULT_EVENT_CHANNEL).trim();
    if (/^\d+$/.test(raw)) return `CH${raw}`;
    return raw.toUpperCase().startsWith("CH") ? `CH${raw.replace(/^CH/i, "")}` : `CH${raw}`;
}

function channelNumber(channel) {
    return Number(String(channelKey(channel)).replace(/^CH/i, "")) || 1;
}

function normalizeState(value) {
    if (value === true || value === "On" || value === "on" || value === 1 || value === "1") return "On";
    if (value === false || value === "Off" || value === "off" || value === 0 || value === "0") return "Off";
    fail(400, `state must be On or Off, got ${value}`);
}

function channelBlock(data, channel) {
    const key = channelKey(channel);
    const block = data?.channel_info?.[key];
    if (!block) fail(404, `no event settings for ${key}`);
    return { key, block };
}

function abilityInfos(block) {
    return (block.abilities || []).flatMap((group) => group.ability_info || []);
}

function findAbility(block, name) {
    const wanted = String(name).trim();
    return abilityInfos(block).find((info) => info.ability === wanted) ?? null;
}

function summarizeEvents(data, channel) {
    const { key, block } = channelBlock(data, channel);
    const abilities = {};
    for (const info of abilityInfos(block)) {
        abilities[info.ability] = info.state;
    }
    return {
        channel: key,
        abilities,
        groups: (block.abilities || []).map((group) => ({
            title: group.title,
            abilities: (group.ability_info || []).map((info) => ({
                ability: info.ability,
                state: info.state,
                mutual_ability: info.mutual_ability || [],
            })),
        })),
    };
}

function applyAbilityState(data, ability, state, channel) {
    const { block } = channelBlock(data, channel);
    const info = findAbility(block, ability);
    if (!info) fail(400, `unknown event ability: ${ability}`);
    info.state = state;
    return info;
}

export async function getEventSettings(camId, channel = DEFAULT_EVENT_CHANNEL) {
    const session = await getSession(camId);
    const res = await session.post(EVENT_GET, {});
    if (res?.result === "failed" || res?.error_code) {
        fail(500, res.reason || res.error_code || "failed to get event settings");
    }
    return summarizeEvents(res.data, channel);
}

const SETTING_GET = "/API/Event/SettingConfig/Get";
const SETTING_SET = "/API/Event/SettingConfig/Set";
const SETTING_RANGE = "/API/Event/SettingConfig/Range";

function canvasFromRange(rangeItems) {
    const rule = rangeItems?.rule_info?.items?.rule_number1?.items;
    const src = rule?.rule_rect?.items || rule?.rule_line?.items;
    return {
        width: Number(src?.x1?.max) || 704,
        height: Number(src?.y1?.max) || 576,
    };
}

function channelConfig(res, channel) {
    const key = channelKey(channel);
    const block = res?.data?.channel_info?.[key];
    if (!block) fail(404, `no ${key} config`);
    return { key, block };
}

export async function getEventConfig(camId, ability, channel = DEFAULT_EVENT_CHANNEL) {
    const name = String(ability || "").trim();
    if (!name) fail(400, "ability required");
    const ch = channelKey(channel);
    const session = await getSession(camId);
    const [got, range] = await Promise.all([
        session.post(SETTING_GET, { channel: ch, ability: name }),
        session.post(SETTING_RANGE, { channel: ch, ability: name }),
    ]);
    if (got?.result === "failed" || got?.error_code) {
        fail(500, got.reason || got.error_code || "failed to get event config");
    }
    const { key, block } = channelConfig(got, ch);
    const rangeItems = range?.data?.channel_info?.items?.[key]?.items || {};
    return {
        ability: name,
        channel: key,
        config: block,
        range: rangeItems,
        canvas: canvasFromRange(rangeItems),
    };
}

export async function setEventConfig(camId, fields = {}) {
    const name = String(fields.ability || "").trim();
    if (!name) fail(400, "ability required");
    const ch = channelKey(fields.channel || DEFAULT_EVENT_CHANNEL);
    const session = await getSession(camId);
    const got = await session.post(SETTING_GET, { channel: ch, ability: name });
    if (got?.result === "failed" || got?.error_code) {
        fail(500, got.reason || got.error_code || "failed to get event config");
    }
    const { block } = channelConfig(got, ch);
    const patch = fields.config && typeof fields.config === "object" ? fields.config : fields;
    const next = { ...block, ...patch };
    delete next.ability;
    delete next.channel;
    delete next.config;
    const res = await session.post(SETTING_SET, {
        channel: ch,
        ability: name,
        channel_info: { [ch]: next },
    });
    if (res?.result === "failed" || res?.error_code) {
        fail(500, res.reason || res.error_code || "failed to set event config");
    }
    return getEventConfig(camId, name, ch);
}

export async function setEventSettings(camId, fields = {}) {
    const channel = channelKey(fields.channel || DEFAULT_EVENT_CHANNEL);
    const updates = fields.abilities && typeof fields.abilities === "object"
        ? fields.abilities
        : Object.fromEntries(
            Object.entries(fields).filter(([key]) => key !== "channel" && key !== "abilities"),
        );
    const names = Object.keys(updates);
    if (!names.length) fail(400, "at least one event ability is required");

    const session = await getSession(camId);
    let current = await session.post(EVENT_GET, {});
    if (current?.result === "failed" || current?.error_code) {
        fail(500, current.reason || current.error_code || "failed to get event settings");
    }

    for (const name of names) {
        const info = applyAbilityState(current.data, name, normalizeState(updates[name]), channel);
        const res = await session.post(EVENT_SET, {
            channel_info: {
                [channel]: { abilities: [{ ability_info: [info] }] },
            },
        });
        if (res?.result === "failed" || res?.error_code) {
            fail(500, res.reason || res.error_code || "failed to set event settings");
        }
        current = await session.post(EVENT_GET, {});
        if (current?.result === "failed" || current?.error_code) {
            fail(500, current.reason || current.error_code || "failed to get event settings");
        }
    }
    return summarizeEvents(current.data, channel);
}

