// Fires one lightweight visit ping per browser session. Respects Do-Not-Track,
// skips automated browsers, and never blocks or affects the page. See api/visit.js
// for what it does and doesn't capture (no email/identity — that's not available
// to any website; only referrer + approximate location + device).
(function () {
  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    if (navigator.webdriver) return;
    if (sessionStorage.getItem("v_pinged")) return;
    sessionStorage.setItem("v_pinged", "1");

    fetch("/api/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: location.pathname,
        referrer: document.referrer || "",
        tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || "",
      }),
      keepalive: true,
    }).catch(function () {});
  } catch (e) {
    /* never let analytics break the page */
  }
})();
