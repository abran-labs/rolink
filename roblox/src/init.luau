--!strict
-- Rolink: two-way link between a Roblox game and a website.
-- Server-only. Require from a server Script: local Rolink = require(ServerPackages.Rolink)

local RunService = game:GetService("RunService")
if RunService:IsClient() then
	error("Rolink is server-only; require it from a server Script, not a LocalScript.")
end

local HttpService = game:GetService("HttpService")

local Core = require(script.Core)

export type Config = {
	-- Site base, e.g. "https://example.com/api/rolink". Must be https.
	url: string,
	-- HttpService Secret (recommended) or a plain string for testing.
	key: any,
	-- Seconds between syncs. Default 30, minimum 5.
	interval: number?,
}

export type Link = {
	send: (eventType: string, data: any) -> boolean,
	setState: (key: string, value: any) -> boolean,
	onCommand: (commandType: string, handler: Core.CommandHandler) -> () -> (),
	flush: () -> (),
	isStopped: () -> boolean,
}

local Rolink = {}

function Rolink.connect(config: Config): Link
	assert(type(config) == "table", "Rolink.connect requires a config table")
	local url = config.url
	assert(type(url) == "string" and string.sub(url, 1, 8) == "https://", "Rolink.connect url must be https")
	local key = config.key
	assert(
		typeof(key) == "Secret" or (type(key) == "string" and key ~= ""),
		'Rolink.connect key must be an HttpService Secret (HttpService:GetSecret("...")) or a non-empty string'
	)
	local interval = math.max(Core.MIN_INTERVAL, config.interval or Core.DEFAULT_INTERVAL)

	local link = Core.createLink({
		url = string.gsub(url, "/+$", "") .. Core.SYNC_PATH,
		keyHeader = key,
		gameInfo = {
			universeId = game.GameId,
			placeId = game.PlaceId,
			jobId = if game.JobId ~= "" then game.JobId else "studio",
			studio = RunService:IsStudio(),
			privateServer = game.PrivateServerId ~= "",
		},
		request = function(target, body, headers)
			local ok, response = pcall(HttpService.RequestAsync, HttpService, {
				Url = target,
				Method = "POST",
				Headers = headers,
				Body = body,
			})
			if not ok then
				return { ok = false, err = tostring(response) }
			end
			return { ok = true, status = response.StatusCode, body = response.Body }
		end,
		jsonEncode = function(value)
			local ok, out = pcall(HttpService.JSONEncode, HttpService, value)
			return ok, if ok then out else tostring(out)
		end,
		jsonDecode = function(text)
			return pcall(HttpService.JSONDecode, HttpService, text)
		end,
		newId = function()
			return HttpService:GenerateGUID(false)
		end,
		now = os.clock,
		warn = function(message)
			warn(message)
		end,
	})

	if game.GameId == 0 then
		warn(Core.WARN_PREFIX .. "unpublished place; syncing anyway, but the site may reject universe 0")
	end

	local syncing = false
	local function syncNow()
		if syncing then
			return
		end
		syncing = true
		pcall(link.syncOnce)
		syncing = false
	end

	task.spawn(function()
		while not link.isStopped() do
			syncNow()
			task.wait(link.nextDelay(interval))
		end
	end)

	game:BindToClose(function()
		syncNow()
	end)

	return table.freeze({
		send = link.send,
		setState = link.setState,
		onCommand = link.onCommand,
		flush = function()
			task.spawn(syncNow)
		end,
		isStopped = link.isStopped,
	})
end

return table.freeze(Rolink)
