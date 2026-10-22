--!strict
-- Rolink Core: pure sync logic with no Roblox globals. HTTP, JSON, clock, and
-- warn arrive through Deps, so this runs unchanged under Lune tests.

local Core = {}

Core.PROTOCOL_VERSION = 1
Core.SYNC_PATH = "/v1/sync"
Core.KEY_HEADER = "x-rolink-key"
Core.WARN_PREFIX = "[Rolink] "
Core.MAX_EVENTS = 200
Core.EVENTS_PER_SYNC = 50
Core.DEFAULT_INTERVAL = 30
Core.MIN_INTERVAL = 5
Core.MAX_BACKOFF = 300
Core.SEEN_COMMAND_LIMIT = 500

export type GameInfo = {
	universeId: number,
	placeId: number,
	jobId: string,
	studio: boolean,
	privateServer: boolean,
}

export type HttpResponse = {
	ok: boolean,
	status: number?,
	body: string?,
	err: string?,
}

export type Deps = {
	url: string,
	keyHeader: any,
	gameInfo: GameInfo,
	request: (url: string, body: string, headers: { [string]: any }) -> HttpResponse,
	jsonEncode: (value: any) -> (boolean, string),
	jsonDecode: (text: string) -> (boolean, any),
	newId: () -> string,
	now: () -> number,
	warn: (message: string) -> (),
}

export type Command = { id: string, type: string, data: any }
export type CommandHandler = (data: any, command: Command) -> ()

type Event = { id: string, type: string, data: any, at: number }

function Core.validName(name: any): boolean
	return type(name) == "string" and #name >= 2 and #name <= 41 and string.match(name, "^[a-z][a-z0-9_]+$") ~= nil
end

function Core.createLink(deps: Deps)
	local events: { Event } = {}
	-- Latest unsent value per state key; cleared only after a 200.
	local dirtyState: { [string]: any } = {}
	local lastSent: { [string]: string } = {}
	local handlers: { [string]: { CommandHandler } } = {}
	local acks: { string } = {}
	local seenCommands: { [string]: boolean } = {}
	local seenOrder: { string } = {}
	local stopped = false
	local failures = 0
	local warnedAt: { [string]: number } = {}

	local function warnThrottled(key: string, message: string)
		local now = deps.now()
		local last = warnedAt[key]
		if last == nil or now - last >= 60 then
			warnedAt[key] = now
			deps.warn(Core.WARN_PREFIX .. message)
		end
	end

	local link = {}

	function link.send(eventType: string, data: any): boolean
		if stopped then
			return false
		end
		if not Core.validName(eventType) then
			warnThrottled("name:" .. tostring(eventType), "dropping event with invalid type " .. tostring(eventType))
			return false
		end
		if #events >= Core.MAX_EVENTS then
			warnThrottled("full", "event queue full; dropping " .. eventType)
			return false
		end
		table.insert(events, { id = deps.newId(), type = eventType, data = data, at = os.time() })
		return true
	end

	-- Sends only when the encoded value differs from the last one sent.
	function link.setState(key: string, value: any): boolean
		if stopped then
			return false
		end
		if not Core.validName(key) then
			warnThrottled("state:" .. tostring(key), "dropping state with invalid key " .. tostring(key))
			return false
		end
		local ok, encoded = deps.jsonEncode(value)
		if not ok then
			warnThrottled("encode:" .. key, "state " .. key .. " is not JSON-encodable")
			return false
		end
		if lastSent[key] == encoded and dirtyState[key] == nil then
			return false
		end
		dirtyState[key] = { value = value, encoded = encoded }
		return true
	end

	function link.onCommand(commandType: string, handler: CommandHandler): () -> ()
		assert(Core.validName(commandType), "Rolink.onCommand type must be lowercase snake_case")
		local list = handlers[commandType] or {}
		handlers[commandType] = list
		table.insert(list, handler)
		return function()
			local index = table.find(list, handler)
			if index then
				table.remove(list, index)
			end
		end
	end

	local function runCommand(command: Command)
		if seenCommands[command.id] then
			table.insert(acks, command.id)
			return
		end
		seenCommands[command.id] = true
		table.insert(seenOrder, command.id)
		if #seenOrder > Core.SEEN_COMMAND_LIMIT then
			seenCommands[table.remove(seenOrder, 1) :: string] = nil
		end
		for _, handler in ipairs(handlers[command.type] or {}) do
			local ok, err = pcall(handler, command.data, command)
			if not ok then
				warnThrottled("cmd:" .. command.type, "command " .. command.type .. " failed: " .. tostring(err))
			end
		end
		table.insert(acks, command.id)
	end

	-- One round trip. Returns "ok" | "failed" | "stopped".
	function link.syncOnce(): string
		if stopped then
			return "stopped"
		end
		local batch = {}
		for index = 1, math.min(#events, Core.EVENTS_PER_SYNC) do
			batch[index] = events[index]
		end
		local stateBatch: { [string]: any } = {}
		local stateSent: { [string]: any } = {}
		for key, entry in pairs(dirtyState) do
			stateBatch[key] = entry.value
			stateSent[key] = entry
		end
		local ackBatch = table.clone(acks)

		local ok, body = deps.jsonEncode({
			v = Core.PROTOCOL_VERSION,
			game = deps.gameInfo,
			events = batch,
			state = stateBatch,
			acks = ackBatch,
		})
		if not ok then
			warnThrottled("encode", "sync body is not JSON-encodable; dropping queued events")
			table.clear(events)
			table.clear(dirtyState)
			return "failed"
		end
		local response =
			deps.request(deps.url, body, { ["Content-Type"] = "application/json", [Core.KEY_HEADER] = deps.keyHeader })
		if response.ok ~= true then
			failures += 1
			warnThrottled("transport", "sync failed: " .. tostring(response.err))
			return "failed"
		end
		local status = response.status or 0
		if status == 401 then
			stopped = true
			deps.warn(Core.WARN_PREFIX .. "key rejected by the site; Rolink stopped for this server")
			return "stopped"
		end
		if status ~= 200 then
			failures += 1
			warnThrottled("status", "sync returned " .. tostring(status) .. ": " .. tostring(response.body))
			if status == 400 or status == 403 or status == 413 then
				-- The batch itself is refused; drop it so it cannot block the queue.
				for _ = 1, #batch do
					table.remove(events, 1)
				end
			end
			return "failed"
		end

		failures = 0
		for _ = 1, #batch do
			table.remove(events, 1)
		end
		for key, entry in pairs(stateSent) do
			lastSent[key] = entry.encoded
			if dirtyState[key] == entry then
				dirtyState[key] = nil
			end
		end
		for _ = 1, #ackBatch do
			table.remove(acks, 1)
		end
		local decoded, payload = deps.jsonDecode(response.body or "")
		if decoded and type(payload) == "table" and type(payload.commands) == "table" then
			for _, command in ipairs(payload.commands) do
				if type(command) == "table" and type(command.id) == "string" and Core.validName(command.type) then
					runCommand(command :: Command)
				end
			end
		end
		return "ok"
	end

	-- Seconds until the next sync: interval normally, exponential backoff on failure,
	-- immediately again when events are still queued.
	function link.nextDelay(interval: number): number
		if failures > 0 then
			return math.min(interval * 2 ^ (failures - 1), Core.MAX_BACKOFF)
		end
		if #events > 0 then
			return Core.MIN_INTERVAL
		end
		return interval
	end

	function link.pending(): number
		return #events
	end

	function link.isStopped(): boolean
		return stopped
	end

	return link
end

return Core
