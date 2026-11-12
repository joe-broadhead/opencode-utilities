// src/tui.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";

// src/domain/contract.ts
var PLUGIN_ID = "utilities.local";
var DEPRECATED_IDS = { status: "utilities.tools", tools: "utilities.tools.tools", use: PLUGIN_ID };
var NAMESPACE = "utilities";
var COMMANDS = { status: "utilities-status", speechInstall: "utilities-speech-install", nativeInstall: "utilities-install" };
var WEATHER_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";
var MODULES = ["weather", "time", "speech"];
var TOOLS = {
  status: { effect: "compute" },
  time_now: { effect: "compute", module: "time", operation: "current_time" },
  time_zones: { effect: "compute", module: "time", operation: "list_timezones" },
  time_zone_info: { effect: "compute", module: "time", operation: "timezone_info" },
  time_convert: { effect: "compute", module: "time", operation: "convert_timezone" },
  time_calendar: { effect: "compute", module: "time", operation: "calendar_query" },
  time_add: { effect: "compute", module: "time", operation: "date_arithmetic" },
  time_between: { effect: "compute", module: "time", operation: "date_diff" },
  time_format: { effect: "compute", module: "time", operation: "date_format" },
  time_holidays: { effect: "compute", module: "time", operation: "holidays" },
  time_business_days: { effect: "compute", module: "time", operation: "business_days" },
  timer_set: { effect: "write-state", module: "time", operation: "timer_set" },
  timer_get: { effect: "read-state", module: "time", operation: "timer_get" },
  timer_list: { effect: "read-state", module: "time", operation: "timer_list" },
  timer_check: { effect: "read-state", module: "time", operation: "timer_check" },
  timer_delete: { effect: "write-state", module: "time", operation: "timer_delete" },
  weather_geocode: { effect: "network", module: "weather", operation: "geocode" },
  weather_current: { effect: "network", module: "weather", operation: "current" },
  weather_daily: { effect: "network", module: "weather", operation: "daily" },
  weather_hourly: { effect: "network", module: "weather", operation: "hourly" },
  weather_demand_signal: { effect: "network", module: "weather", operation: "demand_signal" },
  weather_summary: { effect: "network", module: "weather", operation: "summary" },
  speech_transcribe: { effect: "read-file", module: "speech", operation: "transcribe" },
  speech_synthesize: { effect: "write-file", module: "speech", operation: "synthesize" }
};
var SPEECH_DOWNLOAD_ACTION = "utilities_speech_download";
var NATIVE_DOWNLOAD_ACTION = "utilities_native_download";
var CHANGING_ACTIONS = [
  "utilities_timer_set",
  "utilities_timer_delete",
  "utilities_speech_synthesize",
  SPEECH_DOWNLOAD_ACTION,
  NATIVE_DOWNLOAD_ACTION
];
var READ_ACTIONS = Object.keys(TOOLS).filter((name) => !CHANGING_ACTIONS.includes(`utilities_${name}`)).map((name) => `utilities_${name}`);
var NAMESPACE_ACTION = `${NAMESPACE}_*`;
var DEFAULT_ASK = [...CHANGING_ACTIONS];
var AVAILABILITY = [
  "AVAILABLE",
  "DISABLED",
  "CLOSED",
  "UNSUPPORTED_PLATFORM",
  "NATIVE_FILES_MISSING",
  "BINARY_MISSING",
  "INTEGRITY_MISMATCH",
  "CONTRACT_MISMATCH",
  "SPEECH_ASSETS_MISSING",
  "UNSAFE_PATH"
];
var STATES = ["ready", "failed", "disabled"];
function registrable(module2, availability2) {
  return availability2 === "AVAILABLE" || (module2 === "speech" ? availability2 === "SPEECH_ASSETS_MISSING" : availability2 === "NATIVE_FILES_MISSING");
}
function toolRegistrable(tool, modules) {
  const entry = TOOLS[tool];
  return !("module" in entry) || registrable(entry.module, modules[entry.module].availability);
}
var SPEECH_MODEL_ROLES = ["tiny-q5_1", "kitten-model", "kitten-voices", "kitten-config"];

