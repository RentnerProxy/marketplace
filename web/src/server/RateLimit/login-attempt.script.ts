export const LOGIN_ATTEMPT_SCRIPT = `

local function invalid()
    return server.error_reply('Invalid login attempt state')
end
local function integer(value, minimum, maximum)
    if type(value) ~= 'string' or #value == 0 or #value > 16
        or string.find(value, '[^0-9]')
        or (#value > 1 and string.sub(value, 1, 1) == '0') then return nil end
    local number = tonumber(value)
    if not number or number < minimum or number > maximum
        or number ~= math.floor(number) then return nil end
    return number
end
local function token(value)
    return type(value) == 'string' and #value == 43
        and not string.find(value, '[^A-Za-z0-9_-]')
        and string.find('AEIMQUYcgkosw048', string.sub(value, -1), 1, true) ~= nil
end
local function reply(status, retryMs, created)
    return { status, '', '', 0, retryMs or 0, created or 0 }
end
if #KEYS ~= 4 or #ARGV ~= 13 then return invalid() end
local operation, attemptId, expectedGeneration, outcome, nextGeneration =
    ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5]
local maximumInteger = 9007199254740991
local leaseMs = integer(ARGV[6], 1, maximumInteger)
local maximumFailures = integer(ARGV[7], 1, 3)
local durations = {
    integer(ARGV[8], 1, maximumInteger),
    integer(ARGV[9], 1, maximumInteger),
    integer(ARGV[10], 1, maximumInteger)
}
local historyTtlSeconds = integer(ARGV[11], 1, maximumInteger)
local retentionMs = integer(ARGV[12], 1, maximumInteger)
local expectedExpiry = integer(ARGV[13], 0, maximumInteger)
if not leaseMs or not maximumFailures or #durations ~= 3
    or not durations[1] or not durations[2] or not durations[3]
    or not historyTtlSeconds or not retentionMs or not expectedExpiry
    or durations[1] > durations[2] or durations[2] > durations[3]
    or durations[3] > historyTtlSeconds
    or retentionMs ~= historyTtlSeconds * 1000 + leaseMs
    or not token(nextGeneration) then return invalid() end
if operation == 'reserve' then
    if not token(attemptId) or expectedGeneration ~= '' or outcome ~= ''
        or expectedExpiry ~= 0 then return invalid() end
elseif operation == 'finish' then
    if not token(attemptId) or not token(expectedGeneration) or expectedExpiry == 0
        or (outcome ~= 'success' and outcome ~= 'failure' and outcome ~= 'neutral')
        then return invalid() end
elseif operation == 'recovery-failure' then
    if attemptId ~= '' or expectedGeneration ~= '' or outcome ~= ''
        or expectedExpiry ~= 0 then return invalid() end
else
    return invalid()
end

local expectedTypes = { 'hash', 'string', 'string', 'zset' }
local types = {}
local ttls = {}
for index = 1, 4 do
    types[index] = server.call('TYPE', KEYS[index]).ok
    if types[index] ~= 'none' and types[index] ~= expectedTypes[index]
        then return invalid() end
    ttls[index] = server.call('PTTL', KEYS[index])
    if types[index] == 'none' then
        if ttls[index] ~= -2 then return invalid() end
    elseif index ~= 2 then
        local maximumTtl = index == 1 and historyTtlSeconds * 1000 or retentionMs
        if ttls[index] < 0 or ttls[index] > maximumTtl then return invalid() end
    end
end
local failures, stage = 0, 0
if types[1] == 'hash' then
    if server.call('HLEN', KEYS[1]) > 2
        or server.call('HSTRLEN', KEYS[1], 'failures') > 16
        or server.call('HSTRLEN', KEYS[1], 'stage') > 16 then return invalid() end
    local values = server.call('HMGET', KEYS[1], 'failures', 'stage')
    failures = integer(values[1], 0, maximumFailures - 1)
    if values[2] then stage = integer(values[2], 0, 3) end
    if failures == nil or stage == nil
        or server.call('HLEN', KEYS[1]) ~= (values[2] and 2 or 1)
        then return invalid() end
end
local locked = types[2] == 'string'
local lockMs = 0
if locked then
    if server.call('STRLEN', KEYS[2]) ~= 1 or server.call('GET', KEYS[2]) ~= '1'
        or ttls[2] < -1 or ttls[2] > durations[3] * 1000 then return invalid() end
    lockMs = ttls[2] == -1 and 1000 or math.max(1, ttls[2])
end
local generation = nil
if types[3] == 'string' then
    if server.call('STRLEN', KEYS[3]) ~= 43 then return invalid() end
    generation = server.call('GET', KEYS[3])
    if not token(generation) then return invalid() end
end
if types[4] == 'zset' and not generation then return invalid() end
local time = server.call('TIME')
local seconds = integer(time[1], 0, maximumInteger)
local microseconds = integer(time[2], 0, 999999)
if seconds == nil or microseconds == nil then return invalid() end
local nowMs = seconds * 1000 + math.floor(microseconds / 1000)
if nowMs > maximumInteger - retentionMs then return invalid() end


local entries = {}
local identities = {}
if types[4] == 'zset' then
    if server.call('ZCARD', KEYS[4]) > maximumFailures then return invalid() end
    local members = server.call('ZRANGE', KEYS[4], 0, maximumFailures - 1, 'WITHSCORES')
    for index = 1, #members, 2 do
        local member, score = members[index], members[index + 1]
        if type(member) ~= 'string' or #member ~= 87
            or string.sub(member, 44, 44) ~= ':' then return invalid() end
        local memberGeneration = string.sub(member, 1, 43)
        local memberId = string.sub(member, 45)
        local expiry = integer(score, 1, maximumInteger)
        if not token(memberGeneration) or not token(memberId) or not expiry
            or expiry > nowMs + leaseMs or identities[memberId]
            or ttls[3] < expiry - nowMs or ttls[4] < expiry - nowMs
            then return invalid() end
        identities[memberId] = true
        entries[#entries + 1] = {
            member = member, generation = memberGeneration, id = memberId, expiry = expiry
        }
    end
end



local candidateIsFresh = generation ~= nextGeneration
local expiredCurrentCount = 0
for _, entry in ipairs(entries) do
    if entry.generation == nextGeneration then candidateIsFresh = false end
    if entry.generation == generation and entry.expiry <= nowMs then
        expiredCurrentCount = expiredCurrentCount + 1
    end
end
local function canRecordFailures(additional)
    return candidateIsFresh
        or failures + expiredCurrentCount + additional < maximumFailures
end

local lockCreated = 0
local function rotateGeneration()
    generation = nextGeneration
    server.call('SET', KEYS[3], generation, 'PX', retentionMs)
end
local function recordFailure()
    if locked then return end
    failures = failures + 1
    if failures >= maximumFailures then
        failures = 0
        stage = math.min(stage + 1, 3)
        lockMs = durations[stage] * 1000
        server.call('SET', KEYS[2], '1', 'PX', lockMs)
        locked = true
        lockCreated = 1
        rotateGeneration()
    end
    server.call('HSET', KEYS[1], 'failures', failures, 'stage', stage)
    server.call('EXPIRE', KEYS[1], historyTtlSeconds)
end

local function settleExpired()
    local liveCount, earliestExpiry, expiredRetry = #entries, nil, false
    for _, entry in ipairs(entries) do
        if entry.expiry <= nowMs then
            if entry.generation == generation then recordFailure() end
            server.call('ZREM', KEYS[4], entry.member)
            liveCount = liveCount - 1
            if entry.id == attemptId then expiredRetry = true end
        elseif not earliestExpiry or entry.expiry < earliestExpiry then
            earliestExpiry = entry.expiry
        end
    end
    return liveCount, earliestExpiry, expiredRetry
end

if operation == 'finish' then
    local own = nil
    for _, entry in ipairs(entries) do
        if entry.id == attemptId and entry.generation == expectedGeneration
            and entry.expiry == expectedExpiry then own = entry end
    end
    if not own then return reply('stale', lockMs) end
    if locked or own.generation ~= generation then
        server.call('ZREM', KEYS[4], own.member)
        return reply('stale', lockMs)
    end
    local ownIsLive = own.expiry > nowMs
    local additionalFailure = ownIsLive and outcome == 'failure' and 1 or 0
    if not canRecordFailures(additionalFailure)
        or (ownIsLive and outcome == 'success' and not candidateIsFresh)
        then return invalid() end
    settleExpired()
    if own.expiry <= nowMs or locked or own.generation ~= generation then
        server.call('ZREM', KEYS[4], own.member)
        return reply('stale', lockMs, lockCreated)
    end
    if outcome == 'success' then
        rotateGeneration()
        server.call('DEL', KEYS[1], KEYS[2])
    elseif outcome == 'failure' then
        recordFailure()
    end
    server.call('ZREM', KEYS[4], own.member)
    return reply('applied', lockMs, lockCreated)
end
if operation == 'recovery-failure' then
    if not locked then
        if not canRecordFailures(1) then return invalid() end
        settleExpired()
        recordFailure()
    end
    return reply('recorded', lockMs, lockCreated)
end
if locked then return reply('locked', lockMs) end


for _, entry in ipairs(entries) do
    if entry.id == attemptId and entry.expiry > nowMs then
        return { 'reserved', entry.generation, entry.id, entry.expiry, 0, 0 }
    end
end
if not canRecordFailures(0) then return invalid() end
local liveCount, earliestExpiry, expiredRetry = settleExpired()
if locked then return reply('locked', lockMs, lockCreated) end
if expiredRetry then return reply('busy', 1) end
if failures + liveCount >= maximumFailures then
    return reply('busy', math.max(1, earliestExpiry - nowMs))
end
if not generation then generation = nextGeneration end
local expiresAtMs = nowMs + leaseMs
server.call('SET', KEYS[3], generation, 'PX', retentionMs)
server.call('ZADD', KEYS[4], 'NX', expiresAtMs, generation .. ':' .. attemptId)
server.call('PEXPIRE', KEYS[4], retentionMs)
return { 'reserved', generation, attemptId, expiresAtMs, 0, 0 }
`
