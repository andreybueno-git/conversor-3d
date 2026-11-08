import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* O VISOR DO CONVERSOR: a peça como vai para a mesa (mm, Z para cima,
   centrada, base em z = 0), numa mesa com grade de 10 mm. Arrastar gira,
   pinça/roda aproxima. Gira sozinho, devagar, até o primeiro toque — nunca
   com movimento reduzido. Desenha só quando algo muda (sem laço parado
   gastando bateria). Sem WebGL, `criarVisor` lança e a tela fica sem 3D. */

export interface Visor {
  mostrar(posicoes: Float32Array, medidas: readonly [number, number, number]): void;
  destruir(): void;
}

const COR_DA_PECA = "#c8673f";

export function criarVisor(recipiente: HTMLElement, o: { amortecer: boolean }): Visor {
  const desenhador = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  desenhador.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  desenhador.outputColorSpace = THREE.SRGBColorSpace;
  const tela = desenhador.domElement;
  tela.className = "cv-canvas";
  tela.setAttribute("aria-hidden", "true");
  tela.dataset.lenisPrevent = "";
  recipiente.appendChild(tela);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
  camera.up.set(0, 1, 0);
  const controles = new OrbitControls(camera, tela);
  controles.enableDamping = o.amortecer;
  controles.dampingFactor = 0.08;
  controles.autoRotate = o.amortecer;
  controles.autoRotateSpeed = 1.6;
  controles.maxPolarAngle = Math.PI * 0.94;

  cena.add(new THREE.HemisphereLight("#ffffff", "#c9b8a6", 1.6));
  const chave = new THREE.DirectionalLight("#fff3e6", 2.2);
  const contra = new THREE.DirectionalLight("#dfe8ff", 0.9);
  cena.add(chave, contra);

  /* a peça vem em Z para cima; o three desenha com Y para cima: o grupo deita a mesa */
  const mesa = new THREE.Group();
  mesa.rotation.x = -Math.PI / 2;
  cena.add(mesa);
  const material = new THREE.MeshStandardMaterial({ color: COR_DA_PECA, roughness: 0.55, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });
  const peca = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesa.add(peca);
  let grade: THREE.GridHelper | null = null;

  let vivo = true;
  let girando = controles.autoRotate;
  const desenhar = () => { if (vivo) desenhador.render(cena, camera); };
  const laco = () => {
    if (!vivo) return;
    const mudou = controles.update();
    if (mudou || girando) desenhar();
  };
  /* com movimento (giro sozinho ou amortecimento) o laço roda; parado, só o evento "change" desenha */
  if (o.amortecer) desenhador.setAnimationLoop(laco);
  else controles.addEventListener("change", desenhar);
  const parar = () => {
    if (!girando) return;
    girando = false;
    controles.autoRotate = false;
  };
  tela.addEventListener("pointerdown", parar);
  tela.addEventListener("wheel", parar, { passive: true });

  const ajustar = () => {
    const l = Math.max(1, recipiente.clientWidth), a = Math.max(1, recipiente.clientHeight);
    desenhador.setSize(l, a, false);
    camera.aspect = l / a;
    camera.updateProjectionMatrix();
    desenhar();
  };
  const observador = new ResizeObserver(ajustar);
  observador.observe(recipiente);
  ajustar();

  return {
    mostrar(posicoes, [largura, profundidade, altura]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
      g.computeVertexNormals();
      peca.geometry.dispose();
      peca.geometry = g;

      const lado = Math.max(largura, profundidade, 10);
      const passo = lado > 600 ? 100 : lado > 150 ? 20 : 10;
      const tamanho = Math.ceil((lado * 1.5) / passo) * passo;
      if (grade) { cena.remove(grade); grade.geometry.dispose(); (grade.material as THREE.Material).dispose(); }
      grade = new THREE.GridHelper(tamanho, tamanho / passo, "#c9a48f", "#e6ddd4");
      grade.position.y = -0.01;
      cena.add(grade);

      const raio = Math.hypot(largura, profundidade, altura) / 2 || 10;
      const distancia = raio / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect < 1 ? 1.35 : 1.05);
      controles.target.set(0, altura / 2, 0);
      camera.position.set(distancia * 0.62, altura / 2 + distancia * 0.5, distancia * 0.62);
      camera.near = Math.max(0.01, distancia / 1000);
      camera.far = distancia * 50;
      camera.updateProjectionMatrix();
      controles.minDistance = raio * 0.4;
      controles.maxDistance = distancia * 6;
      chave.position.set(raio * 2, raio * 4, raio * 3);
      contra.position.set(-raio * 3, raio * 1.5, -raio * 2);
      controles.update();
      desenhar();
    },
    destruir() {
      vivo = false;
      desenhador.setAnimationLoop(null);
      observador.disconnect();
      controles.dispose();
      peca.geometry.dispose();
      material.dispose();
      grade?.geometry.dispose();
      desenhador.dispose();
      tela.remove();
    },
  };
}
