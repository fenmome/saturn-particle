import { SaturnEngine } from './saturn.js';
import { GestureTracker } from './gestures.js';

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const loader = document.getElementById('loader');
  const progressBar = document.getElementById('load-progress');
  const loaderStatus = document.querySelector('.loader-status');
  const startBtn = document.getElementById('start-btn');
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.querySelector('.status-text');
  
  // Sliders & Controls
  const particleCountSlider = document.getElementById('particle-count');
  const particleCountVal = document.getElementById('val-particle-count');
  const particleSizeSlider = document.getElementById('particle-size');
  const particleSizeVal = document.getElementById('val-particle-size');
  const orbitSpeedSlider = document.getElementById('orbit-speed');
  const orbitSpeedVal = document.getElementById('val-orbit-speed');
  const bloomStrengthSlider = document.getElementById('bloom-strength');
  const bloomStrengthVal = document.getElementById('val-bloom-strength');
  const bloomRadiusSlider = document.getElementById('bloom-radius');
  const bloomRadiusVal = document.getElementById('val-bloom-radius');
  
  const resetBtn = document.getElementById('btn-reset');
  const toggleCamBtn = document.getElementById('btn-toggle-cam');
  const cameraPreview = document.getElementById('camera-preview-container');
  const webcamElement = document.getElementById('webcam');
  const overlayCanvas = document.getElementById('camera-overlay-canvas');
  const errorModal = document.getElementById('camera-error');
  const retryCamBtn = document.getElementById('btn-retry-camera');
  
  const gestureGuide = document.getElementById('gesture-guide');

  // App instances
  let saturnEngine = null;
  let gestureTracker = null;
  let animationFrameId = null;
  
  // Hand gesture state for continuous rendering
  let currentGestureState = {
    trackingActive: false,
    handX: 0.5,
    handY: 0.5,
    isOpenPalm: false,
    isFist: false,
    gestureType: 'idle'
  };

  // 1. Simulate Loading progress
  let progress = 0;
  const loadInterval = setInterval(() => {
    progress += Math.floor(Math.random() * 15) + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(loadInterval);
      
      // Init 3D Engine
      try {
        saturnEngine = new SaturnEngine('webgl-canvas');
        loaderStatus.textContent = '3D 渲染就绪，请求摄像头权限...';
        
        // Show start button
        progressBar.style.width = '100%';
        startBtn.style.display = 'inline-block';
        progressBar.parentElement.style.display = 'none';
      } catch (e) {
        console.error(e);
        loaderStatus.textContent = '初始化 3D 引擎失败：' + e.message;
      }
    } else {
      progressBar.style.width = `${progress}%`;
      if (progress < 40) {
        loaderStatus.textContent = '正在加载太空格局...';
      } else if (progress < 80) {
        loaderStatus.textContent = '正在构造 200,000 环面尘埃粒子...';
      } else {
        loaderStatus.textContent = '正在计算 Keplerian 轨道速度公式...';
      }
    }
  }, 100);

  // 2. Click Start - Enter 3D scene immediately
  startBtn.addEventListener('click', () => {
    // Fade out loader immediately
    loader.style.opacity = '0';
    setTimeout(() => {
      loader.style.display = 'none';
    }, 800);

    // Start 3D Rendering loop
    startRenderLoop();
  });

  const useMouseBtn = document.getElementById('btn-use-mouse');

  // Retry Camera button inside error modal
  retryCamBtn.addEventListener('click', () => {
    errorModal.style.display = 'none';
    toggleCamBtn.click();
  });

  // Use mouse button inside error modal
  if (useMouseBtn) {
    useMouseBtn.addEventListener('click', () => {
      errorModal.style.display = 'none';
      toggleCamBtn.textContent = '启用手势控制';
      toggleCamBtn.classList.remove('active');
    });
  }

  // 3. Animation Render Loop
  function startRenderLoop() {
    function tick() {
      // Apply continuous movement from gesture state inside the render frame
      if (saturnEngine && currentGestureState.trackingActive) {
        const state = currentGestureState;
        
        // 1. Zoom Control (Open Palm Zoom In / Fist Zoom Out)
        if (state.gestureType === 'zoom_in') {
          saturnEngine.targetZoom -= 0.65; // Zoom in speed
          saturnEngine.targetZoom = Math.max(30, saturnEngine.targetZoom);
        } else if (state.gestureType === 'zoom_out') {
          saturnEngine.targetZoom += 0.65; // Zoom out speed
          saturnEngine.targetZoom = Math.min(130, saturnEngine.targetZoom);
        }
        
        // 2. Proportional Steering (Virtual Joystick based on hand center)
        const dx = state.handX - 0.5;
        const dy = state.handY - 0.5;
        const deadzone = 0.08;
        const rotateSpeed = 0.015; // Steering sensitivity speed

        if (Math.abs(dx) > deadzone) {
          // The further from center, the faster it rotates
          const steerX = dx > 0 ? dx - deadzone : dx + deadzone;
          saturnEngine.targetRotation.y += steerX * rotateSpeed;
        }
        
        if (Math.abs(dy) > deadzone) {
          const steerY = dy > 0 ? dy - deadzone : dy + deadzone;
          saturnEngine.targetRotation.x += steerY * rotateSpeed;
          // Clamp camera pitch
          saturnEngine.targetRotation.x = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, saturnEngine.targetRotation.x));
        }
      }

      if (saturnEngine) {
        saturnEngine.animate();
      }
      animationFrameId = requestAnimationFrame(tick);
    }
    tick();
  }

  // 4. Handle Gesture State Updates (callback from GestureTracker)
  function onGestureUpdate(state) {
    currentGestureState = state;
    if (!saturnEngine) return;

    if (state.trackingActive) {
      statusIndicator.className = 'status-indicator';
      
      if (state.gestureType === 'zoom_in') {
        statusIndicator.classList.add('interacting');
        statusIndicator.style.backgroundColor = 'var(--accent-blue)';
        statusIndicator.style.boxShadow = '0 0 12px var(--accent-blue)';
        statusText.textContent = '手势：张手 (放大中...)';
      } else if (state.gestureType === 'zoom_out') {
        statusIndicator.classList.add('interacting');
        statusIndicator.style.backgroundColor = 'var(--accent-gold)';
        statusIndicator.style.boxShadow = '0 0 12px var(--accent-gold)';
        statusText.textContent = '手势：握拳 (缩小中...)';
      } else if (state.gestureType === 'steering') {
        statusIndicator.classList.add('interacting');
        statusIndicator.style.backgroundColor = 'var(--accent-purple)';
        statusIndicator.style.boxShadow = '0 0 12px var(--accent-purple)';
        
        const dx = state.handX - 0.5;
        const dy = state.handY - 0.5;
        let direction = '移动';
        if (Math.abs(dx) > Math.abs(dy)) {
          direction = dx > 0 ? '右转' : '左转';
        } else {
          direction = dy > 0 ? '下俯' : '上仰';
        }
        statusText.textContent = `手势：指向 ${direction}`;
      } else {
        statusIndicator.classList.add('tracking');
        statusText.textContent = '手势就绪 (悬停)';
      }

      // Pass palm coordinate to Saturn vertex shader for gravity deformation (attract on open palm)
      saturnEngine.updateHandGravity(state.activeHandPos, true, state.isOpenPalm);

    } else {
      statusIndicator.className = 'status-indicator offline';
      statusIndicator.style.backgroundColor = '';
      statusIndicator.style.boxShadow = '';
      statusText.textContent = '未检测到手掌';
      
      // Turn off gravity forces in shader
      saturnEngine.updateHandGravity(null, false, false);
    }
  }

  // 5. Setup UI Sliders Event Listeners
  
  // Particle Count
  particleCountSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    particleCountVal.textContent = `${(val / 1000).toFixed(0)}K`;
  });
  
  // Re-generate particles only when slider drag stops (avoid lagging on dragging)
  particleCountSlider.addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (saturnEngine) {
      saturnEngine.setParticleCount(val);
    }
  });

  // Particle Size
  particleSizeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    particleSizeVal.textContent = val.toFixed(1);
    if (saturnEngine) {
      saturnEngine.setParticleSize(val);
    }
  });

  // Orbit Speed
  orbitSpeedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    orbitSpeedVal.textContent = `${val.toFixed(1)}x`;
    if (saturnEngine) {
      saturnEngine.setOrbitSpeed(val);
    }
  });

  // Bloom Strength
  bloomStrengthSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    bloomStrengthVal.textContent = val.toFixed(1);
    if (saturnEngine) {
      saturnEngine.setBloomStrength(val);
    }
  });

  // Bloom Radius
  bloomRadiusSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    bloomRadiusVal.textContent = val.toFixed(1);
    if (saturnEngine) {
      saturnEngine.setBloomRadius(val);
    }
  });

  // Reset Camera View
  resetBtn.addEventListener('click', () => {
    if (saturnEngine) {
      saturnEngine.resetCamera();
    }
  });

  // Toggle Camera / Gesture Control
  toggleCamBtn.addEventListener('click', async () => {
    if (!gestureTracker) {
      // Initialize gesture tracker on demand
      toggleCamBtn.textContent = '连接中...';
      toggleCamBtn.disabled = true;

      gestureTracker = new GestureTracker(webcamElement, overlayCanvas, onGestureUpdate);
      
      gestureTracker.init()
        .then(() => {
          toggleCamBtn.disabled = false;
          toggleCamBtn.textContent = '关闭手势控制';
          toggleCamBtn.classList.add('active');
          cameraPreview.style.display = 'block';
        })
        .catch((err) => {
          console.error("Camera access failed:", err);
          toggleCamBtn.disabled = false;
          toggleCamBtn.textContent = '启用手势控制';
          toggleCamBtn.classList.remove('active');
          gestureTracker = null;
          // Show error overlay
          errorModal.style.display = 'flex';
        });
    } else {
      // Stop and clean up gesture tracker
      gestureTracker.stop();
      gestureTracker = null;
      cameraPreview.style.display = 'none';
      toggleCamBtn.textContent = '启用手势控制';
      toggleCamBtn.classList.remove('active');
      
      // Update status back to offline
      onGestureUpdate({
        trackingActive: false,
        handCount: 0,
        gestureType: 'idle'
      });
    }
  });

  // Help Guide panel expand toggle
  gestureGuide.addEventListener('click', (e) => {
    // Only toggle if clicking the header tab, not inside contents
    if (e.target.classList.contains('guide-toggle')) {
      gestureGuide.classList.toggle('expanded');
    }
  });
});
