# Space Debris and Collision Avoidance Prototype

This project is a web prototype that ingests satellite TLE (Two-Line Element) data, calculates potential close approaches between objects using the `sgp4` Python library, and displays a risk-ranked dashboard on the frontend. It now also features a Mission Risk Calculator based on Poisson distribution physics.

## User Review Required

- **CesiumJS Integration**: Adding CesiumJS is a significant frontend addition. We will load CesiumJS and Satellite.js via CDN. Is this acceptable?
- **3D Globe Interaction**: When a row in the "Live Tracking" table is clicked, the globe will pan to that satellite's real-time computed coordinate. Are there specific camera angles or zoom levels you'd prefer?

## Proposed Changes

### Backend (Python/FastAPI)

#### [MODIFY] backend/main.py
- Add `GET /api/tles` endpoint to expose the raw TLE dataset to the frontend so Cesium can compute real-time positions.

#### [MODIFY] backend/sgp4_calc.py
- Expose the raw TLE dictionary securely so `main.py` can import and serve it.

### Frontend (HTML/JS/Tailwind)

#### [MODIFY] frontend/index.html
- Import `CesiumJS` and `satellite.js` via CDNs.
- Add a new "3D ORBIT VIEWER" tab to the main navigation.
- Add a `<div id="cesiumContainer">` within a new view tab.

#### [MODIFY] frontend/app.js
- Add logic to initialize the Cesium 3D globe.
- Fetch TLEs from `/api/tles` and use `satellite.js` to compute real-time `[longitude, latitude, altitude]` coordinates.
- Render each satellite as a glowing PointGraphic (dot) on the globe.
- Add click event listeners to the "Live Tracking" table rows. When a row is clicked, trigger `viewer.camera.flyTo()` to the satellite's current coordinates.

## Verification Plan

### Manual Verification
1. Start the FastAPI backend server.
2. Open the frontend and click on the "3D ORBIT VIEWER" tab. Verify that the globe loads and renders the glowing satellite dots.
3. Switch to the "LIVE TRACKING" tab and click on a table row. Verify that it seamlessly switches to the 3D globe and flies the camera to the target object.
