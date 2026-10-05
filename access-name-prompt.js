(() => {
  "use strict";

  function prepareInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.classList.contains("ml3d-access-name")) return;
    if (input.dataset.ml3dNativePrompt === "1") return;

    input.dataset.ml3dNativePrompt = "1";
    input.readOnly = true;
    input.setAttribute("inputmode", "none");
    input.setAttribute("autocomplete", "off");
    input.style.cursor = "pointer";

    const openPrompt = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const current = input.value || "";
      const value = window.prompt("Introduce tu nombre", current);
      if (value === null) return;

      input.value = value.trim().slice(0, 80);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    input.addEventListener("click", openPrompt, true);
    input.addEventListener("focus", () => input.blur(), true);
  }

  function scan(root = document) {
    root.querySelectorAll?.(".ml3d-access-name").forEach(prepareInput);
  }

  scan();

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(".ml3d-access-name")) prepareInput(node);
        scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