// src/host/versions.ts
var HOST_RANGE = ">=2.2.3 <2.3.0";
var parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
};
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function inRange(version, range = HOST_RANGE) {
  const [, low, high] = /^>=(\S+) <(\S+)$/.exec(range) ?? [];
  const found = parse(version), min = low && parse(low), max = high && parse(high);
  if (!found || !min || !max) return false;
  return compare(found, min) >= 0 && compare(found, max) < 0;
}
var hostText = (host) => host.tested ? `${host.version} (tested)` : host.version !== null && inRange(host.version, host.range) ? `${host.version} (untested; supported range ${host.range})` : `${host.version ?? "unknown"} (host untested: outside ${host.range}; allowUntestedHost is set)`;

// src/rpc.ts
var text = (maxLength) => ({ type: "string", maxLength });
var choice = (values) => ({ type: "string", enum: values });
var count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
var list = (items, maxItems) => ({ type: "array", items, maxItems });
var object = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
var next = text(4096);
var availability = choice(AVAILABILITY);
var module = object({ availability, next }, ["availability"]);
var STATUS_JSON_SCHEMA = object({
  version: text(64),
  host: object({ version: { anyOf: [text(64), { type: "null" }] }, range: text(64), tested: { type: "boolean" }, next }, ["version", "range", "tested"]),
  state: choice(STATES),
  unguardedAgents: list(text(256), 256),
  nextStep: next,
  platform: object({ target: text(64), availability, next }, ["target", "availability"]),
  modules: object({ weather: module, time: module, speech: module }, ["weather", "time", "speech"]),
  weather: object({ tier: choice(["free", "commercial"]), key: choice(["none", "connected", "rejected"]), attribution: { type: "string", const: WEATHER_ATTRIBUTION }, next }, ["tier", "key", "attribution"]),
  speech: object({
    assets: list(object({ role: choice(["engine", ...SPEECH_MODEL_ROLES]), name: text(256), bytes: count, state: choice(["missing", "cached", "pre-seeded"]) }, ["role", "name", "bytes", "state"]), 16),
    voices: list(text(64), 64),
    preseeded: { type: "boolean" },
    cacheDirectory: text(4096),
    outputDirectory: text(4096),
    next
  }, ["assets", "voices", "preseeded", "cacheDirectory", "outputDirectory"]),
  timers: object({ due: count, directory: text(4096), next }, ["directory"]),
  shadowedSkills: list(object({ name: text(64), path: text(4096) }, ["name", "path"]), 8),
  permissions: object({
    askByDefault: list(choice(DEFAULT_ASK), DEFAULT_ASK.length),
    block: list(object({ action: text(128), resource: text(128), effect: choice(["allow", "ask", "deny"]) }, ["action", "resource", "effect"]), 64)
  }, ["askByDefault", "block"]),
  access: choice(["all", "ask-changes", "read-only"]),
  deprecated: text(512)
}, ["version", "host", "state", "unguardedAgents", "nextStep", "platform", "modules", "weather", "speech", "timers", "shadowedSkills", "permissions", "access"]);
var Utilities = Rpc.define({
  id: PLUGIN_ID,
  methods: { status: { input: object({}, []), output: STATUS_JSON_SCHEMA, errors: { unavailable: object({ nextStep: { type: "string" } }, ["nextStep"]) } } },
  events: {}
});
var DeprecatedUtilities = Rpc.define({
  id: DEPRECATED_IDS.status,
  methods: { status: { input: object({}, []), output: STATUS_JSON_SCHEMA, errors: { unavailable: object({ nextStep: { type: "string" } }, ["nextStep"]) } } },
  events: {}
});
function isStatus(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return STATUS_JSON_SCHEMA.required.every((key) => typeof v[key] === (key === "version" || key === "state" || key === "nextStep" || key === "access" ? "string" : "object"));
}
var AVAILABILITY_TEXT = {
  AVAILABLE: "ready",
  DISABLED: "disabled",
  CLOSED: "shutting down",
  UNSUPPORTED_PLATFORM: "not supported on this platform",
  NATIVE_FILES_MISSING: "failed: time or weather program not downloaded",
  BINARY_MISSING: "failed: program missing",
  INTEGRITY_MISMATCH: "failed: integrity check",
  CONTRACT_MISMATCH: "failed: unexpected program version",
  SPEECH_ASSETS_MISSING: "speech files not downloaded yet",
  UNSAFE_PATH: "failed: a symbolic link inside the plugin's folders"
};
var MODULE_TEXT = { time: "Time and timers", weather: "Weather", speech: "Speech" };
var megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;
var STATUS_TITLE = "Utilities status";
var NOTHING_TO_DO = "Nothing to do.";
var AGENTS_ROW = "Agents without default rules";
var line = (label, text2, ok) => ({ label, text: text2, ok });
var rulesToPaste = (view) => {
  const block = view.permissions.block;
  return ["[", ...block.map((rule, i) => `  ${JSON.stringify(rule)}${i < block.length - 1 ? "," : ""}`), "]"].join("\n");
};
var AGENT_FIX = `Put the default rules shown by /${COMMANDS.status} first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Utilities tools.`;
function statusLines(view, { paste, agents }) {
  const missing = view.speech.assets.filter((asset) => asset.state === "missing"), unguarded = view.unguardedAgents;
  const registered = Object.keys(TOOLS).filter((tool) => toolRegistrable(tool, view.modules)).length;
  const { key, tier, attribution } = view.weather;
  const connection = key === "connected" ? "connected (Open-Meteo key)" : key === "rejected" ? "sign-in required (Open-Meteo rejected the key)" : "not configured (the Open-Meteo key is optional)";
  const download = missing.length === 0 ? "" : view.speech.preseeded ? ". Copy them into speech.assetsDir" : ". They download on first transcription or synthesis, subject to permissions, or run /utilities-speech-install";
  return [
    line("Connection", connection, key !== "rejected"),
    line("Account", tier === "free" ? "Open-Meteo free tier" : "Open-Meteo commercial key", true),
    line("Access", `${tier === "free" ? "non-commercial use only, rate-limited" : "commercial use"}. ${attribution}`, true),
    line("Platform", view.platform.target, view.platform.availability === "AVAILABLE"),
    ...MODULES.map((m) => line(MODULE_TEXT[m], AVAILABILITY_TEXT[view.modules[m].availability], view.modules[m].availability === "AVAILABLE")),
    line("Speech files", missing.length === 0 ? `${view.speech.assets.length === 0 ? "none" : view.speech.assets.map((a) => `${a.name} ${a.state}`).join(", ")}${view.speech.voices.length ? `. Voices: ${view.speech.voices.join(", ")}` : ""}` : `${missing.length} of ${view.speech.assets.length} files missing (${megabytes(missing.reduce((n, a) => n + a.bytes, 0))})${download}`, missing.length === 0 || !view.speech.preseeded),
    line("Timers", `${view.timers.due === void 0 ? "due count unknown" : `${view.timers.due} due`}. Stored in ${view.timers.directory}`, (view.timers.due ?? 0) === 0),
    line("Asks first", view.permissions.askByDefault.join(", "), true),
    line("Skills", view.shadowedSkills.length ? view.shadowedSkills.map((skill) => `${skill.name} is replaced by ${skill.path}`).join("; ") : "the plugin's own", view.shadowedSkills.length === 0),
    line("Tools", `${registered} available, 0 unknown`, true),
    line(AGENTS_ROW, agents ?? (unguarded.length ? `${unguarded.join(", ")}${paste ? `
${rulesToPaste(view)}` : ""}` : "none"), agents ? agents === "none" : unguarded.length === 0),
    line("OpenCode", `${hostText(view.host)}. Utilities ${view.version}`, view.host.tested),
    // Only after an old id answered in this process: one line, so a script still on it is visible and fixable.
    ...view.deprecated === void 0 ? [] : [line("Deprecated", view.deprecated, false)],
    line("Next step", view.nextStep, view.nextStep === NOTHING_TO_DO)
  ];
}

