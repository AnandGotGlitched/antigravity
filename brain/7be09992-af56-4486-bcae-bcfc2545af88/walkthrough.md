# Space Debris Prototype Implementation

The initial version of the Space Debris Collision Avoidance web prototype has been successfully implemented and is currently running locally.

## What was built
1. **Backend API (`FastAPI`)**: 
   - Uses `sgp4` to propagate a hardcoded sample set of 5 satellites/debris TLEs.
   - Calculates close approaches over a 24-hour window, checking positions in 5-minute intervals.
   - Exposed a `GET /api/conjunctions` endpoint that returns a risk-ranked list of upcoming conjunctions.
2. **Frontend UI (`HTML/JS + Tailwind CSS`)**:
   - A modern, clean dashboard interface.
   - Dynamically fetches the risk data from the backend and displays it in a sorted table.
   - Includes visual badges for risk levels (High, Medium, Low) based on the calculated minimum distance.

## How to Verify
Both the frontend and backend servers are running in the background. You can view the dashboard by opening this URL in your web browser:

**[http://localhost:3000](http://localhost:3000)**

This will load the dashboard, which will automatically fetch and display the conjunction risk calculations from the backend API.

## Next Steps
Once you've had a chance to test this prototype out, let me know if you would like to:
- Use a larger or more dynamic set of TLE data (e.g., fetching live from Celestrak).
- Refine the math or change the time window (currently 24 hours).
- Add more advanced visualizations to the dashboard.
