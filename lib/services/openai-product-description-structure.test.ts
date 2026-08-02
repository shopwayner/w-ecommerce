import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_DESCRIPTION_ALLOWED_TAGS } from "@/lib/product-description";
import {
  buildOpenAIProductDescriptionHtml,
  OpenAIProductDescriptionError,
  validateOpenAIProductDescriptionContent,
  type OpenAIProductDescriptionContent
} from "./openai-product-description-service";

const completeContent: OpenAIProductDescriptionContent = {
  introducao: ["Produto destinado ao uso conforme sua aplicação técnica cadastrada."],
  fichaTecnica: ["Marca: Exemplo", "Material: Material cadastrado"],
  compatibilidade: ["Compatível com a aplicação técnica cadastrada"],
  conteudoEmbalagem: ["1 unidade do produto"],
  vantagens: ["Uso compatível com a finalidade informada"],
  dimensoes: ["Altura: 12 cm", "Largura: 8 cm"],
  tutorialInstalacao: ["Siga as orientações do manual oficial"],
  cuidadosManutencao: ["Siga os cuidados informados pelo fabricante"],
  maisSobreProduto: ["O produto deve ser utilizado de acordo com as orientações cadastradas."]
};

const productFixtures = [
  {
    kind: "capacete",
    name: "Capacete ASX City Preto 60",
    content: {
      ...completeContent,
      introducao: ["Capacete destinado à proteção do motociclista durante o uso urbano."],
      fichaTecnica: ["Marca: ASX", "Modelo: City", "Cor: Preto", "Tamanho: 60"],
      vantagens: ["Uso urbano conforme a finalidade informada"]
    }
  },
  {
    kind: "chuveiro",
    name: "Chuveiro Elétrico Exemplo 220 V",
    content: {
      ...completeContent,
      introducao: ["Chuveiro elétrico destinado ao aquecimento de água em instalações compatíveis."],
      fichaTecnica: ["Tensão: 220 V", "Potência: 6800 W"],
      vantagens: ["Aquecimento conforme a potência informada"]
    }
  },
  {
    kind: "caixa elétrica",
    name: "Caixa Elétrica Retangular 4x2",
    content: {
      ...completeContent,
      introducao: ["Caixa destinada à acomodação de componentes em instalações elétricas."],
      fichaTecnica: ["Formato: Retangular", "Medida: 4x2"],
      vantagens: ["Organização dos componentes da instalação"]
    }
  },
  {
    kind: "resistência",
    name: "Resistência para Ducha 220 V",
    content: {
      ...completeContent,
      introducao: ["Resistência destinada à reposição em ducha compatível com os dados informados."],
      fichaTecnica: ["Tensão: 220 V", "Tipo: Reposição"],
      vantagens: ["Reposição conforme a compatibilidade cadastrada"]
    }
  },
  {
    kind: "ferramenta",
    name: "Alicate Universal 8 Polegadas",
    content: {
      ...completeContent,
      introducao: ["Alicate manual destinado a tarefas compatíveis com seu formato e medida."],
      fichaTecnica: ["Tipo: Universal", "Medida: 8 polegadas"],
      vantagens: ["Uso manual conforme a finalidade informada"]
    }
  }
] satisfies Array<{
  kind: string;
  name: string;
  content: OpenAIProductDescriptionContent;
}>;

const fixedSectionTitles = [
  "Ficha Técnica:",
  "Compatibilidade:",
  "Vantagens:",
  "Conteúdo da Embalagem:",
  "Dimensões:",
  "Tutorial de Instalação:",
  "Cuidados e Manutenção:",
  "Mais sobre o Produto:"
];

