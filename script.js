/* =========================================================
   Network Monitoring Dashboard - script.js

   IMPORTANT: this is a capacity ESTIMATION simulator.
   It does not measure real network traffic.

   Order of work when the user presses Calculate:
   read inputs -> validate -> calculate -> choose status -> show results
   ========================================================= */

/* ---------- 1. SETTINGS ---------- */

const HEALTHY_LIMIT = 80;   // below this percentage the link is Healthy
const FULL_LIMIT = 100;     // above this percentage the link is Overloaded
const METER_MAX = 150;      // the progress bar is drawn from 0% to 150%

// Allowed range for each input. The names match the input ids in index.html.
const FIELDS = {
  users:     { name: "Number of active users", min: 1,    max: 100000,  wholeOnly: true },
  bandwidth: { name: "Bandwidth per user",     min: 0.01, max: 10000,   wholeOnly: false },
  capacity:  { name: "Link capacity",          min: 0.01, max: 1000000, wholeOnly: false }
};

// Test scenarios. Values are text because HTML inputs also give us text.
// "expected" is either a result or the name of the field that must show an error.
const testCases = [
  { name: "Healthy link",         users: "10",  bandwidth: "2",  capacity: "50",  expected: { utilisation: 40,  status: "Healthy" } },
  { name: "Start of near range",  users: "20",  bandwidth: "2",  capacity: "50",  expected: { utilisation: 80,  status: "Near capacity" } },
  { name: "Full capacity",        users: "25",  bandwidth: "2",  capacity: "50",  expected: { utilisation: 100, status: "Full capacity" } },
  { name: "Overloaded link",      users: "30",  bandwidth: "2",  capacity: "50",  expected: { utilisation: 120, status: "Overloaded" } },
  { name: "Zero capacity",        users: "10",  bandwidth: "2",  capacity: "0",   expected: { errorIn: "capacity" } },
  { name: "Negative users",       users: "-5",  bandwidth: "2",  capacity: "50",  expected: { errorIn: "users" } },
  { name: "Negative bandwidth",   users: "10",  bandwidth: "-2", capacity: "50",  expected: { errorIn: "bandwidth" } },
  { name: "Negative capacity",    users: "10",  bandwidth: "2",  capacity: "-50", expected: { errorIn: "capacity" } },
  { name: "Decimal users",        users: "2.5", bandwidth: "2",  capacity: "50",  expected: { errorIn: "users" } },
  { name: "Empty bandwidth",      users: "10",  bandwidth: "",   capacity: "50",  expected: { errorIn: "bandwidth" } },
  { name: "Decimal values",       users: "3",   bandwidth: "0.1", capacity: "0.3", expected: { utilisation: 100, status: "Full capacity" } }
];

// The latest valid result, or null when there is nothing to show
let latest = null;

// The largest values on the line chart's two axes
let chartMax = { users: 1, mbps: 1 };

/* ---------- 2. SMALL HELPERS ---------- */

// Short way to find an element by its id
function getElement(id) {
  return document.getElementById(id);
}

// Put text inside an element
function setText(id, text) {
  getElement(id).textContent = text;
}

// Computers store some decimals inexactly (0.1 * 3 gives 0.30000000000000004).
// Rounding to 6 decimals removes that tiny error.
function cleanNumber(number) {
  return Number(number.toFixed(6));
}

// Make a number easy to read, for example 1234.5 -> "1,234.5".
// Very small numbers keep more decimals so they do not appear as 0.
function formatNumber(number) {
  const decimals = Math.abs(number) < 0.01 ? 6 : 2;
  return number.toLocaleString("en-GB", { maximumFractionDigits: decimals });
}

function formatMbps(number) {
  return formatNumber(number) + " Mbps";
}

// Show a percentage. Rounding must never make 79.999 look like "80%" or
// 100.001 look like "100%", because the status would then seem wrong.
function formatPercent(number) {
  const rounded = Number(number.toFixed(2));
  if (rounded === HEALTHY_LIMIT || rounded === FULL_LIMIT) {
    return number + "%";
  }
  return formatNumber(number) + "%";
}

/* ---------- 3. READING AND VALIDATING INPUTS ---------- */

// Read the text typed into the three boxes
function readInputs() {
  return {
    users: getElement("users").value,
    bandwidth: getElement("bandwidth").value,
    capacity: getElement("capacity").value
  };
}

