// Helper function to calculate Euclidean distance between 2D or 3D points
function distance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class GestureTracker {
  constructor(videoElement, canvasElement, onGestureUpdate) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.onGestureUpdate = onGestureUpdate; // callback to send gestures to SaturnEngine
    
    // Smooth tracking variables
    this.lastPinchPos = null;
    this.baseZoomDistance = null;
    this.initialTargetZoom = 75;

    // Gesture history for smoothing/low-pass filters
    this.smoothRotationSpeed = 0.007;
    this.smoothZoomSpeed = 0.5;

    this.isCameraActive = false;
    this.cameraInstance = null;
    this.handsInstance = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      if (!window.Hands || !window.Camera) {
        reject(new Error("MediaPipe Hands libraries not loaded from CDN."));
        return;
      }

      // Initialize MediaPipe Hands
      const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
      });

      hands.onResults(this.onResults.bind(this));
      this.handsInstance = hands;

      // Start webcam stream
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: "user" 
        } 
      })
      .then((stream) => {
        this.video.srcObject = stream;
        
        // Setup MediaPipe camera helper
        const camera = new window.Camera(this.video, {
          onFrame: async () => {
            if (this.isCameraActive) {
              await hands.send({ image: this.video });
            }
          },
          width: 640,
          height: 480
        });

        this.cameraInstance = camera;
        this.isCameraActive = true;
        camera.start();

        // Adjust canvas dimensions to match video ratio
        this.video.addEventListener('loadedmetadata', () => {
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
        });

        resolve();
      })
      .catch((err) => {
        reject(err);
      });
    });
  }

  stop() {
    this.isCameraActive = false;
    if (this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
  }

  // Check if a hand is pinching (thumb tip near index tip)
  isHandPinching(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    
    // Scale distance based on hand size (wrist to middle finger base)
    const handScale = distance(wrist, landmarks[9]);
    const pinchDist = distance(thumbTip, indexTip) / handScale;

    // A relative distance of < 0.15 typically means thumb and index are pinching
    return {
      pinched: pinchDist < 0.16,
      distance: pinchDist,
      center: {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2,
        z: (thumbTip.z + indexTip.z) / 2
      }
    };
  }

  // Check if hand is open (fingers extended)
  isHandOpen(landmarks) {
    const wrist = landmarks[0];
    const handScale = distance(wrist, landmarks[9]);

    // Check distance from wrist to each finger tip relative to their base knuckles (MCP joints)
    const fingerTips = [8, 12, 16, 20]; // index, middle, ring, pinky
    const fingerBases = [5, 9, 13, 17];

    let openFingersCount = 0;
    for (let i = 0; i < 4; i++) {
      const tipDist = distance(wrist, landmarks[fingerTips[i]]);
      const baseDist = distance(wrist, landmarks[fingerBases[i]]);
      
      // If the tip is significantly further from the wrist than the knuckle base, finger is open
      if (tipDist > baseDist + (handScale * 0.15)) {
        openFingersCount++;
      }
    }

    // Thumb check (horizontal distance from index finger base)
    const thumbTip = landmarks[4];
    const indexBase = landmarks[5];
    const thumbDist = distance(thumbTip, indexBase) / handScale;
    if (thumbDist > 0.4) {
      openFingersCount++;
    }

    // Hand is open if 4 or more fingers are extended
    return openFingersCount >= 4;
  }

  // Check if hand is a fist (fingers folded)
  isHandFist(landmarks) {
    const wrist = landmarks[0];
    const handScale = distance(wrist, landmarks[9]);

    // Check distance from wrist to each finger tip relative to their knuckles
    const fingerTips = [8, 12, 16, 20]; // index, middle, ring, pinky
    const fingerBases = [5, 9, 13, 17];

    let closedFingersCount = 0;
    for (let i = 0; i < 4; i++) {
      const tipDist = distance(wrist, landmarks[fingerTips[i]]);
      const baseDist = distance(wrist, landmarks[fingerBases[i]]);
      
      // If the tip is closer to the wrist than the knuckle base, finger is closed
      if (tipDist < baseDist) {
        closedFingersCount++;
      }
    }

    // Hand is a fist if 3 or more fingers are closed
    return closedFingersCount >= 3;
  }

  // Draw hand landmarks overlay on the monitoring canvas
  drawOverlay(results) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // If we have video frame, draw it on the preview canvas
    this.ctx.save();
    this.ctx.translate(this.canvas.width, 0);
    this.ctx.scale(-1, 1); // mirror horizontal
    this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      return;
    }

    // Draw hand skeleton skeleton and landmarks
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      const isRightHand = results.multiHandedness[i].label === 'Right';
      
      // Select connection color based on hand state
      const openState = this.isHandOpen(landmarks);
      const fistState = this.isHandFist(landmarks);
      
      let color = '#00d2ff'; // default: blue (tracking)
      if (fistState) {
        color = '#ff3b30'; // red: fist (zoom out)
      } else if (openState) {
        color = '#7928ca'; // purple: open palm (zoom in)
      }

      // Draw skeleton lines
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = color;
      
      // Draw wrist to fingers path
      this.drawPath([0, 1, 2, 3, 4], landmarks, color); // Thumb
      this.drawPath([0, 5, 6, 7, 8], landmarks, color); // Index
      this.drawPath([9, 10, 11, 12], landmarks, color); // Middle
      this.drawPath([13, 14, 15, 16], landmarks, color); // Ring
      this.drawPath([0, 17, 18, 19, 20], landmarks, color); // Pinky
      this.drawPath([5, 9, 13, 17], landmarks, color); // Palm knuckle connection

      // Draw knuckles/points
      for (const pt of landmarks) {
        // Mirror X coordinate to match flipped preview
        const x = (1 - pt.x) * this.canvas.width;
        const y = pt.y * this.canvas.height;
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
      }

      // Highlight pinch center or gravity source
      if (pinchState.pinched) {
        const px = (1 - pinchState.center.x) * this.canvas.width;
        const py = pinchState.center.y * this.canvas.height;
        this.ctx.beginPath();
        this.ctx.arc(px, py, 8, 0, 2 * Math.PI);
        this.ctx.fillStyle = 'rgba(255, 170, 0, 0.4)';
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffaa00';
        this.ctx.stroke();
      }
    }
  }

  drawPath(indices, landmarks, color) {
    this.ctx.beginPath();
    for (let j = 0; j < indices.length; j++) {
      const pt = landmarks[indices[j]];
      const x = (1 - pt.x) * this.canvas.width;
      const y = pt.y * this.canvas.height;
      if (j === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
  }

  // Parse MediaPipe landmarks and map to gestures
  onResults(results) {
    // Draw skeletal overlay
    this.drawOverlay(results);

    const hands = results.multiHandLandmarks;
    
    // Hide or show the landing screen camera helper hint
    const hintEl = document.getElementById('camera-hint');
    if (hintEl) {
      hintEl.style.opacity = (hands && hands.length > 0) ? '0' : '1';
    }

    const state = {
      trackingActive: hands && hands.length > 0,
      handCount: hands ? hands.length : 0,
      gestureType: 'idle', // 'idle', 'zoom_in', 'zoom_out', 'steering'
      handX: 0.5,         // Proportional steering center X (0 to 1)
      handY: 0.5,         // Proportional steering center Y (0 to 1)
      activeHandPos: null, // used for gravity attraction position
      isOpenPalm: false,
      isFist: false
    };

    if (!state.trackingActive) {
      this.onGestureUpdate(state);
      return;
    }

    // Process primary hand
    const primaryHand = hands[0];
    const palmCenter = primaryHand[9]; // Middle finger MCP joint represents palm center
    
    // Mirror X coordinate because camera preview is mirrored
    state.handX = 1.0 - palmCenter.x;
    state.handY = palmCenter.y;
    state.activeHandPos = palmCenter;

    // Detect open palm and fist states
    const isOpen = this.isHandOpen(primaryHand);
    const isFist = this.isHandFist(primaryHand);

    state.isOpenPalm = isOpen;
    state.isFist = isFist;

    // Proportional virtual joystick steering deadzone check
    const dx = state.handX - 0.5;
    const dy = state.handY - 0.5;
    const deadzone = 0.08;

    if (isOpen) {
      state.gestureType = 'zoom_in';
    } else if (isFist) {
      state.gestureType = 'zoom_out';
    } else if (Math.abs(dx) > deadzone || Math.abs(dy) > deadzone) {
      state.gestureType = 'steering';
    }

    // If there is a second hand, let it override zoom/gravity (e.g. hand1 fist, hand2 open -> open wins)
    if (hands.length === 2) {
      const secondHand = hands[1];
      const secondOpen = this.isHandOpen(secondHand);
      const secondFist = this.isHandFist(secondHand);

      if (secondOpen) {
        state.isOpenPalm = true;
        state.gestureType = 'zoom_in';
        state.activeHandPos = secondHand[9];
      } else if (secondFist && !state.isOpenPalm) {
        state.isFist = true;
        state.gestureType = 'zoom_out';
      }
    }

    // Dispatch update to 3D engine callback
    this.onGestureUpdate(state);
  }
}
