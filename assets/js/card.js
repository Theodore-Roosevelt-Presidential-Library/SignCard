/*
 * SignCard player — card.labs.trlibrary.com
 *
 * Flow: opener (cake, video or none) -> invitation + card -> sign -> reveal (wishes, map, call to action, share).
 * Campaign settings come from campaigns/<id>.json; public numbers come from data/<id>.json, which the
 * GitHub Action rebuilds from Firestore. Browsers never read signatures: they only create one.
 *
 * URL options: ?c=<campaign id>  ?embed=1 (inside the embed iframe)  ?starter=1 (skip the opener; for
 * staff signing before launch)  ?preview=1 (builder preview: settings arrive by postMessage, nothing is saved)
 */
(function () {
  "use strict";
  var CFG = window.SIGNCARD_CONFIG || { firebase: {} };
  var qs = new URLSearchParams(location.search);
  var EMBED = qs.has("embed") || window.self !== window.top;
  var PREVIEW = qs.has("preview");
  var STARTER = qs.has("starter");
  var root = document.getElementById("signcard");
  var C = null, D = null, me = null, opened = false;
  var BRAND = ["#F9D635", "#E7805D", "#F36079", "#8FC895", "#99ADC5", "#FC924E", "#FFFFFF", "#87BB41"];
  var INKS = ["#1d2b44", "#1B4532", "#7a3b22", "#092A4D", "#4b2a5e", "#25282A"];
  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (EMBED) document.body.classList.add("is-embed");

  /* ---------------- utilities ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, REDUCED ? Math.min(ms, 50) : ms); }); }
  function store(key, val) {
    try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null"); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
  }
  function get(o, path, dflt) {
    var v = path.split(".").reduce(function (a, k) { return a && a[k] !== undefined ? a[k] : undefined; }, o);
    return v === undefined || v === null || v === "" ? dflt : v;
  }
  function asset(u) { return /^(https?:)?\/\//.test(u || "") ? u : (u || ""); }
  function isClosed() {
    var c = get(C, "closes", "");
    if (!c) return false;
    return new Date() > new Date(c + "T23:59:59-06:00");
  }
  function displayName(first, last) {
    first = (first || "").trim(); last = (last || "").trim();
    return first + (last ? " " + last.charAt(0).toUpperCase() + "." : "");
  }

  /* ---------------- embed messaging ---------------- */
  function post(msg) { if (EMBED && window.parent) { try { window.parent.postMessage(msg, "*"); } catch (e) {} } }
  if (EMBED && "ResizeObserver" in window) {
    new ResizeObserver(function () { post({ type: "signcard:height", height: Math.ceil(document.documentElement.scrollHeight) }); }).observe(document.body);
  }
  function scrollToEl(el) {
    if (!el) return;
    if (EMBED && !PREVIEW) post({ type: "signcard:scroll", top: Math.round(el.getBoundingClientRect().top + window.scrollY) });
    else el.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }

  /* ---------------- art ---------------- */
  function sealSVG(ring, text, center, sub) {
    var id = "sp" + Math.random().toString(36).slice(2, 7);
    return '<svg viewBox="0 0 200 200" aria-hidden="true">' +
      '<defs><path id="' + id + '" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0"/></defs>' +
      '<circle cx="100" cy="100" r="96" fill="' + ring + '"/>' +
      '<circle cx="100" cy="100" r="58" fill="none" stroke="' + text + '" stroke-width="2"/>' +
      '<text font-family="Frutiger,Arial,sans-serif" font-weight="700" font-size="13" letter-spacing="2.2" fill="' + text + '">' +
      '<textPath href="#' + id + '">THEODORE ROOSEVELT • PRESIDENTIAL LIBRARY •</textPath></text>' +
      '<text x="100" y="' + (sub ? 108 : 118) + '" text-anchor="middle" font-family="Clearface,Georgia,serif" font-weight="700" font-size="' + (sub ? 44 : 54) + '" fill="' + text + '">' + esc(center) + '</text>' +
      (sub ? '<text x="100" y="134" text-anchor="middle" font-family="Dharma Gothic E,Arial Narrow,sans-serif" font-weight="700" font-size="24" letter-spacing="1" fill="' + text + '">' + esc(sub) + '</text>' : "") +
      '</svg>';
  }

  function maltese(x, y, s, fill) {
    // Cross pattee, a nod to the Maltese Cross brand of TR's first Badlands ranch.
    var k = s / 2;
    return '<path fill="' + fill + '" transform="translate(' + x + ',' + y + ')" d="M' + (-k * .28) + ',' + (-k * .2) + ' L' + (-k * .55) + ',' + (-k) + ' L' + (k * .55) + ',' + (-k) + ' L' + (k * .28) + ',' + (-k * .2) +
      ' L' + k + ',' + (-k * .55) + ' L' + k + ',' + (k * .55) + ' L' + (k * .28) + ',' + (k * .2) + ' L' + (k * .55) + ',' + k + ' L' + (-k * .55) + ',' + k + ' L' + (-k * .28) + ',' + (k * .2) +
      ' L' + (-k) + ',' + (k * .55) + ' L' + (-k) + ',' + (-k * .55) + ' Z"/>';
  }

  function drips(x, y, w, depth, fill) {
    var d = "M" + x + "," + y + " h" + w + " v" + depth * .45;
    var n = Math.max(5, Math.round(w / 34)), step = w / n;
    for (var i = n; i > 0; i--) {
      var dd = depth * (i % 2 ? 1 : .55) * (i % 3 ? 1 : 1.25);
      d += " q" + (-step * .25) + "," + dd + " " + (-step * .5) + "," + 0 + " q" + (-step * .25) + "," + (-dd * .5) + " " + (-step * .5) + "," + 0;
    }
    return '<path fill="' + fill + '" d="' + d + ' Z"/>';
  }

  function cakeSVG(label) {
    var cakeText = String(get(C, "opener.cakeText", "") || "").toUpperCase();
    var candles = "", flames = "", smokes = "", n = 7;
    for (var i = 0; i < n; i++) {
      var cx = 122 + i * 26;
      var stripe = i % 2 ? "#8FC895" : "#99ADC5";
      candles += '<rect x="' + (cx - 5) + '" y="76" width="10" height="48" rx="2" fill="#FBF8F1"/>' +
        '<path d="M' + (cx - 5) + ',84 l10,-6 v8 l-10,6z M' + (cx - 5) + ',100 l10,-6 v8 l-10,6z M' + (cx - 5) + ',116 l10,-6 v7 l-10,6z" fill="' + stripe + '"/>' +
        '<line x1="' + cx + '" y1="76" x2="' + cx + '" y2="70" stroke="#25282A" stroke-width="1.6"/>';
      flames += '<g class="flame" data-i="' + i + '"><circle class="glow" cx="' + cx + '" cy="58" r="17" fill="url(#glow)"/>' +
        '<path class="fl" d="M' + cx + ',44 C' + (cx + 8) + ',54 ' + (cx + 8) + ',63 ' + cx + ',69 C' + (cx - 8) + ',63 ' + (cx - 8) + ',54 ' + cx + ',44Z" fill="#F9D635"/>' +
        '<path class="fl" d="M' + cx + ',53 C' + (cx + 4) + ',58 ' + (cx + 4) + ',63 ' + cx + ',67 C' + (cx - 4) + ',63 ' + (cx - 4) + ',58 ' + cx + ',53Z" fill="#FC924E"/></g>';
      smokes += '<circle class="smoke" cx="' + cx + '" cy="62" r="5" fill="#d9d6cf" style="animation-delay:' + (i * 60) + 'ms"/>';
    }
    var dots = "";
    for (var j = 0; j < 14; j++) dots += '<circle cx="' + (58 + j * 22) + '" cy="294" r="4" fill="#F9D635"/>';
    return '<svg viewBox="0 0 400 330" role="img" aria-label="A birthday cake with ' + n + ' lit candles">' +
      '<defs><radialGradient id="glow"><stop offset="0" stop-color="#F9D635" stop-opacity=".9"/><stop offset="1" stop-color="#F9D635" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse cx="200" cy="318" rx="196" ry="14" fill="rgba(0,0,0,.28)"/>' +
      '<ellipse cx="200" cy="310" rx="188" ry="13" fill="#FBF8F1"/>' +
      '<rect x="38" y="198" width="324" height="110" rx="8" fill="#E7805D"/>' +
      drips(38, 198, 324, 30, "#FBF8F1") + dots +
      (cakeText ? maltese(74, 262, 26, "#092A4D") + maltese(326, 262, 26, "#092A4D") : maltese(200, 258, 40, "#092A4D")) +
      '<text x="200" y="276" text-anchor="middle" font-family="Dharma Gothic E,Oswald,Arial Narrow,sans-serif" font-weight="800" font-size="40" fill="#FFFFFF" letter-spacing="1">' + esc(cakeText) + '</text>' +
      '<rect x="92" y="120" width="216" height="84" rx="8" fill="#F36079"/>' +
      drips(92, 120, 216, 24, "#FBF8F1") +
      '<text x="200" y="192" text-anchor="middle" font-family="Dharma Gothic E,Oswald,Arial Narrow,sans-serif" font-weight="800" font-size="54" fill="#FFFFFF">' + esc(label || "") + '</text>' +
      candles + smokes + flames +
      '<g class="gust" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".95">' +
      '<path d="M-40,110 C60,40 160,90 260,52 S400,40 450,30"/><path d="M-40,140 C70,80 170,120 280,78 S410,70 460,60"/><path d="M-30,80 C80,20 190,60 300,30 S420,20 470,10"/></g>' +
      '</svg>';
  }

  /* ---------------- data ---------------- */
  function sampleData() {
    return {
      total: 1858, states: 50, updated: null,
      signers: ["Ada L.", "Marcus T.", "Elena R.", "Sam K.", "Priya N.", "Walt H.", "June B.", "Tomas G.", "Nora W.", "Ike P.", "Grace O.", "Luis M."],
      featured: [
        { id: "s1", name: "Sample S.", place: "Medora, ND", message: "Sample wish: that every kid gets a chance to see a sunrise over the Badlands." },
        { id: "s2", name: "Preview P.", place: "Oyster Bay, NY", message: "Sample wish: more neighbors showing up for each other, and for the land we share." },
        { id: "s3", name: "Example E.", place: "Dallas, TX", message: "Sample wish: the courage to get in the arena, even when it is hard." }
      ],
      points: [[-103.52, 46.91, 40], [-73.53, 40.87, 22], [-96.8, 32.78, 18], [-122.33, 47.6, 9], [-87.63, 41.88, 14], [-104.99, 39.74, 11], [-77.04, 38.9, 25], [-100.78, 46.81, 30], [-96.79, 46.88, 19], [-118.24, 34.05, 8], [-84.39, 33.75, 6], [-71.06, 42.36, 12]]
    };
  }

  function loadJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status + " " + url); return r.json(); });
  }

  /* ---------------- render ---------------- */
  function render() {
    root.className = "sc theme-" + get(C, "theme", "night-sky");
    opened = false;
    var type = get(C, "opener.type", "cake");
    var already = !PREVIEW && store("signcard:" + C.id);
    var html = "";
    if (type !== "none" && !STARTER && !already) html += openerHTML(type);
    html += cardHTML();
    html += '<section class="rv" id="sc-reveal" hidden></section>';
    html += '<footer class="foot">Theodore Roosevelt Presidential Library · Medora, North Dakota · <a href="https://www.trlibrary.com" target="_blank" rel="noopener">trlibrary.com</a>' +
      (get(C, "opener.type") === "cake" ? '<br>Photographs: Theodore Roosevelt, 1885, Library of Congress. Badlands: National Park Service.' : "") + "</footer>";
    root.innerHTML = html;
    wireCard();
    if (already) { me = already; showSigned(true); showReveal(true); return; }
    if (STARTER || isClosed()) { openCard(true); }
    if (isClosed()) showReveal(false);
    if (type === "cake" && $(".op")) startCake();
    if (type === "video" && $(".op")) startVideo();
  }

  function openerHTML(type) {
    if (type === "video") {
      var src = get(C, "opener.video", "");
      return '<section class="op-wrap"><div class="op op-isvideo" style="aspect-ratio:16/9">' +
        (src ? '<video class="op-video" src="' + esc(src) + '" poster="' + esc(get(C, "opener.poster", "")) + '" playsinline muted autoplay preload="auto"></video>' : '<div class="op-video" style="display:grid;place-items:center;color:#fff">Add a video link in the builder.</div>') +
        '<button class="op-skip" type="button" data-unmute style="right:auto;left:12px">Sound on</button>' +
        '<button class="op-skip" type="button" data-skip>Skip</button></div></section>';
    }
    var bg = get(C, "opener.background", "");
    var head = esc(get(C, "opener.headline", "Happy birthday!"));
    // Last word of the headline in the accent color, e.g. "Happy birthday, TR!"
    head = head.replace(/(\S+)$/, '<span class="acc">$1</span>');
    return '<section class="op-wrap" aria-label="' + esc(get(C, "opener.headline", "")) + '">' +
      '<div class="op">' +
      '<div class="op-bg" role="img" aria-label="' + esc(get(C, "opener.backgroundAlt", "")) + '"' + (bg ? ' style="background-image:url(\'' + esc(asset(bg)) + '\')"' : "") + "></div>" +
      '<div class="op-shade"></div>' +
      '<div class="op-tr"><img src="' + esc(asset(get(C, "opener.photo", ""))) + '" alt="' + esc(get(C, "opener.photoAlt", "")) + '"></div>' +
      '<div class="op-cake" role="button" tabindex="0" aria-label="' + esc(get(C, "opener.blowButton", "Blow out the candles")) + '">' + cakeSVG(get(C, "opener.candles", "")) + "</div>" +
      '<canvas class="op-confetti" aria-hidden="true"></canvas>' +
      '<button class="op-skip" type="button" data-skip>Skip</button>' +
      "</div>" +
      '<div class="op-copy">' +
      '<img class="mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library">' +
      '<p class="kicker">' + esc(get(C, "opener.kicker", "")) + "</p>" +
      '<h1 class="dh">' + head + "</h1>" +
      '<div class="op-ask"><p>' + esc(get(C, "opener.wishPrompt", "")) + " " + esc(get(C, "opener.blowHint", "")) + "</p>" +
      '<div class="row"><button class="btn" type="button" data-blow>' + esc(get(C, "opener.blowButton", "Blow out the candles")) + "</button>" +
      '<button class="mic" type="button" data-mic><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg><span>Use my mic</span></button><span class="mic-meter"><i></i></span></div>' +
      "</div></div></section>";
  }

  function coverHTML() {
    return '<div class="face cover" role="button" tabindex="0" aria-label="' + esc(get(C, "card.openButton", "Open the card")) + '">' +
      '<div class="cover-num" aria-hidden="true">' + esc(get(C, "opener.candles", "")) + "</div>" +
      (get(C, "opener.photo") ? '<img class="cover-tr" src="' + esc(asset(get(C, "opener.photo"))) + '" alt="">' : "") +
      '<h2 class="dh cover-title">' + esc(get(C, "card.coverTitle", "")) + "</h2>" +
      '<div class="cover-band"><img class="cover-mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library"><span>' + esc(get(C, "opener.kicker", "")) + "</span></div>" +
      '<span class="cover-hint">Tap to open</span></div>';
  }

  function cardHTML() {
    var total = D.total || 0;
    return '<section class="cs" id="sc-card">' +
      '<div class="cs-invite"><h2 class="dh">' + esc(get(C, "card.inviteTitle", "")) + "</h2>" +
      "<p>" + esc(get(C, "card.inviteBody", "")) + "</p>" +
      '<button class="btn alt" type="button" data-open>' + esc(get(C, "card.openButton", "Open the card")) + "</button>" +
      (total > 0 ? '<div class="meta"><span class="count">' + num(total) + "</span> " + (total === 1 ? "person has" : "people have") + " signed</div>" : "") +
      "</div>" +
      '<div class="card3d"><div class="card3d-in">' + coverHTML() +
      '<div class="face inside"><div class="inside-pad">' +
      '<p class="greet">' + esc(get(C, "card.greeting", "")) + "</p>" +
      (get(C, "card.greetingSub") ? '<p class="greet-sub">' + esc(C.card.greetingSub) + "</p>" : "") +
      '<div class="sigs" aria-label="Signatures">' + sigsHTML() + "</div>" +
      '<div class="sign-area">' + (isClosed() ? closedHTML() : formHTML()) + "</div>" +
      "</div></div></div></div></section>";
  }

  function sigsHTML() {
    var names = (D.signers || []).slice(0, 24);
    if (!names.length) return '<span class="empty">Be one of the first to sign.</span>';
    var out = names.map(function (n, i) {
      var h = hash(n + i);
      return '<span class="sig" style="--c:' + INKS[h % INKS.length] + ";--r:" + ((h % 9) - 4) + "deg;animation-delay:" + (i * 40) + 'ms">' + esc(n) + "</span>";
    }).join("");
    var more = (D.total || 0) - names.length;
    if (more > 0) out += '<span class="more">and ' + num(more) + " more</span>";
    return out;
  }

  function closedHTML() {
    return '<div class="closed"><p class="dh">' + esc(get(C, "card.closedTitle", "")) + '</p><p class="greet-sub">' + esc(get(C, "card.closedBody", "")) + "</p></div>";
  }

  function formHTML() {
    var max = +get(C, "card.messageMax", 280);
    var showMsg = get(C, "card.showMessage", true) !== false;
    var msgReq = !!get(C, "card.messageRequired", false);
    return '<form class="form" novalidate>' +
      '<div class="preview-sig" aria-hidden="true"></div>' +
      '<div class="two">' + fld("first", "First name", "text", "given-name", true) + fld("last", "Last name", "text", "family-name", true) + "</div>" +
      '<div class="two">' + fld("email", "Email", "email", "email", true) + fld("zip", "ZIP code", "text", "postal-code", true, 'inputmode="numeric" maxlength="5" pattern="[0-9]{5}"') + "</div>" +
      (showMsg ? '<div class="fld" data-f="message"><label for="f-message">' + esc(get(C, "card.messageLabel", "Message")) + (msgReq ? "" : ' <span class="opt">(optional)</span>') + '<span class="ctr">0/' + max + "</span></label>" +
        '<textarea id="f-message" name="message" maxlength="' + max + '" placeholder="' + esc(get(C, "card.messagePlaceholder", "")) + '"' + (msgReq ? " required" : "") + "></textarea><div class=\"msg\"></div></div>" : "") +
      '<label class="check"><input type="checkbox" name="optIn"' + (get(C, "card.optInDefault", true) ? " checked" : "") + "><span>" + esc(get(C, "card.optInLabel", "")) + "</span></label>" +
      '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="fine">' + esc(get(C, "card.privacyNote", "")) + "</p>" +
      '<div class="form-err" hidden></div>' +
      '<button class="btn" type="submit">' + esc(get(C, "card.submitLabel", "Sign")) + "</button>" +
      '<p class="peek"><button type="button" class="link" data-peek>Just reading? See the wishes first</button></p>' +
      "</form>";
  }
  function fld(name, label, type, ac, req, extra) {
    return '<div class="fld" data-f="' + name + '"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" type="' + type + '" autocomplete="' + ac + '"' + (req ? " required" : "") + " " + (extra || "") + '><div class="msg"></div></div>';
  }

  /* ---------------- opener: cake ---------------- */
  var blown = false, micStop = null;
  function startCake() {
    blown = false;
    var op = $(".op"), wrap = $(".op-wrap");
    var img = $(".op-tr img");
    var go = function () {
      requestAnimationFrame(function () { op.classList.add("go"); wrap.classList.add("go"); });
      var flames = $$(".flame", op);
      flames.forEach(function (f, i) { setTimeout(function () { f.classList.add("lit"); }, REDUCED ? 0 : 2100 + i * 120); });
      setTimeout(function () { wrap.classList.add("ready"); }, REDUCED ? 0 : 2100 + flames.length * 120 + 150);
    };
    var started = false;
    var once = function () { if (!started) { started = true; go(); } };
    if (img && !img.complete) { img.addEventListener("load", once); img.addEventListener("error", once); setTimeout(once, 1500); } else once();
    $(".op-cake").addEventListener("click", blow);
    $(".op-cake").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); blow(); } });
    $("[data-blow]").addEventListener("click", blow);
    $("[data-mic]").addEventListener("click", startMic);
    $$("[data-skip]").forEach(function (b) { b.addEventListener("click", function () { blow(true); }); });
  }

  function blow(skip) {
    if (blown) return;
    var op = $(".op");
    if (!$$(".flame.lit", op).length && skip !== true) {
      // candles not lit yet: light them all now, then blow
      $$(".flame", op).forEach(function (f) { f.classList.add("lit"); });
      $(".op-wrap").classList.add("ready");
    }
    blown = true;
    if (micStop) micStop();
    op.classList.add("blowing");
    $$(".flame", op).forEach(function (f, i) { setTimeout(function () { f.classList.add("out"); }, 120 + i * 45); });
    setTimeout(function () {
      op.classList.add("blown");
      confetti($(".op-confetti"), { x: 0.68, y: 0.6, count: 110 });
      var h = $(".op-copy h1"), p = $(".op-ask p"), b = $("[data-blow]"), m = $("[data-mic]"), mm = $(".mic-meter");
      if (h) h.innerHTML = esc(get(C, "opener.doneHeadline", "Wish made!")).replace(/(\S+)$/, '<span class="acc">$1</span>');
      if (p) p.textContent = get(C, "opener.nextPrompt", "Now sign his card.") + " " + get(C, "card.inviteBody", "");
      if (m) m.remove(); if (mm) mm.remove();
      if (b) { var nb = b.cloneNode(false); nb.textContent = get(C, "card.inviteTitle", "Sign the card"); nb.className = "btn alt"; b.replaceWith(nb);
        nb.addEventListener("click", function () { scrollToEl($("#sc-card")); openCard(false); }); }
    }, 450);
    setTimeout(function () { scrollToEl($("#sc-card")); pulseCover(); }, skip === true ? 500 : 2600);
  }

  function pulseCover() {
    var cv = $(".cover");
    if (!cv || opened) return;
    cv.animate && cv.animate([{ transform: "rotate(0) scale(1)" }, { transform: "rotate(-3deg) scale(1.04)" }, { transform: "rotate(2deg) scale(1.02)" }, { transform: "rotate(0) scale(1)" }], { duration: 900, delay: 500, easing: "ease-in-out" });
  }

  function startMic() {
    var btn = $("[data-mic]"), meter = $(".mic-meter i");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { btn.textContent = "Mic not available. Tap the cake instead."; return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      btn.classList.add("on"); btn.lastChild.textContent = "Listening… blow!";
      var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
      var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      var buf = new Float32Array(an.fftSize), loud = 0, alive = true;
      micStop = function () { alive = false; stream.getTracks().forEach(function (t) { t.stop(); }); try { ctx.close(); } catch (e) {} btn.classList.remove("on"); };
      (function tick() {
        if (!alive) return;
        an.getFloatTimeDomainData(buf);
        var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        var rms = Math.sqrt(s / buf.length);
        meter.style.width = Math.min(100, rms * 400) + "%";
        loud = rms > 0.12 ? loud + 1 : Math.max(0, loud - 1);
        if (loud > 8) { blow(); return; }
        requestAnimationFrame(tick);
      })();
    }).catch(function () { btn.lastChild.textContent = "No mic access. Tap the cake instead."; });
  }

  function confetti(canvas, opts) {
    if (!canvas || REDUCED) return;
    opts = opts || {};
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    var ox = (opts.x != null ? opts.x : 0.36) * w, oy = (opts.y != null ? opts.y : 0.72) * h;
    var ps = [];
    for (var i = 0; i < (opts.count || 180); i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 6 + Math.random() * 11;
      ps.push({ x: ox, y: oy, vx: Math.cos(a) * v * (w / 900 + .4), vy: Math.sin(a) * v * (h / 560 + .4), r: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
        s: 5 + Math.random() * 8, c: BRAND[i % BRAND.length], shape: i % 3 });
    }
    var t0 = performance.now();
    (function frame(t) {
      var el = t - t0;
      ctx.clearRect(0, 0, w, h);
      ps.forEach(function (p) {
        p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - el / 3600);
        if (p.shape === 0) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, 6.28); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(0, -p.s / 2); ctx.lineTo(p.s / 2, p.s / 2); ctx.lineTo(-p.s / 2, p.s / 2); ctx.fill(); }
        ctx.restore();
      });
      if (el < 3600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, h);
    })(t0);
  }

  /* ---------------- opener: video ---------------- */
  function startVideo() {
    var v = $(".op-video"), done = false;
    var finish = function () { if (done) return; done = true; if (v.pause) v.pause(); scrollToEl($("#sc-card")); pulseCover(); };
    if (v && v.tagName === "VIDEO") { v.addEventListener("ended", finish); v.play && v.play().catch(function () {}); }
    $("[data-skip]").addEventListener("click", finish);
    var um = $("[data-unmute]");
    um.addEventListener("click", function () { if (v.tagName === "VIDEO") { v.muted = !v.muted; um.textContent = v.muted ? "Sound on" : "Sound off"; if (v.paused) v.play(); } });
  }

  /* ---------------- card ---------------- */
  function wireCard() {
    var cover = $(".cover");
    var open = function () { openCard(false); };
    $$("[data-open]").forEach(function (b) { b.addEventListener("click", open); });
    if (cover) {
      cover.addEventListener("click", open);
      cover.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    }
    var form = $(".form");
    if (!form) return;
    form._t0 = Date.now();
    var prev = $(".preview-sig", form);
    var upd = function () { prev.textContent = displayName(form.first.value, form.last.value) ? (form.first.value.trim() + " " + form.last.value.trim()).trim() : ""; };
    form.first.addEventListener("input", upd); form.last.addEventListener("input", upd);
    form.zip.addEventListener("input", function () { form.zip.value = form.zip.value.replace(/\D/g, "").slice(0, 5); });
    if (form.message) {
      var ctr = $("[data-f=message] .ctr", form), max = form.message.maxLength;
      form.message.addEventListener("input", function () { ctr.textContent = form.message.value.length + "/" + max; });
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(form); });
    $("[data-peek]", form).addEventListener("click", function () { showReveal(false); scrollToEl($("#sc-reveal")); });
  }

  function openCard(instant) {
    if (opened) return;
    opened = true;
    var cs = $("#sc-card"), c3 = $(".card3d");
    cs.classList.add("is-open");
    if (instant || REDUCED) { c3.classList.add("is-flat"); return; }
    c3.classList.add("is-flipping");
    setTimeout(function () {
      c3.classList.add("is-flat"); c3.classList.remove("is-flipping");
      var f = $("#f-first"); if (f) f.focus({ preventScroll: true });
      scrollToEl(cs);
    }, 1150);
  }

  function setErr(form, name, msg) {
    var f = $("[data-f=" + name + "]", form);
    if (!f) return;
    f.classList.toggle("err", !!msg);
    $(".msg", f).textContent = msg || "";
  }

  function validate(form) {
    var ok = true, v = function (n) { return (form[n] && form[n].value || "").trim(); };
    var checks = {
      first: v("first") ? "" : "Please add your first name.",
      last: v("last") ? "" : "Please add your last name.",
      email: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v("email")) ? "" : "Please check your email address.",
      zip: /^\d{5}$/.test(v("zip")) ? "" : "Please enter a 5-digit ZIP code."
    };
    if (form.message && form.message.required) checks.message = v("message") ? "" : "Please share a few words.";
    Object.keys(checks).forEach(function (k) { setErr(form, k, checks[k]); if (checks[k]) { if (ok) form[k].focus(); ok = false; } });
    return ok;
  }

  function sha256(s) {
    if (!(window.crypto && crypto.subtle)) return Promise.resolve(hash(s).toString(16).padStart(8, "0").repeat(8));
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    });
  }

  function save(rec) {
    var fb = CFG.firebase || {};
    if (PREVIEW || !fb.projectId || !fb.apiKey) {
      if (!PREVIEW) console.warn("SignCard: Firebase is not set up in assets/js/config.js, so nothing was saved (demo mode).");
      return wait(700).then(function () { return "demo"; });
    }
    return sha256(rec.campaign + "|" + rec.email.toLowerCase()).then(function (id) {
      var f = {
        campaign: { stringValue: rec.campaign }, first: { stringValue: rec.first }, last: { stringValue: rec.last },
        email: { stringValue: rec.email }, zip: { stringValue: rec.zip }, optIn: { booleanValue: rec.optIn },
        status: { stringValue: "new" }, source: { stringValue: rec.source }, v: { integerValue: "1" }
      };
      if (rec.message) f.message = { stringValue: rec.message };
      var url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(fb.projectId) +
        "/databases/(default)/documents/signatures?documentId=" + id + "&key=" + encodeURIComponent(fb.apiKey);
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: f }) })
        .then(function (r) {
          if (r.ok) return "saved";
          if (r.status === 409) return "already";
          return r.text().then(function (t) { throw new Error("Save failed (" + r.status + ") " + t.slice(0, 200)); });
        });
    });
  }

  function submit(form) {
    var errBox = $(".form-err", form), btn = $("button[type=submit]", form);
    errBox.hidden = true;
    if (!validate(form)) return;
    var rec = {
      campaign: C.id,
      first: form.first.value.trim().slice(0, 60), last: form.last.value.trim().slice(0, 60),
      email: form.email.value.trim().slice(0, 254), zip: form.zip.value.trim(),
      message: form.message ? form.message.value.trim().slice(0, form.message.maxLength) : "",
      optIn: !!form.optIn.checked,
      source: (EMBED ? "embed:" + (document.referrer ? new URL(document.referrer).hostname : "unknown") : "site") + (STARTER ? ":starter" : "")
    };
    var bot = form.website.value || Date.now() - form._t0 < 2500;
    btn.disabled = true; btn.textContent = "Signing…";
    (bot ? wait(800).then(function () { return "skipped"; }) : save(rec)).then(function (result) {
      me = { name: displayName(rec.first, rec.last), full: rec.first + " " + rec.last, first: rec.first, message: rec.message, at: Date.now(), result: result };
      if (!PREVIEW) store("signcard:" + C.id, me);
      showSigned(false);
      post({ type: "signcard:signed", campaign: C.id });
      return wait(3000).then(function () { showReveal(true); scrollToEl($("#sc-reveal")); });
    }).catch(function (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = get(C, "card.submitLabel", "Sign");
      errBox.hidden = false;
      errBox.textContent = "Something went wrong and your signature wasn't saved. Please try again in a moment.";
    });
  }

  function showSigned(instant) {
    if (!opened) openCard(true);
    var area = $(".sign-area");
    var html = '<div class="mine">' +
      '<span class="sig-mine">' + esc(me.full || me.name) + "</span>" +
      (me.message ? '<p class="wish">' + esc(me.message) + "</p>" : "") +
      '<span class="stampd">' + sealSVG("#E7805D", "#FFFFFF", "✓", "SIGNED") + "</span></div>";
    area.innerHTML = html;
    var em = $(".sigs .empty"); if (em) em.textContent = "You're one of the first to sign!";
    if (instant) $$(".sig-mine,.wish,.stampd", area).forEach(function (e) { e.style.animation = "none"; e.style.clipPath = "none"; e.style.opacity = 1; e.style.transform = "rotate(-12deg)"; });
    $(".stampd", area).style.transform = instant ? "rotate(-12deg)" : "";
  }

  /* ---------------- reveal ---------------- */
  var deckTimer = null;
  function showReveal(personal) {
    var rv = $("#sc-reveal");
    var total = (D.total || 0) + (me && personal ? 1 : 0);
    var html = "";
    if (personal && me) {
      html += '<div class="rv-sec rv-head"><h2 class="dh">' + esc(get(C, "card.signedTitle", "You're on the card")) + ", " + esc(me.first || "") + "!</h2>" +
        "<p>" + esc(get(C, "card.signedBody", "")) + "</p>" + tallyHTML(total) + "</div>";
    } else if (!rv.hidden && rv.innerHTML) {
      return;
    } else {
      html += '<div class="rv-sec rv-head">' + tallyHTML(total) + "</div>";
    }
    if (get(C, "wall.show", true) !== false) html += '<div class="rv-sec"><h2 class="dh sec-title">' + esc(get(C, "wall.title", "")) + '</h2><div class="deck"></div><div class="deck-nav"></div></div>';
    if (get(C, "map.show", true) !== false) html += '<div class="rv-sec"><h2 class="dh sec-title">' + esc(get(C, "map.title", "")) + '</h2><div class="mapwrap"></div></div>';
    if (get(C, "cta.url")) html += '<div class="rv-sec" style="border:0">' + ctaHTML() + "</div>";
    html += '<div class="rv-sec share"><h2 class="dh sec-title">' + esc(get(C, "share.title", "Share")) + "</h2>" +
      '<div class="row"><button class="btn alt" type="button" data-share>Share the card</button>' +
      (me && personal ? '<button class="btn ghost" type="button" data-download>Save my card</button>' : "") +
      (!me ? '<button class="btn" type="button" data-backsign>Sign the card</button>' : "") +
      '</div><p class="note" aria-live="polite"></p></div>';
    rv.innerHTML = html;
    rv.hidden = false;
    buildDeck();
    buildMap();
    var sb = $("[data-share]", rv); if (sb) sb.addEventListener("click", share);
    var db = $("[data-download]", rv); if (db) db.addEventListener("click", download);
    var bs = $("[data-backsign]", rv); if (bs) bs.addEventListener("click", function () { openCard(false); scrollToEl($("#sc-card")); });
    $$(".tally b", rv).forEach(countUp);
  }

  function tallyHTML(total) {
    var st = D.states || 0;
    return '<div class="tally"><div><b data-n="' + total + '">0</b><span>' + (total === 1 ? "signature" : "signatures") + "</span></div>" +
      (st ? '<div><b data-n="' + st + '">0</b><span>' + (st === 1 ? "state" : "states") + "</span></div>" : "") + "</div>";
  }

  function countUp(el) {
    var n = +el.getAttribute("data-n"), t0 = performance.now(), dur = REDUCED ? 1 : 1400;
    (function f(t) { var p = Math.min(1, (t - t0) / dur); el.textContent = num(Math.round(n * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(f); })(t0);
  }

  var PAIRS = [
    ["#F9D635", "#092A4D", "#E7805D"], ["#FBF8F1", "#25282A", "#E7805D"], ["#1B4532", "#FFFFFF", "#87BB41"],
    ["#E7805D", "#FFFFFF", "#092A4D"], ["#F36079", "#FFFFFF", "#F9D635"], ["#99ADC5", "#092A4D", "#FFFFFF"]
  ];
  function buildDeck() {
    var deck = $(".deck"), nav = $(".deck-nav");
    if (!deck) return;
    var items = (D.featured || []).slice(0, +get(C, "wall.count", 12));
    if (me && me.message) items = [{ id: "me", name: me.name + " (you)", place: "", message: me.message }].concat(items);
    if (!items.length) { deck.outerHTML = '<p class="deck-empty">The first wishes are on their way. Check back soon to read them.</p>'; nav.remove(); return; }
    deck.innerHTML = items.map(function (it, i) {
      var p = PAIRS[i % PAIRS.length];
      return '<figure class="qcard" style="background:' + p[0] + ";color:" + p[1] + ";--qa:" + p[2] + '"><blockquote class="q">' + esc(it.message) + "</blockquote>" +
        '<figcaption class="who"><span class="n">' + esc(it.name) + '</span><span class="p">' + esc(it.place || "") + "</span></figcaption></figure>";
    }).join("");
    var cards = $$(".qcard", deck), top = 0;
    nav.innerHTML = '<button type="button" aria-label="Previous wish" data-prev>‹</button><span></span><button type="button" aria-label="Next wish" data-next>›</button>';
    function lay() {
      cards.forEach(function (c, i) {
        var k = (i - top + cards.length) % cards.length;
        var h = hash(String(i));
        c.style.zIndex = cards.length - k;
        c.style.transform = k === 0 ? "rotate(0deg)" : "translate(" + (k * 6) + "px," + (k * 7) + "px) rotate(" + ((h % 7) - 3) + "deg) scale(" + (1 - k * .03) + ")";
        c.style.opacity = k > 3 ? 0 : 1;
        c.setAttribute("aria-hidden", k === 0 ? "false" : "true");
      });
      $("span", nav).textContent = (top + 1) + " / " + cards.length;
    }
    function next(dir) {
      var cur = cards[top];
      if (dir > 0 && !REDUCED) {
        cur.classList.add("fly");
        setTimeout(function () { cur.classList.remove("fly"); }, 420);
      }
      top = (top + dir + cards.length) % cards.length;
      setTimeout(lay, dir > 0 && !REDUCED ? 220 : 0);
    }
    lay();
    cards.forEach(function (c) { c.addEventListener("click", function () { next(1); restart(); }); });
    $("[data-next]", nav).addEventListener("click", function () { next(1); restart(); });
    $("[data-prev]", nav).addEventListener("click", function () { next(-1); restart(); });
    function restart() { clearInterval(deckTimer); if (!REDUCED && cards.length > 1) deckTimer = setInterval(function () { next(1); }, 5200); }
    restart();
  }

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  var geoReady = null;
  function geo() {
    if (!geoReady) geoReady = loadScript("https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js")
      .then(function () { return loadScript("https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/dist/d3-geo.min.js"); })
      .then(function () { return loadScript("https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"); })
      .then(function () { return loadJSON("assets/data/us-states.json"); });
    return geoReady;
  }

  function buildMap() {
    var wrap = $(".mapwrap");
    if (!wrap) return;
    var min = +get(C, "map.minimum", 0);
    if ((D.total || 0) < min) {
      wrap.innerHTML = '<p class="map-note">The map lights up once ' + num(min) + " people have signed. It updates every few minutes.</p>";
      return;
    }
    geo().then(function (us) {
      var W = 960, H = 600;
      var proj = d3.geoAlbersUsa().scale(1250).translate([W / 2, H / 2]);
      var path = d3.geoPath(proj);
      var states = topojson.feature(us, us.objects.states).features;
      var pts = (D.points || []).map(function (p) { var xy = proj([p[0], p[1]]); return xy ? { x: xy[0], y: xy[1], n: p[2] } : null; }).filter(Boolean);
      pts.sort(function (a, b) { return a.x - b.x; });
      var maxN = pts.reduce(function (m, p) { return Math.max(m, p.n); }, 1);
      var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Map of where people signed from">' +
        states.map(function (s) { var d = path(s); return d ? '<path class="st" d="' + d + '"/>' : ""; }).join("") +
        pts.map(function (p, i) {
          var r = 3 + 11 * Math.sqrt(p.n / maxN), delay = REDUCED ? 0 : Math.min(2400, i * 18);
          return (p.n === maxN ? '<circle class="ring" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>' : "") +
            '<circle class="dot' + (i % 5 === 0 ? " hot" : "") + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" style="animation-delay:' + delay + 'ms"><title>' + num(p.n) + " signed nearby</title></circle>";
        }).join("") + "</svg>";
      wrap.innerHTML = svg + '<p class="map-legend">Each dot is a ZIP code. Bigger dots, more signatures.</p>';
    }).catch(function (e) { console.warn(e); wrap.innerHTML = '<p class="map-note">The map could not load right now.</p>'; });
  }

  function ctaUrl() {
    var u = get(C, "cta.url", "");
    try {
      var url = new URL(u);
      [["utm_source", "cta.utmSource"], ["utm_medium", "cta.utmMedium"], ["utm_campaign", "cta.utmCampaign"]].forEach(function (p) {
        var v = get(C, p[1], ""); if (v && !url.searchParams.has(p[0])) url.searchParams.set(p[0], v);
      });
      return url.toString();
    } catch (e) { return u; }
  }
  function ctaHTML() {
    return '<div class="cta"><span class="bigmark" aria-hidden="true">TR</span><div><h2 class="dh">' + esc(get(C, "cta.title", "")) + "</h2><p>" + esc(get(C, "cta.body", "")) + "</p></div>" +
      '<a class="btn" href="' + esc(ctaUrl()) + '" target="_blank" rel="noopener">' + esc(get(C, "cta.button", "Learn more")) + "</a></div>";
  }

  function shareUrl() { return get(C, "share.url", "") || (CFG.siteUrl || location.origin + "/") + "?c=" + encodeURIComponent(C.id); }
  function share() {
    var note = $(".share .note"), url = shareUrl(), text = get(C, "share.text", "");
    if (navigator.share) { navigator.share({ title: get(C, "card.inviteTitle", ""), text: text, url: url }).catch(function () {}); return; }
    var done = function () { note.textContent = "Link copied. Paste it anywhere to pass the card along."; };
    if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(done, function () { note.textContent = url; });
    else note.textContent = url;
  }

  /* ---------------- shareable image ---------------- */
  function img(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; }); }
  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    var words = text.split(/\s+/), line = "", lines = [];
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…"); }
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lh); });
    return lines.length;
  }
  function download() {
    var note = $(".share .note");
    note.textContent = "Making your card…";
    var fonts = ['800 100px "Dharma Gothic E"', '400 40px "Clearface"', 'italic 400 40px "Clearface"', '400 80px "Mrs Saint Delafield"', '700 20px "Frutiger"'];
    Promise.all(fonts.map(function (f) { return document.fonts ? document.fonts.load(f) : null; }))
      .then(function () { return Promise.all([img(asset(get(C, "opener.photo", ""))).catch(function () { return null; }), img("assets/img/trpl-wordmark-white.svg").catch(function () { return null; })]); })
      .then(function (ims) {
        var W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var x = cv.getContext("2d");
        x.fillStyle = "#E7805D"; x.fillRect(0, 0, W, H);
        x.fillStyle = "#F9D635"; x.font = '800 560px "Dharma Gothic E", Arial Narrow, sans-serif'; x.textAlign = "center"; x.textBaseline = "alphabetic";
        x.fillText(get(C, "opener.candles", ""), W / 2, 640);
        if (ims[0]) { var tw = 820, th = tw * ims[0].height / ims[0].width; x.drawImage(ims[0], (W - tw) / 2, 690 - th, tw, th); }
        x.fillStyle = "#FFFFFF"; x.font = '800 104px "Dharma Gothic E", Arial Narrow, sans-serif'; x.textAlign = "left";
        x.fillText("I SIGNED TR'S", 64, 140); x.fillText("BIRTHDAY CARD", 64, 236);
        x.fillStyle = "#FBF8F1"; x.fillRect(48, 690, W - 96, 560);
        x.fillStyle = "#092A4D"; x.textAlign = "center"; x.font = '400 120px "Mrs Saint Delafield", cursive';
        x.fillText(me.full || me.name, W / 2, 850);
        x.fillStyle = "#3d3a33"; x.font = 'italic 400 38px "Clearface", Georgia, serif';
        var used = me.message ? wrapText(x, "“" + me.message + "”", W / 2, 940, W - 200, 50, 5) : 0;
        x.fillStyle = "#6b665b"; x.font = '700 24px "Frutiger", Arial, sans-serif';
        x.fillText("ADD YOUR NAME · " + shareUrl().replace(/^https?:\/\//, "").replace(/\/$/, "").toUpperCase(), W / 2, 1210);
        x.fillStyle = "#092A4D"; x.fillRect(0, H - 64, W, 64);
        if (ims[1]) { var mw = 200, mh = mw * (ims[1].height || 60) / (ims[1].width || 200); x.drawImage(ims[1], 64, H - 32 - mh / 2, mw, mh); }
        x.fillStyle = "#F9D635"; x.font = '700 22px "Frutiger", Arial, sans-serif'; x.textAlign = "right";
        x.fillText("TRLIBRARY.COM", W - 64, H - 24);
        cv.toBlob(function (blob) {
          var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tr-birthday-card.png";
          document.body.appendChild(a); a.click(); a.remove();
          note.textContent = "Saved. Post it and tag the Library.";
        }, "image/png");
      }).catch(function (e) { console.error(e); note.textContent = "Couldn't make the image on this device."; });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    if (PREVIEW) {
      window.addEventListener("message", function (e) {
        if (!e.data || e.data.type !== "signcard:config") return;
        C = e.data.config; D = sampleData(); me = null; blown = false;
        if (micStop) micStop();
        clearInterval(deckTimer);
        render();
        if (e.data.jump === "card") { openCard(true); var cs = $("#sc-card"); if (cs) window.scrollTo(0, cs.offsetTop); }
        if (e.data.jump === "reveal") { me = { name: "Jane D.", full: "Jane Doe", first: "Jane", message: "Sample wish: that every kid gets to see the Badlands." }; showSigned(true); showReveal(true); var rv = $("#sc-reveal"); if (rv) window.scrollTo(0, rv.offsetTop); }
        if (!e.data.jump || e.data.jump === "start") window.scrollTo(0, 0);
      });
      post({ type: "signcard:ready" });
      if (window.parent) window.parent.postMessage({ type: "signcard:ready" }, "*");
      return;
    }
    var id = qs.get("c");
    (id ? Promise.resolve(id) : loadJSON("campaigns/index.json").then(function (ix) { return ix["default"]; }))
      .then(function (cid) {
        if (!/^[a-z0-9-]{3,60}$/.test(cid)) throw new Error("Bad campaign id");
        return Promise.all([loadJSON("campaigns/" + cid + ".json"), loadJSON("data/" + cid + ".json?t=" + Math.floor(Date.now() / 60000)).catch(function () { return {}; })]);
      })
      .then(function (r) { C = r[0]; D = r[1] || {}; render(); })
      .catch(function (e) {
        console.error(e);
        root.innerHTML = '<div class="sc-loading"><p style="font-family:var(--serif);font-size:20px;text-align:center;padding:24px">This card could not be found.</p></div>';
      });
  }
  boot();
})();
