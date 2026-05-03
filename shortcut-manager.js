(function () {
  "use strict";

  var shortcuts = [];

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = (target.tagName || "").toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "select" || tag === "textarea";
  }

  function comboFromEvent(event) {
    if (event.key === "?") return "?";
    var parts = [];
    if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    var key = event.key === " " ? "Space" : event.key;
    if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
    return parts.join("+");
  }

  function register(combo, label, handler) {
    shortcuts.push({ combo: combo, label: label, handler: handler });
  }

  function all() {
    return shortcuts.slice();
  }

  function handleKeydown(event) {
    if (isTypingTarget(event.target) && event.key !== "Escape") return;
    var combo = comboFromEvent(event);
    var item = shortcuts.find(function (shortcut) {
      return shortcut.combo === combo;
    });
    if (!item) return;
    event.preventDefault();
    item.handler(event);
  }

  document.addEventListener("keydown", handleKeydown);
  window.ShortcutManager = { register: register, all: all };
})();
