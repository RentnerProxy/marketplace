const READ_GRANT_SCRIPT = `
local function isDigest(value)
    return type(value) == 'string' and #value == 64 and not string.find(value, '[^a-f0-9]')
end
local function isAttemptId(value)
    return type(value) == 'string' and #value == 43
        and not string.find(value, '[^A-Za-z0-9_-]')
        and string.find('AEIMQUYcgkosw048', string.sub(value, -1), 1, true) ~= nil
end
local function readGrant(key, maximumAttempts, maximumTtlMs)
    local ttl = server.call('PTTL', key)
    if ttl <= 0 or ttl > maximumTtlMs then return nil end
    local keyType = server.call('TYPE', key)
    if keyType.ok ~= 'string' then return nil end
    local raw = server.call('GET', key)
    if type(raw) ~= 'string' or #raw > 2048 then return nil end
    local decoded, grant = pcall(cjson.decode, raw)
    if not decoded or type(grant) ~= 'table' then return nil end
    local allowed = { purpose = true, userId = true, usernameHash = true, passwordVersion = true, expiresAt = true, attemptIds = true }
    local fields = 0
    for name, _ in pairs(grant) do
        if not allowed[name] then return nil end
        fields = fields + 1
    end
    if fields ~= 6 or grant.purpose ~= 'login-recovery-v1' then return nil end
    if type(grant.userId) ~= 'string' or #grant.userId < 1 or #grant.userId > 100 or string.find(grant.userId, '[^A-Za-z0-9_-]') then return nil end
    if not isDigest(grant.usernameHash) or not isDigest(grant.passwordVersion) then return nil end
    if type(grant.expiresAt) ~= 'number' or grant.expiresAt < 1 or grant.expiresAt > 9007199254740991 or grant.expiresAt % 1 ~= 0 then return nil end
    local clock = server.call('TIME')
    local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
    if grant.expiresAt <= now then return nil end
    if type(grant.attemptIds) ~= 'table' then return nil end

    if not string.find(raw, '"attemptIds"%s*:%s*%[') then return nil end
    local count = 0
    local seen = {}
    for index, attemptId in pairs(grant.attemptIds) do
        if type(index) ~= 'number' or index % 1 ~= 0 or index < 1 or index > #grant.attemptIds then return nil end
        if not isAttemptId(attemptId) or seen[attemptId] then return nil end
        seen[attemptId] = true
        count = count + 1
    end
    if count ~= #grant.attemptIds or count > maximumAttempts then return nil end
    return grant
end
`

export const RESERVE_ATTEMPT_SCRIPT = `

${READ_GRANT_SCRIPT}
local grant = readGrant(KEYS[1], tonumber(ARGV[3]), tonumber(ARGV[4]))
if not grant or grant.usernameHash ~= ARGV[1] or not isAttemptId(ARGV[2]) then return 0 end
if #grant.attemptIds >= tonumber(ARGV[3]) then return 0 end
for _, attemptId in ipairs(grant.attemptIds) do
    if attemptId == ARGV[2] then return 0 end
end
table.insert(grant.attemptIds, ARGV[2])
local updated = server.call('SET', KEYS[1], cjson.encode(grant), 'XX', 'KEEPTTL')
if not updated then return 0 end
return 1
`

export const CLAIM_ATTEMPT_SCRIPT = `

${READ_GRANT_SCRIPT}
local grant = readGrant(KEYS[1], tonumber(ARGV[5]), tonumber(ARGV[6]))
if not grant or not isAttemptId(ARGV[1]) then return 0 end
if grant.userId ~= ARGV[2] or grant.usernameHash ~= ARGV[3] or grant.passwordVersion ~= ARGV[4] then return 0 end
for _, attemptId in ipairs(grant.attemptIds) do
    if attemptId == ARGV[1] then
        return server.call('DEL', KEYS[1])
    end
end
return 0
`
