import redis
import json
import matplotlib.pyplot as plt
import sys
from datetime import datetime
import argparse
import time
import pandas as pd
from prophet import Prophet

# --- Redis config ---
REDIS_HOST = 'localhost'
REDIS_PORT = 6379

# --- Parse arguments ---
parser = argparse.ArgumentParser(description="Plot RTP history")
parser.add_argument("game_id", help="Game ID", nargs="?", default="game42")
parser.add_argument("vendor_id", help="Vendor ID", nargs="?", default="vendor7")
parser.add_argument("--daily", action="store_true", help="Plot daily RTP instead of per-minute")
parser.add_argument("--forecast", action="store_true", help="Run Prophet forecast on hourly RTP")
args = parser.parse_args()

GAME_ID = args.game_id
VENDOR_ID = args.vendor_id

# Redis keys
BUFFER_KEY = f"ewma_buffer:{GAME_ID}:{VENDOR_ID}"
HISTORY_KEY = f"rtp:history:{GAME_ID}:{VENDOR_ID}"
PER_SECOND_KEY = f"rtp:per_second:{GAME_ID}:{VENDOR_ID}"

rdb = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

#Check Data in Redis
print(f"Inspecting data for Game: {GAME_ID}, Vendor: {VENDOR_ID}")
print("=" * 60)

# EWMA buffer
buf_raw = rdb.get(BUFFER_KEY)
if not buf_raw:
    print(f"[ERROR] No buffer found at {BUFFER_KEY}")
else:
    buf = json.loads(buf_raw)

    per_minute_rtp = buf.get("per_minute_rtp", [])
    per_hour_rtp = buf.get("per_hour_rtp", [])
    per_day_rtp = buf.get("per_day_rtp", [])

    print(f"[EWMA Buffer]")
    print(f"  ▸ per_minute_rtp: {len(per_minute_rtp)} values")
    print(f"  ▸ per_hour_rtp:   {len(per_hour_rtp)} values")
    print(f"  ▸ per_day_rtp:    {len(per_day_rtp)} values")

    print(f"  EWMA 1hr   : {buf.get('ewma_1hr')}")
    print(f"  EWMA 24hr  : {buf.get('ewma_24hr')}")
    print(f"  EWMA 10day : {buf.get('ewma_10day')}")
    print(f"  EWMA 30day : {buf.get('ewma_30day')}")
    print(f"  Upper Band : {buf.get('upper_band')}")
    print(f"  Lower Band : {buf.get('lower_band')}")

    if len(per_minute_rtp) < 60:
        print("  ⚠️ Not enough data for 1hr EWMA (needs 60 minute values).")
    if len(per_hour_rtp) < 24:
        print("  ⚠️ Not enough data for 24hr EWMA (needs 24 hourly RTP values).")
    if len(per_day_rtp) < 10:
        print("  ⚠️ Not enough data for 10-day EWMA (needs 10 daily RTP values).")
    if len(per_day_rtp) < 30:
        print("  ⚠️ Not enough data for 30-day EWMA (needs 30 daily RTP values).")

# RTP history
print("\n[History]")
history_len = rdb.llen(HISTORY_KEY)
print(f"  ▸ Number of records: {history_len}")

# Show last 5 history entries
last_entries = rdb.lrange(HISTORY_KEY, -5, -1)
for i, item in enumerate(last_entries, 1):
    try:
        rec = json.loads(item)
        ts = datetime.utcfromtimestamp(rec['ts']).strftime('%Y-%m-%d %H:%M:%S')
        print(f"\n  Record {i}:")
        print(f"    Timestamp        : {ts} UTC")
        print(f"    RTP              : {rec['rtp']:.4f}")
        print(f"    EWMA 1hr         : {rec.get('ewma_1hr')}")
        print(f"    EWMA 24hr        : {rec.get('ewma_24hr')}")
        print(f"    Upper Band       : {rec.get('upper_band')}")
        print(f"    Lower Band       : {rec.get('lower_band')}")
        print(f"    Anomaly Detected : {bool(rec.get('anomaly'))}")
        if rec.get("anomaly"):
            print(f"    Direction        : {rec.get('anomaly_direction')}")
            print(f"    Severity         : {rec.get('anomaly_severity')}")
    except Exception as e:
        print(f"[Parse error] {e}")

