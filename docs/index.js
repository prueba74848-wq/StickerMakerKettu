(function () {
function require(id) {
  switch (id) {
    case "@vendetta": return vendetta;
    case "@vendetta/metro": return vendetta.metro;
    case "@vendetta/metro/common": return vendetta.metro.common;
    case "@vendetta/ui/assets": return vendetta.ui.assets;
    case "@vendetta/ui/toasts": return vendetta.ui.toasts;
    case "@vendetta/ui/components": return vendetta.ui.components;
    case "@vendetta/storage": return vendetta.storage;
    case "@vendetta/plugin": return vendetta.plugin;
    case "@vendetta/commands": return vendetta.commands;
    default: throw new Error("[GifSticker] Unknown module: " + id);
  }
}
var module = { exports: {} };
var exports = module.exports;
'use strict';

Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: 'Module' } });

const metro = require('@vendetta/metro');
const plugin = require('@vendetta/plugin');
const _vendetta = require('@vendetta');
const common = require('@vendetta/metro/common');
const assets = require('@vendetta/ui/assets');
const toasts = require('@vendetta/ui/toasts');
const components = require('@vendetta/ui/components');
const storage = require('@vendetta/storage');
const commands = require('@vendetta/commands');

const { FormSection, FormInput, FormText } = components.Forms;

const MAX_BYTES = 512 * 1024;
const API = "https://discord.com/api/v9";

let unregister = null;

function Settings() {
  storage.useProxy(plugin.storage);
  const h = common.React.createElement;
  return h(
    FormSection,
    { title: "GIF Sticker", android_noDivider: true },
    h(FormInput, {
      title: "Server ID (optional)",
      placeholder: "Leave empty to use the server you're typing in",
      value: plugin.storage.guildId,
      onChange: (v) => (plugin.storage.guildId = v.trim())
    }),
    h(
      FormText,
      { style: { paddingHorizontal: 16, paddingBottom: 8 } },
      "Use /gifsticker with a link to a real .gif file (for example a copied attachment link) and a name. " +
        "The GIF must be 512 KB or smaller and about 320x320 px. " +
        "You need the Manage Expressions permission and a free sticker slot in the server. " +
        "GIFs from the GIF picker (Tenor, Giphy) are usually video clips and will be rejected."
    )
  );
}

function toast(text) {
  try {
    toasts.showToast(text, assets.getAssetIDByName("Small"));
  } catch (e) {
    _vendetta.logger.log("[GifSticker] toast failed: " + String(e));
  }
}

function getToken() {
  try {
    const TokenStore = metro.findByProps("getToken");
    return TokenStore && TokenStore.getToken ? TokenStore.getToken() : null;
  } catch (e) {
    _vendetta.logger.log("[GifSticker] token lookup failed: " + String(e));
    return null;
  }
}

function readArg(args, name) {
  if (!args) return undefined;
  if (Array.isArray(args)) {
    const a = args.find((x) => x && x.name === name);
    return a ? a.value : undefined;
  }
  const v = args[name];
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

async function makeSticker(guildId, url, name, tags) {
  toast("Downloading GIF...");

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    _vendetta.logger.log("[GifSticker] download error: " + String(e));
    toast("Couldn't download that link");
    return;
  }
  if (!res.ok) {
    toast("Download failed (" + res.status + ")");
    return;
  }

  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (type.indexOf("image/gif") === -1) {
    toast(type.indexOf("video") === 0 ? "That's a video clip, not a real GIF file" : "That link isn't a GIF file");
    return;
  }

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) {
    toast("GIF is " + Math.round(declared / 1024) + " KB, the limit is 512 KB");
    return;
  }

  let blob;
  try {
    blob = await res.blob();
  } catch (e) {
    _vendetta.logger.log("[GifSticker] read error: " + String(e));
    toast("Couldn't read the GIF");
    return;
  }
  if (blob.size > MAX_BYTES) {
    toast("GIF is " + Math.round(blob.size / 1024) + " KB, the limit is 512 KB");
    return;
  }

  const token = getToken();
  if (!token) {
    toast("Couldn't get your login token");
    return;
  }

  try {
    blob.name = "sticker.gif";
  } catch (e) {}

  const form = new FormData();
  form.append("name", name);
  form.append("tags", tags);
  form.append("description", "");
  form.append("file", blob, "sticker.gif");

  toast("Uploading sticker...");
  try {
    const resp = await fetch(API + "/guilds/" + guildId + "/stickers", {
      method: "POST",
      headers: { Authorization: token },
      body: form
    });
    let body = null;
    try {
      body = await resp.json();
    } catch (e) {}

    if (resp.ok) {
      _vendetta.logger.log("[GifSticker] Created sticker " + (body && body.id) + " in " + guildId);
      toast('Sticker "' + name + '" added');
      return;
    }

    const msg = body && body.message ? body.message : "HTTP " + resp.status;
    _vendetta.logger.log("[GifSticker] Upload failed (" + resp.status + "): " + JSON.stringify(body));
    if (resp.status === 403 || (body && body.code === 50013)) {
      toast("Missing Manage Expressions permission");
    } else if (body && body.code === 30039) {
      toast("This server has no free sticker slots");
    } else {
      toast("Upload failed: " + msg);
    }
  } catch (e) {
    _vendetta.logger.log("[GifSticker] Upload error: " + String(e));
    toast("Upload failed, check the debug logs");
  }
}

async function execute(args, ctx) {
  try {
    const url = String(readArg(args, "url") || "").trim();
    const name = String(readArg(args, "name") || "").trim();
    const tags = String(readArg(args, "tags") || name).trim();

    if (!/^https?:\/\//i.test(url)) {
      toast("Give a link that starts with http");
      return;
    }
    if (name.length < 2 || name.length > 30) {
      toast("Sticker name must be 2 to 30 characters");
      return;
    }

    const guildId = plugin.storage.guildId || (ctx && ctx.guild && ctx.guild.id);
    if (!guildId) {
      toast("Use this in a server, or set a Server ID in the plugin settings");
      return;
    }

    await makeSticker(guildId, url, name, tags.length >= 2 ? tags : name);
  } catch (e) {
    _vendetta.logger.log("[GifSticker] command error: " + String(e));
    toast("Something went wrong, check the debug logs");
  }
}

const index = {
  onLoad() {
    if (plugin.storage.guildId == null) plugin.storage.guildId = "";
    unregister = commands.registerCommand({
      name: "gifsticker",
      displayName: "gifsticker",
      description: "Turn a .gif link into a server sticker",
      displayDescription: "Turn a .gif link into a server sticker",
      options: [
        {
          name: "url",
          displayName: "url",
          description: "Link to a .gif file (512 KB or smaller)",
          displayDescription: "Link to a .gif file (512 KB or smaller)",
          required: true,
          type: 3
        },
        {
          name: "name",
          displayName: "name",
          description: "Sticker name (2 to 30 characters)",
          displayDescription: "Sticker name (2 to 30 characters)",
          required: true,
          type: 3
        },
        {
          name: "tags",
          displayName: "tags",
          description: "Related emoji or keywords (defaults to the name)",
          displayDescription: "Related emoji or keywords (defaults to the name)",
          required: false,
          type: 3
        }
      ],
      applicationId: "-1",
      inputType: 1,
      type: 1,
      execute: execute
    });
    _vendetta.logger.log("[GifSticker] Loaded.");
  },
  onUnload() {
    if (unregister) unregister();
    unregister = null;
    _vendetta.logger.log("[GifSticker] Unloaded.");
  },
  settings: Settings
};

exports.default = index;
return module.exports;
})();