// Check one value. Returns an error message, or "" when the value is fine.
function checkField(fieldId, text) {
  const field = FIELDS[fieldId];
  const trimmed = text.trim();
  const number = Number(trimmed);

  // A number box also gives empty text when letters are typed into it
  if (trimmed === "" || !Number.isFinite(number)) {
    return field.name + " must be filled in with a valid number.";
  }
  if (number < 0) {
    return field.name + " cannot be negative.";
  }
  if (number === 0) {
    // For capacity, this check is what prevents division by zero
    return fieldId === "capacity"
      ? "Link capacity must be greater than zero, because we cannot divide by zero."
      : field.name + " must be greater than zero.";
  }
  if (field.wholeOnly && !Number.isInteger(number)) {
    return field.name + " must be a whole number, such as 25.";
  }
  if (number < field.min || number > field.max) {
    return field.name + " must be between " + formatNumber(field.min) + " and " + formatNumber(field.max) + ".";
  }
  return "";
}

// Check all three values. Returns an object holding any error messages.
function validateInputs(inputs) {
  const errors = {};
  for (const fieldId in FIELDS) {
    const message = checkField(fieldId, inputs[fieldId]);
    if (message !== "") {
      errors[fieldId] = message;
    }
  }
  return errors;
}

/* ---------- 4. CALCULATIONS ---------- */

// Apply the three project formulas
function calculateResults(inputs) {
  const users = Number(inputs.users);
  const bandwidth = Number(inputs.bandwidth);
  const capacity = Number(inputs.capacity);

  const demand = cleanNumber(users * bandwidth);
  const utilisation = cleanNumber((demand / capacity) * 100);
  const remaining = cleanNumber(capacity - demand);

  return { users, bandwidth, capacity, demand, utilisation, remaining };
}

// Choose the status. "level" selects the colour in style.css.
function getStatus(utilisation) {
  if (utilisation < HEALTHY_LIMIT) {
    return { level: "healthy", label: "Healthy", icon: "✓" };
  }
  if (utilisation < FULL_LIMIT) {
    return { level: "near", label: "Near capacity", icon: "!" };
  }
  if (utilisation === FULL_LIMIT) {
    return { level: "near", label: "Full capacity", icon: "!" };
  }
  return { level: "overloaded", label: "Overloaded", icon: "✕" };
}

// Find the largest number of users that keeps utilisation BELOW 80%
function getMaxHealthyUsers(result) {
  const healthyBandwidth = result.capacity * (HEALTHY_LIMIT / 100);
  const usersAtLimit = cleanNumber(healthyBandwidth / result.bandwidth);
  return Math.ceil(usersAtLimit) - 1;   // exactly 80% is already "near", so step back
}

// Find the link capacity at which this demand would be 80%.
// Always rounded UP to 2 decimals, so the suggestion is never too small.
function getHealthyCapacity(demand) {
  const exactCapacity = demand / (HEALTHY_LIMIT / 100);
  return Math.ceil(cleanNumber(exactCapacity * 100)) / 100;
}

// Choose the warning message, main action and list of recommendations
function getAdvice(result, status) {
  const maxHealthyUsers = getMaxHealthyUsers(result);
  const healthyCapacity = formatMbps(getHealthyCapacity(result.demand));

  // This sentence is used for both the orange and the red status
  const userLimitTip = maxHealthyUsers >= 1
    ? "On the current link, about " + formatNumber(maxHealthyUsers) + " active user(s) or fewer would stay below 80%."
    : "Even one user at this bandwidth would reach 80% or more, so a larger link is needed.";

  if (status.level === "healthy") {
    const extraUsers = maxHealthyUsers - result.users;
    return {
      warning: "The link is estimated to support peak demand with room to spare.",
      action: "No upgrade needed. Review again as the office grows.",
      tips: [
        extraUsers >= 1
          ? "About " + formatNumber(extraUsers) + " more user(s) could join while staying below 80%."
          : "Adding one more user would take the link to 80% or more, so plan before growing.",
        "Keep the spare bandwidth as a buffer for short bursts of traffic.",
        "Recalculate before adding heavy services such as video calls or cloud backup."
      ]
    };
  }

  if (status.level === "near") {
    const isFull = status.label === "Full capacity";
    return {
      warning: isFull
        ? "Warning: estimated demand uses the whole link. There is no spare bandwidth, so any increase would overload it."
        : "Warning: the link is close to its limit. Extra users or a burst of traffic could cause congestion.",
      action: "Plan an upgrade and reduce heavy traffic at peak times.",
      tips: [
        "Plan for a link of more than " + healthyCapacity + " to bring utilisation below 80%.",
        userLimitTip,
        "Move large downloads, updates and backups outside busy hours.",
        "Use Quality of Service (QoS) to give priority to calls and business apps."
      ]
    };
  }

  // Only the overloaded status is left
  return {
    warning: "Capacity warning: estimated demand is " + formatMbps(-result.remaining) +
             " more than the link can carry. Expect congestion and slow connections.",
    action: "Increase link capacity or reduce peak demand.",
    tips: [
      "At least " + formatMbps(result.demand) + " is needed just to meet demand. For a healthy link, choose more than " + healthyCapacity + ".",
      userLimitTip,
      "Limit non-essential streaming and large downloads at peak times.",
      "Use Quality of Service (QoS) to protect important traffic until the link is upgraded."
    ]
  };
}

