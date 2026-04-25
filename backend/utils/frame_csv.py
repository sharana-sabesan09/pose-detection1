import csv
import io


# Numeric columns from the mobile app's frame-feature debug CSV that map
# directly onto PoseFrame. "frame", "timestamp", and "side" are metadata.
_FRAME_NUMERIC_COLS = {
    "knee_flex",
    "fppa",
    "trunk_lean",
    "trunk_flex",
    "pelvic_drop",
    "hip_adduction",
    "knee_offset",
    "midhip_x",
    "midhip_y",
    "velocity",
}


def parse_frame_features_csv(csv_text: str) -> list[dict]:
    """Return a list of {timestamp, angles_json} dicts parsed from frame CSV."""
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        ts_raw = row.get("timestamp", "")
        try:
            ts = float(ts_raw)
        except (ValueError, TypeError):
            continue

        angles = {}
        for col in _FRAME_NUMERIC_COLS:
            raw = row.get(col, "")
            if raw:
                try:
                    angles[col] = float(raw)
                except ValueError:
                    pass

        if angles:
            rows.append({"timestamp": ts, "angles_json": angles})

    return rows
