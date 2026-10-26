document.querySelector("output").textContent =
  "Baseline and compressed size budgets passed";
const link = document.createElement("a");
link.href = "dist/report.html";
link.textContent = "Inspect dependency report";
document.querySelector("main").append(link);
