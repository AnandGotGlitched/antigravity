from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math
from sgp4_calc import find_close_approaches, TLE_DATA

app = FastAPI(title="Space Debris Collision Avoidance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MissionRiskRequest(BaseModel):
    altitude_km: float
    area_m2: float
    time_years: float

@app.get("/api/tles")
def get_tles():
    """
    Endpoint to return raw TLE data for 3D visualization.
    """
    return {"tles": TLE_DATA}

@app.get("/api/conjunctions")
def get_conjunctions():
    """
    Endpoint to trigger the close approach calculation and return the risk-ranked list.
    """
    results = find_close_approaches(hours=24, step_minutes=5)
    return {"conjunctions": results}

@app.post("/api/mission-risk")
def calculate_mission_risk(params: MissionRiskRequest):
    """
    Calculates the probability of at least one debris impact using the Poisson distribution.
    """
    alt = params.altitude_km
    area = params.area_m2
    time = params.time_years
    
    # Debris flux F calculation based on altitude
    if alt < 500:
        flux = 5.0e-5
    elif 500 <= alt <= 900:
        flux = 3.5e-4
    else:
        flux = 1.0e-4
        
    # Expected number of impacts (lambda)
    lam = flux * area * time
    
    # Probability of at least one impact: P = 1 - exp(-lambda)
    prob = 1.0 - math.exp(-lam)
    prob_percent = prob * 100.0
    
    # Risk Rating
    if prob_percent < 1:
        risk_rating = "LOW"
    elif prob_percent <= 5:
        risk_rating = "MODERATE"
    else:
        risk_rating = "HIGH"
    
    return {
        "altitude_km": alt,
        "area_m2": area,
        "time_years": time,
        "flux_per_m2_year": flux,
        "expected_impacts": lam,
        "probability_percentage": prob_percent,
        "risk_rating": risk_rating
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
