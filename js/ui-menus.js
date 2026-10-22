// =============================================================================
// Wahy Studio — Disclosure menus
// File: js/ui-menus.js
// The toolbars keep secondary actions in <details class="menu"> popovers.
// Only one menu is open at a time; a click outside, Escape, or choosing a
// command inside closes it. Choosing a value in a <select> keeps it open.
// =============================================================================

(function () {
  "use strict";

  const openMenus = () => document.querySelectorAll("details.menu[open]");

  document.addEventListener("click", (e) => {
    const inside = e.target.closest("details.menu");
    openMenus().forEach(m => {
      if (m !== inside) m.removeAttribute("open");
    });
    // A command button inside the panel runs, then the menu folds away
    const cmd = e.target.closest(".menu-panel button.menu-item:not([data-keep-open])");
    if (inside && cmd) inside.removeAttribute("open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    openMenus().forEach(m => {
      m.removeAttribute("open");
      m.querySelector("summary")?.focus();
    });
  });
})();
