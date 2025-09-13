from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import json, redis, asyncio
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from prophet import Prophet



app = FastAPI()

# --- Redis ---
rdb = redis.Redis(host="localhost", port=6379, decode_responses=True)

# --- Mount static files ---
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- Serve HTML template ---
@app.get("/")
async def get_dashboard():
    with open("templates/dashboard.html") as f:
        html_content = f.read()
    return HTMLResponse(html_content)

# --- WebSocket endpoint remains the same ---
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            all_pairs = {}
            try:
                keys = rdb.keys("ewma_buffer:*")
                for k in keys:
                    parts = k.split(":")
                    if len(parts) != 3: continue
                    game, vendor = parts[1], parts[2]
                    buffer_key = f"ewma_buffer:{game}:{vendor}"
                    hist_key = f"rtp:history:{game}:{vendor}"
                    daily_key = f"rtp:daily:{game}:{vendor}"

                    # --- Fetch EWMA buffer ---
                    buf_raw = rdb.get(buffer_key)
                    if not buf_raw: continue
                    buf = json.loads(buf_raw)

                    # --- Forecast ---
                    hourly_rtp_list = buf.get("per_hour_rtp", [])
                    data_points = []
                    for entry in hourly_rtp_list:
                        if isinstance(entry, dict):
                            ts = entry.get("ts")
                            val = entry.get("value") or entry.get("hourly_rtp") or entry.get("rtp")
                            if ts and val is not None:
                                dt = datetime.utcfromtimestamp(ts)
                                data_points.append({"ds": dt, "y": val})
                    if len(data_points) < 6: continue
                    df = pd.DataFrame(data_points).sort_values("ds")
                    model = Prophet(interval_width=0.95)
                    model.fit(df)
                    future = model.make_future_dataframe(periods=24, freq="H")
                    forecast = model.predict(future)

                    # --- History last 24h ---
                    history_raw = rdb.lrange(hist_key, 0, -1)
                    last_12h_ts = datetime.utcnow() - timedelta(hours=12)
                    timestamps, rtps, ewma_1hr, ewma_24hr, ewma_10day, upper_band, lower_band, anomalies = [], [], [], [], [], [], [], []
                    for item in history_raw:
                        record = json.loads(item)
                        ts = datetime.utcfromtimestamp(record["ts"])
                        if ts < last_12h_ts: continue
                        timestamps.append(ts)
                        rtps.append(record["rtp"])
                        ewma_1hr.append(record.get("ewma_1hr"))
                        ewma_24hr.append(record.get("ewma_24hr"))
                        ewma_10day.append(record.get("ewma_10day"))
                        upper_band.append(record.get("upper_band"))
                        lower_band.append(record.get("lower_band"))
                        if record.get("anomaly"):
                            # Use anomaly_ts if present, fallback to original ts
                            anomaly_peak_ts = record.get("anomaly_ts", record["ts"])
                            anomaly_peak_val = record.get("anomaly_rtp", record["rtp"])  # prefer spike_rtp
                            anomalies.append((datetime.utcfromtimestamp(anomaly_peak_ts), anomaly_peak_val))

                    anomaly_times = [a[0].strftime("%Y-%m-%d %H:%M") for a in anomalies]
                    anomaly_values = [a[1] for a in anomalies]

                    # --- Daily RTP ---
                    daily_raw = rdb.lrange(daily_key, 0, -1)
                    daily_times, daily_rtps = [], []
                    for item in daily_raw:
                        record = json.loads(item)
                        ts = datetime.utcfromtimestamp(record["ts"])
                        daily_times.append(ts.strftime("%Y-%m-%d"))
                        daily_rtps.append(record["daily_rtp"])

                    # --- Prepare data dict ---
                    all_pairs[f"{game}:{vendor}"] = {
                        "forecast_times_obs": [d.strftime("%Y-%m-%d %H:%M") for d in df["ds"]],
                        "forecast_rtps_obs": df["y"].tolist(),
                        "forecast_times": [d.strftime("%Y-%m-%d %H:%M") for d in forecast["ds"]],
                        "forecast_yhat": forecast["yhat"].tolist(),
                        "forecast_lower": forecast["yhat_lower"].tolist(),
                        "forecast_upper": forecast["yhat_upper"].tolist(),
                        "history_times": [d.strftime("%Y-%m-%d %H:%M") for d in timestamps],
                        "history_rtps": rtps,
                        "ewma_1hr": ewma_1hr,
                        "ewma_24hr": ewma_24hr,
                        "ewma_10day": ewma_10day,
                        "upper_band": upper_band,
                        "lower_band": lower_band,
                        "anomaly_times": anomaly_times,
                        "anomaly_values": anomaly_values,
                        "daily_times": daily_times,
                        "daily_rtps": daily_rtps
                    }

                await ws.send_json(all_pairs)
            except Exception as e:
                print(f"⚠️ WebSocket loop error: {e}")

            await asyncio.sleep(60)
    except Exception as e:
        print(f"⚠️ WebSocket closed: {e}")