function assertRejected(value: unknown) {
  assert.throws(
    () => validateOpenAIProductDescriptionContent(value),
    (error: unknown) => error instanceof OpenAIProductDescriptionError &&
      error.code === "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  );
}

function sectionTitles(html: string) {
  return [...html.matchAll(/<p><strong>([^<]+:)<\/strong><\/p>/g)]
    .map((match) => match[1]);
}

test("1. exact structured JSON contract is accepted", () => {
  assert.deepEqual(
    validateOpenAIProductDescriptionContent(completeContent),
    completeContent
  );
});

test("2. unknown provider properties are rejected", () => {
  assertRejected({ ...completeContent, especificacoes: ["Não permitido"] });
});

test("3. missing provider properties are rejected", () => {
  const incomplete: Partial<OpenAIProductDescriptionContent> = { ...completeContent };
  delete incomplete.dimensoes;
  assertRejected(incomplete);
});

test("4. invalid provider property types are rejected", () => {
  assertRejected({ ...completeContent, vantagens: "Uso facilitado" });
});

test("5. HTML supplied by the provider is rejected", () => {
  assertRejected({ ...completeContent, introducao: ["<p>Texto controlado pela IA</p>"] });
});

test("5b. Markdown supplied by the provider is rejected", () => {
  assertRejected({ ...completeContent, introducao: ["**Texto controlado pela IA**"] });
  assertRejected({ ...completeContent, fichaTecnica: ["- Marca: Exemplo"] });
});

test("6. alternative section names supplied as content are rejected", () => {
  for (const heading of ["Especificações:", "Características:", "Dados Técnicos:", "Informações:"]) {
    assertRejected({ ...completeContent, introducao: [`${heading} conteúdo não permitido`] });
  }
  for (const heading of ["Ficha Técnica:", "Vantagens:", "Dimensões:"]) {
    assertRejected({ ...completeContent, fichaTecnica: [`${heading} Marca: Exemplo`] });
  }
});

test("7. product name always comes from the backend", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto & Modelo <Seguro>", completeContent);
  assert.match(html, /^<p><strong>Produto &amp; Modelo &lt;Seguro&gt;<\/strong><\/p>/);
});

test("8. backend always emits the fixed section order", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto completo", completeContent);
  assert.deepEqual(sectionTitles(html), fixedSectionTitles);
});

