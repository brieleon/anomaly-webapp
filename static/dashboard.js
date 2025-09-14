const pairSelect = document.getElementById("pairSelect");

// Load selected pair from localStorage or default to "all"
let selectedPair = localStorage.getItem("selectedPair") || "all";

let ws;
let reconnectTimeout = null;
const RECONNECT_DELAY = 5000; // 5 seconds
let pingInterval;

let focusedChart = null;
let focusedKey = null;
let focusedChartType = null;

function connectWebSocket() {
    ws = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + "/webapp/ws");

    ws.onopen = () => {
        console.log("WebSocket connected");
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        ws.send(JSON.stringify({ action: "refresh" }));
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "ping" }));
        }, 30000);
    };

    ws.onmessage = (event) => {
        const allData = JSON.parse(event.data);
        if (allData.action === "pong") return;
        window.lastAllData = allData;
        redrawCharts(allData);
    };

    ws.onerror = (event) => console.error("WebSocket error:", event);

    ws.onclose = () => {
        clearInterval(pingInterval);
        console.warn("WebSocket closed. Reconnecting in 5 seconds...");
        if (!reconnectTimeout) reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    };
}

connectWebSocket();

function redrawCharts(allData) {
    const chartsDiv = document.getElementById("charts");
    chartsDiv.innerHTML = "";

    // Update dropdown
    const pairs = Object.keys(allData);
    pairSelect.innerHTML = '<option value="all">All</option>';
    for (const p of pairs) {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        if (p === selectedPair) opt.selected = true;
        pairSelect.appendChild(opt);
    }

    for (const key in allData) {
        if (selectedPair !== "all" && selectedPair !== key) continue;
        const data = allData[key];
        const rowDiv = document.createElement("div");
        rowDiv.className = "row";
        rowDiv.dataset.key = key;

        function createChartContainer(title, chartDataFunc, chartType) {
            const container = document.createElement("div");
            container.className = "chart";

            const header = document.createElement("div");
            header.className = "chart-header";

            const titleEl = document.createElement("span");
            titleEl.className = "chart-title";
            titleEl.textContent = title;
            header.appendChild(titleEl);

            const btn = document.createElement("button");
            btn.className = "focus-button";
            btn.textContent = "Focus";

            btn.onclick = () => {
                const innerChartDiv = container.querySelector(".chart > div:last-child");

                // -----------------------------
                // UNFOCUS: Restore previous focused chart
                // -----------------------------
                if (focusedChart) {
                    focusedChart.classList.remove("full-screen");

                    // Restore container styles
                    focusedChart.style.width = focusedChart.dataset.originalWidth;
                    focusedChart.style.height = focusedChart.dataset.originalHeight;
                    focusedChart.style.flex = focusedChart.dataset.originalFlex;
                    focusedChart.style.margin = focusedChart.dataset.originalMargin;
                    focusedChart.style.padding = focusedChart.dataset.originalPadding;
                    focusedChart.style.border = focusedChart.dataset.originalBorder;
                    focusedChart.style.zIndex = "";

                    // Restore inner Plotly div
                    if (innerChartDiv && innerChartDiv.dataset.originalWidth) {
                        innerChartDiv.style.width = innerChartDiv.dataset.originalWidth;
                        innerChartDiv.style.height = innerChartDiv.dataset.originalHeight;

                        // <-- Use microtask to guarantee style applied before resize
                        Promise.resolve().then(() => Plotly.Plots.resize(innerChartDiv));
                    }

                    if (focusedChart === container) {
                        focusedChart = null;
                        focusedKey = null;
                        focusedChartType = null;
                        document.body.classList.remove("full-screen-active");
                        return;
                    }

                    focusedChart = null;
                    focusedKey = null;
                    focusedChartType = null;
                    document.body.classList.remove("full-screen-active");
                }

                // -----------------------------
                // FOCUS: Apply fullscreen
                // -----------------------------
                focusedChart = container;

                focusedChart.dataset.originalWidth = container.style.width || "";
                focusedChart.dataset.originalHeight = container.style.height || "";
                focusedChart.dataset.originalFlex = container.style.flex || "";
                focusedChart.dataset.originalMargin = container.style.margin || "";
                focusedChart.dataset.originalPadding = container.style.padding || "";
                focusedChart.dataset.originalBorder = container.style.border || "";

                if (innerChartDiv) {
                    innerChartDiv.dataset.originalWidth = innerChartDiv.style.width || "";
                    innerChartDiv.dataset.originalHeight = innerChartDiv.style.height || "";
                }

                focusedChart.style.flex = "none";
                container.classList.add("full-screen");
                focusedKey = key;
                focusedChartType = chartType;
                document.body.classList.add("full-screen-active");

                if (innerChartDiv) {
                    innerChartDiv.style.width = "100%";
                    innerChartDiv.style.height = "100%";

                    // <-- guarantee Plotly recalculates after full-screen CSS applied
                    setTimeout(() => Plotly.Plots.resize(innerChartDiv), 0);
                }
            };

            header.appendChild(btn);
            container.appendChild(header);

            const chartDiv = document.createElement("div");
            chartDiv.style.height = "90%";
            chartDiv.style.width = "100%";
            container.appendChild(chartDiv);

            chartDataFunc(chartDiv);
            return container;
        }


        // --- History chart ---
        const chartHist = createChartContainer("History", div => {
            const trace_rtp = { x: data.history_times, y: data.history_rtps, type: "scatter", mode: "lines", name: "RTP", line: { color: "blue" } };
            const trace_ewma1 = { x: data.history_times, y: data.ewma_1hr, type: "scatter", mode: "lines", name: "EWMA 1hr", line: { dash: "dot", color: "green" } };
            const trace_ewma24 = { x: data.history_times, y: data.ewma_24hr, type: "scatter", mode: "lines", name: "EWMA 24hr", line: { dash: "dot", color: "pink" } };
            const trace_ewma10 = { x: data.history_times, y: data.ewma_10day, type: "scatter", mode: "lines", name: "EWMA 10day", line: { dash: "dot", color: "purple" } };
            const trace_upper = { x: data.history_times, y: data.upper_band, type: "scatter", mode: "lines", name: "Upper Band", line: { color: "red" } };
            const trace_lower = { x: data.history_times, y: data.lower_band, type: "scatter", mode: "lines", name: "Lower Band", line: { color: "orange" } };
            const trace_anom = { x: data.anomaly_times, y: data.anomaly_values, mode: "markers", name: "Anomaly", marker: { color: "red", size: 8, symbol: "x" } };

            Plotly.newPlot(div, [trace_rtp, trace_ewma1, trace_ewma24, trace_ewma10, trace_upper, trace_lower, trace_anom],
                { autosize: true, margin: { t: 40, b: 50, l: 50, r: 50 }, xaxis: { title: "Time" }, yaxis: { title: "RTP" }, showlegend: true },
                { responsive: true, displayModeBar: true, modeBarButtonsToAdd: ['resetScale2d'] });

            const header = div.parentNode.querySelector(".chart-header");
            const existingTitle = header.querySelector(".chart-extra-title");
            if (existingTitle) existingTitle.remove();

            const headerTitle = document.createElement("div");
            headerTitle.className = "chart-extra-title";
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `History (${key})`;
            header.appendChild(headerTitle);
        }, "history");
        rowDiv.appendChild(chartHist);

        // --- Daily chart ---
        const chartDaily = createChartContainer("Daily RTP", div => {
            const trace_daily = { x: data.daily_times, y: data.daily_rtps, type: "scatter", mode: "lines+markers", name: "Daily RTP", line: { color: "blue" } };
            Plotly.newPlot(div, [trace_daily],
                { autosize: true, margin: { t: 40, b: 50, l: 50, r: 50 }, xaxis: { title: "Date" }, yaxis: { title: "RTP" }, showlegend: true },
                { responsive: true, displayModeBar: true, modeBarButtonsToAdd: ['resetScale2d'] });

            const header = div.parentNode.querySelector(".chart-header");
            const existingTitle = header.querySelector(".chart-extra-title");
            if (existingTitle) existingTitle.remove();

            const headerTitle = document.createElement("div");
            headerTitle.className = "chart-extra-title";
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `Daily (${key})`;
            header.appendChild(headerTitle);
        }, "daily");
        rowDiv.appendChild(chartDaily);

        // --- Forecast chart ---
        const chartFc = createChartContainer("Forecast", div => {
            const trace_obs = { x: data.forecast_times_obs, y: data.forecast_rtps_obs, type: "scatter", mode: "lines+markers", name: "Observed RTP" };
            const trace_fc = { x: data.forecast_times, y: data.forecast_yhat, type: "scatter", mode: "lines", name: "Forecast", line: { color: "green" } };
            const trace_band = {
                x: [...data.forecast_times, ...data.forecast_times.slice().reverse()],
                y: [...data.forecast_lower, ...data.forecast_upper.slice().reverse()],
                fill: "toself", fillcolor: "rgba(0,255,0,0.2)", line: { color: "transparent" }, name: "Forecast Band"
            };

            Plotly.newPlot(div, [trace_obs, trace_fc, trace_band],
                { autosize: true, margin: { t: 40, b: 50, l: 50, r: 50 }, xaxis: { title: "Time" }, yaxis: { title: "RTP" }, showlegend: true },
                { responsive: true, displayModeBar: true, modeBarButtonsToAdd: ['resetScale2d'] });

            const header = div.parentNode.querySelector(".chart-header");
            const existingTitle = header.querySelector(".chart-extra-title");
            if (existingTitle) existingTitle.remove();

            const headerTitle = document.createElement("div");
            headerTitle.className = "chart-extra-title";
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `Forecast (${key})`;
            header.appendChild(headerTitle);
        }, "forecast");
        rowDiv.appendChild(chartFc);

        chartsDiv.appendChild(rowDiv);
    }

    setTimeout(() => {
        const chartDivs = document.querySelectorAll(".chart div:last-child");
        chartDivs.forEach(div => Plotly.Plots.resize(div));
    }, 100);
}

// Set initial dropdown value
pairSelect.value = selectedPair;

pairSelect.addEventListener("change", () => {
    selectedPair = pairSelect.value;
    localStorage.setItem("selectedPair", selectedPair);
    if (window.lastAllData) redrawCharts(window.lastAllData);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "refresh" }));
});
