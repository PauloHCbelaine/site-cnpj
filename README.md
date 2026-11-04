# Radar de CNPJ

Digite um domínio (ou envie uma planilha) e o site descobre o CNPJ da empresa dona dele.
É só HTML, CSS e JavaScript: sem backend e sem chave de API.

## Como usar

O navegador bloqueia parte das consultas quando a página é aberta como arquivo (`file://`),
então rode um servidor local simples dentro da pasta:

```bash
npx http-server -p 5510
```

e abra http://localhost:5510.

## De onde vêm os dados

| Ordem | Fonte | O que traz | Confiança |
|---|---|---|---|
| 1 | `rdap.registro.br` | CNPJ do **titular oficial** de domínios `.br` | Alta |
| 2 | O próprio site, lido por `r.jina.ai` | CNPJs publicados na home, contato, política de privacidade... | Média |
| 3 | `brasilapi.com.br` | Confirma na Receita: razão social, situação, cidade, e-mail | Confirma ou derruba |
| – | `dns.google` (reserva: Cloudflare) | Servidores de e-mail (MX) | – |

Regras de confiança:

- **Alta**: titular do domínio no Registro.br, *ou* o e-mail na Receita é do mesmo domínio,
  *ou* é filial (mesmos 8 primeiros dígitos) de um CNPJ já confirmado.
- **Média**: o CNPJ aparece no próprio site.
- **Baixa**: só aparece perto de "desenvolvido por / agência / pagamento" (costuma ser fornecedor),
  ou não existe na Receita.

## Planilha

Aceita `.csv` (separador `,` `;` ou tab) e `.xlsx`. Procura domínios em **qualquer célula**:
sites, URLs ou e-mails (`fulano@empresa.com.br` vira `empresa.com.br`). Gmail, Hotmail etc. são ignorados.
Processa 3 domínios por vez e exporta um CSV pronto para o Excel.

## Limitações

- Domínios fora do `.br` (ex.: `.com`) não têm registro público com CNPJ: aí depende de o site publicar.
- O leitor de páginas `r.jina.ai` gratuito tem limite de ~20 leituras por minuto.
  Em planilhas grandes, alguns sites podem aparecer como "limite do leitor".
- A BrasilAPI também limita consultas; o app tenta de novo automaticamente.

---

## O que estava errado na versão anterior

1. **O site não funcionava.** O `app.js` tinha o mesmo código colado 5 vezes seguidas
   (2.557 linhas). Na linha 534, `const DNS_ENDPOINT` era declarado de novo, o que gera
   `SyntaxError` e o navegador descarta o arquivo inteiro. Nenhum botão fazia nada.
2. **O CSS tinha o mesmo problema**: 5 versões empilhadas (3.718 linhas), uma sobrescrevendo a outra.
3. **A última versão do JS procurava elementos que não existiam** no HTML
   (`#results-container`, `#cnpj-card`...) e usava variáveis nunca criadas (`CONTENT_PROXY`).
4. **O `.xlsx` era lido como texto.** Excel é um arquivo compactado, então virava lixo.
   O CSV também quebrava com mais de uma coluna (a linha inteira era tratada como domínio).
5. **Procurava `<title>` e JSON-LD em texto que não é HTML.** O `r.jina.ai` devolve
   Markdown, então essas buscas nunca davam certo.
6. **Não usava a melhor fonte.** O Registro.br informa o CNPJ do dono de qualquer domínio `.br`.
   A versão antiga só tentava achar números soltos na página.
7. **Não diferenciava o CNPJ da empresa do de terceiros** (agência que fez o site, parceiro,
   gateway de pagamento). Qualquer CNPJ válido no texto era aceito igual.
8. **Lento e pesado em lote**: 6 páginas por domínio, sempre, uma de cada vez.
9. **O script com OpenAI (`extract-cnpj-openai.js`) é arriscado**: perguntar ao GPT
   "qual o CNPJ deste site" faz o modelo inventar números. A checagem dos dígitos
   verificadores não resolve, porque um número inventado pode passar na conta e ser de
   outra empresa. Além disso, se fosse usado no navegador, a chave da API ficaria exposta.
   Ficou fora desta versão.
10. **Muitos arquivos gerados automaticamente** (`00_LEIA_PRIMEIRO.txt`, `SUMMARY.txt`,
    `GETTING_STARTED.js`, `TROUBLESHOOTING.js`...) prometendo coisas que não existiam
    ("100+ testes", "precisão 99.98%", "production ready").
