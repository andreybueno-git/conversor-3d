import { test, expect, type Page } from "@playwright/test";
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * O CONVERSOR, num navegador de verdade, com uma CSP tão fechada quanto a do
 * GitHub Pages permite testar (e2e/servidor.mjs): os formatos que precisam de DOM (DAE, AMF, 3MF) e os
 * que o unitário já cobre (OBJ, glTF com o .bin ao lado), o .skp com o
 * caminho escrito, o "soltar em qualquer lugar", o download do STL e do 3MF
 * com o tamanho certo, o ZIP de vários — e NENHUM pedido de rede nem erro de
 * CSP durante a conversão (o arquivo não sai do aparelho).
 */

const CUBO_OBJ = `# cubo de 2
v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1
f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 3 4 8 7\nf 2 3 7 6\nf 1 5 8 4\n`;

/* um tetraedro em COLLADA (o que o SketchUp exporta), Z para cima, em polegadas */
const TETRA_DAE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="0.0254" name="inch"/><up_axis>Z_UP</up_axis></asset>
  <library_images><image id="img"><init_from>textura-que-nao-existe.jpg</init_from></image></library_images>
  <library_geometries>
    <geometry id="g"><mesh>
      <source id="p"><float_array id="pa" count="12">0 0 0 10 0 0 0 10 0 0 0 10</float_array>
        <technique_common><accessor source="#pa" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>
      </source>
      <vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
      <triangles count="4"><input semantic="VERTEX" source="#v" offset="0"/><p>0 2 1 0 1 3 0 3 2 1 2 3</p></triangles>
    </mesh></geometry>
  </library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;

