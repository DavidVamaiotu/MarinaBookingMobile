"use strict";

document.querySelector("#clearQueueIssues").addEventListener("click", () => {
  document.querySelector("[data-issue]").remove();
  document.querySelector("#clearQueueIssues").hidden = true;
  document.querySelector("#diagnosticSummary").textContent = "Conectare: da · în coadă: 1 · probleme: 0 · ultima sincronizare: astăzi";
});
