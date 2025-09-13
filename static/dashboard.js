const ws = new WebSocket("ws://localhost:8000/ws");
const pairSelect = document.getElementById("pairSelect");
let focusedChart = null;
let focusedKey = null;
let focusedChartType = null;
let selectedPair = "all";  // persist selection

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
        if(p === selectedPair) opt.selected = true;
        pairSelect.appendChild(opt);
    }

    for (const key in allData) {
        if(selectedPair !== "all" && selectedPair !== key) continue;
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
                if(focusedChart){
                    // Unfocus
                    focusedChart.classList.remove("full-screen");
                    focusedChart.style.width = focusedChart.dataset.originalWidth;
                    focusedChart.style.height = focusedChart.dataset.originalHeight;
                    focusedChart.style.flex = "1"; // restore flex
                    Plotly.Plots.resize(focusedChart.querySelector(".chart > div:last-child")); 
                    focusedChart = null;
                    focusedKey = null;
                    focusedChartType = null;
                    document.body.style.overflow = "auto";
                } else {
                    // Focus
                    focusedChart = container;
                    focusedChart.dataset.originalWidth = container.style.width || container.offsetWidth + "px";
                    focusedChart.dataset.originalHeight = container.style.height || container.offsetHeight + "px";
                    focusedChart.style.flex = "none"; // remove flex restriction
                    container.classList.add("full-screen");
                    focusedKey = key;
                    focusedChartType = chartType;
                    document.body.style.overflow = "hidden";

                    // Resize inner chart
                    const innerChartDiv = container.querySelector(".chart > div:last-child");
                    innerChartDiv.style.width = "100%";
                    innerChartDiv.style.height = "100%";
                    Plotly.Plots.resize(innerChartDiv);
                }
            };

            header.appendChild(btn);
            container.appendChild(header);

            const chartDiv = document.createElement("div");
            chartDiv.style.height = "90%";
            chartDiv.style.width = "100%";
            container.appendChild(chartDiv);

            chartDataFunc(chartDiv);

            setTimeout(() => {
                Plotly.Plots.resize(chartDiv);
                // Restore focus mode after redraw
                if(focusedKey === key && focusedChartType === chartType){
                    container.classList.add("full-screen");
                    focusedChart = container;
                    document.body.style.overflow = "hidden";
                    Plotly.Plots.resize(chartDiv);
                }
            }, 0);

            return container;
        }

        // --- History chart ---
        const chartHist = createChartContainer("History", div => {
            const trace_rtp = { x: data.history_times, y: data.history_rtps, type: "scatter", mode: "lines", name: "RTP", line: {color: "blue"} };
            const trace_ewma1 = { x: data.history_times, y: data.ewma_1hr, type: "scatter", mode: "lines", name: "EWMA 1hr", line: {dash: "dot", color: "green"} };
            const trace_ewma24 = { x: data.history_times, y: data.ewma_24hr, type: "scatter", mode: "lines", name: "EWMA 24hr", line: {dash: "dot", color: "pink"} };
            const trace_ewma10 = { x: data.history_times, y: data.ewma_10day, type: "scatter", mode: "lines", name: "EWMA 10day", line: {dash: "dot", color: "purple"} };
            const trace_upper = { x: data.history_times, y: data.upper_band, type: "scatter", mode: "lines", name: "Upper Band", line: {color: "red"} };
            const trace_lower = { x: data.history_times, y: data.lower_band, type: "scatter", mode: "lines", name: "Lower Band", line: {color: "orange"} };
            const trace_anom = { x: data.anomaly_times, y: data.anomaly_values, mode: "markers", name: "Anomaly", marker: {color: "red", size: 8, symbol: "x"} };

            const layout = {
                autosize: true,
                margin: {t: 40, b: 50, l: 50, r: 50},
                xaxis: {title: "Time"},
                yaxis: {title: "RTP"},
                showlegend: true
            };

            Plotly.newPlot(div, [trace_rtp, trace_ewma1, trace_ewma24, trace_ewma10, trace_upper, trace_lower, trace_anom], layout, {responsive: true, displayModeBar: true, modeBarButtonsToAdd:['resetScale2d']});

            // External chart title
            const headerTitle = document.createElement("div");
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `History (${key})`;
            div.parentNode.querySelector(".chart-header").appendChild(headerTitle);
        }, "history");
        rowDiv.appendChild(chartHist);

        // --- Daily chart ---
        const chartDaily = createChartContainer("Daily RTP", div => {
            const trace_daily = { x: data.daily_times, y: data.daily_rtps, type: "scatter", mode: "lines+markers", name: "Daily RTP", line: {color: "blue"} };

            const layout = {
                autosize: true,
                margin: {t: 40, b: 50, l: 50, r: 50},
                xaxis: {title: "Date"},
                yaxis: {title: "RTP"},
                showlegend: true
            };

            Plotly.newPlot(div, [trace_daily], layout, {responsive: true, displayModeBar: true, modeBarButtonsToAdd:['resetScale2d']});

            const headerTitle = document.createElement("div");
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `Daily (${key})`;
            div.parentNode.querySelector(".chart-header").appendChild(headerTitle);
        }, "daily");
        rowDiv.appendChild(chartDaily);

        // --- Forecast chart ---
        const chartFc = createChartContainer("Forecast", div => {
            const trace_obs = { x: data.forecast_times_obs, y: data.forecast_rtps_obs, type: "scatter", mode: "lines+markers", name: "Observed RTP" };
            const trace_fc = { x: data.forecast_times, y: data.forecast_yhat, type: "scatter", mode: "lines", name: "Forecast", line: {color: "green"} };
            const trace_band = { x: [...data.forecast_times, ...data.forecast_times.slice().reverse()],
                                y: [...data.forecast_lower, ...data.forecast_upper.slice().reverse()],
                                fill: "toself", fillcolor: "rgba(0,255,0,0.2)", line: {color: "transparent"}, name: "Forecast Band" };

            const layout = {
                autosize: true,
                margin: {t: 40, b: 50, l: 50, r: 50},
                xaxis: {title: "Time"},
                yaxis: {title: "RTP"},
                showlegend: true
            };

            Plotly.newPlot(div, [trace_obs, trace_fc, trace_band], layout, {responsive: true, displayModeBar: true, modeBarButtonsToAdd:['resetScale2d']});

            const headerTitle = document.createElement("div");
            headerTitle.style.position = "absolute";
            headerTitle.style.top = "5px";
            headerTitle.style.left = "50%";
            headerTitle.style.transform = "translateX(-50%)";
            headerTitle.style.fontWeight = "bold";
            headerTitle.style.fontSize = "18px";
            headerTitle.textContent = `Forecast (${key})`;
            div.parentNode.querySelector(".chart-header").appendChild(headerTitle);
        }, "forecast");
        rowDiv.appendChild(chartFc);

        chartsDiv.appendChild(rowDiv);
    }

    setTimeout(() => {
        const chartDivs = document.querySelectorAll(".chart div:last-child");
        chartDivs.forEach(div => Plotly.Plots.resize(div));
    }, 100);
}

// WebSocket events
ws.onmessage = function(event) {
    const allData = JSON.parse(event.data);
    window.lastAllData = allData;  // store latest data
    redrawCharts(allData);
};

pairSelect.addEventListener("change", () => {
    selectedPair = pairSelect.value;
    if(window.lastAllData){
        redrawCharts(window.lastAllData); // immediate redraw
    }
    ws.send(JSON.stringify({action:"refresh"}));
});
