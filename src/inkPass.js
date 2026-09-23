import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Screen-space ink for a whole scene: every object outlined and every hard corner drawn,
 * whatever it is made of.
 *
 * The game inks each item with an inverted hull (scene.js), which suits a handful of known
 * shapes. The menu has hundreds of meshes -- instanced balloons, extruded hearts, see-through
 * film, flat cards on the wall -- and a hull draws only silhouettes, never the crease between
 * two visible faces. So instead the scene is rendered once more with a plain material that
 * writes each pixel's view-space normal and an object id, and a full-screen pass puts a line
 * wherever the id changes (one object against another), the normal turns sharply (a corner),
 * or depth jumps within one object (a part of it overlapping itself).
 *
 * Ids come from `object.id` and, for instanced meshes, the instance index, so every balloon
 * gets its own outline without any per-object setup.
 */

const INFO_VERTEX = /* glsl */ `
uniform float objectId;
varying vec3 vNormal;
varying float vId;
#include <common>
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  vNormal = normalize(transformedNormal);
  float instance = 0.0;
  #ifdef USE_INSTANCING
    instance = float(gl_InstanceID);
  #endif
  // 0 is left for the background. Half-float holds integers exactly up to 2048.
  vId = 1.0 + mod(objectId * 37.0 + instance, 2000.0);
}
`;

const INFO_FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying float vId;
void main() {
  // Double-sided so open or flat surfaces don't leave holes; a back face reports the normal
  // of the side you are actually looking at.
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n, floor(vId + 0.5));
}
`;

const INK_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tInfo: { value: null },
    tDepth: { value: null },
    texel: { value: new THREE.Vector2() },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tInfo;
    uniform sampler2D tDepth;
    uniform vec2 texel;
    uniform float cameraNear;
    uniform float cameraFar;
    varying vec2 vUv;

    // 1/z is linear across a flat surface in screen space, so its second difference is zero
    // on any plane (a floor seen at a grazing angle included) and spikes only at a real step.
    float invZ(vec2 uv) {
      return -1.0 / perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }

    float edgeAlong(vec2 o, vec4 c, float wc) {
      vec4 a = texture2D(tInfo, vUv + o);
      vec4 b = texture2D(tInfo, vUv - o);
      if (abs(a.w - c.w) > 0.5 || abs(b.w - c.w) > 0.5) return 1.0;
      if (c.w < 0.5) return 0.0; // background
      float crease = smoothstep(0.3, 0.5, 1.0 - dot(a.xyz, b.xyz));
      float jump = abs(invZ(vUv + o) + invZ(vUv - o) - 2.0 * wc) / wc;
      return max(crease, smoothstep(0.03, 0.06, jump));
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec4 c = texture2D(tInfo, vUv);
      float wc = invZ(vUv);
      float e = edgeAlong(vec2(texel.x, 0.0), c, wc);
      e = max(e, edgeAlong(vec2(0.0, texel.y), c, wc));
      e = max(e, edgeAlong(texel, c, wc));
      e = max(e, edgeAlong(vec2(texel.x, -texel.y), c, wc));
      gl_FragColor = vec4(mix(color.rgb, vec3(0.0), e), color.a);
    }
  `,
};

/**
 * Replace `renderer.render(scene, camera)` with `ink.render()`. `lineWidth` is in CSS pixels;
 * `exclude` lists objects left out of the ink (they still draw, just unlined).
 */
export function createInkRenderer(renderer, scene, camera, { lineWidth = 2, exclude = [] } = {}) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);

  // MSAA on the colour target keeps the scene itself antialiased through the composer.
  const colorTarget = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, colorTarget);

  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTexture.type = THREE.FloatType;
  const infoTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture,
  });

  const infoMaterial = new THREE.ShaderMaterial({
    uniforms: { objectId: { value: 0 } },
    vertexShader: INFO_VERTEX,
    fragmentShader: INFO_FRAGMENT,
    side: THREE.DoubleSide,
  });
  // With an override material this hook fires once per drawn object, which is where each one
  // gets its id.
  infoMaterial.onBeforeRender = (_r, _s, _c, _g, object) => {
    infoMaterial.uniforms.objectId.value = object.id;
    infoMaterial.uniformsNeedUpdate = true;
  };

  const inkPass = new ShaderPass(INK_SHADER);
  inkPass.uniforms.tInfo.value = infoTarget.texture;
  inkPass.uniforms.tDepth.value = depthTexture;

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(inkPass);
  composer.addPass(new OutputPass());

  const clearColor = new THREE.Color();

  function setSize() {
    renderer.getDrawingBufferSize(size);
    const cssToDevice = renderer.getPixelRatio();
    composer.setPixelRatio(cssToDevice);
    composer.setSize(size.x / cssToDevice, size.y / cssToDevice);
    infoTarget.setSize(size.x, size.y);
    // Each side of a boundary draws, so sampling half a line out gives a line `lineWidth` wide.
    const reach = (lineWidth / 2) * cssToDevice;
    inkPass.uniforms.texel.value.set(reach / size.x, reach / size.y);
  }
  setSize();

  function renderInfo() {
    const background = scene.background;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    const hidden = exclude.filter((o) => o.visible);
    const shadows = renderer.shadowMap.autoUpdate;

    scene.background = null;
    scene.overrideMaterial = infoMaterial;
    for (const o of hidden) o.visible = false;
    renderer.shadowMap.autoUpdate = false; // the info pass needs no shadow maps of its own

    renderer.setRenderTarget(infoTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    renderer.shadowMap.autoUpdate = shadows;
    for (const o of hidden) o.visible = true;
    scene.overrideMaterial = null;
    scene.background = background;
    renderer.setClearColor(clearColor, clearAlpha);
  }

  function render() {
    inkPass.uniforms.cameraNear.value = camera.near;
    inkPass.uniforms.cameraFar.value = camera.far;
    renderInfo();
    composer.render();
  }

  function dispose() {
    composer.dispose();
    colorTarget.dispose();
    infoTarget.dispose();
    depthTexture.dispose();
    infoMaterial.dispose();
    inkPass.material.dispose();
  }

  return { render, setSize, dispose };
}