/* ---------- 5. SHOWING RESULTS ON THE PAGE ---------- */

// Show an error under each wrong field and clear the correct ones
function showErrors(errors) {
  for (const fieldId in FIELDS) {
    const message = errors[fieldId] || "";
    const input = getElement(fieldId);
    setText(fieldId + "Error", message);
    input.closest(".field").classList.toggle("invalid", message !== "");
    input.setAttribute("aria-invalid", message !== "");
  }
}

// Draw ten small bars and light up some of them. "share" is from 0 to 1.
function showMiniBars(id, share) {
  const box = getElement(id);
  const litCount = Math.round(Math.min(share, 1) * 10);
  box.replaceChildren();
  for (let i = 1; i <= 10; i++) {
    const bar = document.createElement("span");
    bar.style.height = i * 10 + "%";
    bar.classList.toggle("lit", i <= litCount);
    box.append(bar);
  }
}

function showSummaryCards(result) {
  const isShort = result.remaining < 0;
  setText("demandValue", formatMbps(result.demand));
  setText("capacityValue", formatMbps(result.capacity));
  setText("utilisationValue", formatPercent(result.utilisation));

  // The last card changes between "remaining" and "shortage"
  setText("remainingTitle", isShort ? "Estimated shortage" : "Estimated remaining");
  setText("remainingValue", formatMbps(Math.abs(result.remaining)));
  setText("remainingHint", isShort ? "Above capacity" : "Capacity − demand");
  getElement("remainingCard").classList.toggle("red", isShort);

  const largest = Math.max(result.demand, result.capacity);
  showMiniBars("demandMini", result.demand / largest);
  showMiniBars("capacityMini", result.capacity / largest);
  showMiniBars("utilisationMini", result.utilisation / 100);
  showMiniBars("remainingMini", Math.abs(result.remaining) / largest);
}

// Update the donut, the status badge and the warning message
function showStatus(result, status, advice) {
  getElement("board").dataset.level = status.level;   // changes the colours
  setText("statusIcon", status.icon);
  setText("statusLabel", status.label);
  setText("warningMessage", advice.warning);
  setText("mainAction", advice.action);

  // Very large percentages would not fit inside the donut
  setText("bigUtilisation", result.utilisation > 9999 ? ">9,999%" : formatPercent(result.utilisation));
  const filled = Math.min(result.utilisation, 100);
  getElement("ring").setAttribute("stroke-dasharray", filled + " 100");
}

// Change the width of the progress bar (it stops growing at 150%)
function showMeter(utilisation, description) {
  const limited = Math.min(utilisation, METER_MAX);
  getElement("meterFill").style.width = (limited / METER_MAX) * 100 + "%";
  getElement("meter").setAttribute("aria-valuenow", limited);
  getElement("meter").setAttribute("aria-valuetext", description);
}

function showRecommendations(tips) {
  const list = getElement("recommendationList");
  list.replaceChildren();
  for (const tip of tips) {
    const item = document.createElement("li");
    item.textContent = tip;
    list.append(item);
  }
}

// Show the formulas with the user's own numbers inside them
function showWorking(result) {
  setText("workingDemand",
    formatNumber(result.users) + " × " + formatNumber(result.bandwidth) + " = " + formatMbps(result.demand));
  setText("workingUtilisation",
    "(" + formatNumber(result.demand) + " ÷ " + formatNumber(result.capacity) + ") × 100 = " + formatPercent(result.utilisation));
  setText("workingRemaining",
    formatNumber(result.capacity) + " − " + formatNumber(result.demand) + " = " + formatMbps(result.remaining));
}

