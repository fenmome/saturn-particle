import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Procedural Shader for Saturn's Surface (gas bands + noise)
const SaturnShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    
    uniform vec3 color1;
    uniform vec3 color2;
    uniform vec3 color3;
    uniform float time;

    // Simple noise function for atmospheric turbulence
    float rand(vec2 co){
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }
    
    float noise(vec2 p){
      vec2 ip = floor(p);
      vec2 fp = fract(p);
      fp = fp*fp*(3.0-2.0*fp);
      float a = rand(ip);
      float b = rand(ip + vec2(1.0, 0.0));
      float c = rand(ip + vec2(0.0, 1.0));
      float d = rand(ip + vec2(1.0, 1.0));
      return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
    }

    void main() {
      // Create horizontal bands using sine and noise
      float band = sin(vUv.y * 35.0 + noise(vec2(vUv.x * 5.0, vUv.y * 10.0)) * 2.0);
      band = (band + 1.0) * 0.5;
      
      // Multi-layer band mixing
      vec3 surfaceColor = mix(color1, color2, band);
      
      // Add finer bands
      float fineBand = sin(vUv.y * 120.0);
      fineBand = (fineBand + 1.0) * 0.5;
      surfaceColor = mix(surfaceColor, color3, fineBand * 0.25);
      
      // Add subtle noise for details
      float detailNoise = noise(vUv * 200.0 + vec2(time * 0.05, 0.0));
      surfaceColor += vec3(detailNoise * 0.03);

      // Basic Lambertian lighting (directional light from upper right)
      vec3 lightDirection = normalize(vec3(1.5, 1.0, 1.0));
      float diff = max(dot(vNormal, lightDirection), 0.05); // soft ambient wrap
      
      // Fresnel reflection (atmosphere edge glow)
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
      vec3 glowColor = vec3(0.95, 0.75, 0.5) * fresnel * 0.7;

      vec3 finalColor = surfaceColor * diff + glowColor;
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

// Shader for Saturn's atmospheric glow (Fresnel shell)
const GlowShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    uniform vec3 glowColor;
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      // Fresnel effect
      float intensity = pow(0.6 - dot(vNormal, viewDir), 2.5);
      intensity = max(intensity, 0.0);
      gl_FragColor = vec4(glowColor * intensity, intensity * 0.5);
    }
  `
};

// Shader for Saturn's Rings Particles (GPU acceleration)
const RingParticlesShader = {
  vertexShader: `
    uniform float uTime;
    uniform float uOrbitSpeed;
    uniform float uParticleSize;
    
    // Hand interaction uniforms
    uniform vec3 uHandPos;
    uniform float uHandInfluence; // 0.0 to 1.0
    uniform float uInteractionType; // 0.0 = Idle, 1.0 = Gravity, 2.0 = Repel
    
    attribute float aRadius;
    attribute float aAngle;
    attribute float aOrbitSpeed;
    attribute float aRandom;
    attribute float aVerticalOffset;
    
    varying float vDistance;
    varying float vRandom;
    varying vec3 vPosition;

    void main() {
      vRandom = aRandom;
      vDistance = aRadius;

      // Keplerian orbit rotation: angle changes over time
      float currentAngle = aAngle + uTime * aOrbitSpeed * uOrbitSpeed;
      
      // Base position in cylindrical coordinates
      vec3 basePos = vec3(
        aRadius * cos(currentAngle),
        aVerticalOffset + sin(currentAngle * 5.0 + aRadius) * 0.05, // subtle ring waviness
        aRadius * sin(currentAngle)
      );

      // Apply hand interaction
      if (uHandInfluence > 0.0 && uInteractionType > 0.5) {
        vec3 toHand = uHandPos - basePos;
        float distToHand = length(toHand);
        
        // Sphere of influence radius
        float maxDist = 18.0; 
        if (distToHand < maxDist) {
          // Smooth falloff factor
          float influence = (1.0 - (distToHand / maxDist));
          influence = pow(influence, 2.0) * uHandInfluence;
          
          if (uInteractionType > 0.8 && uInteractionType < 1.2) {
            // Gravity (pull towards hand with a slight spiral torque)
            vec3 pullDir = normalize(toHand);
            vec3 tangent = normalize(vec3(-pullDir.z, 0.0, pullDir.x)); // spiral tangent
            vec3 force = mix(pullDir, tangent, 0.4) * influence * 4.5;
            basePos += force;
          } else if (uInteractionType > 1.8 && uInteractionType < 2.2) {
            // Repel / Push away
            vec3 pushDir = -normalize(toHand);
            basePos += pushDir * influence * 5.0;
          }
        }
      }

      vPosition = basePos;
      vec4 mvPosition = modelViewMatrix * vec4(basePos, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      // Size attenuation based on distance (safe division to avoid division by zero or negative size)
      gl_PointSize = uParticleSize * (50.0 / max(-mvPosition.z, 0.1)) * (0.8 + 0.4 * aRandom);
    }
  `,
  fragmentShader: `
    uniform vec3 uColorInner;
    uniform vec3 uColorOuter;
    uniform vec3 uColorGlow;
    uniform float uInnerRadius;
    uniform float uOuterRadius;

    varying float vDistance;
    varying float vRandom;
    varying vec3 vPosition;

    void main() {
      // Make particles circular and soft
      vec2 temp = gl_PointCoord - vec2(0.5);
      float distToCenter = length(temp);
      if (distToCenter > 0.5) {
        discard;
      }

      // Soft edge alpha falloff
      float alpha = smoothstep(0.5, 0.1, distToCenter);

      // Color interpolation based on radial distance from center
      float t = (vDistance - uInnerRadius) / (uOuterRadius - uInnerRadius);
      t = clamp(t, 0.0, 1.0);

      // Mix colors for nice warm-to-cool ring distribution
      vec3 baseColor = mix(uColorInner, uColorOuter, t);
      
      // Add subtle banding variation
      float ringBanding = sin(vDistance * 4.0) * 0.15 + cos(vDistance * 12.0) * 0.08;
      baseColor += vec3(ringBanding);

      // Sparkle/twinkle effect based on random parameter
      float twinkle = 0.8 + 0.4 * sin(vRandom * 100.0);
      
      gl_FragColor = vec4(baseColor * twinkle, alpha * 0.75);
    }
  `
};

export class SaturnEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x03030c, 0.002);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 35, 75);
    this.camera.lookAt(0, 0, 0);

    // Target values for smooth camera interpolation (used for hand gesture controls)
    this.targetRotation = new THREE.Euler(0, 0, 0);
    this.targetZoom = 75;
    this.targetPosition = new THREE.Vector3(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Post processing setup (Bloom)
    this.setupPostProcessing();

    // Lighting
    this.setupLighting();



    // Handle resizing
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Mouse fallback interaction
    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };
    
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const deltaMove = {
        x: e.clientX - this.previousMousePosition.x,
        y: e.clientY - this.previousMousePosition.y
      };

      // Map mouse movement to rotation target
      this.targetRotation.y -= deltaMove.x * 0.005;
      this.targetRotation.x -= deltaMove.y * 0.005;

      // Clamp vertical rotation
      this.targetRotation.x = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, this.targetRotation.x));

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      // Zoom update (smooth clamp)
      this.targetZoom += e.deltaY * 0.04;
      this.targetZoom = Math.max(30, Math.min(130, this.targetZoom));
    }, { passive: true });

    // Touch fallback interaction (for mobile)
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      
      const deltaMove = {
        x: e.touches[0].clientX - this.previousMousePosition.x,
        y: e.touches[0].clientY - this.previousMousePosition.y
      };

      this.targetRotation.y -= deltaMove.x * 0.005;
      this.targetRotation.x -= deltaMove.y * 0.005;
      this.targetRotation.x = Math.max(-Math.PI / 3.5, Math.min(Math.PI / 3.5, this.targetRotation.x));

      this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Interaction states
    this.uTime = 0.0;
    this.orbitSpeedVal = 1.0;
    this.clock = new THREE.Clock();

    // Interaction variables (gravity)
    this.handPos = new THREE.Vector3(999, 999, 999);
    this.handInfluence = 0.0;
    this.interactionType = 0.0; // 0.0=none, 1.0=gravity, 2.0=repel

    // Add Saturn Body & Rings (must be initialized after state variables)
    this.createSaturn();
    this.createRings(200000); // Default: 200k particles
  }

  setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x0f1025, 0.6);
    this.scene.add(ambientLight);

    // Key directional light (Sun)
    this.dirLight = new THREE.DirectionalLight(0xfff5ea, 2.5);
    this.dirLight.position.set(60, 40, 40);
    this.scene.add(this.dirLight);

    // Subdir light (soft back fill)
    const fillLight = new THREE.DirectionalLight(0x40557a, 0.8);
    fillLight.position.set(-60, -20, -40);
    this.scene.add(fillLight);
  }

  setupPostProcessing() {
    const renderScene = new RenderPass(this.scene, this.camera);
    
    // Unreal Bloom Pass
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      1.2,  // strength
      0.5,  // radius
      0.2   // threshold
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(this.bloomPass);
  }

  createSaturn() {
    // Saturn Body (Radius = 10)
    const saturnGeo = new THREE.SphereGeometry(10, 64, 64);
    
    this.saturnMaterial = new THREE.ShaderMaterial({
      vertexShader: SaturnShader.vertexShader,
      fragmentShader: SaturnShader.fragmentShader,
      uniforms: {
        color1: { value: new THREE.Color(0xd2b48c) }, // Sandy tan
        color2: { value: new THREE.Color(0x8b7355) }, // Dark tan/brown
        color3: { value: new THREE.Color(0xa0522d) }, // Sienna/reddish-brown
        time: { value: 0.0 }
      }
    });

    this.saturnMesh = new THREE.Mesh(saturnGeo, this.saturnMaterial);
    this.scene.add(this.saturnMesh);

    // Atmospheric Glow Ring
    const glowGeo = new THREE.SphereGeometry(10.6, 32, 32);
    this.glowMaterial = new THREE.ShaderMaterial({
      vertexShader: GlowShader.vertexShader,
      fragmentShader: GlowShader.fragmentShader,
      uniforms: {
        glowColor: { value: new THREE.Color(0xf2caa2) }
      },
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    this.glowMesh = new THREE.Mesh(glowGeo, this.glowMaterial);
    this.scene.add(this.glowMesh);
  }

  createRings(particleCount) {
    if (this.ringPoints) {
      this.scene.remove(this.ringPoints);
      this.ringGeometry.dispose();
      this.ringMaterial.dispose();
    }

    this.ringGeometry = new THREE.BufferGeometry();
    
    // Custom data attributes
    const positions = new Float32Array(particleCount * 3);
    const aRadius = new Float32Array(particleCount);
    const aAngle = new Float32Array(particleCount);
    const aOrbitSpeed = new Float32Array(particleCount);
    const aRandom = new Float32Array(particleCount);
    const aVerticalOffset = new Float32Array(particleCount);

    const innerRadius = 14.5;
    const outerRadius = 36.0;

    // Define division zones (gaps in rings) to make them look authentic
    // Cassini: 25.5 to 27.5
    // Encke: 32.2 to 32.8
    // F-ring gap: 34.2 to 34.8
    const isInsideDivision = (r) => {
      if (r >= 25.4 && r <= 27.2) return true; // Cassini Division
      if (r >= 31.8 && r <= 32.3) return true; // Encke Division
      if (r >= 34.5 && r <= 34.9) return true; // Ring outer gap
      return false;
    };

    for (let i = 0; i < particleCount; i++) {
      let r = 0;
      
      // Keep generating radius until it doesn't fall into a division or falls into it with low probability
      while (true) {
        // Distribute density: denser closer to planet
        const factor = Math.pow(Math.random(), 1.5);
        r = innerRadius + (outerRadius - innerRadius) * factor;

        // Simulate division gaps
        if (isInsideDivision(r)) {
          if (Math.random() > 0.08) continue; // 92% chance to discard inside gaps
        }
        break;
      }

      const angle = Math.random() * Math.PI * 2;
      
      // Keplerian orbit speed factor (omega proportional to r^-1.5)
      // Base speed constant
      const speedConstant = 0.25;
      const speed = speedConstant / Math.pow(r, 1.5);

      // Ring thickness profile: thinner at outer edges
      const rRatio = (r - innerRadius) / (outerRadius - innerRadius);
      const thickness = (1.0 - rRatio * 0.7) * 0.4;
      const verticalOffset = (Math.random() - 0.5) * (Math.random() - 0.5) * thickness;

      positions[i * 3] = r * Math.cos(angle);
      positions[i * 3 + 1] = verticalOffset;
      positions[i * 3 + 2] = r * Math.sin(angle);

      aRadius[i] = r;
      aAngle[i] = angle;
      aOrbitSpeed[i] = speed;
      aRandom[i] = Math.random();
      aVerticalOffset[i] = verticalOffset;
    }

    this.ringGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ringGeometry.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    this.ringGeometry.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    this.ringGeometry.setAttribute('aOrbitSpeed', new THREE.BufferAttribute(aOrbitSpeed, 1));
    this.ringGeometry.setAttribute('aRandom', new THREE.BufferAttribute(aRandom, 1));
    this.ringGeometry.setAttribute('aVerticalOffset', new THREE.BufferAttribute(aVerticalOffset, 1));

    // Particle Shader Material
    this.ringMaterial = new THREE.ShaderMaterial({
      vertexShader: RingParticlesShader.vertexShader,
      fragmentShader: RingParticlesShader.fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uOrbitSpeed: { value: 1.0 },
        uParticleSize: { value: 1.5 },
        uColorInner: { value: new THREE.Color(0xfadba8) }, // Warm gold dust
        uColorOuter: { value: new THREE.Color(0xa2b5cd) }, // Ice blue dust
        uInnerRadius: { value: innerRadius },
        uOuterRadius: { value: outerRadius },
        
        // Hand coordinates and interaction
        uHandPos: { value: this.handPos },
        uHandInfluence: { value: this.handInfluence },
        uInteractionType: { value: this.interactionType }
      },
      transparent: true,
      depthWrite: false, // Prevents black outline issues on overlapping transparent objects
      blending: THREE.AdditiveBlending
    });

    this.ringPoints = new THREE.Points(this.ringGeometry, this.ringMaterial);
    this.scene.add(this.ringPoints);
  }

  // Smooth gesture controls (Interpolating towards target rotation and zoom)
  updateControls() {
    // Lerp Camera Rotation
    this.camera.position.x += (Math.sin(this.targetRotation.y) * Math.cos(this.targetRotation.x) * this.targetZoom - this.camera.position.x) * 0.1;
    this.camera.position.y += (Math.sin(this.targetRotation.x) * this.targetZoom - this.camera.position.y) * 0.1;
    this.camera.position.z += (Math.cos(this.targetRotation.y) * Math.cos(this.targetRotation.x) * this.targetZoom - this.camera.position.z) * 0.1;
    
    // Lerp target position (pan)
    this.camera.lookAt(this.targetPosition);
  }

  // Map 2D hand landmarks to 3D world space (gravity position)
  updateHandGravity(handLandmark, trackingActive, isOpenPalm) {
    if (!trackingActive || !handLandmark) {
      this.handInfluence = Math.max(0.0, this.handInfluence - 0.08); // fade out interaction
      return;
    }

    // Convert normalized coordinates (0 to 1) to clip space (-1 to 1)
    // Invert X because camera overlay is mirrored
    const x = -(handLandmark.x * 2 - 1) * 35; // map to scene bounds
    const y = -(handLandmark.y * 2 - 1) * 25;
    const z = (handLandmark.z || 0) * -40;     // depth approximation

    // Smoothly interpolate hand position in 3D
    this.handPos.lerp(new THREE.Vector3(x, y, z), 0.2);
    
    // Scale hand influence
    this.handInfluence = Math.min(1.0, this.handInfluence + 0.1);
    
    // Set interaction type: 1.0 = Gravity (Open Palm)
    this.interactionType = isOpenPalm ? 1.0 : 0.0; // Only pull when hand is open
  }

  setParticleCount(count) {
    this.createRings(count);
  }

  setParticleSize(size) {
    if (this.ringMaterial) {
      this.ringMaterial.uniforms.uParticleSize.value = size;
    }
  }

  setOrbitSpeed(speed) {
    this.orbitSpeedVal = speed;
  }

  setBloomStrength(strength) {
    this.bloomPass.strength = strength;
  }

  setBloomRadius(radius) {
    this.bloomPass.radius = radius;
  }

  resetCamera() {
    this.targetRotation.set(0, 0, 0);
    this.targetZoom = 75;
    this.targetPosition.set(0, 0, 0);
  }

  onWindowResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
  }

  // Animation Loop
  animate() {
    const delta = this.clock.getDelta();
    this.uTime += delta * this.orbitSpeedVal;

    // Update shaders uniforms
    if (this.ringMaterial) {
      this.ringMaterial.uniforms.uTime.value = this.uTime;
      this.ringMaterial.uniforms.uHandPos.value.copy(this.handPos);
      this.ringMaterial.uniforms.uHandInfluence.value = this.handInfluence;
      this.ringMaterial.uniforms.uInteractionType.value = this.interactionType;
    }

    if (this.saturnMaterial) {
      this.saturnMaterial.uniforms.time.value = this.uTime;
    }

    // Slowly rotate Saturn itself
    if (this.saturnMesh) {
      this.saturnMesh.rotation.y = this.uTime * 0.05;
    }

    // Apply smooth control transitions
    this.updateControls();

    // Render with bloom, fallback to standard WebGL renderer on error
    try {
      if (this.composer && !this.disableBloom) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    } catch (err) {
      console.warn("WebGL Post-processing (Bloom) failed, falling back to standard rendering:", err);
      this.disableBloom = true;
      
      // Attempt standard render
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (err2) {
        console.error("Standard rendering failed:", err2);
      }
    }
  }
}
