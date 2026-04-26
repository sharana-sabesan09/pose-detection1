import csv
import io


def parse_landmarks_csv(csv_text: str) -> list[dict]:
    """
    Parse frames.csv from buildLandmarkCsv:
      t,mode,lm0_x,lm0_y,lm0_z,lm0_v,...,lm32_v

    Returns a list of {timestamp, landmarks_json} where landmarks_json is:
      [{x,y,z,visibility}, ...] * 33
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    rows: list[dict] = []
    for row in reader:
        try:
            ts = float(row.get("t") or 0)
        except (ValueError, TypeError):
            continue
        landmarks = []
        for i in range(33):
            try:
                landmarks.append(
                    {
                        "x": float(row.get(f"lm{i}_x") or 0),
                        "y": float(row.get(f"lm{i}_y") or 0),
                        "z": float(row.get(f"lm{i}_z") or 0),
                        "visibility": float(row.get(f"lm{i}_v") or 0),
                    }
                )
            except (ValueError, TypeError):
                landmarks.append({"x": 0, "y": 0, "z": 0, "visibility": 0})
        rows.append({"timestamp": ts, "landmarks_json": landmarks})
    return rows

