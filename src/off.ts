/* O leitor do OFF (Object File Format), que o three não tem: texto com o
   cabeçalho "OFF", as contagens (vértices, faces, arestas), um vértice por
   linha e uma face por linha ("n i1 i2 … in", e a cor opcional depois, que se
   ignora). Face com mais de 3 cantos vira leque de triângulos. Devolve a
   SOPA (9 números por triângulo), como os outros leitores. */

export function lerOff(texto: string): Float32Array {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/));
  if (!linhas.length || !/^(ST)?C?N?4?n?OFF/i.test(linhas[0][0])) throw new Error("Este .off não começa com o cabeçalho OFF.");
  const num = (s: string | undefined) => {
    const v = Number(s);
    if (s === undefined || !Number.isFinite(v)) throw new Error("Este .off tem um número ilegível.");
    return v;
  };
  /* as contagens podem vir na mesma linha do cabeçalho ("OFF 8 6 0") ou na seguinte */
  const contagens: string[] = linhas[0].slice(1);
  let l = 1;
  while (contagens.length < 3 && l < linhas.length) contagens.push(...linhas[l++]);
  const nv = num(contagens[0]), nf = num(contagens[1]);
  if (linhas.length < l + nv + nf) throw new Error("Este .off está cortado: tem menos linhas do que diz ter.");

  const v = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++, l++) {
    const c = linhas[l];
    v[k * 3] = num(c[0]); v[k * 3 + 1] = num(c[1]); v[k * 3 + 2] = num(c[2]);
  }
  const tri: number[] = [];
  for (let f = 0; f < nf; f++, l++) {
    const c = linhas[l];
    const n = num(c[0]);
    const cantos: number[] = [];
    for (let k = 1; k <= n; k++) {
      const idx = num(c[k]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= nv) throw new Error("Este .off tem uma face apontando para um vértice que não existe.");
      cantos.push(idx);
    }
    for (let k = 1; k + 1 < cantos.length; k++) {
      for (const idx of [cantos[0], cantos[k], cantos[k + 1]]) tri.push(v[idx * 3], v[idx * 3 + 1], v[idx * 3 + 2]);
    }
  }
  return new Float32Array(tri);
}
