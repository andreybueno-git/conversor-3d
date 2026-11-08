/* O CONVERSOR DE ARQUIVOS 3D: o que ele lê, o que ele grava e como cada
   formato costuma chegar. TS puro, sem three.

   Tudo acontece NO NAVEGADOR de quem converte: o arquivo não sobe para
   servidor nenhum. Por isso a lista é a dos leitores do
   three que abrem um arquivo sozinho, sem WebAssembly (a CSP desta rota não
   compila wasm) e sem baixar nada de fora. */

export type Unidade = "mm" | "cm" | "m" | "pol";
export type Saida = "stl" | "3mf";

/** Quantos milímetros vale uma unidade do arquivo. */
export const MM_POR_UNIDADE: Readonly<Record<Unidade, number>> = { mm: 1, cm: 10, m: 1000, pol: 25.4 };

export const ROTULO_DA_UNIDADE: Readonly<Record<Unidade, string>> = {
  mm: "milímetro", cm: "centímetro", m: "metro", pol: "polegada",
};

export interface Formato {
  /** a extensão, minúscula e sem ponto */
  ext: string;
  nome: string;
  /** o programa ou o uso em que a pessoa o reconhece */
  origem: string;
  /** a unidade em que o formato costuma vir (a pessoa troca na tela) */
  unidade: Unidade;
  /** o "para cima" do formato: Y nos de animação e jogo, Z nos de impressão */
  cima: "y" | "z";
}

/** Os formatos de ENTRADA, na ordem em que a página os mostra. */
export const FORMATOS: readonly Formato[] = [
  { ext: "stl", nome: "STL", origem: "impressão 3D", unidade: "mm", cima: "z" },
  { ext: "obj", nome: "OBJ", origem: "Blender, Maya, Cinema 4D", unidade: "mm", cima: "y" },
  { ext: "3mf", nome: "3MF", origem: "Bambu Studio, PrusaSlicer, Cura", unidade: "mm", cima: "z" },
  { ext: "ply", nome: "PLY", origem: "escaneamento 3D", unidade: "mm", cima: "z" },
  { ext: "glb", nome: "GLB", origem: "glTF binário, web e AR", unidade: "m", cima: "y" },
  { ext: "gltf", nome: "glTF", origem: "web e AR (com o .bin junto)", unidade: "m", cima: "y" },
  { ext: "fbx", nome: "FBX", origem: "Autodesk, Unity, Unreal", unidade: "cm", cima: "y" },
  { ext: "dae", nome: "DAE", origem: "Collada, exportado pelo SketchUp", unidade: "m", cima: "y" },
  { ext: "kmz", nome: "KMZ", origem: "SketchUp e Google Earth", unidade: "m", cima: "y" },
  { ext: "3ds", nome: "3DS", origem: "3ds Max", unidade: "mm", cima: "z" },
  { ext: "amf", nome: "AMF", origem: "impressão 3D (antigo)", unidade: "mm", cima: "z" },
  { ext: "wrl", nome: "VRML", origem: "CAD antigo e escaneamento", unidade: "m", cima: "y" },
  { ext: "usdz", nome: "USDZ", origem: "Apple, Reality Composer", unidade: "m", cima: "y" },
  { ext: "off", nome: "OFF", origem: "geometria acadêmica", unidade: "mm", cima: "z" },
];

const POR_EXTENSAO = new Map(FORMATOS.map((f) => [f.ext, f]));

/** Arquivos que acompanham um modelo (o .bin do glTF): não viram item da fila sozinhos. */
export const COMPANHEIROS: ReadonlySet<string> = new Set(["bin", "mtl", "png", "jpg", "jpeg", "webp", "ktx2", "tga"]);

/**
 * Os formatos que a pessoa costuma ter e que NÃO dá para abrir no navegador,
 * com o caminho que funciona. É o que a tela diz em vez de "formato inválido".
 */
