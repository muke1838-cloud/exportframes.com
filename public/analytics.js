// Google Analytics 4 behind an explicit consent gate.
//
// Nothing is fetched, and no cookie is written, until the visitor chooses
// "Allow analytics". The pattern matches the other sites in this workspace:
// the choice is remembered in local storage, the tag loads lazily, query
// strings are stripped from the reported page location, and ad personalisation
// plus Google Signals are disabled for this measurement.
(function () {
  "use strict";

  var MEASUREMENT_ID = "G-X1L2MKTHPT";
  var CONSENT_KEY = "ef_analytics_consent";

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (err) {
      // The choice still applies to this page when browser storage is unavailable.
    }
  }

  function pageLocation() {
    return location.origin + location.pathname;
  }

  var allowed = readConsent() === "accepted";
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
    if (!allowed || loading) return;
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
    if (readConsent()) return;
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
      saveConsent(choice);
      allowed = choice === "accepted";
      document.body.classList.remove("has-consent");
      bar.remove();
      if (allowed) loadTag();
    });
  }

  if (allowed) {
    // Already allowed on an earlier visit: this page view counts too.
    loadTag();
  } else {
    ask();
  }
})();