// Update every part of the dashboard
function showResults(result) {
  const status = getStatus(result.utilisation);
  const advice = getAdvice(result, status);
  latest = result;

  showSummaryCards(result);
  showStatus(result, status, advice);
  showMeter(result.utilisation, formatPercent(result.utilisation) + ", " + status.label);
  showBarChart(result);
  showLineChart(result);
  showRecommendations(advice.tips);
  showWorking(result);
}

// Put the dashboard back to its starting state
function showEmptyResults(label, message) {
  latest = null;

  const valueIds = ["demandValue", "capacityValue", "utilisationValue", "remainingValue", "bigUtilisation",
                    "mainAction", "demandBarValue", "healthyBarValue", "capacityBarValue"];
  for (const id of valueIds) {
    setText(id, "—");
  }
  for (const id of ["workingDemand", "workingUtilisation", "workingRemaining"]) {
    setText(id, "Waiting for values");
  }
  for (const id of ["demandMini", "capacityMini", "utilisationMini", "remainingMini"]) {
    showMiniBars(id, 0);
  }

  getElement("board").dataset.level = "empty";
  setText("statusIcon", "–");
  setText("statusLabel", label);
  setText("warningMessage", message);
  setText("remainingTitle", "Estimated remaining");
  setText("remainingHint", "Capacity − demand");
  getElement("remainingCard").classList.remove("red");
  getElement("ring").setAttribute("stroke-dasharray", "0 100");
  showMeter(0, "No result yet");
  showRecommendations(["Press Calculate to see recommendations."]);

  // Clear both charts
  for (const id of ["demandBar", "healthyBar", "capacityBar"]) {
    getElement(id).style.height = "0";
  }
  for (const id of ["barAxisY", "lineAxisY", "lineAxisX"]) {
    getElement(id).replaceChildren();
  }
  for (const id of ["marker", "markerLine", "bubble", "barTooltip"]) {
    getElement(id).hidden = true;
  }
  getElement("lines").toggleAttribute("hidden", true);
  getElement("userSlider").disabled = true;
  setText("chartSummary", "Press Calculate to see the comparison.");
}

/* ---------- 6. CHARTS ---------- */

// Choose tidy axis numbers: steps of 1, 2, 5 or 10 times a power of ten
function getAxis(largestValue) {
  const roughStep = largestValue / 4;
  const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
  let step = 10 * power;
  for (const size of [5, 2, 1]) {
    if (size * power >= roughStep) {
      step = size * power;
    }
  }
  const count = Math.ceil(cleanNumber(largestValue / step));
  return { step: step, count: count, max: step * count };
}

// Draw the grid lines and numbers. "direction" is "x" or "y".
function drawAxis(id, axis, direction) {
  const box = getElement(id);
  box.replaceChildren();
  for (let i = 0; i <= axis.count; i++) {
    const tick = document.createElement("div");
    const number = document.createElement("span");
    tick.className = "tick " + direction;
    tick.style[direction === "x" ? "left" : "bottom"] = (i / axis.count) * 100 + "%";
    number.textContent = (axis.step * i).toLocaleString("en-GB", { notation: "compact" });
    tick.append(number);
    box.append(tick);
  }
}

function showBarChart(result) {
  const healthy = cleanNumber(result.capacity * HEALTHY_LIMIT / 100);
  const axis = getAxis(Math.max(result.demand, result.capacity));
  drawAxis("barAxisY", axis, "y");

  // Bar height = its share of the axis maximum
  getElement("demandBar").style.height = (result.demand / axis.max) * 100 + "%";
  getElement("healthyBar").style.height = (healthy / axis.max) * 100 + "%";
  getElement("capacityBar").style.height = (result.capacity / axis.max) * 100 + "%";
  setText("demandBarValue", formatNumber(result.demand));
  setText("healthyBarValue", formatNumber(healthy));
  setText("capacityBarValue", formatNumber(result.capacity));

  // One sentence that explains what the chart shows
  let sentence = "Estimated demand exactly matches capacity.";
  if (result.remaining > 0) {
    sentence = "Estimated demand is " + formatMbps(result.remaining) + " below capacity.";
  } else if (result.remaining < 0) {
    sentence = "Estimated demand is " + formatMbps(-result.remaining) + " above capacity.";
  }
  setText("chartSummary", sentence);
}

