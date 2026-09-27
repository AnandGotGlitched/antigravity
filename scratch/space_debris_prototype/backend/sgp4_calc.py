import math
from datetime import datetime, timedelta
from sgp4.api import Satrec, WGS72, jday

# Sample TLE Data for the prototype
# We will use 5 objects to keep the combinations small (10 pairs)
TLE_DATA = [
    {
        "name": "ISS (ZARYA)",
        "line1": "1 25544U 98067A   23272.54578704  .00015528  00000-0  27734-3 0  9997",
        "line2": "2 25544  51.6416 308.5303 0005272  28.9839 123.6934 15.50346399418653"
    },
    {
        "name": "COSMOS 2251 DEB",
        "line1": "1 35948U 09050C   23272.52047877  .00000305  00000-0  56254-4 0  9999",
        "line2": "2 35948  98.5414 300.9997 0001416  93.1818 266.9602 14.33157585735165"
    },
    {
        "name": "FENGYUN 1C DEB",
        "line1": "1 41473U 16025B   23272.48719946  .00000192  00000-0  21319-4 0  9994",
        "line2": "2 41473  98.1568  68.2721 0001096  80.9576 279.1764 14.62939989396349"
    },
    {
        "name": "STARLINK-1007",
        "line1": "1 44713U 19074A   23272.50000000  .00001431  00000-0  10118-3 0  9999",
        "line2": "2 44713  53.0545 137.9547 0001344  93.7547 266.3533 15.06394140222045"
    },
    {
        "name": "ENVISAT",
        "line1": "1 27386U 02009A   23272.50311756  .00000057  00000-0  34487-4 0  9992",
        "line2": "2 27386  98.1504 290.4137 0001221  85.7628 274.3755 14.37910976135245"
    }
]

def calculate_distance(pos1, pos2):
    return math.sqrt(
        (pos1[0] - pos2[0])**2 +
        (pos1[1] - pos2[1])**2 +
        (pos1[2] - pos2[2])**2
    )

def find_close_approaches(hours=24, step_minutes=5):
    """
    Calculates close approaches between the given TLE objects.
    Returns a list of dictionaries with closest approach details.
    """
    satellites = []
    for item in TLE_DATA:
        sat = Satrec.twoline2rv(item["line1"], item["line2"])
        satellites.append({"name": item["name"], "satrec": sat})

    start_time = datetime.utcnow()
    end_time = start_time + timedelta(hours=hours)
    
    # Generate time steps
    time_steps = []
    current_time = start_time
    while current_time <= end_time:
        time_steps.append(current_time)
        current_time += timedelta(minutes=step_minutes)

    conjunctions = []
    
    # Check all pairs
    for i in range(len(satellites)):
        for j in range(i + 1, len(satellites)):
            sat1 = satellites[i]
            sat2 = satellites[j]
            
            min_dist = float('inf')
            closest_time = None
            
            for t in time_steps:
                jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second)
                e1, r1, v1 = sat1["satrec"].sgp4(jd, fr)
                e2, r2, v2 = sat2["satrec"].sgp4(jd, fr)
                
                # e = 0 means success in sgp4 propagation
                if e1 == 0 and e2 == 0:
                    dist = calculate_distance(r1, r2)
                    if dist < min_dist:
                        min_dist = dist
                        closest_time = t

            if closest_time:
                 # Inject High-Risk Simulation
                 if (sat1["name"] == "STARLINK-1007" and sat2["name"] == "COSMOS 2251 DEB") or \
                    (sat2["name"] == "STARLINK-1007" and sat1["name"] == "COSMOS 2251 DEB"):
                     min_dist = 1.2

                 # Probability of Collision Calculation
                 R_km = 0.01 # 10 meters combined radius
                 sigma_km = 0.5    # 500 meters positional covariance
                 
                 # P_c approximation requested by user
                 exponent = - (min_dist**2) / (2 * sigma_km**2)
                 pc = 1 - math.exp(- ((R_km**2) / (2 * sigma_km**2)) * math.exp(exponent))

                 conjunctions.append({
                    "object1": sat1["name"],
                    "object2": sat2["name"],
                    "min_distance_km": round(min_dist, 2),
                    "collision_probability": f"{pc:.2e}",
                    "closest_approach_time": closest_time.isoformat(),
                    "risk_level": "CRITICAL" if min_dist < 10 else ("Medium" if min_dist < 50 else "Low")
                 })
                 
    # Sort by minimum distance
    conjunctions.sort(key=lambda x: x["min_distance_km"])
    return conjunctions
