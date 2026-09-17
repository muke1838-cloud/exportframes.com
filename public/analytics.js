// Google Analytics 4, gated only where a consent choice is actually required.
//
// Visitors in the EEA, the United Kingdom and Switzerland get an explicit choice,
// and nothing is fetched or stored until they make it. Elsewhere the measurement
// runs without a banner, because those regions do not require prior consent for
// this kind of analytics. The country comes from /api/geo, which Cloudflare
// answers from the connection itself — no third-party lookup is involved.
(function () {
  "use strict";

  var MEASUREMENT_ID = "G-X1L2MKTHPT";
  var CONSENT_KEY = "ef_analytics_consent";
  var GEO_KEY = "ef_geo_country";

  // EEA (EU 27 + Iceland, Liechtenstein, Norway), plus the UK and Switzerland.
  var CONSENT_REGIONS = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
    "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
  ];

  function read(key, store) {
    try {
      return store.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function write(key, value, store) {
    try {
      store.setItem(key, value);
    } catch (err) {
      // Storage unavailable: the choice still applies to this page.
    }
  }

  function pageLocation() {
    return location.origin + location.pathname;
  }

  var loading = false;

  function queue() {
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
    }
    return window.gtag;
  }

  function loadTag() {
    if (loading) return;
    loading = true;
    var gtag = queue();
    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: pageLocation(),
    });
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
    document.head.appendChild(script);
  }

  function ask() {
    if (read(CONSENT_KEY, localStorage)) return;
    var bar = document.createElement("aside");
    bar.className = "consent";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Analytics choice");
    bar.innerHTML =
      '<p>Allow anonymous analytics? It shows which pages get read and which browsers fail. ' +
      'Your video is never involved. <a href="/privacy/">Privacy</a></p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn ghost" data-consent="declined">No thanks</button>' +
      '<button type="button" class="btn" data-consent="accepted">Allow analytics</button>' +
      "</div>";
    document.body.appendChild(bar);
    document.body.classList.add("has-consent");
    bar.addEventListener("click", function (event) {
      var button = event.target.closest("[data-consent]");
      if (!button) return;
      var choice = button.getAttribute("data-consent");
      write(CONSENT_KEY, choice, localStorage);
      document.body.classList.remove("has-consent");
      bar.remove();
      if (choice === "accepted") loadTag();
    });
  }

  function start() {
    if (!document.body) return;

    var choice = read(CONSENT_KEY, localStorage);
    if (choice === "accepted") {
      loadTag();
      return;
    }
    if (choice === "declined") return;

    var cached = read(GEO_KEY, sessionStorage);
    if (cached) {
      if (CONSENT_REGIONS.indexOf(cached) === -1) loadTag();
      else ask();
      return;
    }

    fetch("/api/geo", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("geo unavailable");
        return response.json();
      })
      .then(function (data) {
        var country = data && data.country ? String(data.country).toUpperCase() : "";
        // "XX" is Cloudflare's code for a country it could not determine (Tor, some
        // VPN exits). An unknown location is treated like a place that needs asking.
        var known = country.length === 2 && country !== "XX";
        if (known) write(GEO_KEY, country, sessionStorage);
        if (known && CONSENT_REGIONS.indexOf(country) === -1) loadTag();
        else ask();
      })
      .catch(function () {
        // Unknown location: fall back to asking, the safe reading of the rule.
        ask();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