export const SEM_LEITOR: Readonly<Record<string, string>> = {
  skp: "O .skp do SketchUp é um formato fechado: só o SketchUp o abre. Sem SketchUp instalado: entre em app.sketchup.com (grátis, com conta Google ou Trimble), abra o .skp pelo ícone de pasta e depois use pasta › Exportar › STL. Com o SketchUp Pro: Arquivo › Exportar › Modelo 3D › STL, DAE ou OBJ. Depois solte o arquivo exportado aqui.",
  step: "STEP é um sólido de CAD, não uma malha. Exporte como STL ou 3MF no seu CAD (Fusion, SolidWorks, Onshape, FreeCAD).",
  stp: "STEP é um sólido de CAD, não uma malha. Exporte como STL ou 3MF no seu CAD (Fusion, SolidWorks, Onshape, FreeCAD).",
  iges: "IGES é um sólido de CAD, não uma malha. Exporte como STL ou 3MF no seu CAD.",
  igs: "IGES é um sólido de CAD, não uma malha. Exporte como STL ou 3MF no seu CAD.",
  f3d: "O .f3d é o projeto do Fusion. No Fusion, clique com o botão direito no corpo › Salvar como malha › 3MF ou STL.",
  blend: "O .blend é o projeto do Blender. No Blender, vá em Arquivo › Exportar › STL, OBJ ou glTF.",
  max: "O .max é o projeto do 3ds Max. Exporte como OBJ, FBX ou 3DS.",
  c4d: "O .c4d é o projeto do Cinema 4D. Exporte como OBJ, FBX ou STL.",
  "3dm": "O .3dm do Rhino precisa de um leitor que esta página não carrega. No Rhino, use Arquivo › Exportar › STL ou OBJ.",
  sldprt: "O .sldprt é a peça do SolidWorks. Use Salvar como › STL ou 3MF.",
  gcode: "G-code já é o arquivo fatiado para a impressora: não tem mais o modelo. Procure o STL ou 3MF original.",
};

/** A extensão de um nome de arquivo, minúscula, sem ponto ("" se não houver). */
export function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 && i < nome.length - 1 ? nome.slice(i + 1).toLowerCase() : "";
}

export function formatoDe(nome: string): Formato | null {
  return POR_EXTENSAO.get(extensao(nome)) ?? null;
}

/** O que o `accept` do campo de arquivo diz: os modelos e os companheiros. */
export const ACEITA = [...FORMATOS.map((f) => `.${f.ext}`), ".bin", ".skp"].join(",");

/** O teto do arquivo: acima disto a aba de um celular cai antes de terminar. */
export const MAX_BYTES = 300 * 1024 * 1024;
/** O teto da malha, em triângulos (~250 MB de STL). */
export const MAX_TRIANGULOS = 5_000_000;

/**
 * O nome do arquivo de saída: o nome original sem a extensão, só com
 * caracteres que qualquer disco aceita (é também a regra do ZIP), e a
 * extensão nova. "Minha peça (v2).obj" → "Minha-peca-v2.stl".
 */
export function nomeDeSaida(original: string, saida: Saida): string {
  const i = original.lastIndexOf(".");
  const base = (i > 0 ? original.slice(0, i) : original)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return `${base || "modelo"}.${saida}`;
}

/** Os nomes da fila, sem repetir (o ZIP recusa dois iguais, sem olhar maiúscula): "a.stl", "a-2.stl"… */
export function nomesUnicos(nomes: readonly string[]): string[] {
  const vistos = new Set<string>();
  return nomes.map((n) => {
    const i = n.lastIndexOf(".");
    const base = i > 0 ? n.slice(0, i) : n;
    const ext = i > 0 ? n.slice(i) : "";
    let tentativa = n;
    for (let k = 2; vistos.has(tentativa.toLowerCase()); k++) tentativa = `${base}-${k}${ext}`;
    vistos.add(tentativa.toLowerCase());
    return tentativa;
  });
}

/** Bytes para gente: "812 KB", "14,2 MB". */
export function formatarBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Milímetros para gente: "120 mm", "8,4 mm", "0,35 mm", "1,2 m". */
export function formatarMm(mm: number): string {
  if (!Number.isFinite(mm)) return "—";
  if (mm >= 1000) return `${(mm / 1000).toFixed(2).replace(/\.?0+$/, "").replace(".", ",")} m`;
  const casas = mm >= 100 ? 0 : mm >= 10 ? 1 : 2;
  return `${mm.toFixed(casas).replace(/\.0+$|(\.\d*?)0+$/, "$1").replace(".", ",")} mm`;
}

/** Números inteiros com o ponto de milhar: 1.204.330. */
export function formatarInteiro(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