// The line chart repeats the demand formula for different numbers of users
function showLineChart(result) {
  // Leave 25% extra space after the current users and after the full-capacity point
  const usersAtFull = result.capacity / result.bandwidth;
  const xAxis = getAxis(Math.max(4, result.users * 1.25, usersAtFull * 1.25));
  const yAxis = getAxis(Math.max(xAxis.max * result.bandwidth, result.capacity));
  drawAxis("lineAxisX", xAxis, "x");
  drawAxis("lineAxisY", yAxis, "y");
  chartMax = { users: xAxis.max, mbps: yAxis.max };

  // In the drawing, 0 is the top and 100 is the bottom
  const demandY = getLineY(xAxis.max * result.bandwidth);
  const capacityY = getLineY(result.capacity);
  const healthyY = getLineY(result.capacity * HEALTHY_LIMIT / 100);
  getElement("demandLine").setAttribute("y2", demandY);
  getElement("demandArea").setAttribute("points", "0,100 100," + demandY + " 100,100");
  for (const [id, y] of [["capacityLine", capacityY], ["healthyLine", healthyY]]) {
    getElement(id).setAttribute("y1", y);
    getElement(id).setAttribute("y2", y);
  }
  getElement("lines").toggleAttribute("hidden", false);

  const slider = getElement("userSlider");
  slider.disabled = false;
  slider.max = xAxis.max;
  slider.value = result.users;
  moveMarker();
}

// Convert Mbps into a vertical position in the line chart
function getLineY(mbps) {
  return 100 - (mbps / chartMax.mbps) * 100;
}

// Move the line chart marker to the number of users on the slider
function moveMarker() {
  const users = Number(getElement("userSlider").value);
  const estimate = calculateResults({ users: users, bandwidth: latest.bandwidth, capacity: latest.capacity });
  const x = (users / chartMax.users) * 100;
  const y = getLineY(estimate.demand);

  const marker = getElement("marker");
  const bubble = getElement("bubble");
  marker.style.left = x + "%";
  marker.style.top = y + "%";
  getElement("markerLine").style.left = x + "%";

  bubble.textContent = formatNumber(users) + " users: " + formatMbps(estimate.demand) + ", " + formatPercent(estimate.utilisation);
  bubble.style.left = x + "%";
  bubble.style.top = "calc(" + y + "% - 14px)";
  bubble.style.transform = "translate(-" + x + "%, -100%)";   // keeps it inside the chart

  for (const id of ["marker", "markerLine", "bubble"]) {
    getElement(id).hidden = false;
  }
  getElement("userSlider").setAttribute("aria-valuetext", bubble.textContent);
}

// Moving the mouse over the line chart moves the slider too
function handleChartMouse(event) {
  if (latest === null) {
    return;
  }
  const area = getElement("linePlot").getBoundingClientRect();
  const share = (event.clientX - area.left) / area.width;
  getElement("userSlider").value = Math.round(share * chartMax.users);
  moveMarker();
}

// When the mouse leaves, go back to the number of users that was calculated
function handleChartLeave() {
  if (latest !== null) {
    getElement("userSlider").value = latest.users;
    moveMarker();
  }
}

// Text for the bar chart tooltips
function getBarText(columnId) {
  if (columnId === "demandColumn") {
    return formatNumber(latest.users) + " users × " + formatMbps(latest.bandwidth) + " (estimate)";
  }
  if (columnId === "healthyColumn") {
    return "Healthy use is below " + formatMbps(cleanNumber(latest.capacity * HEALTHY_LIMIT / 100));
  }
  return formatMbps(latest.capacity) + " shared by everyone";
}

function showTooltip(columnId) {
  if (latest === null) {
    return;   // nothing to explain yet
  }
  const tooltip = getElement("barTooltip");
  tooltip.textContent = getBarText(columnId);
  tooltip.style.left = "50%";
  tooltip.style.top = "-8px";
  tooltip.style.transform = "translate(-50%, -100%)";
  tooltip.hidden = false;
}

function hideTooltip() {
  getElement("barTooltip").hidden = true;
}

/* ---------- 7. BUTTON ACTIONS ---------- */

function handleCalculate(event) {
  event.preventDefault();   // stops the form from reloading the page

  const inputs = readInputs();
  const errors = validateInputs(inputs);
  showErrors(errors);
  getElement("staleNote").hidden = true;

  const wrongFields = Object.keys(errors);
  if (wrongFields.length > 0) {
    showEmptyResults("Check inputs", "Please correct the highlighted fields, then press Calculate again.");
    getElement(wrongFields[0]).focus();   // move to the first mistake
    return;
  }
  showResults(calculateResults(inputs));
}

