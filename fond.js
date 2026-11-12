// Fond animé (direction artistique de microsoft.ai) : nappes de lumière sable, ambre et pêche sur bleu ardoise,
// floues et étirées en diagonale, qui dérivent lentement, sans rien charger d'Internet. Calculé en petite résolution puis adouci par un flou CSS.
// Mouvement réduit demandé par macOS → une seule image fixe. Sans WebGL → dégradé CSS de secours.
(() => {
  const canvas = document.getElementById('fond');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return;

  const sommets = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const pixels = `
    precision mediump float;
    uniform vec2 taille;
    uniform float temps;
    uniform vec2 souris;
    uniform vec2 curseur;     // position du curseur dans le cadre (0 à 1, haut en 1)
    uniform float elan;       // vitesse récente du curseur (0 au repos, 1 en mouvement)

    float hasard(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
    vec2 hasard2(vec2 p) {
      return fract(sin(vec2(dot(p, vec2(41.3, 289.1)), dot(p, vec2(197.7, 61.9)))) * 15731.743);
    }
    float bruit(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hasard(i), hasard(i + vec2(1.0, 0.0)), u.x),
                 mix(hasard(i + vec2(0.0, 1.0)), hasard(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    // une tache douce par case, qui oscille autour de sa place ; rayon et éclat propres à chaque case
    float taches(vec2 p, float vitesse) {
      vec2 i = floor(p), f = fract(p);
      float somme = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 c = vec2(float(x), float(y));
          vec2 graine = i + c;
          vec2 o = 0.5 + 0.42 * sin(temps * vitesse + 6.2831 * hasard2(graine));
          float rayon = 0.34 + 0.4 * hasard(graine + 7.0);
          float eclat = 0.35 + 0.65 * hasard(graine + 3.0);
          somme += eclat * smoothstep(rayon, 0.0, length(c + o - f));
        }
      }
      return somme;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / taille;
      vec2 p = (uv - 0.5) * vec2(taille.x / taille.y, 1.0) + souris * 0.03;
      // le curseur écarte doucement les nappes autour de lui, plus fort quand il bouge
      vec2 ecart = (uv - curseur) * vec2(taille.x / taille.y, 1.0);
      float proche = exp(-dot(ecart, ecart) * 9.0);
      p += normalize(ecart + 1e-4) * proche * (0.05 + 0.10 * elan);
      // ondulation lente de tout le champ
      p += 0.09 * vec2(sin(p.y * 1.6 + temps * 0.12), sin(p.x * 1.3 - temps * 0.10));

      // grandes nappes diagonales, comme une lumière d'aube floue
      float a = -0.55;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
      float n1 = bruit(q * vec2(1.1, 2.6) + vec2(temps * 0.035, 0.0));
      float n2 = bruit(q * vec2(1.8, 3.4) - vec2(0.0, temps * 0.028) + 7.0);
      float v = taches(q * vec2(1.6, 4.2) + vec2(temps * 0.02, 0.0), 0.22);

      // palette : bleu ardoise, sable, ambre, pêche, et un voile crème là où la lumière est forte
      vec3 ardoise = vec3(0.475, 0.553, 0.627);
      vec3 sable   = vec3(0.886, 0.792, 0.596);
      vec3 ambre   = vec3(0.937, 0.722, 0.431);
      vec3 peche   = vec3(0.902, 0.663, 0.553);
      vec3 creme   = vec3(0.980, 0.972, 0.953);
      vec3 couleur = mix(ardoise, sable, smoothstep(0.38, 0.82, n1 + 0.25 * (uv.y - 0.5)));
      couleur = mix(couleur, ambre, smoothstep(0.6, 0.98, n2) * 0.6);
      couleur = mix(couleur, peche, smoothstep(0.6, 1.0, n1 * n2 * 1.6) * 0.45);
      couleur = mix(couleur, creme, smoothstep(0.55, 1.2, v) * 0.35);
      // une lumière chaude suit le curseur
      couleur = mix(couleur, mix(creme, ambre, 0.35), exp(-dot(ecart, ecart) * 16.0) * (0.22 + 0.28 * elan));
      couleur += (hasard(gl_FragCoord.xy + temps) - 0.5) * 0.035;  // grain, comme une pellicule
      gl_FragColor = vec4(couleur, 1.0);
    }`;

  const compiler = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compiler(gl.VERTEX_SHADER, sommets), fs = compiler(gl.FRAGMENT_SHADER, pixels);
  if (!vs || !fs) return;
  const programme = gl.createProgram();
  gl.attachShader(programme, vs);
  gl.attachShader(programme, fs);
  gl.linkProgram(programme);
  if (!gl.getProgramParameter(programme, gl.LINK_STATUS)) return;
  gl.useProgram(programme);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(programme, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const u = { taille: gl.getUniformLocation(programme, 'taille'), temps: gl.getUniformLocation(programme, 'temps'),
              souris: gl.getUniformLocation(programme, 'souris'), curseur: gl.getUniformLocation(programme, 'curseur'),
              elan: gl.getUniformLocation(programme, 'elan') };

  const ECHELLE = 0.35;  // le flou CSS masque la basse résolution
  const ajuster = () => {
    canvas.width = Math.max(1, Math.round(innerWidth * ECHELLE));
    canvas.height = Math.max(1, Math.round(innerHeight * ECHELLE));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  ajuster();

  // la souris décale légèrement le champ, avec retard (effet de profondeur)
  const cible = { x: 0, y: 0 }, actuel = { x: 0, y: 0 };
  let elan = 0, elanCible = 0, bouge = performance.now();
  addEventListener('pointermove', ev => {
    bouge = performance.now();
    const x = ev.clientX / innerWidth - 0.5, y = 0.5 - ev.clientY / innerHeight;
    elanCible = Math.min(1, elanCible + Math.hypot(x - cible.x, y - cible.y) * 6);
    cible.x = x;
    cible.y = y;
  });

  const immobile = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const depart = performance.now() - 40000 * Math.random();  // pas deux fois le même départ
  let derniere = 0;
  const dessiner = (maintenant = performance.now()) => {
    actuel.x += (cible.x - actuel.x) * 0.08;
    actuel.y += (cible.y - actuel.y) * 0.08;
    elan += (elanCible - elan) * 0.1;
    elanCible *= 0.94;  // l'élan retombe quand la souris s'arrête
    gl.uniform2f(u.taille, canvas.width, canvas.height);
    gl.uniform1f(u.temps, (maintenant - depart) / 1000);
    gl.uniform2f(u.souris, actuel.x, actuel.y);
    // le cadre déborde de 40 px de chaque côté (style.css) : on recale le curseur sur lui
    gl.uniform2f(u.curseur, ((actuel.x + 0.5) * innerWidth + 40) / (innerWidth + 80),
                 ((actuel.y + 0.5) * innerHeight + 40) / (innerHeight + 80));
    gl.uniform1f(u.elan, elan);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const boucle = maintenant => {
    requestAnimationFrame(boucle);
    // 30 images/s quand la souris bouge ; souris immobile depuis 3 s, 10 images/s suffisent à la lente dérive des
    // nappes (le flou cache la différence) et le Mac chauffe moins ; rien quand l'onglet est caché.
    const pas = maintenant - bouge < 3000 || elan > 0.02 ? 33 : 100;
    if (document.hidden || maintenant - derniere < pas) return;
    derniere = maintenant;
    dessiner(maintenant);
  };
  addEventListener('resize', () => { ajuster(); if (immobile) dessiner(); });  // image fixe : redessinée à la nouvelle taille
  canvas.classList.add('actif');
  if (immobile) dessiner(); else requestAnimationFrame(boucle);
})();
