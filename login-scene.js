// Decorative behavior only: never reads input values or sends data.
(() => {
  "use strict";
  const dialog = document.getElementById("account-dialog");
  const panel = dialog?.querySelector(".account-brand-panel");
  if (!panel) return;
  const error = document.getElementById("account-error");
  let clock = null;
  function updateTime() {
    const hour = new Date().getHours();
    panel.dataset.ranchTime = hour < 5 || hour >= 20 ? "night" : hour < 8 ? "dawn" : hour < 17 ? "day" : "dusk";
  }
  function updateFocus() {
    const el = document.activeElement;
    dialog.dataset.sceneFocus = dialog.contains(el) && el.matches('input[type="password"]') ? "password" : dialog.contains(el) && el.matches('input[type="email"]') ? "email" : "idle";
  }
  function updateOpen() {
    if (dialog.open) {
      updateTime(); updateFocus();
      if (clock === null) clock = setInterval(updateTime, 60000);
    } else {
      clearInterval(clock); clock = null;
      dialog.dataset.sceneFocus = "idle";
    }
  }
  dialog.addEventListener("focusin", updateFocus);
  dialog.addEventListener("focusout", () => queueMicrotask(updateFocus));
  new MutationObserver(updateOpen).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  if (error) new MutationObserver(() => {
    dialog.dataset.sceneError = String(!error.hidden && !error.classList.contains("account-success"));
  }).observe(error, { attributes: true, attributeFilter: ["hidden", "class"], childList: true });
  updateTime(); updateOpen();
})();