# Per-second data
print("\n[Per-Second Data]")
per_second_count = rdb.llen(PER_SECOND_KEY)
print(f"  ▸ Total per-second entries: {per_second_count}")
print(f"    (Roughly {per_second_count // 60} minutes of data)")
print(f"    (Should be ≥ 86400 for a full day of per-second coverage)")




# === DAILY RTP MODE ===
if args.daily:
    DAILY_KEY = f"rtp:daily:{GAME_ID}:{VENDOR_ID}"
    history = rdb.lrange(DAILY_KEY, 0, -1)

    if not history:
        print(f"No daily RTP found for {GAME_ID} - {VENDOR_ID}")
        sys.exit(1)

    dates = []
    rtps = []

    for item in history:
        try:
            record = json.loads(item)
            ts = record["ts"]
            rtp = record["daily_rtp"]
            dates.append(datetime.fromtimestamp(ts))
            rtps.append(rtp)
        except Exception as e:
            print("Error parsing daily RTP record:", e)

    fig, ax = plt.subplots(figsize=(14, 5))
    ax.plot(dates, rtps, marker='o', linestyle='-', color='blue', label='Daily RTP')
    ax.axhline(0.96, color='gray', linestyle='--', linewidth=1, label='Target RTP (96%)')

    ax.set_title(f"Daily RTP for {GAME_ID} - {VENDOR_ID}")
    ax.set_xlabel("Date")
    ax.set_ylabel("RTP")
    ax.grid(True)
    ax.legend()

    ax.set_xticks(dates)
    ax.set_xticklabels([dt.strftime('%Y-%m-%d') for dt in dates], rotation=45, ha='right', fontsize=9)

    plt.tight_layout()
    plt.show()

# === PROPHET FORECAST MODE ===
elif args.forecast:


    BUFFER_KEY = f"ewma_buffer:{GAME_ID}:{VENDOR_ID}"
    buf_raw = rdb.get(BUFFER_KEY)

    if not buf_raw:
        print(f"[ERROR] No EWMA buffer found for {GAME_ID} - {VENDOR_ID}")
        sys.exit(1)

    buf = json.loads(buf_raw)
    hourly_rtp_list = list(buf.get("per_hour_rtp", []))

    print("\n[DEBUG] Raw hourly RTP entries:")
    for i, entry in enumerate(hourly_rtp_list):
        print(f"{i}: {entry}")

    # ✅ Build data_points from 'ts' and 'value'
    data_points = []
    for entry in hourly_rtp_list:
        if isinstance(entry, dict):
            ts = entry.get("ts")
            val = entry.get("value") or entry.get("hourly_rtp") or entry.get("rtp")
            if ts and val is not None:
                dt = datetime.utcfromtimestamp(ts)
                data_points.append({"ds": dt, "y": val})
            else:
                print("❌ Skipping entry (missing timestamp or value):", entry)

    # 🔍 DEBUG: Show parsed data points
    print("\n[DEBUG] Parsed data points:")
    for point in data_points:
        print(f"ds: {point['ds']}, y: {point['y']}")

    if len(data_points) < 6:
        print("⚠️ Not enough valid entries to build Prophet DataFrame.")
        sys.exit(1)

    df = pd.DataFrame(data_points)

    # 🔍 DEBUG: DataFrame structure
    print("\n[DEBUG] DataFrame Info:")
    print(df.info())
    print("\n[DEBUG] First few rows of DataFrame:")
    print(df.head())
    print("\n[DEBUG] Missing values check:")
    print(df.isnull().sum())

    # 🔍 DEBUG: Time differences between points
    print("\n[DEBUG] Time differences between consecutive points:")
    df_sorted = df.sort_values("ds")
    df_sorted["delta"] = df_sorted["ds"].diff()
    print(df_sorted[["ds", "delta"]])

    # Build and train Prophet model
    model = Prophet()
    model.fit(df)

    # Forecast next 24 hours
    future = model.make_future_dataframe(periods=24, freq='H')
    forecast = model.predict(future)

    # Plot
    fig, ax = plt.subplots(figsize=(16, 6))

    ax.plot(df["ds"], df["y"], label="Observed Hourly RTP", color="blue")
    ax.plot(forecast["ds"], forecast["yhat"], label="Forecast (yhat)", color="green")
    ax.fill_between(forecast["ds"],
                    forecast["yhat_lower"],
                    forecast["yhat_upper"],
                    color="lightgreen", alpha=0.4, label="Uncertainty Interval")

    ax.set_title(f"Hourly RTP Forecast for {GAME_ID} - {VENDOR_ID}")
    ax.set_xlabel("Time (UTC)")
    ax.set_ylabel("RTP")
    ax.grid(True)
    ax.legend()
    plt.tight_layout()
    plt.show()


