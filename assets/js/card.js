/*
 * SignCard player — card.labs.trlibrary.com
 *
 * One fixed-size stage. Each step replaces the last in place:
 *   opener (cake, video or none) -> card (closed, with the invitation; opens to sign) -> wishes -> map -> join
 * Desktop is 16:9 with a two-page card; tablets 4:3 and phones 9:16 use a single page.
 *
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
  var C = null, D = null, me = null, step = "", opened = false, blown = false, micStop = null, deckTimer = null, autoTimer = null;
  var BRAND = ["#F9D635", "#E7805D", "#F36079", "#8FC895", "#99ADC5", "#FC924E", "#FFFFFF", "#87BB41"];
  var INKS = ["#1d2b44", "#1B4532", "#7a3b22", "#092A4D", "#4b2a5e", "#25282A"];
  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var RESULTS = ["wishes", "map", "join"];

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
  function asset(u) { return u || ""; }
  function isClosed() {
    var c = get(C, "closes", "");
    return c ? new Date() > new Date(c + "T23:59:59-06:00") : false;
  }
  function displayName(first, last) {
    first = (first || "").trim(); last = (last || "").trim();
    return first + (last ? " " + last.charAt(0).toUpperCase() + "." : "");
  }
  function accentLast(s) { return esc(s).replace(/(\S+)$/, '<span class="acc">$1</span>'); }

  /* ---------------- embed messaging ---------------- */
  function post(msg) { if (EMBED && !PREVIEW && window.parent) { try { window.parent.postMessage(msg, "*"); } catch (e) {} } }
  if (EMBED && "ResizeObserver" in window) {
    new ResizeObserver(function () { post({ type: "signcard:height", height: Math.ceil(document.documentElement.scrollHeight) }); }).observe(document.body);
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
    var n = Math.max(5, Math.round(w / 34)), stp = w / n;
    for (var i = n; i > 0; i--) {
      var dd = depth * (i % 2 ? 1 : .55) * (i % 3 ? 1 : 1.25);
      d += " q" + (-stp * .25) + "," + dd + " " + (-stp * .5) + ",0 q" + (-stp * .25) + "," + (-dd * .5) + " " + (-stp * .5) + ",0";
    }
    return '<path fill="' + fill + '" d="' + d + ' Z"/>';
  }
  function cakeSVG(label) {
    var cakeText = String(get(C, "opener.cakeText", "") || "").toUpperCase();
    var candles = "", flames = "", smokes = "", n = 7;
    for (var i = 0; i < n; i++) {
      var cx = 122 + i * 26, stripe = i % 2 ? "#8FC895" : "#99ADC5";
      candles += '<rect x="' + (cx - 5) + '" y="76" width="10" height="48" rx="2" fill="#FBF8F1"/>' +
        '<path d="M' + (cx - 5) + ',84 l10,-6 v8 l-10,6z M' + (cx - 5) + ',100 l10,-6 v8 l-10,6z M' + (cx - 5) + ',116 l10,-6 v7 l-10,6z" fill="' + stripe + '"/>' +
        '<line x1="' + cx + '" y1="76" x2="' + cx + '" y2="70" stroke="#25282A" stroke-width="1.6"/>';
      flames += '<g class="flame"><circle class="glow" cx="' + cx + '" cy="58" r="17" fill="url(#glow)"/>' +
        '<path class="fl" d="M' + cx + ',44 C' + (cx + 8) + ',54 ' + (cx + 8) + ',63 ' + cx + ',69 C' + (cx - 8) + ',63 ' + (cx - 8) + ',54 ' + cx + ',44Z" fill="#F9D635"/>' +
        '<path class="fl" d="M' + cx + ',53 C' + (cx + 4) + ',58 ' + (cx + 4) + ',63 ' + cx + ',67 C' + (cx - 4) + ',63 ' + (cx - 4) + ',58 ' + cx + ',53Z" fill="#FC924E"/></g>';
      smokes += '<circle class="smoke" cx="' + cx + '" cy="62" r="5" fill="#d9d6cf" style="animation-delay:' + (i * 60) + 'ms"/>';
    }
    var dots = "";
    for (var j = 0; j < 14; j++) dots += '<circle cx="' + (58 + j * 22) + '" cy="294" r="4" fill="#F9D635"/>';
    return '<svg viewBox="0 0 400 330" role="img" aria-label="A birthday cake with ' + n + ' lit candles">' +
      '<defs><radialGradient id="glow"><stop offset="0" stop-color="#F9D635" stop-opacity=".9"/><stop offset="1" stop-color="#F9D635" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse cx="200" cy="318" rx="196" ry="14" fill="rgba(0,0,0,.28)"/><ellipse cx="200" cy="310" rx="188" ry="13" fill="#FBF8F1"/>' +
      '<rect x="38" y="198" width="324" height="110" rx="8" fill="#E7805D"/>' + drips(38, 198, 324, 30, "#FBF8F1") + dots +
      (cakeText ? maltese(74, 262, 26, "#092A4D") + maltese(326, 262, 26, "#092A4D") +
        '<text x="200" y="276" text-anchor="middle" font-family="Dharma Gothic E,Oswald,Arial Narrow,sans-serif" font-weight="800" font-size="40" fill="#FFFFFF" letter-spacing="1">' + esc(cakeText) + '</text>'
        : maltese(200, 258, 40, "#092A4D")) +
      '<rect x="92" y="120" width="216" height="84" rx="8" fill="#F36079"/>' + drips(92, 120, 216, 24, "#FBF8F1") +
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

  /* =========================================================
     RENDER
     ========================================================= */
  function render() {
    root.className = "sc theme-" + get(C, "theme", "night-sky");
    opened = false; blown = false; step = "";
    clearInterval(deckTimer); clearTimeout(autoTimer); clearTimeout(popTimer); popTimer = null; popShown = false;
    var type = get(C, "opener.type", "cake");
    root.innerHTML = '<div class="stage" aria-live="polite">' +
      (type !== "none" ? openerHTML(type) : "") +
      cardStepHTML() +
      '<section class="step s-wishes" data-step="wishes" aria-label="Wishes"></section>' +
      '<section class="step s-map" data-step="map" aria-label="Map"></section>' +
      '<section class="step s-join" data-step="join" aria-label="Join"></section>' +
      '<nav class="snav" aria-label="Card steps"></nav>' +
      "</div>";
    wireCard();
    var already = !PREVIEW && store("signcard:" + C.id);
    if (already) { me = already; showSigned(true); go("wishes"); return; }
    if (STARTER || type === "none" || isClosed()) { go("card"); if (STARTER && !isClosed()) openCard(true); return; }
    go("opener");
  }

  function go(name) {
    var steps = $$(".step", root), target = $('.step[data-step="' + name + '"]', root);
    if (!target) return;
    var order = steps.map(function (s) { return s.getAttribute("data-step"); });
    var from = order.indexOf(step), to = order.indexOf(name);
    steps.forEach(function (s, i) {
      s.classList.toggle("on", s === target);
      s.classList.toggle("before", i < to);
      s.setAttribute("aria-hidden", s === target ? "false" : "true");
      if ("inert" in s) s.inert = s !== target;
    });
    root.setAttribute("data-step", name);
    step = name;
    if (name !== "wishes") clearInterval(deckTimer);
    if (name === "opener") startOpener();
    if (name === "wishes") buildWishes();
    if (name === "map") buildMap();
    if (name === "join") buildJoin();
    if (RESULTS.indexOf(name) >= 0 && name !== "join") queueCtaPop();
    buildNav();
    if (from !== -1 && name !== "opener") { var h = $("h1, h2", target); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } }
  }

  /* ---------------- opener ---------------- */
  function openerHTML(type) {
    if (type === "video") {
      var src = get(C, "opener.video", "");
      return '<section class="step s-opener op" data-step="opener" aria-label="Opening">' +
        (src ? '<video class="op-video" src="' + esc(src) + '" poster="' + esc(get(C, "opener.poster", "")) + '" playsinline muted preload="auto"></video>'
          : '<div class="op-video op-novideo">Add a video link in the builder.</div>') +
        '<button class="op-skip" type="button" data-unmute style="right:auto;left:12px">Sound on</button>' +
        '<button class="op-skip" type="button" data-skip>Skip</button></section>';
    }
    var bg = get(C, "opener.background", "");
    return '<section class="step s-opener op" data-step="opener" aria-label="' + esc(get(C, "opener.headline", "Opening")) + '">' +
      '<div class="op-bg" role="img" aria-label="' + esc(get(C, "opener.backgroundAlt", "")) + '"' + (bg ? ' style="background-image:url(\'' + esc(asset(bg)) + '\')"' : "") + "></div>" +
      '<div class="op-shade"></div>' +
      '<div class="op-tr"><img src="' + esc(asset(get(C, "opener.photo", ""))) + '" alt="' + esc(get(C, "opener.photoAlt", "")) + '"></div>' +
      '<div class="op-cake" role="button" tabindex="0" aria-label="' + esc(get(C, "opener.blowButton", "Blow out the candles")) + '">' + cakeSVG(get(C, "opener.candles", "")) + "</div>" +
      '<canvas class="op-confetti" aria-hidden="true"></canvas>' +
      '<div class="op-copy">' +
      '<img class="mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library">' +
      '<p class="kicker">' + esc(get(C, "opener.kicker", "")) + "</p>" +
      '<h1 class="dh">' + accentLast(get(C, "opener.headline", "Happy birthday!")) + "</h1>" +
      '<div class="op-ask"><p>' + esc(get(C, "opener.wishPrompt", "")) + " " + esc(get(C, "opener.blowHint", "")) + "</p>" +
      '<div class="row"><button class="btn" type="button" data-blow>' + esc(get(C, "opener.blowButton", "Blow out the candles")) + "</button>" +
      '<button class="mic" type="button" data-mic><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg><span>Use my mic</span></button><span class="mic-meter"><i></i></span></div>' +
      "</div></div>" +
      '<button class="op-skip" type="button" data-skip>Skip</button>' +
      "</section>";
  }

  function startOpener() {
    var op = $(".s-opener", root);
    if (!op || op._started) return;
    op._started = true;
    if (get(C, "opener.type") === "video") return startVideo(op);
    var img = $(".op-tr img", op), started = false;
    var go2 = function () {
      if (started) return; started = true;
      requestAnimationFrame(function () { op.classList.add("go"); });
      var flames = $$(".flame", op);
      flames.forEach(function (f, i) { setTimeout(function () { f.classList.add("lit"); }, REDUCED ? 0 : 2100 + i * 120); });
      setTimeout(function () { op.classList.add("ready"); }, REDUCED ? 0 : 2100 + flames.length * 120 + 150);
    };
    if (img && !img.complete) { img.addEventListener("load", go2); img.addEventListener("error", go2); setTimeout(go2, 1500); } else go2();
    $(".op-cake", op).addEventListener("click", function () { blow(); });
    $(".op-cake", op).addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); blow(); } });
    $("[data-blow]", op).addEventListener("click", function () { blow(); });
    $("[data-mic]", op).addEventListener("click", startMic);
    $("[data-skip]", op).addEventListener("click", function () { if (micStop) micStop(); go("card"); });
  }

  function blow() {
    if (blown) return;
    var op = $(".s-opener", root);
    blown = true;
    if (micStop) micStop();
    $$(".flame", op).forEach(function (f) { f.classList.add("lit"); });
    op.classList.add("ready", "blowing");
    $$(".flame", op).forEach(function (f, i) { setTimeout(function () { f.classList.add("out"); }, 120 + i * 45); });
    setTimeout(function () {
      op.classList.add("blown");
      confetti($(".op-confetti", op), { x: 0.68, y: 0.6, count: 110 });
      var h = $(".op-copy h1", op), p = $(".op-ask p", op), b = $("[data-blow]", op), m = $("[data-mic]", op), mm = $(".mic-meter", op);
      if (h) h.innerHTML = accentLast(get(C, "opener.doneHeadline", "Wish made!"));
      if (p) p.textContent = get(C, "opener.nextPrompt", "Now sign the card.");
      if (m) m.remove(); if (mm) mm.remove();
      if (b) { var nb = b.cloneNode(false); nb.textContent = get(C, "card.inviteTitle", "Sign the card"); nb.className = "btn alt"; b.replaceWith(nb);
        nb.addEventListener("click", function () { clearTimeout(autoTimer); go("card"); }); }
    }, 450);
    autoTimer = setTimeout(function () { if (step === "opener") go("card"); }, REDUCED ? 800 : 3600);
  }

  function startMic() {
    var btn = $("[data-mic]"), meter = $(".mic-meter i"), label = $("span", btn);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { label.textContent = "Mic not available. Tap the cake."; return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      btn.classList.add("on"); label.textContent = "Listening… blow!";
      var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
      var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      var buf = new Float32Array(an.fftSize), loud = 0, alive = true;
      micStop = function () { alive = false; micStop = null; stream.getTracks().forEach(function (t) { t.stop(); }); try { ctx.close(); } catch (e) {} btn.classList.remove("on"); };
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
    }).catch(function () { label.textContent = "No mic access. Tap the cake."; });
  }

  function confetti(canvas, opts) {
    if (!canvas || REDUCED) return;
    opts = opts || {};
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    var ox = (opts.x != null ? opts.x : .5) * w, oy = (opts.y != null ? opts.y : .6) * h, ps = [];
    for (var i = 0; i < (opts.count || 120); i++) {
      var a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = 6 + Math.random() * 10;
      ps.push({ x: ox, y: oy, vx: Math.cos(a) * v * (w / 900 + .4), vy: Math.sin(a) * v * (h / 560 + .4), r: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
        s: 5 + Math.random() * 7, c: BRAND[i % BRAND.length], shape: i % 3 });
    }
    var t0 = performance.now();
    (function frame(t) {
      var el = t - t0;
      ctx.clearRect(0, 0, w, h);
      ps.forEach(function (p) {
        p.vy += .32; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / 3200);
        if (p.shape === 0) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, 6.28); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(0, -p.s / 2); ctx.lineTo(p.s / 2, p.s / 2); ctx.lineTo(-p.s / 2, p.s / 2); ctx.fill(); }
        ctx.restore();
      });
      if (el < 3200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, h);
    })(t0);
  }

  function startVideo(op) {
    var v = $(".op-video", op), done = false;
    var finish = function () { if (done) return; done = true; if (v.pause) v.pause(); go("card"); };
    if (v && v.tagName === "VIDEO") { v.addEventListener("ended", finish); v.play && v.play().catch(function () {}); }
    $("[data-skip]", op).addEventListener("click", finish);
    var um = $("[data-unmute]", op);
    um.addEventListener("click", function () { if (v.tagName === "VIDEO") { v.muted = !v.muted; um.textContent = v.muted ? "Sound on" : "Sound off"; if (v.paused) v.play(); } });
  }

  /* ---------------- card step ---------------- */
  function greetingHTML() {
    return '<p class="greet">' + esc(get(C, "card.greeting", "")) + "</p>" +
      (get(C, "card.greetingSub") ? '<p class="greet-sub">' + esc(C.card.greetingSub) + "</p>" : "") +
      '<div class="sigs" aria-label="Signatures">' + sigsHTML() + "</div>";
  }
  function sigsHTML() {
    var names = (D.signers || []).slice(0, 24);
    if (!names.length) return '<span class="empty">Be one of the first to sign.</span>';
    var out = names.map(function (n, i) {
      var h = hash(n + i);
      return '<span class="sig" style="--c:' + INKS[h % INKS.length] + ";--r:" + ((h % 9) - 4) + 'deg">' + esc(n) + "</span>";
    }).join("");
    var more = (D.total || 0) - names.length;
    if (more > 0) out += '<span class="more">and ' + num(more) + " more</span>";
    return out;
  }
  function coverHTML() {
    return '<div class="cover" role="button" tabindex="0" aria-label="' + esc(get(C, "card.openButton", "Open the card")) + '">' +
      '<div class="cover-num" aria-hidden="true">' + esc(get(C, "opener.candles", "")) + "</div>" +
      (get(C, "opener.photo") ? '<img class="cover-tr" src="' + esc(asset(get(C, "opener.photo"))) + '" alt="">' : "") +
      '<h2 class="dh cover-title">' + esc(get(C, "card.coverTitle", "")) + "</h2>" +
      '<div class="cover-band"><img class="cover-mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library"><span>' + esc(get(C, "opener.kicker", "")) + "</span></div>" +
      '<span class="cover-hint">Tap to open</span></div>';
  }
  function cardStepHTML() {
    var total = D.total || 0;
    return '<section class="step s-card" data-step="card" aria-label="The card">' +
      '<div class="invite">' +
      '<h2 class="dh">' + esc(get(C, isClosed() ? "card.closedTitle" : "card.inviteTitle", "")) + "</h2>" +
      "<p>" + esc(get(C, isClosed() ? "card.closedBody" : "card.inviteBody", "")) + "</p>" +
      (isClosed() ? '<button class="btn alt" type="button" data-goto="wishes">See the wishes</button>'
        : '<button class="btn alt" type="button" data-open>' + esc(get(C, "card.openButton", "Open the card")) + "</button>") +
      (total > 0 ? '<p class="meta"><span class="count">' + num(total) + "</span> " + (total === 1 ? "person has" : "people have") + " signed</p>" : "") +
      (isClosed() ? "" : '<button type="button" class="link" data-goto="wishes">Just reading? See the wishes</button>') +
      "</div>" +
      '<div class="book">' +
      '<div class="page page-right"><div class="page-pad">' +
      '<div class="mobile-greet">' + greetingHTML() + "</div>" +
      '<div class="sign-area">' + (isClosed() ? "" : formHTML()) + "</div>" +
      "</div></div>" +
      '<div class="leaf">' +
      '<div class="leaf-front">' + coverHTML() + "</div>" +
      '<div class="leaf-back page"><div class="page-pad">' + greetingHTML() + "</div></div>" +
      "</div>" +
      "</div></section>";
  }
  function formHTML() {
    var max = +get(C, "card.messageMax", 280), showMsg = get(C, "card.showMessage", true) !== false, msgReq = !!get(C, "card.messageRequired", false);
    return '<form class="form" novalidate>' +
      '<div class="preview-sig" aria-hidden="true"></div>' +
      '<div class="two">' + fld("first", "First name", "text", "given-name") + fld("last", "Last name", "text", "family-name") + "</div>" +
      '<div class="two">' + fld("email", "Email", "email", "email") + fld("zip", "ZIP code", "text", "postal-code", 'inputmode="numeric" maxlength="5"') + "</div>" +
      (showMsg ? '<div class="fld" data-f="message"><label for="f-message">' + esc(get(C, "card.messageLabel", "Message")) + (msgReq ? "" : ' <span class="opt">(optional)</span>') + '<span class="ctr">0/' + max + "</span></label>" +
        '<textarea id="f-message" name="message" rows="3" maxlength="' + max + '" placeholder="' + esc(get(C, "card.messagePlaceholder", "")) + '"' + (msgReq ? " required" : "") + '></textarea><div class="msg"></div></div>' : "") +
      '<label class="check"><input type="checkbox" name="optIn"' + (get(C, "card.optInDefault", true) ? " checked" : "") + "><span>" + esc(get(C, "card.optInLabel", "")) + "</span></label>" +
      '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="fine">' + esc(get(C, "card.privacyNote", "")) + "</p>" +
      '<div class="form-err" hidden></div>' +
      '<button class="btn" type="submit">' + esc(get(C, "card.submitLabel", "Sign")) + "</button>" +
      "</form>";
  }
  function fld(name, label, type, ac, extra) {
    return '<div class="fld" data-f="' + name + '"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" type="' + type + '" autocomplete="' + ac + '" required ' + (extra || "") + '><div class="msg"></div></div>';
  }

  function wireCard() {
    var open = function () { openCard(false); };
    $$("[data-open]", root).forEach(function (b) { b.addEventListener("click", open); });
    $$("[data-goto]", root).forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-goto")); }); });
    var cover = $(".cover", root);
    if (cover && !isClosed()) {
      cover.addEventListener("click", open);
      cover.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    }
    var form = $(".form", root);
    if (!form) return;
    form._t0 = Date.now();
    var prev = $(".preview-sig", form);
    var upd = function () { prev.textContent = (form.first.value.trim() + " " + form.last.value.trim()).trim(); };
    form.first.addEventListener("input", upd); form.last.addEventListener("input", upd);
    form.zip.addEventListener("input", function () { form.zip.value = form.zip.value.replace(/\D/g, "").slice(0, 5); });
    if (form.message) {
      var ctr = $("[data-f=message] .ctr", form), max = form.message.maxLength;
      form.message.addEventListener("input", function () { ctr.textContent = form.message.value.length + "/" + max; });
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(form); });
  }

  function openCard(instant) {
    if (opened || isClosed()) return;
    opened = true;
    var sc = $(".s-card", root);
    if (instant || REDUCED) { sc.classList.add("is-open", "no-anim"); requestAnimationFrame(function () { sc.classList.remove("no-anim"); }); }
    else sc.classList.add("is-open");
    setTimeout(function () { var f = $("#f-first"); if (f && step === "card") f.focus({ preventScroll: true }); }, instant ? 0 : 1100);
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
      first: v("first") ? "" : "Add your first name.",
      last: v("last") ? "" : "Add your last name.",
      email: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v("email")) ? "" : "Check your email address.",
      zip: /^\d{5}$/.test(v("zip")) ? "" : "Enter a 5-digit ZIP code."
    };
    if (form.message && form.message.required) checks.message = v("message") ? "" : "Share a few words.";
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
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    var rec = {
      campaign: C.id,
      first: form.first.value.trim().slice(0, 60), last: form.last.value.trim().slice(0, 60),
      email: form.email.value.trim().slice(0, 254), zip: form.zip.value.trim(),
      message: form.message ? form.message.value.trim().slice(0, form.message.maxLength) : "",
      optIn: !!form.optIn.checked,
      source: (EMBED ? "embed:" + (ref || "unknown") : "site") + (STARTER ? ":starter" : "")
    };
    var bot = form.website.value || Date.now() - form._t0 < 2500;
    btn.disabled = true; btn.textContent = "Signing…";
    (bot ? wait(800).then(function () { return "skipped"; }) : save(rec)).then(function (result) {
      me = { name: displayName(rec.first, rec.last), full: rec.first + " " + rec.last, first: rec.first, message: rec.message, at: Date.now(), result: result };
      if (!PREVIEW) store("signcard:" + C.id, me);
      showSigned(false);
      post({ type: "signcard:signed", campaign: C.id });
      autoTimer = setTimeout(function () { if (step === "card") go("wishes"); }, REDUCED ? 600 : 5200);
    }).catch(function (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = get(C, "card.submitLabel", "Sign");
      errBox.hidden = false;
      errBox.textContent = "Something went wrong and your signature wasn't saved. Please try again in a moment.";
    });
  }

  function showSigned(instant) {
    if (!opened) openCard(true);
    var area = $(".sign-area", root);
    area.innerHTML = '<div class="mine' + (instant ? " instant" : "") + '">' +
      '<span class="stampd">' + sealSVG("#E7805D", "#FFFFFF", "✓", "SIGNED") + "</span>" +
      '<p class="kicker">' + esc(get(C, "card.signedTitle", "You're on the card")) + "</p>" +
      '<span class="sig-mine">' + esc(me.full || me.name) + "</span>" +
      (me.message ? '<p class="wish">' + esc(me.message) + "</p>" : "") +
      '<button class="btn alt seewishes" type="button">See the wishes</button></div>';
    $(".seewishes", area).addEventListener("click", function () { clearTimeout(autoTimer); go("wishes"); });
    $$(".sigs .empty", root).forEach(function (e) { e.textContent = "You're one of the first to sign!"; });
  }

  /* ---------------- results: nav ---------------- */
  function buildNav() {
    var nav = $(".snav", root), i = RESULTS.indexOf(step);
    if (i < 0) { nav.innerHTML = ""; nav.hidden = true; return; }
    nav.hidden = false;
    var canSign = !me && !isClosed();
    nav.innerHTML =
      '<button type="button" class="nb" data-nav="-1"' + (i === 0 && !canSign ? " disabled" : "") + ">‹ " + (i === 0 ? (canSign ? "Sign the card" : "Back") : "Back") + "</button>" +
      '<span class="dots">' + RESULTS.map(function (r, k) { return '<button type="button" class="dot-b' + (k === i ? " on" : "") + '" data-to="' + r + '" aria-label="' + r + '"></button>'; }).join("") + "</span>" +
      '<button type="button" class="nb" data-nav="1"' + (i === RESULTS.length - 1 ? " disabled" : "") + ">Next ›</button>";
    $$("[data-nav]", nav).forEach(function (b) {
      b.addEventListener("click", function () {
        var d = +b.getAttribute("data-nav");
        if (d < 0 && i === 0) { go("card"); return; }
        go(RESULTS[i + d]);
      });
    });
    $$("[data-to]", nav).forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-to")); }); });
  }

  function tallyLine() {
    // The public numbers lag a few minutes behind; count a fresh signer who is not in them yet.
    var fresh = me && me.result !== "already" && me.at > (Date.parse(D.updated || 0) || 0);
    var total = (D.total || 0) + (fresh ? 1 : 0);
    return num(total) + " " + (total === 1 ? "signature" : "signatures") + (D.states ? " from " + num(D.states) + " " + (D.states === 1 ? "state" : "states") : "");
  }

  /* ---------------- results: wishes ---------------- */
  var PAIRS = [
    ["#F9D635", "#092A4D", "#1B4532"], ["#FBF8F1", "#25282A", "#E7805D"], ["#1B4532", "#FFFFFF", "#87BB41"],
    ["#E7805D", "#FFFFFF", "#092A4D"], ["#F36079", "#FFFFFF", "#F9D635"], ["#99ADC5", "#092A4D", "#FFFFFF"]
  ];
  function buildWishes() {
    var sec = $(".s-wishes", root);
    var head = me ? '<p class="kicker">' + esc(me.first ? me.first + ", you're on the card" : "You're on the card") + " · " + tallyLine() + "</p>" : '<p class="kicker">' + tallyLine() + "</p>";
    var items = (D.featured || []).slice(0, +get(C, "wall.count", 12));
    if (me && me.message) items = [{ name: me.name + " (you)", place: "", message: me.message }].concat(items);
    sec.innerHTML = '<div class="res">' + head + '<h2 class="dh rtitle">' + esc(get(C, "wall.title", "")) + "</h2>" +
      (items.length ? '<div class="deck"></div><p class="deck-count"></p>' : '<p class="empty-note">The first wishes are on their way. Check back soon to read them.</p>') + "</div>";
    if (!items.length) return;
    var deck = $(".deck", sec);
    deck.innerHTML = items.map(function (it, i) {
      var p = PAIRS[i % PAIRS.length];
      return '<figure class="qcard" style="background:' + p[0] + ";color:" + p[1] + ";--qa:" + p[2] + '"><blockquote class="q">' + esc(it.message) + "</blockquote>" +
        '<figcaption class="who"><span class="n">' + esc(it.name) + '</span><span class="p">' + esc(it.place || "") + "</span></figcaption></figure>";
    }).join("");
    var cards = $$(".qcard", deck), top = 0, count = $(".deck-count", sec);
    function lay() {
      cards.forEach(function (c, i) {
        var k = (i - top + cards.length) % cards.length, h = hash(String(i));
        c.style.zIndex = cards.length - k;
        c.style.transform = k === 0 ? "rotate(0deg)" : "translate(" + (k * 6) + "px," + (k * 7) + "px) rotate(" + ((h % 7) - 3) + "deg) scale(" + (1 - k * .03) + ")";
        c.style.opacity = k > 3 ? 0 : 1;
        c.setAttribute("aria-hidden", k === 0 ? "false" : "true");
      });
      count.textContent = cards.length > 1 ? (top + 1) + " of " + cards.length + " · tap the card for the next wish" : "";
    }
    function next() {
      var cur = cards[top];
      if (!REDUCED) { cur.classList.add("fly"); setTimeout(function () { cur.classList.remove("fly"); }, 420); }
      top = (top + 1) % cards.length;
      setTimeout(lay, REDUCED ? 0 : 220);
    }
    lay();
    cards.forEach(function (c) { c.addEventListener("click", function () { next(); restart(); }); });
    function restart() { clearInterval(deckTimer); if (!REDUCED && cards.length > 1) deckTimer = setInterval(function () { if (step === "wishes") next(); }, 5200); }
    restart();
  }

  /* ---------------- results: map ---------------- */
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
    var sec = $(".s-map", root);
    var min = +get(C, "map.minimum", 0), total = D.total || 0;
    sec.innerHTML = '<div class="res"><p class="kicker">' + tallyLine() + '</p><h2 class="dh rtitle">' + esc(get(C, "map.title", "")) + '</h2><div class="mapwrap"></div></div>';
    var wrap = $(".mapwrap", sec);
    if (total < min) { wrap.innerHTML = '<p class="empty-note">The map lights up once ' + num(min) + " people have signed. It updates every few minutes.</p>"; return; }
    geo().then(function (us) {
      var W = 960, H = 600, proj = d3.geoAlbersUsa().scale(1250).translate([W / 2, H / 2]), path = d3.geoPath(proj);
      var states = topojson.feature(us, us.objects.states).features;
      var pts = (D.points || []).map(function (p) { var xy = proj([p[0], p[1]]); return xy ? { x: xy[0], y: xy[1], n: p[2] } : null; }).filter(Boolean);
      pts.sort(function (a, b) { return a.x - b.x; });
      var maxN = pts.reduce(function (m, p) { return Math.max(m, p.n); }, 1);
      wrap.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Map of where people signed from">' +
        states.map(function (s) { var d = path(s); return d ? '<path class="st" d="' + d + '"/>' : ""; }).join("") +
        pts.map(function (p, i) {
          var r = 3 + 11 * Math.sqrt(p.n / maxN), delay = REDUCED ? 0 : Math.min(2400, i * 18);
          return (p.n === maxN ? '<circle class="ring" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>' : "") +
            '<circle class="dot' + (i % 5 === 0 ? " hot" : "") + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" style="animation-delay:' + delay + 'ms"><title>' + num(p.n) + " signed nearby</title></circle>";
        }).join("") + "</svg>";
    }).catch(function (e) { console.warn(e); wrap.innerHTML = '<p class="empty-note">The map could not load right now.</p>'; });
  }

  /* ---------------- call-to-action pop-up ---------------- */
  var popTimer = null, popShown = false;
  function queueCtaPop() {
    if (popShown || popTimer || !get(C, "cta.url") || get(C, "cta.popup", true) === false) return;
    var delay = Math.max(2, +get(C, "cta.popupDelay", 8)) * 1000;
    popTimer = setTimeout(showCtaPop, REDUCED ? 1500 : delay);
  }
  function showCtaPop() {
    popTimer = null;
    if (popShown || step === "join" || step === "card" || step === "opener") return;
    popShown = true;
    var st = $(".stage", root), prevFocus = document.activeElement;
    var pop = document.createElement("div");
    pop.className = "pop";
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "true"); pop.setAttribute("aria-labelledby", "pop-t");
    pop.innerHTML = '<div class="pop-card">' +
      '<button type="button" class="pop-x" aria-label="Close">×</button>' +
      '<p class="kicker">' + esc(get(C, "cta.kicker", "Before you go")) + "</p>" +
      '<h2 class="dh" id="pop-t">' + esc(get(C, "cta.title", "")) + "</h2>" +
      "<p>" + esc(get(C, "cta.body", "")) + "</p>" +
      '<div class="row"><a class="btn" href="' + esc(ctaUrl()) + '" target="_blank" rel="noopener" data-cta>' + esc(get(C, "cta.button", "Learn more")) + "</a>" +
      '<button type="button" class="link" data-later>' + esc(get(C, "cta.dismiss", "Maybe later")) + "</button></div></div>";
    st.appendChild(pop);
    requestAnimationFrame(function () { pop.classList.add("on"); });
    $$(".step, .snav", root).forEach(function (el) { if ("inert" in el) el.inert = true; });
    var close = function () {
      pop.classList.remove("on");
      setTimeout(function () { pop.remove(); }, 300);
      $$(".snav", root).forEach(function (el) { if ("inert" in el) el.inert = false; });
      var cur = $(".step.on", root); if (cur && "inert" in cur) cur.inert = false;
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      document.removeEventListener("keydown", onKey);
    };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $(".pop-x", pop).addEventListener("click", close);
    $("[data-later]", pop).addEventListener("click", close);
    $("[data-cta]", pop).addEventListener("click", function () { post({ type: "signcard:cta", campaign: C.id }); setTimeout(close, 300); });
    $("[data-cta]", pop).focus({ preventScroll: true });
    post({ type: "signcard:cta_shown", campaign: C.id });
  }

  /* ---------------- results: join ---------------- */
  function ctaUrl() {
    var u = get(C, "cta.url", "");
    try {
      var url = new URL(u);
      [["utm_source", "cta.utmSource"], ["utm_medium", "cta.utmMedium"], ["utm_campaign", "cta.utmCampaign"]].forEach(function (p) {
        var v = get(C, p[1], ""); if (v && !url.searchParams.has(p[0])) url.searchParams.set(p[0], v);
      });
      if (!url.searchParams.has("utm_campaign")) url.searchParams.set("utm_campaign", C.id);
      return url.toString();
    } catch (e) { return u; }
  }
  function shareUrl() { return get(C, "share.url", "") || (CFG.siteUrl || location.origin + "/") + "?c=" + encodeURIComponent(C.id); }
  function buildJoin() {
    var sec = $(".s-join", root);
    sec.innerHTML = '<div class="join">' +
      (get(C, "cta.url") ? '<div class="cta"><h2 class="dh">' + esc(get(C, "cta.title", "")) + "</h2><p>" + esc(get(C, "cta.body", "")) + "</p>" +
        '<a class="btn" href="' + esc(ctaUrl()) + '" target="_blank" rel="noopener">' + esc(get(C, "cta.button", "Learn more")) + "</a></div>" : "") +
      '<div class="share"><p class="kicker">' + esc(get(C, "share.title", "Share")) + '</p><div class="row">' +
      '<button class="btn ghost" type="button" data-share>Share the card</button>' +
      (me ? '<button class="btn ghost" type="button" data-download>Save my card</button>' : "") +
      '</div><p class="note" aria-live="polite"></p></div>' +
      '<p class="credits">' + (get(C, "opener.type") === "cake" ? "Photographs: Theodore Roosevelt, 1885, Library of Congress. Badlands: National Park Service. " : "") +
      'Theodore Roosevelt Presidential Library · <a href="https://www.trlibrary.com" target="_blank" rel="noopener">trlibrary.com</a></p></div>';
    $("[data-share]", sec).addEventListener("click", share);
    var cb = $(".cta .btn", sec); if (cb) cb.addEventListener("click", function () { post({ type: "signcard:cta", campaign: C.id }); });
    var db = $("[data-download]", sec); if (db) db.addEventListener("click", download);
  }
  function share() {
    var note = $(".share .note", root), url = shareUrl(), text = get(C, "share.text", "");
    if (navigator.share) { navigator.share({ title: get(C, "card.inviteTitle", ""), text: text, url: url }).catch(function () {}); return; }
    var done = function () { note.textContent = "Link copied. Paste it anywhere to pass the card along."; };
    if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(done, function () { note.textContent = url; });
    else note.textContent = url;
  }
  function img(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; }); }
  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    var words = text.split(/\s+/), line = "", lines = [];
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…"); }
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lh); });
  }
  function download() {
    var note = $(".share .note", root);
    note.textContent = "Making your card…";
    var fonts = ['800 100px "Dharma Gothic E"', '400 40px "Clearface"', 'italic 400 40px "Clearface"', '400 80px "Mrs Saint Delafield"', '700 20px "Frutiger"'];
    Promise.all(fonts.map(function (f) { return document.fonts ? document.fonts.load(f) : null; }))
      .then(function () { return Promise.all([img(asset(get(C, "opener.photo", ""))).catch(function () { return null; }), img("assets/img/trpl-wordmark-white.svg").catch(function () { return null; })]); })
      .then(function (ims) {
        var W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var x = cv.getContext("2d");
        x.fillStyle = "#E7805D"; x.fillRect(0, 0, W, H);
        x.fillStyle = "#F9D635"; x.font = '800 560px "Dharma Gothic E", Arial Narrow, sans-serif'; x.textAlign = "center";
        x.fillText(get(C, "opener.candles", ""), W / 2, 640);
        if (ims[0]) { var tw = 820, th = tw * ims[0].height / ims[0].width; x.drawImage(ims[0], (W - tw) / 2, 690 - th, tw, th); }
        x.fillStyle = "#FFFFFF"; x.font = '800 104px "Dharma Gothic E", Arial Narrow, sans-serif'; x.textAlign = "left";
        x.fillText("I SIGNED TR'S", 64, 140); x.fillText("BIRTHDAY CARD", 64, 236);
        x.fillStyle = "#FBF8F1"; x.fillRect(48, 690, W - 96, 560);
        x.fillStyle = "#092A4D"; x.textAlign = "center"; x.font = '400 120px "Mrs Saint Delafield", cursive';
        x.fillText(me.full || me.name, W / 2, 850);
        x.fillStyle = "#3d3a33"; x.font = 'italic 400 38px "Clearface", Georgia, serif';
        if (me.message) wrapText(x, "“" + me.message + "”", W / 2, 940, W - 200, 50, 5);
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
        C = e.data.config; D = sampleData(); me = null;
        if (micStop) micStop();
        render();
        if (e.data.jump === "card") { go("card"); }
        if (e.data.jump === "reveal" || e.data.jump === "join") {
          me = { name: "Jane D.", full: "Jane Doe", first: "Jane", message: "Sample wish: that every kid gets to see the Badlands.", at: Date.now() };
          showSigned(true); go(e.data.jump === "join" ? "join" : "wishes");
        }
      });
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
        root.innerHTML = '<div class="stage"><p class="empty-note" style="margin:auto">This card could not be found.</p></div>';
      });
  }
  boot();
})();
