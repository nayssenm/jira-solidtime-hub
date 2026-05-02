(function () {
  'use strict';

  try {
    if (window._healthWidgetLoaded) return;

    var script = document.createElement('script');
    script.src = 'health_widget.js';
    script.defer = true;
    script.onerror = function () {
      console.warn('[health-widget] health_widget.js could not be loaded; dashboard continues without it.');
    };
    document.head.appendChild(script);
  } catch (err) {
    console.warn('[health-widget] Loader disabled safely:', err);
  }
})();