function handleReset() {
  getElement("calculatorForm").reset();
  getElement("exampleSelect").value = "";
  showErrors({});
  getElement("staleNote").hidden = true;
  showEmptyResults("Awaiting input", "Enter the network details and press Calculate.");
  getElement("users").focus();
}

// When the user types, remind them that the old results need updating
function handleTyping() {
  getElement("exampleSelect").value = "";
  getElement("staleNote").hidden = latest === null;
}

// Copy an example into the form and calculate it
function loadExample(testNumber) {
  const test = testCases[testNumber];
  for (const fieldId in FIELDS) {
    getElement(fieldId).value = test[fieldId];
  }
  getElement("calculatorForm").requestSubmit();   // same as pressing Calculate
}

// Highlight the navigation icon of the section being viewed:
// the last section whose top has passed the middle of the screen
function highlightSection() {
  let current = "dashboard";
  for (const id of ["analysis", "concepts", "formulas", "tests"]) {
    if (getElement(id).getBoundingClientRect().top < window.innerHeight / 2) {
      current = id;
    }
  }
  for (const link of document.querySelectorAll(".rail a")) {
    link.classList.toggle("active", link.getAttribute("href") === "#" + current);
  }
}

/* ---------- 8. BUILT-IN TESTS ---------- */

// Run one test. Returns the actual outcome and whether it passed.
function runOneTest(test) {
  const errors = validateInputs(test);
  const wrongFields = Object.keys(errors);

  if (wrongFields.length > 0) {
    const passed = wrongFields.length === 1 && wrongFields[0] === test.expected.errorIn;
    return { actual: errors[wrongFields[0]], passed: passed };
  }

  const result = calculateResults(test);
  const status = getStatus(result.utilisation);
  return {
    actual: status.label + ", " + formatPercent(result.utilisation),
    passed: result.utilisation === test.expected.utilisation && status.label === test.expected.status
  };
}

// Build the test table. When runTests is false, only the plan is shown.
function showTests(runTests) {
  const tableBody = getElement("testRows");
  let passedCount = 0;
  tableBody.replaceChildren();

  for (const test of testCases) {
    const expected = test.expected.errorIn
      ? "Validation error"
      : test.expected.status + ", " + test.expected.utilisation + "%";
    const outcome = runTests ? runOneTest(test) : null;
    if (outcome !== null && outcome.passed) {
      passedCount++;
    }

    const cells = [test.name, test.users, test.bandwidth || "(empty)", test.capacity, expected,
                   outcome === null ? "—" : outcome.actual,
                   outcome === null ? "Not run" : (outcome.passed ? "✓ Pass" : "✕ Fail")];

    const row = document.createElement("tr");
    for (const text of cells) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    if (outcome !== null) {
      row.lastChild.className = outcome.passed ? "pass" : "fail";
    }
    tableBody.append(row);
  }

  if (runTests) {
    setText("testSummary", passedCount + " of " + testCases.length + " tests passed.");
  }
}

/* ---------- 9. CONNECT THE PAGE TO THE FUNCTIONS ---------- */

getElement("calculatorForm").addEventListener("submit", handleCalculate);
getElement("calculatorForm").addEventListener("input", handleTyping);
getElement("resetButton").addEventListener("click", handleReset);
getElement("runTestsButton").addEventListener("click", () => showTests(true));

getElement("exampleSelect").addEventListener("change", (event) => {
  if (event.target.value !== "") {
    loadExample(Number(event.target.value));
  }
});

// Line chart: slider, keyboard and mouse
getElement("userSlider").addEventListener("input", moveMarker);
getElement("linePlot").addEventListener("mousemove", handleChartMouse);
getElement("linePlot").addEventListener("mouseleave", handleChartLeave);

// Bar chart: show a tooltip on mouse hover and on keyboard focus (or tap)
for (const columnId of ["demandColumn", "healthyColumn", "capacityColumn"]) {
  const column = getElement(columnId);
  column.addEventListener("mouseenter", () => showTooltip(columnId));
  column.addEventListener("focus", () => showTooltip(columnId));
  column.addEventListener("mouseleave", hideTooltip);
  column.addEventListener("blur", hideTooltip);
}

window.addEventListener("scroll", highlightSection);

// Start with an example so the dashboard is not empty
showTests(false);
getElement("exampleSelect").value = "0";
loadExample(0);
