import * as THREE from 'three/build/three.module';

/**
 * @author Slayvin / http://slayvin.net
 */

const Mirror = function (width, height, options) {
  THREE.Mesh.call(this, new THREE.PlaneBufferGeometry(width, height));

  const scope = this;

  scope.name = `mirror_${scope.id}`;
  scope.matrixNeedsUpdate = true;

  options = options || {};

  const viewport = new THREE.Vector4();

  const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
  const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;

  const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
  const mirrorColor = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x7F7F7F);

  const mirrorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const mirrorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();

  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();

  const textureMatrix = new THREE.Matrix4();

  const mirrorCamera = new THREE.PerspectiveCamera();

  const parameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBFormat,
    stencilBuffer: false
  };

  const renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, parameters);

  if (!THREE.Math.isPowerOfTwo(textureWidth) || !THREE.Math.isPowerOfTwo(textureHeight)) {
    renderTarget.texture.generateMipmaps = false;
  }

  const mirrorShader = {

    uniforms: {
      mirrorColor: { value: new THREE.Color(0x7F7F7F) },
      mirrorSampler: { value: null },
      textureMatrix: { value: new THREE.Matrix4() }
    },

    vertexShader: [
      'uniform mat4 textureMatrix;',
      'varying vec4 mirrorCoord;',

      'void main() {',

      '	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
      '	vec4 worldPosition = modelMatrix * vec4( position, 1.0 );',
      '	mirrorCoord = textureMatrix * worldPosition;',

      '	gl_Position = projectionMatrix * mvPosition;',

      '}'
    ].join('\n'),

    fragmentShader: [
      'uniform vec3 mirrorColor;',
      'uniform sampler2D mirrorSampler;',
      'varying vec4 mirrorCoord;',

      'float blendOverlay(float base, float blend) {',
      '	return( base < 0.5 ? ( 2.0 * base * blend ) : (1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );',
      '}',

      'void main() {',
      '	vec4 color = texture2DProj(mirrorSampler, mirrorCoord);',
      '	color = vec4(blendOverlay(mirrorColor.r, color.r), blendOverlay(mirrorColor.g, color.g), blendOverlay(mirrorColor.b, color.b), 1.0);',
      '	gl_FragColor = color;',
      '}'
    ].join('\n')

  };

  const mirrorUniforms = THREE.UniformsUtils.clone(mirrorShader.uniforms);

  const material = new THREE.ShaderMaterial({

    fragmentShader: mirrorShader.fragmentShader,
    vertexShader: mirrorShader.vertexShader,
    uniforms: mirrorUniforms

  });

  material.uniforms.mirrorSampler.value = renderTarget.texture;
  material.uniforms.mirrorColor.value = mirrorColor;
  material.uniforms.textureMatrix.value = textureMatrix;

  scope.material = material;

  function updateTextureMatrix(camera) {
    scope.updateMatrixWorld();

    mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

    rotationMatrix.extractRotation(scope.matrixWorld);

    normal.set(0, 0, 1);
    normal.applyMatrix4(rotationMatrix);

    view.subVectors(mirrorWorldPosition, cameraWorldPosition);
    view.reflect(normal).negate();
    view.add(mirrorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);

    lookAtPosition.set(0, 0, -1);
    lookAtPosition.applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);

    target.subVectors(mirrorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(mirrorWorldPosition);

    mirrorCamera.position.copy(view);
    mirrorCamera.up.set(0, 1, 0);
    mirrorCamera.up.applyMatrix4(rotationMatrix);
    mirrorCamera.up.reflect(normal);
    mirrorCamera.lookAt(target);

    mirrorCamera.aspect = camera.aspect;
    mirrorCamera.near = camera.near;
    mirrorCamera.far = camera.far;

    mirrorCamera.updateMatrixWorld();
    mirrorCamera.updateProjectionMatrix();

		// Update the texture matrix
    textureMatrix.set(
			0.5, 0.0, 0.0, 0.5,
			0.0, 0.5, 0.0, 0.5,
			0.0, 0.0, 0.5, 0.5,
			0.0, 0.0, 0.0, 1.0
		);
    textureMatrix.multiply(mirrorCamera.projectionMatrix);
    textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

		// Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
		// Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
    mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

    const projectionMatrix = mirrorCamera.projectionMatrix;

    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

		// Calculate the scaled plane vector
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

		// Replacing the third row of the projection matrix
    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
    projectionMatrix.elements[14] = clipPlane.w;
  }

  scope.onBeforeRender = function (renderer, scene, camera) {
    updateTextureMatrix(camera);

    scope.visible = false;

    const currentRenderTarget = renderer.getRenderTarget();

    const currentVrEnabled = renderer.vr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

    renderer.vr.enabled = false; // Avoid camera modification and recursion
    renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows

    renderer.render(scene, mirrorCamera, renderTarget, true);

    renderer.vr.enabled = currentVrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

    renderer.setRenderTarget(currentRenderTarget);

		// Restore viewport

    const bounds = camera.bounds;

    if (bounds !== undefined) {
      const size = renderer.getSize();
      const pixelRatio = renderer.getPixelRatio();

      viewport.x = bounds.x * size.width * pixelRatio;
      viewport.y = bounds.y * size.height * pixelRatio;
      viewport.z = bounds.z * size.width * pixelRatio;
      viewport.w = bounds.w * size.height * pixelRatio;

      renderer.state.viewport(viewport);
    }

    scope.visible = true;
  };
};

Mirror.prototype = Object.create(THREE.Mesh.prototype);

export default Mirror;