for (const [index, fixture] of productFixtures.entries()) {
  test(`${9 + index}. ${fixture.kind} uses exactly the same backend structure`, () => {
    const html = buildOpenAIProductDescriptionHtml(fixture.name, fixture.content);
    const expectedTitles = fixture.kind === "capacete"
      ? fixedSectionTitles.map((title) => (
          title === "Tutorial de Instalação:" ? "Orientações de Uso e Ajuste:" : title
        ))
      : fixedSectionTitles;
    assert.deepEqual(sectionTitles(html), expectedTitles);
    assert.match(html, new RegExp(`^<p><strong>${fixture.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(html, /Especificações:|Características:|Dados Técnicos:|Informações:/);
  });
}

test("14. every array is rendered as one compact unordered list", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto completo", completeContent);
  const lists = html.match(/<ul>[\s\S]*?<\/ul>/g) ?? [];
  assert.equal(lists.length, 6);
  assert.ok(lists.every((list) => /^<ul>(?:<li>[^<]*<\/li>)+<\/ul>$/.test(list)));
  assert.ok(lists.every((list) => !/<p>|<br|&nbsp;/i.test(list)));
});

test("15. empty values are removed without creating empty sections", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto parcial", {
    ...completeContent,
    compatibilidade: [],
    conteudoEmbalagem: [],
    dimensoes: [],
    tutorialInstalacao: [],
    cuidadosManutencao: [],
    maisSobreProduto: []
  });
  assert.deepEqual(sectionTitles(html), ["Ficha Técnica:", "Vantagens:"]);
  assert.doesNotMatch(html, /<ul><\/ul>|<p>\s*<\/p>/);
});

test("16. duplicate list items are removed after normalized comparison", () => {
  const content = validateOpenAIProductDescriptionContent({
    ...completeContent,
    fichaTecnica: ["Marca: Exemplo", " marca:   exemplo ", "Material: PVC"]
  });
  assert.deepEqual(content.fichaTecnica, ["Marca: Exemplo", "Material: PVC"]);
});

test("17. dimensions are not repeated in Technical Sheet", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto dimensionado", {
    ...completeContent,
    fichaTecnica: ["Marca: Exemplo", "Altura: 12 cm", "Peso bruto: 2 kg"]
  });
  const technicalHtml = html.slice(
    html.indexOf("Ficha Técnica:"),
    html.indexOf("Conteúdo da Embalagem:")
  );
  assert.doesNotMatch(technicalHtml, /Altura:|Peso bruto:/);
  assert.match(html, /<p><strong>Dimensões:<\/strong><\/p>/);
});

test("18. introduction is a backend paragraph without a generated heading", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto completo", completeContent);
  assert.match(html, /<\/strong><\/p><p>Produto destinado/);
  assert.doesNotMatch(html, /Introdução:/);
});

test("19. More About the Product is always the final optional section", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto completo", completeContent);
  assert.match(html, /<p><strong>Mais sobre o Produto:<\/strong><\/p><p>[^<]+<\/p>$/);
});

test("20. repeated introduction and final text are removed from the final section", () => {
  const content = validateOpenAIProductDescriptionContent({
    ...completeContent,
    maisSobreProduto: [completeContent.introducao[0].toLocaleUpperCase("pt-BR")]
  });
  assert.deepEqual(content.maisSobreProduto, []);
});

test("20b. repeated content across sections keeps only the first occurrence", () => {
  const repeated = "Uso compatível com a finalidade informada";
  const content = validateOpenAIProductDescriptionContent({
    ...completeContent,
    fichaTecnica: [...completeContent.fichaTecnica, repeated],
    vantagens: [repeated],
    maisSobreProduto: [repeated]
  });
  assert.equal(content.fichaTecnica.at(-1), repeated);
  assert.deepEqual(content.vantagens, []);
  assert.deepEqual(content.maisSobreProduto, []);
});

test("21. generated HTML uses only editor-compatible tags", () => {
  const html = buildOpenAIProductDescriptionHtml("Produto completo", completeContent);
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((match) => match[1]);
  assert.ok(tags.every((tag) => PRODUCT_DESCRIPTION_ALLOWED_TAGS.includes(
    tag as (typeof PRODUCT_DESCRIPTION_ALLOWED_TAGS)[number]
  )));
});

test("22. backend escapes provider text instead of interpreting markup", () => {
  assertRejected({
    ...completeContent,
    vantagens: ["Uso seguro <script>alert(1)</script>"]
  });
});

test("23. URLs emoji and citations remain forbidden in JSON values", () => {
  for (const value of ["Veja https://example.com", "Produto seguro 😀", "Conteúdo [fonte: 1]"]) {
    assertRejected({ ...completeContent, maisSobreProduto: [value] });
  }
});

test("24. dangerous installation content is rejected before HTML assembly", () => {
  assertRejected({
    ...completeContent,
    tutorialInstalacao: ["Faça a instalação com a energia ligada"]
  });
});

test("25. exaggerated calls to action are rejected before HTML assembly", () => {
  assertRejected({ ...completeContent, introducao: ["Compre agora e garanta já o seu produto."] });
});

test("26. object insertion order cannot change final section order", () => {
  const reordered = {
    maisSobreProduto: completeContent.maisSobreProduto,
    cuidadosManutencao: completeContent.cuidadosManutencao,
    tutorialInstalacao: completeContent.tutorialInstalacao,
    dimensoes: completeContent.dimensoes,
    vantagens: completeContent.vantagens,
    conteudoEmbalagem: completeContent.conteudoEmbalagem,
    compatibilidade: completeContent.compatibilidade,
    fichaTecnica: completeContent.fichaTecnica,
    introducao: completeContent.introducao
  };
  const html = buildOpenAIProductDescriptionHtml("Produto completo", reordered);
  assert.deepEqual(sectionTitles(html), fixedSectionTitles);
});

test("27. backend output never contains an unapproved section heading", () => {
  for (const fixture of productFixtures) {
    const html = buildOpenAIProductDescriptionHtml(fixture.name, fixture.content);
    assert.ok(sectionTitles(html).every((title) => (
      fixedSectionTitles.includes(title) || title === "Orientações de Uso e Ajuste:"
    )));
  }
});

test("28. empty product name is rejected by the backend", () => {
  assert.throws(
    () => buildOpenAIProductDescriptionHtml("  ", completeContent),
    (error: unknown) => error instanceof OpenAIProductDescriptionError &&
      error.code === "OPENAI_DESCRIPTION_INVALID_INPUT"
  );
});

test("29. excessively long content is rejected before HTML assembly", () => {
  assertRejected({
    ...completeContent,
    introducao: ["a".repeat(2_001)]
  });
  assertRejected({
    ...completeContent,
    fichaTecnica: ["a".repeat(501)]
  });
});
