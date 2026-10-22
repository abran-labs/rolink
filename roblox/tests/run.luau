--!nocheck
-- selene: allow(incorrect_standard_library_use)
local fs = require("@lune/fs")
-- selene: allow(incorrect_standard_library_use)
local luau = require("@lune/luau")
-- selene: allow(incorrect_standard_library_use)
local serde = require("@lune/serde")

local Core = luau.load(fs.readFile("src/Core.luau"))()

local passed = 0
local function check(cond, message)
	if not cond then
		error("FAIL: " .. message, 2)
	end
	passed += 1
end

local function harness()
	local h = { requests = {}, responses = {}, warns = {}, ids = 0, clock = 0 }
	h.link = Core.createLink({
		url = "https://site/api/rolink/v1/sync",
		keyHeader = "key",
		gameInfo = { universeId = 1, placeId = 2, jobId = "job", studio = false, privateServer = false },
		request = function(url, body, headers)
			table.insert(h.requests, { url = url, body = serde.decode("json", body), headers = headers })
			return table.remove(h.responses, 1) or { ok = true, status = 200, body = '{"commands":[]}' }
		end,
		jsonEncode = function(value)
			local ok, out = pcall(serde.encode, "json", value)
			return ok, if ok then out else tostring(out)
		end,
		jsonDecode = function(text)
			return pcall(serde.decode, "json", text)
		end,
		newId = function()
			h.ids += 1
			return "id-" .. h.ids
		end,
		now = function()
			return h.clock
		end,
		warn = function(message)
			table.insert(h.warns, message)
		end,
	})
	return h
end

-- Events go out once and leave the queue only after a 200.
do
	local h = harness()
	h.link.send("pet_hatch", { pet = "Apophis" })
	table.insert(h.responses, { ok = true, status = 500, body = "" })
	check(h.link.syncOnce() == "failed", "500 fails")
	check(h.link.pending() == 1, "event kept after failure")
	check(h.link.nextDelay(30) == 30, "first failure waits one interval")
	check(h.link.syncOnce() == "ok", "retry succeeds")
	check(h.requests[2].body.events[1].id == "id-1", "retry reuses the event id")
	check(h.link.pending() == 0, "event cleared after 200")
	check(h.requests[1].headers["x-rolink-key"] == "key", "key header sent")
end

-- State is sent only when it changes.
do
	local h = harness()
	check(h.link.setState("global_stats", { EggsHatched = 5 }), "first value queued")
	h.link.syncOnce()
	check(h.requests[1].body.state.global_stats.EggsHatched == 5, "state sent")
	check(not h.link.setState("global_stats", { EggsHatched = 5 }), "same value skipped")
	h.link.syncOnce()
	check(next(h.requests[2].body.state) == nil, "unchanged state not resent")
	check(h.link.setState("global_stats", { EggsHatched = 6 }), "changed value queued")
end

-- Commands run once, are acked next sync, and a redelivery is not rerun.
do
	local h = harness()
	local runs = 0
	h.link.onCommand("announce", function(data)
		runs += 1
		check(data.text == "hi", "command data passed")
	end)
	local reply =
		{ ok = true, status = 200, body = '{"commands":[{"id":"c1","type":"announce","data":{"text":"hi"}}]}' }
	table.insert(h.responses, reply)
	table.insert(h.responses, reply)
	h.link.syncOnce()
	h.link.syncOnce()
	check(runs == 1, "redelivered command not rerun")
	check(h.requests[2].body.acks[1] == "c1", "command acked")
end

-- 401 stops the link; invalid names are refused.
do
	local h = harness()
	check(not h.link.send("Bad Name", {}), "invalid event type refused")
	table.insert(h.responses, { ok = true, status = 401, body = "" })
	check(h.link.syncOnce() == "stopped", "401 stops")
	check(not h.link.send("pet_hatch", {}), "stopped link refuses sends")
end

print(string.format("rolink: %d checks passed", passed))