const TRI_AMF = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter"><object id="0"><mesh><vertices>
<vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
<vertex><coordinates><x>30</x><y>0</y><z>0</z></coordinates></vertex>
<vertex><coordinates><x>0</x><y>20</y><z>0</z></coordinates></vertex>
<vertex><coordinates><x>0</x><y>0</y><z>5</z></coordinates></vertex>
</vertices><volume>
<triangle><v1>0</v1><v2>2</v2><v3>1</v3></triangle><triangle><v1>0</v1><v2>1</v2><v3>3</v3></triangle>
<triangle><v1>0</v1><v2>3</v2><v3>2</v3></triangle><triangle><v1>1</v1><v2>2</v2><v3>3</v3></triangle>
</volume></mesh></object></amf>`;

function gltfComBin() {
  const bin = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, uri: "tri.bin" }],
  };
  return [
    { name: "tri.gltf", mimeType: "model/gltf+json", buffer: Buffer.from(JSON.stringify(json)) },
    { name: "tri.bin", mimeType: "application/octet-stream", buffer: bin },
  ];
}

const arquivo = (name: string, conteudo: string) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.from(conteudo) });

/** O que a página pediu à rede e o que o navegador barrou, enquanto o teste roda. */
function vigiar(page: Page) {
  const pedidos: string[] = [];
  const erros: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) pedidos.push(r.url());
  });
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(e.message));
  return { pedidos, erros };
}

test.describe("o conversor de arquivos 3D", () => {
  /* quem já viu o tutorial: os testes da conversão começam sem o quadro na frente */
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("conversor3d:tutorial-visto", "1"));
  });

  test("a página abre com o topo, a caixa de soltar e a ajuda do SketchUp", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("STL");
    await expect(page.locator(".cv-soltar")).toBeVisible();
    /* com mouse, "solte"; no celular, "toque" */
    const toque = test.info().project.name === "celular";
    await expect(page.getByText(toque ? "Toque aqui para escolher seu arquivo" : "Solte seus arquivos 3D aqui")).toBeVisible();
    await expect(page.getByText("Tem um arquivo do SketchUp (.skp)?")).toBeVisible();
  });

  test("OBJ: prévia, medidas, unidade, giro e o 3MF e o STL baixados", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const v = vigiar(page);
    await page.locator("input[type=file]").setInputFiles([arquivo("Meu cubo (v2).obj", CUBO_OBJ)]);
    const medidas = page.locator(".cv-medidas");
    await expect(medidas).toContainText("2 mm");
    await page.getByRole("radio", { name: "cm" }).click();
    await expect(medidas).toContainText("20 mm");
    await page.getByRole("button", { name: /Girar em X/ }).click();
    await expect(medidas).toContainText("20 mm");

    /* o STL vem escolhido: o primeiro download já é STL, com o selo de qualidade máxima */
    await expect(page.locator(".cv-qualidade")).toContainText("12 triângulos");
    const [baixadoStl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em STL/ }).click()]);
    expect(baixadoStl.suggestedFilename()).toBe("Meu-cubo-v2.stl");
    const stl = readFileSync((await baixadoStl.path())!);
    expect(stl.length, "STL binário: 84 + 50 × 12 triângulos").toBe(84 + 50 * 12);
    expect(stl.subarray(0, 24).toString()).toBe("Conversor 3D | mm | Z-up");

    const [baixado3mf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em 3MF/ }).click()]);
    expect(baixado3mf.suggestedFilename()).toBe("Meu-cubo-v2.3mf");
    const zip = readFileSync((await baixado3mf.path())!);
    expect(zip.subarray(0, 4).toString("hex"), "o 3MF é um ZIP").toBe("504b0304");

    expect(v.pedidos, "nada saiu para a rede").toEqual([]);
    expect(v.erros.filter((e) => /Content Security Policy|Refused/.test(e)), "nenhum bloqueio de CSP").toEqual([]);
  });

  test("DAE (SketchUp), AMF e glTF com o .bin: lidos sem rede; o ZIP junta todos", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const v = vigiar(page);
    await page.locator("input[type=file]").setInputFiles([arquivo("casa.dae", TETRA_DAE), arquivo("peca.amf", TRI_AMF), ...gltfComBin()]);
    const fila = page.locator(".cv-fila li");
    await expect(fila).toHaveCount(3);                     // o .bin acompanha o .gltf, não vira item
    await expect(page.locator('.cv-fila li[data-estado="pronto"]')).toHaveCount(3);

    /* o DAE está em polegadas (0,0254 m): 10 pol = 254 mm, já convertido em metros pelo leitor */
    await page.locator(".cv-item", { hasText: "casa.dae" }).click();
    await expect(page.locator(".cv-medidas")).toContainText("254 mm");
    await page.locator(".cv-item", { hasText: "peca.amf" }).click();
    await expect(page.locator(".cv-medidas")).toContainText("30 mm");

    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar os 3 em STL/ }).click()]);
    expect(zip.suggestedFilename()).toBe("convertidos-stl.zip");
    const bytes = readFileSync((await zip.path())!);
    for (const nome of ["casa.stl", "peca.stl", "tri.stl"]) expect(bytes.includes(Buffer.from(nome)), nome).toBe(true);

    expect(v.pedidos, "nada saiu para a rede (nem a textura do DAE)").toEqual([]);
    expect(v.erros.filter((e) => /Content Security Policy|Refused/.test(e)), "nenhum bloqueio de CSP").toEqual([]);
  });

  test("o 3MF que sai daqui volta a entrar (e o .skp recebe o caminho, não um erro seco)", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles([arquivo("cubo.obj", CUBO_OBJ)]);
    const [baixado] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em 3MF/ }).click()]);
    const tresmf = readFileSync((await baixado.path())!);

    await page.locator("input[type=file]").setInputFiles([
      { name: "volta.3mf", mimeType: "model/3mf", buffer: tresmf },
      arquivo("projeto.skp", "SketchUp Model"),
    ]);
    await expect(page.locator('.cv-fila li[data-estado="pronto"]')).toHaveCount(2);
    await page.locator(".cv-item", { hasText: "projeto.skp" }).click();
    await expect(page.locator(".cv-palco-erro")).toContainText("Exportar");
  });

  test("soltar o arquivo em qualquer lugar da página", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const dt = await page.evaluateHandle((texto) => {
      const t = new DataTransfer();
      t.items.add(new File([texto], "solto.obj"));
      return t;
    }, CUBO_OBJ);
    await page.dispatchEvent("footer", "dragenter", { dataTransfer: dt });
    await expect(page.locator(".cv-ilha")).toHaveAttribute("data-arrastando", "sim");
    await page.dispatchEvent("footer", "drop", { dataTransfer: dt });
    await expect(page.locator(".cv-ilha")).toHaveAttribute("data-arrastando", "nao");
    await expect(page.getByRole("button", { name: /Baixar em STL/ })).toBeVisible();
  });
});

test.describe("o tutorial", () => {
  test("abre sozinho na primeira visita e diz a quem tem .skp que pode mandar direto", async ({ page }) => {
    await page.goto("/");
    const quadro = page.getByRole("dialog");
    await expect(quadro).toBeVisible();
    await expect(quadro).toContainText("que arquivo você tem?");
    await quadro.getByRole("button", { name: /Um arquivo do SketchUp/ }).click();
    await expect(quadro).toContainText("Passo 1 de 4");
    await expect(quadro).toContainText("este conversor lê o .skp");
    await quadro.getByRole("button", { name: "Próximo →" }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(quadro).toContainText("Passo 4 de 4");
    await expect(quadro).toContainText("botão grande já baixa em STL");
    /* o último botão abre o seletor de arquivos e fecha o quadro */
    const [seletor] = await Promise.all([page.waitForEvent("filechooser"), quadro.getByRole("button", { name: "Escolher meu arquivo" }).click()]);
    expect(seletor.isMultiple()).toBe(true);
    await expect(quadro).toBeHidden();

    /* na volta, não aparece de novo; o "Como usar" o reabre, e o Esc fecha */
    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /Como usar/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: /Outro arquivo 3D/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Passo 1 de 3");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("pular o tutorial também conta como visto", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Pular o tutorial" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("no celular", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "celular", "só no celular");
    await page.addInitScript(() => localStorage.setItem("conversor3d:tutorial-visto", "1"));
  });

  test("nada sai da largura da tela, e a barra de baixar STL aparece quando o botão está longe", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles([{ name: "cubo.obj", mimeType: "text/plain", buffer: Buffer.from(CUBO_OBJ) }]);
    await expect(page.locator(".cv-medidas")).toBeVisible();
    const larguras = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
    expect(larguras.doc).toBeLessThanOrEqual(larguras.tela);

    const barra = page.locator(".cv-barra-celular");
    await page.locator(".cv-palco").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(barra).toHaveAttribute("data-mostrar", "sim");
    const [baixado] = await Promise.all([page.waitForEvent("download"), barra.getByRole("button").click()]);
    expect(baixado.suggestedFilename()).toBe("cubo.stl");

    await page.locator(".cv-botao-stl").scrollIntoViewIfNeeded();
    await expect(barra).toHaveAttribute("data-mostrar", "nao");
  });
});

test.describe("SketchUp (.skp) direto", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("conversor3d:tutorial-visto", "1"));
  });

  test("a cadeira e a mesa do SketchUp viram STL, sem rede e sem passar por outro site", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const v = vigiar(page);
    await page.locator("input[type=file]").setInputFiles([new URL("./skp/chair_and_table.skp", import.meta.url).pathname]);
    await expect(page.locator(".cv-medidas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".cv-fila li").first()).toHaveAttribute("data-estado", "pronto");
    const [baixado] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em STL/ }).first().click()]);
    expect(baixado.suggestedFilename()).toBe("chair_and_table.stl");
    const stl = readFileSync((await baixado.path())!);
    expect(stl.length).toBe(84 + 50 * stl.readUInt32LE(80));
    expect(stl.readUInt32LE(80)).toBeGreaterThan(10);
    expect(v.pedidos, "nada saiu para a rede").toEqual([]);
  });
});

/* ── o .skp lido em segundo plano, a queda para a linha principal e o modo pesado ── */

const CADEIRA = new URL("./skp/chair_and_table.skp", import.meta.url).pathname;
const TRIANGULOS_DA_CADEIRA = 352;

/** Os primeiros 84 bytes de um arquivo (o cabeçalho do STL), sem ler os 250 MB. */
function comecoDe(caminho: string): Buffer {
  const b = Buffer.alloc(84);
  const fd = openSync(caminho, "r");
  try { readSync(fd, b, 0, 84, 0); } finally { closeSync(fd); }
  return b;
}

/** Espia, do lado do teste, os Workers que a página cria (o código do site não sabe de nada). */
async function espiarLeitores(page: Page, o: { segurar?: boolean } = {}) {
  await page.addInitScript((segurar) => {
    const Original = window.Worker;
    const registro = { criados: [] as string[], mensagens: [] as string[], encerrados: 0, soltar: () => {} };
    (window as unknown as { __leitores: typeof registro }).__leitores = registro;
    window.Worker = class extends Original {
      constructor(url: string | URL, op?: WorkerOptions) {
        super(url, op);
        registro.criados.push(String(url));
        this.addEventListener("message", (e) => registro.mensagens.push((e as MessageEvent).data?.tipo));
      }
      /* "segurar": o arquivo só vai para o leitor quando o teste mandar — a leitura fica parada no meio */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postMessage(m: unknown, t?: any) {
        if (!segurar) return super.postMessage(m, t);
        registro.soltar = () => super.postMessage(m, t);
      }
      terminate() { registro.encerrados++; super.terminate(); }
    } as typeof Worker;
  }, o.segurar ?? false);
  return () => page.evaluate(() => (window as unknown as { __leitores: { criados: string[]; mensagens: string[]; encerrados: number } }).__leitores);
}

test.describe("SketchUp (.skp) em segundo plano", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("conversor3d:tutorial-visto", "1"));
  });

  test("o .skp é lido pelo Worker embutido, que é encerrado ao terminar", async ({ page }) => {
    const leitores = await espiarLeitores(page);
    await page.goto("/");
    const v = vigiar(page);
    await page.locator("input[type=file]").setInputFiles([CADEIRA]);
    await expect(page.locator(".cv-fila li").first()).toHaveAttribute("data-estado", "pronto", { timeout: 20_000 });
    const r = await leitores();
    expect(r.criados, "um Worker, nascido do próprio index.html (blob:)").toHaveLength(1);
    expect(r.criados[0]).toMatch(/^blob:/);
    expect(r.mensagens, "o Worker leu: disse vivo, mandou o andamento e devolveu a sopa").toEqual(expect.arrayContaining(["vivo", "andamento", "lido"]));
    expect(r.encerrados, "e foi encerrado (a memória volta)").toBe(1);
    const [baixado] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em STL/ }).first().click()]);
    expect(comecoDe((await baixado.path())!).readUInt32LE(80)).toBe(TRIANGULOS_DA_CADEIRA);
    expect(v.pedidos, "nada saiu para a rede").toEqual([]);
    expect(v.erros.filter((e) => /Content Security Policy|Refused/.test(e)), "nenhum bloqueio de CSP").toEqual([]);
  });

  test("tirar o .skp da fila no meio da leitura encerra o Worker e não mexe mais na tela", async ({ page }) => {
    const leitores = await espiarLeitores(page, { segurar: true });
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles([
      { name: "chair_and_table.skp", mimeType: "application/octet-stream", buffer: readFileSync(CADEIRA) }, arquivo("cubo.obj", CUBO_OBJ),
    ]);
    const cadeira = page.locator(".cv-fila li", { hasText: "chair_and_table.skp" });
    await expect(cadeira).toHaveAttribute("data-estado", "lendo");
    await expect.poll(async () => (await leitores()).criados.length).toBe(1);
    await page.getByRole("button", { name: "Tirar chair_and_table.skp" }).click();
    await expect(cadeira).toHaveCount(0);
    expect((await leitores()).encerrados).toBe(1);
    /* a fila anda: o próximo da fila é lido normalmente */
    await expect(page.locator(".cv-fila li", { hasText: "cubo.obj" })).toHaveAttribute("data-estado", "pronto");
    await page.evaluate(() => (window as unknown as { __leitores: { soltar(): void } }).__leitores.soltar());
    await page.waitForTimeout(500);
    await expect(page.locator(".cv-fila li")).toHaveCount(1);
    expect((await leitores()).mensagens).not.toContain("lido");
  });

  test("sem Worker no navegador, o .skp é lido na linha principal, como antes", async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { Worker: unknown }).Worker = undefined; });
    await page.goto("/");
    expect(await page.evaluate(() => typeof Worker)).toBe("undefined");
    await page.locator("input[type=file]").setInputFiles([CADEIRA]);
    await expect(page.locator(".cv-fila li").first()).toHaveAttribute("data-estado", "pronto", { timeout: 20_000 });
    const [baixado] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar em STL/ }).first().click()]);
    expect(comecoDe((await baixado.path())!).readUInt32LE(80), "o mesmo resultado do Worker").toBe(TRIANGULOS_DA_CADEIRA);
  });
});

test.describe("modo pesado", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "um STL de 250 MB: só no computador");
    await page.addInitScript(() => localStorage.setItem("conversor3d:tutorial-visto", "1"));
  });

  test("um STL com mais triângulos que o limiar: sem prévia, sem 3MF, fora do ZIP, e o STL sai completo", async ({ page }) => {
    test.setTimeout(240_000);
    /* um STL binário de verdade, com 5.000.001 triângulos (o limiar + 1): 250 MB num arquivo temporário */
    const n = 5_000_001;
    const caminho = join(tmpdir(), `conversor-3d-pesado-${process.pid}.stl`);
    try {
      const b = Buffer.alloc(84 + 50 * n);
      b.write("e2e modo pesado", 0);
      b.writeUInt32LE(n, 80);
      const bloco = 10_000;                                     // 10 mil triângulos diferentes, numa grade de 100 × 100 mm…
      for (let t = 0; t < bloco; t++) {
        const o = 84 + t * 50, x = t % 100, y = Math.floor(t / 100);
        b.writeFloatLE(1, o + 8);
        for (const [k, v] of [x, y, 0, x + 1, y, 0, x, y + 1, (t % 7) + 1, 0].entries()) if (k < 9) b.writeFloatLE(v, o + 12 + k * 4);
      }
      for (let t = bloco; t < n; t += bloco) b.copy(b, 84 + t * 50, 84, 84 + Math.min(bloco, n - t) * 50);   // …repetidos até o fim
      writeFileSync(caminho, b);

      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles([caminho]);
      await page.locator("input[type=file]").setInputFiles([arquivo("a.obj", CUBO_OBJ), arquivo("b.obj", CUBO_OBJ)]);
      const pesado = page.locator(".cv-fila li", { hasText: "conversor-3d-pesado" });
      await expect(pesado).toHaveAttribute("data-estado", "pronto", { timeout: 120_000 });
      await expect(page.locator('.cv-fila li[data-estado="pronto"]')).toHaveCount(3);
      await page.locator(".cv-item", { hasText: "conversor-3d-pesado" }).click();

      /* o aviso calmo no lugar da prévia, e nenhum canvas */
      await expect(page.locator(".cv-palco-pesado")).toContainText("Modelo pesado: 5.000.001 triângulos");
      await expect(page.locator(".cv-palco-pesado")).toContainText("sai completo");
      await expect(page.locator(".cv-palco canvas")).toHaveCount(0);
      /* unidade e giro continuam valendo: 100 × 100 × 7 mm; em cm, 1 m; girado em X, a altura troca de lado */
      const lados = page.locator(".cv-medidas b");
      await expect(lados).toHaveText(["100 mm", "100 mm", "7 mm"]);
      await page.getByRole("radio", { name: "cm" }).click();
      await expect(lados).toHaveText(["1 m", "1 m", "70 mm"]);
      await page.getByRole("radio", { name: "mm" }).click();
      await page.getByRole("button", { name: /Girar em X/ }).click();
      await expect(lados).toHaveText(["100 mm", "7 mm", "100 mm"]);
      /* 3MF desligado, com o motivo; o ZIP leva só os dois leves e diz que o pesado ficou de fora */
      await expect(page.getByRole("button", { name: "Baixar em 3MF" })).toBeDisabled();
      await expect(page.locator("#cv-sem-3mf")).toContainText("não cabe na memória");
      await expect(page.getByRole("button", { name: /Baixar os 2 em STL/ })).toBeVisible();
      await expect(page.locator(".cv-fora-do-zip")).toContainText("fica de fora do ZIP");

      const [baixado] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.locator(".cv-botao-stl").click(),
      ]);
      const saida = (await baixado.path())!;
      expect(statSync(saida).size, "84 + 50 × 5.000.001 bytes").toBe(84 + 50 * n);
      const cabeca = comecoDe(saida);
      expect(cabeca.readUInt32LE(80)).toBe(n);
      expect(cabeca.subarray(0, 24).toString()).toBe("Conversor 3D | mm | Z-up");
      await expect(page.locator(".cv-aviso").first()).toContainText("com os 5.000.001 triângulos");

      /* escolher um leve traz a prévia de volta */
      await page.locator(".cv-item", { hasText: "a.obj" }).click();
      await expect(page.locator(".cv-palco canvas")).toHaveCount(1);
    } finally {
      rmSync(caminho, { force: true });
    }
  });
});
