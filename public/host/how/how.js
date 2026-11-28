// @ts-check
// "How Lock-In works": writes this server's own web address into the page, so the host sees
// the address their teams, display and console really use (the HTML carries a generic example).
(function () {
  "use strict";
  const host = location.host;
  if (!host) return;
  for (const el of document.querySelectorAll("[data-address]")) el.textContent = host;
})();
