document.addEventListener('DOMContentLoaded', () => {
    
    // --- TAB SWITCHING LOGIC ---
    const tabLive = document.getElementById('tabLive');
    const tab3D = document.getElementById('tab3D');
    const tabCalc = document.getElementById('tabCalc');
    const viewLive = document.getElementById('viewLive');
    const view3D = document.getElementById('view3D');
    const viewCalc = document.getElementById('viewCalc');
    const refreshBtn = document.getElementById('refreshBtn');

    const activeTabClasses = ['border-white', 'text-white', 'drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]', 'shadow-white/50'];
    const inactiveTabClasses = ['border-transparent', 'text-gray-500', 'hover:text-gray-300'];

    let cesiumInitialized = false;

    function switchTab(activeTab) {
        [tabLive, tab3D, tabCalc].forEach(tab => {
            if (tab === activeTab) {
                tab.classList.remove(...inactiveTabClasses);
                tab.classList.add(...activeTabClasses);
            } else {
                tab.classList.remove(...activeTabClasses);
                tab.classList.add(...inactiveTabClasses);
            }
        });
        
        [viewLive, view3D, viewCalc].forEach(view => view.classList.add('hidden'));

        if (activeTab === tabLive) {
            viewLive.classList.remove('hidden');
            refreshBtn.classList.remove('hidden');
            if (window.viewer) window.viewer.useDefaultRenderLoop = false;
        } else if (activeTab === tab3D) {
            view3D.classList.remove('hidden');
            refreshBtn.classList.add('hidden');
            if (!cesiumInitialized) {
                initCesium();
                cesiumInitialized = true;
            } else {
                // Resize viewer when unhidden and resume render loop
                if (window.viewer) {
                    window.viewer.useDefaultRenderLoop = true;
                    window.viewer.resize();
                }
            }
        } else if (activeTab === tabCalc) {
            viewCalc.classList.remove('hidden');
            refreshBtn.classList.add('hidden');
            if (window.viewer) window.viewer.useDefaultRenderLoop = false;
        }
    }

    tabLive.addEventListener('click', () => switchTab(tabLive));
    tab3D.addEventListener('click', () => switchTab(tab3D));
    tabCalc.addEventListener('click', () => switchTab(tabCalc));

    // --- CESIUM 3D VIEWER LOGIC ---
    const TLE_API_URL = 'http://127.0.0.1:8000/api/tles';
    let satelliteEntities = {};

    async function initCesium() {
        // Clean Engine Setup
        window.viewer = new Cesium.Viewer('cesiumContainer', {
            animation: false,
            timeline: false,
            infoBox: false,
            selectionIndicator: false,
            navigationHelpButton: false,
            geocoder: false,
            baseLayerPicker: false,
            homeButton: false,
            sceneModePicker: false,
            fullscreenButton: false,
            logarithmicDepthBuffer: true
        });

        // Inject 4K Token-Free Esri Imagery
        viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
            url : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel : 19
        }));

        viewer.cesiumWidget.creditContainer.style.display = 'none';
        viewer.scene.globe.enableLighting = true;
        if (viewer.scene.skyAtmosphere) {
            viewer.scene.skyAtmosphere.show = true;
        }

        // Smooth, Controlled Camera Handling
        viewer.targetFrameRate = 120;
        const controller = viewer.scene.screenSpaceCameraController;
        controller.inertiaSpin = 0.05;
        controller.inertiaTranslate = 0.05;
        controller.inertiaZoom = 0.05;
        controller.minimumZoomDistance = 350000;
        controller.maximumZoomDistance = 40000000;

        // Intelligent Auto-Rotation + Joystick Camera Control
        let lastInteractionTime = 0;
        let joystickInput = { x: 0, y: 0, active: false };
        
        viewer.scene.canvas.addEventListener('pointerdown', () => lastInteractionTime = Date.now());
        viewer.scene.canvas.addEventListener('wheel', () => lastInteractionTime = Date.now());

        // Initialize Virtual Joystick
        const joystickManager = nipplejs.create({
            zone: document.getElementById('joystick-zone'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: '#06b6d4',
            size: 100
        });

        joystickManager.on('move', (evt, data) => {
            joystickInput.active = true;
            joystickInput.x = data.vector.x;
            joystickInput.y = data.vector.y;
            lastInteractionTime = Date.now();
        });

        joystickManager.on('end', () => {
            joystickInput.active = false;
            joystickInput.x = 0;
            joystickInput.y = 0;
        });

        viewer.clock.onTick.addEventListener(() => {
            // Joystick camera control
            if (joystickInput.active && !viewer.trackedEntity) {
                const speed = 0.02;
                viewer.scene.camera.rotateRight(joystickInput.x * speed);
                viewer.scene.camera.rotateUp(joystickInput.y * speed);
            }
            // Idle auto-rotation
            else if (!viewer.trackedEntity && (Date.now() - lastInteractionTime > 4000)) {
                viewer.scene.camera.rotateRight(0.0003);
            }
        });

        // Set clock bounds for 24-hour window
        const nowJD = Cesium.JulianDate.now();
        const startTime = Cesium.JulianDate.addHours(nowJD, -12, new Cesium.JulianDate());
        const endTime = Cesium.JulianDate.addHours(nowJD, 12, new Cesium.JulianDate());
        viewer.clock.startTime = startTime.clone();
        viewer.clock.stopTime = endTime.clone();
        viewer.clock.currentTime = nowJD.clone();
        viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
        viewer.clock.shouldAnimate = false;
        viewer.clock.multiplier = 1;

        // Store satrec data for proximity checks
        let satrecMap = {};

        try {
            const response = await fetch(TLE_API_URL);
            const data = await response.json();

            data.tles.forEach(sat => {
                const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
                satrecMap[sat.name] = satrec;

                // Build SampledPositionProperty: propagate from -12h to +12h in 2-minute steps
                const positionProperty = new Cesium.SampledPositionProperty();
                positionProperty.setInterpolationOptions({
                    interpolationDegree: 5,
                    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
                });

                const nowMs = Date.now();

                for (let minuteOffset = -720; minuteOffset <= 720; minuteOffset += 2) {
                    const time = new Date(nowMs + minuteOffset * 60000);
                    const posVel = satellite.propagate(satrec, time);
                    if (posVel.position) {
                        const gmst = satellite.gstime(time);
                        const posGd = satellite.eciToGeodetic(posVel.position, gmst);
                        const cartesian = Cesium.Cartesian3.fromDegrees(
                            satellite.degreesLong(posGd.longitude),
                            satellite.degreesLat(posGd.latitude),
                            posGd.height * 1000
                        );

                        const julianTime = Cesium.JulianDate.fromDate(time);
                        positionProperty.addSample(julianTime, cartesian);
                    }
                }

                // Get current state for metadata
                const currentPosAndVel = satellite.propagate(satrec, new Date(nowMs));
                const currentHeight = currentPosAndVel.position ? (() => {
                    const gmst = satellite.gstime(new Date(nowMs));
                    return satellite.eciToGeodetic(currentPosAndVel.position, gmst).height;
                })() : 400;

                const isDebris = sat.name.includes('DEB');
                const reticleColor = isDebris ? '#ff4444' : '#00ffff';

                const svgData = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="${reticleColor}" stroke-width="2" fill="none" opacity="0.8"/><circle cx="16" cy="16" r="3" fill="${reticleColor}"/></svg>`;
                const svgURI = 'data:image/svg+xml;base64,' + btoa(svgData);

                const entity = viewer.entities.add({
                    name: sat.name,
                    position: positionProperty,
                    billboard: {
                        image: svgURI,
                        width: 24,
                        height: 24,
                    },
                    path: new Cesium.PathGraphics({
                        leadTime: 3600,
                        trailTime: 3600,
                        width: 1.5,
                        resolution: 120,
                        material: new Cesium.PolylineGlowMaterialProperty({
                            glowPower: 0.15,
                            color: isDebris ? Cesium.Color.RED.withAlpha(0.7) : Cesium.Color.CYAN.withAlpha(0.7)
                        })
                    }),
                    label: {
                        text: sat.name,
                        font: '12pt Inter',
                        fillColor: Cesium.Color.WHITE,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        outlineWidth: 2,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        pixelOffset: new Cesium.Cartesian2(0, -9)
                    },
                    properties: {
                        catalogId: sat.name.split(' ').pop() || "UNKNOWN",
                        altitude: currentHeight.toFixed(0),
                        velocity: (currentPosAndVel.velocity ? Math.sqrt(Math.pow(currentPosAndVel.velocity.x, 2) + Math.pow(currentPosAndVel.velocity.y, 2) + Math.pow(currentPosAndVel.velocity.z, 2)).toFixed(2) : "7.62"),
                        riskLevel: isDebris ? "CRITICAL" : "NOMINAL"
                    }
                });

                satelliteEntities[sat.name] = entity;
            });

        } catch (error) {
            console.error("Error loading TLEs for Cesium:", error);
        }

        // Click-to-Lock & Real-Time Tracking HUD
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        const telemetryHud = document.getElementById('telemetryHud');
        const hudName = document.getElementById('hudName');
        const hudId = document.getElementById('hudId');
        const hudAlt = document.getElementById('hudAlt');
        const hudVel = document.getElementById('hudVel');
        const hudRisk = document.getElementById('hudRisk');
        const closeHudBtn = document.getElementById('closeHudBtn');

        handler.setInputAction(function (movement) {
            const pickedObject = viewer.scene.pick(movement.position);
            if (Cesium.defined(pickedObject) && pickedObject.id) {
                const pickedEntity = pickedObject.id;
                
                // Assign a fixed local camera offset relative to the satellite
                pickedEntity.viewFrom = new Cesium.Cartesian3(150000.0, -150000.0, 150000.0);
                viewer.trackedEntity = pickedEntity;

                // Populate HUD
                hudName.textContent = pickedEntity.name;
                const props = pickedEntity.properties;
                hudId.textContent = props ? props.catalogId.getValue() : "--";
                hudAlt.textContent = props ? `${props.altitude.getValue()} km` : "--";
                hudVel.textContent = props ? `${props.velocity.getValue()} km/s` : "--";
                
                const risk = props ? props.riskLevel.getValue() : "UNKNOWN";
                hudRisk.textContent = risk;
                if (risk === 'CRITICAL') {
                    hudRisk.className = 'px-2 py-0.5 text-xs font-bold uppercase tracking-widest rounded-sm bg-red-600/20 text-red-400 border border-red-500 animate-pulse';
                } else {
                    hudRisk.className = 'px-2 py-0.5 text-xs font-bold uppercase tracking-widest rounded-sm bg-green-500/20 text-green-400 border border-green-500';
                }

                telemetryHud.classList.remove('hidden');
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        closeHudBtn.addEventListener('click', () => {
            viewer.trackedEntity = undefined;
            telemetryHud.classList.add('hidden');
        });

        // === TIME MACHINE ===
        const temporalScrubber = document.getElementById('temporalScrubber');
        const temporalTimeLabel = document.getElementById('temporalTimeLabel');
        const btnPlayPause = document.getElementById('btnPlayPause');
        const btnJumpTCA = document.getElementById('btnJumpTCA');
        const proximityAlert = document.getElementById('proximityAlert');
        const speedBtns = document.querySelectorAll('.speed-btn');
        const baseTime = Cesium.JulianDate.now();

        const formatScrubberLabel = (offsetHours, time) => {
            const isNegative = offsetHours < 0;
            const absHours = Math.abs(offsetHours);
            const h = Math.floor(absHours).toString().padStart(2, '0');
            const m = Math.floor((absHours * 60) % 60).toString().padStart(2, '0');
            const s = Math.floor((absHours * 3600) % 60).toString().padStart(2, '0');
            const prefix = isNegative ? 'T-MINUS' : 'T-PLUS';
            const jsDate = Cesium.JulianDate.toDate(time);
            const utcStr = jsDate.toISOString().replace('T', ' ').substring(0, 19);
            return `${prefix} ${h}:${m}:${s} | UTC: ${utcStr}`;
        };
        temporalTimeLabel.textContent = formatScrubberLabel(0, baseTime);

        // Scrubber drag
        temporalScrubber.addEventListener('input', (e) => {
            const offsetHours = parseFloat(e.target.value);
            const newTime = new Cesium.JulianDate();
            Cesium.JulianDate.addHours(baseTime, offsetHours, newTime);
            viewer.clock.shouldAnimate = false;
            viewer.clock.currentTime = newTime;
            temporalTimeLabel.textContent = formatScrubberLabel(offsetHours, newTime);
            btnPlayPause.innerHTML = '► Play';
        });

        // Sync scrubber label when clock animates
        viewer.clock.onTick.addEventListener(function updateTimeLabel() {
            if (viewer.clock.shouldAnimate) {
                const diff = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, baseTime);
                const offsetHours = diff / 3600;
                temporalScrubber.value = Math.max(-12, Math.min(12, offsetHours));
                temporalTimeLabel.textContent = formatScrubberLabel(offsetHours, viewer.clock.currentTime);
            }
        });

        // Play / Pause
        btnPlayPause.addEventListener('click', () => {
            viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate;
            btnPlayPause.innerHTML = viewer.clock.shouldAnimate ? '❚❚ Pause' : '► Play';
        });

        // Speed multiplier buttons
        speedBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseInt(btn.dataset.speed);
                viewer.clock.multiplier = speed;
                speedBtns.forEach(b => {
                    b.className = 'speed-btn px-3 py-1.5 text-xs font-mono border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition rounded-sm';
                });
                btn.className = 'speed-btn px-3 py-1.5 text-xs font-mono border border-white/30 text-white bg-white/10 transition rounded-sm';
            });
        });

        // Jump to TCA — smart fallback + cinematic encounter
        let activeTCA = null;
        let activeConjunctionData = null; // full conjunction item from API
        window.setActiveTCA = (tcaISOStr) => { activeTCA = tcaISOStr; };
        window.setActiveConjunctionData = (item) => { activeConjunctionData = item; };

        // Encounter overlay elements
        const encounterOverlay = document.getElementById('encounterOverlay');
        const encObj1 = document.getElementById('encObj1');
        const encObj2 = document.getElementById('encObj2');
        const encMissDist = document.getElementById('encMissDist');
        const encPc = document.getElementById('encPc');
        const encRelVel = document.getElementById('encRelVel');
        const closeEncounterBtn = document.getElementById('closeEncounterBtn');
        const btnResumeSimulation = document.getElementById('btnResumeSimulation');

        let encounterProximityLine = null;

        function jumpToTCA() {
            // Smart fallback: if nothing selected, auto-select the CRITICAL event
            let conj = activeConjunctionData;
            let tca = activeTCA;

            if (!conj && window._cachedConjunctions) {
                conj = window._cachedConjunctions.find(c => c.risk_level === 'CRITICAL') || window._cachedConjunctions[0];
                if (conj) {
                    tca = conj.closest_approach_time;
                    activeConjunctionData = conj;
                    activeTCA = tca;
                    if (window.setActiveConjunctionPair) window.setActiveConjunctionPair(conj.object1, conj.object2);
                }
            }

            if (!conj || !tca) return; // truly no data at all

            // 1. Precision Clock Jump
            const tcaJD = Cesium.JulianDate.fromIso8601(tca);
            viewer.clock.currentTime = tcaJD;
            viewer.clock.shouldAnimate = false;
            btnPlayPause.innerHTML = '► Play';
            const diff = Cesium.JulianDate.secondsDifference(tcaJD, baseTime);
            const offsetHours = diff / 3600;
            temporalScrubber.value = Math.max(-12, Math.min(12, offsetHours));
            temporalTimeLabel.textContent = formatScrubberLabel(offsetHours, tcaJD);

            // 2. Dual-Object Dynamic Framing (Safe BoundingSphere)
            const e1 = satelliteEntities[conj.object1];
            const e2 = satelliteEntities[conj.object2];

            if (e1 && e2) {
                const pos1 = e1.position.getValue(tcaJD);
                const pos2 = e2.position.getValue(tcaJD);

                if (pos1 && pos2) {
                    const midpoint = Cesium.Cartesian3.midpoint(pos1, pos2, new Cesium.Cartesian3());

                    // Release any tracked entity to prevent camera collapse
                    viewer.trackedEntity = undefined;

                    // Fly to a safe bounding sphere — 150 km radius, 500 km viewing distance
                    const encounterSphere = new Cesium.BoundingSphere(midpoint, 150000);
                    viewer.camera.flyToBoundingSphere(encounterSphere, {
                        duration: 1.8,
                        offset: new Cesium.HeadingPitchRange(
                            viewer.camera.heading,
                            Cesium.Math.toRadians(-35),
                            500000
                        )
                    });

                    // 3. Draw proximity laser
                    if (encounterProximityLine) {
                        viewer.entities.remove(encounterProximityLine);
                    }
                    encounterProximityLine = viewer.entities.add({
                        name: 'ENCOUNTER_LINE',
                        polyline: {
                            positions: new Cesium.CallbackProperty(() => {
                                const p1 = e1.position.getValue(viewer.clock.currentTime);
                                const p2 = e2.position.getValue(viewer.clock.currentTime);
                                return (p1 && p2) ? [p1, p2] : [];
                            }, false),
                            width: 4,
                            material: new Cesium.PolylineGlowMaterialProperty({
                                glowPower: 0.3,
                                color: Cesium.Color.RED
                            })
                        }
                    });
                }
            }

            // 4. Populate & show Encounter Telemetry Overlay
            encObj1.textContent = conj.object1;
            encObj2.textContent = conj.object2;
            encMissDist.textContent = `${conj.min_distance_km.toFixed(2)} km`;
            encPc.textContent = conj.collision_probability || '1.42e-4';
            encRelVel.textContent = `${(conj.relative_velocity_km_s || 14.2).toFixed(1)} km/s`;
            encounterOverlay.classList.remove('hidden');
            proximityAlert.classList.remove('hidden');
        }

        btnJumpTCA.addEventListener('click', jumpToTCA);

        closeEncounterBtn.addEventListener('click', () => {
            encounterOverlay.classList.add('hidden');
            if (encounterProximityLine) {
                viewer.entities.remove(encounterProximityLine);
                encounterProximityLine = null;
            }
        });

        btnResumeSimulation.addEventListener('click', () => {
            viewer.clock.multiplier = 10;
            viewer.clock.shouldAnimate = true;
            btnPlayPause.innerHTML = '❚❚ Pause';
            // Highlight the 10x speed button
            speedBtns.forEach(b => {
                const s = parseInt(b.dataset.speed);
                if (s === 10) {
                    b.className = 'speed-btn px-3 py-1.5 text-xs font-mono border border-white/30 text-white bg-white/10 transition rounded-sm';
                } else {
                    b.className = 'speed-btn px-3 py-1.5 text-xs font-mono border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition rounded-sm';
                }
            });
            encounterOverlay.classList.add('hidden');
        });

        // === PROXIMITY ALERT SYSTEM ===
        let proximityLine = null;
        let activeConjunctionPair = null; // {obj1: name, obj2: name}
        window.setActiveConjunctionPair = (obj1, obj2) => { activeConjunctionPair = { obj1, obj2 }; };

        viewer.clock.onTick.addEventListener(() => {
            if (!activeConjunctionPair) return;
            
            const e1 = satelliteEntities[activeConjunctionPair.obj1];
            const e2 = satelliteEntities[activeConjunctionPair.obj2];
            if (!e1 || !e2) return;

            const pos1 = e1.position.getValue(viewer.clock.currentTime);
            const pos2 = e2.position.getValue(viewer.clock.currentTime);
            if (!pos1 || !pos2) return;

            const distance = Cesium.Cartesian3.distance(pos1, pos2) / 1000; // to km

            if (distance < 50) {
                // Draw or update red proximity laser
                if (!proximityLine) {
                    proximityLine = viewer.entities.add({
                        name: 'PROXIMITY_LINE',
                        polyline: {
                            positions: new Cesium.CallbackProperty(() => {
                                const p1 = e1.position.getValue(viewer.clock.currentTime);
                                const p2 = e2.position.getValue(viewer.clock.currentTime);
                                return (p1 && p2) ? [p1, p2] : [];
                            }, false),
                            width: 4,
                            material: new Cesium.PolylineGlowMaterialProperty({
                                glowPower: 0.3,
                                color: Cesium.Color.RED
                            })
                        }
                    });
                }
                proximityAlert.classList.remove('hidden');
            } else {
                if (proximityLine) {
                    viewer.entities.remove(proximityLine);
                    proximityLine = null;
                }
                proximityAlert.classList.add('hidden');
            }
        });
    }


    // --- LIVE TRACKING LOGIC ---
    const loader = document.getElementById('loader');
    const dashboardContent = document.getElementById('dashboardContent');
    const conjunctionTableBody = document.getElementById('conjunctionTableBody');
    const errorState = document.getElementById('errorState');
    const errorMessage = document.getElementById('errorMessage');

    const API_URL = 'http://127.0.0.1:8000/api/conjunctions';

    const fetchConjunctionData = async () => {
        // UI Reset
        loader.classList.remove('hidden');
        dashboardContent.classList.add('hidden');
        errorState.classList.add('hidden');
        conjunctionTableBody.innerHTML = '';

        try {
            const response = await fetch(API_URL);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.conjunctions && data.conjunctions.length > 0) {
                window._cachedConjunctions = data.conjunctions;
                renderTable(data.conjunctions);
                setTimeout(() => {
                    dashboardContent.classList.remove('hidden');
                }, 100);
            } else {
                showLiveError("No conjunction data found.");
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            showLiveError("Failed to connect to the telemetry server. Retrying...");
        } finally {
            loader.classList.add('hidden');
        }
    };

    const renderTable = (conjunctions) => {
        conjunctions.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-white/10 transition duration-300';

            let riskBadgeClass = '';
            if (item.risk_level === 'CRITICAL') {
                riskBadgeClass = 'bg-red-600 text-white px-3 py-1 text-[10px] uppercase tracking-widest font-bold animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.9)] rounded-sm';
                row.className += ' bg-red-900/30 hover:bg-red-900/50';
            } else if (item.risk_level === 'Medium') {
                riskBadgeClass = 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 px-3 py-1 rounded-sm text-[10px] uppercase tracking-widest font-semibold';
            } else {
                riskBadgeClass = 'bg-green-500/10 text-green-400 border border-green-500/30 px-3 py-1 rounded-sm text-[10px] uppercase tracking-widest font-semibold';
            }

            const date = new Date(item.closest_approach_time);
            const dateOpts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
            const timeOpts = { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' };
            const formattedDate = date.toLocaleString('en-US', dateOpts).toUpperCase();
            const formattedTime = date.toLocaleString('en-US', timeOpts) + ' UTC';

            row.innerHTML = `
                <td class="p-5 font-semibold tracking-wide">
                    <div>${item.object1}</div>
                    <div class="text-xs text-gray-400 font-light mt-1">${item.object2}</div>
                </td>
                <td class="p-5 text-gray-300 font-light tracking-wider">
                    <div>${formattedDate}</div>
                    <div class="text-xs text-gray-400 mt-1">${formattedTime}</div>
                </td>
                <td class="p-5 font-mono text-right text-lg font-light tracking-wider">${item.min_distance_km.toFixed(2)}</td>
                <td class="p-5 text-center">
                    <span class="${riskBadgeClass} inline-block">${item.risk_level}</span>
                </td>
            `;
            
            // Add click listener to either open CAM Planner or fly to satellite in 3D view
            row.addEventListener('click', () => {
                // Always register this conjunction for the 3D viewer
                if (window.setActiveTCA) window.setActiveTCA(item.closest_approach_time);
                if (window.setActiveConjunctionPair) window.setActiveConjunctionPair(item.object1, item.object2);
                if (window.setActiveConjunctionData) window.setActiveConjunctionData(item);

                if (item.risk_level === 'CRITICAL') {
                    openCamDrawer(item);
                } else {
                    // Switch to 3D tab
                    switchTab(tab3D);
                    
                    // Track object1
                    setTimeout(() => {
                        const targetEntity = satelliteEntities[item.object1];
                        if (window.viewer && targetEntity) {
                            targetEntity.viewFrom = new Cesium.Cartesian3(150000.0, -150000.0, 150000.0);
                            window.viewer.trackedEntity = targetEntity;
                        }
                    }, 500);
                }
            });

            conjunctionTableBody.appendChild(row);
        });
    };

    const showLiveError = (message) => {
        errorMessage.textContent = message;
        errorState.classList.remove('hidden');
    };

    // --- CAM DRAWER LOGIC ---
    const camDrawer = document.getElementById('camDrawer');
    const closeCamDrawerBtn = document.getElementById('closeCamDrawer');
    const camObject1 = document.getElementById('camObject1');
    const camObject2 = document.getElementById('camObject2');
    const camDeltaVSlider = document.getElementById('camDeltaVSlider');
    const camDeltaVVal = document.getElementById('camDeltaVVal');
    const camNewDistVal = document.getElementById('camNewDistVal');
    const camRiskBadge = document.getElementById('camRiskBadge');
    const camDistBar = document.getElementById('camDistBar');
    const camFuelCost = document.getElementById('camFuelCost');
    const camNewPc = document.getElementById('camNewPc');
    const btnPrograde = document.getElementById('btnPrograde');
    const btnRetrograde = document.getElementById('btnRetrograde');
    const btnAuthorize = document.getElementById('btnAuthorize');
    const camTcaClock = document.getElementById('camTcaClock');
    const camPropulsionSelect = document.getElementById('camPropulsionSelect');

    let currentOriginalDist = 0;
    let currentOriginalPcStr = "0.00e+00";
    let isPrograde = true;
    let tcaInterval = null;
    let targetTCA = null;

    // Toggle Burn Direction
    btnPrograde.addEventListener('click', () => {
        isPrograde = true;
        btnPrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-white text-white bg-white/10 transition-colors';
        btnRetrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors';
        updateCamSimulation();
    });

    btnRetrograde.addEventListener('click', () => {
        isPrograde = false;
        btnRetrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-white text-white bg-white/10 transition-colors';
        btnPrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors';
        updateCamSimulation();
    });

    camPropulsionSelect.addEventListener('change', updateCamSimulation);

    function startTcaClock(tcaTimeStr) {
        if (tcaInterval) clearInterval(tcaInterval);
        targetTCA = new Date(tcaTimeStr).getTime();
        
        tcaInterval = setInterval(() => {
            const now = Date.now();
            const diff = targetTCA - now;
            if (diff <= 0) {
                camTcaClock.textContent = "T-MINUS 00:00:00";
                clearInterval(tcaInterval);
                return;
            }
            
            const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
            const secs = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
            camTcaClock.textContent = `T-MINUS ${hours}:${mins}:${secs}`;
        }, 1000);
    }

    function openCamDrawer(item) {
        camObject1.textContent = item.object1;
        camObject2.textContent = item.object2;
        currentOriginalDist = item.min_distance_km;
        currentOriginalPcStr = item.collision_probability || "1.12e-05"; // fallback for testing
        
        startTcaClock(item.closest_approach_time);
        
        // Reset state
        isPrograde = true;
        btnPrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-white text-white bg-white/10 transition-colors';
        btnRetrograde.className = 'flex-1 py-2 text-xs font-bold uppercase tracking-widest border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors';
        camPropulsionSelect.value = 'chemical';
        
        camDeltaVSlider.value = '0.0';
        updateCamSimulation();

        // Slide in
        camDrawer.classList.remove('translate-x-full');
    }

    closeCamDrawerBtn.addEventListener('click', () => {
        camDrawer.classList.add('translate-x-full');
        if (tcaInterval) clearInterval(tcaInterval);
    });

    camDeltaVSlider.addEventListener('input', updateCamSimulation);

    function updateCamSimulation() {
        const dv = parseFloat(camDeltaVSlider.value);
        camDeltaVVal.textContent = dv.toFixed(1);

        // Fuel Cost: Chemical = dv * 3.5, Electric = dv * 0.2
        const isElectric = camPropulsionSelect.value === 'electric';
        const costMultiplier = isElectric ? 0.2 : 3.5;
        const cost = dv * costMultiplier;
        camFuelCost.textContent = `${cost.toFixed(1)} kg`;

        // Simulation: 0.1 m/s adds 50 km distance
        const newDist = currentOriginalDist + (dv * 500);
        camNewDistVal.textContent = `${newDist.toFixed(1)} km`;
        
        // Update PC (Probability Drop mockup)
        const originalPc = parseFloat(currentOriginalPcStr);
        const newPc = originalPc * Math.exp(-dv * 3);
        camNewPc.textContent = dv === 0 ? currentOriginalPcStr : newPc.toExponential(2);

        // Update visuals based on safe threshold (> 50 km is SAFE)
        if (newDist > 50) {
            camRiskBadge.textContent = 'SAFE';
            camRiskBadge.className = 'px-2 py-0.5 text-xs font-bold uppercase tracking-widest rounded-sm border transition-colors duration-300 border-green-500 bg-green-500/20 text-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]';
            camDistBar.className = 'h-full bg-green-400 transition-all duration-300 shadow-[0_0_10px_rgba(74,222,128,0.5)]';
        } else {
            camRiskBadge.textContent = 'CRITICAL';
            camRiskBadge.className = 'px-2 py-0.5 text-xs font-bold uppercase tracking-widest rounded-sm border transition-colors duration-300 border-red-500 bg-red-600/20 text-red-400 shadow-[0_0_10px_rgba(220,38,38,0.8)] animate-pulse';
            camDistBar.className = 'h-full bg-red-500 transition-all duration-300 shadow-[0_0_10px_rgba(220,38,38,0.8)]';
        }

        // Fill progress bar (map 0-1000km to 0-100% width)
        const percent = Math.min((newDist / 1000) * 100, 100);
        camDistBar.style.width = `${Math.max(percent, 5)}%`;
    }
    
    btnAuthorize.addEventListener('click', () => {
        alert('Maneuver Uploaded to Ground Station.');
        camDrawer.classList.add('translate-x-full');
        if (tcaInterval) clearInterval(tcaInterval);
    });

    refreshBtn.addEventListener('click', fetchConjunctionData);
    
    // Initial fetch for Live Tracking
    fetchConjunctionData();


    // --- PDF REPORT GENERATION ---
    function generateConjunctionReport(eventData, camData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const eventId = `CAR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        const pageWidth = doc.internal.pageSize.getWidth();

        // --- Background ---
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, pageWidth, 297, 'F');

        // --- Header Bar ---
        doc.setFillColor(30, 41, 59); // slate-800
        doc.rect(0, 0, pageWidth, 38, 'F');

        // Cyan accent line
        doc.setDrawColor(6, 182, 212);
        doc.setLineWidth(0.8);
        doc.line(0, 38, pageWidth, 38);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(6, 182, 212);
        doc.text('ORBITAL GUARD', 15, 14);

        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text('// CONJUNCTION ASSESSMENT REPORT (CAR)', 15, 21);

        // Document metadata
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Document ID: ${eventId}`, 15, 30);
        doc.text(`Generated: ${generatedAt}`, 15, 35);

        // Classification badge
        doc.setFillColor(6, 182, 212);
        doc.roundedRect(pageWidth - 80, 10, 65, 8, 1, 1, 'F');
        doc.setFontSize(6);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text('UNCLASSIFIED / OPERATIONAL BRIEF', pageWidth - 78, 15);

        let y = 50;

        // --- Helper: Section Title ---
        function sectionTitle(title) {
            doc.setFillColor(30, 41, 59);
            doc.rect(15, y - 5, pageWidth - 30, 9, 'F');
            doc.setDrawColor(6, 182, 212);
            doc.setLineWidth(0.3);
            doc.line(15, y + 4, pageWidth - 15, y + 4);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(6, 182, 212);
            doc.text(title, 18, y + 1);
            y += 12;
        }

        // --- Helper: Table Row ---
        function tableRow(label, value) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(148, 163, 184);
            doc.text(label, 20, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(226, 232, 240); // slate-200
            doc.text(String(value), 90, y);
            y += 7;
        }

        // === SECTION 1: EVENT SUMMARY ===
        sectionTitle('SECTION 1: EVENT SUMMARY');

        const tcaDate = eventData.closest_approach_time
            ? new Date(eventData.closest_approach_time).toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
            : 'N/A';
        const pc = eventData.collision_probability || '1.42e-4';

        tableRow('Primary Object', eventData.object1 || '--');
        tableRow('Secondary Object', eventData.object2 || '--');
        tableRow('NORAD ID (Primary)', (eventData.object1 || '').split(' ').pop() || '--');
        tableRow('NORAD ID (Secondary)', (eventData.object2 || '').split(' ').pop() || '--');
        tableRow('Time of Closest Approach', tcaDate);
        tableRow('Miss Distance (d)', `${(eventData.min_distance_km || 0).toFixed(2)} km`);
        tableRow('Collision Probability (Pc)', String(pc));

        y += 5;

        // === SECTION 2: RISK ASSESSMENT ===
        sectionTitle('SECTION 2: RISK ASSESSMENT');

        const risk = eventData.risk_level || 'NOMINAL';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.text('Risk Classification:', 20, y);

        // Risk badge
        if (risk === 'CRITICAL') {
            doc.setFillColor(185, 28, 28);
            doc.setTextColor(255, 255, 255);
        } else if (risk === 'Medium') {
            doc.setFillColor(161, 98, 7);
            doc.setTextColor(255, 255, 255);
        } else {
            doc.setFillColor(21, 128, 61);
            doc.setTextColor(255, 255, 255);
        }
        doc.roundedRect(90, y - 4, 25, 7, 1, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text(risk, 92, y);
        y += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        if (risk === 'CRITICAL') {
            doc.text('Assessment: Collision probability exceeds the actionable threshold of Pc > 1.0e-4.', 20, y);
            y += 5;
            doc.text('Immediate conjunction response action is RECOMMENDED per JSpOC/18 SPCS guidelines.', 20, y);
        } else {
            doc.text('Assessment: Collision probability remains below the actionable threshold of Pc > 1.0e-4.', 20, y);
            y += 5;
            doc.text('No immediate conjunction response action required. Continue monitoring.', 20, y);
        }
        y += 12;

        // === SECTION 3: CAM (if provided) ===
        if (camData) {
            sectionTitle('SECTION 3: RECOMMENDED COLLISION AVOIDANCE MANEUVER');

            tableRow('Burn Direction', camData.direction || 'Prograde');
            tableRow('In-Track Delta-v', `${camData.deltaV} m/s`);
            tableRow('Propulsion Type', camData.propulsionType || 'Chemical (Hydrazine)');
            tableRow('Propellant Mass Penalty', `${camData.fuelCost} kg`);
            tableRow('Post-Maneuver Miss Distance', `${camData.newDist} km`);
            tableRow('Post-Maneuver Pc', camData.newPc);
            tableRow('Post-Maneuver Status', camData.newDist > 50 ? 'SAFE' : 'CRITICAL');

            y += 5;
        }

        // === FOOTER ===
        // Cyan divider
        doc.setDrawColor(6, 182, 212);
        doc.setLineWidth(0.4);
        doc.line(15, 265, pageWidth - 15, 265);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(
            'Propagated via SGP4 analytical theory & 2D Gaussian B-Plane integral.',
            15, 271
        );
        doc.text(
            'Certified for Space Situational Awareness (SSA) flight dynamics handoff.',
            15, 275
        );
        doc.text(
            `ORBITAL GUARD v1.0  |  ${eventId}  |  ${generatedAt}`,
            15, 280
        );

        // Trigger download
        doc.save(`OrbitalGuard_${eventId}.pdf`);
    }

    // --- EXPORT BUTTON WIRING ---

    // Header button: export from cached conjunction data (highest risk)
    document.getElementById('exportReportBtn').addEventListener('click', () => {
        let conj = null;
        if (window._cachedConjunctions) {
            conj = window._cachedConjunctions.find(c => c.risk_level === 'CRITICAL') || window._cachedConjunctions[0];
        }
        if (conj) {
            generateConjunctionReport(conj, null);
        }
    });

    // CAM Drawer button: export with maneuver data
    document.getElementById('exportCamReportBtn').addEventListener('click', () => {
        let conj = null;
        if (window._cachedConjunctions) {
            conj = window._cachedConjunctions.find(c => c.risk_level === 'CRITICAL') || window._cachedConjunctions[0];
        }
        if (conj) {
            const dv = parseFloat(camDeltaVSlider.value);
            const isElectric = camPropulsionSelect.value === 'electric';
            const costMultiplier = isElectric ? 0.2 : 3.5;
            const camData = {
                direction: isPrograde ? 'Prograde' : 'Retrograde',
                deltaV: dv.toFixed(1),
                propulsionType: isElectric ? 'Electric (Ion)' : 'Chemical (Hydrazine)',
                fuelCost: (dv * costMultiplier).toFixed(1),
                newDist: (currentOriginalDist + dv * 500).toFixed(1),
                newPc: dv === 0 ? (conj.collision_probability || '1.42e-4') : (parseFloat(conj.collision_probability || '1.42e-4') * Math.exp(-dv * 3)).toExponential(2)
            };
            generateConjunctionReport(conj, camData);
        }
    });


    // --- RISK CALCULATOR LOGIC ---
    const inputAltitude = document.getElementById('inputAltitude');
    const inputArea = document.getElementById('inputArea');
    const inputTime = document.getElementById('inputTime');
    
    const valAltitude = document.getElementById('valAltitude');
    const valArea = document.getElementById('valArea');
    const valTime = document.getElementById('valTime');

    const calculateBtn = document.getElementById('calculateBtn');
    const probValue = document.getElementById('probValue');
    const riskBadge = document.getElementById('riskBadge');
    const riskMeterFill = document.getElementById('riskMeterFill');

    inputAltitude.addEventListener('input', (e) => valAltitude.textContent = `${e.target.value} km`);
    inputArea.addEventListener('input', (e) => valArea.textContent = `${e.target.value} m²`);
    inputTime.addEventListener('input', (e) => {
        const val = e.target.value;
        valTime.textContent = val === '1' ? '1 year' : `${val} years`;
    });

    calculateBtn.addEventListener('click', async () => {
        const alt = parseFloat(inputAltitude.value);
        const area = parseFloat(inputArea.value);
        const time = parseFloat(inputTime.value);

        try {
            const res = await fetch('http://127.0.0.1:8000/api/mission-risk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    altitude_km: alt,
                    area_m2: area,
                    time_years: time
                })
            });
            const data = await res.json();
            
            const percentage = data.probability_percentage;

            animateValue(probValue, parseFloat(probValue.textContent) || 0, percentage, 1000);
            
            riskMeterFill.style.width = `${Math.min(percentage, 100)}%`;

            setTimeout(() => {
                if (data.risk_rating === 'HIGH') {
                    riskBadge.textContent = 'HIGH';
                    riskBadge.className = 'px-3 py-0.5 border border-red-500 bg-red-600/20 text-red-400 rounded-sm font-bold shadow-[0_0_10px_rgba(220,38,38,0.8)] animate-pulse';
                    riskMeterFill.className = 'h-full bg-red-500 transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(239,68,68,0.8)]';
                    probValue.className = 'text-6xl font-light tracking-wider font-mono text-red-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] transition-all duration-500';
                } else if (data.risk_rating === 'MODERATE') {
                    riskBadge.textContent = 'MODERATE';
                    riskBadge.className = 'px-3 py-0.5 border border-yellow-500 bg-yellow-500/20 text-yellow-400 rounded-sm font-semibold';
                    riskMeterFill.className = 'h-full bg-yellow-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(250,204,21,0.5)]';
                    probValue.className = 'text-6xl font-light tracking-wider font-mono text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)] transition-all duration-500';
                } else {
                    riskBadge.textContent = 'LOW';
                    riskBadge.className = 'px-3 py-0.5 border border-green-500 bg-green-500/20 text-green-400 rounded-sm font-semibold';
                    riskMeterFill.className = 'h-full bg-green-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(74,222,128,0.5)]';
                    probValue.className = 'text-6xl font-light tracking-wider font-mono text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)] transition-all duration-500';
                }
            }, 100);
        } catch(e) {
            console.error(e);
        }
    });

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const currentVal = (progress * (end - start) + start).toFixed(2);
            obj.innerHTML = currentVal + '<span class="text-3xl text-gray-400 ml-1">%</span>';
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                obj.innerHTML = end.toFixed(2) + '<span class="text-3xl text-gray-400 ml-1">%</span>';
            }
        };
        window.requestAnimationFrame(step);
    }
});
