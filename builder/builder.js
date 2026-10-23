/*
 * SignCard builder — card.labs.trlibrary.com/builder/
 *
 * Public on purpose: the builder only produces a campaign file. A campaign goes live when that file
 * is added to the campaigns/ folder of the SignCard repository, which needs GitHub write access.
 * Drafts are kept in this browser only.
 */
(function () {
  "use strict";
  var REPO = "https://github.com/Theodore-Roosevelt-Presidential-Library/SignCard";
  var SITE = "https://card.labs.trlibrary.com/";
  var DRAFT_KEY = "signcard:builder-draft";
  var form = document.getElementById("bform");
  var pv = document.getElementById("pv");
  var stepIx = 0, cfg = null, jump = "start", pvReady = false;

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function get(o, p) { return p.split(".").reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function set(o, p, v) { var ks = p.split("."), last = ks.pop(); ks.reduce(function (a, k) { if (a[k] == null || typeof a[k] !== "object") a[k] = {}; return a[k]; }, o)[last] = v; }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
  function toast(msg) { var t = $(".toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("on"); }, 2600); }
  function store(v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch (e) { return null; } }

  /* Field types: text, area, num, date, check, select, radio, url */
  var STEPS = [
    { title: "Start", jump: "start", intro: "Pick a starting point. Every setting can be changed in the next steps.", fields: [
      { k: "_template", t: "template", label: "Start from" },
      { k: "name", t: "text", label: "Campaign name", hint: "For staff only, e.g. TR's Birthday Card" },
      { k: "id", t: "text", label: "Campaign ID", hint: "Lowercase letters, numbers and dashes. It becomes the file name and the link, e.g. tr-birthday-2027. Pick a new one for every campaign." },
      { k: "opens", t: "date", label: "Opens", hint: "Informational. Staff can sign before this date to add starter wishes." },
      { k: "closes", t: "date", label: "Closes", hint: "After this day (Mountain Time) the card shows a thank-you instead of the form." },
      { k: "theme", t: "select", label: "Background color", opts: [["night-sky", "Night Sky (navy)"], ["dark-forest", "Dark Forest (green)"], ["dark-gray", "Dark Gray"]] }
    ]},
    { title: "Opening", jump: "start", intro: "What plays before visitors sign. The birthday cake is an animation visitors blow out by tapping or with their microphone.", fields: [
      { k: "opener.type", t: "radio", label: "Opening", opts: [["cake", "Birthday cake animation"], ["video", "A video I upload"], ["none", "No opening, start at the card"]] },
      { k: "opener.headline", t: "text", label: "Headline", show: "cake", hint: "The last word is set in the accent color." },
      { k: "opener.kicker", t: "text", label: "Small label under the logo", show: "cake" },
      { k: "opener.candles", t: "text", label: "Number on the cake and card cover", show: "cake", hint: "Keep it short, e.g. 168" },
      { k: "opener.cakeText", t: "text", label: "Words on the cake", show: "cake", hint: "Optional. Leave blank for a simple cake with the Maltese Cross brand." },
      { k: "opener.wishPrompt", t: "text", label: "Prompt", show: "cake" },
      { k: "opener.blowHint", t: "text", label: "Prompt detail", show: "cake" },
      { k: "opener.blowButton", t: "text", label: "Button", show: "cake" },
      { k: "opener.doneHeadline", t: "text", label: "Headline after the candles go out", show: "cake" },
      { k: "opener.nextPrompt", t: "text", label: "Prompt after the candles go out", show: "cake" },
      { k: "opener.photo", t: "url", label: "Cut-out photo (transparent PNG or WebP)", show: "cake", hint: "A historic black-and-white cut-out works best. Upload images to trlibrary.com/media/add/image and paste the file link." },
      { k: "opener.photoAlt", t: "text", label: "Describe the cut-out photo", show: "cake" },
      { k: "opener.background", t: "url", label: "Background photo", show: "cake", hint: "A wide color landscape, at least 1600 pixels across. The left side is darkened for the headline." },
      { k: "opener.backgroundAlt", t: "text", label: "Describe the landscape photo", show: "cake" },
      { k: "opener.video", t: "url", label: "Video link (MP4)", show: "video", hint: "A direct link to an .mp4 file. It plays muted with a Sound on button, then moves visitors to the card when it ends. Keep it under 30 seconds and 20 MB." },
      { k: "opener.poster", t: "url", label: "Still image shown before the video plays", show: "video" },
      { k: "opener.photo", t: "url", label: "Cut-out photo for the card cover", show: "video,none", hint: "Optional." }
    ]},
    { title: "Card", jump: "card", intro: "The invitation, the front of the card and the inside where people sign.", fields: [
      { k: "card.inviteTitle", t: "text", label: "Invitation headline" },
      { k: "card.inviteBody", t: "area", label: "Invitation text" },
      { k: "card.openButton", t: "text", label: "Open button" },
      { k: "card.coverTitle", t: "text", label: "Card cover headline" },
      { k: "card.greeting", t: "text", label: "Printed greeting inside the card" },
      { k: "card.greetingSub", t: "text", label: "Line under the greeting" },
      { k: "card.showMessage", t: "check", label: "Ask for a message" },
      { k: "card.messageRequired", t: "check", label: "Message is required" },
      { k: "card.messageLabel", t: "text", label: "Message label" },
      { k: "card.messagePrefix", t: "text", label: "Sentence starter", hint: "Printed at the start of the message box so people finish the sentence, e.g. I wish for. It is added to the front of every message. Leave blank for an open message." },
      { k: "card.messagePlaceholder", t: "text", label: "Message placeholder", hint: "Faint example text after the sentence starter." },
      { k: "card.messageMax", t: "num", label: "Longest message (characters)", min: 60, max: 1000 },
      { k: "card.optInLabel", t: "text", label: "Email sign-up checkbox" },
      { k: "card.optInDefault", t: "check", label: "Checkbox starts checked" },
      { k: "card.privacyNote", t: "area", label: "Privacy note" },
      { k: "card.submitLabel", t: "text", label: "Sign button" },
      { k: "card.signedTitle", t: "text", label: "Thank-you headline", hint: "The signer's first name is added after it." },
      { k: "card.signedBody", t: "text", label: "Thank-you line" },
      { k: "card.closedTitle", t: "text", label: "Headline after the card closes" },
      { k: "card.closedBody", t: "text", label: "Line after the card closes" }
    ]},
    { title: "After signing", jump: "join", intro: "What people see once they sign: the best wishes, the map, the call to action and sharing.", fields: [
      { k: "wall.show", t: "check", label: "Show the best messages" },
      { k: "wall.title", t: "text", label: "Messages headline" },
      { k: "wall.count", t: "num", label: "How many messages to feature", min: 3, max: 40 },
      { k: "map.show", t: "check", label: "Show the map" },
      { k: "map.title", t: "text", label: "Map headline" },
      { k: "map.minimum", t: "num", label: "Show the map once this many have signed", min: 0, max: 1000 },
      { k: "cta.popup", t: "check", label: "Also show the call to action as a pop-up", hint: "Appears over the wishes or map a few seconds after someone arrives there. Visitors have to dismiss it. It shows once per visit, and the call to action is always the final step." },
      { k: "cta.popupDelay", t: "num", label: "Seconds before the pop-up appears", min: 2, max: 60 },
      { k: "cta.kicker", t: "text", label: "Pop-up small label", hint: "e.g. Before you go" },
      { k: "cta.dismiss", t: "text", label: "Pop-up dismiss link", hint: "e.g. Maybe later" },
      { k: "cta.title", t: "text", label: "Call to action headline" },
      { k: "cta.body", t: "area", label: "Call to action text" },
      { k: "cta.button", t: "text", label: "Call to action button" },
      { k: "cta.url", t: "url", label: "Button link" },
      { k: "cta.utmSource", t: "text", label: "UTM source" },
      { k: "cta.utmMedium", t: "text", label: "UTM medium" },
      { k: "cta.utmCampaign", t: "text", label: "UTM campaign", hint: "Leave blank to use the campaign ID." },
      { k: "share.title", t: "text", label: "Share headline" },
      { k: "share.text", t: "area", label: "Text that goes with a shared link" }
    ]},
    { title: "AI picks", jump: "reveal", intro: "Every few minutes an AI model screens new messages, hides anything inappropriate and picks the best ones to feature. Tell it what this card is about.", fields: [
      { k: "ai.topic", t: "area", label: "What people are writing" },
      { k: "ai.guidance", t: "area", label: "What makes a message worth featuring", hint: "Partisan content, named politicians, personal details, links and anything unkind are always left out." }
    ]},
    { title: "Publish", jump: "start", publish: true, intro: "", fields: [] }
  ];

  /* ---------- templates ---------- */
  var BLANK = {
    id: "", name: "", opens: "", closes: "", theme: "night-sky",
    opener: { type: "none" },
    card: { inviteTitle: "Sign the card", inviteBody: "", openButton: "Open the card", coverTitle: "", greeting: "", greetingSub: "", showMessage: true, messageRequired: false,
      messageLabel: "Your message", messagePlaceholder: "", messageMax: 280, optInLabel: "Send me news and stories from the Theodore Roosevelt Presidential Library.", optInDefault: true,
      privacyNote: "Your first name, last initial, city and message may appear on the card. Your email and ZIP code are never shown.", submitLabel: "Sign the card",
      signedTitle: "You're on the card", signedBody: "", closedTitle: "This card has been delivered", closedBody: "Thank you to everyone who signed." },
    wall: { show: true, title: "Messages", count: 12 }, map: { show: true, title: "Signed from coast to coast", minimum: 25 },
    cta: { popup: true, popupDelay: 8, kicker: "Before you go", dismiss: "Maybe later", title: "", body: "", button: "Become a member", url: "https://www.trlibrary.com/membership", utmSource: "signcard", utmMedium: "card", utmCampaign: "" },
    share: { title: "Pass the card around", text: "", url: "" }, ai: { topic: "", guidance: "" }, moderation: { hide: [], pin: [] }
  };
  var templates = [];

  function loadTemplates() {
    return fetch("../campaigns/list.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (l) { return { campaigns: l.campaigns.map(function (c) { return c.id; }) }; })
      .catch(function () { return fetch("../campaigns/index.json", { cache: "no-cache" }).then(function (r) { return r.json(); }); })
      .then(function (ix) {
      return Promise.all((ix.campaigns || []).map(function (id) {
        return fetch("../campaigns/" + id + ".json", { cache: "no-cache" }).then(function (r) { return r.json(); }).catch(function () { return null; });
      }));
    }).then(function (list) { templates = list.filter(Boolean); }).catch(function () { templates = []; });
  }

  function fromTemplate(key) {
    var base = key === "blank" ? BLANK : (templates.filter(function (t) { return t.id === key; })[0] || BLANK);
    var c = JSON.parse(JSON.stringify(base));
    c.id = ""; c.name = key === "blank" ? "" : "Copy of " + (base.name || base.id);
    c.opens = ""; c.closes = "";
    if (c.cta) c.cta.utmCampaign = "";
    if (c.share) c.share.url = "";
    c.moderation = { hide: [], pin: [] };
    c._template = key;
    return c;
  }

  /* ---------- form ---------- */
  function fieldHTML(f) {
    var v = get(cfg, f.k), id = "b_" + f.k.replace(/\W/g, "_") + "_" + Math.random().toString(36).slice(2, 5);
    var lab = '<label for="' + id + '">' + esc(f.label) + "</label>";
    var hint = f.hint ? '<p class="hint">' + esc(f.hint) + "</p>" : "";
    var attrs = ' id="' + id + '" data-k="' + f.k + '" data-t="' + f.t + '"';
    var show = f.show ? ' data-show="' + f.show + '"' : "";
    if (f.t === "template") {
      var opts = templates.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + "</option>"; }).join("") + '<option value="blank">Blank card</option>';
      return '<div class="f"' + show + ">" + lab + '<select id="' + id + '" data-template>' + opts + "</select>" + '<p class="hint">Starts a new campaign from a copy. The original is never changed.</p></div>';
    }
    if (f.t === "area") return '<div class="f"' + show + ">" + lab + "<textarea" + attrs + ' rows="3">' + esc(v) + "</textarea>" + hint + "</div>";
    if (f.t === "check") return '<div class="f chk"' + show + '><label><input type="checkbox"' + attrs + (v ? " checked" : "") + "> " + esc(f.label) + "</label>" + hint + "</div>";
    if (f.t === "select") return '<div class="f"' + show + ">" + lab + "<select" + attrs + ">" + f.opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" + hint + "</div>";
    if (f.t === "radio") return '<fieldset class="f radio"' + show + "><legend>" + esc(f.label) + "</legend>" + f.opts.map(function (o) {
      return '<label><input type="radio" name="' + f.k + '" value="' + o[0] + '" data-k="' + f.k + '" data-t="radio"' + (o[0] === v ? " checked" : "") + "> " + esc(o[1]) + "</label>";
    }).join("") + hint + "</fieldset>";
    var type = f.t === "num" ? "number" : f.t === "date" ? "date" : f.t === "url" ? "url" : "text";
    return '<div class="f"' + show + ">" + lab + '<input type="' + type + '"' + attrs + ' value="' + esc(v) + '"' + (f.min != null ? ' min="' + f.min + '"' : "") + (f.max != null ? ' max="' + f.max + '"' : "") + ">" + hint + "</div>";
  }

  function renderStep() {
    var st = STEPS[stepIx];
    $(".steps").innerHTML = STEPS.map(function (s, i) {
      return '<button type="button" role="tab" aria-selected="' + (i === stepIx) + '" class="' + (i === stepIx ? "on" : i < stepIx ? "done" : "") + '" data-step="' + i + '"><b>' + (i + 1) + "</b>" + esc(s.title) + "</button>";
    }).join("");
    $$("[data-step]").forEach(function (b) { b.addEventListener("click", function () { go(+b.getAttribute("data-step")); }); });
    form.innerHTML = '<h2>' + esc(st.title) + "</h2>" + (st.intro ? '<p class="intro">' + esc(st.intro) + "</p>" : "") + (st.publish ? publishHTML() : st.fields.map(fieldHTML).join(""));
    $("[data-back]").style.visibility = stepIx === 0 ? "hidden" : "visible";
    $("[data-next]").style.display = st.publish ? "none" : "";
    var tsel = $("[data-template]");
    if (tsel) {
      tsel.value = cfg._template || (templates[0] && templates[0].id) || "blank";
      tsel.addEventListener("change", function () {
        cfg = fromTemplate(tsel.value); store(cfg); renderStep(); push(); toast("Started from " + tsel.options[tsel.selectedIndex].text);
      });
    }
    $$("[data-k]", form).forEach(function (el) { el.addEventListener(el.type === "checkbox" || el.type === "radio" || el.tagName === "SELECT" ? "change" : "input", onField); });
    applyShow();
    if (st.publish) wirePublish();
    jumpTo(st.jump);
  }

  function onField(e) {
    var el = e.target, k = el.getAttribute("data-k"), t = el.getAttribute("data-t"), v;
    if (t === "check") v = el.checked;
    else if (t === "num") v = el.value === "" ? "" : +el.value;
    else v = el.value;
    if (k === "id") { var s = slug(v); if (s !== v) { var pos = el.selectionStart; el.value = s; v = s; try { el.setSelectionRange(pos, pos); } catch (x) {} } }
    set(cfg, k, v);
    if (k === "opener.type") applyShow();
    store(cfg); schedule();
  }

  function applyShow() {
    var type = get(cfg, "opener.type") || "none";
    $$("[data-show]", form).forEach(function (el) { el.hidden = el.getAttribute("data-show").split(",").indexOf(type) < 0; });
  }

  function go(i) { stepIx = Math.max(0, Math.min(STEPS.length - 1, i)); renderStep(); window.scrollTo({ top: 0, behavior: "smooth" }); }

  /* ---------- preview ---------- */
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(push, 350); }
  function output() {
    var c = JSON.parse(JSON.stringify(cfg));
    Object.keys(c).forEach(function (k) { if (k.charAt(0) === "_") delete c[k]; });
    c.id = c.id || "untitled-campaign";
    if (c.cta && !c.cta.utmCampaign) c.cta.utmCampaign = c.id;
    if (c.share && !c.share.url) c.share.url = SITE + "?c=" + c.id;
    if (c.opener && c.opener.type === "cake" && !c.opener.photo) c.opener.photo = "assets/img/tr-buckskin-bust.webp";
    return c;
  }
  function push() { if (pvReady) pv.contentWindow.postMessage({ type: "signcard:config", config: output(), jump: jump }, "*"); }
  function jumpTo(j) {
    jump = j || "start";
    $$("[data-jump]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-jump") === jump); });
    push();
  }
  window.addEventListener("message", function (e) { if (e.source === pv.contentWindow && e.data && e.data.type === "signcard:ready") { pvReady = true; push(); } });
  $$("[data-jump]").forEach(function (b) { b.addEventListener("click", function () { jumpTo(b.getAttribute("data-jump")); }); });
  $$("[data-size]").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("[data-size]").forEach(function (x) { x.classList.toggle("on", x === b); });
      $(".pvframe").classList.toggle("mob", b.getAttribute("data-size") === "mob");
    });
  });

  /* ---------- publish ---------- */
  function problems() {
    var c = cfg, out = [];
    if (!/^[a-z0-9-]{3,60}$/.test(c.id || "")) out.push(["Start", "Add a campaign ID (at least 3 characters: lowercase letters, numbers, dashes)."]);
    if (templates.some(function (t) { return t.id === c.id; })) out.push(["Start", "The ID “" + c.id + "” is already used by a live campaign. Pick a new one."]);
    if (!c.closes) out.push(["Start", "Add a closing date."]);
    if (get(c, "opener.type") === "video" && !/^https:\/\/.+\.mp4(\?.*)?$/i.test(get(c, "opener.video") || "")) out.push(["Opening", "Add a link to an .mp4 video that starts with https://"]);
    if (!get(c, "card.inviteTitle")) out.push(["Card", "Add an invitation headline."]);
    if (!get(c, "card.greeting")) out.push(["Card", "Add the printed greeting inside the card."]);
    if (get(c, "cta.url") && !/^https:\/\//.test(get(c, "cta.url"))) out.push(["After signing", "The button link should start with https://"]);
    if (!get(c, "ai.topic")) out.push(["AI picks", "Tell the AI what people are writing."]);
    return out;
  }

  function publishHTML() {
    var p = problems(), c = output(), json = JSON.stringify(c, null, 2);
    var embed = '<div data-signcard="' + c.id + '"></div>\n<script src="' + SITE + 'embed.js" async><\/script>';
    var html = "";
    if (p.length) {
      html += '<div class="warn"><b>Before publishing:</b><ul>' + p.map(function (x) { return "<li><button type=\"button\" class=\"lnk\" data-goto=\"" + esc(x[0]) + "\">" + esc(x[0]) + "</button>: " + esc(x[1]) + "</li>"; }).join("") + "</ul></div>";
    } else {
      html += '<div class="ok">Ready to publish.</div>';
    }
    html += '<ol class="pub">' +
      '<li><h3>Save the campaign file</h3><p>Download <code>' + esc(c.id) + '.json</code>.</p><div class="row"><button type="button" class="b" data-dl>Download file</button><button type="button" class="b ghost" data-copy="json">Copy file contents</button></div></li>' +
      '<li><h3>Add it to the repository</h3><p>Open the campaigns folder on GitHub, choose <b>Add file → Upload files</b>, drop in the file and commit. This needs write access to the repo, which is what keeps random people from launching a card. The AI screening finds new campaign files on its own.</p>' +
      '<div class="row"><a class="b ghost" href="' + REPO + '/upload/main/campaigns" target="_blank" rel="noopener">Upload to campaigns/</a></div>' +
      '<p class="hint">About two minutes after the upload, the campaign appears on the campaigns page at card.labs.trlibrary.com with its embed code.</p></li>' +
      '<li><h3>Add starter wishes</h3><p>About a minute after the upload, have staff and friends sign at the starter link. It skips the opening so signing is quick. Their wishes appear on the card once the AI screening runs.</p>' +
      '<div class="code">' + esc(SITE + "?c=" + c.id + "&starter=1") + '</div><div class="row"><button type="button" class="b ghost" data-copy="starter">Copy starter link</button></div></li>' +
      '<li><h3>Put it on a page</h3><p>Paste this into a Drupal page using a code block (Full HTML), or into any website:</p><div class="code">' + esc(embed) + '</div>' +
      '<div class="row"><button type="button" class="b ghost" data-copy="embed">Copy embed code</button></div>' +
      '<p class="hint">Or share the card on its own page: <code>' + esc(SITE + "?c=" + c.id) + "</code></p></li>" +
      "</ol>";
    html += '<textarea class="hidden-json" hidden>' + esc(json) + "</textarea>";
    return html;
  }

  function wirePublish() {
    var c = output();
    var texts = {
      json: JSON.stringify(c, null, 2) + "\n",
      starter: SITE + "?c=" + c.id + "&starter=1",
      embed: '<div data-signcard="' + c.id + '"></div>\n<script src="' + SITE + 'embed.js" async></script>'
    };
    $$("[data-copy]", form).forEach(function (b) {
      b.addEventListener("click", function () {
        var t = texts[b.getAttribute("data-copy")];
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copied"); }, function () { toast("Select the text and copy it by hand."); });
      });
    });
    var dl = $("[data-dl]", form);
    if (dl) dl.addEventListener("click", function () {
      var blob = new Blob([texts.json], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = c.id + ".json";
      document.body.appendChild(a); a.click(); a.remove(); toast("Downloaded " + c.id + ".json");
    });
    $$("[data-goto]", form).forEach(function (b) {
      b.addEventListener("click", function () { var n = b.getAttribute("data-goto"); go(STEPS.findIndex(function (s) { return s.title === n; })); });
    });
  }

  $("[data-next]").addEventListener("click", function () { go(stepIx + 1); });
  $("[data-back]").addEventListener("click", function () { go(stepIx - 1); });

  loadTemplates().then(function () {
    cfg = store() || fromTemplate(templates[0] ? templates[0].id : "blank");
    renderStep();
    push();
  });
})();
