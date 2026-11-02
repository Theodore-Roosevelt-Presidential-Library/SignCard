/*
 * SignCard landscape mode — card.labs.trlibrary.com/?c=<campaign>            (phones: name a place)
 *                           card.labs.trlibrary.com/?c=<campaign>&display=1  (Surface Hub: the landscape)
 *
 * Each approved answer becomes one tile. Tiles fill a Badlands landscape from the river bottom up,
 * colored by the rock layers the Badlands are known for (lignite, bentonite, scoria, sandstone) with
 * grass on the butte tops. Until a tile is filled, its cell shows as a faint outline, so the shape of
 * the finished landscape is visible from the first answer.
 *
 * Signatures are saved by card.js with the same fields as every other campaign: first, last, email,
 * zip, message (the place), optIn. The display reads live/<campaign> from Firestore every few seconds
 * (written by the GitHub Action during live hours) and falls back to data/<campaign>.json.
 *
 * Display options: &demo=1 fills the landscape with sample answers (&fill=0.9 sets how full) and adds one every few seconds
 * (for rehearsals; a DEMO badge shows). &goal=<n> overrides the number of tiles in a full landscape.
 */
(function () {
  "use strict";
  var W = 1500, H = 1000;             // mosaic coordinates; the display widens or narrows W to fit its frame
  var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var o = null, C = null, D = null;

  window.SignCardLandscape = { start: start, layout: layout };

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function get(obj, path, dflt) {
    var v = path.split(".").reduce(function (a, k) { return a && a[k] !== undefined ? a[k] : undefined; }, obj);
    return v === undefined || v === null || v === "" ? dflt : v;
  }
  function num(n) { return Number(n || 0).toLocaleString("en-US"); }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function accentQuestion(q) {
    // Accent "100 years from now?" when it is there, otherwise the last word.
    var m = /(100 years from now\??)$/i.exec(q);
    if (m) return esc(q.slice(0, m.index)) + '<span class="acc">' + esc(m[1]) + "</span>";
    return esc(q).replace(/(\S+)$/, '<span class="acc">$1</span>');
  }
  function labelOf(t) {
    var l = String(t.label || "").trim();
    if (l) return l;
    var m = String(t.message || "").replace(/^(i hope|i wish|the)\s+/i, "").split(/[,.;:!—–-]\s/)[0];
    return m.length > 26 ? m.slice(0, 24).replace(/\s+\S*$/, "") + "…" : m;
  }

  /* ---------------- the mosaic ---------------- */
  // The picture: a photo (landscape.image) sampled into a brick grid that covers the whole frame.
  // Each tile takes the average color of its patch of the photo, softened toward card stock, so
  // the photo appears as answers fill in. Empty cells show a dim copy of the photo behind them.
  var PIX = null;
  function loadPhoto(src) {
    return new Promise(function (res) {
      if (!src) return res();
      var im = new Image();
      im.onload = function () {
        var w = 360, h = Math.round(w * im.naturalHeight / im.naturalWidth), cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var x = cv.getContext("2d"); x.drawImage(im, 0, 0, w, h);
        try { PIX = { w: w, h: h, d: x.getImageData(0, 0, w, h).data, src: src, nw: im.naturalWidth, nh: im.naturalHeight }; } catch (e) { PIX = null; }
        res();
      };
      im.onerror = function () { res(); };
      im.src = src;
    });
  }
  // The photo is cropped to the frame like CSS "cover", centered.
  function sample(x0, y0, x1, y1) {
    if (!PIX) return [209, 204, 189];
    var s = Math.max(W / PIX.w, H / PIX.h), ox = (W - PIX.w * s) / 2, oy = (H - PIX.h * s) / 2, r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < 5; i++) for (var j = 0; j < 4; j++) {
      var px = Math.floor(((x0 + (x1 - x0) * (i + .5) / 5) - ox) / s), py = Math.floor(((y0 + (y1 - y0) * (j + .5) / 4) - oy) / s);
      px = Math.max(0, Math.min(PIX.w - 1, px)); py = Math.max(0, Math.min(PIX.h - 1, py));
      var k = (py * PIX.w + px) * 4; r += PIX.d[k]; g += PIX.d[k + 1]; b += PIX.d[k + 2]; n++;
    }
    return [r / n, g / n, b / n];
  }
  function hex(c) { return "#" + c.map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }
  function lum(h) { var n = parseInt(h.slice(1), 16); return (.299 * (n >> 16) + .587 * (n >> 8 & 255) + .114 * (n & 255)) / 255; }
  function cellColor(c) {
    var rnd = rng(hash(c.x.toFixed(1) + "," + c.y.toFixed(1))), rgb = sample(c.x, c.y, c.x + c.w, c.y + c.h);
    var paper = [251, 248, 241], f = .9 + rnd() * .14, mix = .1;   // a little card stock, a little variation
    return hex(rgb.map(function (v, i) { return (v * (1 - mix) + paper[i] * mix) * f; }));
  }

  // Cells: staggered bricks over the whole frame, filled in a random order so the picture emerges everywhere at once.
  function grid(rows) {
    var ch = H / rows, cw = ch * 2, out = [];
    for (var r = 0; r < rows; r++) {
      var y = r * ch, off = r % 2 ? cw / 2 : 0;
      for (var x = -off; x < W - 1; x += cw) {
        var x0 = Math.max(0, x), x1 = Math.min(W, x + cw);
        if (x1 - x0 < cw * .3) continue;
        out.push({ x: x0, y: y, w: x1 - x0, h: ch, cx: (x0 + x1) / 2, cy: y + ch / 2, r: r });
      }
    }
    return { cells: out, ch: ch };
  }
  var layoutCache = {};
  function layout(n) {
    n = Math.max(20, Math.round(n));
    var key = n + "|" + W + "|" + (PIX ? PIX.src : "");
    if (layoutCache[key]) return layoutCache[key];
    var rows = Math.max(3, Math.floor(Math.sqrt(n * H / (2 * W)))), G = grid(rows);
    while (G.cells.length < n) G = grid(++rows);
    var rnd = rng(1858);
    G.cells.forEach(function (c) { c.k = rnd(); c.color = cellColor(c); c.dark = lum(c.color) < .55; });
    G.cells.sort(function (a, b) { return a.k - b.k; });
    return (layoutCache[key] = G);
  }
  function capacity(goal, count) {
    // A full mosaic holds about `goal` tiles. Past that the tiles get smaller so everyone fits.
    if (count <= goal) return goal;
    return Math.ceil(count / 20) * 20;
  }

  var maskN = 0;
  function landSVG(cls) {
    // Dim photo underneath; each filled tile reveals the full-color photo through a mask, with a
    // light card tint and the place on top.
    var id = "lsm" + (++maskN);
    return '<svg class="' + cls + '" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A Badlands photo mosaic built from the places people named">' +
      '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse"><g class="ls-mask"></g></mask></defs>' +
      '<image class="ls-photo" preserveAspectRatio="xMidYMid slice" x="0" y="0"/>' +
      '<image class="ls-bright" preserveAspectRatio="xMidYMid slice" x="0" y="0" mask="url(#' + id + ')"/>' +
      '<g class="ls-ghosts"></g><g class="ls-tiles"></g></svg>';
  }
  function reveal(el, on) { if (el && el._m) el._m.setAttribute("fill", on ? "#fff" : "#000"); }

  // Draws tiles into an SVG made by landSVG(). Keeps tiles already drawn; redraws everything when
  // the grid changes size.
  function Land(svg, opts) {
    this.svg = svg; this.opts = opts || {}; this.n = 0; this.drawn = {};
  }
  Land.prototype.draw = function (tiles, goal) {
    var n = capacity(goal, tiles.length), L = layout(n), self = this, gap = Math.max(.6, L.ch * .06);
    var ghosts = $(".ls-ghosts", this.svg), g = $(".ls-tiles", this.svg);
    if (n !== this.n || W !== this.w || L !== this.L) {
      this.n = n; this.w = W; this.L = L; this.drawn = {}; g.innerHTML = "";
      this.svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      $$("image", this.svg).forEach(function (ph) { if (PIX) { ph.setAttribute("href", PIX.src); ph.setAttribute("width", W); ph.setAttribute("height", H); } });
      $(".ls-mask", this.svg).innerHTML = "";
      ghosts.innerHTML = L.cells.map(function (c) {
        return '<rect x="' + (c.x + gap / 2).toFixed(1) + '" y="' + (c.y + gap / 2).toFixed(1) + '" width="' + (c.w - gap).toFixed(1) + '" height="' + (c.h - gap).toFixed(1) + '"/>';
      }).join("");
    }
    var fresh = [], showText = this.opts.text && L.ch >= 14, fs = L.ch * .44;
    var ids = {};
    tiles.forEach(function (t, i) {
      ids[t.id] = 1;
      var c = L.cells[i];
      if (!c) return;
      var el = self.drawn[t.id];
      if (el && el._i === i) return;
      if (el) { el.remove(); if (el._m) el._m.remove(); }
      el = document.createElementNS("http://www.w3.org/2000/svg", "g");
      el.setAttribute("class", "ls-tile" + (t.mine ? " mine" : "") + (t.pending ? " pending" : ""));
      el._i = i; el._t = t; el._c = c;
      var txt = "", lab = "", maxW = 0;
      if (showText) {
        lab = labelOf(t); maxW = c.w - gap - L.ch * .3;
        txt = '<text x="' + c.cx.toFixed(1) + '" y="' + (c.cy + fs * .36).toFixed(1) + '" font-size="' + fs.toFixed(1) + '" fill="#ffffff"></text>';
      }
      el.innerHTML = '<rect x="' + (c.x + gap / 2).toFixed(1) + '" y="' + (c.y + gap / 2).toFixed(1) + '" width="' + (c.w - gap).toFixed(1) + '" height="' + (c.h - gap).toFixed(1) + '" rx="' + (gap * .5).toFixed(1) + '" fill="' + c.color + '"/>' + txt;
      g.appendChild(el);
      var m = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      m.setAttribute("x", c.x.toFixed(1)); m.setAttribute("y", c.y.toFixed(1)); m.setAttribute("width", c.w.toFixed(1)); m.setAttribute("height", c.h.toFixed(1)); m.setAttribute("fill", "#fff");
      $(".ls-mask", self.svg).appendChild(m); el._m = m;
      if (showText) { el._lab = lab; el._maxW = maxW; fit(el); }
      el.classList.add("enter");
      setTimeout(function () { el.classList.remove("enter"); }, 1000);
      self.drawn[t.id] = el;
      fresh.push(el);
    });
    Object.keys(this.drawn).forEach(function (id) { if (!ids[id]) { var d = self.drawn[id]; d.remove(); if (d._m) d._m.remove(); delete self.drawn[id]; } });
    return fresh;
  };
  // Fit a label in its tile: squeeze it up to a third narrower, and shorten it past that.
  function fit(el) {
    var tx = el.querySelector("text");
    if (!tx || !el._lab) return;
    tx.textContent = el._lab; tx.removeAttribute("textLength"); tx.removeAttribute("lengthAdjust");
    var w = 0; try { w = tx.getComputedTextLength(); } catch (e) {}
    if (!w) return;
    var max = el._maxW, squeeze = 1.5;
    if (w > max * squeeze) {
      var keep = Math.max(3, Math.floor(el._lab.length * max * squeeze / w) - 1);
      tx.textContent = el._lab.slice(0, keep).replace(/[\s,.'-]+$/, "") + "…";
      try { w = tx.getComputedTextLength(); } catch (e) {}
    }
    if (w > max) { tx.setAttribute("textLength", max.toFixed(1)); tx.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
  }
  Land.prototype.refit = function () { var d = this.drawn; Object.keys(d).forEach(function (id) { fit(d[id]); }); };
  Land.prototype.el = function (id) { return this.drawn[id]; };

  /* ---------------- data ---------------- */
  function liveUrl() {
    var fb = (o.CFG && o.CFG.firebase) || {};
    if (!fb.projectId || !fb.apiKey) return "";
    return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(fb.projectId) +
      "/databases/(default)/documents/live/" + encodeURIComponent(C.id) + "?key=" + encodeURIComponent(fb.apiKey);
  }
  var liveOk = true;
  function fetchData() {
    var fromFile = function () {
      return fetch("data/" + C.id + ".json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    };
    var u = liveUrl();
    if (!u || !liveOk) return fromFile();
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (r.status === 403 || r.status === 404) { if (r.status === 403) liveOk = false; throw new Error("live " + r.status); }
      if (!r.ok) throw new Error("live " + r.status);
      return r.json();
    }).then(function (doc) { return JSON.parse(doc.fields.json.stringValue); }).catch(fromFile);
  }
  function tilesOf(d) { return (d && d.tiles) || []; }

  var SAMPLE_PLACES = [
    ["Theodore Roosevelt National Park", "Theodore Roosevelt National Park"], ["The Little Missouri River", "Little Missouri River"],
    ["Yellowstone, for my grandkids' grandkids", "Yellowstone"], ["The Boundary Waters", "Boundary Waters"], ["Grand Canyon", "Grand Canyon"],
    ["The prairie potholes where the ducks come back every spring", "Prairie Potholes"], ["Lake Sakakawea", "Lake Sakakawea"],
    ["The Elkhorn Ranch site", "Elkhorn Ranch"], ["The creek behind my grandma's farm", "Grandma's Creek"], ["Glacier National Park", "Glacier"],
    ["The Black Hills", "Black Hills"], ["Pelican Island", "Pelican Island"], ["The Everglades", "Everglades"], ["Devils Tower", "Devils Tower"],
    ["Muir Woods", "Muir Woods"], ["The Chesapeake Bay", "Chesapeake Bay"], ["The Maah Daah Hey Trail", "Maah Daah Hey Trail"],
    ["Our neighborhood park", "Neighborhood Park"], ["Crater Lake", "Crater Lake"], ["The Sheyenne National Grassland", "Sheyenne Grassland"],
    ["Painted Canyon at sunrise", "Painted Canyon"], ["The Missouri River breaks", "Missouri Breaks"], ["Yosemite Valley", "Yosemite"],
    ["Acadia", "Acadia"], ["The Great Smoky Mountains", "Great Smokies"], ["The Gulf Coast beaches", "Gulf Coast"],
    ["The Killdeer Mountains", "Killdeer Mountains"], ["Wind Cave", "Wind Cave"], ["Sagamore Hill", "Sagamore Hill"], ["The Tongass", "Tongass"]
  ];
  var SAMPLE_NAMES = ["Ava M.", "Luis R.", "June B.", "Sam K.", "Priya N.", "Walt H.", "Nora W.", "Ike P.", "Grace O.", "Tomas G.", "Elena R.", "Marcus T.", "Ruth A.", "Ben S.", "Hana L."];
  var SAMPLE_TOWNS = ["Medora, ND", "Bismarck, ND", "Fargo, ND", "Dickinson, ND", "Minot, ND", "Billings, MT", "Rapid City, SD", "Minneapolis, MN", "Dallas, TX", "Oyster Bay, NY"];
  function sampleTile(i) {
    var r = rng(i * 7919 + 3), p = SAMPLE_PLACES[Math.floor(r() * SAMPLE_PLACES.length)];
    return { id: "demo" + i, name: SAMPLE_NAMES[Math.floor(r() * SAMPLE_NAMES.length)], place: SAMPLE_TOWNS[Math.floor(r() * SAMPLE_TOWNS.length)],
      message: p[0], label: p[1], score: Math.floor(r() * 10) };
  }

  /* =========================================================
     START
     ========================================================= */
  function start(opts) {
    o = opts; C = opts.C; D = opts.D || {};
    var qs = opts.qs;
    o.root.className = "sc ls" + (qs.has("display") ? " ls-display" : " ls-phone");
    document.title = (get(C, "landscape.qrLabel", "Add your place")) + " | Theodore Roosevelt Presidential Library";
    loadPhoto(get(C, "landscape.image", "")).then(function () { if (qs.has("display")) display(qs); else phone(qs); });
  }

  /* =========================================================
     DISPLAY (Surface Hub)
     ========================================================= */
  function display(qs) {
    var demo = qs.has("demo") || o.PREVIEW, goal = +(qs.get("goal") || get(C, "landscape.goal", 300));
    var site = (o.CFG.siteUrl || location.origin + "/"), joinUrl = site + "?c=" + encodeURIComponent(C.id) + "&src=qr";
    var shortUrl = (site + "?c=" + C.id).replace(/^https?:\/\//, "");
    var logo = get(C, "landscape.partnerLogo", "");
    o.root.innerHTML =
      '<div class="lsd">' +
      '<header class="lsd-top">' +
      '<p class="kicker">' + esc(get(C, "landscape.kicker", "")) + (get(C, "landscape.displayTagline") ? '<span class="sep">·</span>' + esc(C.landscape.displayTagline) : "") + "</p>" +
      '<h1 class="dh">' + accentQuestion(get(C, "landscape.question", "")) + "</h1>" +
      "</header>" +
      '<div class="lsd-main">' +
      '<div class="lsd-wall"><div class="lsd-frame">' + landSVG("ls-svg") + "</div></div>" +
      '<aside class="lsd-side">' +
      '<div class="lsd-qr"><div class="qr" aria-hidden="true"></div><div><p class="dh">' + esc(get(C, "landscape.qrLabel", "Add your place")) + '</p><p class="lsd-url">Scan with your phone camera</p></div></div>' +
      '<div class="lsd-spot" aria-live="polite"></div>' +
      '<div class="lsd-count"><p><b class="n">0</b> <span class="w">places and counting</span></p><div class="bar"><i></i></div></div>' +
      "</aside></div>" +
      '<footer class="lsd-foot">' +
      '<img class="lsd-mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library">' +
      '<p class="lsd-credit">' + esc(get(C, "landscape.imageCredit", "")) + "</p>" +
      (logo ? '<img class="lsd-partner" src="' + esc(logo) + '" alt="' + esc(get(C, "landscape.partnerLogoAlt", "")) + '">' : "<span></span>") +
      "</footer>" +
      (demo ? '<span class="lsd-demo">Demo · sample answers</span>' : "") +
      '<button type="button" class="lsd-fs" aria-label="Full screen">⤢ Full screen</button>' +
      "</div>";
    // QR code (qrcode-generator, MIT).
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js").then(function () {
      var q = window.qrcode(0, "M"); q.addData(joinUrl); q.make();
      $(".lsd-qr .qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    }).catch(function () { $(".lsd-qr .qr").innerHTML = '<span class="lsd-url">' + esc(shortUrl) + "</span>"; });

    // Fit the mosaic to its frame on this screen (coordinates are H tall; W follows the frame's shape).
    var fitW = function () { var r = $(".lsd-wall").getBoundingClientRect(); return Math.round(Math.max(500, Math.min(3000, H * r.width / Math.max(1, r.height)))); };
    W = fitW();
    var land = new Land($(".lsd-wall svg"), { text: true });
    var rz;
    var refitWall = function () { clearTimeout(rz); rz = setTimeout(function () { var w = fitW(); if (Math.abs(w - W) > 10) { W = w; land.draw(tiles, goal); land.refit(); } }, 250); };
    if ("ResizeObserver" in window) new ResizeObserver(refitWall).observe($(".lsd-wall")); else window.addEventListener("resize", refitWall);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { land.refit(); });
    var tiles = [], queue = [], known = {}, spotTimer = null, first = true, lastSpot = null;

    function counter() {
      var n = tiles.length, el = $(".lsd-count");
      $(".n", el).textContent = num(n);
      $(".w", el).textContent = n === 1 ? "place and counting" : (n >= goal ? "places. The mosaic is complete, and still growing." : "places and counting");
      $(".bar i", el).style.width = Math.min(100, n / goal * 100) + "%";
      el.classList.toggle("done", n >= goal);
      $(".lsd-wall svg").classList.toggle("complete", n >= goal);   // fill any cells left over at the goal
    }
    function apply(list) {
      var added = [];
      list.forEach(function (t) { if (!known[t.id]) { known[t.id] = 1; if (!first) added.push(t); } });
      tiles = list;
      land.draw(tiles, goal);
      added.forEach(function (t) { var el = land.el(t.id); if (el) { el.classList.remove("enter"); el.classList.add("waiting"); reveal(el, false); } });
      queue = queue.concat(added);
      first = false;
      counter();
    }
    function spotlight() {
      clearTimeout(spotTimer);
      var t = queue.shift(), isNew = !!t;
      if (!t && tiles.length) {
        var pool = tiles.filter(function (x) { return (x.score || 0) >= 6 && x !== lastSpot; });
        if (pool.length < 4) pool = tiles.filter(function (x) { return x !== lastSpot; });
        t = pool[Math.floor(Math.random() * pool.length)];
      }
      show(t, isNew);
    }
    function show(t, isNew) {
      clearTimeout(spotTimer);
      var spot = $(".lsd-spot");
      $$(".ls-tile.lit").forEach(function (e) { e.classList.remove("lit"); });
      if (!t) { spot.innerHTML = '<div class="spot-card on empty"><p class="spot-msg short">Be the first to add a place.</p><p class="spot-who">Scan the code to start the landscape.</p></div>'; spotTimer = setTimeout(spotlight, 5000); return; }
      lastSpot = t;
      var msg = String(t.message || ""), long = msg.length > 46;
      var card = document.createElement("div");
      card.className = "spot-card";
      card.innerHTML = '<p class="kicker">' + (isNew ? "Just added" : "A place worth protecting") + "</p>" +
        '<p class="spot-msg ' + (long ? "long" : "short") + '">' + esc(msg) + "</p>" +
        '<p class="spot-who">' + esc(t.name) + (t.place ? '<span class="sep">·</span>' + esc(t.place) : "") + "</p>";
      $$(".spot-card", spot).forEach(function (old) { old.classList.remove("on"); old.classList.add("off"); setTimeout(function () { old.remove(); }, 900); });
      spot.appendChild(card);
      requestAnimationFrame(function () { requestAnimationFrame(function () { card.classList.add("on"); }); });
      var el = land.el(t.id);
      if (el && isNew && !REDUCED) setTimeout(function () { fly(card, el); }, 1300);
      else if (el) { el.classList.remove("waiting"); reveal(el, true); el.classList.add("lit"); }
      spotTimer = setTimeout(spotlight, isNew ? (queue.length > 3 ? 4200 : 7000) : 8000);
    }
    function fly(card, el) {
      var rect = $("rect", el), a = card.getBoundingClientRect(), b = rect.getBoundingClientRect();
      var f = document.createElement("div");
      f.className = "lsd-fly";
      f.style.background = rect.getAttribute("fill");
      f.style.left = a.left + "px"; f.style.top = a.top + "px"; f.style.width = a.width + "px"; f.style.height = a.height + "px";
      document.body.appendChild(f);
      var anim = f.animate([
        { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", opacity: .9, borderRadius: "6px" },
        { left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px", opacity: 1, borderRadius: "2px" }
      ], { duration: 1100, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
      anim.onfinish = function () { f.remove(); el.classList.remove("waiting"); reveal(el, true); el.classList.add("landed", "lit"); setTimeout(function () { el.classList.remove("landed"); }, 1600); };
    }

    // Tap a tile on the Hub to read it.
    $(".lsd-wall svg").addEventListener("click", function (e) {
      var g = e.target.closest && e.target.closest(".ls-tile");
      if (g && g._t) show(g._t, false);
    });

    $(".lsd-fs").addEventListener("click", function () {
      var el = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    });
    var idle;
    document.addEventListener("pointermove", function () { o.root.classList.add("pointer"); clearTimeout(idle); idle = setTimeout(function () { o.root.classList.remove("pointer"); }, 2500); });
    if (navigator.wakeLock) { var wl = function () { navigator.wakeLock.request("screen").catch(function () {}); }; wl(); document.addEventListener("visibilitychange", function () { if (!document.hidden) wl(); }); }

    if (demo) {
      var n0 = Math.round(goal * Math.min(1.5, +(qs.get("fill") || .42))), list = [];
      for (var i = 0; i < n0; i++) list.push(sampleTile(i));
      apply(list);
      var k = n0;
      setInterval(function () { apply(tiles.concat([sampleTile(k++)])); }, 5200);
      setTimeout(spotlight, 600);
      return;
    }
    apply(tilesOf(D));
    setTimeout(spotlight, 900);
    var poll = function () {
      fetchData().then(function (d) { if (d) { D = d; apply(tilesOf(d)); } }).catch(function (e) { console.warn(e); })
        .then(function () { setTimeout(poll, liveOk ? 8000 : 60000); });
    };
    setTimeout(poll, 3000);
    // Reload once a night so the display picks up any changes to the page itself.
    setTimeout(function () { location.reload(); }, 6 * 3600 * 1000);
  }

  /* =========================================================
     PHONE (scan the code, name a place)
     ========================================================= */
  function mine(v) { return o.store("signcard:" + C.id + ":places", v); }
  function phone(qs) {
    var goal = +get(C, "landscape.goal", 300), closed = o.isClosed();
    var logo = get(C, "landscape.partnerLogo", "");
    o.root.innerHTML =
      '<div class="lsp">' +
      '<header class="lsp-head"><img class="lsp-mark" src="assets/img/trpl-wordmark-white.svg" alt="Theodore Roosevelt Presidential Library">' +
      (logo ? '<img class="lsp-partner" src="' + esc(logo) + '" alt="' + esc(get(C, "landscape.partnerLogoAlt", "")) + '">' : "") + "</header>" +
      '<p class="kicker">' + esc(get(C, "landscape.kicker", "")) + "</p>" +
      '<h1 class="dh">' + accentQuestion(get(C, "landscape.question", "")) + "</h1>" +
      '<p class="lsp-intro">' + esc(closed ? get(C, "card.closedBody", "") : get(C, "landscape.intro", "")) + "</p>" +
      '<div class="lsp-land"><div class="lsp-frame">' + landSVG("ls-svg") + '</div><p class="lsp-count"></p></div>' +
      '<div class="lsp-body">' + (closed ? '<h2 class="dh">' + esc(get(C, "card.closedTitle", "")) + "</h2>" : formHTML()) + "</div>" +
      '<p class="credits">Theodore Roosevelt Presidential Library · <a href="https://www.trlibrary.com" target="_blank" rel="noopener">trlibrary.com</a></p>' +
      "</div>";
    var land = new Land($(".lsp-land svg"), { text: false }), pending = [];
    function draw() {
      var list = tilesOf(D).slice(), have = {}, my = (mine() || []).map(function (m) { return m.id; });
      list.forEach(function (t) { have[t.id] = 1; if (my.indexOf(t.id) >= 0) t.mine = true; });
      pending.forEach(function (p) { if (!have[p.id]) list.push({ id: p.id, message: p.message, mine: true, pending: true }); });
      land.draw(list, goal);
      var n = tilesOf(D).length;
      $(".lsp-count").textContent = n ? num(n) + (n === 1 ? " place so far" : " places so far") : "Be one of the first to add a place.";
      return have;
    }
    draw();
    if (closed) return;
    wireForm($(".lsp-body form"));

    function wireForm(form) {
      form._t0 = Date.now();
      form.zip.addEventListener("input", function () { form.zip.value = form.zip.value.replace(/\D/g, "").slice(0, 5); });
      var max = +get(C, "card.messageMax", 140), ctr = $(".ctr", form);
      form.message.addEventListener("input", function () { ctr.textContent = form.message.value.length + "/" + max; });
      form.addEventListener("submit", function (e) { e.preventDefault(); submit(form); });
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
        message: form.message.value.trim().replace(/\s+/g, " ").slice(0, +get(C, "card.messageMax", 140)),
        optIn: !!form.optIn.checked,
        source: (o.EMBED ? "embed:" + (ref || "unknown") : (qs.get("src") === "qr" ? "qr" : "site"))
      };
      var bot = form.website.value || Date.now() - form._t0 < 2500;
      btn.disabled = true; btn.textContent = "Adding…";
      Promise.all([bot ? new Promise(function (r) { setTimeout(function () { r("skipped"); }, 800); }) : o.save(rec), o.sha256(rec.campaign + "|" + rec.email.toLowerCase())])
        .then(function (res) {
          if (res[0] === "already") {
            btn.disabled = false; btn.textContent = get(C, "card.submitLabel", "Add my place");
            errBox.hidden = false;
            errBox.textContent = "This email has already added a place. Each person adds one. Adding for someone else? Use their email.";
            return;
          }
          var me = { id: res[1].slice(0, 10), name: o.displayName(rec.first, rec.last), first: rec.first, message: rec.message, at: Date.now() };
          if (!o.PREVIEW) mine((mine() || []).concat([me]));
          pending.push(me);
          draw();
          done(me);
          o.post({ type: "signcard:signed", campaign: C.id });
        })
        .catch(function (err) {
          console.error(err);
          btn.disabled = false; btn.textContent = get(C, "card.submitLabel", "Add my place");
          errBox.hidden = false;
          errBox.textContent = "Something went wrong and your place wasn't saved. Please try again in a moment.";
        });
    }
    function done(me) {
      var body = $(".lsp-body");
      body.innerHTML = '<div class="lsp-done">' +
        '<p class="kicker">' + esc(get(C, "card.signedTitle", "Look up at the screen")) + "</p>" +
        '<p class="lsp-mine">' + esc(me.message) + "</p>" +
        '<p class="lsp-status">' + esc(get(C, "card.signedBody", "")) + "</p>" +
        '<div class="row"><button type="button" class="btn alt" data-again>Add someone else\'s place</button></div>' +
        (get(C, "cta.url") ? '<div class="lsp-cta"><h2 class="dh">' + esc(get(C, "cta.title", "")) + "</h2><p>" + esc(get(C, "cta.body", "")) + '</p><a class="btn" href="' + esc(o.ctaUrl()) + '" target="_blank" rel="noopener" data-cta>' + esc(get(C, "cta.button", "Learn more")) + "</a></div>" : "") +
        '<button type="button" class="link" data-share>' + esc(get(C, "share.title", "Share")) + "</button><p class=\"note\" aria-live=\"polite\"></p></div>";
      $(".lsp-land").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
      $("[data-again]", body).addEventListener("click", function () {
        body.innerHTML = formHTML(); wireForm($("form", body));
        var f = $("#f-first", body); if (f) f.focus();
      });
      var cb = $("[data-cta]", body); if (cb) cb.addEventListener("click", function () { o.post({ type: "signcard:cta", campaign: C.id }); });
      $("[data-share]", body).addEventListener("click", function () {
        var url = get(C, "share.url", ""), text = get(C, "share.text", ""), note = $(".note", body);
        if (navigator.share) { navigator.share({ text: text, url: url }).catch(function () {}); return; }
        if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(function () { note.textContent = "Link copied."; });
        else note.textContent = url;
      });
      // Watch for the tile to be approved, for up to 15 minutes.
      var t0 = Date.now();
      (function watch() {
        if (o.PREVIEW) return;
        setTimeout(function () {
          fetchData().then(function (d) {
            if (d) D = d;
            var have = draw();
            var st = $(".lsp-status");
            if (have[me.id]) { if (st) { st.textContent = "You're on the landscape. Find your piece on the screen."; st.classList.add("ok"); } return; }
            if (Date.now() - t0 > 2 * 60000 && st) st.textContent = "Still on its way. It can take a few minutes to reach the screen.";
            if (Date.now() - t0 < 15 * 60000) watch();
          }).catch(function () { if (Date.now() - t0 < 15 * 60000) watch(); });
        }, liveOk ? 8000 : 30000);
      })();
    }
  }

  function formHTML() {
    var max = +get(C, "card.messageMax", 140);
    return '<form class="form lsp-form" novalidate>' +
      '<div class="fld" data-f="message"><label for="f-message">' + esc(get(C, "card.messageLabel", "A place")) + '<span class="ctr">0/' + max + "</span></label>" +
      '<textarea id="f-message" name="message" rows="2" maxlength="' + max + '" required placeholder="' + esc(get(C, "card.messagePlaceholder", "")) + '"></textarea><div class="msg"></div></div>' +
      '<div class="two">' + fld("first", "First name", "text", "given-name") + fld("last", "Last name", "text", "family-name") + "</div>" +
      '<div class="two">' + fld("email", "Email", "email", "email") + fld("zip", "ZIP code", "text", "postal-code", 'inputmode="numeric" maxlength="5"') + "</div>" +
      '<label class="check"><input type="checkbox" name="optIn"' + (get(C, "card.optInDefault", true) ? " checked" : "") + "><span>" + esc(get(C, "card.optInLabel", "")) + "</span></label>" +
      '<div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="fine">' + esc(get(C, "card.privacyNote", "")) + "</p>" +
      '<div class="form-err" hidden></div>' +
      '<button class="btn" type="submit">' + esc(get(C, "card.submitLabel", "Add my place")) + "</button>" +
      "</form>";
  }
  function fld(name, label, type, ac, extra) {
    return '<div class="fld" data-f="' + name + '"><label for="f-' + name + '">' + label + '</label><input id="f-' + name + '" name="' + name + '" type="' + type + '" autocomplete="' + ac + '" required ' + (extra || "") + '><div class="msg"></div></div>';
  }
  function validate(form) {
    var ok = true, v = function (n) { return (form[n] && form[n].value || "").trim(); };
    var checks = {
      message: v("message") ? "" : "Name a place.",
      first: v("first") ? "" : "Add your first name.",
      last: v("last") ? "" : "Add your last name.",
      email: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v("email")) ? "" : "Check your email address.",
      zip: /^\d{5}$/.test(v("zip")) ? "" : "Enter a 5-digit ZIP code."
    };
    Object.keys(checks).forEach(function (k) {
      var f = $("[data-f=" + k + "]", form);
      f.classList.toggle("err", !!checks[k]); $(".msg", f).textContent = checks[k];
      if (checks[k]) { if (ok) form[k].focus(); ok = false; }
    });
    return ok;
  }
})();