// src/tui.tsx
var EVENTS = ["server.connected", "agent.updated", "integration.updated", "credential.updated", "credential.switched"];
var tui_default = {
  id: "utilities.local.tui",
  setup(context) {
    const [state, setState] = createSignal({
      loading: true
    });
    const [open, setOpen] = createSignal(false);
    let closed = false, generation = 0, controller;
    const refresh = async () => {
      if (closed) return;
      const current = ++generation;
      controller?.abort();
      const request = controller = new AbortController();
      setState((previous) => ({
        ...previous,
        loading: true
      }));
      try {
        const view = await context.client.rpc(Utilities).status({}, {
          location: context.location ?? context.data.location.default(),
          signal: request.signal
        });
        if (closed || current !== generation) return;
        if (!isStatus(view)) throw new Error("STATUS_UNAVAILABLE: The Utilities server answered with an unexpected status. Next step: Restart OpenCode.");
        setState({
          view,
          loading: false
        });
      } catch (error) {
        if (!closed && current === generation) setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error && error.message ? error.message : "STATUS_UNAVAILABLE: The Utilities server part did not answer. Next step: Restart OpenCode."
        }));
      }
    };
    const View = () => {
      const theme = context.theme;
      return (() => {
        var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$4 = _$createElement("text");
        _$insertNode(_el$, _el$2);
        _$insertNode(_el$, _el$4);
        _$setProp(_el$, "flexDirection", "column");
        _$setProp(_el$, "paddingLeft", 2);
        _$setProp(_el$, "paddingRight", 2);
        _$setProp(_el$, "paddingBottom", 1);
        _$setProp(_el$, "gap", 1);
        _$insert(_el$2, STATUS_TITLE, null);
        _$insert(_el$2, () => state().loading ? " \xB7 refreshing" : "", null);
        _$insert(_el$, _$createComponent(Show, {
          get when() {
            return state().view;
          },
          get fallback() {
            return (() => {
              var _el$6 = _$createElement("text");
              _$insert(_el$6, (() => {
                var _c$ = _$memo(() => !!state().loading);
                return () => _c$() ? "Loading status\u2026" : `${state().error}`;
              })());
              _$effect((_$p) => _$setProp(_el$6, "fg", theme.text.muted, _$p));
              return _el$6;
            })();
          },
          children: (view) => (() => {
            var _el$7 = _$createElement("scrollbox"), _el$8 = _$createElement("box");
            _$insertNode(_el$7, _el$8);
            _$setProp(_el$7, "maxHeight", 28);
            _$setProp(_el$8, "flexDirection", "column");
            _$insert(_el$8, _$createComponent(For, {
              get each() {
                return statusLines(view(), {
                  paste: true
                });
              },
              children: (line2) => _$createComponent(For, {
                get each() {
                  return `${line2.label}: ${line2.text}`.split("\n");
                },
                children: (row) => (() => {
                  var _el$9 = _$createElement("text");
                  _$insert(_el$9, row);
                  _$effect((_$p) => _$setProp(_el$9, "fg", line2.ok ? theme.text.base : theme.text.feedback.warning.base, _$p));
                  return _el$9;
                })()
              })
            }));
            return _el$7;
          })()
        }), _el$4);
        _$insert(_el$, _$createComponent(Show, {
          get when() {
            return _$memo(() => !!state().view)() && state().error;
          },
          get children() {
            var _el$3 = _$createElement("text");
            _$insert(_el$3, () => `Refresh failed: ${state().error}`);
            _$effect((_$p) => _$setProp(_el$3, "fg", theme.text.feedback.error.base, _$p));
            return _el$3;
          }
        }), _el$4);
        _$insertNode(_el$4, _$createTextNode(`r refresh \xB7 esc close`));
        _$setProp(_el$4, "onMouseUp", () => void refresh());
        _$effect((_p$) => {
          var _v$ = theme.text.base, _v$2 = theme.text.muted;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$2, _p$.t));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$;
      })();
    };
    let stops = [];
    const unsubscribe = () => {
      for (const stop of stops.splice(0)) stop();
    };
    const show = () => {
      if (closed) return;
      setOpen(true);
      unsubscribe();
      stops = EVENTS.map((type) => context.data.on(type, () => void refresh()));
      context.ui.dialog.show(() => _$createComponent(View, {}), () => {
        unsubscribe();
        setOpen(false);
      });
      context.ui.dialog.set({
        size: "large"
      });
      void refresh();
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "utilities.status",
        title: "Utilities: Status",
        group: "Utilities",
        palette: true,
        slash: {
          name: "utilities"
        },
        run: show
      }, {
        id: "utilities.refresh",
        title: "Refresh Utilities status",
        group: "Utilities",
        bind: "r",
        enabled: () => open(),
        run: () => void refresh()
      }]
    }));
    return () => {
      closed = true;
      generation++;
      controller?.abort();
      unsubscribe();
      if (open()) context.ui.dialog.clear();
    };
  }
};
export {
  tui_default as default
};