# === PER-MINUTE RTP + EWMA MODE ===
else:
    HISTORY_KEY = f"rtp:history:{GAME_ID}:{VENDOR_ID}"
    history = rdb.lrange(HISTORY_KEY, 0, -1)

    if not history:
        print(f"No history found for {GAME_ID} - {VENDOR_ID}")
        sys.exit(1)

    timestamps, rtps, ewma_1hr, ewma_24hr, ewma_10day, upper_band, lower_band, anomalies = [], [], [], [], [], [], [], []

    for item in history:
        try:
            record = json.loads(item)
            timestamps.append(record["ts"])
            rtps.append(record["rtp"])
            ewma_1hr.append(record.get("ewma_1hr"))
            ewma_24hr.append(record.get("ewma_24hr"))
            ewma_10day.append(record.get("ewma_10day"))
            upper_band.append(record.get("upper_band"))
            lower_band.append(record.get("lower_band"))
            anomalies.append(record.get("anomaly"))
        except Exception as e:
            print("Error parsing record:", e)

    times = [datetime.fromtimestamp(ts) for ts in timestamps]

    fig, ax = plt.subplots(figsize=(20, 6))

    ax.plot(rtps, label="RTP", color="blue", linewidth=1.2)
    ax.plot(ewma_1hr, label="EWMA 1hr", linestyle="--", color="green")
    ax.plot(ewma_24hr, label="EWMA 24hr", linestyle="--", color="pink")
    ax.plot(ewma_10day, label="EWMA 10day", linestyle="--", color="purple")
    ax.axhline(0.96, color='black', linestyle='--', linewidth=1, label='Target RTP (96%)')
    ax.plot(upper_band, label="Upper Band", color="red", linewidth=1)
    ax.plot(lower_band, label="Lower Band", color="orange", linewidth=1)

    anomaly_indices = [i for i, a in enumerate(anomalies) if a]
    ax.scatter(anomaly_indices, [rtps[i] for i in anomaly_indices], color="red", s=50, marker="x", label="Anomaly")

    ax.set_title(f"RTP History for {GAME_ID} - {VENDOR_ID}")
    ax.set_xlabel("Time")
    ax.set_ylabel("RTP")

    ax.legend(
        loc='center left',
        bbox_to_anchor=(1.02, 0.5),
        fontsize='small',
        frameon=True,
        framealpha=0.8
    )

    ax.grid(True)

    tick_spacing = 30
    tick_indices = list(range(0, len(times), tick_spacing))
    tick_labels = [times[i].strftime("%Y-%m-%d %H:%M") for i in tick_indices]
    ax.set_xticks(tick_indices)
    ax.set_xticklabels(tick_labels, rotation=45, fontsize=8)

    plt.tight_layout(rect=[0, 0, 0.93, 1])
    plt.show()
