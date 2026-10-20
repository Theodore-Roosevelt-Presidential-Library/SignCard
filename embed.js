/*
 * SignCard embed — card.labs.trlibrary.com
 *
 * Paste where the card should appear:
 *   <div data-signcard="tr-birthday-2026"></div>
 *   <script src="https://card.labs.trlibrary.com/embed.js" async></script>
 *
 * The card loads in an iframe that grows to fit its content and scrolls the page to the right spot
 * as the visitor moves through it. The iframe may use the microphone (blowing out the candles) only
 * after the visitor taps "Use my mic" and allows it.
 */
(function () {
  "use strict";
  var me = document.currentScript;
  var base = (me && me.src ? me.src : "https://card.labs.trlibrary.com/embed.js").replace(/embed\.js(\?.*)?$/, "");
  function mount(el) {
    if (el.getAttribute("data-signcard-ready")) return;
    el.setAttribute("data-signcard-ready", "1");
    var id = el.getAttribute("data-signcard") || "";
    var f = document.createElement("iframe");
    f.src = base + "?embed=1" + (id ? "&c=" + encodeURIComponent(id) : "");
    f.title = el.getAttribute("data-title") || "Sign the card";
    f.loading = "lazy";
    f.allow = "microphone; clipboard-write; web-share";
    f.style.cssText = "display:block;width:100%;border:0;height:720px;overflow:hidden;background:transparent";
    f.setAttribute("scrolling", "no");
    el.appendChild(f);
    window.addEventListener("message", function (e) {
      if (e.source !== f.contentWindow || !e.data || typeof e.data !== "object") return;
      if (e.data.type === "signcard:height" && e.data.height > 100) f.style.height = e.data.height + "px";
      if (e.data.type === "signcard:scroll") {
        var header = document.getElementById("top-header");
        var offset = header && getComputedStyle(header).position === "fixed" ? header.offsetHeight : 0;
        var top = f.getBoundingClientRect().top + window.pageYOffset + (e.data.top || 0) - offset - 8;
        window.scrollTo({ top: top, behavior: "smooth" });
      }
      if (e.data.type === "signcard:signed" && window.dataLayer) window.dataLayer.push({ event: "signcard_signed", signcard_campaign: e.data.campaign });
    });
  }
  function run() { Array.prototype.forEach.call(document.querySelectorAll("[data-signcard]"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
