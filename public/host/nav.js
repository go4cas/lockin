// @ts-check
// Host console navigation (B0). Each section page includes this script and a
// <nav id="host-nav">; it marks the current section from <body data-section>.
(function () {
  "use strict";
  const SECTIONS = [
    { id: "build", label: "Library", href: "/host/build" },
    { id: "brand", label: "Branding", href: "/host/brand" },
    { id: "run", label: "Run night", href: "/host/run" },
    { id: "history", label: "History", href: "/host/history" },
  ];

  const nav = document.getElementById("host-nav");
  if (!nav) return;
  const current = document.body.dataset.section;

  const home = document.createElement("a");
  home.href = "/host";
  home.className = "host-brand";
  home.textContent = "Lock-In";
  nav.appendChild(home);

  const list = document.createElement("ul");
  for (const s of SECTIONS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.href;
    a.textContent = s.label;
    if (s.id === current) a.setAttribute("aria-current", "page");
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "host-signout";
  out.textContent = "Sign out";
  out.addEventListener("click", async () => {
    out.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      location.href = "/host/login";
    }
  });
  nav.appendChild(out);
})();
