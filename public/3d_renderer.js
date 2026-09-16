window.R3D = (function() {
  let scene, camera, renderer;
  let clock = new THREE.Clock();
  let mixers = [];
  let characters = []; 

  function init() {
    const canvas = document.getElementById('bg-3d');
    if (!canvas) return;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 100, 300); 

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(0, 200, 100);
    scene.add(dirLight);

    window.addEventListener('resize', onWindowResize, false);
    
    requestAnimationFrame(animate);
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    mixers.forEach(mixer => mixer.update(delta));
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function clearCharacters() {
    characters.forEach(char => {
      scene.remove(char.model);
    });
    characters = [];
    mixers = [];
  }

  function setCharacters(members) {
    clearCharacters();
    if (!scene) return;
    
    const loader = new THREE.FBXLoader();
    
    // Posiciones al lado de la pista, mirror para que miren hacia el centro
    const positions = [
      { x: 130, z: 80, rot: -0.3, mirrorX: true },   // Derecha frontal (principal)
      { x: 170, z: 0, rot: -0.4, mirrorX: true },     // Derecha medio
      { x: -130, z: 80, rot: 0.3, mirrorX: false },   // Izquierda frontal
      { x: -170, z: 0, rot: 0.4, mirrorX: false }     // Izquierda medio
    ];

    // El jugador local ('me') siempre toma la primera posición
    const sortedMembers = [...members].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
    
    sortedMembers.forEach((m, i) => {
      const fbxPath = 'assets/' + m.character + '.fbx';
      
      loader.load(fbxPath, (object) => {
        let pos = positions[i % positions.length];
        
        // Espejo en X para que mire hacia la pista
        const sx = pos.mirrorX ? -0.7 : 0.7;
        object.scale.set(sx, 0.7, 0.7);
        
        object.position.set(pos.x, 0, pos.z);
        object.rotation.y = pos.rot;
        
        scene.add(object);

        let mixer = new THREE.AnimationMixer(object);
        if (object.animations.length > 0) {
          const action = mixer.clipAction(object.animations[0]);
          action.play();
        }
        mixers.push(mixer);
        characters.push({ name: m.name, model: object, mixer: mixer, isMe: m.me });
      }, undefined, (error) => {
        console.warn('Error loading FBX para', m.character, ':', error);
      });
    });
  }

  function update(members) {
     // Aqui se pueden sincronizar animaciones o estados en el futuro
  }

  return {
    init: init,
    setCharacters: setCharacters,
    update: update
  };
})();
